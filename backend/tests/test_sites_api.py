import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

CONF = "server {\n    listen 80;\n    server_name app.local;\n}\n"


def _create(client, filename="app.local", content=CONF, domain="app.local"):
    return client.post(
        "/api/v1/sites", json={"filename": filename, "content": content, "domain_name": domain}
    )


def test_create_and_get_detail(client, fs):
    r = _create(client)
    assert r.status_code == 201
    body = r.json()
    assert body["filename"] == "app.local" and body["is_enabled"] is False
    assert body["file_exists"] is True and "content" not in body
    assert fs.read("app.local") == CONF
    d = client.get(f"/api/v1/sites/{body['id']}")
    assert d.status_code == 200 and d.json()["content"] == CONF


@pytest.mark.parametrize(
    "payload",
    [
        {"filename": "../etc/passwd", "content": "x", "domain_name": "a.local"},
        {"filename": "a b", "content": "x", "domain_name": "a.local"},
        {"filename": ".hidden", "content": "x", "domain_name": "a.local"},
        {"filename": "a", "content": "", "domain_name": "a.local"},
        {"filename": "a", "content": "x\0y", "domain_name": "a.local"},
        {"filename": "a", "content": "x", "domain_name": "bad domain;"},
        {"filename": "a", "content": "x"},
    ],
)
def test_create_validation_422_standard_error(client, fs, payload):
    r = client.post("/api/v1/sites", json=payload)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR" and err["message"]
    assert fs.list_files() == []


def test_create_duplicate_keeps_original(client, fs):
    _create(client)
    r = _create(client, content="other")
    assert r.status_code == 400 and r.json()["error"]["code"] == "FILE_EXISTS"
    assert fs.read("app.local") == CONF


def test_create_adopts_existing_row_without_file(client, fs, migrated_engine):
    with migrated_engine.begin() as c:
        c.execute(text("INSERT INTO sites (filename, domain_name) VALUES ('seeded', 'old.local')"))
    r = _create(client, filename="seeded", domain="new.local")
    assert r.status_code == 201 and r.json()["domain_name"] == "new.local"
    with migrated_engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM sites WHERE filename='seeded'")).scalar() == 1


def test_update_content_and_domain(client, fs):
    sid = _create(client).json()["id"]
    r = client.put(f"/api/v1/sites/{sid}", json={"content": "server { }", "domain_name": "b.local"})
    assert r.status_code == 200
    assert r.json()["content"] == "server { }" and r.json()["domain_name"] == "b.local"
    assert fs.read("app.local") == "server { }"
    r = client.put(f"/api/v1/sites/{sid}", json={"content": "server { listen 81; }"})
    assert r.json()["domain_name"] == "b.local"


def test_toggle_on_off_follows_symlink(client, fs):
    sid = _create(client).json()["id"]
    r = client.post(f"/api/v1/sites/{sid}/toggle")
    assert r.status_code == 200 and r.json()["is_enabled"] is True
    assert fs.is_enabled("app.local")
    r = client.post(f"/api/v1/sites/{sid}/toggle")
    assert r.json()["is_enabled"] is False and not fs.is_enabled("app.local")


def test_delete_removes_file_symlink_and_row(client, fs):
    sid = _create(client).json()["id"]
    client.post(f"/api/v1/sites/{sid}/toggle")
    r = client.delete(f"/api/v1/sites/{sid}")
    assert r.status_code == 204 and r.content == b""
    assert not fs.exists("app.local") and not (fs.enabled / "app.local").is_symlink()
    assert client.get(f"/api/v1/sites/{sid}").status_code == 404
    assert client.delete(f"/api/v1/sites/{sid}").status_code == 404


