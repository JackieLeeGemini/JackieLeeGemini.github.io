/* ==========================================================================
   PHBS 选课容量看板 v1.1 - 核心交互与数据可视化逻辑
   ========================================================================== */

// 语义化色彩常量
const STATUS_COLORS = {
  critical: {
    stroke: "#f43f5e",
    fillTop: "rgba(244, 63, 94, 0.35)",
    fillBottom: "rgba(244, 63, 94, 0.01)",
    text: "#9f1239",
    bg: "#fff1f2",
  },
  caution: {
    stroke: "#f59e0b",
    fillTop: "rgba(245, 158, 11, 0.32)",
    fillBottom: "rgba(245, 158, 11, 0.01)",
    text: "#92400e",
    bg: "#fffbeb",
  },
  safe: {
    stroke: "#10b981",
    fillTop: "rgba(16, 185, 129, 0.30)",
    fillBottom: "rgba(16, 185, 129, 0.01)",
    text: "#065f46",
    bg: "#ecfdf5",
  },
};

// 状态与过滤
let globalData = null;
let currentFilter = "all";
let currentSort = "default";
let searchQuery = "";
const chartInstances = new Map();

// DOM 元素引用
const dom = {
  stampTime: document.getElementById("stamp-time"),
  stampRel: document.getElementById("stamp-rel"),
  statusBanner: document.getElementById("status"),
  kpiWatchVal: document.getElementById("kpi-watch-val"),
  kpiWatchSub: document.getElementById("kpi-watch-sub"),
  kpiOverVal: document.getElementById("kpi-over-val"),
  kpiOverSub: document.getElementById("kpi-over-sub"),
  kpiHotVal: document.getElementById("kpi-hot-val"),
  kpiHotSub: document.getElementById("kpi-hot-sub"),
  kpiAvgVal: document.getElementById("kpi-avg-val"),
  kpiAvgSub: document.getElementById("kpi-avg-sub"),
  countAll: document.getElementById("count-all"),
  countOver: document.getElementById("count-over"),
  countCaution: document.getElementById("count-caution"),
  countSafe: document.getElementById("count-safe"),
  searchInput: document.getElementById("search-input"),
  clearSearch: document.getElementById("clear-search"),
  sortSelect: document.getElementById("sort-select"),
  filterChips: document.getElementById("filter-chips"),
  grid: document.getElementById("grid"),
  tbody: document.getElementById("tbody"),
};

