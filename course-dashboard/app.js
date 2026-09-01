/* ==========================================================================
   PHBS 选课容量监控仪表盘 v1.1 - 核心交互与可视化引擎
   ========================================================================== */

// 语义化状态配色规范
const THEME = {
  critical: {
    stroke: "#e11d48",
    fillTop: "rgba(225, 29, 72, 0.18)",
    fillBottom: "rgba(225, 29, 72, 0.0)",
    pillClass: "pill-danger",
    cardClass: "card-danger",
    fillClass: "fill-danger",
    textClass: "color-danger",
  },
  caution: {
    stroke: "#d97706",
    fillTop: "rgba(217, 119, 6, 0.18)",
    fillBottom: "rgba(217, 119, 6, 0.0)",
    pillClass: "pill-warning",
    cardClass: "card-warning",
    fillClass: "fill-warning",
    textClass: "color-warning",
  },
  safe: {
    stroke: "#059669",
    fillTop: "rgba(5, 150, 105, 0.16)",
    fillBottom: "rgba(5, 150, 105, 0.0)",
    pillClass: "pill-success",
    cardClass: "card-success",
    fillClass: "fill-success",
    textClass: "color-success",
  },
};

let globalData = null;
let currentFilter = "all";
let currentSort = "default";
let searchQuery = "";
const chartInstances = new Map();

// DOM 元素
const dom = {
  stampTime: document.getElementById("stamp-time"),
  stampRel: document.getElementById("stamp-rel"),
  statusAlert: document.getElementById("status-alert"),
  kpiWatchVal: document.getElementById("kpi-watch-val"),
  kpiOverVal: document.getElementById("kpi-over-val"),
  kpiOverSub: document.getElementById("kpi-over-sub"),
  kpiOverBadge: document.getElementById("kpi-over-badge"),
  kpiHotVal: document.getElementById("kpi-hot-val"),
  kpiHotSub: document.getElementById("kpi-hot-sub"),
  kpiAvgVal: document.getElementById("kpi-avg-val"),
  kpiAvgSub: document.getElementById("kpi-avg-sub"),
  countAll: document.getElementById("count-all"),
  countCritical: document.getElementById("count-critical"),
  countCaution: document.getElementById("count-caution"),
  countSafe: document.getElementById("count-safe"),
  searchInput: document.getElementById("search-input"),
  clearSearch: document.getElementById("clear-search"),
  sortSelect: document.getElementById("sort-select"),
  filterTabs: document.getElementById("filter-tabs"),
  grid: document.getElementById("grid"),
  tbody: document.getElementById("tbody"),
};

// 时间格式化辅助
function fmtTime(iso) {
  if (!iso) return "暂无快照";
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
  if (mins < 1) return "刚刚同步 · 状态正常";
  if (mins < 60) return `${mins} 分钟前同步`;
  const hours = Math.floor(mins / 60);
  return `${hours} 小时前同步`;
}

