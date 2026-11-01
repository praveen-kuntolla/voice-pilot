import hashlib
import hmac
import json
import re
from typing import Any, Callable
from uuid import UUID


def _length_prefix(value: str) -> str:
    return f"{len(value)}:{value}"


def canonical_admission(claims: dict[str, Any]) -> str:
    usage = claims["usageLimit"]
    return "|".join(("voicepilot-admission", str(claims["version"]), _length_prefix(claims["keyId"]), _length_prefix(claims["assertionId"]), _length_prefix(claims["organizationId"]), _length_prefix(claims["agentId"]), _length_prefix(claims["actorId"]), _length_prefix(claims["sessionId"]), str(claims["issuedAt"]), str(claims["expiresAt"]), _length_prefix(claims["capability"]), str(claims["maxDurationSeconds"]), str(usage["inputCharacters"]), str(usage["outputCharacters"]), "providerActivationEnabled=false"))


def verify_signed_admission(assertion: Any, resolve_key: Callable[[str], str | None], *, now_ms: int, organization_id: str, agent_id: str, actor_id: str, replayed: bool = False, revoked: bool = False, emergency_stop: bool = False, concurrency_available: bool = True) -> bool:
    if not isinstance(assertion, dict) or not isinstance(assertion.get("claims"), dict) or not isinstance(assertion.get("signature"), str): return False
    claims = assertion["claims"]
    required = ("version", "keyId", "assertionId", "organizationId", "agentId", "actorId", "sessionId", "issuedAt", "expiresAt", "capability", "maxDurationSeconds", "usageLimit", "providerActivationEnabled")
    if set(claims) != set(required) or claims["version"] != 1 or claims["capability"] != "voice_sandbox" or claims["providerActivationEnabled"] is not False: return False
    try:
        UUID(claims["assertionId"]); UUID(claims["sessionId"])
        if not all(isinstance(claims[key], str) and claims[key].strip() for key in ("keyId", "organizationId", "agentId", "actorId")): return False
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", claims["keyId"]): return False
        if not all(isinstance(claims[key], int) and not isinstance(claims[key], bool) and claims[key] >= 0 for key in ("issuedAt", "expiresAt")): return False
        usage = claims["usageLimit"]
        if set(usage) != {"inputCharacters", "outputCharacters"} or not all(isinstance(usage[key], int) and usage[key] >= 0 for key in usage): return False
    except (KeyError, TypeError, ValueError): return False
    if not isinstance(now_ms, int) or claims["expiresAt"] <= now_ms or claims["expiresAt"] <= claims["issuedAt"] or not 1 <= claims["maxDurationSeconds"] <= 300 or claims["organizationId"] != organization_id or claims["agentId"] != agent_id or claims["actorId"] != actor_id or replayed or revoked or emergency_stop or not concurrency_available: return False
    if not re.fullmatch(r"[0-9a-f]{64}", assertion["signature"]): return False
    secret = resolve_key(claims["keyId"])
    if not secret: return False
    expected = hmac.new(secret.encode(), canonical_admission(claims).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, assertion["signature"])
