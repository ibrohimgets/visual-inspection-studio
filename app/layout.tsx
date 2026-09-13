import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visual Inspection Studio",
  description:
    "Turn quality-spec PDFs into approved inspection rules, run local computer-vision inference, review findings, and export auditable reports.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
