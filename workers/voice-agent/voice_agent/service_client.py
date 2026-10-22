import hashlib, hmac, json, secrets, time, urllib.request, urllib.parse
from .config import WorkerConfig
from .runtime import RuntimeConfig

def validate_config_endpoint(endpoint: str, connectivity_only: bool) -> None:
    url = urllib.parse.urlsplit(endpoint)
    if url.path != "/api/internal/voice-agent/config" or url.username or url.password or url.query or url.fragment:
        raise RuntimeError("worker configuration endpoint is invalid")
    if connectivity_only:
        if url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost"):
            raise RuntimeError("connectivity endpoint must be local")
    elif url.scheme != "https" or not url.hostname:
        raise RuntimeError("worker configuration endpoint must use HTTPS")

def runtime_config_from_response(payload: dict, organization_id: str, agent_id: str, session_id: str | None = None) -> RuntimeConfig:
    """Validate the minimal, non-secret configuration returned by the backend."""
    if not isinstance(payload, dict):
        raise RuntimeError("invalid worker configuration response")
    agent = payload.get("agent") if isinstance(payload.get("agent"), dict) else payload
    if agent.get("organization_id") != organization_id or agent.get("id", agent.get("agent_id")) != agent_id:
        raise PermissionError("worker configuration tenant mismatch")
    language = agent.get("language")
    instructions = agent.get("instructions")
    if not isinstance(language, str) or not language or not isinstance(instructions, str) or not instructions:
        raise RuntimeError("worker configuration is incomplete")
    source_ids = agent.get("knowledge_source_ids", ())
    if not isinstance(source_ids, (list, tuple)) or not all(isinstance(item, str) for item in source_ids):
        raise RuntimeError("worker knowledge-source configuration is invalid")
    identity = agent.get("authorized_browser_identity")
    if identity is not None and (not isinstance(identity, str) or not identity):
        raise RuntimeError("worker browser identity is invalid")
    returned_session = agent.get("session_id")
    expires_at = agent.get("session_expires_at")
    if session_id is not None and (returned_session != session_id or not isinstance(expires_at, int) or isinstance(expires_at, bool) or expires_at <= int(time.time()*1000)):
        raise PermissionError("worker session identity mismatch or expired")
    return RuntimeConfig(organization_id, agent_id, language, instructions, agent.get("voice_id"), tuple(source_ids), identity, returned_session, expires_at)
def signed_config_request(config:WorkerConfig, endpoint:str, organization_id:str, agent_id:str, room_name:str, timeout:float=5.0)->dict:
    if not config.shared_secret: raise RuntimeError("worker shared secret is missing")
    if not room_name.startswith(f"voicepilot:{organization_id}:{agent_id}:") or len(room_name.split(":")) != 4: raise ValueError("invalid scoped room name")
    body=json.dumps({"organization_id":organization_id,"agent_id":agent_id,"room_name":room_name},separators=(",",":")); timestamp=str(int(time.time()*1000)); nonce=secrets.token_urlsafe(24); path=urllib.parse.urlsplit(endpoint).path; canonical=f"POST\n{path}\n{timestamp}\n{nonce}\n{body}"; signature=hmac.new(config.shared_secret.encode(),canonical.encode(),hashlib.sha256).hexdigest(); request=urllib.request.Request(endpoint,data=body.encode(),headers={"content-type":"application/json","x-voice-worker-timestamp":timestamp,"x-voice-worker-nonce":nonce,"x-voice-worker-signature":signature},method="POST")
    try:
        with urllib.request.urlopen(request,timeout=timeout) as response:
            if response.status!=200: raise RuntimeError("configuration request rejected")
            return json.loads(response.read())
    except Exception as exc: raise RuntimeError("configuration request failed") from exc

def fetch_runtime_config(config: WorkerConfig, endpoint: str, organization_id: str, agent_id: str, room_name: str, timeout: float = 5.0) -> RuntimeConfig:
    session_id = room_name.split(":")[-1]
    return runtime_config_from_response(signed_config_request(config, endpoint, organization_id, agent_id, room_name, timeout), organization_id, agent_id, session_id)
