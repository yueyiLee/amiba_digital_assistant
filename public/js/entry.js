/**
 * entry.js — 录入页面（PRD 5.2）
 * 左侧 5 步引导式收支录入表单，右侧最近录入记录列表。
 */
const Entry = (() => {
  let direction = 'expense'; // expense / income

  // 联动规则来自后端 expense_types 配置（link_customer / link_product / link_cat）
  function getLinkCfg(typeName, dir) {
    const t = Storage.getExpenseTypesSync(dir, { enabledOnly: false }).find(x => x.name === typeName);
    if (!t) return { customer: true, product: true, cat: null };
    return { customer: !!t.link_customer, product: !!t.link_product, cat: t.link_cat || null };
  }

  // 根据当前方向 + 交易类型，显示/隐藏 客户 / 商品 / 支出项细分 字段，并填充对应选项
  function applyTypeLinkage() {
    const type = document.getElementById('entryType').value;
    const cfg = getLinkCfg(type, direction);

    const custGroup = document.getElementById('entryCustomerGroup');
    const prodGroup = document.getElementById('entryProductGroup');
    const catGroup = document.getElementById('entryExpenseCatGroup');
    const catSel = document.getElementById('entryExpenseCat');

    custGroup.style.display = cfg.customer ? '' : 'none';
    prodGroup.style.display = cfg.product ? '' : 'none';

    if (cfg.cat) {
      catGroup.style.display = '';
      document.getElementById('entryExpenseCatLabel').textContent =
        (cfg.cat === 'processing' ? '加工类别' : '杂费类别') + ' (必选)';
      const items = Storage.getExpenseItemsSync(cfg.cat);
      catSel.innerHTML = items.length
        ? items.map(i => `<option value="${i.name}">${escapeHtml(i.name)}</option>`).join('')
        : '<option value="">（暂无可选类别）</option>';
    } else {
      catGroup.style.display = 'none';
      catSel.innerHTML = '';
    }

    // 隐藏的字段清空已选值，避免提交时带入脏数据
    if (!cfg.customer) {
      document.getElementById('entryCustomerId').value = '';
      document.getElementById('entryCustomerInput').value = '';
    }
    if (!cfg.product) {
      document.getElementById('entryProductId').value = '';
      document.getElementById('entryProductInput').value = '';
    }
  }

  // 收支录入页：仅渲染录入表单（左半）
  function renderAdd() {
    renderTypeOptions();
    applyTypeLinkage();
    renderUnitOptions();
    // 更新金额符号为设置中的货币
    document.querySelector('.amount-wrap .cur').textContent = Calculator.getCurrency();
    // 默认日期为今天
    document.getElementById('entryDate').value = new Date().toISOString().slice(0, 10);
  }

  // 收支查询页：填充筛选下拉并渲染记录列表（右半）
  function renderQuery() {
    renderTypeOptionsForQuery();
    renderCategoryFilter();
    renderRecords();
  }

  // 录入表单刷新（供其他模块新增客户/商品后同步下拉）
  function render() { renderAdd(); }

  function renderTypeOptions() {
    const sel = document.getElementById('entryType');
    const types = Storage.getExpenseTypesSync(direction, { enabledOnly: true });
    sel.innerHTML = types.length
      ? types.map(t => `<option>${escapeHtml(t.name)}</option>`).join('')
      : '<option value="">（暂无可用类型）</option>';
  }

  // 收支查询页的"类型"多选 chips：根据当前方向显示对应类型，默认全选
  function renderTypeChips() {
    const container = document.getElementById('recTypeChips');
    const allCb = document.querySelector('#recTypeAll input');
    if (!container) return;
    const types = Storage.getExpenseTypesSync(recFilters.dir || null, { enabledOnly: true });

    // 若当前已选类型与当前方向有交集则保留，否则默认全选
    const selected = (recFilters.type && recFilters.type.length > 0)
      ? recFilters.type.filter(t => types.some(x => x.name === t))
      : types.map(t => t.name);
    recFilters.type = selected;

    container.innerHTML = types.map(t => `
      <label class="type-chip">
        <input type="checkbox" value="${escapeHtml(t.name)}" ${selected.includes(t.name) ? 'checked' : ''}>
        <span>${escapeHtml(t.name)}</span>
      </label>
    `).join('');

    // 同步全选总控状态
    if (allCb) allCb.checked = types.length > 0 && selected.length === types.length;

    // 绑定多选事件
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const vals = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
        recFilters.type = vals;
        if (allCb) allCb.checked = types.length > 0 && vals.length === types.length;
        recPage = 1;
        renderRecords();
      });
    });
  }

  // 绑定费用类型「全选」总控
  function bindTypeAllToggle() {
    const allChip = document.getElementById('recTypeAll');
    if (!allChip) return;
    allChip.addEventListener('change', (e) => {
      const input = allChip.querySelector('input[type="checkbox"]');
      const checked = input ? input.checked : e.target.checked;
      const container = document.getElementById('recTypeChips');
      const types = Storage.getExpenseTypesSync(recFilters.dir || null, { enabledOnly: true });
      if (container) container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
      recFilters.type = checked ? types.map(t => t.name) : [];
      recPage = 1;
      renderRecords();
    });
  }

  function renderTypeOptionsForQuery() { renderTypeChips(); }

  // 收支查询页：杂费类别下拉，仅在「全部方向」或「支出」时展示
  function renderCategoryFilter() {
    const sel = document.getElementById('recCategory');
    const label = document.getElementById('recCategoryLabel');
    if (!sel || !label) return;
    const visible = !recFilters.dir || recFilters.dir === 'expense';
    label.style.display = visible ? '' : 'none';
    sel.style.display = visible ? '' : 'none';
    if (!visible) { recFilters.category = ''; sel.value = ''; return; }

    const items = Storage.getExpenseItemsSync('misc');
    const current = recFilters.category || '';
    const options = ['<option value="">全部杂费类别</option>']
      .concat(items.map(i => `<option value="${escapeHtml(i.name)}"${i.name === current ? ' selected' : ''}>${escapeHtml(i.name)}</option>`));
    sel.innerHTML = options.join('');
  }

  function renderUnitOptions() {
    const sel = document.getElementById('entryUnit');
    const units = Storage.getUnitList();
    sel.innerHTML = units.map(u => `<option>${u}</option>`).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // 可搜索下拉（combobox）：外层固定下拉框，输入即模糊匹配，结果在框内展示。
  // getOptions 返回 [{id, name}]，每次展开时实时读取，保证数据最新。
  function setupCombobox(inputId, panelId, hiddenId, getOptions) {
    const input = document.getElementById(inputId);
    const panel = document.getElementById(panelId);
    const hidden = document.getElementById(hiddenId);
    if (!input || !panel || !hidden) return;
    function render() {
      const opts = getOptions() || [];
      const q = (input.value || '').toLowerCase();
      const filtered = q ? opts.filter(o => (o.name || '').toLowerCase().includes(q)) : opts;
      const all = [{ id: '', name: '— 不关联 —' }].concat(filtered);
      panel.innerHTML = all.map(o =>
        `<div class="cb-option${o.id !== '' && String(o.id) === String(hidden.value) ? ' selected' : ''}" data-id="${o.id}">${escapeHtml(o.name)}</div>`
      ).join('');
      panel.querySelectorAll('.cb-option').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hidden.value = el.dataset.id;
          input.value = el.dataset.id ? el.textContent : '';
          panel.classList.remove('open');
          input.blur();
        });
      });
      panel.classList.add('open');
    }
    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('blur', () => setTimeout(() => panel.classList.remove('open'), 150));
    hidden.value = '';
  }

  function setDirection(dir) {
    direction = dir;
    const expBtn = document.getElementById('dirExpense');
    const incBtn = document.getElementById('dirIncome');
    const sign = document.getElementById('entrySign');
    if (dir === 'expense') {
      expBtn.classList.add('active'); incBtn.classList.remove('active');
      sign.textContent = '−'; sign.style.color = '#dc2626'; sign.style.background = '#fef2f2';
    } else {
      incBtn.classList.add('active'); expBtn.classList.remove('active');
      sign.textContent = '+'; sign.style.color = '#059669'; sign.style.background = '#ecfdf5';
    }
    renderTypeOptions();
    applyTypeLinkage();
  }

  async function submit() {
    const type = document.getElementById('entryType').value;
    const amount = parseFloat(document.getElementById('entryAmount').value);
    const unit = document.getElementById('entryUnit').value;
    const customerId = document.getElementById('entryCustomerId').value || null;
    const productId = document.getElementById('entryProductId').value || null;
    const date = document.getElementById('entryDate').value;
    const note = document.getElementById('entryNote').value;

    if (!type) return App.toast('请选择交易类型', 'error');
    if (!amount || amount <= 0) return App.toast('金额必须为有效正数', 'error');
    if (!date) return App.toast('请选择日期', 'error');

    // 支出项细分：由后端类型配置决定（link_cat）
    const linkCfg = getLinkCfg(type, direction);
    const category = linkCfg.cat
      ? (document.getElementById('entryExpenseCat').value || null)
      : null;

    // 方向决定正负：收入 Math.abs，支出 -Math.abs
    const signedAmount = direction === 'income' ? Math.abs(amount) : -Math.abs(amount);

    try {
      await API.post('/transactions', {
        amount: signedAmount, type, unit,
        customer_id: customerId ? Number(customerId) : null,
        product_id: productId ? Number(productId) : null,
        date, note, category
      });
      await Storage.refreshCache();
      // 重置表单
      document.getElementById('entryAmount').value = '';
      document.getElementById('entryNote').value = '';
      recPage = 1; // 新录入跳回第一页，立即看到刚加的记录
      renderRecords();
      App.toast('录入成功', 'success');
      // 通知看板刷新
      if (App.currentPage === 'dashboard') Dashboard.render();
    } catch (err) {
      App.toast('录入失败：' + err.message, 'error');
    }
  }

  // 记录列表：筛选（方向 / 类型 / 日期区间 / 客户 / 商品 / 金额范围）+ 分页
  let recPage = 1;
  const REC_PAGE_SIZE = 15;
  let lastQueryRows = [];
  const recFilters = { dir: '', type: [], category: '', dateStart: '', dateEnd: '', customer: '', product: '', amtMin: '', amtMax: '' };

  function computeRangeDates(range) {
    if (!range) return { start: null, end: null };
    const now = new Date();
    const y = now.getFullYear();
    if (range === 'year') return { start: `${y}-01-01`, end: `${y}-12-31` };
    if (range === 'month') {
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const last = new Date(y, now.getMonth() + 1, 0).getDate();
      return { start: `${y}-${m}-01`, end: `${y}-${m}-${last}` };
    }
    if (range === 'quarter') {
      const ms = [0, 3, 6, 9];
      const startM = ms[Math.floor(now.getMonth() / 3)];
      const endM = startM + 2;
      const last = new Date(y, endM + 1, 0).getDate();
      return { start: `${y}-${String(startM + 1).padStart(2, '0')}-01`, end: `${y}-${String(endM + 1).padStart(2, '0')}-${last}` };
    }
    return { start: null, end: null };
  }

  // 重置收支查询：清空所有筛选条件，展示全部记录
  function resetFilters() {
    recFilters.dir = '';
    recFilters.type = [];
    recFilters.category = '';
    recFilters.dateStart = '';
    recFilters.dateEnd = '';
    recFilters.customer = '';
    recFilters.product = '';
    recFilters.amtMin = '';
    recFilters.amtMax = '';
    recPage = 1;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('recDir', '');
    setVal('recDateStart', '');
    setVal('recDateEnd', '');
    setVal('recCustomer', '');
    setVal('recProduct', '');
    setVal('recAmtMin', '');
    setVal('recAmtMax', '');
    renderTypeChips(); // 重置方向后重新生成类型 chips（全部类型全选）
    renderCategoryFilter(); // 重置后展示杂费类别
    renderRecords();
  }

  function renderRecords() {
    const f = recFilters;
    // 1) 类型 + 日期区间交给 Storage 过滤（走后端语义）
    let list = Storage.getTransactionsSync({
      type: null,
      startDate: f.dateStart || null,
      endDate: f.dateEnd || null
    });
    // 2) 收支方向
    if (f.dir === 'income') list = list.filter(t => t.amount > 0);
    else if (f.dir === 'expense') list = list.filter(t => t.amount < 0);
    // 3) 费用类型多选（空数组=不匹配任何类型，配合「全选」总控实现快速反选）
    if (f.type) list = list.filter(t => f.type.includes(t.type));
    // 3.1) 杂费类别筛选（仅对支出类记录生效；收入类记录 category 为空，不会被误过滤）
    if (f.category) list = list.filter(t => t.category === f.category);
    // 3) 客户名称模糊
    const cust = (f.customer || '').trim().toLowerCase();
    if (cust) list = list.filter(t => (t.customer_name || '').toLowerCase().includes(cust));
    // 4) 商品名称模糊
    const prod = (f.product || '').trim().toLowerCase();
    if (prod) list = list.filter(t => (t.product_name || '').toLowerCase().includes(prod));
    // 5) 金额范围（绝对值）
    const amtMin = parseFloat(f.amtMin), amtMax = parseFloat(f.amtMax);
    if (!isNaN(amtMin)) list = list.filter(t => Math.abs(t.amount) >= amtMin);
    if (!isNaN(amtMax)) list = list.filter(t => Math.abs(t.amount) <= amtMax);
    // 记录当前查询结果（供导出使用）
    lastQueryRows = list.slice();
    // 6) 按 id 降序（创建时间倒序）
    list.sort((a, b) => b.id - a.id);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / REC_PAGE_SIZE));
    if (recPage > totalPages) recPage = totalPages;
    const pageItems = list.slice((recPage - 1) * REC_PAGE_SIZE, recPage * REC_PAGE_SIZE);

    document.getElementById('entryCount').textContent = `(共 ${total} 条)`;
    const container = document.getElementById('entryRecords');
    if (pageItems.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无匹配记录</div>';
    } else {
      container.innerHTML = pageItems.map(t => {
        const isPos = t.amount > 0;
        const parts = [];
        parts.push(t.date);
        if (t.customer_name) parts.push(t.customer_name);
        if (t.product_name) parts.push(t.product_name);
        if (t.category) parts.push(t.category);
        if (t.note) parts.push(t.note);
        const opTime = t.created_at ? t.created_at.replace('T', ' ').substring(0, 16) : '';
        return `<div class="record-item">
          <div class="r-left">
            <div class="r-type">${escapeHtml(t.type)}<span class="r-unit">${escapeHtml(t.unit)}</span></div>
            <div class="r-date">${parts.map(escapeHtml).join(' · ')}${opTime ? '　<span class="r-opt">录入于 ' + opTime + '</span>' : ''}</div>
          </div>
          <div class="r-amt ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : '−'}${Calculator.fmtMoney(Math.abs(t.amount))}</div>
          ${Auth.canEdit() ? `<button class="btn btn-secondary btn-sm r-edit" onclick="Entry.edit(${t.id})">编辑</button><button class="btn btn-danger btn-sm r-del" onclick="Entry.del(${t.id})">删</button>` : ''}
        </div>`;
      }).join('');
    }
    renderPager(totalPages);
  }

  function renderPager(totalPages) {
    const p = document.getElementById('recPager');
    if (!p) return;
    if (totalPages <= 1) { p.innerHTML = ''; return; }
    p.innerHTML = `
      <button class="btn btn-sm ${recPage <= 1 ? 'disabled' : ''}" id="recPrev">上一页</button>
      <span class="rec-page-info">第 ${recPage} / ${totalPages} 页</span>
      <button class="btn btn-sm ${recPage >= totalPages ? 'disabled' : ''}" id="recNext">下一页</button>`;
    const prev = document.getElementById('recPrev');
    const next = document.getElementById('recNext');
    if (prev && recPage > 1) prev.onclick = () => { recPage--; renderRecords(); };
    if (next && recPage < totalPages) next.onclick = () => { recPage++; renderRecords(); };
  }

  // 编辑收支记录：弹窗表单，方向随交易类型自动判定（支出类为负、收入类为正）
  function edit(id) {
    const rec = Storage.getTransactionsSync().find(t => t.id === id);
    if (!rec) return App.toast('记录不存在', 'error');
    const isIncome = rec.amount > 0;
    const typeOptions = Storage.getExpenseTypesSync(isIncome ? 'income' : 'expense', { enabledOnly: false }).map(t => t.name);
    const units = Storage.getUnitList();
    const customers = Storage.getCustomerOptions();
    const products = Storage.getProductOptions();

    const body = `
      <div class="form-group"><label class="form-label">交易类型 <span class="req">*</span></label>
        <select class="form-select" id="e-type">${typeOptions.map(t => `<option${t === rec.type ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">金额 <span class="req">*</span></label>
        <input type="number" class="form-input" id="e-amount" min="0" step="0.01" value="${Math.abs(rec.amount)}"></div>
      <div class="form-group"><label class="form-label">归属单元</label>
        <select class="form-select" id="e-unit">${units.map(u => `<option${u === rec.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="form-group" id="e-catGroup" style="display:none;"><label class="form-label" id="e-catLabel">类别</label>
        <select class="form-select" id="e-category"></select></div>
      <div class="form-group" id="e-custGroup"><label class="form-label">客户 <span class="opt">(可选)</span></label>
        <select class="form-select" id="e-customer"><option value="">— 不关联 —</option>${customers.map(c => `<option value="${c.id}"${c.id === rec.customer_id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group" id="e-prodGroup"><label class="form-label">商品 <span class="opt">(可选)</span></label>
        <select class="form-select" id="e-product"><option value="">— 不关联 —</option>${products.map(p => `<option value="${p.id}"${p.id === rec.product_id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">日期 <span class="req">*</span></label>
        <input type="date" class="form-input" id="e-date" value="${rec.date || ''}"></div>
      <div class="form-group"><label class="form-label">备注</label>
        <input type="text" class="form-input" id="e-note" value="${escapeHtml(rec.note || '')}"></div>`;

    App.openModal('编辑收支记录', body, async () => {
      const type = document.getElementById('e-type').value;
      const amount = parseFloat(document.getElementById('e-amount').value);
      if (!amount || amount <= 0) return App.toast('金额必须为有效正数', 'error');
      const date = document.getElementById('e-date').value;
      if (!date) return App.toast('请选择日期', 'error');
      const cfg = getLinkCfg(type, isIncome ? 'income' : 'expense');
      const category = cfg.cat ? (document.getElementById('e-category').value || null) : null;
      const customerId = cfg.customer ? (document.getElementById('e-customer').value || null) : null;
      const productId = cfg.product ? (document.getElementById('e-product').value || null) : null;
      const signedAmount = isIncome ? Math.abs(amount) : -Math.abs(amount);
      await API.put('/transactions/' + id, {
        amount: signedAmount, type, unit: document.getElementById('e-unit').value,
        customer_id: customerId ? Number(customerId) : null,
        product_id: productId ? Number(productId) : null,
        date, note: document.getElementById('e-note').value, category
      });
      await Storage.refreshCache();
      renderRecords();
      App.closeModal();
      App.toast('记录已更新', 'success');
      if (App.currentPage === 'dashboard') Dashboard.render();
    });

    // 类型联动：显示/隐藏客户、商品、类别，并回填当前类别
    const applyEditLinkage = () => {
      const type = document.getElementById('e-type').value;
      const cfg = getLinkCfg(type, isIncome ? 'income' : 'expense');
      document.getElementById('e-custGroup').style.display = cfg.customer ? '' : 'none';
      document.getElementById('e-prodGroup').style.display = cfg.product ? '' : 'none';
      const catGroup = document.getElementById('e-catGroup');
      const catSel = document.getElementById('e-category');
      if (cfg.cat) {
        catGroup.style.display = '';
        document.getElementById('e-catLabel').textContent = (cfg.cat === 'processing' ? '加工类别' : '杂费类别');
        const items = Storage.getExpenseItemsSync(cfg.cat);
        catSel.innerHTML = items.length
          ? items.map(i => `<option value="${escapeHtml(i.name)}"${i.name === rec.category ? ' selected' : ''}>${escapeHtml(i.name)}</option>`).join('')
          : '<option value="">（暂无可选类别）</option>';
      } else {
        catGroup.style.display = 'none';
        catSel.innerHTML = '';
      }
    };
    applyEditLinkage();
    document.getElementById('e-type').addEventListener('change', applyEditLinkage);
  }

  async function del(id) {
    if (!confirm('确认删除该条记录？')) return;
    try {
      await API.del('/transactions/' + id);
      await Storage.refreshCache();
      renderRecords();
      App.toast('已删除', 'success');
      if (App.currentPage === 'dashboard') Dashboard.render();
    } catch (err) {
      App.toast('删除失败：' + err.message, 'error');
    }
  }

  function bind() {
    document.getElementById('dirExpense').addEventListener('click', () => setDirection('expense'));
    document.getElementById('dirIncome').addEventListener('click', () => setDirection('income'));
    document.getElementById('entrySubmit').addEventListener('click', submit);
    document.getElementById('entryType').addEventListener('change', applyTypeLinkage);
    // 收支查询筛选
    const bindFilter = (id, key, evt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(evt, (e) => { recFilters[key] = e.target.value; recPage = 1; renderRecords(); });
    };
    // 收支方向变化时联动类型 chips 与杂费类别筛选
    const recDirEl = document.getElementById('recDir');
    if (recDirEl) {
      recDirEl.addEventListener('change', (e) => {
        recFilters.dir = e.target.value;
        recPage = 1;
        renderTypeChips();
        // 切换到收入方向时清空杂费类别筛选
        if (recFilters.dir === 'income') { recFilters.category = ''; }
        renderCategoryFilter();
        renderRecords();
      });
    }
    bindFilter('recDateStart', 'dateStart', 'change');
    bindFilter('recDateEnd', 'dateEnd', 'change');
    bindFilter('recCustomer', 'customer', 'input');
    bindFilter('recProduct', 'product', 'input');
    bindFilter('recAmtMin', 'amtMin', 'input');
    bindFilter('recAmtMax', 'amtMax', 'input');
    const recCategoryEl = document.getElementById('recCategory');
    if (recCategoryEl) {
      recCategoryEl.addEventListener('change', (e) => { recFilters.category = e.target.value; recPage = 1; renderRecords(); });
    }
    bindTypeAllToggle();
    const recResetBtn = document.getElementById('recResetBtn');
    if (recResetBtn) recResetBtn.addEventListener('click', resetFilters);
    // 客户 / 商品 可搜索下拉（combobox），每次展开实时读取最新数据
    setupCombobox('entryCustomerInput', 'entryCustomerPanel', 'entryCustomerId', () => Storage.getCustomerOptions());
    setupCombobox('entryProductInput', 'entryProductPanel', 'entryProductId', () => Storage.getProductOptions());
  }

  // 返回当前收支查询结果（供导出使用）
  function getQueryRows() { return lastQueryRows; }

  return { render, renderAdd, renderQuery, renderRecords, bind, del, edit, getQueryRows };
})();
