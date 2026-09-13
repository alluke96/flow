import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Space_Grotesk } from "next/font/google";
import { ProfileProvider } from "@/context/profile-context";
import { NavRouterProvider } from "@/lib/nav";
import { DebugOverlay } from "@/components/DebugOverlay";
import "./globals.css";

// Só pro wordmark "flow" (ver .brand em globals.css) — o resto do app
// continua na fonte de sistema. next/font baixa e hospeda o arquivo em
// build time (fica em /_next/static, mesma origem), então não bate na CSP
// nem faz request externo em runtime.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "flow — streaming",
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
  //
  // Exceção: o build do app de TV (ver scripts/build-tizen.mjs) é um export
  // ESTÁTICO, empacotado dentro do .wgt e servido de file:// pela própria
  // TV — ali não existe request nenhuma por trás da renderização, nem o
  // proxy roda, então exigir renderização dinâmica só quebraria o build. O
  // CSP daquele contexto é o do próprio widget, não este.
  if (process.env.FLOW_TIZEN !== "1") await connection();

  return (
    <html lang="pt-BR" className={`h-full ${spaceGrotesk.variable}`}>
      <body className="min-h-full">
        <NavRouterProvider>
          <ProfileProvider>{children}</ProfileProvider>
        </NavRouterProvider>
        <DebugOverlay />
      </body>
    </html>
  );
}
