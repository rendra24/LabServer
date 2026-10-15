import re
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select

from app.deps import DbSession, Files
from app.errors import AppError
from app.models import Site
from app.schemas import (
    DOMAIN_PATTERN,
    SiteCreate,
    SiteDetailResponse,
    SiteList,
    SiteResponse,
    SiteUpdate,
)
from app.services import audit_service
from app.services.file_service import FileService, parse_server_name

router = APIRouter(prefix="/api/v1/sites", tags=["sites"])

_DOMAIN_RE = re.compile(DOMAIN_PATTERN)


def _audit_save(db: DbSession, fs: FileService, site: Site, op: str) -> None:
    done = {"create": "created", "update": "updated", "delete": "deleted"}[op]
    audit_service.record(
        db, site.id, audit_service.CONFIG_SAVE, f"{op} {fs.available / site.filename}",
        f"config {done}",
    )


def _now() -> datetime:
    return datetime.now(UTC)


def _get_or_404(db: DbSession, site_id: int) -> Site:
    site = db.get(Site, site_id)
    if site is None:
        raise AppError(404, "SITE_NOT_FOUND", "Situs tidak ditemukan.")
    return site


def _file_exists(fs: FileService, site: Site) -> bool:
    try:
        return fs.exists(site.filename)
    except AppError:
        return False


def _response(fs: FileService, site: Site) -> SiteResponse:
    return SiteResponse.model_validate(site, from_attributes=True).model_copy(
        update={"file_exists": _file_exists(fs, site)}
    )


def _detail(fs: FileService, site: Site, content: str) -> SiteDetailResponse:
    return SiteDetailResponse(**_response(fs, site).model_dump(), content=content)


def _domain_for(fs: FileService, name: str) -> str:
    try:
        domain = parse_server_name(fs.read(name))
    except (OSError, UnicodeDecodeError, AppError):
        domain = None
    if domain and _DOMAIN_RE.fullmatch(domain) and len(domain) <= 255:
        return domain
    return re.sub(r"[^a-zA-Z0-9.-]", "-", name)


def _sync(db: DbSession, fs: FileService) -> None:
    """Samakan tabel sites dengan disk: impor berkas baru, ikuti status symlink.

    Baris tanpa berkas dipertahankan (lihat DECISIONS #13).
    """
    rows = {s.filename: s for s in db.scalars(select(Site))}
    for name in fs.list_files():
        try:
            enabled = fs.is_enabled(name)
        except AppError:
            continue
        row = rows.get(name)
        if row is None:
            db.add(Site(filename=name, domain_name=_domain_for(fs, name), is_enabled=enabled))
        elif row.is_enabled != enabled:
            row.is_enabled = enabled
    db.commit()


@router.get("", response_model=SiteList)
def list_sites(
    db: DbSession,
    fs: Files,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _sync(db, fs)
    total = db.scalar(select(func.count()).select_from(Site)) or 0
    rows = db.scalars(select(Site).order_by(Site.filename).limit(limit).offset(offset)).all()
    return {"items": [_response(fs, s) for s in rows], "total": total}


@router.post("", response_model=SiteResponse, status_code=201)
def create_site(body: SiteCreate, db: DbSession, fs: Files):
    fs.create(body.filename, body.content)
    try:
        site = db.scalar(select(Site).where(Site.filename == body.filename))
        if site is None:
            site = Site(filename=body.filename, domain_name=body.domain_name, is_enabled=False)
            db.add(site)
        else:  # baris seed tanpa berkas: ambil alih
            site.domain_name = body.domain_name
            site.is_enabled = False
        db.flush()
        _audit_save(db, fs, site, "create")
        db.commit()
    except BaseException:
        db.rollback()
        fs.delete(body.filename)
        raise
    return _response(fs, site)


@router.get("/{site_id}", response_model=SiteDetailResponse)
def get_site(site_id: int, db: DbSession, fs: Files):
    site = _get_or_404(db, site_id)
    content = fs.read(site.filename)
    enabled = fs.is_enabled(site.filename)
    if site.is_enabled != enabled:
        site.is_enabled = enabled
        db.commit()
    return _detail(fs, site, content)


@router.put("/{site_id}", response_model=SiteDetailResponse)
def update_site(site_id: int, body: SiteUpdate, db: DbSession, fs: Files):
    site = _get_or_404(db, site_id)
    old = fs.read(site.filename)
    fs.write(site.filename, body.content)
    try:
        if body.domain_name is not None:
            site.domain_name = body.domain_name
        site.updated_at = _now()
        _audit_save(db, fs, site, "update")
        db.commit()
    except BaseException:
        db.rollback()
        fs.write(site.filename, old)
        raise
    return _detail(fs, site, body.content)


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: int, db: DbSession, fs: Files):
    site = _get_or_404(db, site_id)
    name = site.filename
    has_file = _file_exists(fs, site)
    old = fs.read(name) if has_file else None
    was_enabled = has_file and fs.is_enabled(name)
    try:
        _audit_save(db, fs, site, "delete")
        db.delete(site)
        db.flush()
        if has_file:
            fs.delete(name)
        db.commit()
    except BaseException:
        db.rollback()
        if has_file and not fs.exists(name):
            fs.create(name, old)
            if was_enabled:
                fs.enable(name)
        raise
    return Response(status_code=204)


@router.post("/{site_id}/toggle", response_model=SiteResponse)
def toggle_site_status(site_id: int, db: DbSession, fs: Files):
    site = _get_or_404(db, site_id)
    if not _file_exists(fs, site):
        raise AppError(404, "FILE_NOT_FOUND", "Berkas konfigurasi tidak ditemukan.")
    target = not fs.is_enabled(site.filename)
    (fs.enable if target else fs.disable)(site.filename)
    try:
        site.is_enabled = target
        link, src = fs.enabled / site.filename, fs.available / site.filename
        audit_service.record(
            db,
            site.id,
            audit_service.SYMLINK_TOGGLE,
            f"ln -s {src} {link}" if target else f"rm {link}",
            "symlink enabled" if target else "symlink disabled",
        )
        db.commit()
    except BaseException:
        db.rollback()
        (fs.disable if target else fs.enable)(site.filename)
        raise
    return _response(fs, site)
