const TZ = "Asia/Shanghai";
const charts = new Map();
const ui = {
  liveCard: document.getElementById("liveCard"),
  liveLabel: document.getElementById("liveLabel"),
  liveTime: document.getElementById("liveTime"),
  liveRel: document.getElementById("liveRel"),
  termChip: document.getElementById("termChip"),
  subtitle: document.getElementById("subtitle"),
  banner: document.getElementById("banner"),
  metrics: document.getElementById("metrics"),
  filters: document.getElementById("filters"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  grid: document.getElementById("grid"),
  tbody: document.getElementById("tbody"),
};

const state = {
  data: null,
  filter: "all",
  query: "",
  sort: "default",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function occupancy(course) {
  if (course?.capacity == null || course?.enrolled == null || !course.capacity) return 0;
  return course.enrolled / course.capacity;
}

function occupancyPct(course) {
  return Math.round(occupancy(course) * 100);
}

function statusOf(course) {
  const pct = occupancy(course) * 100;
  if (course?.capacity == null || course?.enrolled == null) return "ok";
  if (pct > 100) return "over";
  if (pct >= 75) return "tight";
  return "ok";
}

function remainingOf(course) {
  if (course?.capacity == null || course?.enrolled == null) return null;
  return course.remaining ?? course.capacity - course.enrolled;
}

function noteTags(note) {
  if (!note) return [];
  return String(note).split(/[&/,，]+/).map((s) => s.trim()).filter(Boolean);
}

function hexAlpha(hex, alpha) {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function statusColor(kind) {
  return { over: "#e11d48", tight: "#d97706", ok: "#059669" }[kind] || "#059669";
}

function fmtStamp(iso) {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${g.month}/${g.day} ${g.hour}:${g.minute}`;
}

function chartLabel(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${Number(g.month)}/${Number(g.day)} ${g.hour}:${g.minute}`;
}

function relativeSync(iso) {
  if (!iso) return "尚未采集";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "刚刚同步";
  if (mins < 60) return `${mins} 分钟前同步`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} 小时前同步`;
  const days = Math.round(hours / 24);
  return `${days} 天前同步`;
}

function niceScale(maxValue) {
  const padded = Math.max(10, maxValue * 1.08);
  const rough = padded / 4;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(rough))));
  const residual = rough / mag;
  let step = mag;
  if (residual <= 1) step = mag;
  else if (residual <= 2) step = 2 * mag;
  else if (residual <= 5) step = 5 * mag;
  else step = 10 * mag;
  step = Math.max(1, Math.round(step));
  const max = Math.ceil(padded / step) * step;
  return { min: 0, max, step };
}

function destroyCharts() {
  for (const chart of charts.values()) {
    try { chart.destroy(); } catch { /* ignore */ }
  }
  charts.clear();
}

function pillText(course) {
  const kind = statusOf(course);
  const rem = remainingOf(course);
  if (kind === "over") return `超容 +${Math.abs(rem ?? 0)}`;
  if (kind === "tight") return `紧张 · 余 ${rem ?? "—"}`;
  return `充裕 · 余 ${rem ?? "—"}`;
}

function remainText(course) {
  const rem = remainingOf(course);
  if (rem == null) return "余量未知";
  if (rem < 0) return `已超额 ${Math.abs(rem)} 人`;
  return `剩余 ${rem} 名额`;
}

function matchesQuery(course, query) {
  if (!query) return true;
  const blob = [course.zh, course.en, course.schedule, course.note, ...noteTags(course.note)]
    .join(" ")
    .toLowerCase();
  return blob.includes(query);
}

function decorate(watch) {
  return watch.map((course, index) => ({
    ...course,
    _i: index,
    _occ: occupancy(course),
    _status: statusOf(course),
    _rem: remainingOf(course),
  }));
}

function counts(watch) {
  return {
    all: watch.length,
    over: watch.filter((c) => c._status === "over").length,
    tight: watch.filter((c) => c._status === "tight").length,
    ok: watch.filter((c) => c._status === "ok").length,
  };
}

function visibleCourses(watch) {
  let rows = watch.filter((c) => {
    if (state.filter !== "all" && c._status !== state.filter) return false;
    return matchesQuery(c, state.query);
  });
  const sorters = {
    occupancy: (a, b) => b._occ - a._occ || a._i - b._i,
    remaining: (a, b) => {
      const ar = a._rem ?? Number.POSITIVE_INFINITY;
      const br = b._rem ?? Number.POSITIVE_INFINITY;
      return ar - br || a._i - b._i;
    },
    enrolled: (a, b) => (b.enrolled ?? -1) - (a.enrolled ?? -1) || a._i - b._i,
    name: (a, b) => String(a.zh || "").localeCompare(String(b.zh || ""), "zh-CN") || a._i - b._i,
    default: (a, b) => a._i - b._i,
  };
  rows.sort(sorters[state.sort] || sorters.default);
  return rows;
}

function renderLive(data) {
  const iso = data.updatedAt;
  const stale = iso && Date.now() - new Date(iso).getTime() > 20 * 60 * 1000;
  ui.liveTime.textContent = fmtStamp(iso);
  ui.liveRel.textContent = relativeSync(iso);
  ui.liveCard.classList.toggle("is-stale", Boolean(stale));
  ui.liveCard.classList.toggle("is-wait", !iso);
  if (!iso) {
    ui.liveLabel.textContent = "等待首次采集";
  } else if (stale) {
    ui.liveLabel.textContent = "同步延迟";
  } else {
    ui.liveLabel.textContent = "实时监控中";
  }

  if (!iso) {
    ui.banner.hidden = false;
    ui.banner.textContent = "还没有采集记录。本地登录 PHBS 后运行 npm run scrape，或等待 LaunchAgent 第一次成功。";
  } else if (stale) {
    ui.banner.hidden = false;
    ui.banner.textContent = "超过 20 分钟没有新快照，多半是 Chrome 登录态失效。在工作文件夹运行 npm run login。";
  } else {
    ui.banner.hidden = true;
  }
}

function renderMetrics(watch, data) {
  const n = watch.length;
  const over = watch.filter((c) => c._status === "over").length;
  const hottest = [...watch].sort((a, b) => b._occ - a._occ || (b.enrolled || 0) - (a.enrolled || 0))[0];
  const enrolledSum = watch.reduce((s, c) => s + (c.enrolled || 0), 0);
  const capSum = watch.reduce((s, c) => s + (c.capacity || 0), 0);
  const avg = capSum ? ((enrolledSum / capSum) * 100).toFixed(1) : "—";
  const hottestLabel = hottest ? `${hottest.zh} (${occupancyPct(hottest)}%)` : "—";
  const hottestHint = hottest?.enrolled != null
    ? `${hottest.enrolled} / ${hottest.capacity} 人`
    : "暂无容量数据";

  ui.subtitle.textContent = `实时监控 ${n} 门重点课程的已选人数、剩余余量与历史增长趋势`;
  const tableHint = document.getElementById("tableHint");
  if (tableHint) tableHint.textContent = `${n} 门重点课的占用、余量与上课时间`;
  ui.metrics.innerHTML = `
    <article class="metric">
      <div class="label">关注课程</div>
      <div class="value">${n} 门</div>
      <div class="hint">全选课轮次共 ${data.courseCount || 0} 门</div>
    </article>
    <article class="metric${over > 0 ? " warn" : ""}">
      <div class="label">超容预警</div>
      <div class="value">${over} 门超容</div>
      <div class="hint">${over > 0 ? "占用已超过名额上限" : "当前没有课程超容"}</div>
    </article>
    <article class="metric">
      <div class="label">最抢手课程</div>
      <div class="value" title="${esc(hottestLabel)}">${esc(hottestLabel)}</div>
      <div class="hint">${esc(hottestHint)}</div>
    </article>
    <article class="metric">
      <div class="label">关注平均占用率</div>
      <div class="value">${avg}%</div>
      <div class="hint">总已选 ${enrolledSum} / 总容量 ${capSum}</div>
    </article>
  `;
}

function renderFilters(watch) {
  const c = counts(watch);
  const items = [
    ["all", `全部课程 (${c.all})`, ""],
    ["over", `已超容 (${c.over})`, "over"],
    ["tight", `紧张 (≥75%) (${c.tight})`, "tight"],
    ["ok", `充裕 (<75%) (${c.ok})`, "ok"],
  ];
  ui.filters.innerHTML = items.map(([key, label, klass]) => `
    <button type="button" class="seg-btn ${klass}" data-filter="${key}" role="tab" aria-pressed="${state.filter === key}">${label}</button>
  `).join("");
}

function renderCards(rows) {
  destroyCharts();
  ui.grid.innerHTML = "";
  if (!rows.length) {
    ui.grid.innerHTML = `<div class="empty">没有符合筛选条件的课程</div>`;
    return;
  }

  rows.forEach((course, i) => {
    const kind = course._status;
    const pct = occupancyPct(course);
    const barPct = Math.min(100, pct);
    const tags = noteTags(course.note).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const canvasId = `chart-${i}`;
    const card = document.createElement("article");
    card.className = `card is-${kind}`;
    card.innerHTML = `
      <div class="card-head">
        <div style="min-width:0">
          <div class="zh">${esc(course.zh)}</div>
          <div class="en">${esc(course.en)}</div>
          <div class="tags">${tags}</div>
        </div>
        <span class="pill ${kind}">${esc(pillText(course))}</span>
      </div>
      <div class="stats">
        <div class="num">${course.enrolled ?? "—"}<span>/ 容量 ${course.capacity ?? "—"} 人</span></div>
        <div class="remain ${kind}">${esc(remainText(course))}</div>
      </div>
      <div class="track"><i class="${kind}" style="width:${barPct}%"></i></div>
      <div class="meta-row">
        <span class="when">${course.schedule ? `<svg class="ico-cal" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="2" y="3.2" width="12" height="10.3" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.4h12M5.4 2v3M10.6 2v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>${esc(course.schedule)}` : "上课时间未公布"}</span>
        <span class="occ">${pct}% 占用</span>
      </div>
      <div class="chart"><canvas id="${canvasId}"></canvas></div>
    `;
    ui.grid.appendChild(card);
    drawChart(canvasId, course);
  });
}

function renderTable(rows) {
  ui.tbody.innerHTML = "";
  rows.forEach((course) => {
    const kind = course._status;
    const pct = occupancyPct(course);
    const rem = course._rem;
    const remHtml = rem == null
      ? "—"
      : rem < 0
        ? `<span class="neg">超额 ${Math.abs(rem)}</span>`
        : `<span class="pos">${rem}</span>`;
    const tags = noteTags(course.note).map((t) => `<span class="tag">${esc(t)}</span>`).join("") || "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(course.zh)}<div class="en">${esc(course.en)}</div></td>
      <td>${tags}</td>
      <td><span class="pill ${kind}">${esc(pillText(course))}</span></td>
      <td>${course.enrolled ?? "—"}</td>
      <td>${course.capacity ?? "—"}</td>
      <td>${remHtml}</td>
      <td>
        <div class="cell-bar">
          <div class="track"><i class="${kind}" style="width:${Math.min(100, pct)}%"></i></div>
          <span>${pct}%</span>
        </div>
      </td>
      <td>${esc(course.schedule || "—")}</td>
    `;
    ui.tbody.appendChild(tr);
  });
}

