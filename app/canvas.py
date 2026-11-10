# -*- coding: utf-8 -*-
"""Canvas LMS assignments, read from the student's own calendar feed.

Canvas gives every user a private iCalendar link (Calendar -> "Calendar Feed") for
subscribing from Google Calendar, Outlook or a phone. Reading it is the same
request those apps make: one HTTPS GET, with no password, no session cookie, no API
token and no page scraping. From the school network it is indistinguishable from
opening Canvas in a browser, and it is made at most every few hours.

This side only downloads and parses. The page owns the events list, so it turns the
items into to-dos itself; here we remember which assignments were already offered,
so a to-do the user deletes is not brought back by the next fetch.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, time, timedelta, timezone

USER_AGENT = "MyScheduler/1.0 (personal Canvas calendar feed reader)"
TIMEOUT = 20
MAX_BYTES = 8 * 1024 * 1024

# How often the feed may be requested. The button is for "I just saw a new
# assignment"; the background refresh is deliberately rare - deadlines do not move
# by the minute, and calendar apps poll these feeds every few hours too.
GAP_MANUAL = 60               # seconds between button presses
GAP_AUTO = 6 * 3600           # background refresh after a good fetch
GAP_AUTO_RETRY = 30 * 60      # background retry after a network failure

FEED_PATH = re.compile(r"^/feeds/calendars/[A-Za-z0-9_\-]+\.ics$")
ASSIGNMENT_URL = re.compile(r"/(assignments|quizzes|discussion_topics)/\d+")
COURSE_TAG = re.compile(r"\s*\[([^\[\]]+)\]\s*$")


class CanvasError(Exception):
    """A failure worth showing to the user as-is."""


class FeedRejected(CanvasError):
    """The server answered but refused the link (wrong, expired or reset).
    Retrying on a timer would only pile up failed requests, so background
    refresh stops until the user presses the button or pastes a new link."""


# ---------------------------------------------------------------- the link

def normalize_url(raw: str) -> str:
    """Accepts only a Canvas feed link, so the app never fetches anything else."""
    u = (raw or "").strip().strip("\"'<>")
    if u.lower().startswith("webcal://"):
        u = "https://" + u[len("webcal://"):]
    try:
        p = urllib.parse.urlsplit(u)
    except ValueError:
        raise CanvasError("주소 형식이 올바르지 않습니다")
    if p.scheme.lower() != "https" or not p.hostname or p.username or p.password:
        raise CanvasError("https:// 로 시작하는 Canvas 캘린더 피드 주소를 넣어주세요")
    if not FEED_PATH.match(p.path):
        raise CanvasError("캘린더 피드 주소가 아닙니다 — 주소가 /feeds/calendars/….ics 로 끝나야 합니다")
    return urllib.parse.urlunsplit(("https", p.netloc.lower(), p.path, "", ""))


def download(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/calendar, */*;q=0.5",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as err:
        err.close()
        if err.code in (401, 403, 404, 410):
            raise FeedRejected("Canvas가 이 주소를 거부했습니다 (%d) — 피드 주소를 다시 복사해 넣어주세요" % err.code)
        raise CanvasError("Canvas 서버 오류 (%d) — 잠시 뒤 다시 시도해주세요" % err.code)
    except (urllib.error.URLError, OSError) as err:
        reason = getattr(err, "reason", err)
        raise CanvasError("Canvas에 연결하지 못했습니다 (%s)" % reason)
    if len(raw) > MAX_BYTES:
        raise CanvasError("피드가 너무 큽니다")
    text = raw.decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text[:4096]:
        # an expired link can land on the login page rather than a 404
        raise FeedRejected("캘린더가 아닌 응답이 왔습니다 — 피드 주소를 다시 복사해 넣어주세요")
    return text


# ---------------------------------------------------------------- iCalendar

def _unfold(text: str) -> list:
    """RFC 5545 folds long lines by starting the continuation with a space."""
    out = []
    for line in re.split(r"\r\n|\n|\r", text):
        if line[:1] in (" ", "\t") and out:
            out[-1] += line[1:]
        elif line:
            out.append(line)
    return out


def _prop(line: str):
    """'NAME;P=V;P2="a:b":value' -> (NAME, {P: V, P2: a:b}, value)"""
    quoted = False
    for i, ch in enumerate(line):
        if ch == '"':
            quoted = not quoted
        elif ch == ":" and not quoted:
            break
    else:
        return None
    head, value = line[:i], line[i + 1:]
    parts = head.split(";")
    params = {}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        params[k.strip().upper()] = v.strip().strip('"')
    return parts[0].strip().upper(), params, value


def _text(v: str) -> str:
    return re.sub(r"\\([\\;,nN])",
                  lambda m: "\n" if m.group(1) in "nN" else m.group(1), v).strip()


def _when(value: str, params: dict):
    """DTSTART -> (local date, local time or None)."""
    v = value.strip()
    if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", v):
        try:
            return date(int(v[:4]), int(v[4:6]), int(v[6:8])), None
        except ValueError:
            return None, None
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)", v)
    if not m:
        return None, None
    try:
        d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                     int(m.group(4)), int(m.group(5)), int(m.group(6) or 0))
    except ValueError:
        return None, None
    if m.group(7):
        d = d.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    elif params.get("TZID"):
        try:
            from zoneinfo import ZoneInfo
            d = d.replace(tzinfo=ZoneInfo(params["TZID"])).astimezone().replace(tzinfo=None)
        except Exception:
            pass   # no tz database on this machine: read it as local time
    return d.date(), d.time()


def _is_assignment(uid: str, url: str) -> bool:
    # Canvas names its UIDs event-assignment-<id> / event-calendar-event-<id>;
    # the link is the fallback in case a school's instance differs.
    return uid.startswith("event-assignment") or bool(ASSIGNMENT_URL.search(url or ""))


def parse_assignments(text: str) -> list:
    """Assignments (incl. quizzes and graded discussions) that have a due date.
    Plain calendar events such as lectures or office hours are left out."""
    found = {}
    cur = None
    for line in _unfold(text):
        up = line.upper()
        if up == "BEGIN:VEVENT":
            cur = {}
            continue
        if up == "END:VEVENT":
            if cur is not None:
                item = _shape(cur)
                if item:
                    found[item["uid"]] = item
            cur = None
            continue
        if cur is None:
            continue
        p = _prop(line)
        if p and p[0] not in cur:
            cur[p[0]] = p
    return sorted(found.values(), key=lambda it: (it["date"], it["time"] or "99", it["title"]))


def _shape(props: dict):
    def val(name):
        p = props.get(name)
        return p[2] if p else ""

    uid = _text(val("UID"))
    url = _text(val("URL"))
    if not uid or not _is_assignment(uid, url):
        return None
    if "DTSTART" not in props:
        return None
    _, params, raw = props["DTSTART"]
    d, t = _when(raw, params)
    if d is None:
        return None

    due = d.isoformat() + (" %02d:%02d" % (t.hour, t.minute) if t else "")
    # "자정까지" is stored as 00:00 of the next day; as a to-do it belongs to the
    # evening before, which is when it actually has to be finished
    if t is not None and t == time(0, 0):
        d -= timedelta(days=1)
        t = time(23, 59)

    summary = _text(val("SUMMARY")) or "(제목 없음)"
    m = COURSE_TAG.search(summary)
    return {
        "uid": uid,
        "title": summary,
        "course": m.group(1).strip() if m else "",
        "date": d.isoformat(),
        "time": "%02d:%02d" % (t.hour, t.minute) if t else "",
        "due": due,
        "url": url,
    }


# ---------------------------------------------------------------- state

def _iso(s):
    try:
        return datetime.fromisoformat(s) if s else None
    except ValueError:
        return None


class Canvas:
    def __init__(self, data_dir: str, fetcher=download):
        self.path = os.path.join(data_dir, ".canvas.json")
        self._fetch = fetcher

    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
                return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, d: dict) -> None:
        folder = os.path.dirname(self.path)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp_canvas_", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    def status(self) -> dict:
        s = self._read()
        url = s.get("feedUrl") or ""
        return {
            "connected": bool(url),
            "host": urllib.parse.urlsplit(url).hostname if url else "",
            "lastFetch": s.get("lastFetch"),
            "count": s.get("lastCount", 0),
            "error": s.get("lastError") or "",
            "halted": bool(s.get("halted")),
        }

    def set_url(self, raw: str) -> dict:
        url = normalize_url(raw)
        s = self._read()
        s["feedUrl"] = url
        for k in ("lastAttempt", "lastFetch", "lastError", "halted", "lastCount"):
            s.pop(k, None)
        self._write(s)
        return self.status()

    def disconnect(self) -> None:
        """Forgets the link. The list of already-offered assignments stays, so
        reconnecting later does not resurrect to-dos that were deleted."""
        s = self._read()
        for k in ("feedUrl", "lastAttempt", "lastFetch", "lastError", "halted", "lastCount"):
            s.pop(k, None)
        self._write(s)

    def mark_seen(self, uids: list) -> None:
        s = self._read()
        seen = set(s.get("seen") or [])
        seen.update(u for u in uids if isinstance(u, str) and u)
        s["seen"] = sorted(seen)
        self._write(s)

    def _wait(self, s: dict, auto: bool, now: datetime) -> int:
        """Seconds until a fetch is allowed again (0 = go)."""
        def since(key):
            t = _iso(s.get(key))
            return (now - t).total_seconds() if t else None

        attempt = since("lastAttempt")
        if not auto:
            return 0 if attempt is None else max(0, int(GAP_MANUAL - attempt))
        if s.get("halted"):
            return -1                      # waits for the user, not the clock
        ok = since("lastFetch")
        if ok is not None and ok < GAP_AUTO:
            return int(GAP_AUTO - ok)
        if attempt is not None and attempt < GAP_AUTO_RETRY:
            return int(GAP_AUTO_RETRY - attempt)
        return 0

    def fetch(self, auto: bool = False) -> dict:
        s = self._read()
        url = s.get("feedUrl")
        if not url:
            return {"ok": False, "needsSetup": True}
        now = datetime.now(timezone.utc)
        wait = self._wait(s, auto, now)
        if wait:
            return {"ok": False, "throttled": True, "wait": wait}

        s["lastAttempt"] = now.isoformat()
        self._write(s)
        try:
            items = parse_assignments(self._fetch(url))
        except CanvasError as err:
            s["lastError"] = str(err)
            if isinstance(err, FeedRejected):
                s["halted"] = True
            self._write(s)
            return {"ok": False, "error": str(err)}

        seen = set(s.get("seen") or [])
        for it in items:
            it["isNew"] = it["uid"] not in seen
        s["lastFetch"] = now.isoformat()
        s["lastCount"] = len(items)
        s.pop("lastError", None)
        s.pop("halted", None)
        self._write(s)
        return {"ok": True, "items": items, "fetchedAt": s["lastFetch"]}
