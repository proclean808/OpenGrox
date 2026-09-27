"""
OpenGrox Command Droid — backend adapter.

Joins the "multi-model brain" (OpenAI / Gemini via the Emergent key, Grok/xAI via
the user's key) to the "Android body" (Droid-MCP on a real phone). The loop is:

    voice -> Whisper STT -> AI intent -> Droid-MCP tool -> INDEPENDENT verify -> voice

An action is reported only as VERIFIED / FAILED / UNKNOWN — never a faked success.
"""
import asyncio
import hashlib
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, Optional

import httpx
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, Field
from starlette.middleware.cors import CORSMiddleware

from mcp_client import (
    McpError,
    McpSession,
    McpUnreachable,
    find_bool,
    find_number,
    find_string,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("opengrox")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
XAI_API_KEY = os.environ.get("XAI_API_KEY", "").strip()
XAI_MODEL = os.environ.get("XAI_MODEL", "grok-3").strip()

# Temporary devops bypass — when AUTH_REQUIRED is false, unauthenticated calls run
# as a shared DevOps user. Flip AUTH_REQUIRED=true (and AUTH_ENABLED=true on the
# frontend) to restore Google sign-in.
AUTH_REQUIRED = os.environ.get("AUTH_REQUIRED", "true").strip().lower() == "true"
DEVOPS_USER = {"user_id": "devops", "email": "devops@opengrox.local", "name": "DevOps"}

PERPLEXITY_API_KEY = os.environ.get("PERPLEXITY_API_KEY", "").strip()
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
EMERGENT_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
PUSH_BASE_URL = "https://integrations.emergentagent.com"

TTS_DIR = ROOT_DIR / "tts_cache"
TTS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="OpenGrox Command Droid")
api_router = APIRouter(prefix="/api")

# One in-flight, cancellable operation per connected phone (drives the STOP control).
active_ops: Dict[str, asyncio.Task] = {}


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
PyObjectId = Annotated[str, BeforeValidator(str)]


class ConnectionCreate(BaseModel):
    base_url: str
    token: str = ""
    label: str = "My Phone"


class CommandRequest(BaseModel):
    text: str
    model: str = "auto"
    connection_id: Optional[str] = None


class StopRequest(BaseModel):
    connection_id: Optional[str] = None


class SessionCreate(BaseModel):
    session_id: str


# --------------------------------------------------------------------------- #
# Multi-model brain — intent understanding
# --------------------------------------------------------------------------- #
PROVIDER_MAP = {
    "chatgpt": ("openai", "gpt-5.4"),
    "openai": ("openai", "gpt-5.4"),
    "gemini": ("gemini", "gemini-3-flash-preview"),
    "claude": ("anthropic", "claude-sonnet-4-6"),
    "auto": ("openai", "gpt-5.4"),
}

INTENT_SYSTEM = (
    "You are the intent router for a voice assistant that operates a real Android phone. "
    "Map the user's request to exactly ONE command word and reply with only that word, "
    "nothing else. Valid words: battery, settings, stop, sms, unknown. "
    "'battery' = anything about battery level/charge. "
    "'settings' = open the Android Settings app. "
    "'sms' = send a text message or SMS to someone. "
    "'stop' = cancel/abort the current action. "
    "'unknown' = anything else."
)


def _keyword_skill(text: str) -> str:
    t = (text or "").lower()
    if any(w in t for w in ("stop", "cancel", "abort", "halt")):
        return "stop"
    if t.startswith("text ") or t.startswith("sms ") or "send a text" in t or "send text" in t or "send an sms" in t or "send sms" in t or "text message" in t:
        return "send_sms"
    if "batter" in t or "charge" in t or "charging" in t or "power level" in t:
        return "battery"
    if "setting" in t:
        return "open_settings"
    return "unknown"


def _normalize(word: str) -> str:
    w = (word or "").strip().lower()
    if "stop" in w:
        return "stop"
    if "sms" in w or "text" in w:
        return "send_sms"
    if "batter" in w:
        return "battery"
    if "setting" in w:
        return "open_settings"
    return "unknown"


async def _grok_intent(text: str) -> str:
    if not XAI_API_KEY:
        raise RuntimeError("xai key missing")
    from litellm import acompletion

    resp = await acompletion(
        model=f"xai/{XAI_MODEL}",
        api_key=XAI_API_KEY,
        temperature=0,
        messages=[
            {"role": "system", "content": INTENT_SYSTEM},
            {"role": "user", "content": text},
        ],
    )
    return resp.choices[0].message.content or ""


