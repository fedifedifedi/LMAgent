"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/profiles", label: "Profils", match: (p: string) => p === "/profiles" || (p.startsWith("/profiles/") && !p.startsWith("/profiles/new")) },
  { href: "/profiles/new", label: "Importer un CV", match: (p: string) => p.startsWith("/profiles/new") },
  { href: "/letters/new", label: "Nouvelle lettre", match: (p: string) => p.startsWith("/letters") },
];

/** Navigation de l'en-tête avec la section active mise en évidence. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn("rounded-md px-2.5 py-1.5 font-medium hover:bg-accent", active && "bg-accent")}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
