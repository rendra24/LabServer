import logging
import subprocess

from app.config import get_settings

logger = logging.getLogger("app")

SYNTAX_INVALID = "Sintaks tidak valid"
_TIMEOUT = 10


def _run(argv: list[str]) -> subprocess.CompletedProcess | None:
    # argv tetap dan tanpa shell; "-n" agar sudo gagal cepat, bukan menunggu password.
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=_TIMEOUT)
    except subprocess.TimeoutExpired:
        logger.warning("perintah melewati batas waktu: %s", argv)
    except OSError:
        logger.exception("perintah tidak dapat dijalankan: %s", argv)
    return None


def run_nginx_test() -> dict:
    s = get_settings()
    argv = [s.sudo_bin, "-n", s.nginx_bin, "-t"]
    proc = _run(argv)
    if proc is None:
        stderr = "Perintah nginx -t tidak dapat dijalankan atau melewati batas waktu."
        return {"is_success": False, "stdout": "", "stderr": stderr, "returncode": -1}
    return {
        "is_success": proc.returncode == 0,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "returncode": proc.returncode,
    }


def reload_nginx_safe() -> tuple[str, bool]:
    """Reload hanya setelah nginx -t lolos; pengecekan selalu dijalankan ulang di sini."""
    test = run_nginx_test()
    if not test["is_success"]:
        return f"{SYNTAX_INVALID}; reload dibatalkan.\n{test['stderr']}".strip(), False
    s = get_settings()
    proc = _run([s.sudo_bin, "-n", s.systemctl_bin, "reload", "nginx"])
    if proc is None or proc.returncode != 0:
        detail = proc.stderr.strip() if proc else "perintah tidak dapat dijalankan"
        return f"Reload Nginx gagal. {detail}".strip(), False
    return "Nginx berhasil di-reload.", True
