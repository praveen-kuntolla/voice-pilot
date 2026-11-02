"""Shared v1 offline voice pipeline contract, mirrored by TypeScript."""
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

CONTRACT_VERSION = "offline.voice.pipeline.v1"
MAX_TURN_CHARS = 1000
States = Literal["ready", "active", "interrupted", "cancelled", "stopped", "ended", "failed"]
EventTypes = Literal["session_started", "turn_started", "transcript", "response", "speech", "interrupted", "provider_failed", "cancelled", "emergency_stopped", "session_expired", "session_ended", "cleanup_completed"]
_EVENT_TYPES = {"session_started", "turn_started", "transcript", "response", "speech", "interrupted", "provider_failed", "cancelled", "emergency_stopped", "session_expired", "session_ended", "cleanup_completed"}
_METADATA_KEYS = {"simulation_only", "stage", "action", "text_length", "text_sha256_prefix"}


class ContractError(ValueError):
    pass


@dataclass(frozen=True)
class ContractSessionRequest:
    session_id: str
    organization_id: str
    agent_id: str
    actor_id: str
    expires_at_ms: int
    max_turn_chars: int
    provider_mode: Literal["mock"]
    simulation_only: Literal[True]
    no_recording: Literal[True]


@dataclass(frozen=True)
class ContractEvent:
    contract_version: str
    event_id: str
    session_id: str
    organization_id: str
    agent_id: str
    actor_id: str
    sequence: int
    turn_id: int
    event_type: EventTypes
    state: States
    metadata: dict[str, object]


def _id(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 160:
        raise ContractError("bounded identity is invalid")
    return value.strip()


def validate_session_request(value: object) -> ContractSessionRequest:
    if not isinstance(value, dict):
        raise ContractError("session request must be an object")
    if value.get("contract_version") != CONTRACT_VERSION or value.get("provider_mode") != "mock" or value.get("simulation_only") is not True or value.get("no_recording") is not True:
        raise ContractError("offline mock contract is required")
    max_turn_chars = value.get("max_turn_chars")
    expires_at_ms = value.get("expires_at_ms")
    if not isinstance(max_turn_chars, int) or not 1 <= max_turn_chars <= MAX_TURN_CHARS or not isinstance(expires_at_ms, int) or expires_at_ms <= 0:
        raise ContractError("session bounds are invalid")
    return ContractSessionRequest(_id(value.get("session_id")), _id(value.get("organization_id")), _id(value.get("agent_id")), _id(value.get("actor_id")), expires_at_ms, max_turn_chars, "mock", True, True)


def validate_event(value: object, request: ContractSessionRequest) -> ContractEvent:
    if not isinstance(value, dict) or value.get("contract_version") != CONTRACT_VERSION:
        raise ContractError("event contract version is invalid")
    identity = ("session_id", "organization_id", "agent_id", "actor_id")
    if any(value.get(field) != getattr(request, field) for field in identity):
        raise ContractError("event identity is not session-bound")
    sequence, turn_id = value.get("sequence"), value.get("turn_id")
    if not isinstance(sequence, int) or sequence <= 0 or not isinstance(turn_id, int) or turn_id < 0:
        raise ContractError("event ordering is invalid")
    state = value.get("state")
    if state not in {"ready", "active", "interrupted", "cancelled", "stopped", "ended", "failed"}:
        raise ContractError("event state is invalid")
    metadata = value.get("metadata")
    if not isinstance(metadata, dict) or metadata.get("simulation_only") is not True or set(metadata) - _METADATA_KEYS or "text" in metadata or "transcript" in metadata or "response" in metadata:
        raise ContractError("event metadata is not privacy-safe")
    if value.get("event_type") not in _EVENT_TYPES:
        raise ContractError("event type is invalid")
    if "text_length" in metadata and (not isinstance(metadata["text_length"], int) or not 0 <= metadata["text_length"] <= request.max_turn_chars):
        raise ContractError("event text length is invalid")
    if "text_sha256_prefix" in metadata and (not isinstance(metadata["text_sha256_prefix"], str) or not re.fullmatch(r"[0-9a-f]{16}", metadata["text_sha256_prefix"])):
        raise ContractError("event text digest is invalid")
    return ContractEvent(CONTRACT_VERSION, _id(value.get("event_id")), request.session_id, request.organization_id, request.agent_id, request.actor_id, sequence, turn_id, value["event_type"], state, dict(metadata))


_TRANSITIONS: dict[str, set[str]] = {
    "ready": {"active", "ended"}, "active": {"active", "interrupted", "cancelled", "stopped", "ended", "failed"},
    "interrupted": {"active", "cancelled", "stopped", "ended"}, "cancelled": {"ended"}, "stopped": {"ended"}, "ended": {"ended"},
    "failed": {"active", "cancelled", "stopped", "ended"},
}


class OfflineVoiceEventLedger:
    def __init__(self, request: ContractSessionRequest):
        self.request = request
        self.state: States = "ready"
        self.last_sequence = 0
        self._events: dict[str, str] = {}

    def append(self, value: object) -> Literal["accepted", "duplicate"]:
        event = validate_event(value, self.request)
        fingerprint = json.dumps(value, sort_keys=True, separators=(",", ":"))
        existing = self._events.get(event.event_id)
        if existing is not None:
            if existing != fingerprint:
                raise ContractError("duplicate event identifier has conflicting content")
            return "duplicate"
        if event.sequence <= self.last_sequence:
            raise ContractError("stale or out-of-order event")
        if event.state not in _TRANSITIONS[self.state]:
            raise ContractError(f"invalid transition {self.state} -> {event.state}")
        self._events[event.event_id] = fingerprint
        self.last_sequence = event.sequence
        self.state = event.state
        return "accepted"


def load_shared_fixture() -> dict[str, object]:
    path = Path(__file__).resolve().parents[3] / "contracts" / "offline-voice-pipeline-v1.fixture.json"
    return json.loads(path.read_text(encoding="utf-8"))
