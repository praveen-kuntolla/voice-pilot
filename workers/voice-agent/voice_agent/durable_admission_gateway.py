"""Dependency-injected boundary for authoritative server-side admission.

The worker never connects to PostgreSQL directly. The host application supplies
the already-authenticated transactional gateway, and a missing or failed
gateway is always a denial.
"""
from dataclasses import dataclass
from typing import Any, Protocol


class AdmissionGateway(Protocol):
    def consume(self, *, assertion_id: str, organization_id: str, actor_id: str) -> dict[str, Any]: ...
    def release(self, *, session_id: str, organization_id: str, actor_id: str) -> bool: ...


@dataclass(frozen=True)
class DurableAdmissionResult:
    accepted: bool
    reused: bool = False


def consume_authoritative(gateway: AdmissionGateway | None, *, assertion_id: str, organization_id: str, actor_id: str) -> DurableAdmissionResult:
    if gateway is None:
        return DurableAdmissionResult(False)
    try:
        result = gateway.consume(assertion_id=assertion_id, organization_id=organization_id, actor_id=actor_id)
    except Exception:
        return DurableAdmissionResult(False)
    if not isinstance(result, dict) or result.get("ok") is not True:
        return DurableAdmissionResult(False)
    return DurableAdmissionResult(True, result.get("reused") is True)


def release_authoritative(gateway: AdmissionGateway | None, *, session_id: str, organization_id: str, actor_id: str) -> bool:
    if gateway is None:
        return False
    try:
        return gateway.release(session_id=session_id, organization_id=organization_id, actor_id=actor_id) is True
    except Exception:
        return False
