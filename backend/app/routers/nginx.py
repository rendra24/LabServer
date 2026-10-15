from fastapi import APIRouter

from app.deps import DbSession
from app.errors import AppError
from app.models import Site
from app.schemas import CommandResultResponse, NginxTestRequest, NginxTestResponse
from app.services import audit_service, system_service

router = APIRouter(prefix="/api/v1/nginx", tags=["nginx"])


@router.post("/test", response_model=NginxTestResponse)
def run_nginx_test(db: DbSession, body: NginxTestRequest | None = None):
    site_id = body.site_id if body else None
    if site_id is not None and db.get(Site, site_id) is None:
        raise AppError(404, "SITE_NOT_FOUND", "Situs tidak ditemukan.")
    result = system_service.run_nginx_test()
    audit_service.record(
        db,
        site_id,
        audit_service.NGINX_TEST,
        "nginx -t",
        f"{result['stdout']}{result['stderr']}".strip(),
        result["is_success"],
    )
    db.commit()
    return NginxTestResponse(
        is_success=result["is_success"], stdout=result["stdout"], stderr=result["stderr"]
    )


@router.post("/reload", response_model=CommandResultResponse)
def reload_nginx(db: DbSession):
    message, ok = system_service.reload_nginx_safe()
    audit_service.record(
        db, None, audit_service.NGINX_RELOAD, "systemctl reload nginx", message, ok
    )
    db.commit()
    if ok:
        return CommandResultResponse(is_success=True, message=message)
    if message.startswith(system_service.SYNTAX_INVALID):
        raise AppError(
            400,
            "INVALID_SYNTAX",
            "Konfigurasi Nginx memiliki sintaks tidak valid. Reload dibatalkan.",
            message.split("\n", 1)[1] if "\n" in message else None,
        )
    raise AppError(500, "RELOAD_FAILED", "Reload Nginx gagal.", message)
