interface MarkProps {
  size?: number;
  className?: string;
  labeled?: boolean;
}

export function Mark({ size = 24, className = "", labeled = false }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={!labeled}
      role={labeled ? "img" : undefined}
    >
      {labeled ? <title>PhaseShift</title> : null}
      <polygon
        points="12,2.5 20.23,16.75 3.77,16.75"
        stroke="var(--accent-sand)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="none"
        opacity="0.85"
      />
      <polygon
        points="12,21.5 20.23,7.25 3.77,7.25"
        stroke="var(--accent-sand)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="none"
        opacity="0.85"
      />
      <circle cx="12" cy="12" r="2.25" fill="var(--accent-sand)" />
    </svg>
  );
}
