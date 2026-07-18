"use client";

const PHASES = ["beta", "alpha", "theta", "gamma"] as const;
type SessionPhase = (typeof PHASES)[number];

function normalizePhase(phase: string | null | undefined): SessionPhase {
  if (phase === "beta" || phase === "alpha" || phase === "theta" || phase === "gamma") {
    return phase;
  }
  return "alpha";
}

interface SessionFieldProps {
  phase?: string | null;
  children: React.ReactNode;
  className?: string;
  as?: "main" | "div";
}

export function SessionField({
  phase = "alpha",
  children,
  className = "",
  as: Tag = "main",
}: SessionFieldProps) {
  const active = normalizePhase(phase);

  return (
    <Tag className="session-field" data-phase={active}>
      <div className="session-field-layers" aria-hidden>
        {PHASES.map((name) => (
          <div
            key={name}
            className={`session-field-layer session-field-layer--${name}${
              name === active ? " is-active" : ""
            }`}
          />
        ))}
        <div className="session-field-vignette" />
      </div>
      <div className={`session-field-content ${className}`.trim()}>{children}</div>
    </Tag>
  );
}
