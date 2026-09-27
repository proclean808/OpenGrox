import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  isGarbled,
  isModelKey,
  keywordSkill,
  type CommandDetails,
  type CommandResult,
  type ConnectionTest,
  type ModelKey,
  type Skill,
} from "./logic.ts";

type Json = Record<string, unknown>;

const PROTOCOL = "2025-06-18";
const live = new Map<string, AbortController>();

class McpError extends Error {}
class McpUnreachable extends Error {}

export type CommandInput = {
  text: string;
  model: ModelKey;
  baseUrl: string;
  token: string;
  opId: string;
};

export type ConnectInput = {
  baseUrl: string;
  token: string;
  label: string;
};

function blockedIp(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || host === "0.0.0.0" || host === "::") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return host.includes(":") && (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"));
  const n = v4.slice(1).map(Number);
  if (n.some((x) => x > 255)) return true;
  const [a, b] = n;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (isIP(host)) return blockedIp(host);
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http or https URL.");
  if (url.username || url.password) throw new Error("Put the token in the bearer field, not the URL.");
  if (blockedHost(url.hostname)) {
    throw new Error("Private and local addresses are blocked. Use a public tunnel to the phone.");
  }
  if (!isIP(url.hostname)) {
    let records: { address: string }[];
    try {
      records = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("That host did not resolve.");
    }
    if (records.length === 0 || records.some((r) => blockedIp(r.address))) {
      throw new Error("That host points at a private address. Use a public tunnel.");
    }
  }
  return url;
}

function explainFetch(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/certificate|self.signed|unable_to_verify|depth_zero/i.test(msg)) {
    return "The phone certificate is not trusted here. Put a public HTTPS tunnel with a real certificate in front of Droid-MCP.";
  }
  if (/abort|timeout/i.test(msg)) return "The phone did not answer in time.";
  return "Could not reach the phone. Check the URL and that Droid-MCP is running.";
}

function walk(data: unknown): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      out.push([k, v]);
      visit(v);
    }
  };
  visit(data);
  return out;
}

function findNumber(data: unknown, keys: string[]): number | null {
  for (const [k, v] of walk(data)) {
    const kl = k.toLowerCase();
    if (!keys.some((s) => kl.includes(s))) continue;
    if (typeof v === "boolean") continue;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.trim().replace(/%$/, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function findString(data: unknown, keys: string[]): string | null {
  for (const [k, v] of walk(data)) {
    const kl = k.toLowerCase();
    if (!keys.some((s) => kl.includes(s))) continue;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function findBool(data: unknown, keys: string[]): boolean | null {
  for (const [k, v] of walk(data)) {
    const kl = k.toLowerCase();
    if (!keys.some((s) => kl.includes(s))) continue;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (["true", "yes", "charging"].includes(s)) return true;
      if (["false", "no", "discharging"].includes(s)) return false;
    }
  }
  return null;
}

function toolData(result: Json): Json {
  if (result.isError) {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((c) => (c && typeof c === "object" ? String((c as Json).text ?? "") : ""))
      .join(" ")
      .trim();
    throw new McpError((text || "The phone tool reported an error.").slice(0, 240));
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as Json;
  }
  const content = Array.isArray(result.content) ? result.content : [];
  for (const c of content) {
    if (!c || typeof c !== "object" || (c as Json).type !== "text") continue;
    const t = String((c as Json).text ?? "");
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
      return { value: parsed as never };
    } catch {
      return { text: t.slice(0, 500) };
    }
  }
  return {};
}

async function readMessage(res: Response): Promise<Json> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) {
    const messages: Json[] = [];
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        messages.push(JSON.parse(data) as Json);
      } catch {
        /* ignore malformed event */
      }
    }
    return messages.find((m) => "result" in m || "error" in m) ?? messages.at(-1) ?? {};
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Json;
  } catch {
    return {};
  }
}

class McpSession {
  sessionId: string | null = null;
  serverInfo: Json = {};
  private n = 1;

  constructor(
    private url: string,
    private token: string,
    private signal: AbortSignal,
  ) {}

