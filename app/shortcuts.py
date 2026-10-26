# -*- coding: utf-8 -*-
"""Desktop and Start Menu shortcuts.

The Start Menu one is not a convenience: Windows refuses to display toasts from a
plain desktop app unless a shortcut carrying its AppUserModelID exists.
"""
from __future__ import annotations

import os

import pythoncom
from win32com.client import Dispatch
from win32com.propsys import propsys, pscon
from win32com.shell import shell, shellcon

from .toast import APP_ID, APP_NAME


def _programs_dir() -> str:
    return os.path.join(os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs")


def _startup_dir() -> str:
    """The per-user Startup folder — anything here launches at sign-in."""
    return os.path.join(os.environ["APPDATA"], "Microsoft", "Windows",
                        "Start Menu", "Programs", "Startup")


def _desktop_dir() -> str:
    return shell.SHGetFolderPath(0, shellcon.CSIDL_DESKTOPDIRECTORY, None, 0)


def _write(lnk: str, target: str, args: str, workdir: str, icon: str, desc: str) -> None:
    sh = Dispatch("WScript.Shell")
    s = sh.CreateShortCut(lnk)
    s.TargetPath = target
    s.Arguments = args
    s.WorkingDirectory = workdir
    s.IconLocation = icon + ",0"
    s.Description = desc
    s.WindowStyle = 1
    s.Save()


def _stamp_aumid(lnk: str, aumid: str) -> None:
    """Puts System.AppUserModel.ID onto an existing .lnk.

    The write store keeps the file open, so the value is read back separately -
    reading while this handle lives raises a sharing violation.
    """
    store = propsys.SHGetPropertyStoreFromParsingName(
        lnk, None, shellcon.GPS_READWRITE, propsys.IID_IPropertyStore
    )
    store.SetValue(pscon.PKEY_AppUserModel_ID, propsys.PROPVARIANTType(aumid))
    store.Commit()
    del store


def read_aumid(lnk: str) -> str:
    store = propsys.SHGetPropertyStoreFromParsingName(
        lnk, None, shellcon.GPS_DEFAULT, propsys.IID_IPropertyStore
    )
    try:
        return str(store.GetValue(pscon.PKEY_AppUserModel_ID).GetValue())
    except Exception:
        return ""


def install(pythonw: str, launcher: str, workdir: str, icon: str) -> dict:
    """Creates both shortcuts pointing at the standalone app. Returns what it wrote."""
    pythoncom.CoInitialize()
    out = {}
    args = '"%s"' % launcher

    start = os.path.join(_programs_dir(), APP_NAME + ".lnk")
    _write(start, pythonw, args, workdir, icon, APP_NAME)
    _stamp_aumid(start, APP_ID)
    out["start_menu"] = start

    desk = os.path.join(_desktop_dir(), APP_NAME + ".lnk")
    _write(desk, pythonw, args, workdir, icon, APP_NAME)
    _stamp_aumid(desk, APP_ID)
    out["desktop"] = desk

    out["aumid"] = read_aumid(start)   # verified after both handles are released
    return out


def autostart_path() -> str:
    return os.path.join(_startup_dir(), APP_NAME + ".lnk")


def autostart_enabled() -> bool:
    return os.path.exists(autostart_path())


def set_autostart(on: bool, pythonw: str = "", launcher: str = "",
                  workdir: str = "", icon: str = "") -> bool:
    """Adds or removes the Startup-folder shortcut. Returns the resulting state."""
    pythoncom.CoInitialize()
    lnk = autostart_path()
    if not on:
        if os.path.exists(lnk):
            os.unlink(lnk)
        return False
    os.makedirs(_startup_dir(), exist_ok=True)
    _write(lnk, pythonw, '"%s"' % launcher, workdir, icon, APP_NAME)
    _stamp_aumid(lnk, APP_ID)
    return True


def remove() -> list:
    gone = []
    for d in (_programs_dir(), _desktop_dir(), _startup_dir()):
        p = os.path.join(d, APP_NAME + ".lnk")
        if os.path.exists(p):
            os.unlink(p)
            gone.append(p)
    return gone