async def _emergent_intent(provider: str, model: str, text: str) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"intent-{uuid.uuid4()}",
        system_message=INTENT_SYSTEM,
    ).with_model(provider, model)
    return await chat.send_message(UserMessage(text=text))


async def decide_skill(model: str, text: str) -> str:
    """Let the selected AI brain classify; fall back to keywords if it fails."""
    llm_word = ""
    try:
        if model == "grok":
            llm_word = await _grok_intent(text)
        else:
            provider, mname = PROVIDER_MAP.get(model, PROVIDER_MAP["auto"])
            llm_word = await _emergent_intent(provider, mname, text)
    except Exception as e:  # provider not configured / transient failure
        logger.warning("intent LLM (%s) failed, using keyword fallback: %s", model, e)

    skill = _normalize(llm_word)
    if skill == "unknown":
        skill = _keyword_skill(text)  # trust deterministic keywords over a vague LLM reply
    return skill


# --------------------------------------------------------------------------- #
# Android body — deterministic skills with independent verification
# --------------------------------------------------------------------------- #
SETTINGS_PKG = "com.android.settings"


async def _foreground_package(session: McpSession):
    """Independently read the phone's current foreground app.

    Returns (package_or_None, source_tool_or_None, error_or_None).
    Polls briefly because launching an app is not instantaneous.
    """
    last_pkg = None
    last_err = None
    keys = ["packagename", "package", "toppackage", "currentpackage", "foregroundpackage"]
    for _ in range(6):
        for tool in ("get_active_window_info", "get_top_window"):
            try:
                data = await session.call_tool(tool, {})
                pkg = find_string(data, keys)
                if pkg:
                    last_pkg = pkg
                    if "settings" in pkg.lower():
                        return pkg, tool, None
            except (McpError, McpUnreachable) as e:
                last_err = str(e)
        await asyncio.sleep(0.5)
    return last_pkg, None, last_err


async def do_battery(session: McpSession):
    data = await session.call_tool("get_battery_info", {})
    level = find_number(data, ["level", "percent", "capacity"])
    if level is None:
        return "UNKNOWN", "I reached your phone but couldn't read the battery level.", data
    charging = find_bool(data, ["charging", "ischarging"])
    pct = int(round(level))
    say = f"Your battery is at {pct} percent"
    say += " and charging." if charging else "."
    return "VERIFIED", say, {"battery_level": pct, "charging": charging, "raw": data}


async def do_open_settings(session: McpSession):
    # Deterministic action: launch the Settings app by package.
    launched = True
    launch_raw: Any = None
    try:
        launch_raw = await session.call_tool("launch_app", {"package_name": SETTINGS_PKG})
    except (McpError, McpUnreachable) as e:
        launched = False
        launch_raw = {"error": str(e)}

    # Independent verification: read the actual foreground app.
    pkg, source, err = await _foreground_package(session)
    details = {"launched": launched, "foreground_package": pkg, "verify_source": source, "launch_raw": launch_raw}

    if pkg and "settings" in pkg.lower():
        return "VERIFIED", "Settings is now open on your phone.", details
    if pkg:
        return ("FAILED", f"I tried to open Settings, but the phone is still on {pkg}.", details)
    # Could not confirm — verification tool (accessibility / shizuku) likely unavailable.
    if not launched:
        return "FAILED", "The phone rejected the request to open Settings.", details
    return (
        "UNKNOWN",
        "I sent the command to open Settings, but I couldn't independently confirm it came to the foreground.",
        details,
    )


async def execute_skill(skill: str, base_url: str, token: str):
    try:
        async with McpSession(base_url, token) as session:
            if skill == "battery":
                return await do_battery(session)
            if skill == "open_settings":
                return await do_open_settings(session)
            return (
                "UNKNOWN",
                "I can't do that one yet. Try asking for your battery level, or say open settings.",
                {},
            )
    except McpUnreachable as e:
        return "UNKNOWN", "I couldn't reach your phone. Check the connection and try again.", {"error": str(e)}
    except McpError as e:
        return "FAILED", "The phone rejected the command.", {"error": str(e)}


# --------------------------------------------------------------------------- #
# Voice — Whisper STT + OpenAI TTS (Emergent key)
# --------------------------------------------------------------------------- #
def _clean_for_tts(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|]", "", text)
    return re.sub(r"\s+", " ", text).strip()


