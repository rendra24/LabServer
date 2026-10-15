from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.deps import DbSession
from app.models import AuditLog, Site
from app.schemas import AuditLogList, AuditLogResponse

# Hanya GET: log audit bersifat append-only (PERMISSIONS.md).
router = APIRouter(prefix="/api/v1/audit-logs", tags=["audit"])


@router.get("", response_model=AuditLogList)
def list_audit_logs(
    db: DbSession,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    action_type: str | None = Query(None, max_length=50),
    site_id: int | None = None,
    is_success: bool | None = None,
):
    filters = []
    if action_type is not None:
        filters.append(AuditLog.action_type == action_type)
    if site_id is not None:
        filters.append(AuditLog.site_id == site_id)
    if is_success is not None:
        filters.append(AuditLog.is_success == is_success)

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    rows = db.execute(
        select(AuditLog, Site.filename)
        .outerjoin(Site, Site.id == AuditLog.site_id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        AuditLogResponse(
            id=log.id,
            site_id=log.site_id,
            site_filename=filename,
            action_type=log.action_type,
            command_executed=log.command_executed,
            execution_output=log.execution_output,
            is_success=log.is_success,
            created_at=log.created_at,
        )
        for log, filename in rows
    ]
    return AuditLogList(items=items, total=total)
