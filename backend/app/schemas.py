from datetime import datetime

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