  private headers(): Headers {
    const h = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
    });
    if (this.token) h.set("Authorization", `Bearer ${this.token}`);
    if (this.sessionId) h.set("Mcp-Session-Id", this.sessionId);
    return h;
  }

  private async post(payload: Json): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: this.signal,
      });
    } catch (error) {
      if (this.signal.aborted) throw new DOMException("aborted", "AbortError");
      throw new McpUnreachable(explainFetch(error));
    }
    if (res.status >= 300 && res.status < 400) {
      throw new McpUnreachable("The phone URL redirected. Paste the direct /mcp address.");
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    return res;
  }

  async rpc(method: string, params?: Json): Promise<Json> {
    const payload: Json = { jsonrpc: "2.0", id: this.n++, method };
    if (params) payload.params = params;
    const res = await this.post(payload);
    if (res.status === 401 || res.status === 403) throw new McpError("The phone refused the bearer token.");
    if (res.status >= 400) throw new McpError(`The phone returned HTTP ${res.status}.`);
    const msg = await readMessage(res);
    if (msg.error) {
      const err = msg.error as { message?: string };
      throw new McpError((err?.message || "MCP error").slice(0, 240));
    }
    return (msg.result as Json) ?? {};
  }

  async init() {
    this.serverInfo = await this.rpc("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "OpenGroxCommandDroid", version: "1.0.0" },
    });
    try {
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    } catch {
      /* notification is optional */
    }
  }

  async listTools(): Promise<unknown[]> {
    const result = await this.rpc("tools/list", {});
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Json = {}): Promise<Json> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    return toolData(result);
  }
}

function deviceLabel(data: unknown, serverInfo: Json): string {
  const model = findString(data, ["model", "device", "manufacturer", "name"]);
  const info = serverInfo.serverInfo as Json | undefined;
  const server = typeof info?.name === "string" ? info.name : "";
  return [model, server].filter(Boolean).join(" · ").slice(0, 80);
}

function finish(
  input: CommandInput,
  skill: string,
  status: CommandResult["status"],
  spoken: string,
  details: CommandDetails,
): CommandResult {
  return {
    commandId: crypto.randomUUID(),
    transcript: input.text,
    model: input.model,
    skill,
    status,
    spoken,
    details,
  };
}

async function classify(text: string, signal: AbortSignal): Promise<{ skill: Skill; reply: string } | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            'You route commands for a droid that operates a real Android phone. Reply with ONLY JSON: {"skill":"battery|open_settings|stop|send_sms|answer|unknown","reply":""}. Use answer only for a clear general question. reply is then one or two spoken sentences, no markdown. For every other skill, reply is empty.',
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { skill?: string; reply?: string };
    const skill = String(obj.skill ?? "unknown") as Skill;
    const allowed: Skill[] = ["battery", "open_settings", "stop", "send_sms", "answer", "unknown"];
    return {
      skill: allowed.includes(skill) ? skill : "unknown",
      reply: String(obj.reply ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
    };
  } catch {
    return null;
  }
}

