import { useEffect } from "react";
import { useUndo } from "../undoState";

export default function UndoToast() {
  const entry = useUndo((s) => s.entry);
  const apply = useUndo((s) => s.apply);
  const clear = useUndo((s) => s.clear);

  useEffect(() => {
    if (!entry) return;
    const id = window.setTimeout(clear, 7000);
    return () => window.clearTimeout(id);
  }, [entry, clear]);

  if (!entry) return null;
  return (
    <div className="undo-toast">
      <span>{entry.label}</span>
      <button className="tiny" onClick={apply}>
        Deshacer
      </button>
    </div>
  );
}
