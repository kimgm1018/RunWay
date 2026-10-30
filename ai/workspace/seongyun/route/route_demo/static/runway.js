"use strict";
// RunWay course recommendation page. Talks only to route_demo/app_runway.py (/api/*).
// Course shapes (P8): loop (default, unchanged behaviour), out_and_back, point_to_point. Gate results that the server only
// logs are never shown: the server does not send them and this page reads no gate-log keys.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const map = L.map("map", { zoomControl: false }).setView([35.158, 129.11], 14);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap contributors | Copernicus DEM GLO-30",
}).addTo(map);
const startIcon = L.divIcon({ className: "", html: '<div class="start-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const startMarker = L.marker([0, 0], { icon: startIcon, zIndexOffset: 1000, keyboard: false });
const endIcon = L.divIcon({ className: "", html: '<div class="end-pin">도착</div>', iconSize: [40, 22], iconAnchor: [20, 22] });
const endMarker = L.marker([0, 0], { icon: endIcon, zIndexOffset: 900, keyboard: false });
const routeLayer = L.layerGroup().addTo(map);
const debugLayer = L.layerGroup().addTo(map);

const SHAPE_LABEL = { loop: "순환", out_and_back: "왕복", point_to_point: "편도" };
const SHAPE_HINT = {
  loop: "출발점으로 돌아오는 순환 코스예요.",
  out_and_back: "반환점까지 갔다가 같은 길로 돌아와요. 목표 거리는 왕복 합계예요.",
  point_to_point: "출발점에서 도착점까지 달려요. 출발점으로 돌아오지 않아요.",
};
const NO_END_TEXT = "도착 위치를 아직 고르지 않았어요.";
const state = { status: null, start: null, end: null, shape: "loop", clickTarget: "start", km: 5, seed: 1, round: 0,
  result: null, prev: null, selected: 0, busy: false };

// ---------------------------------------------------------------- start / end / inputs
function setStart(lat, lon, label) {
  state.start = { lat, lon, label };
  startMarker.setLatLng([lat, lon]).addTo(map);
  $("#start-text").textContent = label;
}
function setEnd(lat, lon, label) {
  state.end = { lat, lon, label };
  endMarker.setLatLng([lat, lon]);
  if (state.shape === "point_to_point") endMarker.addTo(map);
  $("#end-text").textContent = label;
}
const pickedLabel = (ll) => `지도에서 고른 위치 (${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)})`;
map.on("click", (e) => {
  // Only a point-to-point request has a destination; every other shape keeps the original click = start behaviour.
  if (state.shape === "point_to_point" && state.clickTarget === "end") return setEnd(e.latlng.lat, e.latlng.lng, pickedLabel(e.latlng));
  setStart(e.latlng.lat, e.latlng.lng, pickedLabel(e.latlng));
});
$("#btn-default").onclick = () => {
  const d = state.status?.default_start;
  if (!d) return;
  setStart(d.lat, d.lon, `${d.label} (기본 위치)`);
  map.setView([d.lat, d.lon], 14);
};
$("#btn-geo").onclick = () => {
  if (!navigator.geolocation) return showError("이 브라우저에서는 내 위치를 쓸 수 없어요. 지도를 눌러 출발 위치를 골라 주세요.");
  $("#start-text").textContent = "내 위치를 찾는 중…";
  navigator.geolocation.getCurrentPosition(
    (p) => { setStart(p.coords.latitude, p.coords.longitude, "내 위치"); map.setView([p.coords.latitude, p.coords.longitude], 14); },
    () => { showError("위치 권한이 없어 내 위치를 쓸 수 없어요. 지도를 눌러 출발 위치를 골라 주세요."); if (state.start) $("#start-text").textContent = state.start.label; },
    { timeout: 8000 });
};
$$("#dist button").forEach((b) => (b.onclick = () => {
  $$("#dist button").forEach((x) => x.classList.remove("on"));
  $("#dist .custom").classList.remove("on");
  b.classList.add("on"); state.km = +b.dataset.km; $("#dist-custom").value = "";
}));
$("#dist-custom").oninput = (e) => {
  const v = parseFloat(e.target.value);
  $$("#dist button").forEach((x) => x.classList.remove("on"));
  $("#dist .custom").classList.add("on");
  state.km = Number.isFinite(v) ? v : NaN;
};
// Set the distance input programmatically (DESTINATION_TOO_FAR retry): a preset button if one matches, else the custom box.
function setDistance(km) {
  const preset = $$("#dist button").find((x) => +x.dataset.km === km);
  $$("#dist button").forEach((x) => x.classList.remove("on"));
  $("#dist .custom").classList.toggle("on", !preset);
  if (preset) { preset.classList.add("on"); $("#dist-custom").value = ""; } else { $("#dist-custom").value = String(km); }
  state.km = km;
}
const filters = () => Object.fromEntries($$(".tog input").map((i) => [i.dataset.f, i.checked]));

// ---------------------------------------------------------------- course shape
function setShape(shape) {
  state.shape = shape;
  $$("#shape button").forEach((b) => b.classList.toggle("on", b.dataset.shape === shape));
  $("#shape-hint").textContent = SHAPE_HINT[shape];
  const p2p = shape === "point_to_point";
  $("#end-row").hidden = !p2p;
  if (p2p) {
    if (state.end) endMarker.addTo(map);
    setClickTarget(state.end ? state.clickTarget : "end");  // no destination yet: the next map click sets it
  } else {
    endMarker.remove();
    setClickTarget("start");
  }
}
function setClickTarget(t) {
  state.clickTarget = t;
  $$("#click-target button").forEach((b) => b.classList.toggle("on", b.dataset.target === t));
  $("#map").classList.toggle("pick-end", t === "end");
}
$$("#shape button").forEach((b) => (b.onclick = () => setShape(b.dataset.shape)));
$$("#click-target button").forEach((b) => (b.onclick = () => setClickTarget(b.dataset.target)));
$("#btn-end-clear").onclick = () => {
  state.end = null;
  endMarker.remove();
  $("#end-text").textContent = NO_END_TEXT;
  setClickTarget("end");
};

// ---------------------------------------------------------------- status (engine loads in the background)
async function pollStatus() {
  try {
    const s = await (await fetch("/api/status")).json();
    state.status = s;
    if (!state.start && s.default_start) {
      setStart(s.default_start.lat, s.default_start.lon, `${s.default_start.label} (기본 위치)`);
      map.setView([s.default_start.lat, s.default_start.lon], 14);
      $("#quick").innerHTML = "";
      for (const q of s.quick_starts) {
        const b = document.createElement("button");
        b.className = "chip small"; b.type = "button"; b.textContent = q.label;
        b.onclick = () => { setStart(q.lat, q.lon, q.label); map.setView([q.lat, q.lon], 14); };
        $("#quick").appendChild(b);
      }
    }
    if (s.ready) { $("#btn-go").disabled = false; setBusy(null); return; }
    if (s.error) { setBusy(null); showError("추천 엔진을 시작하지 못했어요. 개발자에게 알려 주세요."); $("#dbg-json").textContent = s.error; return; }
    setBusy("추천 엔진을 준비하는 중이에요… (처음 한 번, 10초 정도)");
  } catch (e) {
    setBusy("서버에 연결하는 중…");
  }
  setTimeout(pollStatus, 1500);
}

function setBusy(text) {
  const el = $("#busy");
  el.hidden = !text;
  el.innerHTML = text ? `<span class="spinner"></span>${esc(text)}` : "";
}
// action (optional): { label, onClick } -> a button under the message (used only for DESTINATION_TOO_FAR).
function showError(msg, action) {
  const el = $("#error");
  el.hidden = !msg;
  el.textContent = msg || "";
  if (msg && action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost retry"; b.textContent = action.label;
    b.onclick = action.onClick;
    el.appendChild(b);
  }
}

// ---------------------------------------------------------------- recommend
$("#btn-go").onclick = () => recommend(false);
$("#btn-regen").onclick = () => recommend(true);

async function recommend(regen) {
  if (state.busy) return;
  if (!state.start) return showError("먼저 출발 위치를 정해 주세요.");
  if (!Number.isFinite(state.km)) return showError("거리를 숫자로 입력해 주세요.");
  if (state.shape === "point_to_point" && !state.end) {  // no request without a destination
    setClickTarget("end");
    return showError("편도 코스는 도착 위치가 필요해요. 지도를 눌러 도착 위치를 골라 주세요.");
  }
  showError(null);
  const seed = regen && state.result ? state.result.next_seed : 1;
  const body = { lat: state.start.lat, lon: state.start.lon, distance_km: state.km, filters: filters(), seed, shape: state.shape };
  if (state.shape === "point_to_point") { body.end_lat = state.end.lat; body.end_lon = state.end.lon; }
  const asked = { start: { ...state.start }, end: state.end ? { ...state.end } : null, shape: state.shape };
  state.busy = true;
  [$("#btn-go"), $("#btn-regen")].forEach((b) => (b.disabled = true));
  const t0 = performance.now();
  const tick = setInterval(() => setBusy(`새 코스를 만드는 중… ${((performance.now() - t0) / 1000).toFixed(0)}초`), 500);
  setBusy("새 코스를 만드는 중…");
  try {
    const r = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let res;
    try { res = await r.json(); } catch (e) { res = { ok: false, error: { message: "코스를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요." } }; }
    $("#dbg-json").textContent = JSON.stringify(res.debug ?? res, null, 1);
    if (!res.ok) {
      showError(res.error?.message || "코스를 만들지 못했어요.", retryAction(res, asked));
      $("#results").classList.toggle("stale", !!state.result);  // earlier TOP3 stays visible, dimmed
      return;
    }
    $("#results").classList.remove("stale");
    state.prev = regen ? state.result : null;
    state.round = regen ? state.round + 1 : 1;
    state.result = res;
    state.selected = 0;
    render();
  } catch (e) {
    showError("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    clearInterval(tick);
    setBusy(null);
    state.busy = false;
    $("#btn-go").disabled = false;
    $("#btn-regen").disabled = false;
  }
}

// DESTINATION_TOO_FAR: offer "{min_target_km} km로 다시 찾기". Nothing is requested until the user presses it (user
// decision); the retry uses the same start, destination and shape as the failed request with distance = min_target_km.
function retryAction(res, asked) {
  const km = Number(res.min_target_km);
  if (res.error?.code !== "DESTINATION_TOO_FAR" || !Number.isFinite(km)) return null;
  return {
    label: `${km} km로 다시 찾기`,
    onClick: () => {
      if (asked.start.lat !== state.start?.lat || asked.start.lon !== state.start?.lon) setStart(asked.start.lat, asked.start.lon, asked.start.label);
      if (state.shape !== asked.shape) setShape(asked.shape);
      if (asked.end && (asked.end.lat !== state.end?.lat || asked.end.lon !== state.end?.lon)) setEnd(asked.end.lat, asked.end.lon, asked.end.label);
      setDistance(km);
      recommend(false);
    },
  };
}

// Shared length / shorter route on unique edges (same measure the generator uses for duplicates).
function overlapWithPrev(route) {
  if (!state.prev) return null;
  const mine = new Map(route.edges);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  let best = 0;
  for (const p of state.prev.routes) {
    const theirs = new Map(p.edges);
    let shared = 0;
    for (const [k, l] of mine) if (theirs.has(k)) shared += l;
    best = Math.max(best, shared / Math.min(sum(mine), sum(theirs)));
  }
  return best;
}

const kmText = (m) => (Number.isFinite(m) ? `${(m / 1000).toFixed(1)} km` : "–");

function render() {
  const res = state.result;
  $("#results").hidden = false;
  const g = res.generation;
  const roundText = state.round > 1 ? `${state.round}번째 추천 · ` : "";
  const shapeText = res.shape && res.shape !== "loop" ? `${SHAPE_LABEL[res.shape]} 코스 · ` : "";
  $("#gen-info").textContent = `${roundText}${shapeText}방금 새로 만든 서로 다른 코스 ${g.candidates}개 중 3개를 골랐어요 · ${g.seconds}초` +
    (g.preference_bias ? " · 선택한 조건을 코스 생성에도 반영" : "");
  $("#notices").innerHTML = res.notices.map((n) => `<div class="notice">${esc(n)}</div>`).join("");
  if (res.return_trip) {  // point-to-point only: how far the runner is from the start at the finish
    const rt = res.return_trip;
    $("#notices").insertAdjacentHTML("beforeend", `<div class="notice info">도착 후 출발점까지 직선 ${kmText(rt.straight_m)}, 길로는 ${kmText(rt.runnable_m)}예요.</div>`);
  }
  if (state.prev) {
    const ov = res.routes.map(overlapWithPrev);
    const fresh = ov.filter((x) => x < 0.6).length;
    $("#notices").insertAdjacentHTML("afterbegin", `<div class="notice info">같은 조건으로 코스를 새로 만들었어요. 추천 ${res.routes.length}개 중 ${fresh}개는 이전 추천과 많이 달라요 (겹치는 구간 60% 미만).</div>`);
  }
  $("#cards").innerHTML = "";
  res.routes.forEach((r, i) => $("#cards").appendChild(card(r, i)));
  $("#route-tabs").hidden = false;
  $("#route-tabs").innerHTML = res.routes.map((r, i) => `<button type="button" data-i="${i}">추천 ${r.rank}</button>`).join("");
  $$("#route-tabs button").forEach((b) => (b.onclick = () => select(+b.dataset.i)));
  select(0, true);
  if ($("#dbg-network").checked) loadNetwork();
}

function card(r, i) {
  const el = document.createElement("div");
  el.className = "rc";
  const ov = overlapWithPrev(r);
  const notes = r.shape_notes || [];
  el.innerHTML = `
    <div class="rc-head"><span class="badge">추천 ${r.rank}</span><span class="rc-km">${r.distance_km.toFixed(2)} km</span>
      <span class="rc-err">목표 대비 ${r.error_pct >= 0 ? "+" : ""}${r.error_pct.toFixed(1)}%</span></div>
    <p class="summary">${esc(r.summary)}</p>
    <ul class="reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${r.caveats.length ? `<ul class="caveats">${r.caveats.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${notes.length ? `<ul class="shape-notes">${notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${ov != null ? `<div class="overlap">이전 추천과 겹치는 구간 ${Math.round(ov * 100)}%</div>` : ""}
    <button class="more" type="button">상세 정보 ▾</button>
    <div class="details" hidden>
      <table>${detailRows(r.details)}</table>
      ${sparkline(r.elevation_profile_m)}
    </div>`;
  el.onclick = () => select(i);
  $(".more", el).onclick = (ev) => {
    ev.stopPropagation();
    const d = $(".details", el);
    d.hidden = !d.hidden;
    ev.target.textContent = d.hidden ? "상세 정보 ▾" : "상세 정보 ▴";
    select(i);
  };
  return el;
}

// Detail rows with a header row whenever the group changes (코스 / 러닝 적합도 / 환경).
function detailRows(rows) {
  let group = null;
  return rows.map((d) => {
    const head = d.group && d.group !== group ? `<tr class="grp"><td colspan="2">${esc(d.group)}</td></tr>` : "";
    group = d.group;
    return `${head}<tr><td>${esc(d.label)}</td><td>${esc(d.value)}</td></tr>`;
  }).join("");
}

function sparkline(z) {
  if (!z || z.length < 2) return "";
  const w = 300, h = 34, lo = Math.min(...z), hi = Math.max(...z), span = Math.max(hi - lo, 5);
  const pts = z.map((v, i) => `${(i / (z.length - 1)) * w},${h - ((v - lo) / span) * (h - 4) - 2}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}" aria-label="고도 그래프">
    <polyline points="${pts}" fill="none" stroke="#ff5a36" stroke-width="1.6"/></svg>
    <div class="hint">고도 ${lo.toFixed(0)}–${hi.toFixed(0)} m (위성 고도 자료, 참고용)</div>`;
}

function select(i, fit = false) {
  state.selected = i;
  const res = state.result;
  routeLayer.clearLayers();
  res.routes.forEach((r, j) => {
    if (j === i) return;
    L.polyline(r.coords, { color: "#5b6475", weight: 3, opacity: 0.35, dashArray: "4 6", interactive: true })
      .on("click", (ev) => { L.DomEvent.stopPropagation(ev); select(j); })
      .bindTooltip(`추천 ${r.rank} · ${r.distance_km.toFixed(2)} km`, { sticky: true }).addTo(routeLayer);
  });
  const r = res.routes[i];
  L.polyline(r.coords, { color: "#ffffff", weight: 10, opacity: 0.95, interactive: false }).addTo(routeLayer);
  const line = L.polyline(r.coords, { color: "#ff5a36", weight: 6, opacity: 1 }).addTo(routeLayer);
  line.bindTooltip(`추천 ${r.rank} · ${r.distance_km.toFixed(2)} km`, { sticky: true });
  const q = r.coords[Math.floor(r.coords.length * 0.25)];
  L.circleMarker(q, { radius: 5, color: "#1d2433", weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("진행 방향 (25% 지점)").addTo(routeLayer);
  if (res.start) L.circleMarker([res.start.node_lat, res.start.node_lon], { radius: 4, color: "#1d2433", weight: 1, fillColor: "#1d2433", fillOpacity: 1 })
    .bindTooltip("실제 출발 지점 (가장 가까운 길)").addTo(routeLayer);
  if (res.end) L.circleMarker([res.end.node_lat, res.end.node_lon], { radius: 6, color: "#1d4f91", weight: 3, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip("실제 도착 지점 (가장 가까운 길)").addTo(routeLayer);
  if (r.turnaround) L.circleMarker(r.turnaround, { radius: 6, color: "#ff5a36", weight: 3, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip("반환점 (여기서 같은 길로 돌아와요)").addTo(routeLayer);
  $$(".rc").forEach((el, j) => el.classList.toggle("sel", j === i));
  $$("#route-tabs button").forEach((b, j) => b.classList.toggle("on", j === i));
  const sel = $$(".rc")[i];
  if (sel && !fit) sel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (fit) map.fitBounds(L.latLngBounds(res.routes.flatMap((x) => x.coords)), { padding: [40, 40] });
  else map.fitBounds(line.getBounds(), { padding: [40, 40], maxZoom: 16 });
}

// ---------------------------------------------------------------- debug view (hidden by default)
const DBG_STYLE = { RUNNABLE: { color: "#1a9850", weight: 1.2, opacity: 0.5 }, EXCLUDED: { color: "#d73027", weight: 3, opacity: 0.85 },
  UNCERTAIN: { color: "#fd8d3c", weight: 3.5, opacity: 0.9 } };
let extentRect = null;
// The network view is always the start-centred disk of /api/debug/network. For point_to_point the server builds its
// graph around the start-destination midpoint (graph_centre) instead, so near the destination this view can differ
// from the generation graph. Kept start-based on purpose (debug only; endpoint unchanged).
async function loadNetwork() {
  debugLayer.clearLayers();
  if (!$("#dbg-network").checked || !state.start) return;
  const km = state.result ? state.result.target_m / 1000 : state.km;
  const r = await fetch(`/api/debug/network?lat=${state.start.lat}&lon=${state.start.lon}&distance_km=${km}`);
  if (!r.ok) { $("#dbg-json").textContent = `network: ${r.status} ${await r.text()}`; return; }
  const gj = await r.json();
  const style = (f) => DBG_STYLE[f.properties.status];
  L.geoJSON(gj, { filter: (f) => f.properties.status === "RUNNABLE", style, interactive: false }).addTo(debugLayer);
  L.geoJSON(gj, {
    filter: (f) => f.properties.status !== "RUNNABLE", style,
    onEachFeature: (f, l) => l.bindPopup(`<b>${esc(f.properties.status)}</b> · ${esc(f.properties.reason)}<br>highway=${esc(f.properties.highway)} ${esc(f.properties.name || "")}<br>
        <a href="https://www.openstreetmap.org/way/${f.properties.osmid}" target="_blank" rel="noopener">OSM way ${f.properties.osmid}</a> · ${f.properties.length_m} m`),
  }).addTo(debugLayer);
}
$("#dbg-network").onchange = loadNetwork;
$("#dbg-extent").onchange = (e) => {
  if (extentRect) { extentRect.remove(); extentRect = null; }
  const ext = state.status?.env_extent_wsen;
  if (e.target.checked && ext) {
    extentRect = L.rectangle([[ext[1], ext[0]], [ext[3], ext[2]]], { color: "#7b2cbf", weight: 1.5, dashArray: "3 6", fill: false, interactive: false }).addTo(map);
  }
};

pollStatus();
