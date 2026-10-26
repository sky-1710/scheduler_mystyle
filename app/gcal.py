# -*- coding: utf-8 -*-
"""Google Calendar sync — so alarms reach the phone even with this PC switched off.

Events are mirrored into a calendar of our own ("내 스케줄러"), never into the user's
existing ones, so disconnecting is just deleting that calendar. A side map file pairs
local ids with remote ids; the app's own data file is left untouched.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone


def _tz():
    """The app's configured zone, falling back to this machine's offset."""
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TIMEZONE)
    except Exception:
        return datetime.now().astimezone().tzinfo

CALENDAR_NAME = "내 스케줄러"
SCOPES = ["https://www.googleapis.com/auth/calendar"]
TIMEZONE = "Asia/Seoul"

# The app's palette -> the nearest of Calendar's fixed colour slots.
COLOR_IDS = {
    "#2383E2": "9",   # blueberry
    "#D44C47": "11",  # tomato
    "#448361": "10",  # basil
    "#CB912F": "5",   # banana
    "#9065B0": "3",   # grape
    "#C14C8A": "4",   # flamingo
    "#3E9B9B": "7",   # peacock
    "#6B9E3F": "2",   # sage
    "#D9730D": "6",   # tangerine
    "#787774": "8",   # graphite
}

RRULE_FREQ = {"daily": "DAILY", "everyN": "DAILY", "weekly": "WEEKLY",
              "monthly": "MONTHLY", "yearly": "YEARLY"}


class NotConfigured(Exception):
    """Raised when the OAuth client file has not been supplied yet."""


class NeedsLogin(Exception):
    """The stored token no longer works and the consent flow must run again.

    Expected roughly weekly while the Cloud project's publishing status is
    "Testing": Google expires those refresh tokens after 7 days.
    """


class GCal:
    def __init__(self, data_dir: str):
        self.dir = data_dir
        self.creds_path = os.path.join(data_dir, ".gcal_credentials.json")
        self.token_path = os.path.join(data_dir, ".gcal_token.json")
        self.map_path = os.path.join(data_dir, ".gcal_map.json")
        self._service = None

    # ---------------------------------------------------------------- auth

    def configured(self) -> bool:
        return os.path.exists(self.creds_path)

    def connected(self) -> bool:
        return os.path.exists(self.token_path)

    def _credentials(self, interactive: bool):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow

        if not self.configured():
            raise NotConfigured(
                "OAuth 클라이언트 파일이 없습니다: %s" % self.creds_path)

        creds = None
        if os.path.exists(self.token_path):
            try:
                creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)
            except Exception:
                creds = None
        if creds and creds.valid:
            return creds
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                self._save_token(creds)
                return creds
            except Exception as err:
                # the refresh token itself died - drop it so the next connect is clean
                self._service = None
                if os.path.exists(self.token_path):
                    os.unlink(self.token_path)
                if not interactive:
                    raise NeedsLogin(str(err))
        if not interactive:
            raise NeedsLogin("Google 계정 연결이 필요합니다")

        flow = InstalledAppFlow.from_client_secrets_file(self.creds_path, SCOPES)
        creds = flow.run_local_server(port=0, prompt="consent",
                                      authorization_prompt_message="")
        self._save_token(creds)
        return creds

    def _save_token(self, creds) -> None:
        with open(self.token_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())

    def service(self, interactive: bool = False):
        if self._service is None:
            from googleapiclient.discovery import build
            self._service = build("calendar", "v3",
                                  credentials=self._credentials(interactive),
                                  cache_discovery=False)
        return self._service

    def disconnect(self) -> None:
        self._service = None
        for p in (self.token_path, self.map_path):
            if os.path.exists(p):
                os.unlink(p)

    # ---------------------------------------------------------------- calendar

    def _calendar_id(self) -> str:
        state = self._read_map()
        cid = state.get("__calendarId")
        svc = self.service()
        if cid:
            try:
                svc.calendars().get(calendarId=cid).execute()
                return cid
            except Exception:
                pass  # deleted on the other side; fall through and make a new one

        # reuse an existing calendar of ours before creating a duplicate
        page = None
        while True:
            res = svc.calendarList().list(pageToken=page).execute()
            for item in res.get("items", []):
                if item.get("summary") == CALENDAR_NAME:
                    state["__calendarId"] = item["id"]
                    self._write_map(state)
                    return item["id"]
            page = res.get("nextPageToken")
            if not page:
                break

        made = svc.calendars().insert(
            body={"summary": CALENDAR_NAME, "timeZone": TIMEZONE}).execute()
        state["__calendarId"] = made["id"]
        state.pop("__events", None)  # a fresh calendar has none of our old ids
        self._write_map(state)
        return made["id"]

    # ---------------------------------------------------------------- mapping

    def _read_map(self) -> dict:
        try:
            with open(self.map_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _write_map(self, d: dict) -> None:
        with open(self.map_path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)

    # ---------------------------------------------------------------- shaping

    @staticmethod
    def syncable(ev: dict) -> bool:
        """Scoped to-dos belong to a week or month rather than a day, so they have
        no place on a calendar."""
        return bool(ev.get("date")) and not ev.get("scope")

    @staticmethod
    def _rrule(ev: dict, timed: bool) -> list:
        rep = ev.get("repeat") or "none"
        if rep == "none" or rep not in RRULE_FREQ:
            return []
        rule = "RRULE:FREQ=" + RRULE_FREQ[rep]
        if rep == "everyN":
            n = max(1, int(ev.get("repeatN") or 1))
            rule += ";INTERVAL=%d" % n
        end = ev.get("repeatEnd")
        if end:
            try:
                d = date.fromisoformat(end)
            except ValueError:
                return [rule]
            if timed:
                # RFC 5545: a timed DTSTART requires UNTIL as a UTC date-time.
                # End of that day, local, expressed in UTC.
                local_end = datetime.combine(d, datetime.max.time().replace(microsecond=0))
                utc = local_end.replace(tzinfo=_tz()).astimezone(timezone.utc)
                rule += ";UNTIL=%s" % utc.strftime("%Y%m%dT%H%M%SZ")
            else:
                rule += ";UNTIL=%s" % d.strftime("%Y%m%d")
        return [rule]

    def body(self, ev: dict) -> dict:
        title = (ev.get("title") or "(제목 없음)").strip()
        if ev.get("isTodo"):
            title = "☑ " + title

        b = {"summary": title, "description": self._description(ev)}

        color = COLOR_IDS.get((ev.get("color") or "").upper()) or \
            COLOR_IDS.get(ev.get("color") or "")
        if color:
            b["colorId"] = color

        start_d = ev["date"]
        time_s = ev.get("time") or ""
        end_d = ev.get("endDate") or ""
        repeating = (ev.get("repeat") or "none") != "none"

        if time_s and not (end_d and not repeating):
            end_t = ev.get("endTime") or ""
            if not end_t:
                h, m = (int(x) for x in time_s.split(":")[:2])
                end_t = "%02d:%02d" % ((h + 1) % 24, m)
            # an end time earlier than the start means it runs past midnight
            end_day = start_d
            if end_t <= time_s:
                end_day = (date.fromisoformat(start_d) + timedelta(days=1)).isoformat()
            b["start"] = {"dateTime": "%sT%s:00" % (start_d, time_s), "timeZone": TIMEZONE}
            b["end"] = {"dateTime": "%sT%s:00" % (end_day, end_t), "timeZone": TIMEZONE}
        else:
            last = end_d if (end_d and not repeating) else start_d
            try:
                excl = (date.fromisoformat(last) + timedelta(days=1)).isoformat()
            except ValueError:
                excl = (date.fromisoformat(start_d) + timedelta(days=1)).isoformat()
            b["start"] = {"date": start_d}
            b["end"] = {"date": excl}   # Google treats the end date as exclusive

        rr = self._rrule(ev, "dateTime" in b["start"])
        if rr:
            b["recurrence"] = rr

        mins = int(ev.get("notifyBefore") or 0)
        if mins > 0:
            b["reminders"] = {"useDefault": False,
                              "overrides": [{"method": "popup", "minutes": mins}]}
        else:
            b["reminders"] = {"useDefault": False, "overrides": []}
        return b

    @staticmethod
    def _description(ev: dict) -> str:
        bits = []
        if ev.get("desc"):
            bits.append(ev["desc"])
        if ev.get("accuracy") not in (None, ""):
            bits.append("정확도 %s%%" % ev["accuracy"])
        if ev.get("priority") and ev["priority"] != "normal":
            bits.append("중요도: %s" % {"high": "높음", "low": "낮음"}.get(ev["priority"], ""))
        bits.append("— 내 스케줄러에서 동기화됨")
        return "\n".join(b for b in bits if b)

    # ---------------------------------------------------------------- sync

    def sync(self, events: list) -> dict:
        svc = self.service()
        cid = self._calendar_id()
        state = self._read_map()
        known = state.get("__events", {})

        created = updated = deleted = failed = 0
        seen = set()

        for ev in events:
            if not self.syncable(ev):
                continue
            lid = ev.get("id")
            if not lid:
                continue
            seen.add(lid)
            body = self.body(ev)
            gid = known.get(lid)
            try:
                if gid:
                    try:
                        svc.events().update(calendarId=cid, eventId=gid, body=body).execute()
                        updated += 1
                        continue
                    except Exception:
                        gid = None  # removed remotely - fall through and re-create
                made = svc.events().insert(calendarId=cid, body=body).execute()
                known[lid] = made["id"]
                created += 1
            except Exception as err:
                failed += 1
                print("gcal sync failed for %s: %s" % (lid, err))

        for lid in [k for k in known if k not in seen]:
            try:
                svc.events().delete(calendarId=cid, eventId=known[lid]).execute()
            except Exception:
                pass   # already gone remotely
            known.pop(lid, None)
            deleted += 1

        state["__events"] = known
        state["__lastSync"] = datetime.now().astimezone().isoformat()
        self._write_map(state)
        return {"ok": True, "created": created, "updated": updated,
                "deleted": deleted, "failed": failed, "calendarId": cid}

    def status(self) -> dict:
        state = self._read_map()
        return {
            "configured": self.configured(),
            "connected": self.connected(),
            "lastSync": state.get("__lastSync"),
            "count": len(state.get("__events", {})),
            "credentialsPath": self.creds_path,
        }
