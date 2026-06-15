/* Jardín Botánico FAgro · demo jugable sin GPS
   Cambiar datos de plantas en data/plants.js */

const STORAGE_KEY = "fagro_botanic_game_state_v3";
const ARRIVAL_DISTANCE_METERS = 30;
const DEFAULT_CENTER = [-34.83755, -56.22035];

// Estadísticas anónimas de uso.
// Esta URL es el Web App de Google Apps Script que escribe eventos en Google Sheets.
const ANALYTICS_URL = "https://script.google.com/macros/s/AKfycbxFV7S-TBVS1521Bhurx2p-QU4BNhRl3WQlbzSxtzAliZGD_Yw91z8zXZbVDyNPCY2efQ/exec";
const ANALYTICS_PROJECT = "jardin-botanico-fagro-demo";
const ANALYTICS_ENABLED = true;
const ANALYTICS_SESSION_KEY = "fagro_botanic_analytics_session_v1";
const APP_VERSION = "2026-06-15-analytics-v1";

const state = {
  playerName: "Visitante",
  demoMode: true,
  playerPosition: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
  currentPlantId: null,
  visited: {},
  answered: {},
  score: 0,
  analyticsGameCompleted: false,
  gpsWatchId: null
};

const el = {
  playerNameLabel: document.getElementById("playerNameLabel"),
  editNameBtn: document.getElementById("editNameBtn"),
  visitedCount: document.getElementById("visitedCount"),
  scoreCount: document.getElementById("scoreCount"),
  answeredCount: document.getElementById("answeredCount"),
  progressBar: document.getElementById("progressBar"),
  plantList: document.getElementById("plantList"),
  totalPlantsLabel: document.getElementById("totalPlantsLabel"),
  targetStatus: document.getElementById("targetStatus"),
  missionTitle: document.getElementById("missionTitle"),
  missionText: document.getElementById("missionText"),
  walkToTargetBtn: document.getElementById("walkToTargetBtn"),
  scanTargetBtn: document.getElementById("scanTargetBtn"),
  nextMissionBtn: document.getElementById("nextMissionBtn"),
  resetBtn: document.getElementById("resetBtn"),
  demoModeBtn: document.getElementById("demoModeBtn"),
  gpsBtn: document.getElementById("gpsBtn"),
  plantDetail: document.getElementById("plantDetail"),
  plantTheme: document.getElementById("plantTheme"),
  plantCommonName: document.getElementById("plantCommonName"),
  plantScientificName: document.getElementById("plantScientificName"),
  plantStatusBadge: document.getElementById("plantStatusBadge"),
  lockedBox: document.getElementById("lockedBox"),
  unlockedBox: document.getElementById("unlockedBox"),
  plantImage: document.getElementById("plantImage"),
  plantInfo: document.getElementById("plantInfo"),
  plantClue: document.getElementById("plantClue"),
  quizQuestion: document.getElementById("quizQuestion"),
  quizOptions: document.getElementById("quizOptions"),
  quizFeedback: document.getElementById("quizFeedback"),
  openHelpBtn: document.getElementById("openHelpBtn"),
  closeHelpBtn: document.getElementById("closeHelpBtn"),
  helpDialog: document.getElementById("helpDialog")
};

let map;
let playerMarker;
let targetLine;
let gpsStartedTracked = false;
const plantMarkers = new Map();

function refreshMapLayout() {
  // Leaflet a veces calcula mal el tamaño si el archivo se abre localmente,
  // si el navegador restaura zoom/scroll, o si el panel lateral cambia el layout.
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize({ pan: false });
    setTimeout(() => map.invalidateSize({ pan: false }), 120);
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    Object.assign(state, saved, { gpsWatchId: null });
  } catch (error) {
    console.warn("No se pudo leer el estado guardado", error);
  }
}

