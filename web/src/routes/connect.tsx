import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { testPhone } from "@/lib/opengrox/api";

export const Route = createFileRoute("/connect")({ component: ConnectPhone });

const LINK_KEY = "opengrox.link";

type SavedLink = {
  baseUrl: string;
  token: string;
  label: string;
  status: "connected" | "unreachable";
  toolCount?: number;
  deviceLabel?: string;
};

function ConnectPhone() {
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("My Phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LINK_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedLink;
      setBaseUrl(saved.baseUrl ?? "");
      setToken(saved.token ?? "");
      setLabel(saved.label || "My Phone");
    } catch {
      /* ignore broken storage */
    }
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await testPhone({ data: { baseUrl, token, label } });
      if (res.status !== "connected") {
        setError(res.error || "Could not reach the phone.");
        return;
      }
      const saved: SavedLink = {
        baseUrl: baseUrl.trim(),
        token,
        label: res.label,
        status: "connected",
        toolCount: res.toolCount,
        deviceLabel: res.deviceLabel,
      };
      localStorage.setItem(LINK_KEY, JSON.stringify(saved));
      setNote(res.deviceLabel ? `Linked. ${res.deviceLabel}. ${res.toolCount ?? 0} tools.` : `Linked. ${res.toolCount ?? 0} tools.`);
      window.setTimeout(() => void navigate({ to: "/" }), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    localStorage.removeItem(LINK_KEY);
    setBaseUrl("");
    setToken("");
    setNote(null);
    setError(null);
    void navigate({ to: "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 py-6">
      <Link to="/" className="w-fit font-mono text-xs font-bold tracking-widest text-brand">
        ‹ BACK
      </Link>
      <h1 className="font-display text-3xl font-bold tracking-widest text-on-surface">CONNECT PHONE</h1>
      <p className="font-mono text-sm leading-6 text-on-surface-3">
        Link the Android handset running Droid-MCP. The URL has to be reachable on the public internet — a tunnel,
        not a private Wi-Fi address. The Termux checkout on the phone is the project tree, not this endpoint.
      </p>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs font-bold tracking-widest text-muted">DROID-MCP URL</span>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://your-phone.example.com/mcp"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-12 rounded border border-line bg-surface-2 px-3 font-mono text-sm text-on-surface outline-none placeholder:text-muted"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs font-bold tracking-widest text-muted">BEARER TOKEN</span>
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          type="password"
          placeholder="token from the Droid-MCP app"
          autoCapitalize="none"
          autoCorrect="off"
          className="min-h-12 rounded border border-line bg-surface-2 px-3 font-mono text-sm text-on-surface outline-none placeholder:text-muted"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs font-bold tracking-widest text-muted">LABEL</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="min-h-12 rounded border border-line bg-surface-2 px-3 font-mono text-sm text-on-surface outline-none"
        />
      </label>

      {error ? <p className="font-mono text-sm leading-6 text-danger">{error}</p> : null}
      {note ? <p className="font-mono text-sm leading-6 text-brand">{note}</p> : null}

      <button
        type="button"
        onClick={() => void connect()}
        disabled={busy}
        className="min-h-12 rounded bg-brand font-mono text-sm font-bold tracking-widest text-on-brand disabled:opacity-50"
      >
        {busy ? "TESTING..." : "CONNECT & TEST"}
      </button>
      <button type="button" onClick={disconnect} className="min-h-12 font-mono text-xs font-bold tracking-widest text-muted">
        DISCONNECT PHONE
      </button>
    </main>
  );
}
