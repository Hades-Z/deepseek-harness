"""HTTP service: one runtime per process, real cancellation, honest status."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import pytest

from deepseek_harness.api import DeepSeekHarnessConfig
from deepseek_harness.service import HarnessService


@dataclass
class _FakeResult:
    final_response: str
    finish_reason: str | None
    session_id: str
    events: list
    notifications: list


class _FakeHarness:
    def __init__(self) -> None:
        self.spawns = 0
        self._initialized = False
        self.prompts: list[str] = []
        self.cancelled: list[str] = []
        self.cancel_failure: Exception | None = None
        self.gate = threading.Event()
        self.gate.set()
        # ``cancel_session`` blocks here so a test can observe the unsettled
        # window; a released gate stands for a confirmed stop.
        self.cancel_gate = threading.Event()
        self.cancel_gate.set()

    def start(self) -> None:
        # Mirrors the real SDK: starting an already-initialized runtime is a
        # no-op, so only distinct instances contribute a spawn.
        if self._initialized:
            return
        self._initialized = True
        self.spawns += 1

    def run(self, instruction, *, session_id=None, before_deliver=None):
        if before_deliver is not None:
            before_deliver()
        self.prompts.append(session_id or "")
        self.gate.wait(timeout=5)
        return _FakeResult("done", "completed", session_id or "", [], [])

    def cancel_session(self, session_id: str) -> None:
        self.cancel_gate.wait(timeout=5)
        self.cancelled.append(session_id)
        if self.cancel_failure is not None:
            raise self.cancel_failure
        self.gate.set()


def _service(harness: _FakeHarness) -> HarnessService:
    service = HarnessService(DeepSeekHarnessConfig())
    service._harness = harness
    return service


def test_concurrent_runs_build_and_start_one_runtime(monkeypatch):
    import deepseek_harness.service as service_module

    built = []

    class SlowStartHarness(_FakeHarness):
        def start(self) -> None:
            # A slow start widens the race window: without the service's own
            # lock every concurrent caller would get past construction.
            time.sleep(0.05)
            super().start()

    slow = SlowStartHarness()

    def build(_config):
        built.append(1)
        return slow

    monkeypatch.setattr(service_module, "DeepSeekHarness", build)
    service = HarnessService(DeepSeekHarnessConfig())
    threads = [
        threading.Thread(target=lambda: service.start_run({"instruction": "work"}))
        for _ in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    # ``start_run`` only queues the work on a daemon thread, so wait for the
    # runtime to appear and then let any wrongly racing caller construct one.
    deadline = time.monotonic() + 5
    while slow.spawns == 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.2)
    assert len(built) == 1, f"constructed {len(built)} runtimes"
    assert slow.spawns == 1, f"launched {slow.spawns} runtimes"


def test_cancel_reports_cancelled_only_after_the_session_settles():
    harness = _FakeHarness()
    harness.gate.clear()
    harness.cancel_gate.clear()
    service = _service(harness)
    run_id = service.start_run({"instruction": "work"})
    deadline = time.monotonic() + 5
    while not harness.prompts and time.monotonic() < deadline:
        time.sleep(0.01)
    assert harness.prompts
    observed = []
    canceller = threading.Thread(target=lambda: observed.append(service.cancel(run_id)))
    canceller.start()
    deadline = time.monotonic() + 5
    while service.run_state(run_id)["status"] != "cancelling" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert observed == [], "cancel returned before the session settled"
    assert service.run_state(run_id)["status"] == "cancelling"
    harness.gate.set()
    harness.cancel_gate.set()
    canceller.join(timeout=5)
    assert observed == [True]
    assert harness.cancelled == [harness.prompts[0]]
    assert service.run_state(run_id)["status"] == "cancelled"


def test_a_cancellation_failure_is_reported_not_claimed_as_success():
    harness = _FakeHarness()
    harness.gate.clear()
    harness.cancel_gate.set()
    harness.cancel_failure = RuntimeError("refused")
    service = _service(harness)
    run_id = service.start_run({"instruction": "work"})
    deadline = time.monotonic() + 5
    while not harness.prompts and time.monotonic() < deadline:
        time.sleep(0.01)
    with pytest.raises(RuntimeError):
        service.cancel(run_id)
    assert service.run_state(run_id)["status"] == "failed"
    harness.gate.set()


def test_a_run_cancelled_before_its_prompt_is_delivered_never_starts_it():
    """A cancellation that arrives while the runtime is starting must win.

    The worker publishes nothing after it sees the intent, so a run cannot
    report ``cancelled`` while its prompt still reaches the harness.
    """
    harness = _FakeHarness()
    service = _service(harness)
    # Hold the start so the cancellation lands before any prompt can be sent.
    start_gate = threading.Event()
    original = service._ensure_started

    def slow_start():
        start_gate.wait(timeout=5)
        return original()

    service._ensure_started = slow_start  # type: ignore[method-assign]
    run_id = service.start_run({"instruction": "work"})
    assert service.cancel(run_id) is True
    start_gate.set()
    deadline = time.monotonic() + 5
    while service.run_state(run_id)["status"] != "cancelled" and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.2)
    assert harness.prompts == [], f"a cancelled run still prompted: {harness.prompts}"
    assert service.run_state(run_id)["status"] == "cancelled"


def test_an_explicit_session_id_is_reused_and_validated():
    harness = _FakeHarness()
    service = _service(harness)
    service.start_run({"instruction": "work", "session_id": "case-1"})
    deadline = time.monotonic() + 5
    while not harness.prompts and time.monotonic() < deadline:
        time.sleep(0.01)
    assert harness.prompts == ["case-1"]
    for bad in ("", 7, None):
        if bad is None:
            continue
        with pytest.raises(ValueError):
            service.start_run({"instruction": "work", "session_id": bad})


def test_http_cancel_returns_the_real_status(monkeypatch):
    import json
    import urllib.request
    from http.server import ThreadingHTTPServer

    from deepseek_harness.service import _handler

    harness = _FakeHarness()
    service = _service(harness)
    run_id = service.start_run({"instruction": "done"})
    deadline = time.monotonic() + 5
    while service.run_state(run_id)["status"] != "completed" and time.monotonic() < deadline:
        time.sleep(0.01)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/v1/runs/{run_id}/cancel",
            data=b"", method="POST",
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            assert json.load(response)["status"] == "completed"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_the_http_service_has_a_finite_control_request_budget(monkeypatch):
    from deepseek_harness.service import config_from_environment

    for key in ("LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "LLM_API_KEY"):
        monkeypatch.setenv(key, "unit-test")
    monkeypatch.delenv("DSH_REQUEST_TIMEOUT_SECONDS", raising=False)
    assert config_from_environment().request_timeout_seconds == 30.0
