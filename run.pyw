"""Launcher (no console window).

    pythonw run.pyw                 start the app
    python  run.pyw --install       create Desktop + Start Menu shortcuts
    python  run.pyw --uninstall     remove those shortcuts
    python  run.pyw --autostart on  launch at sign-in (off to undo)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    if "--install" in sys.argv:
        from app import shortcuts
        root = os.path.dirname(os.path.abspath(__file__))
        info = shortcuts.install(
            pythonw=os.path.join(root, ".venv", "Scripts", "pythonw.exe"),
            launcher=os.path.join(root, "run.pyw"),
            workdir=root,
            icon=os.path.join(os.environ["APPDATA"], "Scheduler", "scheduler.ico"),
        )
        for k, v in info.items():
            print("%-11s %s" % (k, v))
        sys.exit(0)
    if "--autostart" in sys.argv:
        from app import shortcuts
        root = os.path.dirname(os.path.abspath(__file__))
        i = sys.argv.index("--autostart")
        want = (sys.argv[i + 1].lower() in ("on", "1", "true")) if len(sys.argv) > i + 1 else True
        on = shortcuts.set_autostart(
            want,
            pythonw=os.path.join(root, ".venv", "Scripts", "pythonw.exe"),
            launcher=os.path.join(root, "run.pyw"),
            workdir=root,
            icon=os.path.join(os.environ["APPDATA"], "Scheduler", "scheduler.ico"),
        )
        print("autostart:", "ON" if on else "OFF", "->", shortcuts.autostart_path())
        sys.exit(0)

    if "--uninstall" in sys.argv:
        from app import shortcuts
        for p in shortcuts.remove():
            print("removed", p)
        sys.exit(0)

    from app.main import run
    sys.exit(run())
