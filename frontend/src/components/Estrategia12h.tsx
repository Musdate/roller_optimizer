import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeWins,
  buildRows,
  compactRemaining,
  createInitialState,
  currentRound,
  expiryOf,
  formatDate,
  formatRemaining,
  formatRoundLabel,
  LOW_MS,
  loadState,
  normalizeState,
  REAL_DURATION,
  ROUND_ALERT_MS,
  ROUND_GAP_MS,
  saveState,
  statusFor,
  toInputValue,
  type S12State,
} from "../estrategia12h";
import "../estrategia12h.css";

const GUIDE = [
  "Cada minijuego empieza en dificultad 1 · nivel 1. Cada victoria activa sube un nivel; al ganar desde nivel 3 se sube de dificultad y el nivel vuelve a 1. Esta herramienta te limita en dificultad 3 · nivel 1 (6 victorias activas): al llegar ahí, el botón «Gané» se bloquea.",
  "Cada barra vence por separado, exactamente 12 horas después de la victoria que la creó. Si jugaste varias partidas con minutos de diferencia, también vencerán con esa misma diferencia.",
  "Para aplicar la estrategia: juega primero 6 victorias (2 rondas de 3) de cada juego que quieras mantener al máximo. Cuando venza la primera barra, 12 horas después, juega una victoria más de ese juego para recuperarla; repite con cada vencimiento. Así mantienes la dificultad sin volver a subirla desde cero.",
];

