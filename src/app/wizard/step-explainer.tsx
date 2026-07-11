export function StepExplainer({ text }: { text: string }) {
  if (!text) return null;
  return <p className="text-sm leading-relaxed text-neutral-600">{text}</p>;
}

export function FieldExplainer({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mb-2 text-sm leading-relaxed text-neutral-600">{text}</p>;
}
