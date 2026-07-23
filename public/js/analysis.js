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
  // 预警规则（用户可配置，localStorage 持久化）
  const ALERT_RULES_KEY = 'amiba_alert_rules_v1';
  const DEFAULT_ALERT_RULES = [
    { id: 'def-customer-recv-red',    name: '客户大额应收',  scope: 'customer', metric: 'recv',     operator: '>=', threshold: 80000,  threshold2: null, color: 'red',    message: '超过预警阈值，建议立即跟进回款',     enabled: true },
    { id: 'def-customer-recv-yellow', name: '客户中等应收',  scope: 'customer', metric: 'recv',     operator: '>=', threshold: 40000,  threshold2: null, color: 'yellow', message: '需保持关注',                          enabled: true },
    { id: 'def-product-margin',       name: '商品毛利率过低', scope: 'product', metric: 'margin',   operator: '<',  threshold: 0.15,   threshold2: null, color: 'red',    message: '毛利率跌破健康线',                    enabled: true },
    { id: 'def-product-stock',        name: '商品库存呆滞',  scope: 'product', metric: 'stockAge', operator: '>',  threshold: 60,     threshold2: null, color: 'yellow', message: '建议盘点/促销/调拨',                  enabled: true },
    { id: 'def-cash-gap',             name: '净现金流缺口',  scope: 'cash',    metric: 'netCash',  operator: '<',  threshold: -20000, threshold2: null, color: 'red',    message: '现金缺口较大，关注回款',              enabled: true },
  ];
  // 范围/指标/比较符的合法组合（用于配置表单的级联下拉）
  const SCOPE_META = {
    customer: { label: '客户', metrics: {
      recv: { label: '应收金额', unit: '元', operators: ['>=', '<=', '>', '<'] }
    }},
    product: { label: '商品', metrics: {
      margin:   { label: '毛利率',  unit: '0-1', operators: ['<', '<='] },
      stockAge: { label: '库存呆滞天数', unit: '天', operators: ['>', '>='] }
    }},
    cash: { label: '现金流', metrics: {
      netCash: { label: '净现金流', unit: '元', operators: ['<', '<=', '>', '>='] }
    }}
  };
  // 当前预警筛选（看板点击切换）：'all' | 'red' | 'yellow'
  let curAlertFilter = 'all';
  // 模态框内部状态
  let configEditingId = null; // null = 列表态；'new' = 新增；'rule-id' = 编辑某条

  function loadAlertRules() {
    try {
      const raw = localStorage.getItem(ALERT_RULES_KEY);
      // 存在 localStorage key 即视为"已配置"（即使空数组也尊重用户选择）
      // 仅有"key 不存在"或"JSON 损坏"时才用默认
      if (raw !== null) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) { /* 损坏的 JSON 当作无 */ }
    return JSON.parse(JSON.stringify(DEFAULT_ALERT_RULES));
  }
  function saveAlertRules(rules) {
    localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(rules));
  }
  function genRuleId() {
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }
  // 评价一条数值是否命中规则
  function compare(v, op, t) {
    if (op === '>=') return v >= t;
    if (op === '<=') return v <= t;
    if (op === '>')  return v > t;
    if (op === '<')  return v < t;
    if (op === '==') return v === t;
    return false;
  }
  // 把 number 安全转成"对当前 metric 的显示串"
  function fmtMetricValue(v, metric) {
    if (metric === 'margin') return (v * 100).toFixed(1) + '%';
    if (metric === 'stockAge') return Math.floor(v) + ' 天';
    return '¥' + Math.round(v).toLocaleString();
  }
  // 从当前 active rules 提取"客户应收"红/黄阈值（用于明细表的状态徽章）
  function getCustomerRecvThresholds() {
    const rules = loadAlertRules().filter(r => r.enabled && r.scope === 'customer' && r.metric === 'recv');
    const red = rules.filter(r => r.color === 'red').reduce((m, r) => Math.max(m, r.threshold), 0);
    const yellow = rules.filter(r => r.color === 'yellow').reduce((m, r) => Math.max(m, r.threshold), 0);
    return { red, yellow };
  }
  // 从当前 active rules 提取"商品毛利率"红阈值
  function getProductMarginThreshold() {
    const rules = loadAlertRules().filter(r => r.enabled && r.scope === 'product' && r.metric === 'margin');
    if (rules.length === 0) return 0.15; // fallback
    return rules.filter(r => r.color === 'red').reduce((m, r) => Math.min(m, r.threshold), Infinity);
  }
  // 是否有"商品零库存"规则启用
  function hasZeroStockRule() {
    return loadAlertRules().some(r => r.enabled && r.scope === 'product' && r.metric === 'stockZero');
  }

  // 复用看板时间范围
  function getRange() {
    if (curRange) return curRange;
    return Calculator.resolveRange({ quick: curPeriod || 'month' });
  }

  // ========== 1. 经营预警检测 ==========
  // 数据驱动：每条 active rule 都会参与检测，匹配产生一条 alert
  // 预警项 schema: { level, kind, key, title, sub, jumpTo, jumpAnchor }
  function detectAlerts() {
    const txs = Storage.getTransactionsSync({ unit: curUnit, startDate: getRange().start, endDate: getRange().end });
    const customers = Storage.getCustomersSync();
    const products = Storage.getProductsSync();
    const inventory = Storage.getInventorySync();
    const rules = loadAlertRules().filter(r => r.enabled);
    const alerts = [];

    // 预计算公共上下文
    // 客户应收（按客户汇总：销售 - 现金回款）
    const recvByCustomer = {};
    txs.forEach(t => {
      if (!t.customer_id) return;
      if (t.type === '销售收入') recvByCustomer[t.customer_id] = (recvByCustomer[t.customer_id] || 0) + num0(t.amount);
      if (t.type === '现金收入') recvByCustomer[t.customer_id] = (recvByCustomer[t.customer_id] || 0) - num0(t.amount);
    });
    // 商品销售/成本/毛利率（用真实流水口径）
    const productRows = buildProductMetrics();
    // 现金流入流出
    const cashIn = txs.filter(t => t.type === '现金收入').reduce((s, t) => s + num0(t.amount), 0);
    const cashOut = txs.filter(t => t.type === '现金支出').reduce((s, t) => s + Math.abs(num0(t.amount)), 0);

    rules.forEach(rule => {
      // 1) 客户应收类（per-customer）
      if (rule.scope === 'customer' && rule.metric === 'recv') {
        Object.keys(recvByCustomer).forEach(cid => {
          const ar = recvByCustomer[cid];
          if (!compare(ar, rule.operator, rule.threshold)) return;
          const c = customers.find(x => String(x.id) === String(cid));
          if (!c) return;
          alerts.push({
            level: rule.color, kind: 'customer', key: cid, _ruleId: rule.id,
            title: `客户【${c.name}】应收 ${fmtMetricValue(ar, 'recv')}`,
            sub: rule.message,
            jumpTo: 'analysis-customer', jumpAnchor: `customer:${cid}`
          });
        });
      }
      // 2) 商品毛利率类（per-product）
      else if (rule.scope === 'product' && rule.metric === 'margin') {
        productRows.forEach(r => {
          if (r.sale <= 0) return; // 没销售不算
          if (!compare(r.gm, rule.operator, rule.threshold)) return;
          alerts.push({
            level: rule.color, kind: 'product', key: r.id, _ruleId: rule.id,
            title: `商品【${r.name}】毛利率 ${fmtMetricValue(r.gm, 'margin')}`,
            sub: rule.message,
            jumpTo: 'analysis-product', jumpAnchor: `product:${r.id}`
          });
        });
      }
      // 3) 商品库存呆滞类（per-product，按 inventory 行）
      else if (rule.scope === 'product' && rule.metric === 'stockAge') {
        const now = Date.now();
        inventory.forEach(i => {
          const qty = num0(i.quantity);
          if (qty <= 0 || !i.updated_at) return;
          const days = (now - new Date(i.updated_at).getTime()) / 86400000;
          if (!compare(days, rule.operator, rule.threshold)) return;
          alerts.push({
            level: rule.color, kind: 'product', key: i.product_id, _ruleId: rule.id,
            title: `商品【${i.product_name}】库存呆滞 ${Math.floor(days)} 天`,
            sub: rule.message,
            jumpTo: 'analysis-product', jumpAnchor: `product:${i.product_id}`
          });
        });
      }
      // 4) 净现金流类（aggregate）
      else if (rule.scope === 'cash' && rule.metric === 'netCash') {
        const net = cashIn - cashOut;
        if (compare(net, rule.operator, rule.threshold)) {
          alerts.push({
            level: rule.color, kind: 'cash', key: 'net', _ruleId: rule.id,
            title: `净现金流 ${fmtMetricValue(net, 'netCash')}`,
            sub: rule.message,
            jumpTo: 'analysis-cash', jumpAnchor: 'cash-net'
          });
        }
      }
      // 5) 商品零库存（per-product，metric='stockZero'，operator 无意义）
      else if (rule.scope === 'product' && rule.metric === 'stockZero') {
        productRows.forEach(r => {
          if (r.sale > 0 && r.qty === 0) {
            alerts.push({
              level: rule.color, kind: 'product', key: r.id, _ruleId: rule.id,
              title: `商品【${r.name}】零库存`,
              sub: rule.message,
              jumpTo: 'analysis-product', jumpAnchor: `product:${r.id}`
            });
          }
        });
      }
    });

    // 稳定排序：红 → 黄；同色按标题
    alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
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
    const { red: recvRed, yellow: recvYellow } = getCustomerRecvThresholds();
    $('custTable').innerHTML = `<thead><tr><th>客户</th><th>类型</th><th>销售额</th><th>回款</th><th>应收</th><th>最近交易</th><th>状态</th></tr></thead>
      <tbody>${rows.map(r => {
        const stat = r.recv >= recvRed && recvRed > 0 ? '<span class="badge red">应收预警</span>'
                    : r.recv >= recvYellow && recvYellow > 0 ? '<span class="badge yellow">关注</span>'
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
    const marginTh = getProductMarginThreshold();
    const showZeroStock = hasZeroStockRule();
    $('prodTable').innerHTML = `<thead><tr><th>商品</th><th>分类</th><th>销售额</th><th>成本</th><th>毛利率</th><th>库存量</th><th>库存价值</th><th>状态</th></tr></thead>
      <tbody>${rows.map(r => {
        const stat = r.gm < marginTh && r.sale > 0 ? '<span class="badge red">毛利跌破</span>'
                    : r.qty === 0 && r.sale > 0 && showZeroStock ? '<span class="badge yellow">零库存</span>'
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

  // ========== 9. 经营总览 ==========
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
    renderAlertKanban(alerts);
    renderAlertList(alerts);

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

  // ========== 9.1 预警看板（3 卡片：全部 / 红色 / 黄色） ==========
  function renderAlertKanban(alerts) {
    const redN = alerts.filter(a => a.level === 'red').length;
    const yelN = alerts.filter(a => a.level === 'yellow').length;
    $('alertCountAll').textContent = alerts.length;
    $('alertCountRed').textContent = redN;
    $('alertCountYellow').textContent = yelN;
    // 高亮当前筛选卡片
    document.querySelectorAll('#alertKanban .alert-kanban-card').forEach(c => {
      c.classList.toggle('active', c.dataset.color === curAlertFilter);
    });
  }

  // ========== 9.2 预警列表（按 curAlertFilter 过滤） ==========
  function renderAlertList(alerts) {
    const list = curAlertFilter === 'all' ? alerts : alerts.filter(a => a.level === curAlertFilter);
    $('alertList').innerHTML = list.length === 0
      ? '<div class="empty-state">🎉 当前没有需要关注的预警</div>'
      : list.map(a => `
        <div class="alert-item ${a.level}">
          <span class="alert-dot"></span>
          <div class="alert-body">
            <div class="alert-title">${escapeHtml(a.title)}</div>
            <div class="alert-sub">${escapeHtml(a.sub)}</div>
          </div>
          <a class="alert-link" href="javascript:void(0)" data-jump="${a.jumpTo}" data-anchor="${escapeHtml(a.jumpAnchor)}">查看 →</a>
        </div>`).join('');
  }

  // 点击看板切换筛选（在 bind 中委托到 document）
  function setAlertFilter(color) {
    curAlertFilter = color;
    document.querySelectorAll('#alertKanban .alert-kanban-card').forEach(c => {
      c.classList.toggle('active', c.dataset.color === color);
    });
    renderAlertList(detectAlerts());
  }

  // ========== 9.3 预警配置模态框 ==========
  function openAlertConfig() {
    configEditingId = null;
    $('alertConfigOverlay').style.display = 'flex';
    renderConfigList();
  }
  function closeAlertConfig() {
    $('alertConfigOverlay').style.display = 'none';
    configEditingId = null;
  }
  // 列表态：所有规则的表格
  function renderConfigList() {
    const rules = loadAlertRules();
    configEditingId = null;
    const html = `
      <div style="padding:16px 20px 0;">
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">配置预警规则后，预警区与本页所有状态徽章会即时更新</div>
        <table class="data-table rule-table">
          <thead><tr>
            <th style="width:90px;">状态</th>
            <th>名称</th>
            <th style="width:110px;">范围</th>
            <th style="width:180px;">条件</th>
            <th style="width:80px;">颜色</th>
            <th style="width:80px;">启用</th>
            <th style="width:130px;">操作</th>
          </tr></thead>
          <tbody>
            ${rules.length === 0 ? '<tr><td colspan="7" class="empty-state">还没有任何预警条件，点击下方按钮新增</td></tr>'
              : rules.map(r => {
                const scopeLabel = SCOPE_META[r.scope] ? SCOPE_META[r.scope].label : r.scope;
                const metricLabel = SCOPE_META[r.scope] && SCOPE_META[r.scope].metrics[r.metric]
                  ? SCOPE_META[r.scope].metrics[r.metric].label : r.metric;
                const condText = r.metric === 'stockZero'
                  ? '本期有销售但当前库存 = 0'
                  : `${metricLabel} ${r.operator} ${r.metric === 'margin' ? (r.threshold * 100).toFixed(0) + '%' : r.threshold.toLocaleString()}`;
                return `<tr>
                  <td><span class="dot ${r.enabled ? 'on' : 'off'}"></span>${r.enabled ? '已启用' : '已停用'}</td>
                  <td><strong>${escapeHtml(r.name)}</strong></td>
                  <td>${scopeLabel} / ${metricLabel}</td>
                  <td><code>${escapeHtml(condText)}</code></td>
                  <td><span class="alert-dot" style="background:${r.color === 'red' ? '#ef4444' : '#f59e0b'}"></span>${r.color === 'red' ? '红' : '黄'}</td>
                  <td><label class="switch"><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="Analysis.toggleRule('${r.id}', this.checked)"><span class="slider"></span></label></td>
                  <td>
                    <button class="btn btn-secondary btn-sm" onclick="Analysis.openRuleForm('${r.id}')">编辑</button>
                    <button class="btn btn-secondary btn-sm" style="color:#dc2626;" onclick="Analysis.confirmDeleteRule('${r.id}')">删除</button>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;background:#f8fafc;">
        <span style="font-size:12px;color:#94a3b8;">共 ${rules.length} 条规则</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="Analysis.closeAlertConfig()">关闭</button>
          <button class="btn btn-primary" onclick="Analysis.openRuleForm('new')">+ 新增预警条件</button>
        </div>
      </div>`;
    $('alertConfigBody').innerHTML = html;
  }

  // 表单态：编辑/新增
  function openRuleForm(idOrNew) {
    const rules = loadAlertRules();
    const isNew = idOrNew === 'new';
    const r = isNew
      ? { id: '', name: '', scope: 'customer', metric: 'recv', operator: '>=', threshold: 0, color: 'red', message: '', enabled: true }
      : rules.find(x => x.id === idOrNew);
    if (!r) { App.toast('未找到该规则', 'error'); return; }
    configEditingId = isNew ? 'new' : r.id;

    const scopeOptions = Object.keys(SCOPE_META).map(k =>
      `<option value="${k}" ${k === r.scope ? 'selected' : ''}>${SCOPE_META[k].label}</option>`).join('');
    const html = `
      <div style="padding:18px 20px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:14px;">${isNew ? '新增预警条件' : '编辑预警条件'}</div>
        <form id="ruleForm" onsubmit="return false;">
          <div class="rule-form-row">
            <label>名称 <span style="color:#dc2626;">*</span></label>
            <input class="form-input" name="name" required value="${escapeHtml(r.name)}" placeholder="例：客户大额应收">
          </div>
          <div class="rule-form-row rule-form-grid">
            <div>
              <label>范围</label>
              <select class="form-select" name="scope" id="ruleScopeSel" onchange="Analysis.onRuleScopeChange()">${scopeOptions}</select>
            </div>
            <div>
              <label>指标</label>
              <select class="form-select" name="metric" id="ruleMetricSel"></select>
            </div>
            <div>
              <label>比较符</label>
              <select class="form-select" name="operator" id="ruleOpSel"></select>
            </div>
          </div>
          <div class="rule-form-row" id="ruleThWrap">
            <label>阈值 <span id="ruleThUnit" style="color:#94a3b8;font-weight:normal;"></span></label>
            <input class="form-input" name="threshold" type="number" step="any" value="${r.threshold}" placeholder="数字">
          </div>
          <div class="rule-form-row">
            <label>颜色</label>
            <div style="display:flex;gap:12px;align-items:center;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="radio" name="color" value="red" ${r.color === 'red' ? 'checked' : ''}>
                <span class="alert-dot" style="background:#ef4444;"></span> 红色（需立即处理）
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="radio" name="color" value="yellow" ${r.color === 'yellow' ? 'checked' : ''}>
                <span class="alert-dot" style="background:#f59e0b;"></span> 黄色（需保持关注）
              </label>
            </div>
          </div>
          <div class="rule-form-row">
            <label>消息模板</label>
            <input class="form-input" name="message" value="${escapeHtml(r.message)}" placeholder="例：超过预警阈值，建议立即跟进回款">
          </div>
          <div class="rule-form-row">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" name="enabled" ${r.enabled ? 'checked' : ''}> 启用此规则
            </label>
          </div>
        </form>
      </div>
      <div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc;">
        <button class="btn btn-secondary" onclick="Analysis.renderConfigList()">返回列表</button>
        <button class="btn btn-primary" onclick="Analysis.saveRuleForm()">保存</button>
      </div>`;
    $('alertConfigBody').innerHTML = html;
    onRuleScopeChange();
  }

  // scope 切换时，重建 metric/operator 下拉
  function onRuleScopeChange() {
    const scope = $('ruleScopeSel').value;
    const cur = loadAlertRules().find(x => x.id === configEditingId) || { metric: 'recv', operator: '>=' };
    // 仍尝试从当前 form 取已选 metric（用户中途改 scope 时保留其选择）
    const existingMetric = $('ruleMetricSel').value;
    const existingOp = $('ruleOpSel').value;
    const metrics = SCOPE_META[scope] ? Object.keys(SCOPE_META[scope].metrics) : [];
    const metricKey = metrics.includes(existingMetric) ? existingMetric : (metrics.includes(cur.metric) ? cur.metric : metrics[0]);
    $('ruleMetricSel').innerHTML = metrics.map(m =>
      `<option value="${m}" ${m === metricKey ? 'selected' : ''}>${SCOPE_META[scope].metrics[m].label}</option>`).join('');
    onRuleMetricChange();
  }
  function onRuleMetricChange() {
    const scope = $('ruleScopeSel').value;
    const metric = $('ruleMetricSel').value;
    const meta = SCOPE_META[scope] && SCOPE_META[scope].metrics[metric];
    if (!meta) return;
    const cur = loadAlertRules().find(x => x.id === configEditingId) || { operator: meta.operators[0] };
    const existingOp = $('ruleOpSel').value;
    const op = meta.operators.includes(existingOp) ? existingOp : (meta.operators.includes(cur.operator) ? cur.operator : meta.operators[0]);
    $('ruleOpSel').innerHTML = meta.operators.map(o =>
      `<option value="${o}" ${o === op ? 'selected' : ''}>${o}</option>`).join('');
    $('ruleThUnit').textContent = meta.unit === '0-1' ? '（0~1 之间的比例，如 0.15 = 15%）' : meta.unit;
    // stockZero 类型隐藏阈值
    $('ruleThWrap').style.display = metric === 'stockZero' ? 'none' : '';
  }
  // 暴露给 scope select 的 onchange
  window._analysisRuleScopeChange = onRuleScopeChange;
  window._analysisRuleMetricChange = onRuleMetricChange;

  function saveRuleForm() {
    const form = $('ruleForm');
    if (!form) return;
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    if (!name) { App.toast('请填写名称', 'warn'); return; }
    const scope = fd.get('scope').toString();
    const metric = fd.get('metric').toString();
    const operator = fd.get('operator').toString();
    let threshold = parseFloat(fd.get('threshold'));
    if (isNaN(threshold) && metric !== 'stockZero') { App.toast('请填写有效阈值', 'warn'); return; }
    if (metric === 'stockZero') threshold = 0;
    const color = fd.get('color').toString();
    const message = (fd.get('message') || '').toString().trim() || '需要关注';
    const enabled = !!fd.get('enabled');

    const rules = loadAlertRules();
    if (configEditingId === 'new') {
      rules.push({ id: genRuleId(), name, scope, metric, operator, threshold, threshold2: null, color, message, enabled });
      App.toast('已新增预警条件', 'success');
    } else {
      const idx = rules.findIndex(r => r.id === configEditingId);
      if (idx === -1) { App.toast('规则不存在', 'error'); return; }
      rules[idx] = { ...rules[idx], name, scope, metric, operator, threshold, color, message, enabled };
      App.toast('已保存', 'success');
    }
    saveAlertRules(rules);
    renderConfigList();
    App.refreshAll();
  }

  function toggleRule(id, enabled) {
    const rules = loadAlertRules();
    const r = rules.find(x => x.id === id);
    if (!r) return;
    r.enabled = !!enabled;
    saveAlertRules(rules);
    App.refreshAll();
  }

  function confirmDeleteRule(id) {
    const rules = loadAlertRules();
    const r = rules.find(x => x.id === id);
    if (!r) return;
    App.openModal('删除预警条件', `确定删除 <strong>${escapeHtml(r.name)}</strong> 吗？此操作不可撤销。`, async () => {
      saveAlertRules(rules.filter(x => x.id !== id));
      App.toast('已删除', 'success');
      App.closeModal();
      renderConfigList();
      App.refreshAll();
    });
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
        // 预警配置：表单内的 scope/metric 切换（用 onchange 触发，但在委托里也兜底）
        if (e.target && e.target.id === 'ruleScopeSel') onRuleScopeChange();
        if (e.target && e.target.id === 'ruleMetricSel') onRuleMetricChange();
      });
      // 预警看板点击（事件委托，避开数据变化重渲染导致的 listener 丢失）
      document.addEventListener('click', (e) => {
        const card = e.target.closest && e.target.closest('.alert-kanban-card');
        if (card && card.dataset && card.dataset.color) {
          setAlertFilter(card.dataset.color);
          return;
        }
        // 预警配置按钮
        if (e.target && e.target.id === 'alertConfigBtn') {
          openAlertConfig();
          return;
        }
        // 预警遮罩点击关闭
        if (e.target && e.target.id === 'alertConfigOverlay') {
          closeAlertConfig();
          return;
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
    openAlertConfig, closeAlertConfig, renderConfigList, openRuleForm, saveRuleForm, toggleRule, confirmDeleteRule,
    setAlertFilter, onRuleScopeChange, onRuleMetricChange, loadAlertRules, saveAlertRules,
    get unit() { return curUnit; }, setUnit(v) { curUnit = v; }
  };
})();
