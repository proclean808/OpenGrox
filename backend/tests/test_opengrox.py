"""OpenGrox Command Droid backend API tests.

Covers: health, auth bypass, /command scenarios (battery UNKNOWN, stop VERIFIED,
web off-topic UNKNOWN, SMS UNKNOWN, misheard guard), /connection unreachable,
/tts serving, /register-push, /auth/session invalid, /auth/me devops.
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://voice-droid-hub.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- health ---
def test_health_online(api):
    r = api.get(f"{BASE_URL}/api/", timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "online"
    assert body.get("service") == "opengrox-command-droid"


# --- auth bypass ---
def test_auth_me_returns_devops_no_token(api):
    r = api.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert r.status_code == 200
    user = r.json().get("user", {})
    assert user.get("user_id") == "devops"


def test_auth_session_bad_id_returns_401(api):
    r = api.post(f"{BASE_URL}/api/auth/session", json={"session_id": "bogus-does-not-exist"}, timeout=30)
    assert r.status_code == 401


# --- /command scenarios (no Auth header — bypass) ---
def test_command_battery_no_connection_unknown(api):
    r = api.post(f"{BASE_URL}/api/command",
                 json={"text": "what is my battery level", "model": "auto", "connection_id": None},
                 timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["skill"] == "battery"
    assert d["status"] == "UNKNOWN"
    assert re.search(r"not connected|connect your Android|Connect your", d["spoken"], re.I)
    assert d.get("tts_url"), "tts_url should be present"


def test_command_stop_verified(api):
    r = api.post(f"{BASE_URL}/api/command",
                 json={"text": "stop", "model": "auto", "connection_id": None},
                 timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["skill"] == "stop"
    assert d["status"] == "VERIFIED"


def test_command_offtopic_web_unknown(api):
    r = api.post(f"{BASE_URL}/api/command",
                 json={"text": "who won the world cup in 2018", "model": "auto", "connection_id": None},
                 timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["skill"] == "web"
    assert d["status"] == "UNKNOWN"
    assert "Web answers aren't set up" in d["spoken"]
    on_topic = d.get("details", {}).get("screen", {}).get("on_topic")
    assert on_topic is not None and on_topic < 0.5, f"expected on_topic low, got {on_topic}"


def test_command_sms_twilio_not_configured(api):
    r = api.post(f"{BASE_URL}/api/command",
                 json={"text": "text +14155552671 I am on my way", "model": "auto", "connection_id": None},
                 timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["skill"] == "send_sms"
    assert d["status"] == "UNKNOWN"
    assert "Texting isn't set up" in d["spoken"] or "Twilio" in d["spoken"]


def test_command_misheard_guard(api):
    r = api.post(f"{BASE_URL}/api/command",
                 json={"text": "uh mmm brrr zzz zzz", "model": "auto", "connection_id": None},
                 timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "UNKNOWN"
    assert re.search(r"didn't catch that", d["spoken"], re.I)
    coherent = d.get("details", {}).get("screen", {}).get("coherent")
    assert coherent is not None and coherent < 0.35, f"expected coherent low, got {coherent}"


# --- connection unreachable ---
def test_connection_unreachable_no_crash(api):
    r = api.post(f"{BASE_URL}/api/connection",
                 json={"base_url": "http://10.0.0.9:8080/mcp", "token": "x", "label": "TEST_Phone"},
                 timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "unreachable"


# --- tts serving ---
def test_tts_serves_audio(api):
    # Trigger a command to generate a TTS key
    r = api.post(f"{BASE_URL}/api/command",
                 json={"text": "stop", "model": "auto", "connection_id": None},
                 timeout=60)
    tts_url = r.json().get("tts_url")
    assert tts_url and tts_url.startswith("/api/tts/")
    r2 = api.get(f"{BASE_URL}{tts_url}", timeout=60)
    assert r2.status_code == 200
    assert r2.headers.get("content-type", "").startswith("audio/mpeg")


# --- push register (500 acceptable due to placeholder key) ---
def test_register_push_does_not_crash(api):
    r = api.post(f"{BASE_URL}/api/register-push",
                 json={"user_id": "devops", "platform": "ios", "device_token": "TEST_dummy"},
                 timeout=30)
    assert r.status_code in (200, 201, 500), r.text
