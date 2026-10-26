# -*- coding: utf-8 -*-
"""Plays the pomodoro alarm on the output device the user picked.

Windows routes notification sounds to the *default* output, so the toast itself
stays silent and the chime is played here instead, on whichever device was chosen
in the app (speakers while earphones are the default, or the other way round).
No choice - or a device that is no longer plugged in - means the system default.
"""
from __future__ import annotations

import math
import os
import struct
import wave

from PySide6.QtCore import QUrl
from PySide6.QtMultimedia import QAudioOutput, QMediaDevices, QMediaPlayer

ALARM_WAV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "alarm.wav")

_player = None      # kept alive; a local QMediaPlayer stops the moment it is collected
_output = None


def make_alarm_wav(path: str = ALARM_WAV) -> str:
    """Writes a short two-note chime. Generated rather than shipped so there is no
    binary asset to carry around."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rate = 44100
    frames = bytearray()

    def note(freq: float, seconds: float, gain: float = 0.42):
        n = int(rate * seconds)
        for i in range(n):
            t = i / rate
            # quick attack, long exponential decay - a chime rather than a beep
            env = min(1.0, t / 0.012) * math.exp(-3.2 * t)
            v = math.sin(2 * math.pi * freq * t) * 0.72
            v += math.sin(2 * math.pi * freq * 2 * t) * 0.22   # octave
            v += math.sin(2 * math.pi * freq * 3 * t) * 0.06
            frames.extend(struct.pack("<h", int(max(-1.0, min(1.0, v * env * gain)) * 32767)))

    note(880.0, 0.45)          # A5
    note(1174.7, 0.75)         # D6
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path


def _device_id(d) -> str:
    return bytes(d.id()).decode("utf-8", "replace")


def list_outputs() -> list:
    """Every output Windows offers right now, for the picker in the page."""
    return [{"id": _device_id(d), "name": d.description(), "default": d.isDefault()}
            for d in QMediaDevices.audioOutputs()]


def find_output(device_id: str = "", name: str = ""):
    """The chosen device, matched by id and then by name (the id can change when a
    driver is reinstalled), falling back to the system default."""
    devices = QMediaDevices.audioOutputs()
    if device_id:
        for d in devices:
            if _device_id(d) == device_id:
                return d
    if name:
        for d in devices:
            if d.description() == name:
                return d
    return QMediaDevices.defaultAudioOutput()


def play_alarm(device_id: str = "", name: str = "") -> str:
    """Rings once on the chosen device. Returns the device actually used."""
    global _player, _output
    if not os.path.exists(ALARM_WAV):
        make_alarm_wav()

    device = find_output(device_id, name)
    _output = QAudioOutput()
    _output.setDevice(device)
    _output.setVolume(1.0)
    _player = QMediaPlayer()
    _player.setAudioOutput(_output)
    _player.setSource(QUrl.fromLocalFile(ALARM_WAV))
    _player.play()
    return device.description()
