import { Mic } from "lucide-react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

const LABEL: Record<OrbState, string> = {
  idle: "TAP TO SPEAK",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  error: "CHECK LINK",
};

export function VoiceOrb({ state, onPress }: { state: OrbState; onPress: () => void }) {
  const hot = state === "error" ? "border-danger text-danger" : "border-brand text-brand";
  return (
    <div className={`og-${state} relative mx-auto flex h-64 w-64 items-center justify-center`} data-testid="voice-orb">
      <span className={`og-ring pointer-events-none absolute inset-2 rounded-full border ${hot}`} />
      <span className={`og-ring og-ring-b pointer-events-none absolute inset-2 rounded-full border ${hot}`} />
      {state === "thinking" ? (
        <span className={`og-arc pointer-events-none absolute inset-6 rounded-full border-2 border-transparent border-t-brand`} />
      ) : null}
      <button
        type="button"
        onClick={onPress}
        aria-label={LABEL[state]}
        className={`og-core relative flex size-40 items-center justify-center rounded-full border-2 bg-brand-dim ${hot} ${state === "error" ? "og-core-error" : ""}`}
      >
        {state === "thinking" ? (
          <span className="font-mono text-2xl tracking-widest text-brand">···</span>
        ) : state === "speaking" ? (
          <span className="font-mono text-2xl tracking-widest text-brand">)))</span>
        ) : (
          <Mic className="size-8" strokeWidth={1.75} />
        )}
      </button>
      <p className={`absolute bottom-0 font-mono text-xs tracking-widest ${state === "error" ? "text-danger" : "text-brand"}`}>
        {LABEL[state]}
      </p>
    </div>
  );
}
