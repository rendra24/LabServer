import pytest
from pydantic import ValidationError

from app.config import Settings


def test_database_url_required(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.chdir(tmp_path)  # tanpa .env
    with pytest.raises(ValidationError):
        Settings()


def test_defaults_and_env_override(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h/db")
    monkeypatch.setenv("NGINX_AVAILABLE_DIR", "/tmp/av")
    s = Settings()
    assert str(s.nginx_available_dir) == "/tmp/av"
    assert str(s.nginx_enabled_dir) == "/etc/nginx/sites-enabled"
