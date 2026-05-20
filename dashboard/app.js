const endpoint = "/api/live-dashboard";

function formatPercent(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(value ?? 0);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "-";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function updateStatus(online) {
  const pill = document.getElementById("status-pill");
  pill.textContent = online ? "Online" : "Sem conexão";
  pill.style.background = online ? "rgba(16,185,129,.16)" : "rgba(248,113,113,.16)";
  pill.style.color = online ? "#a7f3d0" : "#fecaca";
}

let trendChart = null;
let performanceChart = null;

function renderMetrics(data) {
  document.getElementById("emails-sent-today").textContent = data.emailsSentToday ?? 0;
  document.getElementById("emails-total").textContent = data.emailsSentTotal ?? 0;
  document.getElementById("companies-contacted").textContent = data.companiesContacted ?? 0;
  document.getElementById("reply-rate").textContent = formatPercent(data.replyRate);
  document.getElementById("delivery-success").textContent = formatPercent(data.deliverySuccess);
  document.getElementById("bounce-rate").textContent = formatPercent(data.bounceRate);
  document.getElementById("ai-cost").textContent = formatCurrency(data.aiCost);
  document.getElementById("updated-at").textContent = formatDate(data.generatedAt);

  const tbody = document.getElementById("recent-sends");
  tbody.innerHTML = "";
  (data.recentSends ?? []).forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatDate(item.date)}</td>
      <td>${item.company}</td>
      <td>${item.destination}</td>
      <td>${item.status}</td>
    `;
    tbody.appendChild(row);
  });

  renderCharts(data);
}

function renderCharts(data) {
  if (typeof Chart === "undefined") return;

  const trendLabels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const trendData = [
    data.trend?.monday ?? 0,
    data.trend?.tuesday ?? 0,
    data.trend?.wednesday ?? 0,
    data.trend?.thursday ?? 0,
    data.trend?.friday ?? 0,
    data.trend?.saturday ?? 0,
    data.trend?.sunday ?? 0,
  ];

  const trendCtx = document.getElementById("chart-send-trend");
  if (trendCtx) {
    if (trendChart) {
      trendChart.data.labels = trendLabels;
      trendChart.data.datasets[0].data = trendData;
      trendChart.update();
    } else {
      trendChart = new Chart(trendCtx, {
        type: "line",
        data: {
          labels: trendLabels,
          datasets: [{ label: "Envios", data: trendData, borderColor: "#60a5fa", backgroundColor: "rgba(96,165,250,0.2)", fill: true, tension: 0.4 }],
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#cbd5e1" } }, y: { ticks: { color: "#cbd5e1" } } } },
      });
    }
  }

  const performanceCtx = document.getElementById("chart-performance");
  if (performanceCtx) {
    const performanceData = [
      Math.round((data.replyRate ?? 0) * 100),
      Math.round((data.deliverySuccess ?? 0) * 100),
      Math.round((data.bounceRate ?? 0) * 100),
    ];
    if (performanceChart) {
      performanceChart.data.datasets[0].data = performanceData;
      performanceChart.update();
    } else {
      performanceChart = new Chart(performanceCtx, {
        type: "doughnut",
        data: {
          labels: ["Reply", "Delivery", "Bounce"],
          datasets: [{ data: performanceData, backgroundColor: ["#34d399", "#60a5fa", "#f97316"] }],
        },
        options: { responsive: true, plugins: { legend: { labels: { color: "#cbd5e1" } } } },
      });
    }
  }
}

async function loadLiveDashboard() {
  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderMetrics(data);
    updateStatus(true);
  } catch (error) {
    console.error("Erro ao carregar dados em tempo real:", error);
    updateStatus(false);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadLiveDashboard();
  setInterval(loadLiveDashboard, 5000);
});
