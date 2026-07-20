import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PhaseShift",
  description: "A guided practice built on a proprietary protocol — personal, precise, deliberate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
