import Link from "next/link";

export function NewScriptButton() {
  return (
    <Link href="/wizard" className="setup-btn-primary">
      New session
    </Link>
  );
}
