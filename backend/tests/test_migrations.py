import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError


def _idx(engine, table):
    return {i["name"] for i in inspect(engine).get_indexes(table)}


def test_upgrade_creates_tables_and_indexes(migrated_engine):
    insp = inspect(migrated_engine)
    assert {"sites", "test_profiles", "audit_logs"} <= set(insp.get_table_names())
    assert {"idx_sites_filename", "idx_sites_is_enabled"} <= _idx(migrated_engine, "sites")
    assert "idx_test_profiles_site_id" in _idx(migrated_engine, "test_profiles")
    assert {
        "idx_audit_logs_site_id",
        "idx_audit_logs_created_at",
        "idx_audit_logs_action_type",
    } <= _idx(migrated_engine, "audit_logs")
    assert "uq_sites_filename" in {
        u["name"] for u in insp.get_unique_constraints("sites")
    }


def test_downgrade_drops_all(alembic_cfg, migrated_engine):
    command.downgrade(alembic_cfg, "base")
    tables = set(inspect(migrated_engine).get_table_names())
    assert not tables & {"sites", "test_profiles", "audit_logs"}


def _site(c, name="a"):
    return c.execute(
        text("INSERT INTO sites (filename, domain_name) VALUES (:f, 'd') RETURNING id"),
        {"f": name},
    ).scalar_one()


def test_filename_unique(migrated_engine):
    with pytest.raises(IntegrityError), migrated_engine.begin() as c:
        _site(c)
        _site(c)


@pytest.mark.parametrize("port", [0, 65536])
def test_port_check(migrated_engine, port):
    with pytest.raises(IntegrityError), migrated_engine.begin() as c:
        sid = _site(c)
        c.execute(
            text(
                "INSERT INTO test_profiles (site_id, target_domain, resolve_ip, port)"
                " VALUES (:s, 'x', '127.0.0.1', :p)"
            ),
            {"s": sid, "p": port},
        )


def test_defaults(migrated_engine):
    with migrated_engine.begin() as c:
        sid = _site(c)
        enabled = c.execute(text("SELECT is_enabled FROM sites WHERE id=:i"), {"i": sid}).scalar()
        assert enabled is False
        c.execute(
            text(
                "INSERT INTO test_profiles (site_id, target_domain, resolve_ip)"
                " VALUES (:s,'x','::1')"
            ),
            {"s": sid},
        )
        assert c.execute(text("SELECT port FROM test_profiles")).scalar() == 80


def test_site_delete_cascades_profiles_and_nulls_audit(migrated_engine):
    with migrated_engine.begin() as c:
        sid = _site(c)
        c.execute(
            text(
                "INSERT INTO test_profiles (site_id, target_domain, resolve_ip)"
                " VALUES (:s,'x','127.0.0.1')"
            ),
            {"s": sid},
        )
        c.execute(
            text(
                "INSERT INTO audit_logs (site_id, action_type, command_executed, is_success)"
                " VALUES (:s, 'NGINX_TEST', 'nginx -t', true)"
            ),
            {"s": sid},
        )
        c.execute(text("DELETE FROM sites WHERE id=:s"), {"s": sid})
        assert c.execute(text("SELECT count(*) FROM test_profiles")).scalar() == 0
        assert c.execute(text("SELECT site_id FROM audit_logs")).scalar() is None
