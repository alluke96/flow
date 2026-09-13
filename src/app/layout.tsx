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

  // Marca o documento como "app de TV" quando o build é o do widget (ver
  // scripts/build-tizen.mjs). É por essa classe que o CSS aplica a ampliação
  // de 10 pés e o realce de foco próprio da TV — coisas que não são
  // compatibilidade com navegador velho, e sim decisão de design pra uma
  // tela vista do sofá, a 3 metros, com controle remoto.
  const classeTv = process.env.FLOW_TIZEN === "1" ? "tv-widget " : "";

  return (
    <html lang="pt-BR" className={`${classeTv}h-full ${spaceGrotesk.variable}`}>
      <body className="min-h-full">
        <NavRouterProvider>
          <ProfileProvider>{children}</ProfileProvider>
        </NavRouterProvider>
        <DebugOverlay />
      </body>
    </html>
  );
}
