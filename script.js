/* ==========================================================
   สร้างพื้นผิวเมฆ (fBm noise แบบต่อขอบได้) ครั้งเดียวตอนเปิดหน้า
   - ตัวก้อน: ความหนาแน่นของเมฆ   - ขอบสว่าง: ด้านที่รับแสงจากซ้ายบน
   ========================================================== */
(function makeCloudTextures() {
  const W = 768, H = 384;
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const octaves = [[4, 2, 1], [8, 4, 0.55], [16, 8, 0.3], [32, 16, 0.16], [64, 32, 0.08]]
    .map(([nx, ny, amp]) => ({ nx, ny, amp, g: Float32Array.from({ length: nx * ny }, rnd) }));
  const sum = octaves.reduce((s, o) => s + o.amp, 0);
  const sm = (t) => t * t * (3 - 2 * t);

  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (const o of octaves) {
      const u = (x / W) * o.nx, w = (y / H) * o.ny;
      const i = Math.floor(u), j = Math.floor(w), fx = sm(u - i), fy = sm(w - j);
      const i1 = (i + 1) % o.nx, j1 = (j + 1) % o.ny, i0 = i % o.nx, j0 = j % o.ny;
      const a = o.g[j0 * o.nx + i0], b = o.g[j0 * o.nx + i1], c = o.g[j1 * o.nx + i0], d = o.g[j1 * o.nx + i1];
      v += o.amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
    }
    h[y * W + x] = v / sum;
  }

  const at = (x, y) => h[((y + H) % H) * W + ((x + W) % W)];
  const body = new ImageData(W, H), light = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = Math.min(Math.max((h[y * W + x] - 0.35) / 0.28, 0), 1);
    // จางขอบบน-ล่างของพื้นผิว กันเกิดเส้นตัดแข็ง ๆ ตรงรอยต่อของเมฆ
    const edge = sm(Math.min(1, y / (H * 0.2), (H - 1 - y) / (H * 0.2)));
    const dens = sm(t) * edge;                                          // ความหนาแน่นของเมฆ
    const slope = at(x + 5, y + 5) - at(x - 5, y - 5);                  // ความชันหันเข้าหาแสงซ้ายบน
    const lit = Math.min(Math.max(slope * 14, 0), 1) * dens;
    const k = (y * W + x) * 4 + 3;
    body.data[k] = dens * 255;
    light.data[k] = lit * 255;
  }

  const url = (img) => {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.getContext("2d").putImageData(img, 0, 0);
    return 'url("' + cv.toDataURL("image/png") + '")';
  };
  const root = document.documentElement.style;
  root.setProperty("--tex-body", url(body));
  root.setProperty("--tex-light", url(light));
})();


/* ==========================================================
   0. ตั้งค่า Supabase
   ========================================================== */
const SUPABASE_URL = "https://hgvyfbqfznseozkcqdgz.supabase.co";
const SUPABASE_KEY = "sb_publishable_wSwXKUU9KM6ph_6OEU1kLQ_AteZLlGV";   // ใช้ anon/publishable key เท่านั้น ห้ามใช้ service_role
let DEVICE = (() => { try { return localStorage.getItem("airsense-device"); } catch (e) { return null; } })() || "IoT-01";   // อุปกรณ์ที่เลือกอยู่ (จำค่าไว้ในเครื่อง)

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
const sb = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;


/* ==========================================================
   1. ระดับคุณภาพอากาศ (สีท้องฟ้าอยู่ใน style.css ตาม data-level)
   ========================================================== */
const LEVELS = [
  { k: "Good", bar: "#2a8fdc",      max: 25,  color: "#4ade80", tip: "อากาศดี เหมาะกับการทำกิจกรรมกลางแจ้ง" },
  { k: "Moderate", bar: "#8fa0ad",  max: 50,  color: "#facc15", tip: "อากาศพอใช้ กลุ่มเสี่ยงควรระวัง" },
  { k: "Unhealthy", bar: "#a99f8c", max: 100, color: "#fb923c", tip: "ไม่ดี ลดกิจกรรมกลางแจ้ง ปิดหน้าต่าง" },
  { k: "Hazardous", bar: "#b49a74", max: 999, color: "#ff6b5b", tip: "อันตราย งดกิจกรรมกลางแจ้ง ใส่หน้ากาก N95" }
];
const level = (v) => LEVELS.find((l) => v <= l.max);