export default function Estrategia12h() {
  const [state, setState] = useState<S12State>(loadState);
  const [now, setNow] = useState<number>(() => Date.now());
  const [toast, setToast] = useState<{ msg: string; undo?: S12State }>({ msg: "" });
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [roundTime, setRoundTime] = useState("");
  const [roundPicks, setRoundPicks] = useState<Set<string>>(new Set());

  const audioRef = useRef<AudioContext | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());
  const alertedRoundRef = useRef<number | null>(null);
  const baseTitleRef = useRef<string>(document.title);
  const toastTimer = useRef<number>();
  const roundRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const showToast = useCallback((msg: string, undo?: S12State) => {
    setToast({ msg, undo });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast({ msg: "" }), undo ? 5000 : 3600);
  }, []);

  const notify = useCallback((body: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification("Estrategia 12h", { body, tag: "s12-ronda" });
    } catch {
      // algunos navegadores solo permiten notificaciones desde un service worker
    }
  }, []);

  const enableSound = useCallback(() => {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      if (!audioRef.current) audioRef.current = new Ctx();
      if (audioRef.current.state === "suspended") void audioRef.current.resume();
    }
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  const playExpirySound = useCallback(() => {
    const ctx = audioRef.current;
    if (!state.soundEnabled || !ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.055, t0 + i * 0.12 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + i * 0.12);
      osc.stop(t0 + i * 0.12 + 0.12);
    });
  }, [state.soundEnabled]);

  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      setNow(t);
      let expired = false;
      for (const game of state.games) {
        for (const win of game.wins) {
          const key = `${game.id}-${win.time}-${win.duration}`;
          const ms = expiryOf(win) - t;
          if (ms <= 1000 && ms > -2000 && !notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);
            expired = true;
            showToast(`${game.name}: una barra vence ahora.`);
          }
        }
      }
      if (expired) playExpirySound();

      const round = currentRound(state, t);

      // Aviso (también en segundo plano) 5 min antes de que empiece una ronda.
      // Una sola vez por ronda: al recuperar la primera barra el inicio del
      // grupo avanza unos minutos y eso no cuenta como ronda nueva.
      if (round && round.start - t <= ROUND_ALERT_MS) {
        const prev = alertedRoundRef.current;
        if (prev === null || round.start - prev > ROUND_GAP_MS) {
          alertedRoundRef.current = round.start;
          const msg = "En ~5 min empieza una ronda de recuperación.";
          showToast(msg);
          notify(msg);
          playExpirySound();
        }
      }

      document.title = round
        ? `${compactRemaining(round.start - t)} · Estrategia 12h`
        : baseTitleRef.current;
    };
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
      document.title = baseTitleRef.current;
    };
  }, [state, showToast, playExpirySound, notify]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  function recordWin(id: string) {
    enableSound();
    const at = Date.now();
    setState((s) => ({
      ...s,
      games: s.games.map((g) =>
        g.id === id
          ? { ...g, wins: [...g.wins, { time: at, duration: REAL_DURATION }].sort((a, b) => a.time - b.time) }
          : g,
      ),
    }));
    const game = state.games.find((g) => g.id === id);
    if (game) showToast(`${game.name}: barra registrada. Vence ${formatDate(at + REAL_DURATION)}.`);
  }

  function toggleSound() {
    const next = !state.soundEnabled;
    if (next) enableSound();
    setState((s) => ({ ...s, soundEnabled: next }));
    showToast(next ? "Sonido activado." : "Sonido desactivado.");
  }

  function removeLastWin(id: string) {
    const game = state.games.find((g) => g.id === id);
    if (!game || !game.wins.length) return;
    setMenuOpen(null);
    setState((s) => ({
      ...s,
      games: s.games.map((g) => {
        if (g.id !== id || !g.wins.length) return g;
        let last = 0;
        g.wins.forEach((w, i) => {
          if (w.time >= g.wins[last].time) last = i;
        });
        return { ...g, wins: g.wins.filter((_, i) => i !== last) };
      }),
    }));
    showToast(`${game.name}: se quitó la última barra.`);
  }

  function resetGame(id: string) {
    const game = state.games.find((g) => g.id === id);
    if (!game) return;
    setMenuOpen(null);
    const prev = state;
    setState((s) => ({ ...s, games: s.games.map((g) => (g.id === id ? { ...g, wins: [] } : g)) }));
    showToast(`${game.name} se reinició.`, prev);
  }

  function resetAll() {
    const prev = state;
    notifiedRef.current = new Set();
    alertedRoundRef.current = null;
    setState(createInitialState());
    showToast("Se reinició todo.", prev);
  }

  function applyUndo(prev: S12State) {
    notifiedRef.current = new Set();
    alertedRoundRef.current = null;
    setState(prev);
    setToast({ msg: "" });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `12h-roller-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Datos exportados.");
  }

  function importJson(file: File) {
    file
      .text()
      .then((txt) => {
        const parsed = normalizeState(JSON.parse(txt));
        if (!parsed) throw new Error("formato inválido");
        notifiedRef.current = new Set();
        alertedRoundRef.current = null;
        setState(parsed);
        showToast("Datos importados correctamente.");
      })
      .catch(() => showToast("No se pudo importar ese archivo."));
  }

  function openRound() {
    setRoundTime(toInputValue());
    setRoundPicks(new Set());
    roundRef.current?.showModal();
  }

  function submitRound(e: React.FormEvent) {
    e.preventDefault();
    const at = new Date(roundTime).getTime();
    if (!roundPicks.size || Number.isNaN(at)) {
      showToast("Selecciona al menos un juego y una hora válida.");
      return;
    }
    enableSound();
    setState((s) => ({
      ...s,
      games: s.games.map((g) =>
        roundPicks.has(g.id)
          ? { ...g, wins: [...g.wins, { time: at, duration: REAL_DURATION }].sort((a, b) => a.time - b.time) }
          : g,
      ),
    }));
    roundRef.current?.close();
    showToast(`Ronda registrada en ${roundPicks.size} juego${roundPicks.size === 1 ? "" : "s"}.`);
  }

  const round = currentRound(state, now);

  return (
    <div className="s12">
      <div className="s12-topbar panel">
        <div className="s12-brand">
          <h2>Estrategia 12h</h2>
          <span className="s12-tag">RollerCoin · barras de dificultad de los minijuegos</span>
        </div>
        <div className="s12-next">
          <span className="k">{round?.active ? "Ronda en curso" : "Siguiente ronda"}</span>
          <b>{round ? formatRoundLabel(round) : "—"}</b>
        </div>
        <div className="s12-actions">
          <button
            className="tiny"
            onClick={toggleSound}
            title={state.soundEnabled ? "Desactivar sonido" : "Activar sonido"}
          >
            {state.soundEnabled ? "🔊" : "🔇"}
          </button>
          <button className="tiny" onClick={exportJson}>
            exportar
          </button>
          <label className="tiny s12-import">
            importar
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importJson(f);
              }}
            />
          </label>
          <button className="tiny" onClick={openRound}>
            registro
          </button>
          <button className="tiny" onClick={resetAll}>
            reiniciar
          </button>
        </div>
      </div>

      <div className="s12-games">
        {state.games.map((game) => {
          const wins = activeWins(game, now);
          const { isMaxed } = statusFor(wins.length);
          const rows = buildRows(wins, now);
          const earliest = wins[0];
          const remaining = earliest ? expiryOf(earliest) - now : null;
          const due = remaining !== null && remaining < LOW_MS;
          return (
            <article
              key={game.id}
              className={`s12-card${due ? " is-due" : ""}${isMaxed ? " is-maxed" : ""}`}
            >
              <div className="s12-card-top">
                <span className="s12-icon" aria-hidden="true">
                  {game.icon}
                </span>
                <h3 className="s12-name" title={game.name}>
                  {game.name}
                </h3>
                <div className="s12-menu-wrap">
                  <button
                    className="s12-more"
                    aria-label="Opciones del juego"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen((cur) => (cur === game.id ? null : game.id));
                    }}
                  >
                    ⋮
                  </button>
                  {menuOpen === game.id && (
                    <div className="s12-menu">
                      {game.wins.length > 0 && (
                        <button onClick={() => removeLastWin(game.id)}>Quitar última barra</button>
                      )}
                      <button className="s12-danger" onClick={() => resetGame(game.id)}>
                        Reiniciar juego
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="s12-meter-heading">
                <span className="s12-diff">Dificultad</span>
                <span className="s12-lvl">Nivel</span>
              </div>
              <div className="s12-rows">
                {rows.map((row, ri) => (
                  <div className="s12-row" key={ri}>
                    <span className="s12-row-label">
                      {Array.from({ length: row.ticks }).map((_, ti) => (
                        <i className="s12-tick" key={ti} />
                      ))}
                    </span>
                    <div className="s12-row-bars">
                      {row.cells.map((cell, ci) => (
                        <div
                          className={`s12-slot${cell.kind === "empty" ? " is-empty" : ""}${
                            cell.low ? " is-low" : ""
                          }`}
                          key={ci}
                        >
                          <div className="s12-fill" style={{ width: `${cell.pct}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="s12-card-footer">
                <span
                  className="s12-countdown"
                  title={earliest ? `Vence ${formatDate(expiryOf(earliest))}` : ""}
                >
                  {earliest ? formatRemaining(remaining as number) : ""}
                </span>
                <button
                  className="primary tiny s12-win"
                  onClick={() => recordWin(game.id)}
                  disabled={isMaxed}
                  title={isMaxed ? "Tope de la estrategia: dificultad 3 · nivel 1" : ""}
                >
                  Gané
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <details className="s12-guide panel">
        <summary>¿Cómo funciona la estrategia de las 12 horas?</summary>
        <div className="s12-guide-body">
          {GUIDE.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </details>

      <dialog ref={roundRef} className="s12-dialog">
        <form onSubmit={submitRound}>
          <div className="s12-dialog-head">
            <div>
              <p className="s12-eyebrow">REGISTRO RÁPIDO</p>
              <h3>Registrar una ronda</h3>
            </div>
            <button
              type="button"
              className="s12-x"
              aria-label="Cerrar"
              onClick={() => roundRef.current?.close()}
            >
              ×
            </button>
          </div>
          <p className="muted">
            Selecciona los juegos que ganaste. Se guardará una barra para cada uno a la misma hora.
          </p>
          <label className="s12-field">
            Hora de las victorias
            <input
              type="datetime-local"
              required
              value={roundTime}
              onChange={(e) => setRoundTime(e.target.value)}
            />
          </label>
          <div className="s12-checklist">
            {state.games.map((g) => (
              <label key={g.id}>
                <input
                  type="checkbox"
                  checked={roundPicks.has(g.id)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRoundPicks((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(g.id);
                      else next.delete(g.id);
                      return next;
                    });
                  }}
                />{" "}
                {g.icon} {g.name}
              </label>
            ))}
          </div>
          <div className="s12-dialog-foot">
            <button type="button" className="tiny" onClick={() => roundRef.current?.close()}>
              Cancelar
            </button>
            <button type="submit" className="primary tiny">
              Registrar seleccionados
            </button>
          </div>
        </form>
      </dialog>

      {toast.msg && (
        <div className="s12-toast">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button type="button" className="s12-toast-undo" onClick={() => applyUndo(toast.undo as S12State)}>
              Deshacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
