from dataclasses import dataclass
from typing import Any, Callable
from .signed_admission import verify_signed_admission


@dataclass
class OfflineAdmissionWorkflow:
    resolve_key: Callable[[str], str | None]
    now_ms: int
    active: set[str]
    consumed: set[str]
    revoked: set[str]

    def admit(self, assertion: Any, *, organization_id: str, agent_id: str, actor_id: str, emergency_stop: bool = False, concurrency_available: bool = True) -> bool:
        claims = assertion.get("claims") if isinstance(assertion, dict) else None
        assertion_id = claims.get("assertionId") if isinstance(claims, dict) else None
        if not assertion_id or assertion_id in self.consumed or assertion_id in self.revoked:
            return False
        if not verify_signed_admission(assertion, self.resolve_key, now_ms=self.now_ms, organization_id=organization_id, agent_id=agent_id, actor_id=actor_id, emergency_stop=emergency_stop, concurrency_available=concurrency_available):
            return False
        self.consumed.add(assertion_id); self.active.add(claims["sessionId"]); return True

    def cancel(self, session_id: str, assertion_id: str) -> None:
        self.active.discard(session_id); self.revoked.add(assertion_id)

    def complete(self, session_id: str, assertion_id: str) -> None:
        self.active.discard(session_id); self.revoked.add(assertion_id)

    def cleanup(self, session_id: str, assertion_id: str) -> None:
        self.cancel(session_id, assertion_id)
