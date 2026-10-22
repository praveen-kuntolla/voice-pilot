import pytest
from voice_agent.governance import (ActivationPolicy, DiagnosticEvent, DiagnosticRecorder, MockSecretStore, Pricing, PrivacyPolicy, ProviderApprovalError, ProviderConfigurationError, ProviderSelection, QuotaExceededError, QuotaPolicy, UsageEvent, UsageLedger, credential_status, validate_selection)

REAL=ProviderSelection("deepgram","nova-3","openai","gpt-4.1-mini","elevenlabs","eleven_multilingual_v2","future-configured","en-US")

def test_registry_rejects_invalid_models_languages_and_voices():
    validate_selection(ProviderSelection())
    with pytest.raises(ProviderConfigurationError,match="model"): validate_selection(ProviderSelection(stt_model="unknown"))
    with pytest.raises(ProviderConfigurationError,match="language"): validate_selection(ProviderSelection(stt_provider="deepgram",stt_model="nova-3",language="fr-FR"))
    with pytest.raises(ProviderConfigurationError,match="voice"): validate_selection(ProviderSelection(voice_id="not-a-mock-voice"))

def test_real_provider_requires_environment_org_and_agent_approval():
    disabled=ActivationPolicy(False,"org-a","agent-a",frozenset({"deepgram","openai","elevenlabs"}),frozenset({"deepgram","openai","elevenlabs"}))
    with pytest.raises(ProviderApprovalError,match="disabled"): disabled.authorize(REAL,organization_id="org-a",agent_id="agent-a")
    partial=ActivationPolicy(True,"org-a","agent-a",frozenset({"deepgram","openai","elevenlabs"}),frozenset({"openai"}))
    with pytest.raises(ProviderApprovalError,match="approval"): partial.authorize(REAL,organization_id="org-a",agent_id="agent-a")
    allowed=ActivationPolicy(True,"org-a","agent-a",frozenset({"deepgram","openai","elevenlabs"}),frozenset({"deepgram","openai","elevenlabs"}))
    allowed.authorize(REAL,organization_id="org-a",agent_id="agent-a")
    with pytest.raises(ProviderApprovalError,match="tenant"): allowed.authorize(REAL,organization_id="org-b",agent_id="agent-a")

def test_secret_status_redacts_values_and_missing_secret_fails_closed():
    store=MockSecretStore({"secret://development/openai":"not-for-logs"})
    status=credential_status(store,"secret://development/openai")
    assert status["configured"] is True and "not-for-logs" not in str(status)
    with pytest.raises(ProviderApprovalError): store.get("secret://missing")

def test_privacy_policy_requires_consent_and_allowed_region():
    policy=PrivacyPolicy(audio_retention_days=0,transcript_retention_days=7,permitted_regions=("IN",))
    with pytest.raises(ProviderApprovalError,match="consent"): policy.validate("IN",False)
    with pytest.raises(ProviderApprovalError,match="region"): policy.validate("US",True)
    policy.validate("IN",True)

def test_local_usage_ledger_deduplicates_and_enforces_budget_and_concurrency():
    ledger=UsageLedger(Pricing(llm_input_per_1k=1.0),QuotaPolicy(max_session_cost=.1,max_organization_cost=.003,max_concurrent_sessions=1))
    ledger.begin_session("org","s1")
    assert ledger.record(UsageEvent("e1","org","agent","s1","llm_input_tokens",1)) == .001
    assert ledger.record(UsageEvent("e1","org","agent","s1","llm_input_tokens",1)) == 0
    with pytest.raises(QuotaExceededError,match="concurrent"): ledger.begin_session("org","s2")
    with pytest.raises(QuotaExceededError,match="organization budget"): ledger.record(UsageEvent("e2","org","agent","s1","llm_input_tokens",3))
    ledger.end_session("s1"); ledger.begin_session("org","s2")
    assert ledger.record(UsageEvent("e3","org","agent","s2","llm_input_tokens",1)) == .001
    with pytest.raises(QuotaExceededError,match="organization budget"): ledger.record(UsageEvent("e4","org","agent","s2","llm_input_tokens",2))

def test_diagnostics_hold_metadata_not_conversation_content():
    recorder=DiagnosticRecorder(); recorder.record(DiagnosticEvent("corr-1","provider","timeout",provider="mock",latency_ms=30,outcome="timeout"))
    assert recorder.events[0].action == "timeout"
    with pytest.raises(ValueError): recorder.record(DiagnosticEvent("","provider","failure"))
