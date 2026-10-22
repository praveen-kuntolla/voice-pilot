from dataclasses import dataclass
import os
from urllib.parse import urlsplit

@dataclass(frozen=True)
class WorkerConfig:
    enabled: bool
    realtime_enabled: bool
    livekit_url: str | None
    api_key: str | None
    api_secret: str | None
    stt_provider: str | None
    llm_provider: str | None
    tts_provider: str | None
    shared_secret: str | None
    provider_mode: str
    provider_activation_enabled: bool
    connectivity_test_enabled: bool
    outbound_enabled: bool
    test_project_host: str | None

def load_config(env: dict[str, str] | None = None) -> WorkerConfig:
    values = env if env is not None else os.environ
    return WorkerConfig(
        enabled=values.get("VOICE_WORKER_ENABLED", "false").lower() == "true",
        realtime_enabled=values.get("VOICE_REALTIME_ENABLED", "false").lower() == "true",
        livekit_url=values.get("LIVEKIT_URL") or None,
        api_key=values.get("LIVEKIT_API_KEY") or None,
        api_secret=values.get("LIVEKIT_API_SECRET") or None,
        stt_provider=values.get("VOICE_STT_PROVIDER") or None,
        llm_provider=values.get("VOICE_LLM_PROVIDER") or None,
        tts_provider=values.get("VOICE_TTS_PROVIDER") or None,
        shared_secret=values.get("VOICE_WORKER_SHARED_SECRET") or None,
        provider_mode=values.get("VOICE_PROVIDER_MODE", "mock").lower(),
        provider_activation_enabled=values.get("VOICE_PROVIDER_ACTIVATION_ENABLED", "false").lower() == "true",
        connectivity_test_enabled=values.get("VOICE_CONNECTIVITY_TEST_ENABLED", "false").lower() == "true",
        outbound_enabled=values.get("VOICE_OUTBOUND_ENABLED", "false").lower() == "true",
        test_project_host=values.get("LIVEKIT_TEST_PROJECT_HOST") or None,
    )

def validate_realtime_config(config: WorkerConfig) -> None:
    if not config.enabled or not config.realtime_enabled:
        raise RuntimeError("voice worker is disabled")
    if not all((config.livekit_url, config.api_key, config.api_secret)):
        raise RuntimeError("LiveKit server credentials are incomplete")
    if not all((config.stt_provider, config.llm_provider, config.tts_provider)):
        raise RuntimeError("voice provider configuration is incomplete")
    if config.provider_mode not in {"mock", "real"}:
        raise RuntimeError("voice provider mode is invalid")
    if config.provider_mode == "real" and not config.provider_activation_enabled:
        raise RuntimeError("real provider activation is disabled")

def validate_connectivity_config(config: WorkerConfig) -> None:
    if not config.enabled or not config.connectivity_test_enabled or config.realtime_enabled:
        raise RuntimeError("connectivity worker is disabled")
    if config.outbound_enabled or config.provider_mode != "mock":
        raise RuntimeError("connectivity mode forbids outbound calling and real providers")
    if not all((config.livekit_url, config.api_key, config.api_secret, config.shared_secret, config.test_project_host)):
        raise RuntimeError("connectivity configuration is incomplete")
    url = urlsplit(config.livekit_url or "")
    if (url.scheme != "wss" or url.hostname != config.test_project_host.lower()
            or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment):
        raise RuntimeError("connectivity URL does not match the isolated test project")