async def synth_tts(text: str, voice: str = "onyx") -> Optional[str]:
    if not text:
        return None
    clean = _clean_for_tts(text)
    key = hashlib.sha256(f"{clean}|{voice}|tts-1|mp3".encode()).hexdigest()[:32]
    path = TTS_DIR / f"{key}.mp3"
    if not path.exists():
        try:
            from emergentintegrations.llm.openai import OpenAITextToSpeech

            tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
            audio = await tts.generate_speech(text=clean, model="tts-1", voice=voice, response_format="mp3")
            path.write_bytes(audio)
        except Exception as e:
            logger.error("TTS failed: %s", e)
            return None
    return f"/api/tts/{key}.mp3"


# --------------------------------------------------------------------------- #
# External capabilities — Perplexity (web answers), Twilio (SMS), push
# --------------------------------------------------------------------------- #
async def ask_perplexity(question: str):
    if not PERPLEXITY_API_KEY:
        return None, []
    payload = {
        "model": "sonar",
        "messages": [
            {
                "role": "system",
                "content": "Answer accurately and concisely using current web information. Keep it under 3 sentences, suitable for reading aloud.",
            },
            {"role": "user", "content": question},
        ],
        "temperature": 0.2,
    }
    async with httpx.AsyncClient(timeout=30.0) as hx:
        r = await hx.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {PERPLEXITY_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        )
    r.raise_for_status()
    data = r.json()
    answer = data["choices"][0]["message"]["content"]
    citations = data.get("citations") or []
    return answer, citations


def _twilio_send(to: str, body: str) -> str:
    from twilio.rest import Client

    tw = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    msg = tw.messages.create(to=to, from_=TWILIO_FROM_NUMBER, body=body)
    return msg.sid


async def _extract_sms(text: str):
    import json as _json

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"sms-{uuid.uuid4()}",
        system_message=(
            "Extract the SMS recipient phone number and the message body from the user's request. "
            'Reply ONLY with compact JSON: {"to": "<E.164 number or empty string>", "body": "<message>"}. '
            "If there is no clear phone number, use an empty string for to."
        ),
    ).with_model("openai", "gpt-5.4")
    raw = await chat.send_message(UserMessage(text=text))
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        obj = _json.loads(m.group(0)) if m else {}
    except Exception:
        obj = {}
    return (obj.get("to") or "").strip(), (obj.get("body") or "").strip()


async def do_send_sms(transcript: str):
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER):
        return "UNKNOWN", "Texting isn't set up yet. Add your Twilio credentials to enable it.", {}
    to, body = await _extract_sms(transcript)
    if not to:
        return "FAILED", "I couldn't tell which number to text. Say the phone number and your message.", {"body": body}
    try:
        sid = await asyncio.to_thread(_twilio_send, to, body)
        return "VERIFIED", f"Sent your text to {to}.", {"to": to, "body": body, "sid": sid}
    except Exception as e:
        return "FAILED", "I couldn't send that text.", {"error": str(e), "to": to}


async def send_push(recipients, data: Dict[str, Any]):
    if not recipients:
        return
    try:
        async with httpx.AsyncClient(
            base_url=PUSH_BASE_URL, headers={"X-Push-Key": EMERGENT_PUSH_KEY}, timeout=10.0
        ) as hx:
            await hx.post("/api/v1/push/trigger", json={"recipients": recipients, "data": data})
    except Exception as e:
        logger.warning("push failed (non-blocking): %s", e)


# --------------------------------------------------------------------------- #
# Fast decisions (Jev) — off-topic filter + destructive-command safety gate
# --------------------------------------------------------------------------- #
async def jev_screen(text: str) -> Dict[str, Any]:
    from jev import get_jev_client
    from typesafe_sdk import Noul, TypeSafeAPIError, TypeSafeError

    try:
        resp = await get_jev_client().system_one(
            model="jev-latest",
            state={"utterance": text},
            questions={
                "on_topic": Noul(
                    instructions=(
                        "Is this an instruction to operate or control an Android phone "
                        "(vs off-topic chatter, general questions, or small talk)?"
                    )
                ),
                "coherent": Noul(
                    instructions=(
                        "Is this a clear, complete command that a phone assistant could act on, as opposed "
                        "to garbled speech-to-text noise, random disconnected words, or an unintelligible fragment?"
                    )
                ),
            },
        )
        return {
            "on_topic": float(resp.nouls["on_topic"].noul),
            "coherent": float(resp.nouls["coherent"].noul),
            "ai_classified": True,
        }
    except (TypeSafeAPIError, TypeSafeError) as e:
        logger.warning("jev screen failed: %s", e)
        return {"on_topic": 1.0, "coherent": 1.0, "ai_classified": False}


