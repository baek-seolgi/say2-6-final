"""
모바일 단말 등록 API — Flutter 앱이 시작 시 푸시 토큰 보내서 UPSERT.

[운영 흐름]
  Flutter 시작 → FCM/APNs 토큰 획득 → POST /devices/register
  백엔드는 토큰 저장 → 이후 critical 이벤트(triage critical, modal_completed 등)에서
  매칭되는 user_id의 토큰들로 푸시 발송 (별도 dispatcher).
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.db import device_tokens

router = APIRouter()


class RegisterDeviceBody(BaseModel):
    token: str = Field(..., min_length=1, description="FCM/APNs/Web Push 토큰")
    platform: Literal["ios", "android", "web"]
    user_id: Optional[str] = Field(
        default=None, description="Cognito sub 또는 physician id (익명 등록 허용)"
    )
    app_version: Optional[str] = Field(default=None, description="앱 버전 (예: 1.0.0)")


class RegisterDeviceResponse(BaseModel):
    device_id: int


@router.post("/register", response_model=RegisterDeviceResponse)
async def register_device(body: RegisterDeviceBody) -> RegisterDeviceResponse:
    """단말 푸시 토큰 등록·갱신 (UPSERT). 같은 토큰 재등록 시 last_seen_at만 갱신."""
    device_id = await device_tokens.register_or_refresh(
        token=body.token,
        platform=body.platform,
        user_id=body.user_id,
        app_version=body.app_version,
    )
    return RegisterDeviceResponse(device_id=device_id)


class UnregisterDeviceBody(BaseModel):
    token: str


@router.delete("/register")
async def unregister_device(body: UnregisterDeviceBody) -> dict:
    """로그아웃·앱 삭제 시 호출. 토큰을 더 이상 푸시 대상에서 제외."""
    deleted = await device_tokens.delete(body.token)
    return {"deleted": deleted}