async function sleep(ms: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function foreground(session: McpSession, signal: AbortSignal) {
  let last: string | null = null;
  const keys = ["packagename", "package", "toppackage", "currentpackage", "foregroundpackage"];
  for (let i = 0; i < 4; i++) {
    for (const tool of ["get_active_window_info", "get_top_window"]) {
      try {
        const data = await session.callTool(tool);
        const pkg = findString(data, keys);
        if (pkg) {
          last = pkg;
          if (pkg.toLowerCase().includes("settings")) return pkg;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
      }
    }
    if (i < 3) await sleep(450, signal);
  }
  return last;
}

async function runSkill(skill: Skill, session: McpSession, signal: AbortSignal) {
  if (skill === "battery") {
    const data = await session.callTool("get_battery_info");
    let level = findNumber(data, ["level", "percent", "capacity"]);
    if (level == null) {
      return {
        status: "UNKNOWN" as const,
        spoken: "I reached the phone but could not read the battery level.",
        details: { kind: "battery" },
      };
    }
    if (level > 0 && level <= 1) level *= 100;
    const pct = Math.max(0, Math.min(100, Math.round(level)));
    const charging = findBool(data, ["charging", "ischarging"]);
    const spoken = `Your battery is at ${pct} percent${charging ? " and charging." : "."}`;
    return {
      status: "VERIFIED" as const,
      spoken,
      details: { kind: "battery", batteryLevel: pct, charging },
    };
  }
  if (skill === "open_settings") {
    let launched = true;
    try {
      await session.callTool("launch_app", { package_name: "com.android.settings" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      launched = false;
    }
    const pkg = await foreground(session, signal);
    if (pkg && pkg.toLowerCase().includes("settings")) {
      return {
        status: "VERIFIED" as const,
        spoken: "Settings is now open on your phone.",
        details: { kind: "settings", foregroundPackage: pkg },
      };
    }
    if (pkg) {
      return {
        status: "FAILED" as const,
        spoken: `I tried to open Settings, but the phone is still on ${pkg}.`,
        details: { kind: "settings", foregroundPackage: pkg },
      };
    }
    if (!launched) {
      return {
        status: "FAILED" as const,
        spoken: "The phone rejected the request to open Settings.",
        details: { kind: "settings", foregroundPackage: null },
      };
    }
    return {
      status: "UNKNOWN" as const,
      spoken: "I sent the command to open Settings, but I could not confirm it came to the foreground.",
      details: { kind: "settings", foregroundPackage: null },
    };
  }
  return {
    status: "UNKNOWN" as const,
    spoken: "I can't do that on the phone yet. Ask for battery level, or say open settings.",
    details: { kind: skill },
  };
}

export function cancelOp(opId: string): boolean {
  const ctrl = live.get(opId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export async function testConnection(input: ConnectInput): Promise<ConnectionTest> {
  const label = input.label || "My Phone";
  try {
    const url = await assertPublicUrl(input.baseUrl);
    const signal = AbortSignal.timeout(12000);
    const session = new McpSession(url.toString(), input.token, signal);
    await session.init();
    const tools = await session.listTools();
    let device = "";
    try {
      const info = await session.callTool("get_device_info");
      device = deviceLabel(info, session.serverInfo);
    } catch {
      device = deviceLabel(null, session.serverInfo);
    }
    return { status: "connected", label, toolCount: tools.length, deviceLabel: device || undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the phone.";
    return { status: "unreachable", label, error: message.slice(0, 280) };
  }
}

export async function executeCommand(input: CommandInput): Promise<CommandResult> {
  const ctrl = new AbortController();
  if (input.opId) live.set(input.opId, ctrl);
  const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(25000)]);
  const brainBase = { brain: "keywords" };
  try {
    if (isGarbled(input.text)) {
      return finish(input, "unknown", "UNKNOWN", "I didn't catch that. Say it again, or type the command.", brainBase);
    }

    let skill: Skill = keywordSkill(input.text);
    let answer = "";
    let brain = "keywords";
    const canAskGrok = input.model === "grok" || input.model === "auto";
    if (skill === "unknown" && canAskGrok) {
      const judged = await classify(input.text, signal).catch(() => null);
      if (judged) {
        skill = judged.skill === "answer" ? "answer" : judged.skill;
        answer = judged.reply;
        brain = "grok";
      }
    }

    if (skill === "stop") {
      return finish(input, "stop", "VERIFIED", "There's nothing running to stop right now.", { brain });
    }
    if (skill === "send_sms") {
      return finish(input, "send_sms", "UNKNOWN", "Texting is not set up in this cockpit.", {
        brain,
        note: "No Twilio credentials in this build.",
      });
    }
    if (skill === "answer") {
      if (!answer) {
        return finish(input, "answer", "UNKNOWN", "I couldn't get an answer from Grok just now.", { brain });
      }
      return finish(input, "answer", "VERIFIED", answer, {
        brain,
        kind: "answer",
        note: "Answered by Grok. This was not checked on the phone.",
      });
    }
    if (skill === "unknown") {
      const spoken = canAskGrok
        ? "I can't do that on the phone yet. Ask for your battery level, or say open settings."
        : "That brain is not linked. Switch to Grok or Auto, or ask for battery level or settings.";
      return finish(input, "unknown", "UNKNOWN", spoken, { brain: canAskGrok ? brain : "unlinked" });
    }
    if (!input.baseUrl.trim()) {
      return finish(input, skill, "UNKNOWN", "No phone is linked. Connect your Droid-MCP URL first.", { brain });
    }

    const url = await assertPublicUrl(input.baseUrl);
    const session = new McpSession(url.toString(), input.token, signal);
    await session.init();
    const outcome = await runSkill(skill, session, signal);
    return finish(input, skill, outcome.status, outcome.spoken, { brain, ...outcome.details });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return finish(input, "stop", "STOPPED", "Operation stopped.", { brain: "keywords" });
    }
    if (error instanceof McpUnreachable) {
      return finish(input, keywordSkill(input.text), "UNKNOWN", error.message, { brain: "keywords" });
    }
    if (error instanceof McpError) {
      return finish(input, keywordSkill(input.text), "FAILED", error.message, { brain: "keywords" });
    }
    const message = error instanceof Error ? error.message : "I couldn't complete that.";
    return finish(input, "unknown", "UNKNOWN", message.slice(0, 240), { brain: "keywords" });
  } finally {
    if (input.opId) live.delete(input.opId);
  }
}

export function parseModel(value: unknown): ModelKey {
  return typeof value === "string" && isModelKey(value) ? value : "auto";
}
