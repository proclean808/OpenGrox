export type ModelKey = "grok" | "chatgpt" | "gemini" | "claude" | "auto";
export type CommandStatus = "VERIFIED" | "FAILED" | "UNKNOWN" | "STOPPED";
export type Skill = "battery" | "open_settings" | "stop" | "send_sms" | "answer" | "unknown";

export type CommandDetails = {
  brain: string;
  batteryLevel?: number;
  charging?: boolean | null;
  foregroundPackage?: string | null;
  error?: string;
  kind?: string;
  toolCount?: number;
  deviceLabel?: string;
  note?: string;
};

export type CommandResult = {
  commandId: string;
  transcript: string;
  model: ModelKey;
  skill: string;
  status: CommandStatus;
  spoken: string;
  details: CommandDetails;
};

export type ConnectionTest = {
  status: "connected" | "unreachable";
  label: string;
  toolCount?: number;
  deviceLabel?: string;
  error?: string;
};

export const MODELS: { key: ModelKey; label: string; caption: string }[] = [
  { key: "grok", label: "GROK", caption: "Phone skills, then Grok for anything else." },
  { key: "chatgpt", label: "CHATGPT", caption: "Keyword router only. This brain is not linked." },
  { key: "gemini", label: "GEMINI", caption: "Keyword router only. This brain is not linked." },
  { key: "claude", label: "CLAUDE", caption: "Keyword router only. This brain is not linked." },
  { key: "auto", label: "AUTO", caption: "Known phone skills first. Grok answers the rest." },
];

export function isModelKey(value: string): value is ModelKey {
  return MODELS.some((m) => m.key === value);
}

export function keywordSkill(text: string): Exclude<Skill, "answer"> {
  const t = text.toLowerCase();
  const trimmed = t.trim();
  const negated = /\b(don't|do not|dont|not)\s+(stop|cancel|abort|halt)\b/.test(trimmed);
  const lead = /^(please\s+)?(stop|cancel|abort|halt)\b/.test(trimmed);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (!negated && (lead || (/\b(stop|cancel|abort|halt)\b/.test(trimmed) && words.length <= 3))) {
    return "stop";
  }
  if (
    trimmed.startsWith("text ") ||
    trimmed.startsWith("sms ") ||
    /send (a |an )?(text|sms)/.test(trimmed) ||
    trimmed.includes("text message")
  ) {
    return "send_sms";
  }
  if (trimmed.includes("batter") || trimmed.includes("charge") || trimmed.includes("power level")) {
    return "battery";
  }
  if (trimmed.includes("setting")) return "open_settings";
  return "unknown";
}

export function isGarbled(text: string): boolean {
  const letters = text.replace(/[^a-z0-9]/gi, "");
  return letters.length < 2;
}
