import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HR Streaming Schedule",
  description: "Weekly livestream calendar synced from Live_Session_Master",
  icons: {
    icon: [{ url: "/rr-logo-submark-square.png", type: "image/png", sizes: "512x512" }],
    shortcut: "/rr-logo-submark-square.png",
    apple: [{ url: "/rr-logo-submark-square.png", sizes: "512x512", type: "image/png" }]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
