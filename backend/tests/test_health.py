from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app.database import get_engine
from app.main import app


def _client(engine):
    app.dependency_overrides[get_engine] = lambda: engine
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_health_ok(test_engine):
    r = _client(test_engine).get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}


def test_health_db_down_hides_details():
    bad = create_engine(
        "postgresql+psycopg://nouser:nopw@127.0.0.1:1/none", connect_args={"connect_timeout": 1}
    )
    r = _client(bad).get("/api/health")
    assert r.status_code == 503
    assert r.json() == {"status": "error", "database": "unavailable"}
    assert "nouser" not in r.text and "127.0.0.1" not in r.text