// 时间格式化辅助
function fmtTime(iso) {
  if (!iso) return "暂无数据";
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

function relativeTime(iso) {
  if (!iso) return "等待首次采集";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "刚刚更新 · 自动同步";
  if (mins < 60) return `${mins} 分钟前 · 自动同步`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} 小时 ${remMins} 分前 · 自动同步`;
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

// 课程状态计算
function getCourseStatus(course) {
  if (course.capacity == null || course.enrolled == null) return "safe";
  const pct = course.capacity > 0 ? (course.enrolled / course.capacity) * 100 : 0;
  if (course.enrolled > course.capacity) return "critical"; // 超容
  if (pct >= 75) return "caution"; // 紧张 (>=75%)
  return "safe"; // 充裕
}

// 渲染全部数据
function renderDashboard(data) {
  globalData = data;
  const watch = data.watch || [];

  // 1. 顶部时间与状态戳
  dom.stampTime.textContent = fmtTime(data.updatedAt);
  dom.stampRel.textContent = relativeTime(data.updatedAt);

  // 2. 检查是否有过期状态告警
  const isStale = data.updatedAt && Date.now() - new Date(data.updatedAt).getTime() > 20 * 60 * 1000;
  if (!data.updatedAt) {
    dom.statusBanner.textContent = "⚠️ 尚未收到快照记录。请在本地登录 PHBS 后运行 npm run scrape 或等待 LaunchAgent 定时执行。";
    dom.statusBanner.classList.add("show");
  } else if (isStale) {
    dom.statusBanner.textContent = "⚠️ 超过 20 分钟未更新，可能是本地 Chrome 登录态失效。可在项目目录运行 npm run login 重新登录。";
    dom.statusBanner.classList.add("show");
  } else {
    dom.statusBanner.classList.remove("show");
  }

  // 3. 计算业务 KPI
  let totalEnrolled = 0;
  let totalCap = 0;
  let overCount = 0;
  let cautionCount = 0;
  let safeCount = 0;
  let hottestCourse = null;
  let maxPct = -1;

  watch.forEach((c) => {
    const status = getCourseStatus(c);
    if (status === "critical") overCount++;
    else if (status === "caution") cautionCount++;
    else safeCount++;

    if (c.enrolled != null && c.capacity != null && c.capacity > 0) {
      totalEnrolled += c.enrolled;
      totalCap += c.capacity;
      const pct = (c.enrolled / c.capacity) * 100;
      if (pct > maxPct) {
        maxPct = pct;
        hottestCourse = { ...c, pct };
      }
    }
  });

  const avgFillRate = totalCap > 0 ? ((totalEnrolled / totalCap) * 100).toFixed(1) : "0.0";

  // KPI 渲染
  dom.kpiWatchVal.textContent = `${watch.length} 门`;
  dom.kpiWatchSub.textContent = `全轮次共 ${data.courseCount || 37} 门`;

  dom.kpiOverVal.textContent = `${overCount} 门`;
  dom.kpiOverSub.textContent = overCount > 0 ? "需重点留意/调整" : "当前无超容课程";

  if (hottestCourse) {
    dom.kpiHotVal.textContent = `${hottestCourse.zh} (${hottestCourse.pct.toFixed(0)}%)`;
    dom.kpiHotSub.textContent = `已选 ${hottestCourse.enrolled}/${hottestCourse.capacity} · 负荷最高`;
  } else {
    dom.kpiHotVal.textContent = "—";
    dom.kpiHotSub.textContent = "暂无数据";
  }

  dom.kpiAvgVal.textContent = `${avgFillRate}%`;
  dom.kpiAvgSub.textContent = `已选 ${totalEnrolled} / 总额 ${totalCap}`;

  // 4. 更新 Filter Chip 计数
  dom.countAll.textContent = watch.length;
  dom.countOver.textContent = overCount;
  dom.countCaution.textContent = cautionCount;
  dom.countSafe.textContent = safeCount;

  // 5. 应用筛选与排序并渲染列表
  applyFilterAndRender();

  // 6. 网页标题
  if (hottestCourse) {
    document.title = `${hottestCourse.zh} ${hottestCourse.enrolled}/${hottestCourse.capacity} (${hottestCourse.pct.toFixed(0)}%) · 选课看板`;
  }
}

// 筛选与排序过滤
function applyFilterAndRender() {
  if (!globalData || !globalData.watch) return;

  // 清除旧的图表实例
  chartInstances.forEach((chart) => chart.destroy());
  chartInstances.clear();

  let list = [...globalData.watch];

  // 搜索关键字过滤
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter((c) => {
      return (
        (c.zh && c.zh.toLowerCase().includes(q)) ||
        (c.en && c.en.toLowerCase().includes(q)) ||
        (c.schedule && c.schedule.toLowerCase().includes(q)) ||
        (c.note && c.note.toLowerCase().includes(q))
      );
    });
  }

  // 状态筛选
  if (currentFilter !== "all") {
    list = list.filter((c) => getCourseStatus(c) === currentFilter);
  }

  // 排序
  list.sort((a, b) => {
    const pctA = a.capacity ? (a.enrolled / a.capacity) * 100 : 0;
    const pctB = b.capacity ? (b.enrolled / b.capacity) * 100 : 0;

    switch (currentSort) {
      case "fill-desc":
        return pctB - pctA;
      case "remaining-asc":
        return (a.remaining ?? 999) - (b.remaining ?? 999);
      case "enrolled-desc":
        return (b.enrolled ?? 0) - (a.enrolled ?? 0);
      case "name-asc":
        return (a.zh || "").localeCompare(b.zh || "", "zh-CN");
      case "default":
      default:
        return 0; // 保持 watchlist 默认顺序
    }
  });

  renderCardsAndTable(list);
}

// 渲染卡片与表格
function renderCardsAndTable(courses) {
  dom.grid.innerHTML = "";
  dom.tbody.innerHTML = "";

  if (courses.length === 0) {
    dom.grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--text-muted); background: var(--surface); border-radius: var(--radius-xl); border: 1px dashed var(--border-subtle);">
        <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
        <div style="font-weight: 700; font-size: 15px; color: var(--text-secondary);">没有找到符合条件的课程</div>
        <div style="font-size: 12px; margin-top: 4px;">请尝试更换搜索词或筛选标签</div>
      </div>
    `;
    dom.tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 32px; color: var(--text-muted);">
          没有找到符合条件的课程记录
        </td>
      </tr>
    `;
    return;
  }

  courses.forEach((course, index) => {
    const status = getCourseStatus(course);
    const pct = course.capacity ? Math.round((course.enrolled / course.capacity) * 100) : 0;
    const pctClamped = Math.min(100, pct);
    const canvasId = `chart-${index}-${Math.random().toString(36).substr(2, 6)}`;

    // 状态文案与 Pill 样式
    let statusPillHtml = "";
    let remHtml = "";
    if (status === "critical") {
      const overNum = (course.enrolled || 0) - (course.capacity || 0);
      statusPillHtml = `<span class="status-pill pill-critical">🔴 超容 +${overNum}</span>`;
      remHtml = `<span class="stats-remaining rem-critical">已超容 ${overNum} 人</span>`;
    } else if (status === "caution") {
      statusPillHtml = `<span class="status-pill pill-caution">🟡 紧张 · 余 ${course.remaining ?? 0}</span>`;
      remHtml = `<span class="stats-remaining rem-caution">仅剩 ${course.remaining ?? 0} 名额</span>`;
    } else {
      statusPillHtml = `<span class="status-pill pill-safe">🟢 充裕 · 余 ${course.remaining ?? 0}</span>`;
      remHtml = `<span class="stats-remaining rem-safe">剩余 ${course.remaining ?? 0} 名额</span>`;
    }

    // 课程标签 (Note/Tag)
    const noteBadge = course.note ? `<span class="tag-badge">${course.note}</span>` : "";

    // 1. 卡片 HTML 构建
    const card = document.createElement("article");
    card.className = `card status-${status}`;
    card.innerHTML = `
      <div>
        <div class="card-header">
          <div class="card-title-group">
            <div class="card-zh-row">
              <span class="card-zh">${course.zh}</span>
              ${noteBadge}
            </div>
            <div class="card-en" title="${course.en}">${course.en}</div>
          </div>
          ${statusPillHtml}
        </div>

        <div class="card-stats">
          <div class="stats-row">
            <div class="stats-main">
              ${course.enrolled ?? "-"}<span class="stats-cap"> / ${course.capacity ?? "-"} 人</span>
            </div>
            ${remHtml}
          </div>
          <div class="progress-track">
            <div class="progress-fill fill-${status}" style="width: ${pctClamped}%"></div>
          </div>
          <div class="card-meta">
            <span class="meta-schedule">${course.schedule ? "📅 " + course.schedule : "待定"}</span>
            <span class="meta-pct" style="color: ${STATUS_COLORS[status].stroke}">${pct}% 占用</span>
          </div>
        </div>
      </div>

      <div class="card-chart">
        <canvas id="${canvasId}"></canvas>
      </div>
    `;
    dom.grid.appendChild(card);

    // 绘制 Chart.js
    drawChart(canvasId, course, status);

    // 2. 表格行 HTML 构建
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="tbl-course-title">${course.zh}</div>
        <div class="tbl-course-en">${course.en}</div>
      </td>
      <td>${noteBadge || "—"}</td>
      <td>${statusPillHtml}</td>
      <td style="font-weight: 700;">${course.enrolled ?? "-"}</td>
      <td style="color: var(--text-secondary);">${course.capacity ?? "-"}</td>
      <td style="font-weight: 700;">${course.remaining ?? "-"}</td>
      <td>
        <div class="tbl-bar-wrap">
          <div class="tbl-bar">
            <span class="fill-${status}" style="width: ${pctClamped}%; background: ${STATUS_COLORS[status].stroke}"></span>
          </div>
          <span class="tbl-pct" style="color: ${STATUS_COLORS[status].stroke}">${pct}%</span>
        </div>
      </td>
      <td style="font-size: 12px; color: var(--text-secondary);">${course.schedule || "—"}</td>
    `;
    dom.tbody.appendChild(tr);
  });
}