// ระดับที่ใช้แสดงผล: มี "หน่วงขอบ" 2 หน่วย กันป้ายสถานะ/สี กระพริบไปมาเมื่อค่าแกว่งใกล้เส้นแบ่ง
let lvIdx = -1;
function stableLevel(v) {
  const raw = LEVELS.findIndex((l) => v <= l.max);
  if (lvIdx < 0) lvIdx = raw;
  else if (raw > lvIdx && v > LEVELS[lvIdx].max + 2) lvIdx = raw;   // แย่ลง: ต้องเกินเส้นแบ่งเกิน 2
  else if (raw < lvIdx && v < LEVELS[raw].max - 2) lvIdx = raw;     // ดีขึ้น: ต้องต่ำกว่าเส้นแบ่งเกิน 2
  return LEVELS[lvIdx];
}


/* ==========================================================
   2. ฐานข้อมูล (Supabase) — 1 คำขอต่อรอบ + หมดเวลา 8 วินาที
   ========================================================== */
const sig = () => (window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined);

const db = {
  // บันทึกค่าใหม่ และรับแถวที่บันทึกกลับมาเลย (ไม่ต้องดึงซ้ำ)
  async insert(r) {
    const { data, error } = await sb.from("readings")
      .insert({ device_code: DEVICE, pm25: r.pm25, humidity: r.humidity })
      .select().single().abortSignal(sig());
    if (error) throw error;
    return data;
  },
  // ลบข้อมูลทั้งหมดของอุปกรณ์ที่เลือก คืนจำนวนแถวที่ลบได้จริง
  async clear() {
    const { data, error } = await sb.from("readings").delete().eq("device_code", DEVICE).select("id").abortSignal(sig());
    if (error) throw error;
    return data.length;
  },
  // รายชื่ออุปกรณ์ทั้งหมด (ตาราง devices) ใช้ทำเมนูเลือก
  async devices() {
    const { data, error } = await sb.from("devices").select("*").order("id", { ascending: true }).abortSignal(sig());
    if (error) throw error;
    return data;
  },
  // โหลดประวัติครั้งแรก (นับจำนวนทั้งหมดแค่ครั้งนี้ครั้งเดียว)
  async history(n = 40) {
    const { data, error, count } = await sb.from("readings")
      .select("*", { count: "exact" })
      .eq("device_code", DEVICE)
      .order("recorded_at", { ascending: false })
      .limit(n).abortSignal(sig());
    if (error) throw error;
    return { list: data.reverse(), total: count || 0 };
  },
  // ดึงเฉพาะค่าใหม่กว่าที่มี (ใช้ตอนปิดการส่งข้อมูล / มีเซนเซอร์จริงส่งเข้ามา)
  async since(t) {
    const { data, error } = await sb.from("readings")
      .select("*").eq("device_code", DEVICE).gt("recorded_at", t)
      .order("recorded_at", { ascending: true }).limit(40).abortSignal(sig());
    if (error) throw error;
    return data;
  }
};


/* ==========================================================
   3. ตัวจำลองเซนเซอร์ + ลูปทำงาน
   ========================================================== */
const TICK_MS = 3000;      // ส่ง/อัปเดตค่าทุกกี่ ms (3000 = ทุก 3 วินาที)
let mode = "auto";      // "auto" หรือ "manual" (ใช้ค่าจากแถบเลื่อน)
let manualTarget = 40;
let simOn = true;
let pm = 15, hum = 65;

