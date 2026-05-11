/* ============================================================
   reports.js — Profit & Loss reporting page
   ============================================================ */

let _profitChart = null;
let currentPeriod = '7days';

/* ---- Period helpers ---- */
function getPeriodStart(period) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':  return today;
    case '7days':  return new Date(+today - 6 * 86400000);
    case '30days': return new Date(+today - 29 * 86400000);
    case 'month':  return new Date(now.getFullYear(), now.getMonth(), 1);
    default:       return new Date(+today - 6 * 86400000);
  }
}

function getPeriodSales(period) {
  const start = getPeriodStart(period);
  return DB.getSales().filter(s => new Date(s.createdAt) >= start);
}

/* ---- Profit calculation ---- */
function buildProductCostMap() {
  const map = {};
  DB.getProducts().forEach(p => { map[p.id] = p.costPrice || 0; });
  return map;
}

function calcProfit(sales, costMap) {
  let revenue = 0, cost = 0;
  sales.forEach(s => {
    revenue += s.total;
    s.items.forEach(i => {
      const cp = (i.costPrice !== undefined) ? i.costPrice : (costMap[i.productId] || 0);
      cost += cp * i.qty;
    });
  });
  const profit = revenue - cost;
  const margin = revenue > 0 ? profit / revenue * 100 : 0;
  return { revenue, cost, profit, margin };
}

/* ---- Daily breakdown ---- */
function getDailyData(period) {
  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start   = getPeriodStart(period);
  const costMap = buildProductCostMap();
  const allSales = DB.getSales();
  const result  = [];

  for (let d = new Date(start); d <= today; d = new Date(+d + 86400000)) {
    const ds = d.toDateString();
    const daySales = allSales.filter(s => new Date(s.createdAt).toDateString() === ds);
    let revenue = 0, cost = 0;
    daySales.forEach(s => {
      revenue += s.total;
      s.items.forEach(i => {
        const cp = (i.costPrice !== undefined) ? i.costPrice : (costMap[i.productId] || 0);
        cost += cp * i.qty;
      });
    });
    result.push({
      date: new Date(d),
      label: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
      revenue,
      cost,
      profit: revenue - cost,
      txCount: daySales.length,
    });
  }
  return result;
}

