from dataclasses import dataclass, field
from typing import Literal

State = Literal["greeting", "listening", "understanding", "responding", "speaking", "ended"]
@dataclass(frozen=True)
class RuntimeConfig:
    organization_id: str
    agent_id: str
    language: str
    instructions: str
    voice_id: str | None = None
    knowledge_source_ids: tuple[str, ...] = ()
    authorized_browser_identity: str | None = None
    session_id: str | None = None
    session_expires_at: int | None = None
@dataclass
class MockRuntime:
    config: RuntimeConfig
    events: list[tuple[State, str]] = field(default_factory=list)
    def run(self, user_text: str = "Hello") -> list[tuple[State, str]]:
        self.events=[("greeting",f"Hello. I am your {self.config.language} voice assistant."),("listening","I am listening."),("understanding",user_text),("responding","This is a deterministic local mock response."),("speaking","This is a deterministic local mock response."),("ended","Mock session ended.")]
        return self.events
def conversation(config: RuntimeConfig, user_text: str = "Hello") -> list[tuple[State, str]]:
    return MockRuntime(config).run(user_text)