// 绘制单个 Chart.js 图表
function drawChart(canvasId, course, status) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const history = course.history || [];
  const labels = chartLabels(history);
  const enrolledData = history.map((h) => h.enrolled);
  const capData = history.map((h) => h.capacity);
  const colorCfg = STATUS_COLORS[status];

  // 动态创建面积渐变
  const gradient = ctx.createLinearGradient(0, 0, 0, 145);
  gradient.addColorStop(0, colorCfg.fillTop);
  gradient.addColorStop(1, colorCfg.fillBottom);

  // Y 轴自适应区间计算
  const maxVal = Math.max(...enrolledData.filter((v) => v != null), course.capacity || 50, 10);
  const yMax = Math.ceil(maxVal * 1.15);

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels.length ? labels : ["暂无"],
      datasets: [
        {
          label: "已选人数",
          data: enrolledData.length ? enrolledData : [course.enrolled ?? null],
          borderColor: colorCfg.stroke,
          backgroundColor: gradient,
          tension: 0.28,
          pointRadius: history.length > 10 ? 2 : 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: colorCfg.stroke,
          pointBorderWidth: 2,
          borderWidth: 2.5,
          spanGaps: true,
          fill: true,
          order: 1,
        },
        {
          label: "名额上限",
          data: capData.length ? capData : [course.capacity ?? null],
          borderColor: "#94a3b8",
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false,
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          titleFont: { size: 11, weight: "700" },
          bodyFont: { size: 11 },
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          boxPadding: 4,
          callbacks: {
            title: function (items) {
              return items[0] ? `时间：${items[0].label}` : "";
            },
            label: function (ctx) {
              const val = ctx.raw;
              if (ctx.datasetIndex === 0) {
                const cap = course.capacity;
                const pct = cap ? ((val / cap) * 100).toFixed(1) : 0;
                return `已选：${val} 人 (${pct}%)`;
              } else {
                return `容量：${val} 人 (剩余 ${course.remaining ?? "-"} 名额)`;
              }
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 5,
            color: "#94a3b8",
            font: { size: 10, family: "inherit" },
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          max: yMax,
          ticks: {
            color: "#94a3b8",
            font: { size: 10, family: "inherit" },
            maxTicksLimit: 4,
          },
          grid: {
            color: "rgba(226, 232, 240, 0.6)",
            drawBorder: false,
          },
          border: { display: false },
        },
      },
    },
  });

  chartInstances.set(canvasId, chart);
}

// 绑定事件监听
function bindEvents() {
  // 1. Filter Chips 切换
  dom.filterChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const filter = btn.getAttribute("data-filter");
    if (filter === currentFilter) return;

    dom.filterChips.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = filter;
    applyFilterAndRender();
  });

  // 2. 搜索框输入
  dom.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    if (searchQuery) {
      dom.clearSearch.classList.add("show");
    } else {
      dom.clearSearch.classList.remove("show");
    }
    applyFilterAndRender();
  });

  // 3. 清除搜索
  dom.clearSearch.addEventListener("click", () => {
    dom.searchInput.value = "";
    searchQuery = "";
    dom.clearSearch.classList.remove("show");
    dom.searchInput.focus();
    applyFilterAndRender();
  });

  // 4. 排序下拉
  dom.sortSelect.addEventListener("change", (e) => {
    currentSort = e.target.value;
    applyFilterAndRender();
  });
}

// 主加载入口
async function main() {
  bindEvents();
  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDashboard(data);
  } catch (err) {
    dom.statusBanner.textContent = `❌ 读取数据失败：${err.message}`;
    dom.statusBanner.classList.add("show");
  }
}

main();
