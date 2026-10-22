from voice_agent.runtime import RuntimeConfig, conversation
for state, message in conversation(RuntimeConfig("local-org", "local-agent", "en-US", "Be concise")):
    print(f"{state}: {message}")
