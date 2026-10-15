import ipaddress
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

FILENAME_PATTERN = r"^[a-zA-Z0-9._-]+$"
DOMAIN_PATTERN = r"^[a-zA-Z0-9.-]+$"
MAX_CONTENT = 1_048_576


def _check_content(v: str) -> str:
    if "\0" in v:
        raise ValueError("karakter null tidak diizinkan")
    return v


class SiteCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255, pattern=FILENAME_PATTERN)
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    domain_name: str = Field(min_length=1, max_length=255, pattern=DOMAIN_PATTERN)

    _content = field_validator("content")(_check_content)

    @field_validator("filename")
    @classmethod
    def _no_leading_dot(cls, v: str) -> str:
        if v.startswith("."):  # juga menolak "." dan ".."
            raise ValueError("nama berkas tidak boleh diawali titik")
        return v


class SiteUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    domain_name: str | None = Field(
        default=None, min_length=1, max_length=255, pattern=DOMAIN_PATTERN
    )

    _content = field_validator("content")(_check_content)


class SiteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    domain_name: str
    is_enabled: bool
    file_exists: bool = False
    created_at: datetime
    updated_at: datetime


class SiteDetailResponse(SiteResponse):
    content: str


class SiteList(BaseModel):
    items: list[SiteResponse]
    total: int


class NginxTestRequest(BaseModel):
    site_id: int | None = None


class NginxTestResponse(BaseModel):
    is_success: bool
    stdout: str
    stderr: str


class CommandResultResponse(BaseModel):
    is_success: bool
    message: str


_HOSTNAME_RE = r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$"
_HEADER_NAME_RE = re.compile(r"[A-Za-z0-9-]+")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")  # tab diizinkan


def _check_ip(v: str | None) -> str | None:
    if v is None:
        return None
    try:
        return str(ipaddress.ip_address(v))  # menolak spasi, host, dan potongan IP
    except ValueError:
        raise ValueError("bukan alamat IPv4/IPv6 yang valid") from None


def _check_headers(v: dict[str, str] | None) -> dict[str, str] | None:
    if v is None:
        return None
    if len(v) > 20:
        raise ValueError("maksimal 20 header")
    for k, val in v.items():
        if not _HEADER_NAME_RE.fullmatch(k):
            raise ValueError("nama header hanya boleh huruf, angka, dan tanda hubung")
        if len(val) > 1024 or _CONTROL_RE.search(val):
            raise ValueError("nilai header tidak valid (karakter kontrol/baris baru dilarang)")
    return v


class CurlTestRequest(BaseModel):
    target_domain: str = Field(pattern=_HOSTNAME_RE)
    resolve_ip: str | None = None
    port: int = Field(ge=1, le=65535)
    protocol: Literal["HTTP", "HTTPS"]
    custom_headers: dict[str, str] | None = None
    site_id: int | None = None

    _ip = field_validator("resolve_ip")(_check_ip)
    _headers = field_validator("custom_headers")(_check_headers)


class CurlTestResponse(BaseModel):
    is_success: bool
    status_code: int
    ttfb_ms: float
    total_ms: float
    headers: dict[str, str]
    ssl_status: str
    raw_output: str
    command: str
    error: str | None = None
