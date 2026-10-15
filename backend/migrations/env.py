from alembic import context
from sqlalchemy import create_engine

from app.config import get_settings

config = context.config


def _url() -> str:
    # URL eksplisit (mis. dari tes) menang atas .env
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_online() -> None:
    engine = create_engine(_url())
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
