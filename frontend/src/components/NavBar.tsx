export type View = "optimizer" | "estrategia12h";

const TABS: { value: View; label: string }[] = [
  { value: "optimizer", label: "Optimizador de Sala" },
  { value: "estrategia12h", label: "Estrategia 12h" },
];

const MINAR_Y_GANAR_URL = "https://minaryganar.com/rollercoin/room-simulator";

export default function NavBar({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <button
          key={t.value}
          className={`nav-tab${view === t.value ? " active" : ""}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
      <a
        className="nav-tab nav-tab-link"
        href={MINAR_Y_GANAR_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Minar y Ganar
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      </a>
    </nav>
  );
}
