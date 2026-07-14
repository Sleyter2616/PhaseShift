export function StepExplainer({ text }: { text: string }) {
  if (!text) return null;
  return <p className="setup-note mb-3">{text}</p>;
}

export function FieldExplainer({ text }: { text: string }) {
  if (!text) return null;
  return <p className="setup-note mb-2">{text}</p>;
}
