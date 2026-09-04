import RoomRacks from "./RoomRacks";

export default function RoomPanel() {
  return (
    <div className="panel panel-room">
      <div className="row between">
        <h2>En sala</h2>
      </div>
      <RoomRacks />
    </div>
  );
}
