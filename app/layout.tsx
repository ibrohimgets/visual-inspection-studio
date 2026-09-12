import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visual Inspection Studio",
  description:
    "Run local computer-vision inference, review magnified findings, process image batches, and export inspection reports.",
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
