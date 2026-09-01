const COLORS = ["#ff6b9d", "#9b6dff", "#3ee0c0", "#6aa8ff", "#ffd36e", "#ff7a59", "#c084fc", "#34d399", "#fb7185", "#22d3ee", "#f472b6", "#a3e635"];

const stateEl = document.getElementById("status");
const stampEl = document.getElementById("stamp");
const kpisEl = document.getElementById("kpis");
const gridEl = document.getElementById("grid");
const tbodyEl = document.getElementById("tbody");

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

function render(data) {
  const watch = data.watch || [];
  const over = watch.filter((c) => c.capacity != null && c.enrolled != null && c.enrolled > c.capacity).length;
  const hottest = [...watch].sort((a, b) => (b.enrolled || 0) - (a.enrolled || 0))[0];

  stampEl.innerHTML = `<b>${fmtTime(data.updatedAt)}</b><span>${relative(data.updatedAt)} · 北京时间</span>`;
  kpisEl.innerHTML = `
    <article class="kpi grape"><div class="label">关注课程</div><div class="value">${watch.length}</div></article>
    <article class="kpi mint"><div class="label">本轮课程数</div><div class="value">${data.courseCount || 0}</div></article>
    <article class="kpi coral"><div class="label">已超容</div><div class="value">${over}</div></article>
    <article class="kpi pink"><div class="label">快照次数</div><div class="value">${data.snapshotCount || 0}</div></article>
  `;

  const stale = data.updatedAt && Date.now() - new Date(data.updatedAt).getTime() > 20 * 60 * 1000;
  if (!data.updatedAt) {
    stateEl.textContent = "还没有采集记录。本地登录 PHBS 后运行 npm run scrape，或等 LaunchAgent 第一次成功。";
    stateEl.classList.add("show");
  } else if (stale) {
    stateEl.textContent = "超过 20 分钟没有新快照，多半是 Chrome 登录态失效。在工作文件夹运行 npm run login。";
    stateEl.classList.add("show");
  } else {
    stateEl.classList.remove("show");
  }

  gridEl.innerHTML = "";
  tbodyEl.innerHTML = "";
  watch.forEach((course, i) => {
    const color = COLORS[i % COLORS.length];
    const overCap = course.capacity != null && course.enrolled != null && course.enrolled > course.capacity;
    const pct = course.capacity ? Math.min(100, Math.round((course.enrolled / course.capacity) * 100)) : 0;
    const card = document.createElement("article");
    card.className = `card${overCap ? " over" : ""}`;
    card.innerHTML = `
      <div class="card-head">
        <div>
          <div class="zh">${course.zh}</div>
          <div class="en">${course.en}</div>
        </div>
        <span class="badge ${overCap ? "hot" : "ok"}">${overCap ? "超容" : "关注"}</span>
      </div>
      <div class="meta">
        <div class="num">${course.enrolled ?? "-"}<span style="color:#8b7396;font-size:12px"> / ${course.capacity ?? "-"}</span></div>
        <div>${course.schedule || ""}</div>
      </div>
      <div class="chart"><canvas id="c${i}"></canvas></div>
    `;
    gridEl.appendChild(card);
    drawChart(`c${i}`, course, color);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${course.zh}<div class="en">${course.en}</div></td>
      <td>${course.enrolled ?? "-"}</td>
      <td>${course.capacity ?? "-"}</td>
      <td>${course.remaining ?? "-"}</td>
      <td><div class="bar"><span style="width:${pct}%;background:${overCap ? "#ff6b9d" : color}"></span></div></td>
      <td>${course.schedule || ""}</td>
      <td>${course.note || ""}</td>
    `;
    tbodyEl.appendChild(tr);
  });

  if (hottest?.enrolled != null) {
    document.title = `${hottest.zh} ${hottest.enrolled}/${hottest.capacity ?? "-"} · 选课看板`;
  }
}

function drawChart(id, course, color) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === "undefined") return;
  const history = course.history || [];
  const labels = chartLabels(history);
  const enrolled = history.map((h) => h.enrolled);
  const cap = history.map((h) => h.capacity);
  new Chart(canvas, {
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
          pointRadius: history.length > 8 ? 2 : 3,
          pointBackgroundColor: "#fff",
          pointBorderColor: color,
          borderWidth: 3,
          spanGaps: true,
          fill: true,
        },
        {
          label: "容量",
          data: cap.length ? cap : [null],
          borderColor: "#c4b5fd",
          borderDash: [6, 6],
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, color: "#8b7396", font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#8b7396", font: { size: 10 } }, grid: { color: "rgba(124,92,252,0.08)" } },
      },
    },
  });
}

async function main() {
  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    render(await res.json());
  } catch (err) {
    stateEl.textContent = `读取 data.json 失败：${err.message}`;
    stateEl.classList.add("show");
  }
}

main();
