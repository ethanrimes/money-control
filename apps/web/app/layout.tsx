import "./globals.css";
import type { Metadata } from "next";
import { TabsNav } from "@/components/TabsNav";

export const metadata: Metadata = {
  title: "MoneyControl",
  description: "Personal-finance control plane",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <TabsNav />
        {children}
      </body>
    </html>
  );
}