/* ---- ตั้งค่าโหมด Auto: วนไล่ระดับอากาศทีละขั้น ให้เห็นความต่างชัด ๆ ----
   AUTO_STEPS = ค่า PM2.5 เป้าหมายของแต่ละขั้น (เรียงตามลำดับ แล้ววนซ้ำ)
     Good < 25 | Moderate 26-50 | Unhealthy 51-100 | Hazardous > 100
   AUTO_HOLD  = ค้างอยู่ที่แต่ละขั้นกี่รอบ (1 รอบ = TICK_MS มิลลิวินาที) */
const AUTO_STEPS = [12, 38, 75, 140, 75, 38];     // Good → Moderate → Unhealthy → Hazardous → กลับลงมา
const AUTO_HOLD = 8;                               // 8 รอบ ≈ 24 วินาทีต่อขั้น
let autoStep = -1, autoTarget = AUTO_STEPS[0], autoHold = 0;

function nextReading() {
  if (mode === "auto") {
    autoHold -= 1;
    if (autoHold <= 0) { autoStep = (autoStep + 1) % AUTO_STEPS.length; autoTarget = AUTO_STEPS[autoStep]; autoHold = AUTO_HOLD; }
  }
  const target = mode === "auto" ? autoTarget : manualTarget;
  const speed = mode === "auto" ? 0.5 : 0.6;     // โหมดเลื่อนเอง ตอบสนองไวขึ้น
  pm += (target - pm) * speed + (Math.random() - 0.5) * (mode === "auto" ? 1.2 : 3);
  pm = Math.max(2, pm);
  hum += (Math.random() - 0.5) * 2;
  hum = Math.min(90, Math.max(35, hum));
  return { pm25: +pm.toFixed(1), humidity: +hum.toFixed(1) };
}

let rows = [], total = 0, lastTime = null, busy = false, online = true;
const norm = (r) => ({ ...r, pm25: Number(r.pm25), humidity: Number(r.humidity) });

function push(list) {
  rows = rows.concat(list.map(norm)).slice(-40);
  total += list.length;
  lastTime = rows[rows.length - 1].recorded_at;
  render(rows, total);
}

let fails = 0;
function setOnline(ok) {
  online = ok;
  fails = ok ? 0 : fails + 1;
  $("dot").className = ok ? "dot" : "dot off";
  $("conn").textContent = ok ? "เชื่อมต่อแล้ว" : "ขาดการเชื่อมต่อ";
}

async function tick() {
  if (busy || document.hidden) return;   // ไม่ซ้อนกัน และหยุดเมื่อสลับแท็บ
  busy = true;
  try {
    if (simOn) {
      const g = gen, r = await db.insert(nextReading());
      if (g === gen) push([r]);                 // ถ้าระหว่างรอผู้ใช้สลับอุปกรณ์แล้ว ทิ้งผลเก่า
    } else if (lastTime) {
      const g = gen, fresh = await db.since(lastTime);
      if (g === gen && fresh.length) push(fresh);
    }
    setOnline(true);
  } catch (err) {
    console.error("tick error:", err.message || err);
    setOnline(false);
  }
  busy = false;
}

function loop() {
  tick().finally(() => setTimeout(loop, online ? (simOn ? TICK_MS : 3000) : Math.min(2000 * fails, 10000)));
}


/* ==========================================================
   4. แสดงผลบนหน้าจอ
   ========================================================== */
const $ = (id) => document.getElementById(id);

const ARC_LENGTH = 2 * Math.PI * 100;
const GAUGE_ARC = ARC_LENGTH * 0.75;
const GAUGE_MAX = 200;

// วาดขีดสเกลรอบเกจ (ครั้งเดียวตอนเริ่ม)
(function drawTicks() {
  let s = "";
  for (let i = 0; i <= 20; i++) {
    const a = (135 + (270 * i) / 20) * Math.PI / 180;
    const r1 = i % 5 === 0 ? 112 : 115, r2 = 119;
    s += '<line x1="' + (130 + r1 * Math.cos(a)).toFixed(1) + '" y1="' + (130 + r1 * Math.sin(a)).toFixed(1) +
         '" x2="' + (130 + r2 * Math.cos(a)).toFixed(1) + '" y2="' + (130 + r2 * Math.sin(a)).toFixed(1) + '"/>';
  }
  $("ticks").innerHTML = s;
})();

