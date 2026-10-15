import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.database import get_engine
from app.errors import AppError
from app.routers import nginx, pages, sites

logger = logging.getLogger("app")

app = FastAPI(title="Dashboard Server", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(sites.router)
app.include_router(nginx.router)
app.include_router(pages.router)
app.mount("/static", StaticFiles(directory=pages.FRONTEND_DIR / "static"), name="static")


def _error(status: int, code: str, message: str, details: str | None = None) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, "details": details}}, status_code=status
    )


@app.exception_handler(AppError)
def _app_error(_: Request, exc: AppError):
    return _error(exc.status, exc.code, exc.message, exc.details)


@app.exception_handler(RequestValidationError)
def _validation_error(_: Request, exc: RequestValidationError):
    # hanya lokasi + pesan; nilai input tidak ikut dikembalikan
    details = "; ".join(f"{'.'.join(map(str, e['loc'][1:]))}: {e['msg']}" for e in exc.errors())
    return _error(422, "VALIDATION_ERROR", "Input tidak valid.", details)


@app.exception_handler(Exception)
def _unhandled(_: Request, exc: Exception):
    logger.error("unhandled error", exc_info=exc)
    return _error(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.")


@app.get("/api/health")
def health(engine: Annotated[Engine, Depends(get_engine)]):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception("health check: database tidak dapat dijangkau")
        return JSONResponse({"status": "error", "database": "unavailable"}, status_code=503)
    return {"status": "ok", "database": "ok"}
