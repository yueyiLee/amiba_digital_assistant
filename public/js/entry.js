/**
 * entry.js — 录入页面（PRD 5.2）
 * 左侧 5 步引导式收支录入表单，右侧最近录入记录列表。
 */
const Entry = (() => {
  let direction = 'expense'; // expense / income

  const TYPE_MAP = {
    expense: ['材料采购', '委托加工', '杂费支出', '税金'],
    income: ['销售收入', '现金收入', '其他收入']
  };

  // 支出类型 → 表单项联动配置
  // customer/product：是否显示客户/商品；cat：显示哪个支出项细分下拉（'processing' 委托加工 | 'misc' 杂费）
  const EXPENSE_LINKAGE = {
    '材料采购': { customer: true, product: true, cat: null },
    '委托加工': { customer: true, product: false, cat: 'processing' },
    '杂费支出': { customer: false, product: false, cat: 'misc' },
    '税金': { customer: true, product: true, cat: null }
  };

  // 根据当前方向 + 交易类型，显示/隐藏 客户 / 商品 / 支出项细分 字段，并填充对应选项
  function applyTypeLinkage() {
    const type = document.getElementById('entryType').value;
    const cfg = direction === 'income'
      ? { customer: true, product: true, cat: null }
      : (EXPENSE_LINKAGE[type] || { customer: true, product: true, cat: null });

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

  function render() {
    renderTypeOptions();
    applyTypeLinkage();
    renderUnitOptions();
    // 更新金额符号为设置中的货币
    document.querySelector('.amount-wrap .cur').textContent = Calculator.getCurrency();
    // 默认日期为今天
    document.getElementById('entryDate').value = new Date().toISOString().slice(0, 10);
    renderRecords();
  }

  function renderTypeOptions() {
    const sel = document.getElementById('entryType');
    sel.innerHTML = TYPE_MAP[direction].map(t => `<option>${t}</option>`).join('');
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

    // 支出项细分：委托加工→加工类别；杂费支出→杂费类别；其余类型无此字段
    const linkCfg = direction === 'income'
      ? { cat: null }
      : (EXPENSE_LINKAGE[type] || { cat: null });
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
      renderRecords();
      App.toast('录入成功', 'success');
      // 通知看板刷新
      if (App.currentPage === 'dashboard') Dashboard.render();
    } catch (err) {
      App.toast('录入失败：' + err.message, 'error');
    }
  }

  function renderRecords() {
    // 按操作时间（id 降序 = 创建时间倒序）排列，显示最近20条
    const txs = Storage.getTransactionsSync()
      .sort((a, b) => b.id - a.id)
      .slice(0, 20);
    const container = document.getElementById('entryRecords');
    document.getElementById('entryCount').textContent = `(共 ${Storage.getTransactionsSync().length} 条)`;
    if (txs.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无录入记录</div>';
      return;
    }
    container.innerHTML = txs.map(t => {
      const isPos = t.amount > 0;
      const parts = [];
      // 显示业务日期
      parts.push(t.date);
      if (t.customer_name) parts.push(t.customer_name);
      if (t.product_name) parts.push(t.product_name);
      if (t.category) parts.push(t.category);
      if (t.note) parts.push(t.note);
      // 操作时间（created_at）
      const opTime = t.created_at ? t.created_at.replace('T', ' ').substring(0, 16) : '';
      return `<div class="record-item">
        <div class="r-left">
          <div class="r-type">${t.type}<span class="r-unit">${t.unit}</span></div>
          <div class="r-date">${parts.join(' · ')}${opTime ? '　<span class="r-opt">录入于 ' + opTime + '</span>' : ''}</div>
        </div>
        <div class="r-amt ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : '−'}${Calculator.fmtMoney(Math.abs(t.amount))}</div>
        ${Auth.canEdit() ? `<button class="btn btn-danger btn-sm r-del" onclick="Entry.del(${t.id})">删</button>` : ''}
      </div>`;
    }).join('');
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
    // 客户 / 商品 可搜索下拉（combobox），每次展开实时读取最新数据
    setupCombobox('entryCustomerInput', 'entryCustomerPanel', 'entryCustomerId', () => Storage.getCustomerOptions());
    setupCombobox('entryProductInput', 'entryProductPanel', 'entryProductId', () => Storage.getProductOptions());
  }

  return { render, renderRecords, bind, del };
})();
