# -*- coding: utf-8 -*-
"""Canvas 피드 읽기 (app/canvas.py): 주소 검사, iCal 파싱, 요청 간격 제한, 오류 처리.

    .venv\\Scripts\\python.exe tests\\canvastest.py

실제 Canvas에는 접속하지 않습니다. HTTP 동작은 이 PC 안(127.0.0.1)의 가짜 서버로 확인합니다.
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import canvas  # noqa: E402
from app.canvas import Canvas, CanvasError, FeedRejected  # noqa: E402


def local(utc_stamp):
    """What a UTC due time reads as on this PC (the app shows local time)."""
    d = datetime.strptime(utc_stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).astimezone()
    return d.date().isoformat(), d.strftime("%H:%M")


# Canvas-style feed: a folded line, escaped text, a lecture (not an assignment),
# an all-day assignment, a quiz without the usual UID, a midnight deadline.
FEED = "\r\n".join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Instructure//Canvas//EN",
    "X-WR-CALNAME:홍길동 Calendar (Canvas)",
    "BEGIN:VEVENT",
    "DTSTART:20261122T145900Z",
    "DTEND:20261122T145900Z",
    "SUMMARY:Homework 3 (11/22 자정까지) [CSE2010]",
    "UID:event-assignment-9001",
    "URL;VALUE=URI:https://canvas.example.ac.kr/courses/77/assignments/9001",
    "DESCRIPTION:첫 줄\\n둘째\\, 줄",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261112T010000Z",
    "SUMMARY:중간 강의 [CSE2010]",
    "UID:event-calendar-event-55",
    "URL;VALUE=URI:https://canvas.example.ac.kr/calendar?event_id=55",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261120",
    "SUMMARY:Weekly Report (Week11) [ENG",
    " 101]",
    "UID:event-assignment-9002",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART:20261118T050000Z",
    "SUMMARY:Quiz8",
    "UID:something-else-1",
    "URL:https://canvas.example.ac.kr/courses/12/quizzes/8",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;TZID=Asia/Seoul:20261125T000000",
    "SUMMARY:Project 4 [CSE2010]",
    "UID:event-assignment-9003",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:마감일 없는 과제",
    "UID:event-assignment-9004",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
])


class UrlTest(unittest.TestCase):
    def test_accepts_feed_links(self):
        u = "https://canvas.example.ac.kr/feeds/calendars/user_AbC123xyz.ics"
        self.assertEqual(canvas.normalize_url(u), u)
        self.assertEqual(canvas.normalize_url("  webcal://Canvas.Example.ac.kr/feeds/calendars/user_A.ics "),
                         "https://canvas.example.ac.kr/feeds/calendars/user_A.ics")
        # query/fragment dropped - the feed needs neither
        self.assertEqual(canvas.normalize_url(u + "?x=1#y"), u)

    def test_rejects_everything_else(self):
        for bad in ("", "http://canvas.example.ac.kr/feeds/calendars/user_A.ics",
                    "https://canvas.example.ac.kr/api/v1/calendar_events?type=assignment",
                    "https://canvas.example.ac.kr/feeds/calendars/../../login.ics",
                    "https://me:pw@canvas.example.ac.kr/feeds/calendars/user_A.ics",
                    "file:///C:/feeds/calendars/user_A.ics", "javascript:alert(1)"):
            with self.assertRaises(CanvasError, msg=bad):
                canvas.normalize_url(bad)


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.items = {it["uid"]: it for it in canvas.parse_assignments(FEED)}

    def test_only_assignments_with_dates(self):
        self.assertEqual(sorted(self.items),
                         ["event-assignment-9001", "event-assignment-9002",
                          "event-assignment-9003", "something-else-1"])

    def test_utc_due_becomes_local(self):
        it = self.items["event-assignment-9001"]
        d, t = local("20261122T145900Z")
        self.assertEqual((it["date"], it["time"]), (d, t))
        self.assertEqual(it["course"], "CSE2010")
        self.assertEqual(it["title"], "Homework 3 (11/22 자정까지) [CSE2010]")
        self.assertEqual(it["url"], "https://canvas.example.ac.kr/courses/77/assignments/9001")

    def test_all_day_and_folded_line(self):
        it = self.items["event-assignment-9002"]
        self.assertEqual((it["date"], it["time"]), ("2026-11-20", ""))
        self.assertEqual(it["title"], "Weekly Report (Week11) [ENG101]")
        self.assertEqual(it["course"], "ENG101")

    def test_quiz_found_by_link(self):
        it = self.items["something-else-1"]
        self.assertEqual(it["course"], "")
        self.assertEqual((it["date"], it["time"]), local("20261118T050000Z"))

    def test_midnight_deadline_sits_on_the_evening_before(self):
        it = self.items["event-assignment-9003"]
        # TZID needs a tz database; without one the wall time is read as local
        self.assertEqual((it["date"], it["time"]), ("2026-11-24", "23:59"))
        self.assertEqual(it["due"], "2026-11-25 00:00")

    def test_garbage_is_harmless(self):
        self.assertEqual(canvas.parse_assignments(""), [])
        self.assertEqual(canvas.parse_assignments("BEGIN:VEVENT\nDTSTART:nope\nUID:event-assignment-1\nEND:VEVENT"), [])


class StateTest(unittest.TestCase):
    URL = "https://canvas.example.ac.kr/feeds/calendars/user_A.ics"

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.calls = 0
        self.reply = FEED

        def fake(url):
            self.calls += 1
            if isinstance(self.reply, Exception):
                raise self.reply
            return self.reply
        self.cv = Canvas(self.dir, fetcher=fake)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def age(self, **ago):
        """Pretend the last request happened `ago` back."""
        s = self.cv._read()
        t = (datetime.now(timezone.utc) - timedelta(**ago)).isoformat()
        s["lastAttempt"] = t
        if "lastFetch" in s:
            s["lastFetch"] = t
        self.cv._write(s)

    def test_needs_a_link_first(self):
        self.assertTrue(self.cv.fetch().get("needsSetup"))
        self.assertEqual(self.calls, 0)

    def test_new_flags_and_seen(self):
        self.cv.set_url(self.URL)
        r = self.cv.fetch()
        self.assertTrue(r["ok"])
        self.assertTrue(all(it["isNew"] for it in r["items"]))
        self.cv.mark_seen([it["uid"] for it in r["items"]])
        self.age(minutes=5)
        r = self.cv.fetch()
        self.assertFalse(any(it["isNew"] for it in r["items"]))
        st = self.cv.status()
        self.assertEqual((st["connected"], st["host"], st["count"]), (True, "canvas.example.ac.kr", 4))

    def test_button_is_rate_limited(self):
        self.cv.set_url(self.URL)
        self.assertTrue(self.cv.fetch()["ok"])
        r = self.cv.fetch()
        self.assertTrue(r.get("throttled"))
        self.assertEqual(self.calls, 1)
        self.age(seconds=canvas.GAP_MANUAL + 1)
        self.assertTrue(self.cv.fetch()["ok"])
        self.assertEqual(self.calls, 2)

    def test_background_refresh_is_rare(self):
        self.cv.set_url(self.URL)
        self.assertTrue(self.cv.fetch(auto=True)["ok"])
        self.age(hours=5)
        self.assertTrue(self.cv.fetch(auto=True).get("throttled"))
        self.age(hours=6, minutes=1)
        self.assertTrue(self.cv.fetch(auto=True)["ok"])
        self.assertEqual(self.calls, 2)

    def test_network_failure_retries_later(self):
        self.cv.set_url(self.URL)
        self.reply = CanvasError("offline")
        r = self.cv.fetch(auto=True)
        self.assertEqual(r, {"ok": False, "error": "offline"})
        self.age(minutes=10)
        self.assertTrue(self.cv.fetch(auto=True).get("throttled"))
        self.age(minutes=31)
        self.reply = FEED
        self.assertTrue(self.cv.fetch(auto=True)["ok"])
        self.assertEqual(self.cv.status()["error"], "")

    def test_rejected_link_stops_background_until_user_acts(self):
        self.cv.set_url(self.URL)
        self.reply = FeedRejected("거부")
        self.assertFalse(self.cv.fetch(auto=True)["ok"])
        self.assertTrue(self.cv.status()["halted"])
        self.age(days=3)
        self.assertTrue(self.cv.fetch(auto=True).get("throttled"))
        self.assertEqual(self.calls, 1)
        # the button still works, and a good answer clears the stop
        self.reply = FEED
        self.assertTrue(self.cv.fetch()["ok"])
        self.assertFalse(self.cv.status()["halted"])

    def test_disconnect_keeps_seen(self):
        self.cv.set_url(self.URL)
        self.cv.mark_seen(["event-assignment-9001"])
        self.cv.disconnect()
        self.assertFalse(self.cv.status()["connected"])
        self.cv.set_url(self.URL)
        items = {it["uid"]: it for it in self.cv.fetch()["items"]}
        self.assertFalse(items["event-assignment-9001"]["isNew"])
        self.assertTrue(items["event-assignment-9002"]["isNew"])

    def test_state_file_holds_no_password_or_cookie(self):
        self.cv.set_url(self.URL)
        self.cv.fetch()
        with open(os.path.join(self.dir, ".canvas.json"), encoding="utf-8") as f:
            keys = set(json.load(f))
        self.assertEqual(keys, {"feedUrl", "lastAttempt", "lastFetch", "lastCount"})


class HttpTest(unittest.TestCase):
    """download() against a throwaway server on 127.0.0.1."""

    @classmethod
    def setUpClass(cls):
        seen = cls.seen = []

        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(dict(self.headers))
                if self.path == "/ok.ics":
                    body, code, ctype = FEED.encode("utf-8"), 200, "text/calendar"
                elif self.path == "/login.ics":
                    body, code, ctype = b"<html>login</html>", 200, "text/html"
                elif self.path == "/boom.ics":
                    body, code, ctype = b"", 502, "text/plain"
                else:
                    body, code, ctype = b"", 404, "text/plain"
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        cls.srv = HTTPServer(("127.0.0.1", 0), H)
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def test_ok(self):
        text = canvas.download(self.base + "/ok.ics")
        self.assertEqual(len(canvas.parse_assignments(text)), 4)
        h = self.seen[-1]
        self.assertEqual(h.get("User-Agent"), canvas.USER_AGENT)
        self.assertNotIn("Cookie", h)
        self.assertNotIn("Authorization", h)

    def test_not_found_is_rejected(self):
        with self.assertRaises(FeedRejected):
            canvas.download(self.base + "/gone.ics")

    def test_login_page_is_rejected(self):
        with self.assertRaises(FeedRejected):
            canvas.download(self.base + "/login.ics")

    def test_server_error_is_retryable(self):
        with self.assertRaises(CanvasError) as cm:
            canvas.download(self.base + "/boom.ics")
        self.assertNotIsInstance(cm.exception, FeedRejected)


if __name__ == "__main__":
    unittest.main(verbosity=1)
