import pytest
from sqlalchemy import text

from app.services import audit_service as a
from tests.test_sites_api import _create


@pytest.fixture
def seeded(client, migrated_engine):
    s1 = _create(client, filename="one").json()["id"]
    s2 = _create(client, filename="two").json()["id"]
    with migrated_engine.begin() as c:
        c.execute(text("DELETE FROM audit_logs"))
        for i, (site, action, ok) in enumerate(
            [
                (s1, a.CONFIG_SAVE, True),
                (s1, a.NGINX_TEST, False),
                (s2, a.CURL_TEST, True),
                (None, a.NGINX_RELOAD, True),
            ]
        ):
            c.execute(
                text(
                    "INSERT INTO audit_logs (site_id, action_type, command_executed,"
                    " execution_output, is_success, created_at)"
                    " VALUES (:s, :a, :c, :o, :ok, now() + make_interval(secs => :i))"
                ),
                {"s": site, "a": action, "c": f"cmd {i}", "o": f"FULL OUTPUT {i}\n" * 3, "ok": ok, "i": i},
            )
    return s1, s2


def test_list_newest_first_with_site_name_and_full_output(client, seeded):
    s1, _ = seeded
    r = client.get("/api/v1/audit-logs")
    assert r.status_code == 200
    d = r.json()
    assert d["total"] == 4
    assert [x["command_executed"] for x in d["items"]] == ["cmd 3", "cmd 2", "cmd 1", "cmd 0"]
    first_site = d["items"][2]
    assert first_site["site_id"] == s1 and first_site["site_filename"] == "one"
    assert d["items"][0]["site_filename"] is None
    assert d["items"][3]["execution_output"] == "FULL OUTPUT 0\n" * 3  # tanpa pemotongan
    assert set(first_site) == {
        "id", "site_id", "site_filename", "action_type", "command_executed",
        "execution_output", "is_success", "created_at",
    }


def test_filters(client, seeded):
    s1, s2 = seeded
    assert client.get("/api/v1/audit-logs?action_type=NGINX_TEST").json()["total"] == 1
    assert client.get(f"/api/v1/audit-logs?site_id={s1}").json()["total"] == 2
    assert client.get("/api/v1/audit-logs?is_success=false").json()["total"] == 1
    assert client.get("/api/v1/audit-logs?is_success=true").json()["total"] == 3
    r = client.get(f"/api/v1/audit-logs?site_id={s1}&is_success=true").json()
    assert r["total"] == 1 and r["items"][0]["action_type"] == "CONFIG_SAVE"
    assert client.get("/api/v1/audit-logs?action_type=NOPE").json() == {"items": [], "total": 0}


def test_pagination_total_independent_of_page(client, seeded):
    r = client.get("/api/v1/audit-logs?limit=2&offset=1").json()
    assert r["total"] == 4
    assert [x["command_executed"] for x in r["items"]] == ["cmd 2", "cmd 1"]
    assert client.get("/api/v1/audit-logs?limit=0").status_code == 422
    assert client.get("/api/v1/audit-logs?limit=201").status_code == 422
    assert client.get("/api/v1/audit-logs?offset=-1").status_code == 422


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_audit_logs_are_read_only(client, seeded, method):
    assert getattr(client, method)("/api/v1/audit-logs").status_code == 405
    assert getattr(client, method)("/api/v1/audit-logs/1").status_code in (404, 405)
