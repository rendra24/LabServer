from sqlalchemy import text

from tests.test_sites_api import _create


def _logs(engine):
    with engine.connect() as c:
        return c.execute(
            text(
                "SELECT site_id, action_type, command_executed, execution_output, is_success"
                " FROM audit_logs ORDER BY id"
            )
        ).all()


def test_create_update_toggle_delete_are_audited(client, fs, migrated_engine):
    sid = _create(client).json()["id"]
    client.put(f"/api/v1/sites/{sid}", json={"content": "server { }"})
    client.post(f"/api/v1/sites/{sid}/toggle")
    client.post(f"/api/v1/sites/{sid}/toggle")
    assert [entry[0] for entry in _logs(migrated_engine)] == [sid] * 4
    client.delete(f"/api/v1/sites/{sid}")
    logs = _logs(migrated_engine)
    assert [(entry[1]) for entry in logs] == [
        "CONFIG_SAVE",
        "CONFIG_SAVE",
        "SYMLINK_TOGGLE",
        "SYMLINK_TOGGLE",
        "CONFIG_SAVE",
    ]
    assert all(entry[4] is True for entry in logs)
    assert [entry[0] for entry in logs] == [None] * 5  # FK SET NULL: riwayat tetap ada
    assert all("app.local" in entry[2] for entry in logs)
    assert "created" in logs[0][3] and "updated" in logs[1][3] and "deleted" in logs[4][3]
    assert logs[2][2].startswith("ln -s ") and logs[3][2].startswith("rm ")
    assert logs[2][3] == "symlink enabled" and logs[3][3] == "symlink disabled"


def test_audit_never_stores_file_content(client, migrated_engine):
    _create(client, content="server { # SECRET-TOKEN-123 }")
    assert "SECRET-TOKEN-123" not in repr(_logs(migrated_engine))


def test_rejected_operations_are_not_audited(client, migrated_engine):
    _create(client)
    _create(client)  # FILE_EXISTS
    client.post("/api/v1/sites/99999/toggle")  # 404
    assert len(_logs(migrated_engine)) == 1


def test_listing_import_is_not_audited(client, fs, migrated_engine):
    fs.create("manual", "x")
    client.get("/api/v1/sites")
    assert _logs(migrated_engine) == []


def test_audit_failure_rolls_back_whole_operation(client, fs, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("audit down")

    monkeypatch.setattr("app.routers.sites.audit_service.record", boom)
    assert _create(client).status_code == 500
    assert fs.list_files() == []


