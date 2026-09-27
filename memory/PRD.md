# OpenGrox Command Droid — PRD

## Original Problem Statement
Build OpenGrox Command Droid, a voice-first, multi-model AI agent that can actually operate an Android phone. Combine Open Grok (multi-model brain, agent runtime, tools/MCP) with Droid-MCP (Android body: typed structured access to the phone over MCP/HTTP with bearer auth). Add mobile-use only as a UI fallback for things Droid-MCP cannot do deterministically. A clean dark mobile cockpit: large voice control, Grok/ChatGPT/Gemini/Auto model selector, connected-phone status, current action, STOP control, verified result. For the first build prove three REAL commands on a physical Android device: "What's my battery level?", "Open Settings", "Stop." Report only VERIFIED / FAILED / UNKNOWN — never fake success. Do not mock the Android connection; do not build a fake simulator; fork/reuse Open Grok + Droid-MCP and write the smallest adapter to join them.

## Architecture
- **Frontend:** Expo (React Native) dark cockpit. expo-router. Voice orb (reanimated), model selector, connect screen, login screen, result card with strict VERIFIED/FAILED/UNKNOWN badge. Voice in (record → Whisper) and voice out (OpenAI TTS playback via expo-audio).
- **Backend:** FastAPI adapter = the "brain↔body" join.
  - `mcp_client.py`: real MCP-over-HTTP client (JSON-RPC 2.0, streamable HTTP/SSE, bearer auth) to a Droid-MCP server on a physical phone. Verified against a real MCP server.
  - Multi-model intent routing: OpenAI/Gemini/Anthropic via Emergent key; xAI/Grok via user key (litellm); Auto.
  - Deterministic skills with INDEPENDENT verification: battery (`get_battery_info`), open settings (`launch_app com.android.settings` → verify foreground via `get_active_window_info`/`get_top_window`), stop (cancels in-flight op).
  - Jev fast decisions: misheard-audio guard + off-topic filter.
  - Perplexity web-answer fallback for off-topic questions; Twilio SMS "text ___"; Emergent push on command completion.
  - Emergent Google sign-in (session/me/logout) — currently bypassed for devops.
- **DB (Mongo):** `connections` (per user, soft-delete), `commands` (audit), `users`, `user_sessions` (TTL).

## User Personas
- **Operator:** talks to the droid to run phone actions hands-free.
- **DevOps/tester:** accesses cockpit without login (auth bypass) to validate flows.

## Core Requirements (static)
- Voice → AI → real Android action → independent verification → voice/UI result.
- Truthful status: VERIFIED / FAILED / UNKNOWN only.
- Multi-model selector (Grok, ChatGPT, Gemini, Claude, Auto).
- No mocked device; real Droid-MCP over HTTP.

## Implemented (2026-06)
- [x] Dark sci-fi cockpit: glowing voice orb (idle/listening/thinking/speaking/error), model selector (5 brains, horizontal), status pill, current action, STOP, result card + badge, typed-command fallback.
- [x] Real MCP adapter (handshake, tools/list, tools/call, SSE) — validated against a live MCP server (battery 87%, foreground detection).
- [x] Three MVP skills with independent verification (battery / open settings / stop).
- [x] Whisper STT (`/api/voice/transcribe`) + OpenAI TTS (`tts-1`, onyx) cached + served.
- [x] Intent routing across OpenAI, Gemini, Claude (Emergent key), Grok (xAI key), Auto; keyword fallback.
- [x] Jev: misheard-audio guard + off-topic filter (live-verified).
- [x] Perplexity web-answer fallback (graceful without key).
- [x] Twilio "text ___" SMS command (graceful without creds).
- [x] Emergent Google sign-in + gate (currently bypassed via AUTH_REQUIRED/AUTH_ENABLED flags).
- [x] Emergent push plumbing (register + send on command completion; needs build + google-services.json).
- [x] Connect Phone screen (URL + bearer token), per-user connection storage.

## Backlog
- P0: Connect a real Droid-MCP phone and run the live 3-command acceptance test end-to-end.
- P1: Provide PERPLEXITY_API_KEY, TWILIO_* creds, XAI_API_KEY to activate those brains/capabilities.
- P1: Add google-services.json + deploy/build to activate push delivery.
- P2: mobile-use UI fallback for actions Droid-MCP can't do deterministically.
- P2: Expand skill catalog (media, notifications, connectivity) with verification.

## Next Tasks
- User connects a phone + provides integration keys; then run acceptance test and expand skills.