function formatChartLabels(history) {
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

// 课程状态计算 (超容 / 紧张 / 充裕)
function getCourseStatus(course) {
  if (course.capacity == null || course.enrolled == null) return "safe";
  const pct = course.capacity > 0 ? (course.enrolled / course.capacity) * 100 : 0;
  if (course.enrolled > course.capacity) return "critical"; // 超过100%
  if (pct >= 75) return "caution"; // 75% ~ 100%
  return "safe"; // < 75%
}

// 渲染主仪表盘
function renderDashboard(data) {
  globalData = data;
  const watch = data.watch || [];

  // 1. 顶部时间
  dom.stampTime.textContent = fmtTime(data.updatedAt);
  dom.stampRel.textContent = relativeTime(data.updatedAt);

  // 2. 过期检查
  const isStale = data.updatedAt && Date.now() - new Date(data.updatedAt).getTime() > 20 * 60 * 1000;
  if (!data.updatedAt) {
    dom.statusAlert.textContent = "⚠️ 尚未获取到快照数据。等待后台定时任务采集或在本地运行 npm run scrape。";
    dom.statusAlert.classList.add("show");
  } else if (isStale) {
    dom.statusAlert.textContent = "⚠️ 超过 20 分钟未有新快照，本地登录态可能已过期。可运行 npm run login 重新登录。";
    dom.statusAlert.classList.add("show");
  } else {
    dom.statusAlert.classList.remove("show");
  }

  // 3. 计算统计指标
  let totalEnrolled = 0;
  let totalCapacity = 0;
  let criticalCount = 0;
  let cautionCount = 0;
  let safeCount = 0;
  let hottestCourse = null;
  let highestPct = -1;

  watch.forEach((c) => {
    const st = getCourseStatus(c);
    if (st === "critical") criticalCount++;
    else if (st === "caution") cautionCount++;
    else safeCount++;

    if (c.enrolled != null && c.capacity != null && c.capacity > 0) {
      totalEnrolled += c.enrolled;
      totalCapacity += c.capacity;
      const pct = (c.enrolled / c.capacity) * 100;
      if (pct > highestPct) {
        highestPct = pct;
        hottestCourse = { ...c, pct };
      }
    }
  });

  const avgFillRate = totalCapacity > 0 ? ((totalEnrolled / totalCapacity) * 100).toFixed(1) : "0.0";

  // KPI 赋值
  dom.kpiWatchVal.textContent = watch.length;

  dom.kpiOverVal.textContent = criticalCount;
  if (criticalCount > 0) {
    dom.kpiOverBadge.textContent = "需调整";
    dom.kpiOverBadge.className = "kpi-badge kpi-badge-danger";
    dom.kpiOverSub.textContent = `${criticalCount} 门课程超出额度上限`;
  } else {
    dom.kpiOverBadge.textContent = "正常";
    dom.kpiOverBadge.className = "kpi-badge kpi-badge-success";
    dom.kpiOverSub.textContent = "目前没有超容课程";
  }

  if (hottestCourse) {
    dom.kpiHotVal.textContent = `${hottestCourse.zh} (${hottestCourse.pct.toFixed(0)}%)`;
    dom.kpiHotSub.textContent = `已选 ${hottestCourse.enrolled} / 容量 ${hottestCourse.capacity} 人`;
  } else {
    dom.kpiHotVal.textContent = "—";
    dom.kpiHotSub.textContent = "暂无数据";
  }

  dom.kpiAvgVal.textContent = avgFillRate;
  dom.kpiAvgSub.textContent = `总已选 ${totalEnrolled} / 总容量 ${totalCapacity} 人`;

  // 4. 更新 Filter Counts
  dom.countAll.textContent = watch.length;
  dom.countCritical.textContent = criticalCount;
  dom.countCaution.textContent = cautionCount;
  dom.countSafe.textContent = safeCount;

  // 5. 应用筛选与渲染
  applyFilterAndRender();

  // 6. 更新页面 Title
  if (hottestCourse) {
    document.title = `${hottestCourse.zh} ${hottestCourse.enrolled}/${hottestCourse.capacity} (${hottestCourse.pct.toFixed(0)}%) · 选课仪表盘`;
  }
}

// 筛选与排序
function applyFilterAndRender() {
  if (!globalData || !globalData.watch) return;

  // 销毁旧图表避免重绘内存泄漏
  chartInstances.forEach((chart) => chart.destroy());
  chartInstances.clear();

  let list = [...globalData.watch];

  // 搜索关键字
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

  // 排序规则
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
        return 0;
    }
  });

  renderView(list);
}

