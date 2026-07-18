"use client";

interface ChoiceControlProps {
  type?: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  value?: string;
  disabled?: boolean;
  className?: string;
}

export function ChoiceControl({
  type = "radio",
  name,
  checked,
  onChange,
  children,
  value,
  disabled = false,
  className = "",
}: ChoiceControlProps) {
  return (
    <label className={`choice-control ${className}`.trim()}>
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="choice-control-input"
      />
      <span className="choice-control-indicator" aria-hidden />
      <span className="choice-control-label">{children}</span>
    </label>
  );
}
