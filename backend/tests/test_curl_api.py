import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from sqlalchemy import text

from app.services import curl_service
from tests.test_sites_api import _create


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("X-Host-Seen", self.headers.get("Host", ""))
        self.send_header("X-Custom-Seen", self.headers.get("X-Custom", ""))
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


@pytest.fixture
def local_server(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(curl_service.get_settings(), "curl_allowed_ports", str(port))
    yield port
    srv.shutdown()


def _body(port, **over):
    return {
        "target_domain": "app.local",
        "resolve_ip": "127.0.0.1",
        "port": port,
        "protocol": "HTTP",
        "custom_headers": {"Host": "app.local", "X-Custom": "hello"},
        **over,
    }


def test_curl_test_real_curl_with_resolve_and_custom_headers(client, local_server):
    r = client.post("/api/v1/curl/test", json=_body(local_server))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["is_success"] is True and d["status_code"] == 200
    assert d["headers"]["X-Host-Seen"] == "app.local"  # custom Host header terkirim
    assert d["headers"]["X-Custom-Seen"] == "hello"
    assert d["ttfb_ms"] >= 0 and d["total_ms"] >= d["ttfb_ms"]
    assert f"--resolve app.local:{local_server}:127.0.0.1" in d["command"]
    assert d["raw_output"].startswith("HTTP/1.0 200") or d["raw_output"].startswith("HTTP/1.")


def test_curl_test_resolve_bypasses_dns(client, local_server):
    r = client.post("/api/v1/curl/test", json=_body(local_server, custom_headers=None))
    assert r.json()["status_code"] == 200  # app.local tidak ada di DNS; --resolve yang membuatnya jalan


def test_curl_test_connection_refused_is_reported_not_500(client, monkeypatch):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        closed = s.getsockname()[1]
    monkeypatch.setattr(curl_service.get_settings(), "curl_allowed_ports", str(closed))
    r = client.post("/api/v1/curl/test", json=_body(closed))
    assert r.status_code == 200
    d = r.json()
    assert d["is_success"] is False and d["status_code"] == 0 and "ditolak" in d["error"]


def test_curl_test_disallowed_port_400(client):
    r = client.post("/api/v1/curl/test", json=_body(5432))
    assert r.status_code == 400 and r.json()["error"]["code"] == "PORT_NOT_ALLOWED"


def test_curl_test_link_local_blocked(client, local_server):
    r = client.post("/api/v1/curl/test", json=_body(local_server, resolve_ip="169.254.169.254"))
    assert r.status_code == 400 and r.json()["error"]["code"] == "TARGET_NOT_ALLOWED"


@pytest.mark.parametrize(
    "over",
    [
        {"target_domain": "a;id"},
        {"resolve_ip": "nope"},
        {"protocol": "FTP"},
        {"custom_headers": {"X": "a\r\nB: c"}},
        {"port": 0},
    ],
)
def test_curl_test_validation_422(client, over):
    r = client.post("/api/v1/curl/test", json={**_body(80), **over})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


# --- profiles -------------------------------------------------------------------------------
def _profile(site_id, **over):
    return {
        "site_id": site_id,
        "target_domain": "app.local",
        "resolve_ip": "127.0.0.1",
        "port": 80,
        "custom_headers": {"Host": "app.local"},
        **over,
    }


def test_profile_create_list_filter(client, migrated_engine):
    s1 = _create(client, filename="a").json()["id"]
    s2 = _create(client, filename="b").json()["id"]
    r = client.post("/api/v1/profiles", json=_profile(s1))
    assert r.status_code == 201
    p = r.json()
    assert p["site_id"] == s1 and p["custom_headers"] == {"Host": "app.local"} and p["port"] == 80
    client.post("/api/v1/profiles", json=_profile(s2, custom_headers=None))
    assert len(client.get("/api/v1/profiles").json()) == 2
    only = client.get(f"/api/v1/profiles?site_id={s2}").json()
    assert len(only) == 1 and only[0]["custom_headers"] is None
    with migrated_engine.connect() as c:
        raw = c.execute(text("SELECT custom_headers FROM test_profiles ORDER BY id")).scalar()
    assert json.loads(raw) == {"Host": "app.local"}  # disimpan sebagai string JSON


def test_profile_unknown_site_404(client):
    r = client.post("/api/v1/profiles", json=_profile(99999))
    assert r.status_code == 404 and r.json()["error"]["code"] == "SITE_NOT_FOUND"


@pytest.mark.parametrize(
    "over", [{"port": 0}, {"port": 70000}, {"resolve_ip": "x"}, {"target_domain": "a b"}, {"resolve_ip": None}]
)
def test_profile_validation_422(client, over):
    sid = _create(client).json()["id"]
    assert client.post("/api/v1/profiles", json=_profile(sid, **over)).status_code == 422


def test_profile_list_tolerates_seed_json(client, migrated_engine):
    sid = _create(client).json()["id"]
    with migrated_engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO test_profiles (site_id, target_domain, resolve_ip, port, custom_headers)"
                " VALUES (:s, 'x.local', '127.0.0.1', 80, 'bukan json')"
            ),
            {"s": sid},
        )
    r = client.get("/api/v1/profiles")
    assert r.status_code == 200 and r.json()[0]["custom_headers"] is None