function saveState() {
  const toSave = {
    playerName: state.playerName,
    demoMode: state.demoMode,
    playerPosition: state.playerPosition,
    currentPlantId: state.currentPlantId,
    visited: state.visited,
    answered: state.answered,
    score: state.score,
    analyticsGameCompleted: state.analyticsGameCompleted
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

function progressStats() {
  const totalPlants = Array.isArray(window.PLANTS) && window.PLANTS.length ? window.PLANTS.length : 1;
  const visitedCount = Object.keys(state.visited || {}).filter(id => state.visited[id]).length;
  const answeredCount = Object.keys(state.answered || {}).filter(id => state.answered[id]).length;
  return {
    visitedCount,
    answeredCount,
    totalPlants,
    progressPercent: Math.round((visitedCount / totalPlants) * 100)
  };
}

function getAnalyticsSessionId() {
  // Sesión anónima temporal. Se conserva al recargar la pestaña, pero no identifica a una persona.
  try {
    let id = sessionStorage.getItem(ANALYTICS_SESSION_KEY);
    if (!id) {
      const uuid = window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      id = `session_${uuid}`;
      sessionStorage.setItem(ANALYTICS_SESSION_KEY, id);
    }
    return id;
  } catch (error) {
    return `session_${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function analyticsMode() {
  return state.demoMode ? "demo" : "gps";
}

function trackEvent(eventType, extra = {}) {
  if (!ANALYTICS_ENABLED || !ANALYTICS_URL || ANALYTICS_URL.includes("PEGAR")) return;

  const stats = progressStats();
  const payload = {
    project: ANALYTICS_PROJECT,
    app_version: APP_VERSION,
    session_id: getAnalyticsSessionId(),
    event_type: eventType,
    mode: analyticsMode(),
    score: state.score,
    visited_count: stats.visitedCount,
    quiz_count: stats.answeredCount,
    progress_percent: stats.progressPercent,
    page_url: window.location.href,
    ...extra
  };

  // No se envía nombre, correo, GPS ni datos personales.
  const body = JSON.stringify(payload);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      navigator.sendBeacon(ANALYTICS_URL, blob);
    } else {
      fetch(ANALYTICS_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
        keepalive: true
      });
    }
  } catch (error) {
    console.warn("No se pudo registrar estadística", error);
  }
}

function trackPlantEvent(eventType, plant, extra = {}) {
  if (!plant) return;
  trackEvent(eventType, {
    plant_id: plant.id,
    plant_name: plant.commonName,
    ...extra
  });
}

function maybeTrackGameCompleted() {
  const stats = progressStats();
  if (!state.analyticsGameCompleted && stats.answeredCount >= stats.totalPlants) {
    state.analyticsGameCompleted = true;
    trackEvent("game_completed", { progress_percent: 100 });
  }
}

function plantById(id) {
  return window.PLANTS.find(p => p.id === id);
}

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "distancia desconocida";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function initMap() {
  map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(DEFAULT_CENTER, 18);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    crossOrigin: true,
    keepBuffer: 4,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const playerIcon = L.divIcon({
    className: "",
    html: '<div class="player-icon" title="Tu posición"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  playerMarker = L.marker(state.playerPosition, { icon: playerIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindPopup("Tu posición simulada / GPS");

  // Área aproximada del predio central de FAgro. Es solo una guía visual del demo.
  // Cuando carguemos puntos reales, se puede borrar o ajustar.
  const campusApprox = [
    [-34.83615, -56.22145],
    [-34.83620, -56.21875],
    [-34.83895, -56.21885],
    [-34.83905, -56.22155]
  ];
  L.polygon(campusApprox, {
    color: "#2f6b4c",
    weight: 2,
    opacity: 0.55,
    fillOpacity: 0.06
  }).addTo(map).bindPopup("Predio FAgro aproximado para el demo");

  window.PLANTS.forEach(plant => {
    const marker = L.marker([plant.lat, plant.lng], { icon: makePlantIcon(plant), title: plant.commonName })
      .addTo(map)
      .bindPopup(makePopupHtml(plant));
    marker.on("click", () => selectPlant(plant.id, { pan: false }));
    plantMarkers.set(plant.id, marker);
  });

  // Herramienta simple para relevar coordenadas reales:
  // clic en el mapa -> copiar lat/lng y pegarlas en data/plants.js.
  map.on("click", (event) => {
    const lat = event.latlng.lat.toFixed(6);
    const lng = event.latlng.lng.toFixed(6);
    L.popup()
      .setLatLng(event.latlng)
      .setContent(`<strong>Coordenadas del punto</strong><br><code>lat: ${lat},<br>lng: ${lng}</code><br><small>Copialas en <code>data/plants.js</code> para ubicar una planta real.</small>`)
      .openOn(map);
  });

  const bounds = L.latLngBounds(window.PLANTS.map(p => [p.lat, p.lng]));
  bounds.extend(DEFAULT_CENTER);
  map.fitBounds(bounds.pad(0.22));
  refreshMapLayout();
  setTimeout(refreshMapLayout, 300);
  setTimeout(refreshMapLayout, 900);
}

function makePlantIcon(plant) {
  const classes = ["custom-plant-icon"];
  if (state.visited[plant.id]) classes.push("visited");
  if (state.currentPlantId === plant.id) classes.push("current");
  return L.divIcon({
    className: "",
    html: `<div class="${classes.join(" ")}">${plant.icon || "🌿"}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -18]
  });
}

