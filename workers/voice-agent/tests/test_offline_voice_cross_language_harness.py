import pytest

from voice_agent.offline_voice_pipeline_contract import ContractError, OfflineVoiceEventLedger, load_shared_fixture, validate_session_request


def load_exchange():
    from pathlib import Path
    import json
    path = Path(__file__).resolve().parents[3] / "contracts" / "offline-voice-pipeline-v1.exchange.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_python_validates_both_producer_sequences():
    exchange = load_exchange()
    request = validate_session_request(exchange["session_request"])
    for produced in (exchange["typescript_produced_events"], exchange["python_produced_events"]):
        ledger = OfflineVoiceEventLedger(request)
        for event in produced:
            assert ledger.append(event) == "accepted"
        assert ledger.state == "ended"
        assert ledger.last_sequence == len(produced)


def test_python_rejects_replay_stale_cross_tenant_and_raw_payloads():
    exchange = load_exchange()
    request = validate_session_request(exchange["session_request"])
    ledger = OfflineVoiceEventLedger(request)
    first = exchange["typescript_produced_events"][0]
    assert ledger.append(first) == "accepted"
    assert ledger.append(first) == "duplicate"
    with pytest.raises(ContractError, match="stale"):
        ledger.append({**exchange["typescript_produced_events"][1], "sequence": 1})
    with pytest.raises(ContractError, match="identity"):
        ledger.append({**exchange["typescript_produced_events"][1], "event_id": "cross-tenant", "sequence": 2, "organization_id": "other-org"})
    with pytest.raises(ContractError, match="privacy"):
        ledger.append({**exchange["typescript_produced_events"][1], "event_id": "raw-text", "sequence": 2, "metadata": {"simulation_only": True, "text": "secret"}})
