import pytest

from voice_agent.offline_voice_pipeline_contract import ContractError, OfflineVoiceEventLedger, load_shared_fixture, validate_event, validate_session_request


def test_shared_fixture_matches_python_contract():
    fixture = load_shared_fixture()
    request = validate_session_request(fixture["session_request"])
    event = validate_event(fixture["event"], request)
    assert request.provider_mode == "mock"
    assert event.sequence == 1


def test_python_ledger_rejects_replay_conflict_stale_and_invalid_transition():
    fixture = load_shared_fixture()
    request = validate_session_request(fixture["session_request"])
    ledger = OfflineVoiceEventLedger(request)
    assert ledger.append(fixture["event"]) == "accepted"
    assert ledger.append(fixture["event"]) == "duplicate"
    with pytest.raises(ContractError, match="conflicting"):
        ledger.append({**fixture["event"], "event_id": "session-a:1", "metadata": {"simulation_only": True, "action": "cleanup"}})
    with pytest.raises(ContractError, match="transition"):
        ledger.append({**fixture["event"], "event_id": "session-a:2", "sequence": 2, "state": "ready"})
    with pytest.raises(ContractError, match="identity"):
        validate_event({**fixture["event"], "organization_id": "org-b"}, request)


def test_python_contract_rejects_raw_text_and_real_provider_mode():
    fixture = load_shared_fixture()
    with pytest.raises(ContractError, match="mock contract"):
        validate_session_request({**fixture["session_request"], "provider_mode": "real"})
    request = validate_session_request(fixture["session_request"])
    with pytest.raises(ContractError, match="privacy"):
        validate_event({**fixture["event"], "metadata": {"simulation_only": True, "text": "secret"}}, request)
