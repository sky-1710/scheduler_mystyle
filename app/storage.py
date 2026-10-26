# -*- coding: utf-8 -*-
"""Reads and writes data/schedule_data.json directly.

This replaces the browser's File System Access "폴더 연결" step: the shell owns the
folder, so saving works from the first launch with nothing to grant.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from datetime import date, datetime, timedelta

DATA_FILENAME = "schedule_data.json"
SNAPSHOT_RE = re.compile(r"^schedule_backup_\d{4}-\d{2}-\d{2}\.json$")
SNAPSHOT_KEEP = 8
SNAPSHOT_EVERY_DAYS = 7

# Every dataset the app persists, in the order index.html lists them.
DATASETS = (
    "events", "blocks", "blockMin", "blockOff", "blockExtra", "timeLog", "dayTasks", "dayGoals", "dayMemos",
    "dayBad", "dayRatings", "sleepLog", "habits", "habitChecks", "todoDone",
    "categories", "dayImages",
)
LIST_DATASETS = {"events", "habits", "categories"}


class Storage:
    def __init__(self, data_dir: str):
        self.dir = data_dir
        os.makedirs(self.dir, exist_ok=True)
        os.makedirs(os.path.join(self.dir, "photo"), exist_ok=True)
        self.path = os.path.join(self.dir, DATA_FILENAME)
        self._state_path = os.path.join(self.dir, ".shell_state.json")

    # ---------- main file ----------

    def load(self) -> dict:
        """Returns the saved payload, or empty datasets when there is no file yet."""
        if not os.path.exists(self.path):
            return self._empty()
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return self._empty()
        if not isinstance(data.get("events"), list):
            return self._empty()
        out = self._empty()
        out.update({k: data[k] for k in DATASETS if k in data})
        out["version"] = data.get("version", 3)
        out["exported"] = data.get("exported", "")
        return out

    def save(self, payload: dict) -> dict:
        """Writes the payload atomically, then rolls a weekly snapshot."""
        data = {"version": 3, "exported": datetime.now().astimezone().isoformat()}
        for k in DATASETS:
            if k in payload:
                data[k] = payload[k]
        self._atomic_write(self.path, data)
        snap = self._maybe_snapshot(data)
        return {"ok": True, "path": self.path, "snapshot": snap}

    def _empty(self) -> dict:
        d = {k: ([] if k in LIST_DATASETS else {}) for k in DATASETS}
        d["version"] = 3
        d["exported"] = ""
        return d

    @staticmethod
    def _atomic_write(path: str, data: dict) -> None:
        """Write to a temp file in the same folder, then replace — a crash mid-write
        can never leave a truncated schedule_data.json behind."""
        folder = os.path.dirname(path)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp_", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    # ---------- weekly snapshots (same rule the browser build used) ----------

    def _maybe_snapshot(self, data: dict):
        today = date.today().isoformat()
        last = self._read_state().get("lastSnapshot")
        if last:
            try:
                if date.fromisoformat(today) - date.fromisoformat(last) < timedelta(days=SNAPSHOT_EVERY_DAYS):
                    return None
            except ValueError:
                pass
        snap = {k: v for k, v in data.items() if k != "dayImages"}  # photos stay in the main file
        name = "schedule_backup_%s.json" % today
        self._atomic_write(os.path.join(self.dir, name), snap)
        self._write_state({"lastSnapshot": today})
        self._prune_snapshots()
        return name

    def _prune_snapshots(self) -> None:
        names = sorted((n for n in os.listdir(self.dir) if SNAPSHOT_RE.match(n)), reverse=True)
        for old in names[SNAPSHOT_KEEP:]:
            try:
                os.unlink(os.path.join(self.dir, old))
            except OSError:
                pass

    def _read_state(self) -> dict:
        try:
            with open(self._state_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _write_state(self, d: dict) -> None:
        try:
            with open(self._state_path, "w", encoding="utf-8") as f:
                json.dump(d, f)
        except OSError:
            pass

    # ---------- first-run preferences ----------

    def prefs(self) -> dict:
        """Settings carried over from the browser build (theme, and anything later)."""
        path = os.path.join(self.dir, ".shell_prefs.json")
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    # ---------- explicit backup / restore ----------

    def export_copy(self, dest: str) -> str:
        shutil.copyfile(self.path, dest)
        return dest

    def snapshots(self) -> list:
        return sorted((n for n in os.listdir(self.dir) if SNAPSHOT_RE.match(n)), reverse=True)
