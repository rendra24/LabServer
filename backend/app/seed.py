"""Seed data contoh sesuai DATABASE.md. Idempoten: aman dijalankan berulang.

Jalankan: python -m app.seed
"""
from sqlalchemy import Engine, create_engine, text

from app.config import get_settings

_SITES = [
    ("default", "localhost", True),
    ("app-php83.local", "app-php83.local", True),
    ("legacy-php74.local", "legacy-php74.local", False),
]
_PROFILES = [
    ("app-php83.local", '{"Host": "app-php83.local"}'),
    ("legacy-php74.local", '{"Host": "legacy-php74.local"}'),
]
_NGINX_OK = (
    "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n"
    "nginx: configuration file /etc/nginx/nginx.conf test is successful"
)


def seed(engine: Engine) -> None:
    with engine.begin() as c:
        for filename, domain, enabled in _SITES:
            c.execute(
                text(
                    "INSERT INTO sites (filename, domain_name, is_enabled)"
                    " VALUES (:f, :d, :e) ON CONFLICT (filename) DO NOTHING"
                ),
                {"f": filename, "d": domain, "e": enabled},
            )
        for domain, headers in _PROFILES:
            c.execute(
                text(
                    "INSERT INTO test_profiles (site_id, target_domain, resolve_ip, port,"
                    " custom_headers)"
                    " SELECT id, CAST(:d AS VARCHAR), '127.0.0.1', 80, :h FROM sites"
                    " WHERE filename = :d"
                    " AND NOT EXISTS (SELECT 1 FROM test_profiles WHERE site_id = sites.id"
                    " AND target_domain = :d)"
                ),
                {"d": domain, "h": headers},
            )
        c.execute(
            text(
                "INSERT INTO audit_logs (site_id, action_type, command_executed,"
                " execution_output, is_success)"
                " SELECT id, 'NGINX_TEST', 'nginx -t', :o, true FROM sites"
                " WHERE filename = 'app-php83.local'"
                " AND NOT EXISTS (SELECT 1 FROM audit_logs)"
            ),
            {"o": _NGINX_OK},
        )


if __name__ == "__main__":
    engine = create_engine(get_settings().database_url)
    seed(engine)
    engine.dispose()
    print("Seed selesai.")
