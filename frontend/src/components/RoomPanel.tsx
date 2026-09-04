import { useStore, selectRoomList, sortInventory, roomsToCells, INV_SORTS } from "../store";
import type { InvSort } from "../store";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { totalsFor } from "../calc";
import MinerSprite from "./MinerSprite";
import LevelBadge from "./LevelBadge";

export default function RoomPanel() {
  const rawList = useStore(selectRoomList);
  const invSort = useStore((s) => s.invSort);
  const setInvSort = useStore((s) => s.setInvSort);
  const rooms = useStore((s) => s.rooms);
  const setInRoom = useStore((s) => s.setInRoom);

  const list = sortInventory(rawList, invSort);
  const totals = totalsFor(list.map((it) => ({ item: it, count: it.inRoom ?? 0 })));
  const capacity = roomsToCells(rooms);
  const over = totals.cells > capacity;

  return (
    <div className="panel">
      <div className="row between">
        <h2>En sala</h2>
        <div className="row">
          {list.length > 0 && (
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
          )}
          <span className={`pill ${over ? "status-infeasible" : ""}`}>
            {totals.cells} / {capacity} celdas
          </span>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          Indica cuántos mineros tienes puestos en la sala desde “Mi inventario” ↓
        </div>
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Minero</th>
                  <th className="num">En sala</th>
                  <th className="num">Poder total</th>
                  <th className="num">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => {
                  const n = it.inRoom ?? 0;
                  return (
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
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          max={it.quantity}
                          value={n}
                          style={{ width: 56 }}
                          onChange={(e) => setInRoom(it.id, Number(e.target.value))}
                        />
                        <span className="muted" style={{ fontSize: 11 }}> / {it.quantity}</span>
                      </td>
                      <td className="num" title={formatExactGh(BigInt(it.power) * BigInt(n))}>
                        {formatPower(BigInt(it.power) * BigInt(n))}
                      </td>
                      <td className="num">+{bpToPct(it.bonus_bp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="stat-row" style={{ marginTop: 10 }}>
            <div className="stat">
              <span className="k">Poder bruto</span>
              <span className="v">{formatPower(totals.rawPower)}</span>
            </div>
            <div className="stat">
              <span className="k">Bonus</span>
              <span className="v">+{bpToPct(totals.bonusBp)}</span>
            </div>
            <div className="stat">
              <span className="k">Poder final</span>
              <span className="v">{formatPower(totals.finalPower)}</span>
            </div>
            <div className="stat">
              <span className="k">Mineros / celdas</span>
              <span className={`v ${over ? "status-infeasible" : ""}`}>
                {totals.miners} / {totals.cells}
              </span>
            </div>
          </div>

          {over && (
            <div className="err" style={{ marginTop: 6 }}>
              Te pasas de la capacidad ({capacity} celdas) por {totals.cells - capacity}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
