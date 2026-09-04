import { useState } from "react";
import { parseInventoryText, errMsg } from "../api";
import type { ParsedItem } from "../api";
import { useStore } from "../store";
import { bpToPct, formatPower } from "../power";
import MinerSprite from "./MinerSprite";

export default function PasteInventory({ onDone }: { onDone?: () => void }) {
  const merge = useStore((s) => s.mergeParsedInventory);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ items: ParsedItem[]; skipped: string[] } | null>(null);

  async function analyze() {
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const res = await parseInventoryText(text);
      setPreview(res);
      if (res.items.length === 0) setErr("No se reconoció ningún minero en ese texto.");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function apply(replace: boolean) {
    if (!preview) return;
    merge(preview.items as unknown as Array<Record<string, unknown>>, replace);
    setText("");
    setPreview(null);
    onDone?.();
  }

  const matched = preview?.items.filter((i) => i.matched).length ?? 0;
  const unmatched = (preview?.items.length ?? 0) - matched;
  const totalMiners = preview?.items.reduce((a, i) => a + i.quantity, 0) ?? 0;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h2>Pegar inventario de RollerCoin</h2>
        {onDone && (
          <button className="tiny" onClick={onDone}>
            cerrar
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        Copia el listado de mineros desde tu inventario en rollercoin.com y pégalo aquí.
        Se casan por nombre y potencia contra el catálogo (el nº de nivel que muestra la
        web no importa).
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"3\nBinglong Wyrm\nSize:\n2 Cells\nPower\n40.000 Ph/s\nBonus\n22 %\nQuantity:\n1\nMiner details\n…"}
        rows={6}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12, resize: "vertical" }}
      />

      <div className="row" style={{ marginTop: 8 }}>
        <button className="tiny" onClick={analyze} disabled={busy || text.trim().length < 5}>
          {busy ? "analizando…" : "analizar"}
        </button>
        {preview && (
          <span className="muted" style={{ fontSize: 12 }}>
            {preview.items.length} modelos · {totalMiners} mineros
            {unmatched > 0 && ` · ${unmatched} sin catálogo`}
          </span>
        )}
      </div>

      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}

      {preview && preview.items.length > 0 && (
        <>
          <div className="scroll" style={{ marginTop: 10, maxHeight: 260 }}>
            <table>
              <thead>
                <tr>
                  <th>Minero</th>
                  <th className="num">Poder</th>
                  <th className="num">Bonus</th>
                  <th className="num">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <MinerSprite url={it.image} width={it.width} size={24} level={it.level} />
                        <span className="name-row">
                          {it.name}
                          {!it.matched && <span className="tag buy">sin catálogo</span>}
                        </span>
                      </div>
                    </td>
                    <td className="num">{formatPower(BigInt(it.power))}</td>
                    <td className="num">+{bpToPct(it.bonus_bp)}</td>
                    <td className="num">{it.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.skipped.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              No se pudo leer: {preview.skipped.join(", ")}
            </div>
          )}

          <div className="row" style={{ marginTop: 10 }}>
            <button className="tiny primary" onClick={() => apply(true)}>
              reemplazar inventario
            </button>
            <button className="tiny" onClick={() => apply(false)}>
              sumar a lo que tengo
            </button>
          </div>
        </>
      )}
    </div>
  );
}
