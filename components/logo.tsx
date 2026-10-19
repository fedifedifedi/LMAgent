import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Logo LMAgent, redessiné en vectoriel d'après l'original fourni (public/brand/lmagent-logo-original.jpg) :
 * arc, disque bleu nuit cerclé vert-violet avec lueur verte, feuille au coin replié doré, accolades, éclair doré,
 * barre verte et lignes de texte. L'arc suit la couleur du texte (visible en clair comme en sombre).
 * `compact` retire l'arc et la lueur pour les petites tailles (favicon, en-tête).
 */
export function LogoMark({ className, compact = false }: { className?: string; compact?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const gold = `gold-${uid}`;
  const ring = `ring-${uid}`;
  const glow = `glow-${uid}`;

  return (
    <svg viewBox="0 0 120 120" className={cn("shrink-0", className)} aria-hidden="true">
      <defs>
        {/* userSpaceOnUse : en objectBoundingBox, un trait horizontal (boîte de hauteur nulle) ne serait pas dessiné. */}
        <linearGradient id={gold} gradientUnits="userSpaceOnUse" x1="38" y1="34" x2="86" y2="97">
          <stop offset="0" stopColor="#f6d98a" />
          <stop offset="1" stopColor="#c8963a" />
        </linearGradient>
        <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ee0a0" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {!compact && <path className="logo-arc" d="M12 36A54 54 0 0 1 108 36" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />}
      {!compact && <circle className="logo-glow" cx="60" cy="68" r="40" fill="#34d399" opacity="0.35" filter={`url(#${glow})`} />}
      <circle cx="60" cy="68" r="44" fill="#162140" />
      <circle className="logo-ring" cx="60" cy="68" r="44" fill="none" stroke={`url(#${ring})`} strokeWidth="2.5" />

      <path d="M43 34H74L86 46V97H43Q38 97 38 92V39Q38 34 43 34Z" fill="#13203b" stroke={`url(#${gold})`} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M74 34V46H86Z" fill={`url(#${gold})`} />

      <g fill="none" stroke={`url(#${gold})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 57Q46 57 46 61V63Q46 66 43.5 66Q46 66 46 69V71Q46 75 50 75" />
        <path d="M76 57Q80 57 80 61V63Q80 66 82.5 66Q80 66 80 69V71Q80 75 76 75" />
      </g>
      {!compact && <path d="M61 51L52 68H59L55 83L67 63H60Z" fill="#34d399" opacity="0.45" filter={`url(#${glow})`} />}
      <path d="M61 51L52 68H59L55 83L67 63H60Z" fill={`url(#${gold})`} />
      <rect x="68" y="58" width="4" height="16" rx="1" fill="#34d399" />

      <g stroke={`url(#${gold})`} strokeWidth="2.6" strokeLinecap="round">
        <path d="M61 84H80" />
        <path d="M47 89.5H80" />
        <path d="M47 95H70" />
      </g>
    </svg>
  );
}

/** Nom de l'application : « LMAgent » (Lettre de Motivation Agent), toujours écrit ainsi. */
export const APP_NAME = "LMAgent";

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans font-extrabold tracking-tight", className)} translate="no">
      {APP_NAME}
    </span>
  );
}

/** Composition de l'original : marque au-dessus, nom centré en dessous (accueil, PDF). */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-center gap-3", className)}>
      <LogoMark className="size-40" />
      <Wordmark className="text-4xl" />
    </span>
  );
}

/** Logo en ligne : marque + nom (en-tête). */
export function Logo({ className, markClassName, compact = true }: { className?: string; markClassName?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn("size-9", markClassName)} compact={compact} />
      <Wordmark />
    </span>
  );
}
