from datetime import datetime, timezone
from typing import Dict, Set
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException

app = FastAPI(title="Seychelles Live Bus API", version="0.1.0")

# Prototype in-memory state only. Use a persistent database and authenticated
# driver sessions before any public deployment.
vehicles: Dict[str, dict] = {}
passenger_sockets: Set[WebSocket] = set()

@app.get("/health")
async def health():
    return {"status": "ok", "service": "seychelles-live-bus"}

@app.get("/api/vehicles")
async def get_vehicles():
    return {"vehicles": list(vehicles.values()), "source": "independent-driver-gps",
            "note": "Only participating vehicles that have shared GPS appear here."}

async def broadcast(message: dict):
    stale = []
    for socket in passenger_sockets:
        try:
            await socket.send_text(json.dumps(message))
        except Exception:
            stale.append(socket)
    for socket in stale:
        passenger_sockets.discard(socket)

@app.websocket("/ws/passengers")
async def passenger_stream(ws: WebSocket):
    await ws.accept()
    passenger_sockets.add(ws)
    try:
        await ws.send_text(json.dumps({
            "type": "snapshot",
            "vehicles": list(vehicles.values()),
            "source": "independent-driver-gps"
        }))
        while True:
            # Keep the connection open; client may send harmless ping messages.
            await ws.receive_text()
    except WebSocketDisconnect:
        passenger_sockets.discard(ws)

@app.websocket("/ws/driver/{vehicle_id}")
async def driver_stream(ws: WebSocket, vehicle_id: str):
    # DEMO ONLY: this endpoint is unauthenticated. Do not expose publicly until
    # driver identity, vehicle assignment, TLS and shift-based access are added.
    await ws.accept()
    try:
        while True:
            payload = await ws.receive_json()
            lat = float(payload["lat"])
            lon = float(payload["lon"])
            if not (-5.0 <= lat <= -3.0 and 54.0 <= lon <= 56.0):
                await ws.send_json({"type": "error", "message": "Coordinates outside Seychelles bounds"})
                continue
            vehicle = {
                "id": vehicle_id,
                "lat": lat,
                "lon": lon,
                "route": str(payload.get("route", "Unassigned")),
                "heading": payload.get("heading"),
                "speed": payload.get("speed"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "source": "independent-driver-gps"
            }
            vehicles[vehicle_id] = vehicle
            await broadcast({"type": "vehicle_update", "vehicle": vehicle})
            await ws.send_json({"type": "accepted", "updated_at": vehicle["updated_at"]})
    except WebSocketDisconnect:
        # Keep last known position, but passenger UI should age it out as stale.
        pass

@app.delete("/api/vehicles/{vehicle_id}")
async def remove_vehicle(vehicle_id: str):
    # Prototype admin route; secure this before deployment.
    if vehicle_id not in vehicles:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    del vehicles[vehicle_id]
    await broadcast({"type": "vehicle_removed", "id": vehicle_id})
    return {"ok": True}
