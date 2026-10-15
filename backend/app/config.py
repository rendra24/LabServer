from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    nginx_available_dir: Path = Path("/etc/nginx/sites-available")
    nginx_enabled_dir: Path = Path("/etc/nginx/sites-enabled")
    # Path binary tetap sesuai BACKEND.md; env hanya untuk dev/tes di mesin non-Debian.
    sudo_bin: str = "sudo"
    nginx_bin: str = "/usr/sbin/nginx"
    systemctl_bin: str = "/bin/systemctl"
    curl_bin: str = "/usr/bin/curl"
    # Batas SSRF untuk Curl Tester (PERMISSIONS.md), dipisah koma.
    curl_allowed_ports: str = "80,443,8080,8443,8000"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
