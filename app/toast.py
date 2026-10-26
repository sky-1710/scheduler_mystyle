# -*- coding: utf-8 -*-
"""Native Windows toast notifications.

A plain (non-packaged) desktop app may only raise toasts once an AppUserModelID is
registered on a Start Menu shortcut — without it Windows drops them silently, with
no error. register_identity() creates that shortcut; show() then raises the toast.
"""
from __future__ import annotations

import os
import sys
from xml.sax.saxutils import escape

APP_ID = "Scheduler.App"
APP_NAME = "내 스케줄러"

_notifier = None


def _get_notifier():
    global _notifier
    if _notifier is None:
        from winsdk.windows.ui.notifications import ToastNotificationManager
        _notifier = ToastNotificationManager.create_toast_notifier(APP_ID)
    return _notifier


def set_process_identity() -> None:
    """Groups the window under our own taskbar icon instead of python.exe's."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass


def build_xml(title: str, body: str, style: str = "normal", silent: bool = False) -> str:
    """style 'alarm' stays on screen until dismissed and offers a snooze;
    style 'normal' shows for the long duration and then falls into the Action Center."""
    title, body = escape(title or APP_NAME), escape(body or "")
    # the alarm chime is played on the device picked in the app instead, so the
    # toast must not also ring on whatever device happens to be default
    audio = '<audio silent="true"/>' if silent else ""
    if style == "alarm":
        return (
            '<toast scenario="reminder">'
            '<visual><binding template="ToastGeneric">'
            f"<text>{title}</text><text>{body}</text>"
            "</binding></visual>"
            "<actions>"
            '<input id="snoozeTime" type="selection" defaultInput="10">'
            '<selection id="5" content="5분 뒤"/>'
            '<selection id="10" content="10분 뒤"/>'
            '<selection id="30" content="30분 뒤"/>'
            "</input>"
            '<action activationType="system" arguments="snooze" hint-inputId="snoozeTime" content="다시 알림"/>'
            '<action activationType="system" arguments="dismiss" content="확인"/>'
            "</actions>" + audio + "</toast>"
        )
    return (
        '<toast duration="long">'
        '<visual><binding template="ToastGeneric">'
        f"<text>{title}</text><text>{body}</text>"
        "</binding></visual>" + audio + "</toast>"
    )


def show(title: str, body: str, style: str = "normal", silent: bool = False) -> bool:
    try:
        from winsdk.windows.data.xml.dom import XmlDocument
        from winsdk.windows.ui.notifications import ToastNotification

        doc = XmlDocument()
        doc.load_xml(build_xml(title, body, style, silent))
        _get_notifier().show(ToastNotification(doc))
        return True
    except Exception as err:  # never let a failed toast take the app down
        print("toast failed:", err, file=sys.stderr)
        return False


def start_menu_shortcut_path() -> str:
    programs = os.path.join(
        os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs"
    )
    return os.path.join(programs, APP_NAME + ".lnk")
