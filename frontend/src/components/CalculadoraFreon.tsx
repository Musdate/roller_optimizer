import { useEffect, useMemo, useState } from "react";
import { totalsFor } from "../calc";
import { formatPower, groupDigits, parsePower, bpToPct } from "../power";
import { useStore, selectRoomList } from "../store";
import {
  DEFAULT_LEVELS,
  LEVEL_LABELS,
  MAX_HAMSTERS,
  MODULES,
  computeFreon,
  type Levels,
  type Lvl,
  type ModKey,
} from "../freon";
import "../freon.css";

const UNITS = ["GH", "TH", "PH", "EH", "ZH"] as const;
type Unit = (typeof UNITS)[number];

const STORE_KEY = "roller-freon";

const BRANCHES = [
  { branch: "ham" as const, title: "Hámsters" },
  { branch: "freon" as const, title: "Freon" },
];

interface Saved {
  powerNum: string;
  powerUnit: Unit;
  finalNum: string;
  finalUnit: Unit;
  freon: string;
  stats: string[];
  levels: Levels;
}

const EMPTY: Saved = {
  powerNum: "",
  powerUnit: "PH",
  finalNum: "",
  finalUnit: "PH",
  freon: "",
  stats: ["", "", ""],
  levels: DEFAULT_LEVELS,
};

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Saved>;
    return {
      ...EMPTY,
      ...p,
      stats: Array.from({ length: MAX_HAMSTERS }, (_, i) => p.stats?.[i] ?? ""),
      levels: { ...DEFAULT_LEVELS, ...(p.levels ?? {}) },
    };
  } catch {
    return EMPTY;
  }
}

/** BigInt en GH/s -> par (número, unidad) para los inputs. 6 decimales para
 *  que importar de la sala no pierda precisión visible. */
function splitPower(v: bigint): { num: string; unit: Unit } {
  const [num, sym] = formatPower(v, 6).split(" ");
  return { num: String(Number(num)), unit: sym.replace("/s", "") as Unit };
}

function parseOrZero(num: string, unit: Unit): bigint {
  if (!num.trim()) return 0n;
  try {
    const v = parsePower(`${num} ${unit}`);
    return v > 0n ? v : 0n;
  } catch {
    return 0n;
  }
}

