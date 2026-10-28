# -*- coding: utf-8 -*-
"""내 스케줄러 — standalone shell.

Hosts index.html in its own window (Qt ships its own Chromium, so no browser is
involved), keeps running in the tray so scheduled alarms still fire once the window
is closed, and gives the page direct file access plus native Windows toasts.
"""
from __future__ import annotations

import os
import sys

from PySide6.QtCore import (QCoreApplication, QFile, QIODevice, QPoint, QSettings,
                            QThreadPool, QTimer, QUrl, Qt)
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtGui import QAction, QGuiApplication, QIcon
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import (QWebEnginePage, QWebEngineProfile, QWebEngineScript,
                                      QWebEngineSettings)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QMainWindow, QMenu, QSystemTrayIcon

from . import toast
from .bridge import Bridge
from .storage import Storage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
DATA_DIR = os.path.join(ROOT, "data")
ICON = os.path.join(os.environ.get("APPDATA", ""), "Scheduler", "scheduler.ico")
PROFILE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Scheduler", "webprofile")
# per-PC window state (where the widget was left) - not part of the synced data
SETTINGS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Scheduler", "shell.ini")

WIDGET_W = 300        # the page's card is 276 wide; the rest is room for its shadow
WIDGET_MAX_H = 640    # past this the to-do list scrolls inside the card

# Injected before the page's own scripts so index.html can detect the shell and
# skip every browser-only storage path. qwebchannel.js is inlined rather than
# pulled from qrc:// — a file:// page is not allowed to fetch that scheme.
SHELL_INIT = """
(function () {
  if (typeof qt === 'undefined' || !qt.webChannelTransport) return;  // e.g. the widget popup
  window.__shellPending = true;
  new QWebChannel(qt.webChannelTransport, function (ch) {
    window.__shell = ch.objects.shell;
    window.__shellPending = false;
    window.dispatchEvent(new Event('shell-ready'));
  });
})();
"""


def _qwebchannel_js() -> str:
    f = QFile(":/qtwebchannel/qwebchannel.js")
    if not f.open(QIODevice.ReadOnly):
        raise RuntimeError("qwebchannel.js resource missing")
    try:
        return bytes(f.readAll()).decode("utf-8")
    finally:
        f.close()


class ShellPage(QWebEnginePage):
    """Hosts window.open() popups. The floating widget was built on Chrome's
    Document Picture-in-Picture API, which QtWebEngine does not ship; the page now
    falls back to window.open(), and this turns that popup into an always-on-top
    mini window. The popup shares the opener's origin, so the existing widget code
    keeps drawing straight into its document."""

    def __init__(self, profile, parent, owner):
        super().__init__(profile, parent)
        self._owner = owner

    def createWindow(self, _type):
        return self._owner.open_widget_window()


