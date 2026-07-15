import Link from "next/link";

export function NewScriptButton() {
  return (
    <Link href="/wizard" className="btn-clay inline-flex items-center px-5 py-2.5">
      New session
    </Link>
  );
}
