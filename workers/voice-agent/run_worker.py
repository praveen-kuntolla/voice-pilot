"""Opt-in LiveKit worker launcher; disabled configuration never connects."""
import asyncio
import os
from pathlib import Path
from dotenv import dotenv_values
from voice_agent.config import load_config
from voice_agent.service_client import fetch_runtime_config, validate_config_endpoint
from voice_agent.worker import create_livekit_server

def main() -> None:
    test_env_file = os.environ.get("VOICE_TEST_ENV_FILE")
    if test_env_file:
        path = Path(test_env_file).resolve()
        expected = Path(__file__).resolve().parents[2] / ".env.livekit-test.local"
        if path != expected or not path.is_file():
            raise SystemExit("Expected a private .env.livekit-test.local file")
        values = dotenv_values(path)
        if os.environ.get("VOICE_CONNECTIVITY_APPROVED_ONCE") == "true":
            if (values.get("VOICE_CONNECTIVITY_TEST_ENABLED") != "false"
                    or values.get("VOICE_WORKER_ENABLED") != "false"
                    or values.get("VOICE_REALTIME_ENABLED") != "false"
                    or values.get("VOICE_OUTBOUND_ENABLED") != "false"
                    or values.get("VOICE_PROVIDER_MODE") != "mock"):
                raise SystemExit("Private test flags must remain disabled")
            values["VOICE_CONNECTIVITY_TEST_ENABLED"] = "true"
            values["VOICE_WORKER_ENABLED"] = "true"
        worker_keys = {
            "VOICE_WORKER_ENABLED", "VOICE_CONNECTIVITY_TEST_ENABLED",
            "VOICE_REALTIME_ENABLED", "VOICE_OUTBOUND_ENABLED", "VOICE_PROVIDER_MODE",
            "LIVEKIT_URL", "LIVEKIT_TEST_PROJECT_HOST", "LIVEKIT_API_KEY",
            "LIVEKIT_API_SECRET", "VOICE_WORKER_SHARED_SECRET", "VOICE_CONFIG_ENDPOINT",
            "VOICE_STT_PROVIDER", "VOICE_LLM_PROVIDER", "VOICE_TTS_PROVIDER",
        }
        for key in worker_keys:
            if values.get(key) is not None:
                os.environ[key] = values[key] or ""
    config = load_config()
    if not config.enabled or not (config.realtime_enabled or config.connectivity_test_enabled):
        raise SystemExit("VoicePilot worker is disabled; no LiveKit connection attempted")
    endpoint = os.environ.get("VOICE_CONFIG_ENDPOINT")
    if not endpoint:
        raise SystemExit("VOICE_CONFIG_ENDPOINT is required for worker startup")
    validate_config_endpoint(endpoint, config.connectivity_test_enabled)
    if config.connectivity_test_enabled and endpoint != "http://127.0.0.1:3001/api/internal/voice-agent/config":
        raise SystemExit("Connectivity worker requires exact local configuration endpoint")
    async def loader(organization_id: str, agent_id: str, room_name: str):
        return await asyncio.to_thread(fetch_runtime_config, config, endpoint, organization_id, agent_id, room_name)
    server, cli = create_livekit_server(config, loader)
    cli.run_app(server)

if __name__ == "__main__":
    main()