/* ---- Category revenue ---- */
function getCategoryData(sales) {
  const catMap = {};
  DB.getProducts().forEach(p => { catMap[p.id] = p.category; });

  const revenue = {};
  sales.forEach(s => {
    s.items.forEach(i => {
      const cat = catMap[i.productId] || 'อื่นๆ';
      revenue[cat] = (revenue[cat] || 0) + i.price * i.qty;
    });
  });
  return Object.entries(revenue).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

/* ---- Render KPI cards ---- */
function renderKPIs(sales) {
  const costMap = buildProductCostMap();
  const { revenue, cost, profit, margin } = calcProfit(sales, costMap);
  const el = document.getElementById('rpt-kpis');
  const profitColor = profit >= 0 ? 'var(--primary)' : 'var(--danger)';
  const marginIcon = margin >= 30 ? 'green' : margin >= 10 ? 'yellow' : 'red';
  el.innerHTML = `
    <div class="rpt-kpi-card">
      <div class="rpt-kpi-icon blue">💰</div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-value">฿${fmt(revenue)}</div>
        <div class="rpt-kpi-label">รายได้รวม</div>
      </div>
    </div>
    <div class="rpt-kpi-card">
      <div class="rpt-kpi-icon yellow">🏷️</div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-value">฿${fmt(cost)}</div>
        <div class="rpt-kpi-label">ต้นทุนสินค้า</div>
      </div>
    </div>
    <div class="rpt-kpi-card">
      <div class="rpt-kpi-icon green">📈</div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-value" style="color:${profitColor}">฿${fmt(profit)}</div>
        <div class="rpt-kpi-label">กำไรขั้นต้น</div>
      </div>
    </div>
    <div class="rpt-kpi-card">
      <div class="rpt-kpi-icon ${marginIcon}">%</div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-value" style="color:${profitColor}">${margin.toFixed(1)}%</div>
        <div class="rpt-kpi-label">อัตรากำไร</div>
      </div>
    </div>`;
}

/* ---- Render chart ---- */
function renderChart(dailyData) {
  const canvas = document.getElementById('chart-profit');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels   = dailyData.map(d => d.label);
  const revenues = dailyData.map(d => d.revenue);
  const profits  = dailyData.map(d => d.profit);

  if (_profitChart) { _profitChart.destroy(); _profitChart = null; }

  _profitChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'รายได้',
          data: revenues,
          backgroundColor: 'rgba(2,132,199,0.18)',
          borderColor: '#0284c7',
          borderWidth: 2,
          borderRadius: 3,
        },
        {
          label: 'กำไร',
          data: profits,
          backgroundColor: 'rgba(22,163,74,0.25)',
          borderColor: '#16a34a',
          borderWidth: 2,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, padding: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ฿${Number(ctx.raw).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v,
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

/* ---- Render category bars ---- */
function renderCategories(sales) {
  const el   = document.getElementById('rpt-categories');
  const cats = getCategoryData(sales);
  if (!cats.length) {
    el.innerHTML = '<p class="rpt-empty">ยังไม่มีข้อมูลการขาย</p>';
    return;
  }
  const max   = cats[0][1];
  const total = cats.reduce((s, [, v]) => s + v, 0);
  el.innerHTML = cats.map(([name, rev]) => `
    <div class="rpt-cat-item">
      <div class="rpt-cat-header">
        <span class="rpt-cat-name">${DB.getEmoji(name)} ${name}</span>
        <span class="rpt-cat-amt">฿${fmt(rev)}</span>
      </div>
      <div class="rpt-cat-bar-wrap">
        <div class="rpt-cat-bar" style="width:${Math.round(rev / max * 100)}%"></div>
        <span class="rpt-cat-pct">${total > 0 ? (rev / total * 100).toFixed(0) : 0}%</span>
      </div>
    </div>`).join('');
}

/* ---- Render daily table ---- */
function renderDailyTable(dailyData) {
  const el = document.getElementById('rpt-daily-table');
  const rows = dailyData.filter(d => d.revenue > 0 || d.txCount > 0);
  if (!rows.length) {
    el.innerHTML = '<p class="rpt-empty">ยังไม่มีข้อมูลการขาย</p>';
    return;
  }
  el.innerHTML = `
    <div class="rpt-table-wrap">
      <table class="rpt-table">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>บิล</th>
            <th>รายได้</th>
            <th>ต้นทุน</th>
            <th>กำไร</th>
            <th>อัตรา</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(d => {
            const margin = d.revenue > 0 ? d.profit / d.revenue * 100 : 0;
            const pc = d.profit >= 0 ? 'var(--primary)' : 'var(--danger)';
            return `
              <tr>
                <td>${d.label}</td>
                <td>${d.txCount}</td>
                <td>฿${fmt(d.revenue)}</td>
                <td style="color:var(--warning)">฿${fmt(d.cost)}</td>
                <td style="color:${pc};font-weight:600">฿${fmt(d.profit)}</td>
                <td style="color:${pc}">${margin.toFixed(1)}%</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ---- Set period ---- */
function setPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll('.rpt-period-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  renderAll();
}

function renderAll() {
  const sales = getPeriodSales(currentPeriod);
  const daily = getDailyData(currentPeriod);
  renderKPIs(sales);
  renderChart(daily);
  renderCategories(sales);
  renderDailyTable(daily);
}

/* ---- Export CSV ---- */
function exportReportCSV() {
  const daily = getDailyData(currentPeriod);
  const BOM = '﻿';
  const headers = ['วันที่', 'จำนวนบิล', 'รายได้ (฿)', 'ต้นทุน (฿)', 'กำไรขั้นต้น (฿)', 'อัตรากำไร (%)'];
  const rows = daily.map(d => {
    const margin = d.revenue > 0 ? (d.profit / d.revenue * 100).toFixed(2) : '0.00';
    return [
      d.date.toLocaleDateString('th-TH'),
      d.txCount,
      d.revenue.toFixed(2),
      d.cost.toFixed(2),
      d.profit.toFixed(2),
      margin,
    ];
  });
  const csv = BOM + [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `profit_report_${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('ส่งออกรายงานเรียบร้อย');
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  const bn = document.getElementById('brand-name');
  if (bn) bn.textContent = DB.getSettings().shopName || 'ร้านขายของชำ';

  const clockEl = document.getElementById('clock');
  if (clockEl) {
    const tick = () => { clockEl.textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    setInterval(tick, 1000); tick();
  }

  renderAll();
});
