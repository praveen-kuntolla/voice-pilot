def authorize_agent(*, authenticated_user_id: str, requested_organization_id: str, requested_agent_id: str, membership_organization_id: str | None, agent_organization_id: str | None) -> None:
    if not authenticated_user_id or not membership_organization_id:
        raise PermissionError("authentication required")
    if membership_organization_id != requested_organization_id or agent_organization_id != requested_organization_id:
        raise PermissionError("organization mismatch")
    if not requested_agent_id:
        raise PermissionError("agent required")
