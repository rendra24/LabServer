import os

import pytest

from app.errors import AppError
from app.services.file_service import FileService, parse_server_name


@pytest.fixture
def fs(tmp_path):
    av, en = tmp_path / "available", tmp_path / "enabled"
    av.mkdir()
    en.mkdir()
    return FileService(av, en)


def code(excinfo):
    return excinfo.value.code


@pytest.mark.parametrize(
    "name",
    ["../etc/passwd", "a/b", "a\\b", "..", ".", ".hidden", "a b", "a\0b", "", "x" * 256, "é"],
)
def test_invalid_filenames_rejected(fs, name):
    for op in (fs.read, fs.delete, fs.exists, fs.is_enabled, fs.enable, fs.disable):
        with pytest.raises(AppError) as e:
            op(name)
        assert code(e) == "INVALID_FILENAME" and e.value.status == 400
    with pytest.raises(AppError):
        fs.create(name, "x")


def test_create_read_write_roundtrip(fs):
    fs.create("app.local", "server {}")
    assert fs.read("app.local") == "server {}"
    fs.write("app.local", "server { listen 80; }")
    assert fs.read("app.local") == "server { listen 80; }"
    assert oct(os.stat(fs.available / "app.local").st_mode & 0o777) == "0o644"


def test_create_existing_fails_and_keeps_content(fs):
    fs.create("a", "one")
    with pytest.raises(AppError) as e:
        fs.create("a", "two")
    assert code(e) == "FILE_EXISTS"
    assert fs.read("a") == "one"


def test_write_missing_file_is_404(fs):
    with pytest.raises(AppError) as e:
        fs.write("nope", "x")
    assert code(e) == "FILE_NOT_FOUND" and e.value.status == 404


def test_read_missing_is_404(fs):
    with pytest.raises(AppError) as e:
        fs.read("nope")
    assert e.value.status == 404


def test_no_temp_files_left(fs):
    fs.create("a", "1")
    fs.write("a", "2")
    assert sorted(p.name for p in fs.available.iterdir()) == ["a"]


def test_list_files_skips_dirs_and_dotfiles(fs):
    fs.create("b", "1")
    fs.create("a", "1")
    (fs.available / "subdir").mkdir()
    (fs.available / ".swp").write_text("x")
    assert fs.list_files() == ["a", "b"]


def test_symlink_pointing_outside_root_rejected(fs, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    (fs.available / "evil").symlink_to(secret)
    with pytest.raises(AppError) as e:
        fs.read("evil")
    assert code(e) == "PATH_OUTSIDE_ROOT"
    with pytest.raises(AppError):
        fs.write("evil", "overwrite")
    assert secret.read_text() == "top secret"


def test_enable_disable_symlink(fs):
    fs.create("a", "x")
    assert fs.is_enabled("a") is False
    fs.enable("a")
    link = fs.enabled / "a"
    assert link.is_symlink() and os.path.realpath(link) == os.path.realpath(fs.available / "a")
    assert fs.is_enabled("a") is True
    fs.enable("a")  # idempoten
    fs.disable("a")
    assert not link.exists() and not link.is_symlink()
    assert fs.is_enabled("a") is False
    fs.disable("a")  # idempoten


def test_enable_missing_file_404(fs):
    with pytest.raises(AppError) as e:
        fs.enable("nope")
    assert code(e) == "FILE_NOT_FOUND"


def test_enable_refuses_to_clobber_foreign_entries(fs):
    fs.create("a", "x")
    (fs.enabled / "a").write_text("foreign regular file")
    with pytest.raises(AppError) as e:
        fs.enable("a")
    assert code(e) == "SYMLINK_CONFLICT"
    with pytest.raises(AppError):
        fs.disable("a")
    assert (fs.enabled / "a").read_text() == "foreign regular file"


def test_link_to_other_target_is_not_enabled(fs, tmp_path):
    fs.create("a", "x")
    other = tmp_path / "other"
    other.write_text("y")
    (fs.enabled / "a").symlink_to(other)
    assert fs.is_enabled("a") is False
    with pytest.raises(AppError) as e:
        fs.enable("a")
    assert code(e) == "SYMLINK_CONFLICT"


def test_delete_removes_symlink_first_then_file(fs):
    fs.create("a", "x")
    fs.enable("a")
    fs.delete("a")
    assert not (fs.enabled / "a").is_symlink()
    assert not fs.exists("a")


def test_delete_missing_404(fs):
    with pytest.raises(AppError) as e:
        fs.delete("nope")
    assert e.value.status == 404


def test_parse_server_name():
    conf = (
        "# server_name commented.com;\nserver {\n  listen 80;\n"
        "  server_name  app.local www.app.local;\n}"
    )
    assert parse_server_name(conf) == "app.local"
    assert parse_server_name("server { listen 80; }") is None
