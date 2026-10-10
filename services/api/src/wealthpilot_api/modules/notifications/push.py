"""Push delivery behind an interface. Expo push is used only when ``WP_EXPO_PUSH_ENABLED=1``; otherwise a no-op
sender is used (notifications still land in the in-app inbox). Bodies never contain amounts (FR-NOT-002)."""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from ...core.config import Settings

log = logging.getLogger("wealthpilot.push")


class PushSender(Protocol):
    def send(self, tokens: list[str], title: str, body: str, data: dict[str, str] | None = None) -> int: ...


class NoopPushSender:
    def __init__(self) -> None:
        self.sent: list[tuple[list[str], str, str]] = []

    def send(self, tokens: list[str], title: str, body: str, data: dict[str, str] | None = None) -> int:
        self.sent.append((list(tokens), title, body))
        return 0


class ExpoPushSender:
    def __init__(self, http: httpx.Client, url: str, access_token: str | None) -> None:
        self.http = http
        self.url = url
        self.access_token = access_token

    def send(self, tokens: list[str], title: str, body: str, data: dict[str, str] | None = None) -> int:
        if not tokens:
            return 0
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        messages = [{"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"} for t in tokens]
        sent = 0
        for i in range(0, len(messages), 100):  # Expo accepts up to 100 messages per request
            chunk = messages[i : i + 100]
            try:
                r = self.http.post(self.url, json=chunk, headers=headers, timeout=10)
                r.raise_for_status()
                sent += len(chunk)
            except httpx.HTTPError as exc:
                log.warning("expo push failed", extra={"error_type": type(exc).__name__})
        return sent


def make_push_sender(settings: Settings, http: httpx.Client) -> PushSender:
    if settings.expo_push_enabled:
        return ExpoPushSender(http, settings.expo_push_url, settings.expo_access_token)
    return NoopPushSender()
