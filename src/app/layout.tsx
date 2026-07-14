import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PhaseShift",
  description: "Reality-engineering meditation app",
  icons: {
    icon: "/mark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-body antialiased">{children}</body>
    </html>
  );
}