function makePopupHtml(plant) {
  const visited = state.visited[plant.id] ? "Visitada" : "Pendiente";
  return `
    <div class="popup-card">
      <h3>${plant.icon || "🌿"} ${plant.commonName}</h3>
      <p><em>${plant.scientificName}</em><br>${plant.theme} · ${visited}</p>
      <button class="primary-btn" type="button" onclick="window.Game.selectPlantFromPopup('${plant.id}')">Ver misión</button>
    </div>`;
}

function updateMarkers() {
  window.PLANTS.forEach(plant => {
    const marker = plantMarkers.get(plant.id);
    if (!marker) return;
    marker.setIcon(makePlantIcon(plant));
    marker.setPopupContent(makePopupHtml(plant));
  });
}

function renderPlantList() {
  el.totalPlantsLabel.textContent = `${window.PLANTS.length} plantas`;
  el.plantList.innerHTML = "";

  window.PLANTS.forEach(plant => {
    const item = document.createElement("article");
    item.className = "plant-list-item" + (state.currentPlantId === plant.id ? " active" : "");
    const distance = metersBetween(state.playerPosition, { lat: plant.lat, lng: plant.lng });
    const done = state.visited[plant.id] ? "✓" : "○";
    const quiz = state.answered[plant.id] ? " · quiz ✓" : "";

    item.innerHTML = `
      <div class="emoji">${plant.icon || "🌿"}</div>
      <div>
        <strong>${plant.commonName} <span aria-label="estado">${done}</span></strong>
        <small><em>${plant.scientificName}</em><br>${plant.theme} · ${formatDistance(distance)}${quiz}</small>
      </div>
      <div class="plant-list-actions">
        <button class="icon-btn" type="button" title="Ver">👁</button>
        <button class="icon-btn" type="button" title="Caminar en demo">🚶</button>
        <button class="icon-btn" type="button" title="QR demo">▣</button>
      </div>`;

    const [viewBtn, walkBtn, scanBtn] = item.querySelectorAll("button");
    viewBtn.addEventListener("click", () => selectPlant(plant.id));
    walkBtn.addEventListener("click", () => walkToPlant(plant.id));
    scanBtn.addEventListener("click", () => scanPlant(plant.id));
    el.plantList.appendChild(item);
  });
}

function renderHud() {
  const stats = progressStats();

  el.playerNameLabel.textContent = state.playerName || "Visitante";
  el.visitedCount.textContent = stats.visitedCount;
  el.scoreCount.textContent = state.score;
  el.answeredCount.textContent = stats.answeredCount;
  el.progressBar.style.width = `${stats.progressPercent}%`;
}

function renderMission() {
  const plant = plantById(state.currentPlantId);
  if (!plant) {
    el.missionTitle.textContent = "Sin planta seleccionada";
    el.missionText.textContent = "Seleccioná una planta en el mapa o en la lista.";
    el.walkToTargetBtn.disabled = true;
    el.scanTargetBtn.disabled = true;
    el.targetStatus.innerHTML = "<strong>Objetivo:</strong> elegí una planta para empezar.";
    if (targetLine) targetLine.remove();
    return;
  }

  const distance = metersBetween(state.playerPosition, { lat: plant.lat, lng: plant.lng });
  const closeEnough = distance <= ARRIVAL_DISTANCE_METERS;
  const visited = !!state.visited[plant.id];
  const answered = !!state.answered[plant.id];
  const nextAction = visited ? (answered ? "Ya completaste esta estación." : "Ficha desbloqueada: respondé el quiz.") : (closeEnough ? "Estás cerca: escaneá el QR demo." : "Acercate a la planta o usá el botón demo.");

  el.missionTitle.textContent = `${plant.icon || "🌿"} ${plant.commonName}`;
  el.missionText.textContent = `${plant.theme}. Distancia actual: ${formatDistance(distance)}. ${nextAction}`;
  el.walkToTargetBtn.disabled = false;
  el.scanTargetBtn.disabled = false;
  el.targetStatus.innerHTML = `<strong>Objetivo:</strong> ${plant.commonName} · ${formatDistance(distance)} · ${nextAction}`;

  drawTargetLine(plant);
}

