import { useStore, selectInventoryList } from "../store";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { inventoryTotals } from "../calc";
import MinerSprite from "./MinerSprite";
import LevelBadge from "./LevelBadge";

export default function InventoryTable() {
  const list = useStore(selectInventoryList);
  const setQuantity = useStore((s) => s.setQuantity);
  const remove = useStore((s) => s.remove);
  const clear = useStore((s) => s.clearInventory);

  const totals = inventoryTotals(list);

  function exportJson() {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventario-roller.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    file.text().then((txt) => {
      try {
        const items = JSON.parse(txt);
        const add = useStore.getState().addCustom;
        for (const it of items) {
          add({
            id: String(it.id),
            name: String(it.name ?? ""),
            level: Number(it.level ?? 0),
            power: String(it.power),
            bonus_bp: Number(it.bonus_bp ?? 0),
            width: Number(it.width ?? 1),
            quantity: Number(it.quantity ?? 1),
          });
        }
      } catch (e) {
        alert("JSON inválido: " + e);
      }
    });
  }

  return (
    <div className="panel">
      <div className="row between">
        <h2>Mi inventario ({list.length} modelos)</h2>
        <div className="row">
          <button className="tiny" onClick={exportJson} disabled={!list.length}>
            exportar
          </button>
          <label className="tiny" style={{ cursor: "pointer" }}>
            importar
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </label>
          <button className="tiny" onClick={clear} disabled={!list.length}>
            vaciar
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          Añade mineros desde el catálogo →
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Minero</th>
                <th className="num">Poder</th>
                <th className="num">Bonus</th>
                <th className="num">Cant.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <MinerSprite url={it.image ?? ""} width={it.width} size={28} />
                      <span>
                        {it.name || <span className="muted">custom</span>}{" "}
                        {it.level > 0 && <LevelBadge level={it.level} />}
                        {it.width > 1 && <span className="pill" style={{ marginLeft: 4 }}>2c</span>}
                      </span>
                    </div>
                  </td>
                  <td className="num" title={formatExactGh(BigInt(it.power))}>
                    {formatPower(BigInt(it.power))}
                  </td>
                  <td className="num">+{bpToPct(it.bonus_bp)}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      value={it.quantity}
                      style={{ width: 60 }}
                      onChange={(e) => setQuantity(it.id, Number(e.target.value))}
                    />
                  </td>
                  <td className="num">
                    <button className="tiny" onClick={() => remove(it.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.length > 0 && (
        <div className="stat-row" style={{ marginTop: 10 }}>
          <div className="stat">
            <span className="k">Poder bruto total</span>
            <span className="v">{formatPower(totals.rawPower)}</span>
          </div>
          <div className="stat">
            <span className="k">Bonus total</span>
            <span className="v">+{bpToPct(totals.bonusBp)}</span>
          </div>
          <div className="stat">
            <span className="k">Poder final (todo)</span>
            <span className="v">{formatPower(totals.finalPower)}</span>
          </div>
          <div className="stat">
            <span className="k">Mineros / celdas</span>
            <span className="v">
              {totals.miners} / {totals.cells}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
