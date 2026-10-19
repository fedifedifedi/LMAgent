import type { Metadata } from "next";
import { Instrument_Serif, Newsreader, Public_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LMAgent",
  applicationName: "LMAgent",
  description: "LMAgent (Lettre de Motivation Agent) : une lettre de motivation personnalisée pour chaque offre d'emploi, à partir de ton CV.",
  openGraph: { siteName: "LMAgent", title: "LMAgent", description: "Lettre de Motivation Agent : une lettre par offre, écrite à partir de ton parcours." },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      // La classe .dark est posée par themeScript avant l'hydratation.
      suppressHydrationWarning
      className={`${publicSans.variable} ${instrumentSerif.variable} ${newsreader.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <SmoothScroll />
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur print:hidden">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <Link href="/" aria-label="LMAgent, accueil">
              <Logo className="text-lg" markClassName="size-9" />
            </Link>
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              <Suspense>
                <NavLinks />
              </Suspense>
              <span className="ml-2">
                <ThemeToggle />
              </span>
            </nav>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
