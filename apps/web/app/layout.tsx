import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MoneyControl",
  description: "Personal-finance control plane",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
