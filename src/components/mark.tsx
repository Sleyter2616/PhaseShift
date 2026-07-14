interface MarkProps {
  size?: number;
  className?: string;
  title?: string;
}

/** Star-tetrahedron mark: two overlaid triangles + sand center dot. */
export function Mark({ size = 28, className, title = "PhaseShift" }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <polygon
        points="16,3 28,27 4,27"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <polygon
        points="16,29 4,5 28,5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.4" fill="var(--accent-sand, #e6b98f)" />
    </svg>
  );
}
