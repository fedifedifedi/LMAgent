/** Confirmation après enregistrement : coche tracée en CSS (classe .draw-tick), visible même sans animation. */
export function SavedNotice() {
  return (
    <p role="status" className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <svg viewBox="0 0 22 22" className="draw-tick size-5" aria-hidden="true">
        <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" />
      </svg>
      Profil enregistré.
    </p>
  );
}
