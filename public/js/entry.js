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

  function render() {
    renderTypeOptions();
    renderUnitOptions();
    renderCustomerOptions();
    renderProductOptions();
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

  function renderCustomerOptions() {
    const sel = document.getElementById('entryCustomer');
    const customers = Storage.getCustomerOptions();
    sel.innerHTML = '<option value="">— 不关联 —</option>' +
      customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  function renderProductOptions() {
    const sel = document.getElementById('entryProduct');
    const products = Storage.getProductOptions();
    sel.innerHTML = '<option value="">— 不关联 —</option>' +
      products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
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
  }

  async function submit() {
    const type = document.getElementById('entryType').value;
    const amount = parseFloat(document.getElementById('entryAmount').value);
    const unit = document.getElementById('entryUnit').value;
    const customerId = document.getElementById('entryCustomer').value || null;
    const productId = document.getElementById('entryProduct').value || null;
    const date = document.getElementById('entryDate').value;
    const note = document.getElementById('entryNote').value;

    if (!type) return App.toast('请选择交易类型', 'error');
    if (!amount || amount <= 0) return App.toast('金额必须为有效正数', 'error');
    if (!date) return App.toast('请选择日期', 'error');

    // 方向决定正负：收入 Math.abs，支出 -Math.abs
    const signedAmount = direction === 'income' ? Math.abs(amount) : -Math.abs(amount);

    try {
      await API.post('/transactions', {
        amount: signedAmount, type, unit,
        customer_id: customerId ? Number(customerId) : null,
        product_id: productId ? Number(productId) : null,
        date, note
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
    // 客户搜索筛选
    document.getElementById('entryCustomerSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const sel = document.getElementById('entryCustomer');
      const customers = Storage.getCustomerOptions();
      sel.innerHTML = '<option value="">— 不关联 —</option>' +
        customers.filter(c => c.name.toLowerCase().includes(q))
          .map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    });
    // 商品搜索筛选
    document.getElementById('entryProductSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const sel = document.getElementById('entryProduct');
      const products = Storage.getProductOptions();
      sel.innerHTML = '<option value="">— 不关联 —</option>' +
        products.filter(p => p.name.toLowerCase().includes(q))
          .map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    });
  }

  return { render, renderRecords, bind, del };
})();
