"""Local-only policy primitives for future provider activation. No credentials or network clients."""
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Literal, Protocol

ProviderKind = Literal["stt", "llm", "tts"]

@dataclass(frozen=True)
class ProviderCapability:
    provider: str
    kind: ProviderKind
    models: tuple[str, ...]
    languages: tuple[str, ...]
    voices: tuple[str, ...] = ()

REGISTRY: tuple[ProviderCapability, ...] = (
    ProviderCapability("mock", "stt", ("mock-v1",), ("*",)),
    ProviderCapability("mock", "llm", ("mock-v1",), ("*",)),
    ProviderCapability("mock", "tts", ("mock-v1",), ("*",), ("mock-voice",)),
    ProviderCapability("deepgram", "stt", ("nova-3",), ("en-US", "en-GB", "hi-IN")),
    ProviderCapability("openai", "llm", ("gpt-4.1-mini",), ("*",)),
    ProviderCapability("elevenlabs", "tts", ("eleven_multilingual_v2",), ("en-US", "en-GB", "hi-IN"), ("future-configured",)),
)

@dataclass(frozen=True)
class ProviderSelection:
    stt_provider: str = "mock"; stt_model: str = "mock-v1"
    llm_provider: str = "mock"; llm_model: str = "mock-v1"
    tts_provider: str = "mock"; tts_model: str = "mock-v1"; voice_id: str | None = "mock-voice"
    language: str = "en-US"

class ProviderConfigurationError(ValueError): pass
class ProviderApprovalError(PermissionError): pass
class QuotaExceededError(RuntimeError): pass

def _capability(provider: str, kind: ProviderKind) -> ProviderCapability:
    for capability in REGISTRY:
        if capability.provider == provider and capability.kind == kind: return capability
    raise ProviderConfigurationError(f"unsupported {kind} provider")

def validate_selection(selection: ProviderSelection) -> None:
    if not selection.language or len(selection.language) > 20: raise ProviderConfigurationError("language is invalid")
    for kind, provider, model in (("stt", selection.stt_provider, selection.stt_model), ("llm", selection.llm_provider, selection.llm_model), ("tts", selection.tts_provider, selection.tts_model)):
        capability = _capability(provider, kind)  # type: ignore[arg-type]
        if model not in capability.models: raise ProviderConfigurationError(f"unsupported {kind} model")
        if "*" not in capability.languages and selection.language not in capability.languages: raise ProviderConfigurationError(f"unsupported {kind} language")
    tts = _capability(selection.tts_provider, "tts")
    if selection.voice_id is not None and (not selection.voice_id or len(selection.voice_id) > 120): raise ProviderConfigurationError("voice is invalid")
    if selection.tts_provider == "mock" and selection.voice_id not in tts.voices: raise ProviderConfigurationError("unsupported mock voice")

@dataclass(frozen=True)
class ActivationPolicy:
    environment_enabled: bool = False
    organization_id: str = ""
    agent_id: str = ""
    organization_approved: frozenset[str] = frozenset()
    agent_approved: frozenset[str] = frozenset()
    def authorize(self, selection: ProviderSelection, *, organization_id: str, agent_id: str) -> None:
        validate_selection(selection)
        if not self.environment_enabled: raise ProviderApprovalError("provider activation is disabled")
        if organization_id != self.organization_id or agent_id != self.agent_id: raise ProviderApprovalError("provider tenant mismatch")
        for provider in {selection.stt_provider, selection.llm_provider, selection.tts_provider} - {"mock"}:
            if provider not in self.organization_approved or provider not in self.agent_approved: raise ProviderApprovalError("provider approval is missing")

class SecretStore(Protocol):
    def exists(self, reference: str) -> bool: ...
    def get(self, reference: str) -> str: ...

@dataclass
class MockSecretStore:
    """Test-only mapping; callers receive no values in diagnostics."""
    values: dict[str, str] = field(default_factory=dict)
    def exists(self, reference: str) -> bool: return bool(reference) and reference in self.values and bool(self.values[reference])
    def get(self, reference: str) -> str:
        if not self.exists(reference): raise ProviderApprovalError("provider credential is unavailable")
        return self.values[reference]