def test_unknown_id_404_standard_error(client):
    r = client.get("/api/v1/sites/99999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "SITE_NOT_FOUND"
    assert client.put("/api/v1/sites/99999", json={"content": "x"}).status_code == 404
    assert client.post("/api/v1/sites/99999/toggle").status_code == 404


def test_list_imports_untracked_and_syncs_symlink(client, fs):
    fs.create("manual.local", "server {\n server_name manual.example.com;\n}\n")
    fs.create("weird", "no server name here")
    fs.enable("manual.local")
    r = client.get("/api/v1/sites")
    assert r.status_code == 200 and r.json()["total"] == 2
    by_name = {s["filename"]: s for s in r.json()["items"]}
    assert by_name["manual.local"]["domain_name"] == "manual.example.com"
    assert by_name["manual.local"]["is_enabled"] is True
    assert by_name["weird"]["domain_name"] == "weird"
    fs.disable("manual.local")  # diubah di luar dashboard
    again = {s["filename"]: s for s in client.get("/api/v1/sites").json()["items"]}
    assert again["manual.local"]["is_enabled"] is False


def test_list_keeps_rows_without_file(client, migrated_engine):
    with migrated_engine.begin() as c:
        c.execute(text("INSERT INTO sites (filename, domain_name) VALUES ('ghost', 'ghost.local')"))
    items = client.get("/api/v1/sites").json()["items"]
    ghost = next(s for s in items if s["filename"] == "ghost")
    assert ghost["file_exists"] is False
    r = client.get(f"/api/v1/sites/{ghost['id']}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "FILE_NOT_FOUND"
    assert client.post(f"/api/v1/sites/{ghost['id']}/toggle").status_code == 404


def test_list_pagination(client, fs):
    for n in ("a", "b", "c"):
        fs.create(n, "x")
    r = client.get("/api/v1/sites?limit=2&offset=1").json()
    assert r["total"] == 3 and [s["filename"] for s in r["items"]] == ["b", "c"]
    assert client.get("/api/v1/sites?limit=0").status_code == 422


def test_create_rolls_back_file_when_db_commit_fails(client, fs, monkeypatch):
    def boom(self):
        raise RuntimeError("db down: secret-host")

    monkeypatch.setattr(Session, "commit", boom)
    r = _create(client)
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL_ERROR" and "secret-host" not in r.text
    assert fs.list_files() == []


def test_update_restores_file_when_db_commit_fails(client, fs, monkeypatch):
    sid = _create(client).json()["id"]
    monkeypatch.setattr(Session, "commit", lambda self: (_ for _ in ()).throw(RuntimeError("x")))
    r = client.put(f"/api/v1/sites/{sid}", json={"content": "changed"})
    assert r.status_code == 500
    assert fs.read("app.local") == CONF


def test_delete_restores_file_and_symlink_when_db_commit_fails(client, fs, monkeypatch):
    sid = _create(client).json()["id"]
    client.post(f"/api/v1/sites/{sid}/toggle")
    monkeypatch.setattr(Session, "commit", lambda self: (_ for _ in ()).throw(RuntimeError("x")))
    assert client.delete(f"/api/v1/sites/{sid}").status_code == 500
    assert fs.read("app.local") == CONF and fs.is_enabled("app.local")


def test_toggle_reverts_symlink_when_db_commit_fails(client, fs, monkeypatch):
    sid = _create(client).json()["id"]
    monkeypatch.setattr(Session, "commit", lambda self: (_ for _ in ()).throw(RuntimeError("x")))
    assert client.post(f"/api/v1/sites/{sid}/toggle").status_code == 500
    assert not fs.is_enabled("app.local")


def test_delete_row_without_file_also_removes_dangling_symlink(client, fs):
    sid = _create(client).json()["id"]
    client.post(f"/api/v1/sites/{sid}/toggle")
    (fs.available / "app.local").unlink()  # berkas hilang di luar dashboard
    assert (fs.enabled / "app.local").is_symlink()  # link menggantung bikin nginx -t gagal
    assert client.delete(f"/api/v1/sites/{sid}").status_code == 204
    assert not (fs.enabled / "app.local").is_symlink()
