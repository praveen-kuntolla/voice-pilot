from dataclasses import dataclass, field
from typing import Any, Callable
from .signed_admission import verify_signed_admission
from .durable_admission_gateway import AdmissionGateway, consume_authoritative, release_authoritative


@dataclass
class OfflineAdmissionWorkflow:
    resolve_key: Callable[[str], str | None]
    now_ms: int
    active: set[str]
    consumed: set[str]
    revoked: set[str]
    gateway: AdmissionGateway | None = None
    session_context: dict[str, tuple[str, str]] = field(default_factory=dict)

    def admit(self, assertion: Any, *, organization_id: str, agent_id: str, actor_id: str, emergency_stop: bool = False, concurrency_available: bool = True) -> bool:
        claims = assertion.get("claims") if isinstance(assertion, dict) else None
        assertion_id = claims.get("assertionId") if isinstance(claims, dict) else None
        if not assertion_id or assertion_id in self.consumed or assertion_id in self.revoked:
            return False
        if not verify_signed_admission(assertion, self.resolve_key, now_ms=self.now_ms, organization_id=organization_id, agent_id=agent_id, actor_id=actor_id, emergency_stop=emergency_stop, concurrency_available=concurrency_available):
            return False
        durable = consume_authoritative(self.gateway, assertion_id=assertion_id, organization_id=organization_id, actor_id=actor_id)
        if self.gateway is not None and not durable.accepted:
            return False
        self.consumed.add(assertion_id); self.active.add(claims["sessionId"]); self.session_context[claims["sessionId"]] = (organization_id, actor_id); return True

    def cancel(self, session_id: str, assertion_id: str) -> None:
        self.active.discard(session_id); self.revoked.add(assertion_id)
        context = self.session_context.pop(session_id, None)
        if self.gateway is not None and context is not None:
            release_authoritative(self.gateway, session_id=session_id, organization_id=context[0], actor_id=context[1])

    def complete(self, session_id: str, assertion_id: str) -> None:
        self.active.discard(session_id); self.revoked.add(assertion_id)
        context = self.session_context.pop(session_id, None)
        if self.gateway is not None and context is not None:
            release_authoritative(self.gateway, session_id=session_id, organization_id=context[0], actor_id=context[1])

    def cleanup(self, session_id: str, assertion_id: str) -> None:
        self.cancel(session_id, assertion_id)
