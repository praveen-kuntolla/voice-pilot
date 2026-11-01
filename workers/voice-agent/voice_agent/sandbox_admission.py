from dataclasses import dataclass
from typing import Any
from uuid import UUID


@dataclass(frozen=True)
class WorkerAdmission:
    organization_id: str
    agent_id: str
    actor_id: str
    session_id: str
    expires_at: int
    max_duration_seconds: int
    max_concurrent_sessions: int
    provider_activation_enabled: bool
    emergency_stop: bool


def validate_worker_admission(claims: Any, *, organization_id: str, agent_id: str, actor_id: str, now_ms: int, emergency_stop: bool = False, provider_activation_enabled: bool = False, replayed: bool = False, revoked: bool = False, concurrency_available: bool = True) -> WorkerAdmission:
    if not isinstance(claims, dict):
        raise PermissionError("sandbox admission is invalid")
    required = ("organization_id", "agent_id", "actor_id", "session_id", "issued_at", "expires_at", "capability", "max_duration_seconds", "max_concurrent_sessions", "provider_activation_enabled", "emergency_stop")
    if any(key not in claims for key in required):
        raise PermissionError("sandbox admission is incomplete")
    try:
        UUID(str(claims["session_id"]))
        values = {key: int(claims[key]) for key in ("issued_at", "expires_at", "max_duration_seconds", "max_concurrent_sessions")}
    except (TypeError, ValueError):
        raise PermissionError("sandbox admission is malformed") from None
    if not all(isinstance(claims[key], str) and claims[key].strip() for key in ("organization_id", "agent_id", "actor_id")) or claims["capability"] != "voice_sandbox":
        raise PermissionError("sandbox admission identity is invalid")
    if values["expires_at"] <= now_ms or values["expires_at"] <= values["issued_at"] or not 1 <= values["max_duration_seconds"] <= 300 or values["max_concurrent_sessions"] != 1:
        raise PermissionError("sandbox admission is expired or outside policy")
    if claims["organization_id"] != organization_id or claims["agent_id"] != agent_id or claims["actor_id"] != actor_id:
        raise PermissionError("sandbox admission tenant mismatch")
    if claims["provider_activation_enabled"] is not False or provider_activation_enabled or claims["emergency_stop"] is not False or emergency_stop or replayed or revoked or not concurrency_available:
        raise PermissionError("sandbox admission is not available")
    return WorkerAdmission(claims["organization_id"], claims["agent_id"], claims["actor_id"], claims["session_id"], values["expires_at"], values["max_duration_seconds"], values["max_concurrent_sessions"], False, False)
