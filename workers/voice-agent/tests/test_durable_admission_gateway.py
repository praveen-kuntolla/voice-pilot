from voice_agent.durable_admission_gateway import consume_authoritative, release_authoritative


class Gateway:
    def __init__(self, result=None, failure=False):
        self.result = result or {"ok": True, "reused": False}
        self.failure = failure
        self.consumed = []
        self.released = []

    def consume(self, **kwargs):
        if self.failure:
            raise RuntimeError("unavailable")
        self.consumed.append(kwargs)
        return self.result

    def release(self, **kwargs):
        if self.failure:
            raise RuntimeError("unavailable")
        self.released.append(kwargs)
        return True


def test_missing_or_failed_gateway_fails_closed():
    assert not consume_authoritative(None, assertion_id="a", organization_id="o", actor_id="u").accepted
    assert not consume_authoritative(Gateway(failure=True), assertion_id="a", organization_id="o", actor_id="u").accepted


def test_gateway_result_is_authoritative_and_release_is_idempotent_at_boundary():
    gateway = Gateway({"ok": True, "reused": True})
    result = consume_authoritative(gateway, assertion_id="a", organization_id="o", actor_id="u")
    assert result.accepted and result.reused
    assert release_authoritative(gateway, session_id="s", organization_id="o", actor_id="u")
    assert gateway.released == [{"session_id": "s", "organization_id": "o", "actor_id": "u"}]
