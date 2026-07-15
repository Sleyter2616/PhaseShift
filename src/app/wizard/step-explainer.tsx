export function StepExplainer({ text }: { text: string }) {
  if (!text) return null;
  return <p className="margin-note">{text}</p>;
}

export function FieldExplainer({ text }: { text: string }) {
  if (!text) return null;
  return <p className="margin-note mb-2">{text}</p>;
}