function drawTargetLine(plant) {
  if (targetLine) targetLine.remove();
  targetLine = L.polyline(
    [[state.playerPosition.lat, state.playerPosition.lng], [plant.lat, plant.lng]],
    { weight: 4, opacity: 0.72, dashArray: "8 10" }
  ).addTo(map);
}

function renderPlantDetail() {
  const plant = plantById(state.currentPlantId);
  if (!plant) {
    el.plantDetail.hidden = true;
    return;
  }

  const visited = !!state.visited[plant.id];
  const answered = !!state.answered[plant.id];
  el.plantDetail.hidden = false;
  el.plantTheme.textContent = plant.theme;
  el.plantCommonName.textContent = `${plant.icon || "🌿"} ${plant.commonName}`;
  el.plantScientificName.textContent = plant.scientificName;
  el.plantImage.textContent = plant.icon || "🌿";
  el.plantInfo.textContent = plant.info;
  el.plantClue.textContent = plant.clue;

  el.plantStatusBadge.className = "status-badge" + (answered ? " quizdone" : visited ? " done" : "");
  el.plantStatusBadge.textContent = answered ? "Quiz completo" : visited ? "Desbloqueada" : "Pendiente";

  el.lockedBox.hidden = visited;
  el.unlockedBox.hidden = !visited;

  if (visited) renderQuiz(plant);
}

function renderQuiz(plant) {
  el.quizQuestion.textContent = plant.quiz.question;
  el.quizOptions.innerHTML = "";
  el.quizFeedback.textContent = "";
  el.quizFeedback.className = "feedback";

  const previous = state.answered[plant.id];
  plant.quiz.options.forEach((option, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = option;

    if (previous) {
      btn.disabled = true;
      if (index === plant.quiz.answerIndex) btn.classList.add("correct");
      if (index === previous.selectedIndex && !previous.correct) btn.classList.add("wrong");
    } else {
      btn.addEventListener("click", () => answerQuiz(plant.id, index));
    }
    el.quizOptions.appendChild(btn);
  });

  if (previous) {
    el.quizFeedback.textContent = previous.correct ? `+10 puntos. ${plant.quiz.feedback}` : `Respuesta registrada. ${plant.quiz.feedback}`;
    el.quizFeedback.classList.add(previous.correct ? "good" : "bad");
  }
}

function renderAll() {
  renderHud();
  renderMission();
  renderPlantList();
  renderPlantDetail();
  updateMarkers();
  playerMarker.setLatLng(state.playerPosition);
  refreshMapLayout();
  saveState();
}

