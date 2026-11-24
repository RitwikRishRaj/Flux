import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flux",
  // favicon.svg is drawn for tab sizes; logo.svg is the large version (README, sharing).
  icons: { icon: "/favicon.svg" },
  description:
    "Flux is a collaborative IDE in your browser. Share a workspace, edit the same files, run code and ship together in real time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="font-sans" suppressHydrationWarning>{children}</body>
    </html>
  );
}
