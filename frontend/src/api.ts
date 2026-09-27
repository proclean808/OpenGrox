// API client for the OpenGrox Command Droid backend.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export type CommandStatus = "VERIFIED" | "FAILED" | "UNKNOWN" | "STOPPED";

export type CommandResult = {
  command_id: string;
  transcript: string;
  model: string;
  skill: string;
  status: CommandStatus;
  spoken: string;
  details: Record<string, any>;
  tts_url: string | null;
};

export type ConnectionResult = {
  connection_id?: string;
  status: "connected" | "unreachable" | "missing";
  label?: string;
  tool_count?: number;
  device?: Record<string, unknown> | null;
  error?: string;
};

export type AuthUser = { user_id: string; email: string; name?: string; picture?: string };

// Module-level bearer token. Set on login, cleared on logout/401 so we never
// keep sending a stale Authorization header.
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export const api = {
  ttsUrl(path: string | null): string | null {
    if (!path) return null;
    return `${BASE}${path}`;
  },

  // ---- auth ----
  authSession(session_id: string) {
    return post<{ session_token: string; user: AuthUser }>("/auth/session", { session_id });
  },
  async authMe(): Promise<{ user: AuthUser } | null> {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as { user: AuthUser };
  },
  async authLogout() {
    await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: headers() });
  },

  // ---- phone connection ----
  createConnection(base_url: string, token: string, label = "My Phone") {
    return post<ConnectionResult>("/connection", { base_url, token, label });
  },
  async connectionStatus(id: string): Promise<ConnectionResult> {
    const res = await fetch(`${BASE}/api/connection/${id}`, { headers: headers() });
    return (await res.json()) as ConnectionResult;
  },

  // ---- voice + commands ----
  async transcribe(uri: string): Promise<{ text: string; error?: string }> {
    const form = new FormData();
    const name = uri.split("/").pop() || "command.m4a";
    // @ts-expect-error react-native FormData file shape
    form.append("file", { uri, name, type: "audio/m4a" });
    const res = await fetch(`${BASE}/api/voice/transcribe`, { method: "POST", headers: headers(), body: form });
    return (await res.json()) as { text: string; error?: string };
  },
  command(text: string, model: string, connection_id: string | null) {
    return post<CommandResult>("/command", { text, model, connection_id });
  },
  stop(connection_id: string | null) {
    return post<{ stopped: boolean }>("/command/stop", { connection_id });
  },
};
