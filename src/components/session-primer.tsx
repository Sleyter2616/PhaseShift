import {
  SESSION_PRIMER_POINTS,
  SESSION_PRIMER_TITLE,
} from "@/lib/session/primer";

type SessionPrimerProps = {
  /** Primary CTA label */
  actionLabel: string;
  onAction?: () => void;
  actionPending?: boolean;
  actionDisabled?: boolean;
  /** When set, render as a button; otherwise omit the CTA (read-only page). */
  showAction?: boolean;
  /** Defaults to btn-clay (setup). Session field should pass btn-sand. */
  actionClassName?: string;
  className?: string;
};

/**
 * Calm first-session / how-to primer. Parent supplies setup or session surface.
 */
export function SessionPrimerContent({
  actionLabel,
  onAction,
  actionPending = false,
  actionDisabled = false,
  showAction = true,
  actionClassName = "btn-clay w-full py-3 text-base",
  className = "",
}: SessionPrimerProps) {
  return (
    <div className={`w-full max-w-md space-y-8 ${className}`.trim()}>
      <div className="text-center">
        <h1 className="font-display text-2xl font-normal text-[var(--text-hi)] sm:text-3xl">
          {SESSION_PRIMER_TITLE}
        </h1>
      </div>
      <ul className="space-y-4 text-sm leading-relaxed text-[var(--text-mid)] sm:text-base">
        {SESSION_PRIMER_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {showAction && onAction ? (
        <button
          type="button"
          disabled={actionDisabled || actionPending}
          onClick={onAction}
          className={actionClassName}
        >
          {actionPending ? "Continuing…" : actionLabel}
        </button>
      ) : null}
    </div>
  );
}
