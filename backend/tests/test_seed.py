from sqlalchemy import text

from app.seed import seed


def _count(engine, table):
    with engine.connect() as c:
        return c.execute(text(f"SELECT count(*) FROM {table}")).scalar()


def test_seed_populates_prd_data(migrated_engine):
    seed(migrated_engine)
    assert _count(migrated_engine, "sites") == 3
    assert _count(migrated_engine, "test_profiles") == 2
    assert _count(migrated_engine, "audit_logs") == 1
    with migrated_engine.connect() as c:
        enabled = dict(c.execute(text("SELECT filename, is_enabled FROM sites")).all())
        assert enabled == {"default": True, "app-php83.local": True, "legacy-php74.local": False}
        rows = c.execute(
            text(
                "SELECT s.filename, p.resolve_ip, p.port, p.custom_headers FROM test_profiles p"
                " JOIN sites s ON s.id = p.site_id ORDER BY s.filename"
            )
        ).all()
        assert rows == [
            ("app-php83.local", "127.0.0.1", 80, '{"Host": "app-php83.local"}'),
            ("legacy-php74.local", "127.0.0.1", 80, '{"Host": "legacy-php74.local"}'),
        ]
        log = c.execute(
            text(
                "SELECT filename, action_type FROM audit_logs a JOIN sites s ON s.id = a.site_id"
            )
        ).one()
        assert log == ("app-php83.local", "NGINX_TEST")


def test_seed_is_idempotent(migrated_engine):
    seed(migrated_engine)
    seed(migrated_engine)
    assert (_count(migrated_engine, "sites"), _count(migrated_engine, "test_profiles"),
            _count(migrated_engine, "audit_logs")) == (3, 2, 1)
