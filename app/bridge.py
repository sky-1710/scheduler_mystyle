# -*- coding: utf-8 -*-
"""The object index.html talks to.

Exposed to the page as window.__shell (over QWebChannel), giving it direct file
access and native toasts — the two things a page in a browser cannot have.

QWebChannel slots run on the GUI thread, so anything that touches the network runs
on a worker instead and reports back through a signal. Google sync makes one HTTPS
round trip per event; doing that inline froze the window for seconds at a time.
"""
from __future__ import annotations

import json
import traceback

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal, Slot
from PySide6.QtMultimedia import QMediaDevices

from . import sound, toast
from .gcal import GCal, NeedsLogin, NotConfigured


class _Job(QRunnable):
    """Runs one callable off the GUI thread and hands the JSON result to `done`."""

    def __init__(self, fn, done):
        super().__init__()
        self.fn = fn
        self.done = done

    def run(self) -> None:
        try:
            out = self.fn()
        except NotConfigured as err:
            out = {"ok": False, "needsSetup": True, "error": str(err)}
        except NeedsLogin as err:
            out = {"ok": False, "needsLogin": True, "error": str(err)}
        except Exception as err:
            traceback.print_exc()
            out = {"ok": False, "error": str(err)}
        self.done(json.dumps(out, ensure_ascii=False))


class Bridge(QObject):
    # emitted (from a worker) when an async Google operation finishes
    gcalResult = Signal(str)
    # earphones or a Bluetooth device came or went - the widget's picker re-lists
    audioOutputsChanged = Signal()

    def __init__(self, storage, on_quit=None):
        super().__init__()
        self.storage = storage
        self._on_quit = on_quit
        self.gcal = GCal(storage.dir)
        self._gcal_busy = False
        self._media = QMediaDevices(self)
        self._media.audioOutputsChanged.connect(self.audioOutputsChanged)

    # ---------- data ----------

    @Slot(result=str)
    def load(self) -> str:
        """Returns the whole saved payload as JSON."""
        try:
            return json.dumps(self.storage.load(), ensure_ascii=False)
        except Exception as err:
            return json.dumps({"__error": str(err)})

    @Slot(str, result=str)
    def save(self, payload_json: str) -> str:
        try:
            res = self.storage.save(json.loads(payload_json))
            return json.dumps(res, ensure_ascii=False)
        except Exception as err:
            return json.dumps({"ok": False, "error": str(err)})

    @Slot(result=str)
    def info(self) -> str:
        return json.dumps({
            "dataFile": self.storage.path,
            "dataDir": self.storage.dir,
            "snapshots": self.storage.snapshots(),
            "prefs": self.storage.prefs(),
        }, ensure_ascii=False)

    # ---------- notifications ----------

    @Slot(str, str, str, result=bool)
    def notify(self, title: str, body: str, style: str) -> bool:
        return toast.show(title, body, style or "normal")

    @Slot(str, str, str, str, result=str)
    def alarm(self, title: str, body: str, device_id: str, device_name: str) -> str:
        """Pomodoro alarm: a toast that stays until dismissed, plus a chime on the
        output device picked in the page (empty = system default)."""
        toast.show(title, body, "alarm", silent=True)
        return self.testAlarm(device_id, device_name)

    @Slot(result=str)
    def audioOutputs(self) -> str:
        try:
            return json.dumps(sound.list_outputs(), ensure_ascii=False)
        except Exception as err:
            print("listing audio outputs failed:", err)
            return "[]"

    @Slot(str, str, result=str)
    def testAlarm(self, device_id: str, device_name: str) -> str:
        """Just the chime, so a device can be tried before a session ends on it."""
        try:
            return sound.play_alarm(device_id, device_name)
        except Exception as err:
            print("alarm sound failed:", err)
            return ""

    # ---------- google calendar ----------

    @Slot(result=str)
    def gcalStatus(self) -> str:
        """Local file checks only — safe to run inline."""
        try:
            st = self.gcal.status()
            st["busy"] = self._gcal_busy
            return json.dumps(st, ensure_ascii=False)
        except Exception as err:
            return json.dumps({"configured": False, "error": str(err)})

    def _finish(self, payload: str) -> None:
        self._gcal_busy = False
        try:
            self.gcalResult.emit(payload)
        except RuntimeError:
            pass   # the app quit while this sync was still in flight

    def _start(self, fn) -> bool:
        if self._gcal_busy:
            return False          # never stack syncs on top of each other
        self._gcal_busy = True
        QThreadPool.globalInstance().start(_Job(fn, self._finish))
        return True

    @Slot()
    def gcalSyncAsync(self) -> None:
        """Pushes local events to Google on a worker; result arrives via gcalResult."""
        def work():
            data = self.storage.load()
            return self.gcal.sync(data.get("events", []))
        if not self._start(work):
            self.gcalResult.emit(json.dumps({"ok": False, "busy": True}))

    @Slot()
    def gcalConnectAsync(self) -> None:
        """Runs the consent flow on a worker — it blocks until the browser login
        completes, which would otherwise freeze the window for minutes."""
        def work():
            self.gcal.service(interactive=True)
            data = self.storage.load()
            return self.gcal.sync(data.get("events", []))
        if not self._start(work):
            self.gcalResult.emit(json.dumps({"ok": False, "busy": True}))

    @Slot(result=str)
    def gcalDisconnect(self) -> str:
        try:
            self.gcal.disconnect()
            return json.dumps({"ok": True})
        except Exception as err:
            return json.dumps({"ok": False, "error": str(err)})

    # ---------- window ----------

    @Slot()
    def quit(self) -> None:
        if self._on_quit:
            self._on_quit()
