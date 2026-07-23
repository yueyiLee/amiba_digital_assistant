/**
 * analysis.js — 经营分析模块（P0）
 * 6 个分析页 + 经营预警 + 跳转高亮。数据全部基于 Storage 缓存前端聚合，零 schema 改动。
 */
const Analysis = (() => {
  // ========== 通用工具 ==========
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => Currency.fmtMoney(v);
  const num0 = (v) => Number(v || 0);
  // 当前时间筛选（页内顶部控件绑定）
  let curUnit = '全部单元';
  let curPeriod = 'month';        // 'month' | 'lastMonth' | 'year' | 'lastYear' | 'custom' —— 模块变量，跨页持久
  let curCustomStart = '';        // 仅当 curPeriod === 'custom' 时使用，'YYYY-MM'
  let curCustomEnd = '';          // 仅当 curPeriod === 'custom' 时使用，'YYYY-MM'
  let curRange = null;            // {start, end, label, granularity} —— 由 curPeriod + curCustomStart/End 计算
  // 预警阈值（可在驾驶舱页内调整，默认 P0 初版）
  const TH = {
    receivableOver: 80000,    // 客户应收超 ¥80,000 触发红
    receivableWatch: 40000,   // ¥40,000 触发黄
    grossMarginFloor: 0.15,   // 商品毛利率跌破 15% 红
    inventoryZeroWarn: 0,     // 库存 0 数量上限不预警
  };

  // 复用看板时间范围
  function getRange() {
    if (curRange) return curRange;
    return Calculator.resolveRange({ quick: curPeriod || 'month' });
  }

  // ========== 1. 经营预警检测 ==========
  // 预警项 schema: { level:'red'|'yellow', kind:'customer'|'product'|'contract'|'cash', key, title, sub, jumpTo, jumpAnchor }
  function detectAlerts() {
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    const customers = Storage.getCustomersSync();
    const inventory = Storage.getInventorySync();
    const alerts = [];

    // 1) 客户应收超期（按"销售-现金"按客户汇总）
    const recvByCustomer = {};
    txs.forEach(t => {
      if (!t.customer_id) return;
      if (t.type === '销售收入') recvByCustomer[t.customer_id] = (recvByCustomer[t.customer_id] || 0) + num0(t.amount);
      if (t.type === '现金收入') recvByCustomer[t.customer_id] = (recvByCustomer[t.customer_id] || 0) - num0(t.amount);
    });
    Object.keys(recvByCustomer).forEach(cid => {
      const ar = recvByCustomer[cid];
      if (ar < TH.receivableWatch) return;
      const c = customers.find(x => String(x.id) === String(cid));
      if (!c) return;
      if (ar >= TH.receivableOver) {
        alerts.push({ level: 'red', kind: 'customer', key: cid, title: `客户【${c.name}】应收 ¥${Math.round(ar).toLocaleString()}`,
          sub: '超过预警阈值，建议立即跟进回款', jumpTo: 'analysis-customer', jumpAnchor: `customer:${cid}` });
      } else {
        alerts.push({ level: 'yellow', kind: 'customer', key: cid, title: `客户【${c.name}】应收 ¥${Math.round(ar).toLocaleString()}`,
          sub: '需保持关注', jumpTo: 'analysis-customer', jumpAnchor: `customer:${cid}` });
      }
    });

    // 2) 商品类预警（用真实流水口径：销售收入 - 该商品材料采购 = 毛利）
    //    —— 之前用 products[].price/avg_cost 在真实数据中常为空，导致商品预警永远不触发
    const productRows = buildProductMetrics();
    productRows.forEach(r => {
      if (r.sale > 0 && r.gm < TH.grossMarginFloor) {
        alerts.push({ level: 'red', kind: 'product', key: r.id, title: `商品【${r.name}】毛利率 ${(r.gm * 100).toFixed(1)}%`,
          sub: `跌破 15% 警戒线（销售 ¥${Math.round(r.sale).toLocaleString()} / 成本 ¥${Math.round(r.cost).toLocaleString()}）`,
          jumpTo: 'analysis-product', jumpAnchor: `product:${r.id}` });
      }
      if (r.sale > 0 && r.qty === 0) {
        alerts.push({ level: 'yellow', kind: 'product', key: r.id, title: `商品【${r.name}】零库存`,
          sub: '本期有销售但当前库存为 0', jumpTo: 'analysis-product', jumpAnchor: `product:${r.id}` });
      }
    });

    // 3) 库存呆滞：60 天以上无出入库（用 updated_at 粗判）
    const now = Date.now();
    inventory.forEach(i => {
      const qty = num0(i.quantity);
      if (qty > 0 && i.updated_at) {
        const days = (now - new Date(i.updated_at).getTime()) / 86400000;
        if (days > 60) {
          alerts.push({ level: 'yellow', kind: 'product', key: i.product_id, title: `商品【${i.product_name}】库存呆滞 ${Math.floor(days)} 天`,
            sub: '建议盘点/促销/调拨', jumpTo: 'analysis-product', jumpAnchor: `product:${i.product_id}` });
        }
      }
    });

    // 4) 资金类：净现金流为负
    const cashIn = txs.filter(t => t.type === '现金收入').reduce((s, t) => s + num0(t.amount), 0);
    const cashOut = txs.filter(t => t.type === '现金支出').reduce((s, t) => s + Math.abs(num0(t.amount)), 0);
    if (cashOut > cashIn && (cashOut - cashIn) > 20000) {
      alerts.push({ level: 'red', kind: 'cash', key: 'net', title: `净现金流缺口 ¥${Math.round(cashOut - cashIn).toLocaleString()}`,
        sub: '现金支出持续大于现金收入', jumpTo: 'analysis-cash', jumpAnchor: 'cash-net' });
    }

    return alerts;
  }

  // ========== 2. 行高亮闪烁（驾驶舱"查看"跳转后使用） ==========
  // 推荐用 App.switchPage(key, anchor) → Analysis.flashRow(anchor) 直接传值，避免 hash 链路
  let pendingFocus = null;
  let focusTries = 0;
  function flashRow(anchor) {
    pendingFocus = anchor;
    focusTries = 0;
  }
  // 兼容旧的 hash 方式（#page?focus=xxx 刷新场景）
  function consumeFocus() {
    const m = window.location.hash.match(/focus=([^&]+)/);
    if (m) pendingFocus = decodeURIComponent(m[1]);
    focusTries = 0;
  }
  function tryFlashOnLoad() {
    if (!pendingFocus) return;
    // 必须在当前活动 section 内查找 —— 否则会被其他隐藏页（如驾驶舱 #topCustomers）
    // 里同名的 data-anchor 抢先命中，导致 scrollIntoView/高亮作用在不可见元素上
    const activeSection = document.querySelector('.page-section.active');
    if (!activeSection) {
      // 页面还没切换完成（极少见），稍后重试
      if (focusTries < 40) { focusTries++; setTimeout(tryFlashOnLoad, 80); }
      else { pendingFocus = null; }
      return;
    }
    const sel = `[data-anchor="${pendingFocus}"]`;
    const el = activeSection.querySelector(sel);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('row-flash');
      setTimeout(() => el.classList.remove('row-flash'), 2600);
      pendingFocus = null;
    } else if (focusTries < 40) {
      // 数据未就绪（如异步渲染中）—— 80ms 后再试，最多 ~3.2s
      focusTries++;
      setTimeout(tryFlashOnLoad, 80);
    } else {
      pendingFocus = null; // 放弃，避免常驻定时器
    }
  }

  // ========== 3. 通用顶部筛选（用 class 避免 6 个分析页 id 冲突） ==========
  function syncUnitFilters() {
    const sels = document.querySelectorAll('.ana-unit');
    const units = Storage.getUnitList();
    const opts = '<option>全部单元</option>' + units.filter(u => u !== '全公司')
      .map(u => `<option ${u === curUnit ? 'selected' : ''}>${u}</option>`).join('');
    sels.forEach(sel => { if (sel.value !== curUnit || sel.options.length !== units.length) sel.innerHTML = opts; });
  }
  function syncPeriodFilters() {
    const sels = document.querySelectorAll('.ana-period');
    const html = `
      <option value="month">本月</option>
      <option value="lastMonth">上月</option>
      <option value="year">今年</option>
      <option value="lastYear">上年</option>
      <option value="custom">自定义…</option>`;
    // 关键：用 curPeriod（模块变量）回填所有 selector，而不是依赖 dataset.touched
    sels.forEach(sel => { sel.innerHTML = html; sel.value = curPeriod; });
    document.querySelectorAll('.ana-custom-wrap').forEach(w => {
      w.style.display = curPeriod === 'custom' ? 'inline-flex' : 'none';
    });
    // 自定义输入框：用 curCustomStart/End 回填（之前是读 DOM 第一项，导致跨页 bug）
    document.querySelectorAll('.ana-start').forEach(s => { s.value = curCustomStart; });
    document.querySelectorAll('.ana-end').forEach(e => { e.value = curCustomEnd; });
  }
  function refreshRange() {
    // 直接用模块变量计算，不再从 DOM 读（之前 document.querySelector 拿到的是隐藏 section 的值）
    if (curPeriod === 'custom') {
      curRange = Calculator.resolveRange({ quick: 'custom', startMonth: curCustomStart, endMonth: curCustomEnd });
    } else {
      curRange = Calculator.resolveRange({ quick: curPeriod });
    }
  }

  // ========== 4. 客户分析 ==========
  function buildCustomerMetrics() {
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    const customers = Storage.getCustomersSync();
    const byId = {};
    customers.forEach(c => byId[c.id] = { id: c.id, name: c.name, type: c.type || '', sale: 0, cash: 0, recv: 0, lastDate: '' });
    txs.forEach(t => {
      const cid = t.customer_id;
      if (!cid || !byId[cid]) return;
      const r = byId[cid];
      if (t.type === '销售收入') r.sale += num0(t.amount);
      if (t.type === '现金收入') r.cash += num0(t.amount);
      r.recv = r.sale - r.cash;
      if (t.date > r.lastDate) r.lastDate = t.date;
    });
    return Object.values(byId).filter(r => r.sale > 0 || r.cash > 0).sort((a, b) => b.recv - a.recv);
  }
  function renderCustomer() {
    const rows = buildCustomerMetrics();
    const totalSale = rows.reduce((s, r) => s + r.sale, 0);
    const totalRecv = rows.reduce((s, r) => s + r.recv, 0);
    $('custTotalSale').textContent = money(totalSale);
    $('custTotalRecv').textContent = money(totalRecv);
    $('custCount').textContent = rows.length;

    // Top 5 应收
    const topRecv = rows.slice(0, 5);
    const maxRecv = Math.max(1, ...topRecv.map(r => r.recv));
    $('custTopBars').innerHTML = topRecv.map(r => `
      <div class="ana-bar-row">
        <div class="ana-bar-label">${escapeHtml(r.name)}</div>
        <div class="ana-bar-track"><div class="ana-bar-fill recv" style="width:${(r.recv / maxRecv * 100).toFixed(0)}%"></div></div>
        <div class="ana-bar-val">${money(r.recv)}</div>
      </div>`).join('') || '<div class="empty-state">暂无客户应收数据</div>';

    // 明细表
    $('custTable').innerHTML = `<thead><tr><th>客户</th><th>类型</th><th>销售额</th><th>回款</th><th>应收</th><th>最近交易</th><th>状态</th></tr></thead>
      <tbody>${rows.map(r => {
        const stat = r.recv >= 80000 ? '<span class="badge red">应收预警</span>'
                    : r.recv >= 40000 ? '<span class="badge yellow">关注</span>'
                    : '<span class="badge gray">正常</span>';
        return `<tr data-anchor="customer:${r.id}">
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.type)}</td>
          <td class="amt pos">${money(r.sale)}</td>
          <td class="amt pos">${money(r.cash)}</td>
          <td class="amt ${r.recv > 0 ? 'neg' : ''}">${money(r.recv)}</td>
          <td>${r.lastDate || '—'}</td>
          <td>${stat}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty-state">暂无客户数据</td></tr>'}</tbody>`;
  }

  // ========== 5. 商品分析 ==========
  function buildProductMetrics() {
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    const products = Storage.getProductsSync();
    const inventory = Storage.getInventorySync();
    const invByPid = {};
    inventory.forEach(i => { invByPid[i.product_id] = i; });
    const byId = {};
    products.forEach(p => byId[p.id] = { id: p.id, name: p.name, category: (p.category1 || '') + (p.category2 ? ' / ' + p.category2 : ''), sale: 0, cost: 0, gm: 0, qty: 0, invValue: 0 });
    txs.forEach(t => {
      const pid = t.product_id;
      if (!pid || !byId[pid]) return;
      const r = byId[pid];
      if (t.type === '销售收入') r.sale += num0(t.amount);
      if (t.type === '材料采购') r.cost += Math.abs(num0(t.amount));
    });
    Object.keys(byId).forEach(pid => {
      const r = byId[pid];
      r.gm = r.sale > 0 ? (r.sale - r.cost) / r.sale : 0;
      const inv = invByPid[pid];
      if (inv) { r.qty = num0(inv.quantity); r.invValue = r.qty * num0(inv.avg_price); }
    });
    return Object.values(byId).filter(r => r.sale > 0 || r.invValue > 0).sort((a, b) => b.sale - a.sale);
  }
  function renderProduct() {
    const rows = buildProductMetrics();
    const totalSale = rows.reduce((s, r) => s + r.sale, 0);
    const totalInv = rows.reduce((s, r) => s + r.invValue, 0);
    $('prodTotalSale').textContent = money(totalSale);
    $('prodTotalInv').textContent = money(totalInv);
    $('prodAvgGm').textContent = totalSale > 0
      ? ((totalSale - rows.reduce((s, r) => s + r.cost, 0)) / totalSale * 100).toFixed(1) + '%'
      : '0%';

    // Top 5 销售
    const top = rows.slice(0, 5);
    const max = Math.max(1, ...top.map(r => r.sale));
    $('prodTopBars').innerHTML = top.map(r => `
      <div class="ana-bar-row">
        <div class="ana-bar-label">${escapeHtml(r.name)}</div>
        <div class="ana-bar-track"><div class="ana-bar-fill sale" style="width:${(r.sale / max * 100).toFixed(0)}%"></div></div>
        <div class="ana-bar-val">${money(r.sale)}</div>
      </div>`).join('') || '<div class="empty-state">暂无商品销售数据</div>';

    // 明细表
    $('prodTable').innerHTML = `<thead><tr><th>商品</th><th>分类</th><th>销售额</th><th>成本</th><th>毛利率</th><th>库存量</th><th>库存价值</th><th>状态</th></tr></thead>
      <tbody>${rows.map(r => {
        const stat = r.gm < 0.15 && r.sale > 0 ? '<span class="badge red">毛利跌破</span>'
                    : r.qty === 0 && r.sale > 0 ? '<span class="badge yellow">零库存</span>'
                    : '<span class="badge gray">正常</span>';
        return `<tr data-anchor="product:${r.id}">
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.category)}</td>
          <td class="amt pos">${money(r.sale)}</td>
          <td class="amt neg">${money(r.cost)}</td>
          <td>${(r.gm * 100).toFixed(1)}%</td>
          <td>${r.qty}</td>
          <td class="amt">${money(r.invValue)}</td>
          <td>${stat}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="8" class="empty-state">暂无商品数据</td></tr>'}</tbody>`;
  }

  // ========== 6. 合同分析（简化版：按客户聚合） ==========
  function buildContractMetrics() {
    const contracts = Storage.getContractsSync();
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    const customers = Storage.getCustomersSync();
    // 现金收入按客户
    const cashByCust = {};
    txs.forEach(t => {
      if (t.type === '现金收入' && t.customer_id) cashByCust[t.customer_id] = (cashByCust[t.customer_id] || 0) + num0(t.amount);
    });
    return contracts.map(co => {
      const c = customers.find(x => x.id === co.customer_id);
      const cash = cashByCust[co.customer_id] || 0;
      const ratio = co.amount > 0 ? Math.min(1, cash / co.amount) : 0;
      return {
        id: co.id, no: co.contract_no, customer: c ? c.name : '未关联',
        amount: num0(co.amount), cash, remain: Math.max(0, num0(co.amount) - cash), ratio,
        status: co.status, start: co.start_date, end: co.end_date
      };
    }).sort((a, b) => b.amount - a.amount);
  }
  function renderContract() {
    const rows = buildContractMetrics();
    const totalAmt = rows.reduce((s, r) => s + r.amount, 0);
    const totalCash = rows.reduce((s, r) => s + r.cash, 0);
    $('contractTotalAmt').textContent = money(totalAmt);
    $('contractTotalCash').textContent = money(totalCash);
    $('contractTotalRemain').textContent = money(Math.max(0, totalAmt - totalCash));

    $('contractTable').innerHTML = `<thead><tr><th>合同号</th><th>客户</th><th>合同金额</th><th>已回款</th><th>未回款</th><th>执行率</th><th>状态</th><th>起止</th></tr></thead>
      <tbody>${rows.map(r => {
        const stat = r.ratio < 0.3 && r.amount > 0 ? '<span class="badge red">回款滞后</span>'
                    : r.ratio < 0.7 ? '<span class="badge yellow">执行中</span>'
                    : '<span class="badge green">健康</span>';
        return `<tr data-anchor="contract:${r.id}">
          <td>${escapeHtml(r.no)}</td>
          <td>${escapeHtml(r.customer)}</td>
          <td class="amt pos">${money(r.amount)}</td>
          <td class="amt pos">${money(r.cash)}</td>
          <td class="amt neg">${money(r.remain)}</td>
          <td>
            <div class="ratio-bar"><div class="ratio-fill" style="width:${(r.ratio * 100).toFixed(0)}%"></div><span>${(r.ratio * 100).toFixed(0)}%</span></div>
          </td>
          <td>${stat}</td>
          <td>${r.start || '—'} ~ ${r.end || '—'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="8" class="empty-state">暂无合同数据</td></tr>'}</tbody>`;
  }

  // ========== 7. 费用分析 ==========
  function renderExpense() {
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    // 月度趋势
    const buckets = {};
    txs.filter(t => num0(t.amount) < 0 || ['材料采购', '委托加工', '杂费支出', '税金'].includes(t.type))
      .forEach(t => {
        const m = (t.date || '').slice(0, 7);
        if (!m) return;
        if (!buckets[m]) buckets[m] = { month: m, mat: 0, proc: 0, misc: 0, tax: 0 };
        const v = Math.abs(num0(t.amount));
        if (t.type === '材料采购') buckets[m].mat += v;
        if (t.type === '委托加工') buckets[m].proc += v;
        if (t.type === '杂费支出') buckets[m].misc += v;
        if (t.type === '税金') buckets[m].tax += v;
      });
    const months = Object.keys(buckets).sort();
    const totalMat = months.reduce((s, m) => s + buckets[m].mat, 0);
    const totalProc = months.reduce((s, m) => s + buckets[m].proc, 0);
    const totalMisc = months.reduce((s, m) => s + buckets[m].misc, 0);
    const totalTax = months.reduce((s, m) => s + buckets[m].tax, 0);
    $('expTotal').textContent = money(totalMat + totalProc + totalMisc + totalTax);
    $('expMat').textContent = money(totalMat);
    $('expProc').textContent = money(totalProc);
    $('expMisc').textContent = money(totalMisc);

    // 简单堆叠条形图（CSS）：每月一行
    $('expTrend').innerHTML = months.length === 0 ? '<div class="empty-state">暂无费用数据</div>' : months.map(m => {
      const b = buckets[m];
      const t = b.mat + b.proc + b.misc + b.tax;
      return `<div class="exp-month-row">
        <div class="exp-month-label">${m}</div>
        <div class="exp-month-bars">
          <div class="exp-seg mat" style="width:${(b.mat / t * 100).toFixed(0)}%" title="材料采购"></div>
          <div class="exp-seg proc" style="width:${(b.proc / t * 100).toFixed(0)}%" title="委托加工"></div>
          <div class="exp-seg misc" style="width:${(b.misc / t * 100).toFixed(0)}%" title="杂费支出"></div>
          <div class="exp-seg tax" style="width:${(b.tax / t * 100).toFixed(0)}%" title="税金"></div>
        </div>
        <div class="exp-month-val">${money(t)}</div>
      </div>`;
    }).join('');

    // 费用结构环形
    const segs = [
      { name: '材料采购', value: totalMat, color: '#3b82f6' },
      { name: '委托加工', value: totalProc, color: '#f59e0b' },
      { name: '杂费支出', value: totalMisc, color: '#8b5cf6' },
      { name: '税金',     value: totalTax, color: '#ef4444' },
    ].filter(s => s.value > 0);
    const tot = segs.reduce((s, x) => s + x.value, 0) || 1;
    const c = 70, r = 56, cx = 100, cy = 100;
    let acc = 0;
    const arcs = segs.map(s => {
      const a0 = acc / tot * Math.PI * 2 - Math.PI / 2;
      acc += s.value;
      const a1 = acc / tot * Math.PI * 2 - Math.PI / 2;
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="${s.color}"/>`;
    }).join('');
    $('expDonut').innerHTML = `<svg viewBox="0 0 200 200" class="donut-svg">
      ${arcs || '<circle cx="100" cy="100" r="56" fill="none" stroke="#e2e8f0" stroke-width="28"/>'}
      <text x="100" y="96" text-anchor="middle" font-size="11" fill="#64748b">总费用</text>
      <text x="100" y="115" text-anchor="middle" font-size="14" font-weight="700" fill="#0f172a">${money(tot === 1 ? 0 : tot)}</text>
    </svg>
    <div class="donut-legend">${segs.map(s => `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.name}　${(s.value / tot * 100).toFixed(0)}%</div>`).join('')}</div>`;
  }

  // ========== 8. 资金分析 ==========
  function renderCash() {
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    const customers = Storage.getCustomersSync();
    const cashIn = txs.filter(t => t.type === '现金收入').reduce((s, t) => s + num0(t.amount), 0);
    const cashOut = txs.filter(t => t.type === '现金支出').reduce((s, t) => s + Math.abs(num0(t.amount)), 0);
    const net = cashIn - cashOut;
    const totalRecv = txs.filter(t => t.type === '销售收入').reduce((s, t) => s + num0(t.amount), 0)
                  - cashIn;
    $('cashIn').textContent = money(cashIn);
    $('cashOut').textContent = money(cashOut);
    $('cashNet').textContent = money(net);
    $('cashNet').className = 'm-value ' + (net >= 0 ? 'positive' : 'negative');
    $('cashRecv').textContent = money(Math.max(0, totalRecv));

    // 月度现金流
    const buckets = {};
    txs.forEach(t => {
      const m = (t.date || '').slice(0, 7);
      if (!m) return;
      if (!buckets[m]) buckets[m] = { in: 0, out: 0 };
      if (t.type === '现金收入') buckets[m].in += num0(t.amount);
      if (t.type === '现金支出') buckets[m].out += Math.abs(num0(t.amount));
    });
    const months = Object.keys(buckets).sort();
    const maxV = Math.max(1, ...months.map(m => Math.max(buckets[m].in, buckets[m].out)));
    $('cashTrend').innerHTML = months.length === 0 ? '<div class="empty-state">暂无现金流数据</div>' : months.map(m => {
      const b = buckets[m];
      return `<div class="cash-month-row">
        <div class="cash-month-label">${m}</div>
        <div class="cash-month-bars">
          <div class="cash-bar cash-bar-in" style="width:${(b.in / maxV * 100).toFixed(0)}%" title="现金收入 ${money(b.in)}"></div>
          <div class="cash-bar cash-bar-out" style="width:${(b.out / maxV * 100).toFixed(0)}%" title="现金支出 ${money(b.out)}"></div>
        </div>
        <div class="cash-month-net ${(b.in - b.out) >= 0 ? 'pos' : 'neg'}">${money(b.in - b.out)}</div>
      </div>`;
    }).join('');

    // 应收账龄（按客户 + 距今天数）
    const today = new Date();
    const recv = {};
    txs.forEach(t => {
      if (!t.customer_id) return;
      if (t.type === '销售收入') recv[t.customer_id] = (recv[t.customer_id] || 0) + num0(t.amount);
      if (t.type === '现金收入') recv[t.customer_id] = (recv[t.customer_id] || 0) - num0(t.amount);
    });
    const aging = [];
    Object.keys(recv).forEach(cid => {
      const ar = recv[cid];
      if (ar <= 0) return;
      // 最近一次销售日期作为账龄起点（粗略）
      const lastSale = txs.filter(t => t.customer_id == cid && t.type === '销售收入')
        .reduce((mx, t) => t.date > mx ? t.date : mx, '1970-01-01');
      const days = lastSale ? Math.floor((today - new Date(lastSale)) / 86400000) : 0;
      const c = customers.find(x => String(x.id) === String(cid));
      aging.push({ name: c ? c.name : '未关联客户', ar, days, key: cid });
    });
    aging.sort((a, b) => b.ar - a.ar);
    $('cashAging').innerHTML = aging.length === 0 ? '<div class="empty-state">暂无应收账龄数据</div>' : aging.slice(0, 10).map(a => {
      const bucket = a.days > 60 ? 'red' : a.days > 30 ? 'yellow' : 'green';
      return `<tr data-anchor="customer:${a.key}">
        <td>${escapeHtml(a.name)}</td>
        <td>${a.days} 天</td>
        <td><span class="badge ${bucket}">${a.days > 60 ? '超期' : a.days > 30 ? '关注' : '正常'}</span></td>
        <td class="amt neg">${money(a.ar)}</td>
      </tr>`;
    }).join('');
  }

  // ========== 9. 驾驶舱 ==========
  function renderOverview() {
    const m = Calculator.calculateMetrics(curUnit, getRange());
    $('anaSales').textContent = money(m.salesIncome);
    $('anaRecv').textContent = money(m.receivable);
    $('anaProfit').textContent = money(m.profit);
    $('anaAdded').textContent = money(m.addedValue);
    $('anaUnitAdded').textContent = Currency.fmtRate(m.unitAddedValue);
    $('anaExpense').textContent = money(m.totalExpense);

    // 预警区
    const alerts = detectAlerts();
    const redN = alerts.filter(a => a.level === 'red').length;
    const yelN = alerts.filter(a => a.level === 'yellow').length;
    $('alertBadge').textContent = `${redN} 红 / ${yelN} 黄`;
    $('alertBadge').className = 'alert-badge ' + (redN > 0 ? 'red' : yelN > 0 ? 'yellow' : 'green');
    $('alertList').innerHTML = alerts.length === 0
      ? '<div class="empty-state">🎉 当前没有需要关注的预警</div>'
      : alerts.map(a => `
        <div class="alert-item ${a.level}">
          <span class="alert-dot"></span>
          <div class="alert-body">
            <div class="alert-title">${escapeHtml(a.title)}</div>
            <div class="alert-sub">${escapeHtml(a.sub)}</div>
          </div>
          <a class="alert-link" href="javascript:void(0)" data-jump="${a.jumpTo}" data-anchor="${escapeHtml(a.jumpAnchor)}">查看 →</a>
        </div>`).join('');

    // Top 5 客户（按应收）
    const custRows = buildCustomerMetrics().slice(0, 5);
    $('topCustomers').innerHTML = custRows.length === 0 ? '<div class="empty-state">暂无数据</div>' : `<table class="ana-top-table">
      <thead><tr><th>客户</th><th>销售额</th><th>应收</th></tr></thead>
      <tbody>${custRows.map(c => `<tr data-anchor="customer:${c.id}">
        <td>${escapeHtml(c.name)}</td>
        <td class="amt pos">${money(c.sale)}</td>
        <td class="amt ${c.recv > 0 ? 'neg' : ''}">${money(c.recv)}</td>
      </tr>`).join('')}</tbody></table>`;

    // Top 5 商品（按销售）
    const prodRows = buildProductMetrics().slice(0, 5);
    $('topProducts').innerHTML = prodRows.length === 0 ? '<div class="empty-state">暂无数据</div>' : `<table class="ana-top-table">
      <thead><tr><th>商品</th><th>销售额</th><th>毛利率</th></tr></thead>
      <tbody>${prodRows.map(p => `<tr data-anchor="product:${p.id}">
        <td>${escapeHtml(p.name)}</td>
        <td class="amt pos">${money(p.sale)}</td>
        <td>${(p.gm * 100).toFixed(1)}%</td>
      </tr>`).join('')}</tbody></table>`;
  }

  // ========== 10. 入口 ==========
  function bind() {
    // 单元筛选：事件委托到 document（所有 .ana-unit 共享）
    if (!window._anaBound) {
      window._anaBound = true;
      document.addEventListener('change', (e) => {
        if (e.target.classList && e.target.classList.contains('ana-unit')) {
          curUnit = e.target.value;
          // 同步其他页的 select
          document.querySelectorAll('.ana-unit').forEach(s => { if (s !== e.target) s.value = curUnit; });
          App.refreshAll();
        }
        if (e.target.classList && e.target.classList.contains('ana-period')) {
          const newPeriod = e.target.value;
          // 首次从非自定义切到自定义：把当前 curRange 的起止月份作为自定义默认值
          // 避免 "上年" 选 custom 后 inputs 跳到当前月、数据瞬间清空
          if (newPeriod === 'custom' && curPeriod !== 'custom') {
            if (curRange) {
              if (!curCustomStart) curCustomStart = String(curRange.start).slice(0, 7);
              if (!curCustomEnd)   curCustomEnd   = String(curRange.end).slice(0, 7);
            } else {
              const now = new Date();
              const def = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
              if (!curCustomStart) curCustomStart = def;
              if (!curCustomEnd)   curCustomEnd   = def;
            }
          }
          curPeriod = newPeriod;
          // 同步所有页的 select + 自定义输入框
          document.querySelectorAll('.ana-period').forEach(s => { if (s !== e.target) s.value = curPeriod; });
          document.querySelectorAll('.ana-custom-wrap').forEach(w => {
            w.style.display = curPeriod === 'custom' ? 'inline-flex' : 'none';
          });
          document.querySelectorAll('.ana-start').forEach(s => { s.value = curCustomStart; });
          document.querySelectorAll('.ana-end').forEach(e => { e.value = curCustomEnd; });
          refreshRange();
          App.refreshAll();
        }
        if (e.target.classList && e.target.classList.contains('ana-start')) {
          curCustomStart = e.target.value;
          // 同步其他页的输入框（之前只改一个，refreshRange 读的是隐藏 section 的值）
          document.querySelectorAll('.ana-start').forEach(s => { if (s !== e.target) s.value = curCustomStart; });
          refreshRange();
          App.refreshAll();
        }
        if (e.target.classList && e.target.classList.contains('ana-end')) {
          curCustomEnd = e.target.value;
          document.querySelectorAll('.ana-end').forEach(e => { if (e !== e.target) e.value = curCustomEnd; });
          refreshRange();
          App.refreshAll();
        }
      });
    }
  }

  // 切换到分析页时由 App 调用：同步筛选 UI
  function syncFilters() {
    syncUnitFilters();
    syncPeriodFilters();
  }

  return {
    bind, syncFilters, consumeFocus, tryFlashOnLoad, flashRow,
    renderOverview, renderCustomer, renderProduct, renderContract, renderExpense, renderCash,
    get unit() { return curUnit; }, setUnit(v) { curUnit = v; }
  };
})();