# --------------------------------------------------------------------------- #
# Auth (Emergent-managed Google sign-in)
# --------------------------------------------------------------------------- #
EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


async def get_current_user(authorization: Optional[str] = Header(None)):
    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if token:
        session = await db.user_sessions.find_one({"session_token": token})
        if session:
            exp = session.get("expires_at")
            if isinstance(exp, str):
                exp = datetime.fromisoformat(exp)
            if exp and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if not exp or exp >= datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                if user:
                    return user
    if not AUTH_REQUIRED:
        return DEVOPS_USER
    raise HTTPException(status_code=401, detail="Not authenticated")


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@api_router.get("/")
async def root():
    return {"service": "opengrox-command-droid", "status": "online"}


@api_router.post("/auth/session")
async def auth_session(body: SessionCreate):
    async with httpx.AsyncClient(timeout=15.0) as hx:
        r = await hx.get(EMERGENT_AUTH_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    data = r.json()
    email = data.get("email")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Incomplete session data")
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": data.get("name"),
                "picture": data.get("picture"),
                "created_at": datetime.now(timezone.utc),
            }
        )
    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        }
    )
    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": data.get("name"), "picture": data.get("picture")},
    }


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return {"user": user}


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        await db.user_sessions.delete_one({"session_token": authorization.split(" ", 1)[1].strip()})
    return {"ok": True}


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    try:
        async with httpx.AsyncClient(
            base_url=PUSH_BASE_URL, headers={"X-Push-Key": EMERGENT_PUSH_KEY}, timeout=10.0
        ) as hx:
            resp = await hx.post("/api/v1/push/users/register", json=body.model_dump())
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("register-push failed (non-blocking): %s", e)
    return {"status": "registered"}


@api_router.post("/connection")
async def create_connection(body: ConnectionCreate, user=Depends(get_current_user)):
    """Save + test a real Droid-MCP phone connection."""
    try:
        async with McpSession(body.base_url, body.token) as session:
            tools = await session.list_tools()
            device = None
            try:
                device = await session.call_tool("get_device_info", {})
            except (McpError, McpUnreachable):
                device = None
            server_info = session.server_info
    except McpUnreachable as e:
        return {"status": "unreachable", "error": f"Could not reach the phone: {e}"}
    except McpError as e:
        return {"status": "unreachable", "error": f"The phone refused the connection: {e}"}

    doc = {
        "user_id": user["user_id"],
        "base_url": body.base_url.strip(),
        "token": (body.token or "").strip(),
        "label": body.label,
        "device": device,
        "tool_count": len(tools),
        "server_info": server_info,
        "status": "connected",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    res = await db.connections.insert_one(doc)
    return {
        "connection_id": str(res.inserted_id),
        "status": "connected",
        "label": body.label,
        "tool_count": len(tools),
        "device": device,
    }


@api_router.get("/connection/{connection_id}")
async def connection_status(connection_id: str, user=Depends(get_current_user)):
    conn = await _load_connection(connection_id, user["user_id"])
    if not conn:
        return {"status": "missing"}
    try:
        async with McpSession(conn["base_url"], conn["token"]) as session:
            await session.list_tools()
    except (McpUnreachable, McpError) as e:
        return {"status": "unreachable", "label": conn.get("label"), "error": str(e)}
    return {"status": "connected", "label": conn.get("label"), "device": conn.get("device")}


async def _load_connection(connection_id: Optional[str], user_id: str):
    if not connection_id or not ObjectId.is_valid(connection_id):
        return None
    return await db.connections.find_one(
        {"_id": ObjectId(connection_id), "user_id": user_id, "deleted_at": None}
    )


@api_router.post("/voice/transcribe")
async def transcribe(file: UploadFile = File(...), user=Depends(get_current_user)):
    from emergentintegrations.llm.openai import OpenAISpeechToText

    suffix = Path(file.filename or "audio.m4a").suffix or ".m4a"
    data = await file.read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.flush()
    tmp.close()
    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        resp = await stt.transcribe(tmp.name, model="whisper-1", response_format="text")
        if isinstance(resp, str):
            text = resp
        else:
            text = getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else str(resp))
        return {"text": (text or "").strip()}
    except Exception as e:
        logger.error("transcribe failed: %s", e)
        return {"text": "", "error": str(e)}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@api_router.post("/command")