export default function CalculadoraFreon() {
  const [state, setState] = useState<Saved>(load);
  const [copied, setCopied] = useState(false);
  const { powerNum, powerUnit, finalNum, finalUnit, freon, stats, levels } = state;

  const roomList = useStore(selectRoomList);
  const roomTotals = useMemo(
    () => totalsFor(roomList.map((it) => ({ item: it, count: it.inRoom ?? 0 }))),
    [roomList],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // localStorage no disponible: no se recuerdan los valores, nada más.
    }
  }, [state]);

  const setLevel = (key: ModKey, lvl: Lvl) =>
    setState((s) => ({ ...s, levels: { ...s.levels, [key]: lvl } }));
  const setStat = (i: number, v: string) =>
    setState((s) => ({ ...s, stats: s.stats.map((x, j) => (j === i ? v : x)) }));

  function importRoom() {
    const p = splitPower(roomTotals.rawPower);
    const f = splitPower(roomTotals.finalPower);
    setState((s) => ({
      ...s,
      powerNum: p.num,
      powerUnit: p.unit,
      finalNum: f.num,
      finalUnit: f.unit,
    }));
  }

  const raw = useMemo(() => parseOrZero(powerNum, powerUnit), [powerNum, powerUnit]);
  const typedFinal = useMemo(
    () => parseOrZero(finalNum, finalUnit),
    [finalNum, finalUnit],
  );
  // Sin poder final se asume que no hay bonus de sala: el final es el bruto.
  const roomFinal = typedFinal >= raw ? typedFinal : raw;

  const r = useMemo(
    () => computeFreon(levels, stats.map((s) => Number(s) || 0), Number(freon) || 0),
    [levels, stats, freon],
  );

  // El bonus del juego es aditivo (§3), así que el freon se suma sobre el
  // poder bruto y el bonus de sala ya viene metido en `roomFinal`.
  const addOn = (bp: number) => (raw * BigInt(bp)) / 10000n;
  const peak = roomFinal + addOn(r.peakBonusBp);
  const effective = roomFinal + addOn(r.effBonusBp);
  const gain = effective - roomFinal;
  const effText = formatPower(effective);

  async function copyEff() {
    // navigator.clipboard falla si la pestaña no tiene foco o el navegador
    // niega el permiso; execCommand sigue andando en ese caso.
    let ok = false;
    try {
      await navigator.clipboard.writeText(effText);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = effText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="frn">
      <h1>Calculadora Freon</h1>

      <div className="frn-top">
        <div className="frn-scene" aria-hidden="true">
          <img className="frn-machine" src="/freon/machine.png" alt="" />
          <div className="frn-badge">
            <b>{r.tier.label}</b>
            <span>límite {groupDigits(String(r.freonLimit))} Freon</span>
          </div>
        </div>

        <div className="panel">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Tu sala</h2>
            <button
              className="tiny"
              onClick={importRoom}
              disabled={roomList.length === 0}
              title={
                roomList.length === 0
                  ? "No tienes mineros puestos en la sala"
                  : "Copia el poder bruto y final de la sala"
              }
            >
              importar de sala
            </button>
          </div>

          <div className="frn-fields">
            <div className="frn-powers">
              <label className="stat frn-field">
                <span className="k">Poder bruto de mineros</span>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={powerNum}
                    onChange={(e) => setState((s) => ({ ...s, powerNum: e.target.value }))}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <select
                    value={powerUnit}
                    onChange={(e) =>
                      setState((s) => ({ ...s, powerUnit: e.target.value as Unit }))
                    }
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}/s
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="stat frn-field">
                <span className="k">Poder final total</span>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={finalNum}
                    onChange={(e) => setState((s) => ({ ...s, finalNum: e.target.value }))}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <select
                    value={finalUnit}
                    onChange={(e) =>
                      setState((s) => ({ ...s, finalUnit: e.target.value as Unit }))
                    }
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}/s
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <label className="stat frn-field">
              <span className="k">Freon cargado</span>
              <input
                type="number"
                min={0}
                step={100}
                value={freon}
                onChange={(e) => setState((s) => ({ ...s, freon: e.target.value }))}
              />
            </label>

            <div className="stat">
              <span className="k">Stats de los hámsters ({r.slots} en sala)</span>
              <div className="frn-hams">
                {stats.map((v, i) => (
                  <input
                    key={i}
                    type="number"
                    min={0}
                    step={1}
                    placeholder={i < r.slots ? `#${i + 1}` : "—"}
                    value={v}
                    disabled={i >= r.slots}
                    onChange={(e) => setStat(i, e.target.value)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="frn-result">
            <div className="frn-hero">
              <span className="k">Poder equivalente constante</span>
              <span className="v">{effText}</span>
              <button className="tiny frn-copy" onClick={copyEff}>
                {copied ? "copiado" : "copiar"}
              </button>
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="k">Ganancia real</span>
                <span className="v frn-gain">+{formatPower(gain)}</span>
              </div>
              <div className="stat">
                <span className="k">Pico (turno activo)</span>
                <span className="v">{formatPower(peak)}</span>
              </div>
              <div className="stat">
                <span className="k">Bonus efectivo</span>
                <span className="v">{bpToPct(r.effBonusBp)}</span>
              </div>
            </div>
          </div>

          <p className="muted frn-note">
            Hámsters {bpToPct(r.hamBonusBp)} durante {r.dutyTimeH} h + 24 h de
            descanso = {(r.dutyRatio * 100).toFixed(0)}% del ciclo →{" "}
            {bpToPct(r.hamBonusEffBp)}. Freon {bpToPct(r.freonBonusBp)} continuo.
            El poder equivalente es un hashrate, no una cantidad: mantenido fijo
            mina lo mismo que tu ciclo real. Pégalo en la calculadora de profit y
            ella te da el día y el mes.
          </p>

          {r.freonCapped && (
            <div className="warn-box" style={{ marginTop: 10 }}>
              La máquina solo almacena {groupDigits(String(r.freonLimit))} Freon: lo que
              cargues de más se pierde.
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Módulos</h2>
        <div className="frn-modules">
          {BRANCHES.map((b) => (
            <section className="frn-branch" key={b.branch}>
              <h3>{b.title}</h3>
              {MODULES.filter((m) => m.branch === b.branch).map((m) => (
                <div className="frn-mod" key={m.key}>
                  <div className="frn-mod-name">
                    <b>{m.name}</b>
                    <span>{m.desc}</span>
                  </div>
                  <select
                    value={levels[m.key]}
                    onChange={(e) => setLevel(m.key, Number(e.target.value) as Lvl)}
                  >
                    {LEVEL_LABELS.map((lab, i) => (
                      <option key={lab} value={i}>
                        {lab}
                      </option>
                    ))}
                  </select>
                  <span className="frn-mod-val">{m.values[levels[m.key]]}</span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="frn-foot">
          <div className="stat">
            <span className="k">Mejoras</span>
            <span className="v">{r.upgrades} / 18</span>
          </div>
          <div className="stat">
            <span className="k">RLT invertido</span>
            <span className="v">{r.rltSpent}</span>
          </div>
          <div className="stat">
            <span className="k">Ciclo</span>
            <span className="v">
              {r.dutyTimeH} h + 24 h
            </span>
          </div>
          <div className="stat">
            <span className="k">
              Freon tras {r.dutyTimeH} h (−{r.leakPct}% cada {r.leakTimeH} h)
            </span>
            <span className="v">{groupDigits(String(r.freonAfterDuty))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
