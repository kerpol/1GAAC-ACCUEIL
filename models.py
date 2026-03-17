from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ApiResponse(BaseModel):
    ok: bool
    data: Any | None = None
    error: str | None = None


class PrepareBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    fullName: str = Field(min_length=2, max_length=120)
    classroom: str = Field(min_length=1, max_length=50)
    email: str = Field(min_length=5, max_length=255)
    teamId: str = Field(min_length=1, max_length=120)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if not EMAIL_RE.match(value):
            raise ValueError("Adresse e-mail invalide.")
        return value.lower()


class TeamItem(BaseModel):
    id: str
    name: str
    max_slots: int
    current_count: int

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: str | UUID) -> str:
        return str(value)


class StatePayload(BaseModel):
    teamId: str
    teamName: str
    email: str
    fullName: str
    classroom: str
    ts: int
    exp: int


class PrepareResponseData(BaseModel):
    redirectUrl: str


class ConfirmResponseData(BaseModel):
    registrationId: str | int | None = None
    teamName: str | None = None
    message: str | None = None

    @field_validator("registrationId", mode="before")
    @classmethod
    def stringify_registration_id(cls, value: str | int | UUID | None) -> str | int | None:
        if isinstance(value, UUID):
            return str(value)
        return value