// ตัวเลขกลางเกจไล่ค่าแบบนุ่ม ๆ แทนการกระโดด
let shown = null, raf = 0;
function countTo(to) {
  const from = shown === null ? to : shown;
  shown = to;
  cancelAnimationFrame(raf);
  const t0 = performance.now();
  (function step(t) {
    const k = Math.min((t - t0) / 450, 1), e = 1 - Math.pow(1 - k, 3);
    $("val").textContent = Math.round(from + (to - from) * e);
    if (k < 1) raf = requestAnimationFrame(step);
  })(t0);
}

function render(list, total) {
  const latest = list[list.length - 1];
  if (!latest) return;

  const L = stableLevel(latest.pm25);
  const fraction = Math.min(latest.pm25 / GAUGE_MAX, 1);

  $("app").dataset.level = L.k;
  // ยิ่งฝุ่นเยอะ ยิ่งหมอกหนา: 0 (ฟ้าใส) → 1 (หนาทึบ ที่ PM2.5 ≥ 150)
  $("app").style.setProperty("--amt", Math.min(Math.max(latest.pm25 / 150, 0), 1).toFixed(3));

  $("track").setAttribute("stroke-dasharray", GAUGE_ARC + " " + ARC_LENGTH);
  $("arc").setAttribute("stroke-dasharray", GAUGE_ARC * fraction + " " + ARC_LENGTH);
  $("arc").setAttribute("stroke", L.color);
  $("arc").style.color = L.color;

  countTo(latest.pm25);
  $("status").textContent = L.k;
  $("status").style.color = L.color;
  $("tip").textContent = L.tip;
  $("theme").content = L.bar;                                  // สีแถบเบราว์เซอร์มือถือตามท้องฟ้า
  document.title = Math.round(latest.pm25) + " µg/m³ · " + L.k + " – AirSense";
  $("alert").style.setProperty("--ac", L.color);

  $("pm2").innerHTML = '<span style="color:' + L.color + '">' + Math.round(latest.pm25) + '</span> <small>µg/m³</small>';
  $("hum").innerHTML = Math.round(latest.humidity) + "<small>%</small>";
  $("upd").textContent = new Date(latest.recorded_at).toLocaleTimeString("th-TH", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  $("cnt").textContent = total;

  drawSparkline(list, L.color);
}

function drawSparkline(data, color) {
  const W = 300, H = 56, padL = 22, padR = 6, padT = 6, padB = 12;
  const vals = data.map((d) => Number(d.pm25));
  const top = Math.max(50, Math.ceil(Math.max(...vals) / 25) * 25);
  const X = (i) => padL + (i / Math.max(vals.length - 1, 1)) * (W - padL - padR);
  const Y = (v) => padT + (1 - v / top) * (H - padT - padB);
  const pts = vals.map((v, i) => [X(i), Y(v)]);

  // เส้นโค้งนุ่ม (Catmull-Rom -> Bezier)
  let d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += " C" + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + "," + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
         " " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + "," + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
         " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
  }
  const last = pts[pts.length - 1];
  const area = d + " L" + last[0].toFixed(1) + "," + (H - padB) + " L" + pts[0][0].toFixed(1) + "," + (H - padB) + " Z";

  // สีเส้นไล่ตามระดับอากาศ (เขียว <25, เหลือง <50, ส้ม <100, แดง >100)
  const off = (v) => Math.min(Math.max((Y(v) - padT) / (H - padT - padB), 0), 1);
  const stops = [[0, "#ff6b5b"], [off(100), "#ff6b5b"], [off(100), "#fb923c"], [off(50), "#fb923c"],
                 [off(50), "#facc15"], [off(25), "#facc15"], [off(25), "#4ade80"], [1, "#4ade80"]]
    .map((s) => '<stop offset="' + s[0].toFixed(3) + '" stop-color="' + s[1] + '"/>').join("");

  const mid = top / 2;
  const grid = [0, mid, top].map((v) =>
    '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>' +
    '<text class="axis" x="' + (padL - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end">' + Math.round(v) + '</text>'
  ).join("");

  $("spark").innerHTML =
    '<defs>' +
      '<linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="0" y1="' + padT + '" x2="0" y2="' + (H - padB) + '">' + stops + '</linearGradient>' +
      '<linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".38"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient>' +
    '</defs>' + grid +
    '<path d="' + area + '" fill="url(#ag)"/>' +
    '<path d="' + d + '" fill="none" stroke="url(#lg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="7" fill="' + color + '" opacity=".28"/>' +
    '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5" fill="#fff" stroke="' + color + '" stroke-width="2"/>' +
    '<text class="axis" x="' + padL + '" y="' + (H - 3) + '">เก่า</text>' +
    '<text class="axis" x="' + (W - padR) + '" y="' + (H - 3) + '" text-anchor="end">ล่าสุด</text>';
}


/* ==========================================================
   5. ปุ่มควบคุมตัวจำลอง
   ========================================================== */
const range = $("sim-range");

function updateSliderLabel() {
  $("sim-out").textContent = mode === "auto" ? "Auto" : manualTarget + " µg/m³ · " + level(manualTarget).k;
}

// ลากแถบเลื่อน -> เปลี่ยนเป็นโหมดกำหนดเอง, ปล่อยแล้วส่งค่าทันที
range.addEventListener("input", () => {
  manualTarget = +range.value;
  mode = "manual";
  buildButtons();
  updateSliderLabel();
});
range.addEventListener("change", tick);

function buildButtons() {
  const box = $("btns");
  box.innerHTML = "";

  const auto = document.createElement("button");
  auto.textContent = "Auto";
  auto.className = mode === "auto" ? "on" : "";
  auto.onclick = () => { mode = "auto"; buildButtons(); updateSliderLabel(); };
  box.appendChild(auto);

  const toggle = document.createElement("button");
  toggle.textContent = simOn ? "ส่งข้อมูล: เปิด" : "ส่งข้อมูล: ปิด";
  toggle.className = simOn ? "on" : "";
  toggle.onclick = () => { simOn = !simOn; buildButtons(); };
  box.appendChild(toggle);

  const wipe = document.createElement("button");
  wipe.textContent = "ล้างข้อมูล";
  wipe.className = "danger";
  wipe.onclick = resetData;
  box.appendChild(wipe);
}

// รีเซ็ต: ลบข้อมูลของอุปกรณ์ที่เลือกอยู่ แล้วเริ่มนับใหม่
async function resetData() {
  if (!configured) return;
  if (!confirm("ลบข้อมูลทั้งหมดของ " + DEVICE + " (" + total + " รายการ) และเริ่มนับใหม่?\nลบแล้วกู้คืนไม่ได้")) return;
  try {
    const n = await db.clear();
    if (n === 0 && total > 0) {
      alert("ลบไม่สำเร็จ: Supabase ยังไม่อนุญาตให้ลบ\nให้รันไฟล์ reset_data.sql ใน SQL Editor ก่อน แล้วลองใหม่");
      return;
    }
    gen++; rows = []; total = 0; lastTime = null; lvIdx = -1;
    await loadDevice();                 // ได้ข้อมูลว่าง -> หน้าจอล้างรอค่าแรก
  } catch (err) {
    console.error(err.message || err);
    alert("ลบไม่สำเร็จ: " + (err.message || err));
  }
}


/* ==========================================================
   อุปกรณ์หลายตัว: เมนูเลือกสถานที่ + สลับข้อมูลตามอุปกรณ์
   ========================================================== */
let devices = [{ device_code: "IoT-01", name: "Home sensor · Lampang", location: "Lampang, Thailand" }];
let gen = 0;    // เพิ่มทุกครั้งที่สลับอุปกรณ์ ใช้ทิ้งผลลัพธ์ของคำขอเก่าที่ยังค้างอยู่

function showDevice() {
  const d = devices.find((x) => x.device_code === DEVICE) || devices[0];
  $("loc-name").textContent = d.location || d.name || d.device_code;
  $("devname").textContent = d.device_code;
}

function buildMenu() {
  const m = $("loc-menu");
  m.innerHTML = "";
  devices.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "option");
    b.className = d.device_code === DEVICE ? "on" : "";
    const t = document.createElement("span");
    t.textContent = d.location || d.device_code;
    const s = document.createElement("small");
    s.textContent = d.device_code + (d.name ? " · " + d.name : "");
    b.append(t, s);
    b.onclick = () => switchDevice(d.device_code);
    m.appendChild(b);
  });
}

