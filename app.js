const base = window.BUS_API_BASE.replace(/\/$/, "");
const map = L.map("map").setView([-4.65, 55.45], 10);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const busMarkers = new Map();
let userMarker = null, driverWatch = null, driverSocket = null;
let passengerSocket = null;
const $ = id => document.getElementById(id);

const islands = {
  mahe: { center: [-4.65,55.45], zoom: 10 },
  praslin: { center: [-4.32,55.73], zoom: 12 },
  ladigue: { center: [-4.36,55.83], zoom: 14 }
};
$("island").addEventListener("change", e => {
  const v = islands[e.target.value]; map.setView(v.center, v.zoom);
});

function setConnection(online) {
  $("connection").textContent = online ? "Live connection" : "Offline";
  $("connection").className = "pill " + (online ? "online" : "offline");
}
function busIcon() {
  return L.divIcon({ className:"", html:'<div class="bus-marker">🚌</div>', iconSize:[28,28], iconAnchor:[14,14] });
}
function updateVehicle(v) {
  if (!v || !Number.isFinite(Number(v.lat)) || !Number.isFinite(Number(v.lon))) return;
  const pos = [Number(v.lat), Number(v.lon)];
  const popup = `<b>${escapeHtml(v.id)}</b><br>${escapeHtml(v.route || "Route not supplied")}<br><small>GPS: ${escapeHtml(v.updated_at || "time unavailable")}</small>`;
  if (busMarkers.has(v.id)) {
    busMarkers.get(v.id).setLatLng(pos).setPopupContent(popup);
  } else {
    busMarkers.set(v.id, L.marker(pos, {icon:busIcon()}).addTo(map).bindPopup(popup));
  }
  renderVehicleList();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderVehicleList() {
  $("busCount").textContent = `${busMarkers.size} live ${busMarkers.size === 1 ? "bus" : "buses"}`;
  $("emptyState").classList.toggle("hidden", busMarkers.size > 0);
  $("vehicleList").innerHTML = "";
  for (const [id, marker] of busMarkers) {
    const d = document.createElement("div"); d.className = "vehicle-row";
    d.innerHTML = `<strong>${escapeHtml(id)}</strong><span>GPS position received</span>`;
    d.addEventListener("click", () => { map.setView(marker.getLatLng(), 15); marker.openPopup(); });
    $("vehicleList").appendChild(d);
  }
}
function connectPassenger() {
  const wsUrl = base.replace(/^http/, "ws") + "/ws/passengers";
  passengerSocket = new WebSocket(wsUrl);
  passengerSocket.onopen = () => setConnection(true);
  passengerSocket.onclose = () => { setConnection(false); setTimeout(connectPassenger, 4000); };
  passengerSocket.onerror = () => setConnection(false);
  passengerSocket.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "snapshot") (msg.vehicles || []).forEach(updateVehicle);
    if (msg.type === "vehicle_update") updateVehicle(msg.vehicle);
    if (msg.type === "vehicle_removed" && busMarkers.has(msg.id)) {
      map.removeLayer(busMarkers.get(msg.id)); busMarkers.delete(msg.id); renderVehicleList();
    }
    $("lastUpdated").textContent = "Last GPS update: " + new Date().toLocaleTimeString();
  };
}
connectPassenger();

$("locateBtn").onclick = () => {
  if (!navigator.geolocation) return alert("GPS location is not supported by this browser.");
  navigator.geolocation.getCurrentPosition(p => {
    const pos = [p.coords.latitude, p.coords.longitude];
    if (!userMarker) userMarker = L.marker(pos, {icon:L.divIcon({className:"",html:'<div class="user-marker"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map).bindPopup("Your location");
    else userMarker.setLatLng(pos);
    map.setView(pos, 16); userMarker.openPopup();
  }, e => alert("Could not get your location: " + e.message), {enableHighAccuracy:true, timeout:15000});
};

$("driverToggle").onclick = () => $("driverPanel").classList.toggle("hidden");
$("startDriver").onclick = () => {
  const id = $("vehicleId").value.trim(), route = $("routeId").value.trim();
  if (!id) return alert("Enter the assigned vehicle ID.");
  if (!navigator.geolocation) return alert("GPS is unavailable on this device.");
  if (!window.isSecureContext && location.hostname !== "localhost") return alert("Driver GPS requires HTTPS.");
  driverSocket = new WebSocket(base.replace(/^http/, "ws") + "/ws/driver/" + encodeURIComponent(id));
  driverSocket.onopen = () => {
    $("driverStatus").textContent = "Connected. Waiting for GPS fix…";
    driverWatch = navigator.geolocation.watchPosition(p => {
      if (!driverSocket || driverSocket.readyState !== WebSocket.OPEN) return;
      driverSocket.send(JSON.stringify({
        lat:p.coords.latitude, lon:p.coords.longitude, route,
        heading:p.coords.heading, speed:p.coords.speed
      }));
      $("driverStatus").textContent = "Sharing GPS for active shift. Last sent: " + new Date().toLocaleTimeString();
    }, e => $("driverStatus").textContent = "GPS error: " + e.message,
    {enableHighAccuracy:true, maximumAge:5000, timeout:15000});
  };
  driverSocket.onerror = () => $("driverStatus").textContent = "Could not connect to tracking server.";
};
$("stopDriver").onclick = stopDriver;
function stopDriver() {
  if (driverWatch !== null) navigator.geolocation.clearWatch(driverWatch);
  driverWatch = null;
  if (driverSocket) driverSocket.close();
  driverSocket = null;
  $("driverStatus").textContent = "GPS sharing is off.";
}
window.addEventListener("beforeunload", stopDriver);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
