import Link from "next/link";

export function NewScriptButton() {
  return (
    <Link
      href="/wizard"
      className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
    >
      New script
    </Link>
  );
}
