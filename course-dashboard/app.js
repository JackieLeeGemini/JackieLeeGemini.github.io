const PICKS_KEY = "phbs-course-picks-v1";

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uniquePalette(n) {
  const hues = Array.from({ length: n }, (_, i) => (i * 137.508) % 360);
  const rng = mulberry32(0x50484253);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [hues[i], hues[j]] = [hues[j], hues[i]];
  }
  const colors = hues.map((h, i) => hslToHex(h, 72 + (i % 4) * 5, 52 + (i % 3) * 5));
  return new Set(colors).size === n ? colors : hues.map((h) => hslToHex(h, 70, 55));
}

function courseKey(course) {
  return `${course.zh || ""}|${course.en || ""}`;
}

function cardId(key) {
  return `course-${encodeURIComponent(key)}`;
}

function loadPicks() {
  try {
    const raw = JSON.parse(localStorage.getItem(PICKS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function savePicks(keys) {
  localStorage.setItem(PICKS_KEY, JSON.stringify(keys));
}

const state = {
  data: null,
  picks: loadPicks(),
  colors: new Map(),
};
const charts = new Map();

const stateEl = document.getElementById("status");
const stampEl = document.getElementById("stamp");
const kpisEl = document.getElementById("kpis");
const picksEl = document.getElementById("picks");
const gridEl = document.getElementById("grid");
const searchEl = document.getElementById("search");

function fmtTime(iso) {
  if (!iso) return "还没有快照";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function relative(iso) {
  if (!iso) return "等待首次采集";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "刚刚更新";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  return `${hours} 小时前`;
}

function chartLabels(history) {
  return history.map((h) => {
    const d = new Date(h.t);
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
    return `${Number(g.month)}/${Number(g.day)} ${g.hour}:${g.minute}`;
  });
}

function splitIndex(history, phaseSplitAt) {
  if (!phaseSplitAt || !history?.length) return -1;
  const exact = history.findIndex((h) => h.t === phaseSplitAt);
  if (exact >= 0) return exact;
  const target = Date.parse(phaseSplitAt);
  return history.findIndex((h) => Date.parse(h.t) >= target);
}

function niceYMax(peak) {
  const padded = Math.max(8, peak * 1.12);
  const rough = padded / 4;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(rough))));
  const residual = rough / mag;
  let step = mag;
  if (residual <= 1) step = mag;
  else if (residual <= 2) step = 2 * mag;
  else if (residual <= 5) step = 5 * mag;
  else step = 10 * mag;
  step = Math.max(1, Math.round(step));
  return Math.ceil(padded / step) * step;
}

function phaseSplitPlugin(index) {
  return {
    id: "phaseSplit",
    afterDraw(chart) {
      if (index == null || index < 0) return;
      const meta = chart.getDatasetMeta(0);
      const pt = meta?.data?.[index];
      if (!pt || typeof pt.x !== "number") return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(120, 110, 128, 0.72)";
      ctx.lineWidth = 1.4;
      ctx.moveTo(pt.x, chartArea.top);
      ctx.lineTo(pt.x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

function destroyCharts() {
  for (const chart of charts.values()) {
    try { chart.destroy(); } catch { /* ignore */ }
  }
  charts.clear();
}

function orderedCourses(data) {
  const all = data.courses?.length ? data.courses : (data.watch || []);
  const byKey = new Map(all.map((c) => [courseKey(c), c]));
  const front = [];
  for (const w of data.watch || []) {
    const key = courseKey(w);
    const hit = byKey.get(key);
    if (hit) {
      front.push(hit);
      byKey.delete(key);
    }
  }
  return [...front, ...all.filter((c) => byKey.has(courseKey(c)))];
}

function matchCourse(course, query) {
  if (!query) return false;
  const blob = [course.zh, course.en, course.note, course.schedule].join(" ").toLowerCase();
  return blob.includes(query);
}

function togglePick(key) {
  const set = new Set(state.picks);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  state.picks = [...set];
  savePicks(state.picks);
  render();
}

function addPickByQuery(query) {
  const q = query.trim().toLowerCase();
  if (!q || !state.data) return false;
  const courses = orderedCourses(state.data);
  const hit = courses.find((c) => matchCourse(c, q));
  if (!hit) return false;
  const key = courseKey(hit);
  if (!state.picks.includes(key)) {
    state.picks = [...state.picks, key];
    savePicks(state.picks);
    render();
  }
  jumpTo(key);
  return true;
}

function jumpTo(key) {
  const el = document.getElementById(cardId(key));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

function renderCard(course, color, { canvasId, showRemove = false }) {
  const key = courseKey(course);
  const picked = state.picks.includes(key);
  const overCap = course.capacity != null && course.enrolled != null && course.enrolled > course.capacity;
  const badge = overCap ? "超容" : (course.watched ? "关注" : "在开");
  const actionLabel = showRemove || picked ? "−" : "+";
  const card = document.createElement("article");
  card.className = `card${overCap ? " over" : ""}`;
  if (!showRemove) card.id = cardId(key);
  card.dataset.key = key;
  card.innerHTML = `
    <div class="card-head">
      <div>
        <div class="zh">${course.zh}</div>
        <div class="en">${course.en}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:flex-start">
        <span class="badge ${overCap ? "hot" : "ok"}">${badge}</span>
        <button type="button" class="pick-btn${picked ? " on" : ""}" data-pick="${key}" aria-label="${picked ? "移出自选" : "加入自选"}">${actionLabel}</button>
      </div>
    </div>
    <div class="meta">
      <div class="num">${course.enrolled ?? "-"}<span style="color:#8b7396;font-size:12px"> / ${course.capacity ?? "-"}</span></div>
      <div>${course.schedule || ""}</div>
    </div>
    <div class="chart"><canvas id="${canvasId}"></canvas></div>
  `;
  return card;
}

function renderPicks(byKey, phaseSplitAt) {
  const pickedCourses = state.picks.map((k) => byKey.get(k)).filter(Boolean);
  picksEl.innerHTML = `
    <div class="picks-head">
      <div>
        <h2>自选区</h2>
        <p>只存在你这台浏览器里。朋友打开同一网址会有他自己的自选。</p>
      </div>
      <form class="picks-add" id="picks-form">
        <input name="q" placeholder="输入课名 / 英文 / 备注加入" />
        <button type="submit">加入</button>
      </form>
    </div>
  `;
  if (!pickedCourses.length) {
    const empty = document.createElement("div");
    empty.className = "picks-empty";
    empty.textContent = "还没有自选。点课程卡片右上角 +，或在上面搜索加入。";
    picksEl.appendChild(empty);
  } else {
    const grid = document.createElement("div");
    grid.className = "grid";
    pickedCourses.forEach((course, i) => {
      const key = courseKey(course);
      grid.appendChild(renderCard(course, state.colors.get(key), { canvasId: `fav-${i}`, showRemove: true }));
    });
    picksEl.appendChild(grid);
    pickedCourses.forEach((course, i) => {
      drawChart(`fav-${i}`, course, state.colors.get(courseKey(course)), phaseSplitAt);
    });
  }
  picksEl.querySelector("#picks-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    const ok = addPickByQuery(input.value);
    if (!ok) {
      stateEl.textContent = "没有找到这门课，试试中文名、英文名或备注。";
      stateEl.classList.add("show");
      setTimeout(() => stateEl.classList.remove("show"), 2200);
    } else {
      input.value = "";
    }
  });
}

function render() {
  const data = state.data;
  if (!data) return;
  const courses = orderedCourses(data);
  const pal = uniquePalette(Math.max(courses.length, 1));
  state.colors = new Map(courses.map((c, i) => [courseKey(c), pal[i]]));
  const byKey = new Map(courses.map((c) => [courseKey(c), c]));
  const over = data.overCapacityCount ?? courses.filter((c) => c.capacity != null && c.enrolled != null && c.enrolled > c.capacity).length;
  const hottest = [...courses].sort((a, b) => (b.enrolled || 0) - (a.enrolled || 0))[0];

  stampEl.innerHTML = `<b>${fmtTime(data.updatedAt)}</b><span>${relative(data.updatedAt)} · 北京时间</span>`;
  kpisEl.innerHTML = `
    <article class="kpi grape"><div class="label">本轮课程</div><div class="value">${courses.length}</div></article>
    <article class="kpi mint"><div class="label">快照课程数</div><div class="value">${data.courseCount || 0}</div></article>
    <article class="kpi coral"><div class="label">已超容</div><div class="value">${over}</div></article>
    <article class="kpi pink"><div class="label">快照次数</div><div class="value">${data.snapshotCount || 0}</div></article>
  `;

  const stale = data.updatedAt && Date.now() - new Date(data.updatedAt).getTime() > 70 * 60 * 1000;
  if (!data.updatedAt) {
    stateEl.textContent = "还没有采集记录。本地登录 PHBS 后运行 npm run scrape。";
    stateEl.classList.add("show");
  } else if (stale) {
    stateEl.textContent = "超过约 1 小时没有新快照，多半是 Chrome 登录态失效。在工作文件夹运行 npm run login。";
    stateEl.classList.add("show");
  } else {
    stateEl.classList.remove("show");
  }

  destroyCharts();
  renderPicks(byKey, data.phaseSplitAt);

  gridEl.innerHTML = "";
  courses.forEach((course, i) => {
    const key = courseKey(course);
    const canvasId = `c${i}`;
    gridEl.appendChild(renderCard(course, state.colors.get(key), { canvasId }));
    drawChart(canvasId, course, state.colors.get(key), data.phaseSplitAt);
  });

  if (hottest?.enrolled != null) {
    document.title = `${hottest.zh} ${hottest.enrolled}/${hottest.capacity ?? "-"} · 选课看板`;
  }
}

function drawChart(id, course, color, phaseSplitAt) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === "undefined") return;
  const history = course.history || [];
  const labels = chartLabels(history);
  const enrolled = history.map((h) => h.enrolled);
  const capNow = course.capacity ?? history.at(-1)?.capacity ?? 0;
  const capLine = enrolled.length ? enrolled.map(() => capNow) : [capNow || null];
  const peak = Math.max(capNow || 0, ...enrolled.filter((n) => n != null));
  const yMax = niceYMax(peak);
  const last = Math.max(0, enrolled.length - 1);
  const lastOnly = enrolled.map((_, i) => (i === last ? 4 : 0));
  const split = splitIndex(history, phaseSplitAt);
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels.length ? labels : ["—"],
      datasets: [
        {
          label: "已选人数",
          data: enrolled.length ? enrolled : [null],
          borderColor: color,
          backgroundColor: color + "33",
          tension: 0.25,
          pointRadius: lastOnly,
          pointHoverRadius: lastOnly.map((r) => (r ? 6 : 0)),
          pointHitRadius: 10,
          pointBackgroundColor: "#fff",
          pointBorderColor: color,
          borderWidth: 3,
          spanGaps: true,
          fill: true,
        },
        {
          label: "名额上限",
          data: capLine,
          borderColor: "#c4b5fd",
          borderDash: [6, 6],
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, color: "#8b7396", font: { size: 10 } }, grid: { display: false } },
        y: {
          min: 0,
          max: yMax,
          ticks: {
            color: "#8b7396",
            font: { size: 10 },
            callback: (value) => (Number.isInteger(value) ? value : ""),
          },
          grid: { color: "rgba(124,92,252,0.08)" },
        },
      },
    },
    plugins: [phaseSplitPlugin(split)],
  });
  charts.set(id, chart);
}

function bind() {
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-pick]");
    if (!btn) return;
    event.preventDefault();
    togglePick(btn.getAttribute("data-pick"));
  });
  searchEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const q = searchEl.value.trim().toLowerCase();
    if (!q || !state.data) return;
    const hit = orderedCourses(state.data).find((c) => matchCourse(c, q));
    if (!hit) {
      stateEl.textContent = "没有匹配的课程。";
      stateEl.classList.add("show");
      setTimeout(() => { if (!state.data?.updatedAt || Date.now() - new Date(state.data.updatedAt).getTime() < 70 * 60 * 1000) stateEl.classList.remove("show"); }, 1800);
      return;
    }
    jumpTo(courseKey(hit));
  });
}

async function main() {
  bind();
  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    state.data = await res.json();
    render();
  } catch (err) {
    stateEl.textContent = `读取 data.json 失败：${err.message}`;
    stateEl.classList.add("show");
  }
}

main();
