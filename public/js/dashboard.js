/**
 * dashboard.js — 看板页面渲染（PRD 5.1）
 * 3 行指标卡片 + 2 类图表（收支趋势、支出构成）
 */
const Dashboard = (() => {
  let chartTrend = null, chartExpense = null, chartIncome = null;
  let invFilter = ''; // 看板库存按商品名称筛选

  // 复合式时间筛选 → 统一范围。便捷段或自定义月份，最小单位均为月份。
  function getRange() {
    const quick = document.getElementById('dashboardPeriodFilter').value || 'month';
    if (quick === 'custom') {
      return Calculator.resolveRange({
        quick: 'custom',
        startMonth: document.getElementById('dashboardStartMonth').value,
        endMonth: document.getElementById('dashboardEndMonth').value
      });
    }
    return Calculator.resolveRange({ quick });
  }

  function render() {
    const quick = document.getElementById('dashboardPeriodFilter').value || 'month';
    document.getElementById('customRangeWrap').style.display = quick === 'custom' ? 'inline-flex' : 'none';
    const unitFilter = document.getElementById('dashboardUnitFilter').value || '全部单元';
    const range = getRange();
    document.getElementById('trendRangeLabel').textContent = '当前选择：' + range.label;
    const m = Calculator.calculateMetrics(unitFilter, range);

    // 基础层（金额经汇率折算）
    document.getElementById('m-sales').textContent = Calculator.fmtMoney(m.salesIncome);
    document.getElementById('m-cash').textContent = Calculator.fmtMoney(m.cashIncome);
    document.getElementById('m-other').textContent = Calculator.fmtMoney(m.otherIncome);
    document.getElementById('m-total-income').textContent = Calculator.fmtMoney(m.totalIncome);
    document.getElementById('m-receivable').textContent = Calculator.fmtMoney(m.receivable);
    document.getElementById('m-material').textContent = Calculator.fmtMoney(m.materialCost);
    document.getElementById('m-process').textContent = Calculator.fmtMoney(m.processCost);
    document.getElementById('m-misc').textContent = Calculator.fmtMoney(m.miscCost);

    // 核心层
    document.getElementById('m-added').textContent = Calculator.fmtMoney(m.addedValue);
    document.getElementById('m-tax').textContent = Calculator.fmtMoney(m.taxCost);
    document.getElementById('m-total-expense').textContent = Calculator.fmtMoney(m.totalExpense);
    document.getElementById('m-cash-expense').textContent = Calculator.fmtMoney(m.cashExpense);
    document.getElementById('m-payable').textContent = Calculator.fmtMoney(m.payable);

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
    renderCharts(unitFilter, range);
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

  function renderCharts(unitFilter, range) {
    const { start, end, label, granularity } = range;
    // 统一按所选时间段过滤（修复原先指标卡只看当月、图表却看全量的口径不一致）
    const txs = Storage.getTransactionsSync({ unit: unitFilter, startDate: start, endDate: end });

    // 收支趋势（按粒度聚合：单月/季度/具体月按日，整年/全部按月）
    const { labels, incomeArr, expenseArr } = buildTrend(granularity, start, end, txs);

    const ctxT = document.getElementById('chartTrend');
    if (chartTrend) chartTrend.destroy();
    chartTrend = new Chart(ctxT, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '收入', data: incomeArr, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.1)', tension: 0.3, fill: true },
          { label: '支出', data: expenseArr, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.3, fill: true }
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

    // 支出构成（所选时间段）
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

    // 收入构成（所选时间段）
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

  // 按粒度构建趋势图数据：'month'→按月聚合；'day'→按日聚合
  function buildTrend(granularity, start, end, txs) {
    const incomeMap = {}, expenseMap = {};
    let keys = [], labels = [];
    if (granularity === 'month') {
      let months = [];
      if (start && end) {
        // 指定年份/整年：铺满起止区间内的每个自然月
        const s = new Date(start), e = new Date(end);
        for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d.setMonth(d.getMonth() + 1)) {
          months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
      } else {
        // 全部时间：取数据中出现过的月份
        const set = new Set(txs.map(t => (t.date || '').slice(0, 7)).filter(Boolean));
        months = Array.from(set).sort();
      }
      keys = months;
      labels = months.map(m => m.slice(2));
      months.forEach(m => { incomeMap[m] = 0; expenseMap[m] = 0; });
      txs.forEach(t => {
        const mk = (t.date || '').slice(0, 7);
        if (mk in incomeMap) {
          if (t.amount > 0) incomeMap[mk] += t.amount; else expenseMap[mk] += Math.abs(t.amount);
        }
      });
    } else {
      const s = new Date(start), e = new Date(end);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        keys.push(key); labels.push(key.slice(5));
        incomeMap[key] = 0; expenseMap[key] = 0;
      }
      txs.forEach(t => {
        if (t.date in incomeMap) {
          if (t.amount > 0) incomeMap[t.date] += t.amount; else expenseMap[t.date] += Math.abs(t.amount);
        }
      });
    }
    return { labels, incomeArr: keys.map(k => incomeMap[k]), expenseArr: keys.map(k => expenseMap[k]) };
  }

  // 库存总览：与经营数据并列，辅助经营者对照判断
  function renderInventoryOverview() {
    const all = Storage.getInventorySync();
    const kw = (invFilter || '').trim().toLowerCase();
    const list = kw ? all.filter(i => (i.product_name || '').toLowerCase().includes(kw)) : all;
    // 概览卡片始终反映全部库存；筛选仅作用于下方表格，便于经营者快速定位商品
    document.getElementById('dashInvCount').textContent = all.length;
    const totalValue = all.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.avg_price) || 0), 0);
    document.getElementById('dashInvValue').textContent = Calculator.fmtMoney(totalValue);
    const zero = all.filter(i => !(Number(i.quantity) > 0)).length;
    document.getElementById('dashInvZero').textContent = zero;

    const tbl = document.getElementById('dashInventoryTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无匹配的库存数据</td></tr>'; return; }
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
    document.getElementById('dashboardPeriodFilter').addEventListener('change', render);
    document.getElementById('dashboardStartMonth').addEventListener('change', render);
    document.getElementById('dashboardEndMonth').addEventListener('change', render);
    // 看板库存按商品名称筛选：仅刷新库存表格，不重建图表
    const invInput = document.getElementById('dashInvFilter');
    if (invInput) invInput.addEventListener('input', (e) => { invFilter = e.target.value || ''; renderInventoryOverview(); });
    // 自定义月份默认填值（上月 ~ 本月），便于直接选"自定义"即可用
    const smEl = document.getElementById('dashboardStartMonth');
    const emEl = document.getElementById('dashboardEndMonth');
    if (smEl && !smEl.value) {
      const now = new Date();
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      smEl.value = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`;
      emEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  return { render, renderUnitFilter, bind };
})();
