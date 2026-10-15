import os
import re
import tempfile
from pathlib import Path

from app.errors import AppError

_FILENAME_RE = re.compile(r"[a-zA-Z0-9._-]+")
_SERVER_NAME_RE = re.compile(r"^\s*server_name\s+([^;]+);", re.MULTILINE)


def validate_filename(name: str) -> str:
    if (
        not 1 <= len(name) <= 255
        or not _FILENAME_RE.fullmatch(name)
        or name.startswith(".")  # juga menolak "." dan ".."
    ):
        raise AppError(400, "INVALID_FILENAME", "Nama berkas tidak valid.")
    return name


def parse_server_name(content: str) -> str | None:
    """Nama pertama dari direktif server_name pertama (baris komentar diabaikan)."""
    for line in content.splitlines():
        if line.lstrip().startswith("#"):
            continue
        m = _SERVER_NAME_RE.match(line)
        if m:
            return m.group(1).split()[0]
    return None


def _not_found() -> AppError:
    return AppError(404, "FILE_NOT_FOUND", "Berkas konfigurasi tidak ditemukan.")


class FileService:
    def __init__(self, available: Path, enabled: Path):
        self.available = Path(available)
        self.enabled = Path(enabled)

    def _path(self, name: str) -> Path:
        validate_filename(name)
        path = self.available / name
        root = os.path.realpath(self.available)
        # realpath menangkap symlink di dalam sites-available yang menunjuk keluar
        if os.path.commonpath([root, os.path.realpath(path)]) != root:
            raise AppError(
                400, "PATH_OUTSIDE_ROOT", "Jalur berkas di luar direktori yang diizinkan."
            )
        return path

    def exists(self, name: str) -> bool:
        return self._path(name).is_file()

    def list_files(self) -> list[str]:
        # nama yang tidak lolos validasi tidak bisa dikelola, jadi tidak ditampilkan
        return sorted(
            p.name
            for p in self.available.iterdir()
            if _FILENAME_RE.fullmatch(p.name) and not p.name.startswith(".") and p.is_file()
        )

    def read(self, name: str) -> str:
        path = self._path(name)
        if not path.is_file():
            raise _not_found()
        return path.read_text(encoding="utf-8")

    def _temp_file(self, content: str) -> str:
        fd, tmp = tempfile.mkstemp(dir=self.available, prefix=".tmp-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, 0o644)
        except BaseException:
            os.unlink(tmp)
            raise
        return tmp

    def create(self, name: str, content: str) -> None:
        path = self._path(name)
        tmp = self._temp_file(content)
        try:
            os.link(tmp, path)  # gagal jika sudah ada: pembuatan eksklusif dan atomik
        except FileExistsError:
            raise AppError(400, "FILE_EXISTS", "Berkas dengan nama itu sudah ada.") from None
        finally:
            os.unlink(tmp)

    def write(self, name: str, content: str) -> None:
        path = self._path(name)
        if not path.is_file():
            raise _not_found()
        tmp = self._temp_file(content)
        try:
            os.replace(tmp, path)
        except BaseException:
            os.unlink(tmp)
            raise

    def delete(self, name: str) -> None:
        path = self._path(name)
        if not path.is_file():
            raise _not_found()
        # symlink dulu agar nginx tidak pernah menemui link menggantung
        self.disable(name)
        path.unlink()

    def _link(self, name: str) -> Path:
        validate_filename(name)
        return self.enabled / name

    def is_enabled(self, name: str) -> bool:
        link = self._link(name)
        target = self._path(name)
        return link.is_symlink() and os.path.realpath(link) == os.path.realpath(target)

    def enable(self, name: str) -> None:
        target = self._path(name)
        if not target.is_file():
            raise _not_found()
        if self.is_enabled(name):
            return
        link = self._link(name)
        if os.path.lexists(link):
            raise AppError(
                400, "SYMLINK_CONFLICT", "Sudah ada entri lain dengan nama itu di sites-enabled."
            )
        os.symlink(target, link)

    def disable(self, name: str) -> None:
        link = self._link(name)
        if link.is_symlink():
            link.unlink()
        elif os.path.lexists(link):
            raise AppError(
                400, "SYMLINK_CONFLICT", "Entri di sites-enabled bukan symlink; tidak dihapus."
            )