def credential_status(store: SecretStore, reference: str) -> dict[str, object]:
    return {"configured": store.exists(reference), "reference_fingerprint": sha256(reference.encode()).hexdigest()[:12] if reference else None}

@dataclass(frozen=True)
class PrivacyPolicy:
    audio_retention_days: int = 0
    transcript_retention_days: int = 30
    consent_required: bool = True
    permitted_regions: tuple[str, ...] = ()
    redact_pii_in_diagnostics: bool = True
    def validate(self, region: str, consent: bool) -> None:
        if not 0 <= self.audio_retention_days <= 365 or not 0 <= self.transcript_retention_days <= 365: raise ProviderConfigurationError("retention policy is invalid")
        if self.consent_required and not consent: raise ProviderApprovalError("voice-processing consent is required")
        if self.permitted_regions and region not in self.permitted_regions: raise ProviderApprovalError("processing region is not permitted")

@dataclass(frozen=True)
class Pricing:
    stt_per_minute: float = 0.0
    llm_input_per_1k: float = 0.0
    llm_output_per_1k: float = 0.0
    tts_per_1k_characters: float = 0.0

@dataclass(frozen=True)
class QuotaPolicy:
    max_session_cost: float = 0.0
    max_organization_cost: float = 0.0
    max_concurrent_sessions: int = 0

@dataclass(frozen=True)
class UsageEvent:
    event_id: str; organization_id: str; agent_id: str; session_id: str; metric: Literal["stt_seconds", "llm_input_tokens", "llm_output_tokens", "tts_characters"]; quantity: float

class UsageLedger:
    def __init__(self, pricing: Pricing, policy: QuotaPolicy): self.pricing, self.policy, self._events, self._costs, self._sessions = pricing, policy, set(), {}, set()
    def _cost(self, event: UsageEvent) -> float:
        if event.quantity < 0: raise QuotaExceededError("usage quantity is invalid")
        rates={"stt_seconds":self.pricing.stt_per_minute/60,"llm_input_tokens":self.pricing.llm_input_per_1k/1000,"llm_output_tokens":self.pricing.llm_output_per_1k/1000,"tts_characters":self.pricing.tts_per_1k_characters/1000}
        return event.quantity*rates[event.metric]
    def begin_session(self, organization_id: str, session_id: str) -> None:
        if session_id in self._sessions: return
        if self.policy.max_concurrent_sessions and len(self._sessions) >= self.policy.max_concurrent_sessions: raise QuotaExceededError("concurrent session quota exceeded")
        self._sessions.add(session_id)
    def end_session(self, session_id: str) -> None: self._sessions.discard(session_id)
    def record(self, event: UsageEvent) -> float:
        if not event.event_id or not event.organization_id or not event.agent_id or not event.session_id: raise QuotaExceededError("usage identity is invalid")
        if event.event_id in self._events: return 0.0
        cost=self._cost(event); organization_key=(event.organization_id, "organization"); session_key=(event.organization_id, event.session_id)
        if self.policy.max_session_cost and self._costs.get(session_key,0)+cost > self.policy.max_session_cost: raise QuotaExceededError("session budget exceeded")
        if self.policy.max_organization_cost and self._costs.get(organization_key,0)+cost > self.policy.max_organization_cost: raise QuotaExceededError("organization budget exceeded")
        self._events.add(event.event_id); self._costs[session_key]=self._costs.get(session_key,0)+cost; self._costs[organization_key]=self._costs.get(organization_key,0)+cost; return cost

@dataclass(frozen=True)
class DiagnosticEvent:
    correlation_id: str; category: Literal["session", "provider", "quota", "privacy"]; action: str; provider: str | None = None; latency_ms: int | None = None; outcome: str = "ok"

class DiagnosticRecorder:
    def __init__(self): self.events: list[DiagnosticEvent] = []
    def record(self, event: DiagnosticEvent) -> None:
        if not event.correlation_id or len(event.correlation_id) > 128: raise ValueError("correlation ID is invalid")
        self.events.append(event)
