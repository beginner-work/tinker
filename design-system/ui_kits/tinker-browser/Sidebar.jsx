/* Sidebar.jsx — left rail. Brand · Nav · New session · Sessions · Footer. */

const NavBack = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const NavForward = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const NavReload = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const NavHome = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2v-9z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

function Sidebar({ sessions, activeId, onSelect, onClose, onNew, onHome, onBack, onForward, onReload }) {
  const active = sessions.find((s) => s.id === activeId);
  const onHomePage = !active || active.kind === "home";
  return (
    <aside className="sidebar" role="navigation" aria-label="Sessions">
      <div className="sidebar__head">
        <div className="sidebar__brand" title="tinker">
          <Logo size={22} />
          <span className="sidebar__name">tinker</span>
        </div>
      </div>

      <div className="sidebar__nav" role="group" aria-label="Navigation">
        <button className="icon-btn" title="Back" disabled><NavBack /></button>
        <button className="icon-btn" title="Forward" disabled><NavForward /></button>
        <button className="icon-btn" title="Reload" disabled={onHomePage} onClick={onReload}><NavReload /></button>
        <button className="icon-btn" title="Home" onClick={onHome}><NavHome /></button>
      </div>

      <button className="sidebar__new" type="button" onClick={onNew}>
        <PlusIcon />
        <span>New session</span>
      </button>

      <div className="sidebar__label">Sessions</div>
      <div className="sidebar__sessions" role="tablist">
        {sessions.map((s) => (
          <Session
            key={s.id}
            session={s}
            selected={s.id === activeId}
            onSelect={() => onSelect(s.id)}
            onClose={() => onClose(s.id)}
          />
        ))}
      </div>

      <footer className="sidebar__footer">
        <span>&copy; 2026 tinker</span>
      </footer>
    </aside>
  );
}

window.Sidebar = Sidebar;