function selectPlant(id, options = { pan: true, track: true }) {
  const plant = plantById(id);
  if (!plant) return;
  const changed = state.currentPlantId !== id;
  state.currentPlantId = id;
  if (options.pan) map.flyTo([plant.lat, plant.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
  renderAll();
  if (options.track !== false && changed) {
    trackPlantEvent("plant_selected", plant);
  }
}

function walkToPlant(id = state.currentPlantId) {
  const plant = plantById(id);
  if (!plant) return;
  state.demoMode = true;
  state.currentPlantId = plant.id;
  // Pequeño offset para que se vea que estás cerca pero no exactamente encima del marcador.
  state.playerPosition = { lat: plant.lat + 0.000055, lng: plant.lng - 0.000055 };
  map.flyTo([plant.lat, plant.lng], Math.max(map.getZoom(), 19), { duration: 0.9 });
  renderAll();
  trackPlantEvent("plant_reached_demo", plant);
}

function scanPlant(id = state.currentPlantId) {
  const plant = plantById(id);
  if (!plant) return;
  const firstVisit = !state.visited[plant.id];
  state.currentPlantId = plant.id;
  state.visited[plant.id] = true;
  map.flyTo([plant.lat, plant.lng], Math.max(map.getZoom(), 19), { duration: 0.5 });
  renderAll();
  trackPlantEvent(firstVisit ? "plant_unlocked_qr_demo" : "plant_qr_demo_reopened", plant);
}

function answerQuiz(id, selectedIndex) {
  const plant = plantById(id);
  if (!plant || state.answered[id]) return;
  const correct = selectedIndex === plant.quiz.answerIndex;
  state.answered[id] = { selectedIndex, correct, at: new Date().toISOString() };
  if (correct) state.score += 10;
  renderAll();
  trackPlantEvent("quiz_answered", plant, {
    answer_selected: selectedIndex,
    answer_correct: correct
  });
  maybeTrackGameCompleted();
  saveState();
}

function nextMission() {
  const unvisited = window.PLANTS.filter(plant => !state.visited[plant.id]);
  const pool = unvisited.length ? unvisited : window.PLANTS.filter(plant => !state.answered[plant.id]);
  if (!pool.length) {
    el.targetStatus.innerHTML = "<strong>¡Recorrido completo!</strong> Reiniciá o agregá más plantas en data/plants.js.";
    trackEvent("next_mission_after_completion");
    return;
  }
  pool.sort((a, b) => metersBetween(state.playerPosition, a) - metersBetween(state.playerPosition, b));
  trackEvent("next_mission");
  selectPlant(pool[0].id);
}

function requestGps() {
  trackEvent("gps_requested");
  if (!navigator.geolocation) {
    trackEvent("gps_not_supported");
    alert("Este navegador no soporta geolocalización. Usá el modo demo.");
    return;
  }
  state.demoMode = false;
  el.gpsBtn.textContent = "GPS buscando…";
  state.gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      // El GPS se usa solo en pantalla. No se envían coordenadas a la planilla.
      state.playerPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      playerMarker.setPopupContent(`GPS real<br>Precisión aprox.: ${Math.round(pos.coords.accuracy)} m`);
      el.gpsBtn.textContent = "GPS activo";
      if (!gpsStartedTracked) {
        gpsStartedTracked = true;
        trackEvent("gps_started", { gps_accuracy_m: Math.round(pos.coords.accuracy || 0) });
      }
      renderAll();
    },
    error => {
      console.warn(error);
      el.gpsBtn.textContent = "Usar GPS real";
      trackEvent("gps_error", { gps_error_code: error.code });
      alert("No pude activar GPS. Podés jugar igual con modo demo sin GPS.");
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
  );
}

function stopGpsAndUseDemo() {
  if (state.gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
  }
  state.demoMode = true;
  el.gpsBtn.textContent = "Usar GPS real";
  renderAll();
  trackEvent("demo_mode_enabled");
}

function resetGame() {
  if (!confirm("¿Reiniciar progreso, puntaje y plantas visitadas?")) return;
  trackEvent("reset_progress");
  const keepName = state.playerName;
  Object.assign(state, {
    playerName: keepName,
    demoMode: true,
    playerPosition: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
    currentPlantId: null,
    visited: {},
    answered: {},
    score: 0,
    analyticsGameCompleted: false,
    gpsWatchId: null
  });
  localStorage.removeItem(STORAGE_KEY);
  map.flyTo(DEFAULT_CENTER, 18, { duration: 0.7 });
  renderAll();
}

function editPlayerName() {
  const name = prompt("Nombre para este recorrido:", state.playerName || "Visitante");
  if (name === null) return;
  state.playerName = name.trim() || "Visitante";
  renderAll();
}

function readUrlPlant() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("plant") || params.get("qr");
  const plant = plantById(id);
  if (id && plant) {
    const firstVisit = !state.visited[id];
    state.currentPlantId = id;
    state.visited[id] = true; // Simula que llegó por QR físico.
    trackPlantEvent(firstVisit ? "plant_unlocked_qr_url" : "plant_qr_url_reopened", plant);
    setTimeout(() => selectPlant(id, { pan: true, track: false }), 250);
  }
}

function bindEvents() {
  el.editNameBtn.addEventListener("click", editPlayerName);
  el.nextMissionBtn.addEventListener("click", nextMission);
  el.resetBtn.addEventListener("click", resetGame);
  el.demoModeBtn.addEventListener("click", stopGpsAndUseDemo);
  el.gpsBtn.addEventListener("click", requestGps);
  el.walkToTargetBtn.addEventListener("click", () => walkToPlant());
  el.scanTargetBtn.addEventListener("click", () => scanPlant());
  el.openHelpBtn.addEventListener("click", () => el.helpDialog.showModal());
  el.closeHelpBtn.addEventListener("click", () => el.helpDialog.close());
  document.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "n") nextMission();
  });
  window.addEventListener("resize", refreshMapLayout);
  window.addEventListener("orientationchange", () => setTimeout(refreshMapLayout, 250));
  window.addEventListener("load", () => setTimeout(refreshMapLayout, 250));
}

function init() {
  if (!Array.isArray(window.PLANTS) || !window.PLANTS.length) {
    document.body.innerHTML = "<main style='padding:2rem'><h1>No hay plantas cargadas</h1><p>Revisá data/plants.js.</p></main>";
    return;
  }
  loadState();
  initMap();
  bindEvents();
  renderAll();
  trackEvent("page_view");
  readUrlPlant();
}

window.Game = {
  selectPlantFromPopup: id => selectPlant(id)
};

init();
