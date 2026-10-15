from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

FRONTEND_DIR = Path(__file__).resolve().parents[3] / "frontend"

router = APIRouter(include_in_schema=False)


@router.get("/")
def index():
    return RedirectResponse("/sites")


@router.get("/sites")
def sites_page():
    return FileResponse(FRONTEND_DIR / "sites.html")


@router.get("/editor/new")
@router.get("/editor/{site_id:int}")
def editor_page(site_id: int | None = None):
    return FileResponse(FRONTEND_DIR / "editor.html")
