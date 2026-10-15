from sqlalchemy import Engine, create_engine

from app.config import get_settings

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        # pre_ping: koneksi mati (restart Postgres) dipulihkan otomatis
        _engine = create_engine(
            get_settings().database_url, pool_size=5, max_overflow=5, pool_pre_ping=True
        )
    return _engine
