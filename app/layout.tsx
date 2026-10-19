import type { Metadata } from "next";
import { Instrument_Serif, Newsreader, Public_Sans } from "next/font/google";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { ThemeToggle } from "@/components/theme";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LMAgent",
  description: "Lettres de motivation personnalisées par offre d'emploi.",
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
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" aria-label="LMAgent, accueil">
              <Logo className="text-lg" markClassName="size-9" />
            </Link>
            <nav className="flex flex-wrap items-center gap-4 text-sm">
              <Link href="/profiles" className="font-medium hover:underline">
                Profils
              </Link>
              <Link href="/profiles/new" className="font-medium hover:underline">
                Importer un CV
              </Link>
              <Link href="/letters/new" className="font-medium hover:underline">
                Nouvelle lettre
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
