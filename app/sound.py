# -*- coding: utf-8 -*-
"""Plays the pomodoro alarm through the machine's own speakers.

Windows routes notification sounds to the *default* output, so with earphones
plugged in the chime lands in the earphones - and is missed the moment they are
off the ears. This picks the built-in device explicitly instead.
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

# names that mean "not the speakers built into this machine"
_EXTERNAL = ("헤드셋", "헤드폰", "이어폰", "headphone", "headset", "earphone", "earbud",
             "usb", "bluetooth", "steam", "virtual", "nvidia", "hdmi", "displayport",
             "monitor", "tv", "dock", "airpods", "galaxy", "buds")
# chipsets that ship on the board
_INTERNAL = ("realtek", "conexant", "high definition audio", "intel", "smart sound",
             "내장", "internal", "speakers", "스피커")

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


def builtin_output():
    """The board's own speakers, falling back to the system default."""
    devices = QMediaDevices.audioOutputs()
    default = QMediaDevices.defaultAudioOutput()
    if not devices:
        return default

    def label(d):
        return (d.description() or "").lower()

    internal = [d for d in devices if not any(w in label(d) for w in _EXTERNAL)]
    for d in internal:                       # a known on-board chipset wins
        if any(w in label(d) for w in _INTERNAL):
            return d
    if internal:
        return internal[0]
    return default


def play_alarm() -> str:
    """Rings once on the built-in speakers. Returns the device used."""
    global _player, _output
    if not os.path.exists(ALARM_WAV):
        make_alarm_wav()

    device = builtin_output()
    _output = QAudioOutput()
    _output.setDevice(device)
    _output.setVolume(1.0)
    _player = QMediaPlayer()
    _player.setAudioOutput(_output)
    _player.setSource(QUrl.fromLocalFile(ALARM_WAV))
    _player.play()
    return device.description()