function setMenu(open) {
  $("loc-menu").hidden = !open;
  $("loc-btn").setAttribute("aria-expanded", open);
}
$("loc-btn").addEventListener("click", (e) => { e.stopPropagation(); setMenu($("loc-menu").hidden); });
document.addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

async function loadDevice() {
  const g = gen;
  try {
    const h = await db.history(40);
    if (g !== gen) return;
    rows = h.list.map(norm); total = h.total;
    if (rows.length) {
      const last = rows[rows.length - 1];
      lastTime = last.recorded_at; pm = last.pm25; hum = last.humidity;   // ตัวจำลองต่อจากค่าล่าสุดของอุปกรณ์นี้
      render(rows, total);
    } else {
      // อุปกรณ์ใหม่ยังไม่มีข้อมูล: ล้างหน้าจอรอค่าแรก
      $("val").textContent = "--"; shown = null;
      $("status").textContent = "--"; $("pm2").textContent = "--"; $("hum").textContent = "--";
      $("spark").innerHTML = ""; $("upd").textContent = "--"; $("cnt").textContent = "0";
    }
    setOnline(true);
  } catch (err) {
    if (g === gen) { console.error(err.message || err); setOnline(false); }
  }
}

async function switchDevice(code) {
  setMenu(false);
  if (code === DEVICE) return;
  DEVICE = code;
  try { localStorage.setItem("airsense-device", code); } catch (e) {}
  gen++; rows = []; total = 0; lastTime = null; lvIdx = -1;
  showDevice(); buildMenu();
  await loadDevice();
}


