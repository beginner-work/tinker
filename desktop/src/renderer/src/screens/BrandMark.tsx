// The tinker rainbow web mark — same drawing as the browser app, in a small
// pill above the auth title.
export function BrandMark() {
  return (
    <div className="mb-6 flex items-center gap-2">
      <svg
        viewBox="0 0 200 200"
        width="28"
        height="28"
        aria-hidden="true"
        fill="none"
      >
        <rect width="200" height="200" rx="44" fill="#f5f3ef" />
        <circle cx="100" cy="100" r="76" stroke="#c8b6e2" strokeWidth="11" />
        <line x1="24" y1="100" x2="176" y2="100" stroke="#fdba74" strokeWidth="11" strokeLinecap="round" />
        <line x1="34.2" y1="62" x2="165.8" y2="62" stroke="#f9a8d4" strokeWidth="11" strokeLinecap="round" />
        <line x1="34.2" y1="138" x2="165.8" y2="138" stroke="#fde68a" strokeWidth="11" strokeLinecap="round" />
        <line x1="100" y1="24" x2="100" y2="176" stroke="#6ee7b7" strokeWidth="11" strokeLinecap="round" />
        <ellipse cx="100" cy="100" rx="26" ry="76" stroke="#7dd3fc" strokeWidth="11" />
        <ellipse cx="100" cy="100" rx="52" ry="76" stroke="#7bc47a" strokeWidth="11" />
      </svg>
      <span className="font-display text-base font-bold tracking-tight">
        tinker chat
      </span>
    </div>
  );
}
