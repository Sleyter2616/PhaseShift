"use client";

import { Mark } from "@/components/mark";

interface SessionPulseProps {
  beatHz: number;
  className?: string;
}

export function SessionPulse({ beatHz, className = "" }: SessionPulseProps) {
  const periodSec = beatHz > 0 ? 1 / beatHz : 1;

  return (
    <div
      className={`session-pulse-wrap ${className}`}
      style={{ "--pulse-period": `${periodSec}s` } as React.CSSProperties}
      aria-hidden
    >
      <div className="session-pulse-glow" />
      <div className="session-pulse-core">
        <Mark size={40} />
      </div>
    </div>
  );
}

interface PhaseJourneyProps {
  phases: string[];
  currentPhase: string | null;
}

export function PhaseJourney({ phases, currentPhase }: PhaseJourneyProps) {
  return (
    <div className="flex items-center justify-center gap-2" aria-label="Phase journey">
      {phases.map((phase) => (
        <span
          key={phase}
          className={`phase-dot ${currentPhase === phase ? "phase-dot-active" : ""}`}
          title={phase}
        />
      ))}
    </div>
  );
}
