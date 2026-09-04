import {
  useStore,
  selectInventoryList,
  selectBenchList,
  sortInventory,
  INV_SORTS,
} from "../store";
import type { InvSort } from "../store";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { inventoryTotals } from "../calc";
import MinerSprite from "./MinerSprite";
import LevelBadge from "./LevelBadge";

export default function InventoryTable() {
  const fullList = useStore(selectInventoryList);
  const benchRaw = useStore(selectBenchList);
  const invSort = useStore((s) => s.invSort);
  const setInvSort = useStore((s) => s.setInvSort);
  const setQuantity = useStore((s) => s.setQuantity);
  const setInRoom = useStore((s) => s.setInRoom);
  const remove = useStore((s) => s.remove);
  const clear = useStore((s) => s.clearInventory);

  const list = sortInventory(benchRaw, invSort);
  const totals = inventoryTotals(fullList);

  return (
    <div className="panel">
      <div className="row between">
        <h2>Mi inventario</h2>
        <div className="row">
          <select
            className="tiny"
            value={invSort}
            onChange={(e) => setInvSort(e.target.value as InvSort)}
            title="Ordenar por"
          >
            {INV_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="tiny" onClick={clear} disabled={!fullList.length}>
            vaciar
          </button>
        </div>
      </div>

      {fullList.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          Añade mineros desde el catálogo →
        </div>
      ) : list.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          Todos tus mineros están en la sala.
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Minero</th>
                <th className="num">Poder</th>
                <th className="num">Bonus</th>
                <th className="num">Tengo</th>
                <th className="num">En sala</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <MinerSprite
                        url={it.image ?? ""}
                        width={it.width}
                        size={28}
                        title={`${it.width} celda${it.width > 1 ? "s" : ""}`}
                      />
                      <span className="name-row">
                        <LevelBadge level={it.level} />
                        {it.name || <span className="muted">custom</span>}
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
                      style={{ width: 56 }}
                      onChange={(e) => setQuantity(it.id, Number(e.target.value))}
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={it.quantity}
                      value={it.inRoom ?? 0}
                      style={{ width: 56 }}
                      onChange={(e) => setInRoom(it.id, Number(e.target.value))}
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

      {fullList.length > 0 && (
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
