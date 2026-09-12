import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visual Inspection Studio",
  description:
    "Run YOLOX object detection on your device, review predictions, and export annotated inspection results.",
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