// 渲染卡片与表格视图
function renderView(courses) {
  dom.grid.innerHTML = "";
  dom.tbody.innerHTML = "";

  if (courses.length === 0) {
    dom.grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 56px 20px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-card);">
        <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
        <div style="font-weight: 700; font-size: 15px; color: var(--text-main);">未找到匹配的课程</div>
        <div style="font-size: 12px; margin-top: 4px;">请尝试重置筛选标签或更换搜索关键词</div>
      </div>
    `;
    dom.tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 36px; color: var(--text-muted);">
          未检索到符合条件的课程明细
        </td>
      </tr>
    `;
    return;
  }

  courses.forEach((course, i) => {
    const status = getCourseStatus(course);
    const theme = THEME[status];
    const pct = course.capacity ? Math.round((course.enrolled / course.capacity) * 100) : 0;
    const pctClamped = Math.min(100, pct);
    const canvasId = `canvas-c-${i}-${Math.random().toString(36).substring(2, 6)}`;

    // 状态文案
    let pillHtml = "";
    let remHtml = "";
    if (status === "critical") {
      const overNum = (course.enrolled || 0) - (course.capacity || 0);
      pillHtml = `<span class="pill-badge ${theme.pillClass}">🔴 超容 +${overNum}</span>`;
      remHtml = `<span class="remain-text ${theme.textClass}">已超额 ${overNum} 人</span>`;
    } else if (status === "caution") {
      pillHtml = `<span class="pill-badge ${theme.pillClass}">🟡 紧张 · 余 ${course.remaining ?? 0}</span>`;
      remHtml = `<span class="remain-text ${theme.textClass}">仅剩 ${course.remaining ?? 0} 名额</span>`;
    } else {
      pillHtml = `<span class="pill-badge ${theme.pillClass}">🟢 充裕 · 余 ${course.remaining ?? 0}</span>`;
      remHtml = `<span class="remain-text ${theme.textClass}">剩余 ${course.remaining ?? 0} 名额</span>`;
    }

    // 课程标签
    const trackTag = course.note ? `<span class="track-tag">${course.note}</span>` : "";

    // 1. 卡片 HTML
    const card = document.createElement("article");
    card.className = `course-card ${theme.cardClass}`;
    card.innerHTML = `
      <div>
        <div class="card-top">
          <div class="card-title-box">
            <div class="card-title-row">
              <span class="card-name-zh">${course.zh}</span>
              ${trackTag}
            </div>
            <div class="card-name-en" title="${course.en}">${course.en}</div>
          </div>
          ${pillHtml}
        </div>

        <div class="card-metric-section">
          <div class="metric-row">
            <div class="enrolled-main">
              ${course.enrolled ?? "-"}<span class="capacity-sub"> / ${course.capacity ?? "-"} 人</span>
            </div>
            ${remHtml}
          </div>
          <div class="meter-track">
            <div class="meter-fill ${theme.fillClass}" style="width: ${pctClamped}%"></div>
          </div>
          <div class="card-meta-line">
            <span class="schedule-pill" title="${course.schedule}">${course.schedule ? "📅 " + course.schedule : "时间待定"}</span>
            <span class="rate-pct" style="color: ${theme.stroke}">${pct}% 占用</span>
          </div>
        </div>
      </div>

      <div class="chart-box">
        <canvas id="${canvasId}"></canvas>
      </div>
    `;
    dom.grid.appendChild(card);

    // 绘制 Chart.js
    drawChart(canvasId, course, status);

    // 2. 表格行 HTML
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="td-course-zh">${course.zh}</div>
        <div class="td-course-en">${course.en}</div>
      </td>
      <td>${trackTag || "—"}</td>
      <td>${pillHtml}</td>
      <td style="font-weight: 800;">${course.enrolled ?? "-"}</td>
      <td style="color: var(--text-muted);">${course.capacity ?? "-"}</td>
      <td style="font-weight: 700;">${course.remaining ?? "-"}</td>
      <td>
        <div class="td-meter-wrap">
          <div class="td-meter">
            <span style="width: ${pctClamped}%; background: ${theme.stroke}"></span>
          </div>
          <span style="font-weight: 700; font-size: 11px; color: ${theme.stroke}; min-width: 36px;">${pct}%</span>
        </div>
      </td>
      <td style="font-size: 11.5px; color: var(--text-body);">${course.schedule || "—"}</td>
    `;
    dom.tbody.appendChild(tr);
  });
}

// 绘制 Chart.js 折线图
function drawChart(canvasId, course, status) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  const history = course.history || [];
  const labels = formatChartLabels(history);
  const enrolledData = history.map((h) => h.enrolled);
  const capData = history.map((h) => h.capacity);
  const theme = THEME[status];

  // 面积平滑渐变
  const gradient = ctx.createLinearGradient(0, 0, 0, 130);
  gradient.addColorStop(0, theme.fillTop);
  gradient.addColorStop(1, theme.fillBottom);

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels.length ? labels : ["最新"],
      datasets: [
        {
          label: "已选人数",
          data: enrolledData.length ? enrolledData : [course.enrolled ?? null],
          borderColor: theme.stroke,
          backgroundColor: gradient,
          tension: 0.28,
          pointRadius: history.length > 10 ? 1.5 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: theme.stroke,
          pointBorderWidth: 2,
          borderWidth: 2.2,
          spanGaps: true,
          fill: true,
          order: 1,
        },
        {
          label: "名额上限",
          data: capData.length ? capData : [course.capacity ?? null],
          borderColor: "#cbd5e1",
          borderDash: [4, 4],
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
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          titleFont: { size: 11, weight: "700" },
          bodyFont: { size: 11 },
          padding: 8,
          cornerRadius: 6,
          displayColors: true,
          boxPadding: 3,
          callbacks: {
            title: function (items) {
              return items[0] ? `快照时间：${items[0].label}` : "";
            },
            label: function (ctx) {
              const val = ctx.raw;
              if (ctx.datasetIndex === 0) {
                const cap = course.capacity;
                const pct = cap ? ((val / cap) * 100).toFixed(1) : 0;
                return `已选：${val} 人 (${pct}%)`;
              } else {
                return `上限：${val} 人 (余 ${course.remaining ?? "-"} 名额)`;
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
            maxTicksLimit: 4,
            color: "#94a3b8",
            font: { size: 9.5, family: "inherit" },
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          display: true,
          ticks: {
            color: "#94a3b8",
            font: { size: 9.5, family: "inherit" },
            maxTicksLimit: 3,
            callback: function(val) {
              return Number.isInteger(val) ? val : "";
            }
          },
          grid: {
            color: "rgba(226, 232, 240, 0.7)",
            drawBorder: false,
          },
          border: { display: false },
        },
      },
    },
  });

  chartInstances.set(canvasId, chart);
}

// 事件绑定
function initEvents() {
  // 1. Tab 切换
  dom.filterTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    const filter = btn.getAttribute("data-filter");
    if (filter === currentFilter) return;

    dom.filterTabs.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = filter;
    applyFilterAndRender();
  });

  // 2. 搜索
  dom.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    if (searchQuery) {
      dom.clearSearch.classList.add("show");
    } else {
      dom.clearSearch.classList.remove("show");
    }
    applyFilterAndRender();
  });

  // 3. 清空搜索
  dom.clearSearch.addEventListener("click", () => {
    dom.searchInput.value = "";
    searchQuery = "";
    dom.clearSearch.classList.remove("show");
    dom.searchInput.focus();
    applyFilterAndRender();
  });

  // 4. 排序
  dom.sortSelect.addEventListener("change", (e) => {
    currentSort = e.target.value;
    applyFilterAndRender();
  });
}

// 初始化加载
async function init() {
  initEvents();
  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDashboard(data);
  } catch (err) {
    dom.statusAlert.textContent = `❌ 数据加载失败：${err.message}`;
    dom.statusAlert.classList.add("show");
  }
}

init();
