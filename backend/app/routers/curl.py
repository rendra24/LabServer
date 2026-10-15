import json

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import DbSession
from app.errors import AppError
from app.models import Site, TestProfile
from app.schemas import (
    CurlTestRequest,
    CurlTestResponse,
    TestProfileCreate,
    TestProfileResponse,
)
from app.services import curl_service

router = APIRouter(prefix="/api/v1", tags=["curl"])


def _headers(raw: str | None) -> dict[str, str] | None:
    try:
        value = json.loads(raw) if raw else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _profile_response(p: TestProfile) -> TestProfileResponse:
    return TestProfileResponse(
        id=p.id,
        site_id=p.site_id,
        target_domain=p.target_domain,
        resolve_ip=p.resolve_ip,
        port=p.port,
        custom_headers=_headers(p.custom_headers),
        updated_at=p.updated_at,
    )


@router.post("/curl/test", response_model=CurlTestResponse)
def run_curl_test(body: CurlTestRequest):
    curl_service.check_target(body)
    return curl_service.run_curl_test(body)


@router.get("/profiles", response_model=list[TestProfileResponse])
def list_test_profiles(db: DbSession, site_id: int | None = None):
    query = select(TestProfile).order_by(TestProfile.id)
    if site_id is not None:
        query = query.where(TestProfile.site_id == site_id)
    return [_profile_response(p) for p in db.scalars(query)]


@router.post("/profiles", response_model=TestProfileResponse, status_code=201)
def create_test_profile(body: TestProfileCreate, db: DbSession):
    if db.get(Site, body.site_id) is None:
        raise AppError(404, "SITE_NOT_FOUND", "Situs tidak ditemukan.")
    profile = TestProfile(
        site_id=body.site_id,
        target_domain=body.target_domain,
        resolve_ip=body.resolve_ip,
        port=body.port,
        custom_headers=json.dumps(body.custom_headers) if body.custom_headers else None,
    )
    db.add(profile)
    db.commit()
    return _profile_response(profile)
