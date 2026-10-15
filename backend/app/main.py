import logging
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.database import get_engine

logger = logging.getLogger("app")

app = FastAPI(title="Dashboard Server", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/api/health")
def health(engine: Annotated[Engine, Depends(get_engine)]):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception("health check: database tidak dapat dijangkau")
        return JSONResponse(
            {"status": "error", "database": "unavailable"}, status_code=503
        )
    return {"status": "ok", "database": "ok"}