const crosshair = {
  id: "crosshair",
  afterDraw(chart) {
    const tooltip = chart.tooltip;
    if (!tooltip?.getActiveElements?.().length) return;
    const { ctx, chartArea } = chart;
    const x = tooltip.caretX;
    const y = tooltip.caretY;
    ctx.save();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
};

function drawChart(id, course) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === "undefined") return;
  const history = course.history || [];
  const labels = history.map((h) => chartLabel(h.t));
  const enrolled = history.map((h) => h.enrolled);
  const cap = history.map((h) => h.capacity);
  const color = statusColor(course._status);
  const peak = Math.max(0, ...enrolled.filter((n) => n != null), ...cap.filter((n) => n != null));
  const scale = niceScale(peak);

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels.length ? labels : ["—"],
      datasets: [
        {
          label: "已选人数",
          data: enrolled.length ? enrolled : [null],
          borderColor: color,
          backgroundColor: (ctx) => {
            const area = ctx.chart.chartArea;
            if (!area) return hexAlpha(color, 0.16);
            const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, hexAlpha(color, 0.17));
            g.addColorStop(1, hexAlpha(color, 0));
            return g;
          },
          tension: 0.28,
          fill: true,
          borderWidth: 2.2,
          pointRadius: history.length > 10 ? 0 : 2.4,
          pointHoverRadius: 4.5,
          pointBackgroundColor: "#fff",
          pointBorderColor: color,
          pointBorderWidth: 1.6,
          spanGaps: true,
        },
        {
          label: "名额上限",
          data: cap.length ? cap : [null],
          borderColor: "#94a3b8",
          borderDash: [4, 4],
          pointRadius: 0,
          borderWidth: 1.4,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => items[0]?.label || "",
            label: (item) => {
              const point = history[item.dataIndex];
              if (!point) return "";
              const pct = point.capacity ? Math.round((point.enrolled / point.capacity) * 100) : 0;
              const rem = point.remaining ?? (point.capacity - point.enrolled);
              return [
                `已选 ${point.enrolled}（${pct}%）`,
                `名额上限 ${point.capacity}`,
                rem < 0 ? `已超额 ${Math.abs(rem)}` : `剩余 ${rem}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6, color: "#94a3b8", font: { size: 10 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          min: scale.min,
          max: scale.max,
          ticks: {
            stepSize: scale.step,
            color: "#94a3b8",
            font: { size: 10 },
            callback: (value) => (Number.isInteger(value) ? value : ""),
          },
          grid: { color: "rgba(226, 232, 240, 0.9)" },
          border: { display: false },
        },
      },
    },
    plugins: [crosshair],
  });
  charts.set(id, chart);
}

function render() {
  const data = state.data;
  if (!data) return;
  const watch = decorate(data.watch || []);
  renderLive(data);
  renderMetrics(watch, data);
  renderFilters(watch);
  const rows = visibleCourses(watch);
  renderCards(rows);
  renderTable(rows);

  const hottest = [...watch].sort((a, b) => b._occ - a._occ)[0];
  if (hottest?.enrolled != null) {
    document.title = `${hottest.zh} ${hottest.enrolled}/${hottest.capacity ?? "—"} · 选课看板`;
  }
}

function bind() {
  ui.filters.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.getAttribute("data-filter");
    render();
  });
  ui.search.addEventListener("input", () => {
    state.query = ui.search.value.trim().toLowerCase();
    render();
  });
  ui.sort.addEventListener("change", () => {
    state.sort = ui.sort.value;
    render();
  });
  setInterval(() => {
    if (state.data) renderLive(state.data);
  }, 30000);
}

async function main() {
  bind();
  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    state.data = await res.json();
    const title = state.data.moduleTitle || "26-27 Fall I";
    ui.termChip.textContent = title.includes("2026") ? title : "2026-2027 Fall I";
    render();
  } catch (err) {
    ui.banner.hidden = false;
    ui.banner.textContent = `读取 data.json 失败：${err.message}`;
  }
}

main();
