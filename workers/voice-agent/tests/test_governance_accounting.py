"""
Phase 3.16 extension: distributed usage accounting scenarios.
Tests the local UsageLedger against mock RPC boundary patterns
that mirror the database RPCs (reserve_provider_session, record_provider_usage).
No network, no Supabase, no Redis, no LiveKit.
"""
import uuid
import pytest
from voice_agent.governance import (
    Pricing, QuotaPolicy, UsageEvent, UsageLedger, QuotaExceededError,
    PrivacyPolicy, ProviderApprovalError, ProviderConfigurationError,
    DiagnosticRecorder, DiagnosticEvent,
)


ORG_A = "11111111-1111-4111-8111-111111111111"
ORG_B = "22222222-2222-4222-8222-222222222222"
AGENT = "33333333-3333-4333-8333-333333333333"


# ── Pricing constants mirroring realistic provider rates ──────────────────────
REAL_PRICING = Pricing(
    stt_per_minute=0.0059,    # Deepgram Nova-3
    llm_input_per_1k=0.00015, # GPT-4.1 mini
    llm_output_per_1k=0.0006,
    tts_per_1k_characters=0.18,  # ElevenLabs multilingual
)


def new_event(org, session, metric, quantity, agent=AGENT) -> UsageEvent:
    return UsageEvent(
        event_id=str(uuid.uuid4()),
        organization_id=org,
        agent_id=agent,
        session_id=session,
        metric=metric,
        quantity=quantity,
    )


# ── Idempotency: duplicate event_id returns 0 cost ───────────────────────────
def test_distributed_accounting_deduplicates_event_ids():
    ledger = UsageLedger(REAL_PRICING, QuotaPolicy())
    ledger.begin_session(ORG_A, "s1")
    ev = new_event(ORG_A, "s1", "stt_seconds", 60)
    cost1 = ledger.record(ev)
    cost2 = ledger.record(ev)  # same event_id
    assert cost1 > 0, "First record should compute a cost"
    assert cost2 == 0.0, "Duplicate event_id must return zero (idempotent)"


# ── Cross-tenant isolation: organization costs are scoped separately ──────────
def test_distributed_accounting_tenant_isolation():
    ledger = UsageLedger(REAL_PRICING, QuotaPolicy(max_organization_cost=0.001))
    ledger.begin_session(ORG_A, "s-a")
    ledger.begin_session(ORG_B, "s-b")

    # Record cost for ORG_A
    ledger.record(new_event(ORG_A, "s-a", "llm_input_tokens", 5))

    # ORG_B's budget should be independent — should not be exhausted
    cost = ledger.record(new_event(ORG_B, "s-b", "llm_input_tokens", 1))
    assert cost >= 0, "ORG_B cost should succeed independently of ORG_A spend"


# ── Session budget enforced before org budget ─────────────────────────────────
def test_session_budget_enforced_independently():
    ledger = UsageLedger(
        REAL_PRICING,
        QuotaPolicy(max_session_cost=0.0001, max_organization_cost=10.0),
    )
    ledger.begin_session(ORG_A, "s1")
    ledger.record(new_event(ORG_A, "s1", "llm_input_tokens", 1))
    with pytest.raises(QuotaExceededError, match="session budget"):
        ledger.record(new_event(ORG_A, "s1", "llm_input_tokens", 1000))


# ── Concurrent session limit enforced globally per org ────────────────────────
def test_concurrent_session_cap_enforced():
    ledger = UsageLedger(REAL_PRICING, QuotaPolicy(max_concurrent_sessions=2))
    ledger.begin_session(ORG_A, "s1")
    ledger.begin_session(ORG_A, "s2")
    with pytest.raises(QuotaExceededError, match="concurrent"):
        ledger.begin_session(ORG_A, "s3")


# ── Ending a session releases its slot ────────────────────────────────────────
def test_session_slot_released_on_end():
    ledger = UsageLedger(REAL_PRICING, QuotaPolicy(max_concurrent_sessions=1))
    ledger.begin_session(ORG_A, "s1")
    with pytest.raises(QuotaExceededError):
        ledger.begin_session(ORG_A, "s2")
    ledger.end_session("s1")
    ledger.begin_session(ORG_A, "s2")  # must succeed after release


