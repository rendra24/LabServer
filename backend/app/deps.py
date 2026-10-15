from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_engine
from app.services.file_service import FileService


def get_session(engine: Annotated[Engine, Depends(get_engine)]) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def get_file_service() -> FileService:
    s = get_settings()
    return FileService(s.nginx_available_dir, s.nginx_enabled_dir)


DbSession = Annotated[Session, Depends(get_session)]
Files = Annotated[FileService, Depends(get_file_service)]
