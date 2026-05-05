/* Session.jsx — a single sidebar item.
 * Three visual states: default, hover, selected. Plus an inline
 * spinner when loading.
 */
function MiniHomeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="#c8b6e2" strokeWidth="1.6" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="#fdba74" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="8" y1="2" x2="8" y2="14" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="8" cy="8" rx="3" ry="6" stroke="#7dd3fc" strokeWidth="1.6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Session({ session, selected, onSelect, onClose }) {
  const { kind, title, loading } = session;
  let icon;
  if (loading) icon = <span className="session__spinner" />;
  else if (kind === "home") icon = <MiniHomeIcon />;
  else if (kind === "search") icon = <SearchIcon />;
  else icon = <GlobeIcon />;

  return (
    <button
      className="session"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
    >
      <span className="session__icon">{icon}</span>
      <span className="session__title">{title}</span>
      <span
        className="session__close"
        role="button"
        aria-label="Close session"
        onClick={(e) => { e.stopPropagation(); onClose && onClose(); }}
      >
        <CloseIcon />
      </span>
    </button>
  );
}

window.Session = Session;