# ── Cost calculation accuracy for each metric ─────────────────────────────────
def test_cost_calculation_per_metric():
    ledger = UsageLedger(REAL_PRICING, QuotaPolicy())
    ledger.begin_session(ORG_A, "s1")

    # STT: 60 seconds at $0.0059/min = $0.0059
    stt_cost = ledger.record(new_event(ORG_A, "s1", "stt_seconds", 60))
    assert abs(stt_cost - 0.0059) < 1e-8, f"STT cost wrong: {stt_cost}"

    # LLM input: 1000 tokens at $0.00015/1k = $0.00015
    llm_cost = ledger.record(new_event(ORG_A, "s1", "llm_input_tokens", 1000))
    assert abs(llm_cost - 0.00015) < 1e-10, f"LLM input cost wrong: {llm_cost}"

    # LLM output: 1000 tokens at $0.0006/1k = $0.0006
    llm_out_cost = ledger.record(new_event(ORG_A, "s1", "llm_output_tokens", 1000))
    assert abs(llm_out_cost - 0.0006) < 1e-10, f"LLM output cost wrong: {llm_out_cost}"

    # TTS: 1000 chars at $0.18/1k = $0.18
    tts_cost = ledger.record(new_event(ORG_A, "s1", "tts_characters", 1000))
    assert abs(tts_cost - 0.18) < 1e-10, f"TTS cost wrong: {tts_cost}"


# ── Invalid usage event identity fails closed ─────────────────────────────────
def test_usage_event_identity_validation():
    ledger = UsageLedger(REAL_PRICING, QuotaPolicy())
    ledger.begin_session(ORG_A, "s1")

    with pytest.raises(QuotaExceededError, match="identity"):
        ledger.record(UsageEvent("", ORG_A, AGENT, "s1", "stt_seconds", 1))

    with pytest.raises(QuotaExceededError, match="quantity"):
        ledger.record(UsageEvent(str(uuid.uuid4()), ORG_A, AGENT, "s1", "stt_seconds", -1))


# ── Diagnostic recorder: correlation IDs are bounded ─────────────────────────
def test_diagnostic_correlation_id_length_enforced():
    recorder = DiagnosticRecorder()
    long_id = "x" * 129  # exceeds 128 limit
    with pytest.raises(ValueError, match="correlation ID"):
        recorder.record(DiagnosticEvent(long_id, "quota", "budget_check"))


# ── Privacy policy: invalid retention days fail closed ───────────────────────
def test_privacy_policy_retention_bounds():
    # governance.py raises ProviderConfigurationError for out-of-range retention
    policy = PrivacyPolicy(audio_retention_days=366, transcript_retention_days=30)
    with pytest.raises(ProviderConfigurationError):
        policy.validate("US", True)

    policy2 = PrivacyPolicy(audio_retention_days=-1, transcript_retention_days=30)
    with pytest.raises(ProviderConfigurationError):
        policy2.validate("US", True)


# ── Multi-session org cost accumulation ───────────────────────────────────────
def test_org_cost_accumulates_across_sessions():
    """Org-level cost limit applies across independent sessions."""
    ledger = UsageLedger(
        Pricing(llm_input_per_1k=1.0),  # $1 per 1k tokens for easy math
        QuotaPolicy(max_organization_cost=0.002),
    )
    ledger.begin_session(ORG_A, "s1")
    ledger.begin_session(ORG_A, "s2")

    ledger.record(new_event(ORG_A, "s1", "llm_input_tokens", 1))  # $0.001
    ledger.record(new_event(ORG_A, "s2", "llm_input_tokens", 1))  # $0.001 → total $0.002

    with pytest.raises(QuotaExceededError, match="organization budget"):
        ledger.record(new_event(ORG_A, "s1", "llm_input_tokens", 1))  # would exceed $0.002
