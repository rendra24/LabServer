import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from dotenv import dotenv_values
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parent.parent


def _test_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL") or dotenv_values(ROOT / ".env").get(
        "TEST_DATABASE_URL"
    )
    if not url:
        pytest.skip("TEST_DATABASE_URL tidak diset")
    return url


@pytest.fixture
def alembic_cfg() -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", _test_url().replace("%", "%%"))
    return cfg


@pytest.fixture
def test_engine():
    engine = create_engine(_test_url())
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE"))
        c.execute(text("CREATE SCHEMA public"))
    yield engine
    engine.dispose()


@pytest.fixture
def migrated_engine(alembic_cfg, test_engine):
    command.upgrade(alembic_cfg, "head")
    return test_engine