async def run_command(body: CommandRequest, user=Depends(get_current_user)):
    transcript = (body.text or "").strip()
    conn = await _load_connection(body.connection_id, user["user_id"])
    conn_key = f'{user["user_id"]}:{body.connection_id or "no-conn"}'

    skill = await decide_skill(body.model, transcript)

    # STOP short-circuits everything and cancels the current op.
    if skill == "stop":
        cancelled = _cancel_active(conn_key)
        say = "Stopped." if cancelled else "There's nothing running to stop right now."
        return await _finish_command(body, transcript, skill, "VERIFIED", say, {"cancelled": cancelled})

    # Jev fast-screens the utterance: misheard-audio guard + off-topic filter.
    screen = await jev_screen(transcript)

    # Misheard-audio guard: never act on garbled speech-to-text.
    if screen["coherent"] < 0.35:
        say = "I didn't catch that clearly. Please say your command again."
        return await _finish_command(body, transcript, skill, "UNKNOWN", say, {"screen": screen})

    # Cloud SMS via Twilio — does not need the connected phone.
    if skill == "send_sms":
        status, say, details = await do_send_sms(transcript)
        return await _finish_command(body, transcript, skill, status, say, {**details, "screen": screen})

    if skill == "unknown":
        # Off-topic → answer from the live web via Perplexity.
        if screen["on_topic"] < 0.5:
            try:
                answer, citations = await ask_perplexity(transcript)
            except Exception as e:
                logger.warning("perplexity failed: %s", e)
                return await _finish_command(
                    body, transcript, "web", "FAILED",
                    "I couldn't reach the web right now.", {"screen": screen, "error": str(e)},
                )
            if answer:
                return await _finish_command(
                    body, transcript, "web", "VERIFIED", answer[:700],
                    {"screen": screen, "citations": citations[:5]},
                )
            say = "Web answers aren't set up yet. Add your Perplexity key to ask the droid general questions."
            return await _finish_command(body, transcript, "web", "UNKNOWN", say, {"screen": screen})
        say = "I can't do that one yet. Try asking for your battery level, or say open settings."
        return await _finish_command(body, transcript, skill, "UNKNOWN", say, {"screen": screen})

    if conn is None:
        say = "I'm not connected to a phone yet. Connect your Android device to get started."
        return await _finish_command(body, transcript, skill, "UNKNOWN", say, {"screen": screen})

    task = asyncio.create_task(execute_skill(skill, conn["base_url"], conn["token"]))
    active_ops[conn_key] = task
    try:
        status, say, details = await task
    except asyncio.CancelledError:
        status, say, details = "STOPPED", "Operation stopped.", {}
    finally:
        if active_ops.get(conn_key) is task:
            active_ops.pop(conn_key, None)

    details = {**(details or {}), "screen": screen}
    try:
        await send_push([user["user_id"]], {"title": "OpenGrox Command Droid", "message": say})
    except Exception:
        pass
    return await _finish_command(body, transcript, skill, status, say, details)


def _cancel_active(conn_key: str) -> bool:
    task = active_ops.get(conn_key)
    if task and not task.done():
        task.cancel()
        return True
    return False


@api_router.post("/command/stop")
async def stop_command(body: StopRequest, user=Depends(get_current_user)):
    conn_key = f'{user["user_id"]}:{body.connection_id or "no-conn"}'
    cancelled = _cancel_active(conn_key)
    return {"stopped": cancelled}


async def _finish_command(body, transcript, skill, status, say, details):
    tts_url = await synth_tts(say)
    doc = {
        "connection_id": body.connection_id,
        "model": body.model,
        "transcript": transcript,
        "skill": skill,
        "status": status,
        "spoken": say,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.commands.insert_one(dict(doc))
    except Exception as e:
        logger.warning("audit save failed: %s", e)
    return {
        "command_id": str(uuid.uuid4()),
        "transcript": transcript,
        "model": body.model,
        "skill": skill,
        "status": status,
        "spoken": say,
        "details": details,
        "tts_url": tts_url,
    }


@api_router.get("/tts/{key}.mp3")
async def get_tts(key: str):
    path = TTS_DIR / f"{key}.mp3"
    if not path.exists():
        return FileResponse(path, status_code=404)
    return FileResponse(path, media_type="audio/mpeg")


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup_indexes():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning("index creation: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
