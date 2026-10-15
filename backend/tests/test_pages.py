import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, follow_redirects=False)


@pytest.mark.parametrize("path", ["/sites", "/editor/new", "/editor/12"])
def test_pages_served(path):
    r = client.get(path)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")


def test_root_redirects_to_sites():
    r = client.get("/")
    assert r.status_code in (302, 307) and r.headers["location"] == "/sites"


def test_static_assets_served():
    assert client.get("/static/app.css").status_code == 200
    assert client.get("/static/common.js").status_code == 200


def test_editor_rejects_non_numeric_id():
    assert client.get("/editor/abc").status_code == 404


def test_static_no_traversal():
    assert client.get("/static/../../backend/.env").status_code in (400, 404)
    assert client.get("/static/%2e%2e/%2e%2e/backend/.env").status_code in (400, 404)
