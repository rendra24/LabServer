from unittest.mock import patch

from sqlalchemy import text

from app.services import system_service as ss
from tests.test_sites_api import _create

OK = {
    "is_success": True,
    "stdout": "",
    "stderr": "syntax is ok\ntest is successful",
    "returncode": 0,
}
BAD = {
    "is_success": False,
    "stdout": "",
    "stderr": '[emerg] unknown directive "bogus" in /etc/nginx/sites-enabled/x:3',
    "returncode": 1,
}


def _logs(engine):
    with engine.connect() as c:
        return c.execute(
            text(
                "SELECT site_id, action_type, command_executed, execution_output, is_success"
                " FROM audit_logs ORDER BY id"
            )
        ).all()


def _patch_test(result):
    return patch("app.routers.nginx.system_service.run_nginx_test", return_value=result)


def test_nginx_test_ok_is_audited(client, migrated_engine):
    with _patch_test(OK):
        r = client.post("/api/v1/nginx/test")
    assert r.status_code == 200
    assert r.json() == {"is_success": True, "stdout": "", "stderr": OK["stderr"]}
    (log,) = _logs(migrated_engine)
    assert log[0] is None and log[1] == "NGINX_TEST" and log[2] == "nginx -t"
    assert "test is successful" in log[3] and log[4] is True


def test_nginx_test_invalid_syntax_is_200_with_failure_flag(client, migrated_engine):
    with _patch_test(BAD):
        r = client.post("/api/v1/nginx/test", json={})
    assert r.status_code == 200 and r.json()["is_success"] is False
    assert "unknown directive" in r.json()["stderr"]
    assert _logs(migrated_engine)[0][4] is False


def test_nginx_test_with_site_id_links_audit(client, migrated_engine):
    sid = _create(client).json()["id"]
    with _patch_test(OK):
        client.post("/api/v1/nginx/test", json={"site_id": sid})
    assert _logs(migrated_engine)[-1][0] == sid


def test_nginx_test_unknown_site_404_and_not_executed(client):
    with _patch_test(OK) as run:
        r = client.post("/api/v1/nginx/test", json={"site_id": 99999})
    assert r.status_code == 404 and r.json()["error"]["code"] == "SITE_NOT_FOUND"
    run.assert_not_called()


def test_nginx_test_rejects_bad_site_id_type(client):
    assert client.post("/api/v1/nginx/test", json={"site_id": "x"}).status_code == 422


def test_reload_blocked_on_invalid_syntax(client, migrated_engine):
    msg = f"{ss.SYNTAX_INVALID}; reload dibatalkan.\n{BAD['stderr']}"
    with patch("app.routers.nginx.system_service.reload_nginx_safe", return_value=(msg, False)):
        r = client.post("/api/v1/nginx/reload")
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "INVALID_SYNTAX" and "unknown directive" in err["details"]
    (log,) = _logs(migrated_engine)
    assert log[1] == "NGINX_RELOAD" and log[4] is False and "unknown directive" in log[3]


def test_reload_success(client, migrated_engine):
    with patch(
        "app.routers.nginx.system_service.reload_nginx_safe",
        return_value=("Nginx berhasil di-reload.", True),
    ):
        r = client.post("/api/v1/nginx/reload")
    assert r.status_code == 200
    assert r.json() == {"is_success": True, "message": "Nginx berhasil di-reload."}
    log = _logs(migrated_engine)[0]
    assert log[1] == "NGINX_RELOAD" and log[2] == "systemctl reload nginx" and log[4] is True


def test_reload_command_failure_is_500_with_audit(client, migrated_engine):
    with patch(
        "app.routers.nginx.system_service.reload_nginx_safe",
        return_value=("Reload Nginx gagal. Failed to reload", False),
    ):
        r = client.post("/api/v1/nginx/reload")
    assert r.status_code == 500 and r.json()["error"]["code"] == "RELOAD_FAILED"
    assert _logs(migrated_engine)[0][4] is False
