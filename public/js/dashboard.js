/**
 * dashboard.js — 看板页面渲染（PRD 5.1）
 * 3 行指标卡片 + 2 类图表（收支趋势、支出构成）
 */
const Dashboard = (() => {
  let chartTrend = null, chartExpense = null, chartIncome = null;

  function render() {
    const unitFilter = document.getElementById('dashboardUnitFilter').value || '全部单元';
    const m = Calculator.calculateMetrics(unitFilter);

    // 基础层（金额经汇率折算）
    document.getElementById('m-sales').textContent = Calculator.fmtMoney(m.salesIncome);
    document.getElementById('m-cash').textContent = Calculator.fmtMoney(m.cashIncome);
    document.getElementById('m-total-income').textContent = Calculator.fmtMoney(m.totalIncome);
    document.getElementById('m-material').textContent = Calculator.fmtMoney(m.materialCost);
    document.getElementById('m-process').textContent = Calculator.fmtMoney(m.processCost);
    document.getElementById('m-consume').textContent = Calculator.fmtMoney(m.consumeCost);
    document.getElementById('m-misc').textContent = Calculator.fmtMoney(m.miscCost);

    // 核心层
    document.getElementById('m-added').textContent = Calculator.fmtMoney(m.addedValue);
    document.getElementById('m-tax').textContent = Calculator.fmtMoney(m.taxCost);

    // 成果层
    const profitEl = document.getElementById('m-profit');
    profitEl.textContent = Calculator.fmtMoney(m.profit);
    profitEl.className = 'm-value ' + (m.profit >= 0 ? 'positive' : 'negative');

    document.getElementById('m-salary').textContent = Calculator.fmtMoney(m.totalSalary);
    document.getElementById('m-hours').textContent = Calculator.fmtHour(m.totalHours);

    // 衍生效率层
    document.getElementById('m-unit-added').textContent = Calculator.fmtRate(m.unitAddedValue);
    document.getElementById('m-unit-salary').textContent = Calculator.fmtRate(m.unitSalary);
    document.getElementById('m-unit-profit').textContent = Calculator.fmtRate(m.unitProfit);

    renderRateInfo();
    renderCharts(unitFilter);
    renderInventoryOverview();
  }

  // 渲染汇率信息栏
  function renderRateInfo() {
    const info = Currency.getRateInfo();
    const bar = document.getElementById('rateInfoBar');
    if (info.currency === 'CNY') {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const tagClass = info.isRealtime ? 'rate-tag' : 'rate-warn';
    const tagText = info.isRealtime ? '实时汇率' : '离线参考';
    bar.innerHTML = `<span class="${tagClass}">${tagText}</span> 汇率：1 ${info.base} = ${info.rate} ${info.currency}　|　数据日期：${info.date}　|　来源：${info.source}　|　金额已按此汇率折算`;
  }

  function renderUnitFilter() {
    const sel = document.getElementById('dashboardUnitFilter');
    const units = Storage.getUnitList();
    const cur = sel.value || '全部单元';
    sel.innerHTML = '<option>全部单元</option>' + units.filter(u => u !== '全公司')
      .map(u => `<option ${u === cur ? 'selected' : ''}>${u}</option>`).join('');
  }

  function renderCharts(unitFilter) {
    const txs = Storage.getTransactionsSync({ unit: unitFilter });
    const { start, end } = Calculator.currentMonthRange();

    // 近 30 天收支趋势
    const days = [];
    const dayMap = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
      dayMap[key] = { income: 0, expense: 0 };
    }
    txs.forEach(t => {
      if (dayMap[t.date]) {
        if (t.amount > 0) dayMap[t.date].income += t.amount;
        else dayMap[t.date].expense += Math.abs(t.amount);
      }
    });

    const ctxT = document.getElementById('chartTrend');
    if (chartTrend) chartTrend.destroy();
    chartTrend = new Chart(ctxT, {
      type: 'line',
      data: {
        labels: days.map(d => d.slice(5)),
        datasets: [
          { label: '收入', data: days.map(d => dayMap[d].income), borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.1)', tension: 0.3, fill: true },
          { label: '支出', data: days.map(d => dayMap[d].expense), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + '：' + Currency.fmtMoney(ctx.parsed.y) } }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => Currency.getSymbol() + ' ' + v.toLocaleString() }
          }
        }
      }
    });

    // 支出构成
    const expenseData = [
      { label: '材料采购', value: txs.filter(t => t.type === '材料采购').reduce((s, t) => s + Math.abs(t.amount), 0) },
      { label: '委托加工', value: txs.filter(t => t.type === '委托加工').reduce((s, t) => s + Math.abs(t.amount), 0) },
      { label: '杂费支出', value: txs.filter(t => t.type === '杂费支出').reduce((s, t) => s + Math.abs(t.amount), 0) },
      { label: '税金', value: txs.filter(t => t.type === '税金').reduce((s, t) => s + Math.abs(t.amount), 0) }
    ].filter(d => d.value > 0);

    const ctxE = document.getElementById('chartExpense');
    if (chartExpense) chartExpense.destroy();
    chartExpense = new Chart(ctxE, {
      type: 'doughnut',
      data: {
        labels: expenseData.map(d => d.label),
        datasets: [{
          data: expenseData.map(d => Currency.convert(d.value)),
          backgroundColor: ['#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444']
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => ctx.label + '：' + Currency.getSymbol() + ' ' + ctx.parsed.toLocaleString() } }
        }
      }
    });

    // 收入构成
    const incomeData = [
      { label: '销售收入', value: txs.filter(t => t.type === '销售收入').reduce((s, t) => s + Math.abs(t.amount), 0) },
      { label: '现金收入', value: txs.filter(t => t.type === '现金收入').reduce((s, t) => s + Math.abs(t.amount), 0) },
      { label: '其他收入', value: txs.filter(t => t.type === '其他收入').reduce((s, t) => s + Math.abs(t.amount), 0) }
    ].filter(d => d.value > 0);

    const ctxI = document.getElementById('chartIncome');
    if (chartIncome) chartIncome.destroy();
    chartIncome = new Chart(ctxI, {
      type: 'doughnut',
      data: {
        labels: incomeData.map(d => d.label),
        datasets: [{
          data: incomeData.map(d => Currency.convert(d.value)),
          backgroundColor: ['#059669', '#10b981', '#6366f1']
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => ctx.label + '：' + Currency.getSymbol() + ' ' + ctx.parsed.toLocaleString() } }
        }
      }
    });
  }

  // 库存总览：与经营数据并列，辅助经营者对照判断
  function renderInventoryOverview() {
    const list = Storage.getInventorySync();
    document.getElementById('dashInvCount').textContent = list.length;
    const totalValue = list.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.avg_price) || 0), 0);
    document.getElementById('dashInvValue').textContent = Calculator.fmtMoney(totalValue);
    const zero = list.filter(i => !(Number(i.quantity) > 0)).length;
    document.getElementById('dashInvZero').textContent = zero;

    const tbl = document.getElementById('dashInventoryTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无库存数据</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>商品名称</th><th>分类</th><th>库存数量</th><th>均价</th><th>库存价值</th><th>最后编辑</th></tr></thead>
      <tbody>${list.map(i => {
        const val = (Number(i.quantity) || 0) * (Number(i.avg_price) || 0);
        const d = i.updated_at ? new Date(i.updated_at) : null;
        const t = d && !isNaN(d.getTime())
          ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : '—';
        return `<tr>
          <td>${i.product_name}</td>
          <td>${i.category1} / ${i.category2 || '—'}</td>
          <td>${i.quantity}</td>
          <td>${Calculator.fmtMoney(i.avg_price)}</td>
          <td class="${val >= 0 ? 'amt pos' : 'amt neg'}">${Calculator.fmtMoney(val)}</td>
          <td class="inv-time">${t}</td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  function bind() {
    document.getElementById('dashboardUnitFilter').addEventListener('change', render);
    document.getElementById('dashboardCurrency').addEventListener('change', async (e) => {
      Currency.setDisplayCurrency(e.target.value);
      // 切换币种后刷新所有页面
      App.refreshAll();
    });
  }

  return { render, renderUnitFilter, bind };
})();
