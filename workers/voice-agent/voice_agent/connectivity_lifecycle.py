"""Connectivity-only room lifecycle. No media or provider initialization."""
import asyncio
import time
from enum import Enum


class SessionState(str, Enum):
    INITIALIZING = "initializing"
    CONNECTING = "connecting"
    ACTIVE = "active"
    STOPPING = "stopping"
    STOPPED = "stopped"
    CLEANUP_FAILED = "cleanup_failed"


class ConnectivityLifecycle:
    def __init__(self, room, browser_identity: str, cleanup_timeout: float = 5.0, expires_at: int | None = None):
        if not browser_identity:
            raise ValueError("authorized browser identity is required")
        self.room = room
        self.browser_identity = browser_identity
        self.cleanup_timeout = cleanup_timeout
        self.expires_at = expires_at
        self.state = SessionState.INITIALIZING
        self.stop_reason: str | None = None
        self.authorized_present = False
        self._stop = asyncio.Event()
        self._cleanup_lock = asyncio.Lock()
        self.cleanup_attempts = 0
        self.cleanup_error: str | None = None

    def request_stop(self, reason: str) -> None:
        if self._stop.is_set():
            return
        self.stop_reason = reason
        self._stop.set()

    def participant_joined(self, participant) -> None:
        if participant.identity == self.browser_identity and not self._stop.is_set():
            self.authorized_present = True

    def participant_left(self, participant) -> None:
        if participant.identity != self.browser_identity:
            return
        self.authorized_present = False
        # A departure can arrive while ctx.connect() is still pending.
        self.request_stop("last_authorized_browser_left")

    def room_disconnected(self, *_args) -> None:
        self.request_stop("room_disconnected")

    async def wait(self, arrival_timeout: float = 15.0) -> None:
        if self._stop.is_set():
            return
        while not self._stop.is_set():
            remaining = None if self.expires_at is None else max(0.0, (self.expires_at - int(time.time() * 1000)) / 1000)
            if remaining == 0:
                self.request_stop("session_expired")
                return
            timeout = remaining
            if not self.authorized_present:
                timeout = arrival_timeout if remaining is None else min(arrival_timeout, remaining)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                if self.expires_at is not None and self.expires_at <= int(time.time() * 1000):
                    self.request_stop("session_expired")
                elif not self.authorized_present:
                    self.request_stop("authorized_browser_absent")

    async def cleanup(self) -> None:
        async with self._cleanup_lock:
            if self.state in (SessionState.STOPPED, SessionState.CLEANUP_FAILED):
                return
            self.state = SessionState.STOPPING
            self.cleanup_attempts += 1
            try:
                await asyncio.wait_for(self.room.disconnect(), timeout=self.cleanup_timeout)
            except Exception as exc:
                self.cleanup_error = type(exc).__name__
                self.state = SessionState.CLEANUP_FAILED
            else:
                self.state = SessionState.STOPPED
