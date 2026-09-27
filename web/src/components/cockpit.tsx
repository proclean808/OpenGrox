import { Link } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { runCommand, stopCommand } from "@/lib/opengrox/api";
import { MODELS, type CommandResult, type CommandStatus, type ModelKey } from "@/lib/opengrox/logic";
import { VoiceOrb, type OrbState } from "@/components/voice-orb";

type SavedLink = {
  baseUrl: string;
  token: string;
  label: string;
  status: "connected" | "unreachable";
  toolCount?: number;
  deviceLabel?: string;
};

type LogItem = {
  id: string;
  transcript: string;
  status: CommandStatus;
  spoken: string;
  skill: string;
};

const LINK_KEY = "opengrox.link";
const MODEL_KEY = "opengrox.model";
const LOG_KEY = "opengrox.log";

type Recog = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function badgeClass(status: CommandStatus): string {
  if (status === "VERIFIED") return "bg-brand text-on-brand";
  if (status === "FAILED") return "bg-danger text-on-danger";
  if (status === "UNKNOWN") return "bg-warning text-on-warning";
  return "bg-surface-3 text-on-surface-3";
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

export function Cockpit() {
  const [model, setModel] = useState<ModelKey>("auto");
  const [link, setLink] = useState<SavedLink | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [ready, setReady] = useState(false);
  const [orb, setOrb] = useState<OrbState>("idle");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("Awaiting command...");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const gen = useRef(0);
  const opId = useRef("");
  const rec = useRef<Recog | null>(null);

  useEffect(() => {
    const savedModel = localStorage.getItem(MODEL_KEY);
    if (savedModel === "grok" || savedModel === "chatgpt" || savedModel === "gemini" || savedModel === "claude" || savedModel === "auto") {
      setModel(savedModel);
    }
    setLink(loadJson<SavedLink>(LINK_KEY));
    setLog(loadJson<LogItem[]>(LOG_KEY) ?? []);
    setReady(true);
  }, []);

  function pickModel(next: ModelKey) {
    setModel(next);
    localStorage.setItem(MODEL_KEY, next);
  }

  async function execute(text: string) {
    const command = text.trim();
    if (!command || busy) return;
    const ticket = ++gen.current;
    const id = crypto.randomUUID();
    opId.current = id;
    setBusy(true);
    setHint(null);
    setResult(null);
    setOrb("thinking");
    setAction("Routing the command...");
    try {
      const res = await runCommand({
        data: {
          text: command,
          model,
          baseUrl: link?.baseUrl ?? "",
          token: link?.token ?? "",
          opId: id,
        },
      });
      if (ticket !== gen.current) return;
      setResult(res);
      setAction(res.spoken);
      setLog((prev) => {
        const trimmed = [
          { id: res.commandId, transcript: res.transcript, status: res.status, spoken: res.spoken, skill: res.skill },
          ...prev,
        ].slice(0, 12);
        localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
        return trimmed;
      });
      if (res.status === "UNKNOWN" && /could not reach|not trusted|refused/i.test(res.spoken) && link) {
        const next = { ...link, status: "unreachable" as const };
        setLink(next);
        localStorage.setItem(LINK_KEY, JSON.stringify(next));
      }
      setOrb("speaking");
      speak(res.spoken);
      window.setTimeout(() => {
        if (ticket === gen.current) setOrb(link?.status === "unreachable" ? "error" : "idle");
      }, 1200);
    } catch (error) {
      if (ticket !== gen.current) return;
      const message = error instanceof Error ? error.message : "I couldn't complete that.";
      setAction(message);
      setOrb("error");
    } finally {
      if (ticket === gen.current) setBusy(false);
    }
  }

  function startListening() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog })
      .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recog }).webkitSpeechRecognition;
    if (!Ctor) {
      setHint("This browser has no speech recognition. Type the command below.");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (ev) => {
      const said = ev.results?.[0]?.[0]?.transcript ?? "";
      if (said.trim()) void execute(said);
      else {
        setAction("I didn't catch that. Try again.");
        setOrb("idle");
        setBusy(false);
      }
    };
    recognition.onerror = () => {
      setHint("Microphone was blocked or failed. Type the command below.");
      setOrb("idle");
      setBusy(false);
    };
    recognition.onend = () => {
      rec.current = null;
    };
    rec.current = recognition;
    setOrb("listening");
    setAction("Listening...");
    setBusy(true);
    try {
      recognition.start();
    } catch {
      setHint("Voice capture isn't available. Type the command below.");
      setOrb("idle");
      setBusy(false);
    }
  }

  function onOrb() {
    if (rec.current) {
      rec.current.stop();
      return;
    }
    if (busy) return;
    startListening();
  }

  async function onStop() {
    gen.current += 1;
    rec.current?.abort();
    rec.current = null;
    window.speechSynthesis?.cancel();
    const id = opId.current;
    setBusy(false);
    setOrb("idle");
    setAction("Stopped.");
    setResult({
      commandId: "local-stop",
      transcript: "Stop.",
      model,
      skill: "stop",
      status: "STOPPED",
      spoken: "Stopped.",
      details: { brain: "cockpit" },
    });
    if (id) await stopCommand({ data: { opId: id } }).catch(() => undefined);
  }

  const caption = MODELS.find((m) => m.key === model)?.caption ?? "";
  const pill =
    !ready || !link
      ? { text: "NO PHONE LINKED", tone: "text-muted" }
      : link.status === "connected"
        ? { text: `${link.label.toUpperCase()} LINKED`, tone: "text-brand" }
        : { text: `${link.label.toUpperCase()} UNREACHABLE`, tone: "text-danger" };

  return (
    <main className="relative min-h-dvh">
      <div className="og-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4 lg:flex-row lg:px-8 lg:py-8">
        <section className="flex w-full min-w-0 flex-col gap-4 lg:max-w-xl">
          <header className="flex items-center justify-between gap-3">
            <Link
              to="/connect"
              className="inline-flex min-h-11 items-center gap-2 rounded border border-line bg-surface-2 px-3 py-2"
              data-testid="status-pill"
            >
              <span className={`size-2 rounded-full bg-current ${pill.tone}`} />
              <span className={`font-mono text-xs font-bold tracking-widest ${pill.tone}`}>{pill.text}</span>
            </Link>
            <div className="text-right">
              <p className="font-display text-xl font-bold tracking-widest text-on-surface">OPENGROX</p>
              <p className="font-mono text-xs tracking-widest text-muted">COMMAND DROID</p>
            </div>
          </header>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="model-selector">
            {MODELS.map((item) => {
              const on = item.key === model;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => pickModel(item.key)}
                  className={`min-h-11 rounded border px-2 font-mono text-xs font-bold tracking-wide ${
                    on ? "border-brand bg-brand text-on-brand" : "border-line bg-surface-3 text-on-surface-3"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="font-mono text-xs leading-5 text-muted">{caption}</p>

          <VoiceOrb state={orb} onPress={onOrb} />

          <p className="flex gap-2 font-mono text-sm leading-6 text-on-surface-2" data-testid="current-action">
            <span className="text-brand">{">"}</span>
            <span>{action}</span>
          </p>

          {hint ? (
            <p className="rounded border border-warning bg-surface-2 px-3 py-3 font-mono text-xs leading-5 text-warning">{hint}</p>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            {[
              ["Battery", "What's my battery level?"],
              ["Settings", "Open Settings"],
              ["Stop", "Stop"],
            ].map(([label, command]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => void execute(command)}
                className="min-h-11 rounded border border-line bg-surface-2 px-2 font-mono text-xs font-bold tracking-widest text-on-surface-2 disabled:opacity-40"
              >
                {label.toUpperCase()}
              </button>
            ))}
          </div>

          {result ? (
            <article className="flex flex-col gap-3 rounded border border-line bg-surface-2 p-4" data-testid="result-card">
              <span className={`inline-flex w-fit items-center rounded px-3 py-1 font-mono text-xs font-bold tracking-widest ${badgeClass(result.status)}`}>
                {result.status}
              </span>
              <p className="font-mono text-xs tracking-wide text-muted">YOU: {result.transcript}</p>
              <p className="font-display text-xl leading-7 text-on-surface">{result.spoken}</p>
              {typeof result.details.batteryLevel === "number" ? (
                <p className="font-mono text-xs font-bold tracking-widest text-brand">
                  BATTERY {result.details.batteryLevel}%{result.details.charging ? " · CHARGING" : ""}
                </p>
              ) : null}
              {result.details.note ? <p className="font-mono text-xs leading-5 text-on-surface-3">{result.details.note}</p> : null}
              {result.details.foregroundPackage ? (
                <p className="font-mono text-xs tracking-wide text-on-surface-3">FOREGROUND {result.details.foregroundPackage}</p>
              ) : null}
            </article>
          ) : null}

          {busy ? (
            <button
              type="button"
              onClick={() => void onStop()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded bg-danger font-mono text-sm font-bold tracking-widest text-on-danger"
              data-testid="stop-button"
            >
              <span className="size-3 bg-on-danger" />
              STOP
            </button>
          ) : null}

          <form
            className="mt-auto flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = typed;
              setTyped("");
              void execute(next);
            }}
          >
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="or type a command..."
              disabled={busy}
              className="min-h-12 min-w-0 flex-1 rounded border border-line bg-surface-2 px-3 font-mono text-sm text-on-surface outline-none placeholder:text-muted"
              data-testid="command-input"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded bg-brand px-4 font-mono text-xs font-bold tracking-widest text-on-brand disabled:opacity-40"
            >
              <Send className="size-4 sm:hidden" />
              <span className="hidden sm:inline">SEND</span>
            </button>
          </form>
        </section>

        <aside className="min-w-0 flex-1 rounded border border-line bg-surface-2 p-4">
          <h2 className="font-display text-lg font-bold tracking-widest text-on-surface">MISSION LOG</h2>
          <p className="mt-1 font-mono text-xs leading-5 text-muted">
            Phone actions are VERIFIED only after the handset confirms them. Nothing here is simulated.
          </p>
          {link?.deviceLabel ? (
            <p className="mt-3 font-mono text-xs tracking-wide text-brand">{link.deviceLabel}{link.toolCount != null ? ` · ${link.toolCount} TOOLS` : ""}</p>
          ) : null}
          <ul className="mt-4 flex flex-col gap-3">
            {log.length === 0 ? (
              <li className="font-mono text-sm leading-6 text-on-surface-3">No commands yet. Ask for battery level, or say open settings.</li>
            ) : (
              log.map((item) => (
                <li key={item.id} className="border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded px-2 py-1 font-mono text-xs font-bold tracking-widest ${badgeClass(item.status)}`}>{item.status}</span>
                    <span className="font-mono text-xs text-muted">{item.skill.toUpperCase()}</span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-muted">YOU: {item.transcript}</p>
                  <p className="mt-1 font-mono text-sm leading-6 text-on-surface-2">{item.spoken}</p>
                </li>
              ))
            )}
          </ul>
        </aside>
      </div>
    </main>
  );
}
