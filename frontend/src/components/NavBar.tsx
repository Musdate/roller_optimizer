import { useEffect, useState } from "react";

export type View = "optimizer" | "freon" | "minado" | "estrategia12h" | "excavacion";

const TABS: { value: View; label: string }[] = [
  { value: "optimizer", label: "Optimizador de Sala" },
  { value: "freon", label: "Calculadora Freon" },
  { value: "minado", label: "Calculadora de minado" },
  { value: "estrategia12h", label: "Estrategia 12h" },
  { value: "excavacion", label: "Excavación SFL" },
];

const MINAR_Y_GANAR_URL = "https://minaryganar.com/rollercoin/room-simulator";

export default function NavBar({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  // Solo en mobile: las pestañas pasan a un panel lateral (ver .nav en index.css).
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <nav className="nav">
      <button
        className="nav-burger"
        aria-label="Abrir menú"
        aria-expanded={open}
        aria-controls="nav-links"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <span className="nav-current">{TABS.find((t) => t.value === view)?.label}</span>

      {open && <div className="nav-backdrop" onClick={() => setOpen(false)} />}
      <div id="nav-links" className={`nav-links${open ? " open" : ""}`}>
        {TABS.map((t) => (
          // enlace real: la rueda del mouse o Ctrl+clic abren la vista en otra pestaña
          <a
            key={t.value}
            href={`#${t.value}`}
            className={`nav-tab nav-tab-link${view === t.value ? " active" : ""}`}
            aria-current={view === t.value ? "page" : undefined}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onChange(t.value);
              setOpen(false);
            }}
          >
            {t.label}
          </a>
        ))}
        <a
          className="nav-tab nav-tab-link"
          href={MINAR_Y_GANAR_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
        >
          Minar y Ganar
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </a>
      </div>
    </nav>
  );
}