class WidgetWindow(QWebEngineView):
    """The floating widget: frameless and see-through, so the page's rounded card
    sits straight on the desktop like a desk pet. It stays out of the taskbar,
    the page drags it by its empty areas and sizes it to the card, and it comes
    back where it was last left."""

    def __init__(self, profile):
        super().__init__()
        self.setAttribute(Qt.WA_DeleteOnClose)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setWindowTitle("스케줄러 위젯")
        if os.path.exists(ICON):
            self.setWindowIcon(QIcon(ICON))
        page = QWebEnginePage(profile, self)
        page.setBackgroundColor(Qt.transparent)
        self.setPage(page)
        # widget.close() from the page, or the main window's button, both end here
        page.windowCloseRequested.connect(self.close)
        self.resize(WIDGET_W, 420)
        self.move(self._start_pos())

    @staticmethod
    def _start_pos() -> QPoint:
        pos = QSettings(SETTINGS, QSettings.IniFormat).value("widget/pos")
        # a monitor unplugged since then would leave it off screen
        if isinstance(pos, QPoint) and QGuiApplication.screenAt(pos + QPoint(WIDGET_W // 2, 20)):
            return pos
        avail = QGuiApplication.primaryScreen().availableGeometry()
        return QPoint(avail.right() - WIDGET_W - 24, avail.top() + 60)

    def drag(self) -> None:
        handle = self.windowHandle()
        if handle:
            handle.startSystemMove()

    def fit(self, height: int) -> None:
        avail = (self.screen() or QGuiApplication.primaryScreen()).availableGeometry()
        h = max(56, min(int(height), WIDGET_MAX_H, avail.height()))
        if h == self.height():
            return
        # growing past the bottom of the screen: lift it rather than cut the card off
        y = max(avail.top(), min(self.y(), avail.bottom() + 1 - h))
        self.setGeometry(self.x(), y, WIDGET_W, h)

    def closeEvent(self, event) -> None:
        QSettings(SETTINGS, QSettings.IniFormat).setValue("widget/pos", self.pos())
        super().closeEvent(event)


class Window(QMainWindow):
    def __init__(self, app: QApplication):
        super().__init__()
        self.app = app
        self._really_quit = False

        self.setWindowTitle(toast.APP_NAME)
        if os.path.exists(ICON):
            self.setWindowIcon(QIcon(ICON))
        avail = app.primaryScreen().availableGeometry()
        self.resize(min(1240, avail.width() - 40), min(900, avail.height() - 40))
        self.move(avail.center() - self.rect().center())

        os.makedirs(PROFILE_DIR, exist_ok=True)
        self.profile = QWebEngineProfile("scheduler", self)
        self.profile.setPersistentStoragePath(PROFILE_DIR)
        self.profile.setCachePath(os.path.join(PROFILE_DIR, "cache"))
        self.profile.setPersistentCookiesPolicy(QWebEngineProfile.ForcePersistentCookies)

        boot = QWebEngineScript()
        boot.setName("shell-bootstrap")
        boot.setSourceCode(_qwebchannel_js() + SHELL_INIT)
        boot.setInjectionPoint(QWebEngineScript.DocumentCreation)
        boot.setWorldId(QWebEngineScript.MainWorld)
        boot.setRunsOnSubFrames(False)
        self.profile.scripts().insert(boot)

        self.view = QWebEngineView(self)
        self.page = ShellPage(self.profile, self.view, self)
        self.view.setPage(self.page)
        self.page.settings().setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        self.page.settings().setAttribute(QWebEngineSettings.JavascriptCanOpenWindows, True)
        self._widget_view = None
        self.page.settings().setAttribute(QWebEngineSettings.ShowScrollBars, False)
        self.setCentralWidget(self.view)

        self.storage = Storage(DATA_DIR)
        self.bridge = Bridge(self.storage, on_quit=self.quit_app, widget=self)
        self.channel = QWebChannel(self.page)
        self.channel.registerObject("shell", self.bridge)
        self.page.setWebChannel(self.channel)

        self.view.load(QUrl.fromLocalFile(INDEX))

        self._build_tray()

    # ---------- floating widget ----------

    def open_widget_window(self):
        """Creates the floating window a window.open() call lands in."""
        if self._widget_view is not None:
            self._widget_view.close()
        view = WidgetWindow(self.profile)
        # the old window is deleted later - don't let it clear the new one
        view.destroyed.connect(lambda *_: self._widget_gone(view))
        view.show()
        self._widget_view = view
        return view.page()

    def _widget_gone(self, view) -> None:
        if self._widget_view is view:
            self._widget_view = None

    def drag_widget(self) -> None:
        if self._widget_view is not None:
            self._widget_view.drag()

    def fit_widget(self, height: int) -> None:
        if self._widget_view is not None:
            self._widget_view.fit(height)

    # ---------- tray ----------

    def _build_tray(self) -> None:
        self.tray = QSystemTrayIcon(QIcon(ICON) if os.path.exists(ICON) else self.windowIcon(), self)
        self.tray.setToolTip(toast.APP_NAME)
        menu = QMenu()
        act_open = QAction("열기", self)
        act_open.triggered.connect(self.show_window)
        act_quit = QAction("종료", self)
        act_quit.triggered.connect(self.quit_app)
        menu.addAction(act_open)
        menu.addSeparator()
        menu.addAction(act_quit)
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(self._tray_click)
        self.tray.show()

    def _tray_click(self, reason) -> None:
        if reason in (QSystemTrayIcon.Trigger, QSystemTrayIcon.DoubleClick):
            self.show_window()

    def show_window(self) -> None:
        self.showNormal()
        self.raise_()
        self.activateWindow()

    # ---------- lifecycle ----------

    def closeEvent(self, event) -> None:
        """Closing hides to the tray; alarms keep working because the page stays alive."""
        if self._really_quit:
            event.accept()
            return
        event.ignore()
        self.hide()
        self.tray.showMessage(
            toast.APP_NAME,
            "트레이에서 계속 실행 중입니다. 알림은 그대로 동작합니다.",
            QSystemTrayIcon.Information, 4000)

    def quit_app(self) -> None:
        self._really_quit = True
        if self._widget_view is not None:
            self._widget_view.close()
        self.tray.hide()
        # give a running Google sync a moment to land rather than killing it mid-write
        QThreadPool.globalInstance().waitForDone(3000)
        self.app.quit()


SINGLE_INSTANCE_KEY = "Scheduler.App.instance"


def _already_running() -> bool:
    """A second copy would share the web profile with the first and the two would
    fight over its SQLite files, which shows up as freezes. Hand over instead."""
    sock = QLocalSocket()
    sock.connectToServer(SINGLE_INSTANCE_KEY)
    if sock.waitForConnected(300):
        sock.write(b"show")
        sock.waitForBytesWritten(300)
        sock.disconnectFromServer()
        return True
    QLocalServer.removeServer(SINGLE_INSTANCE_KEY)   # clear a stale socket
    return False


def run() -> int:
    QCoreApplication.setAttribute(Qt.AA_ShareOpenGLContexts)
    toast.set_process_identity()

    app = QApplication(sys.argv)
    if _already_running():
        print("already running - raising the existing window")
        return 0
    app.setApplicationName(toast.APP_NAME)
    app.setQuitOnLastWindowClosed(False)   # closing the window must not kill the alarms
    if os.path.exists(ICON):
        app.setWindowIcon(QIcon(ICON))

    win = Window(app)
    win.show()
    # at sign-in other windows may already hold focus; come to the front so the
    # vision screen is actually seen rather than opening behind something
    win.raise_()
    win.activateWindow()

    # listen so a later launch can raise this window instead of starting a rival
    server = QLocalServer(app)
    server.listen(SINGLE_INSTANCE_KEY)

    def _on_new_connection():
        conn = server.nextPendingConnection()
        if conn:
            conn.readyRead.connect(lambda: (conn.readAll(), win.show_window()))
            conn.disconnected.connect(conn.deleteLater)

    server.newConnection.connect(_on_new_connection)
    return app.exec()
