"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Largeur d'une feuille A4 en px CSS (210 mm à 96 dpi). */
const A4_WIDTH_PX = (210 / 25.4) * 96;

/**
 * Met la feuille A4 à l'échelle de la colonne (zoom CSS) au lieu de la rétrécir : les retours à la ligne de l'aperçu
 * restent ceux du PDF.
 */
export function SheetFit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setZoom(Math.min(1, entry.contentRect.width / A4_WIDTH_PX)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full">
      <div style={{ zoom, width: A4_WIDTH_PX }} className="mx-auto [&_[data-letter-sheet]]:max-w-none">
        {children}
      </div>
    </div>
  );
}
