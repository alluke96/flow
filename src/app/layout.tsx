import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { ProfileProvider } from "@/context/profile-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flow — Streaming",
  description: "Catálogo de filmes e séries em streaming.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Força renderização dinâmica: o CSP com nonce (ver src/proxy.ts) só pode
  // ser aplicado aos scripts do Next.js quando há uma request de verdade por
  // trás da renderização — não em páginas geradas estaticamente no build.
  await connection();

  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full">
        <ProfileProvider>{children}</ProfileProvider>
      </body>
    </html>
  );
}
