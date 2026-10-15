from sqlalchemy.orm import Session

from app.models import AuditLog

CONFIG_SAVE = "CONFIG_SAVE"
SYMLINK_TOGGLE = "SYMLINK_TOGGLE"


def record(
    db: Session,
    site_id: int | None,
    action_type: str,
    command: str,
    output: str | None = None,
    success: bool = True,
) -> None:
    """Tambah baris audit ke transaksi berjalan; commit dilakukan pemanggil.

    Dengan begitu operasi dan jejaknya berhasil atau gagal bersama.
    """
    db.add(
        AuditLog(
            site_id=site_id,
            action_type=action_type,
            command_executed=command,
            execution_output=output,
            is_success=success,
        )
    )