/* ==========================================================
   6. เริ่มทำงาน
   ========================================================== */
buildButtons();
updateSliderLabel();

if (!configured) {
  $("tip").textContent = "ยังไม่ได้ตั้งค่า Supabase: แก้ SUPABASE_URL และ SUPABASE_KEY ใน index.html";
  $("status").textContent = "ยังไม่เชื่อมต่อ";
} else {
  // โหลดรายชื่ออุปกรณ์ -> โหลดประวัติของอุปกรณ์ที่เลือก -> เริ่มลูป
  db.devices()
    .then((list) => { if (list.length) devices = list; })
    .catch((err) => console.error(err.message || err))
    .then(() => {
      if (!devices.some((d) => d.device_code === DEVICE)) DEVICE = devices[0].device_code;
      showDevice(); buildMenu();
      return loadDevice();
    })
    .finally(loop);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}


/* ==========================================================
   7. กรอบแอป: ย่อให้พอดีหน้าจอเสมอ
   ========================================================== */
const PHONE_W = 400, PHONE_H = 760;
function fitPhone() {
  const small = window.matchMedia("(max-width: 520px)").matches;   // มือถือจริง: เต็มจอ ไม่ต้องย่อ
  const s = small ? 1 : Math.min(1, (innerHeight - 32) / PHONE_H, (innerWidth - 32) / PHONE_W);
  document.documentElement.style.setProperty("--fit", s.toFixed(3));
}
fitPhone();
addEventListener("resize", fitPhone);