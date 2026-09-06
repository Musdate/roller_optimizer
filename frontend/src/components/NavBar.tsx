export type View = "optimizer" | "estrategia12h";

const TABS: { value: View; label: string }[] = [
  { value: "optimizer", label: "Optimizador de Sala" },
  { value: "estrategia12h", label: "Estrategia 12h" },
];

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
    </nav>
  );
}
