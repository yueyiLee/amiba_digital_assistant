/**
 * business.js — 业务页面（PRD 5.3）
 * 4 Tab 切换：合同 / 客户 / 商品 / 库存，每个 Tab 独立 CRUD。
 */
const Business = (() => {

  // 各二级页面的筛选状态 & 当前查询结果（供导出使用）
  let customerFilters = { name: '', type: '' };
  let productFilters = { name: '', cat1: '', cat2: '' };
  let contractFilter = { customer: '' };
  let inventoryFilter = { product: '' };
  let currentCustomerRows = [];
  let currentProductRows = [];

  function render() {
    renderContracts();
    renderCustomers();
    renderProducts();
    renderInventory();
    renderExpenseItems();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ========== 合同 ==========
  function renderContracts() {
    let list = Storage.getContractsSync();
    if (contractFilter.customer) list = list.filter(c => (c.customer_name || '').toLowerCase().includes(contractFilter.customer.toLowerCase()));
    document.getElementById('contractCount').textContent = list.length;
    document.getElementById('contractAmount').textContent = Calculator.fmtMoney(list.reduce((s, c) => s + c.amount, 0));
    document.getElementById('contractActive').textContent = list.filter(c => c.status === '进行中').length;

    const tbl = document.getElementById('contractTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无合同</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>合同号</th><th>客户</th><th>金额</th><th>状态</th><th>开始日期</th><th>操作</th></tr></thead>
      <tbody>${list.map(c => `<tr>
        <td>${escapeHtml(c.contract_no)}</td><td>${escapeHtml(c.customer_name || '—')}</td>
        <td class="amt pos">${Calculator.fmtMoney(c.amount)}</td>
        <td><span class="badge ${c.status === '进行中' ? 'g' : 'gray'}">${escapeHtml(c.status)}</span></td>
        <td>${c.start_date || '—'}</td>
        <td>${Auth.canEdit() ? `<button class="btn btn-secondary btn-sm" onclick="Business.openContractModal(${c.id})">编辑</button> <button class="btn btn-danger btn-sm" onclick="Business.delContract(${c.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openContractModal(id) {
    const edit = id != null;
    const rec = edit ? Storage.getContractsSync().find(c => c.id === id) : null;
    if (edit && !rec) return App.toast('合同不存在', 'error');
    const customers = Storage.getCustomerOptions();
    const sel = (v) => (x) => x === v ? ' selected' : '';
    const s = sel(rec ? rec.status : '进行中');
    const body = `
      <div class="form-group"><label class="form-label">合同编号 <span class="req">*</span></label><input type="text" class="form-input" id="m-contract_no" placeholder="HT-2026-XXX" value="${rec ? escapeHtml(rec.contract_no) : ''}"></div>
      <div class="form-group"><label class="form-label">客户 <span class="req">*</span></label><select class="form-select" id="m-customer_id">${customers.map(c => `<option value="${c.id}"${rec && c.id === rec.customer_id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">合同金额 <span class="req">*</span></label><input type="number" class="form-input" id="m-amount" min="0" step="0.01" value="${rec ? rec.amount : ''}"></div>
      <div class="form-group"><label class="form-label">状态</label><select class="form-select" id="m-status"><option${s('进行中')}>进行中</option><option${s('已完成')}>已完成</option><option${s('已终止')}>已终止</option></select></div>
      <div class="form-group"><label class="form-label">开始日期</label><input type="date" class="form-input" id="m-start_date" value="${rec ? (rec.start_date || '') : ''}"></div>
      <div class="form-group"><label class="form-label">结束日期</label><input type="date" class="form-input" id="m-end_date" value="${rec ? (rec.end_date || '') : ''}"></div>`;
    App.openModal(edit ? '编辑合同' : '添加合同', body, async () => {
      const data = {
        contract_no: document.getElementById('m-contract_no').value.trim(),
        customer_id: Number(document.getElementById('m-customer_id').value),
        amount: parseFloat(document.getElementById('m-amount').value),
        status: document.getElementById('m-status').value,
        start_date: document.getElementById('m-start_date').value,
        end_date: document.getElementById('m-end_date').value
      };
      if (!data.contract_no) return App.toast('合同编号必填', 'error');
      if (!data.customer_id) return App.toast('请选择客户', 'error');
      if (!data.amount || data.amount <= 0) return App.toast('合同金额必须大于 0', 'error');
      if (edit) await API.put('/contracts/' + id, data);
      else await API.post('/contracts', data);
      await Storage.refreshCache();
      renderContracts();
      App.closeModal();
      App.toast(edit ? '合同已更新' : '合同已添加', 'success');
    });
  }

  async function delContract(id) {
    if (!confirm('确认删除该合同？')) return;
    await API.del('/contracts/' + id);
    await Storage.refreshCache();
    renderContracts();
    App.toast('已删除', 'success');
  }

  // ========== 客户 ==========
  function renderCustomers() {
    let list = Storage.getCustomersSync();
    if (customerFilters.name) list = list.filter(c => c.name.toLowerCase().includes(customerFilters.name.toLowerCase()));
    if (customerFilters.type) list = list.filter(c => c.type === customerFilters.type);
    currentCustomerRows = list.slice();
    document.getElementById('customerCount').textContent = list.length;
    document.getElementById('customerPersonal').textContent = list.filter(c => c.type === '个人').length;
    document.getElementById('customerCompany').textContent = list.filter(c => c.type === '公司').length;

    const tbl = document.getElementById('customerTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="5" class="empty-state">暂无客户</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>客户名称</th><th>类型</th><th>联系方式</th><th>地址</th><th>操作</th></tr></thead>
      <tbody>${list.map(c => `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td><span class="badge ${c.type === '公司' ? 'p' : 'b'}">${escapeHtml(c.type)}</span></td>
        <td>${escapeHtml(c.contact || '—')}</td><td>${escapeHtml(c.address || '—')}</td>
        <td>${Auth.canEdit() ? `<button class="btn btn-secondary btn-sm" onclick="Business.openCustomerModal(${c.id})">编辑</button> <button class="btn btn-danger btn-sm" onclick="Business.delCustomer(${c.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openCustomerModal(id) {
    const edit = id != null;
    const rec = edit ? Storage.getCustomersSync().find(c => c.id === id) : null;
    if (edit && !rec) return App.toast('客户不存在', 'error');
    const t = rec ? rec.type : '个人';
    const body = `
      <div class="form-group"><label class="form-label">客户名称 <span class="req">*</span></label><input type="text" class="form-input" id="m-name" value="${rec ? escapeHtml(rec.name) : ''}"></div>
      <div class="form-group"><label class="form-label">客户类型 <span class="req">*</span></label><select class="form-select" id="m-type"><option${t === '个人' ? ' selected' : ''}>个人</option><option${t === '公司' ? ' selected' : ''}>公司</option></select></div>
      <div class="form-group"><label class="form-label">联系方式</label><input type="text" class="form-input" id="m-contact" value="${rec ? escapeHtml(rec.contact || '') : ''}"></div>
      <div class="form-group"><label class="form-label">地址</label><input type="text" class="form-input" id="m-address" value="${rec ? escapeHtml(rec.address || '') : ''}"></div>`;
    App.openModal(edit ? '编辑客户' : '添加客户', body, async () => {
      const data = {
        name: document.getElementById('m-name').value.trim(),
        type: document.getElementById('m-type').value,
        contact: document.getElementById('m-contact').value,
        address: document.getElementById('m-address').value
      };
      if (!data.name) return App.toast('客户名称必填', 'error');
      if (edit) await API.put('/customers/' + id, data);
      else await API.post('/customers', data);
      await Storage.refreshCache();
      renderCustomers();
      Entry.render();
      App.closeModal();
      App.toast(edit ? '客户已更新' : '客户已添加', 'success');
    });
  }

  async function delCustomer(id) {
    if (!confirm('确认删除该客户？')) return;
    try {
      await API.del('/customers/' + id);
      await Storage.refreshCache();
      renderCustomers();
      Entry.render();
      App.toast('已删除', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  // ========== 商品 ==========
  function renderProducts() {
    let list = Storage.getProductsSync();
    if (productFilters.name) list = list.filter(p => p.name.toLowerCase().includes(productFilters.name.toLowerCase()));
    if (productFilters.cat1) list = list.filter(p => p.category1 === productFilters.cat1);
    if (productFilters.cat2) list = list.filter(p => (p.category2 || '') === productFilters.cat2);
    currentProductRows = list.slice();
    const cats = new Set(list.map(p => p.category1));
    const avgPrice = list.length ? list.reduce((s, p) => s + p.sale_price, 0) / list.length : 0;
    document.getElementById('productCount').textContent = list.length;
    document.getElementById('productCatCount').textContent = cats.size;
    document.getElementById('productAvgPrice').textContent = Calculator.fmtMoney(avgPrice);

    const tbl = document.getElementById('productTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="7" class="empty-state">暂无商品</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>商品名称</th><th>一级分类</th><th>二级分类</th><th>单位</th><th>采购价</th><th>销售价</th><th>操作</th></tr></thead>
      <tbody>${list.map(p => `<tr>
        <td>${escapeHtml(p.name)}${p.brand ? ' (' + escapeHtml(p.brand) + ')' : ''}</td>
        <td><span class="badge b">${escapeHtml(p.category1)}</span></td>
        <td>${escapeHtml(p.category2 || '无')}</td>
        <td>${escapeHtml(p.unit || '件')}</td>
        <td>${Calculator.fmtMoney(p.purchase_price)}</td>
        <td class="amt pos">${Calculator.fmtMoney(p.sale_price)}</td>
        <td>${Auth.canEdit() ? `<button class="btn btn-secondary btn-sm" onclick="Business.openProductModal(${p.id})">编辑</button> <button class="btn btn-danger btn-sm" onclick="Business.delProduct(${p.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openProductModal(id) {
    const edit = id != null;
    const rec = edit ? Storage.getProductsSync().find(p => p.id === id) : null;
    if (edit && !rec) return App.toast('商品不存在', 'error');
    const cats = Storage.getCategoriesSync();
    const level1Set = [...new Set(cats.map(c => c.level1))];
    const units = ['件', '条', '个', '套', '双', '米', '千克'];
    const body = `
      <div class="form-group"><label class="form-label">商品名称 <span class="req">*</span></label><input type="text" class="form-input" id="m-name" value="${rec ? escapeHtml(rec.name) : ''}"></div>
      <div class="form-group"><label class="form-label">品牌</label><input type="text" class="form-input" id="m-brand" value="${rec ? escapeHtml(rec.brand || '') : ''}"></div>
      <div class="form-group"><label class="form-label">一级分类 <span class="req">*</span></label><select class="form-select" id="m-category1" onchange="Business.onCat1Change()"><option value="">请选择</option>${level1Set.map(c => `<option${rec && c === rec.category1 ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">二级分类</label><select class="form-select" id="m-category2"><option value="">请先选一级分类</option></select></div>
      <div class="form-group"><label class="form-label">单位</label><select class="form-select" id="m-unit">${units.map(u => `<option${rec && u === rec.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">采购价</label><input type="number" class="form-input" id="m-purchase_price" min="0" step="0.01" value="${rec ? rec.purchase_price : 0}"></div>
      <div class="form-group"><label class="form-label">销售价</label><input type="number" class="form-input" id="m-sale_price" min="0" step="0.01" value="${rec ? rec.sale_price : 0}"></div>`;
    App.openModal(edit ? '编辑商品' : '添加商品', body, async () => {
      const data = {
        name: document.getElementById('m-name').value.trim(),
        brand: document.getElementById('m-brand').value,
        category1: document.getElementById('m-category1').value,
        category2: document.getElementById('m-category2').value,
        unit: document.getElementById('m-unit').value,
        purchase_price: parseFloat(document.getElementById('m-purchase_price').value) || 0,
        sale_price: parseFloat(document.getElementById('m-sale_price').value) || 0
      };
      if (!data.name) return App.toast('商品名称必填', 'error');
      if (!data.category1) return App.toast('一级分类必选', 'error');
      if (edit) await API.put('/products/' + id, data);
      else await API.post('/products', data);
      await Storage.refreshCache();
      renderProducts();
      renderInventory();
      Entry.render();
      App.closeModal();
      App.toast(edit ? '商品已更新' : '商品已添加（库存已自动创建）', 'success');
    });
    // 编辑时回填二级分类下拉并选中原值
    onCat1Change(rec ? rec.category2 : null);
  }

  // 一级分类变更时刷新二级分类下拉。selected 可选：回填时保持原二级分类选中。
  function onCat1Change(selected) {
    const cats = Storage.getCategoriesSync();
    const l1 = document.getElementById('m-category1').value;
    // 过滤空二级分类（如"成品面料"无二级分类）；若无有效二级分类则显示"无"
    const l2s = cats.filter(c => c.level1 === l1).map(c => c.level2).filter(v => v && String(v).trim());
    const sel = document.getElementById('m-category2');
    if (!l1) { sel.innerHTML = '<option value="">请先选一级分类</option>'; return; }
    sel.innerHTML = l2s.length
      ? l2s.map(c => `<option${selected && c === selected ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')
      : '<option value="">无</option>';
  }

  async function delProduct(id) {
    if (!confirm('确认删除该商品？关联库存将一并删除。')) return;
    try {
      await API.del('/products/' + id);
      await Storage.refreshCache();
      renderProducts();
      renderInventory();
      Entry.render();
      App.toast('已删除', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  // ========== 库存 ==========
  function renderInventory() {
    let list = Storage.getInventorySync();
    if (inventoryFilter.product) list = list.filter(i => (i.product_name || '').toLowerCase().includes(inventoryFilter.product.toLowerCase()));
    const addBtn = document.getElementById('addInventoryBtn');
    if (addBtn) addBtn.style.display = Auth.canEdit() ? '' : 'none';
    const tbl = document.getElementById('inventoryTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无库存，点击右上角"添加库存"录入</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>商品名称</th><th>分类</th><th>库存数量</th><th>均价</th><th>最后编辑时间</th>${Auth.canEdit() ? '<th>操作</th>' : ''}</tr></thead>
      <tbody>${list.map(i => `<tr>
        <td>${i.product_name}</td>
        <td>${i.category1} / ${i.category2 || '—'}</td>
        <td>${i.quantity} ${Auth.canEdit() ? `<button class="btn btn-secondary btn-sm" onclick="Business.editInventory(${i.id}, ${i.quantity}, ${i.avg_price})">调整</button>` : ''}</td>
        <td>${Calculator.fmtMoney(i.avg_price)}</td>
        <td class="inv-time">${formatTime(i.updated_at)}</td>
        ${Auth.canEdit() ? `<td><button class="btn btn-danger btn-sm" onclick="Business.delInventory(${i.id})">删</button></td>` : ''}
      </tr>`).join('')}</tbody>`;
  }

  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function editInventory(id, qty, avgPrice) {
    const body = `
      <div class="form-group"><label class="form-label">库存数量 <span class="req">*</span></label><input type="number" class="form-input" id="m-quantity" min="0" step="0.01" value="${qty}"></div>
      <div class="form-group"><label class="form-label">均价</label><input type="number" class="form-input" id="m-avg_price" min="0" step="0.01" value="${avgPrice}"></div>`;
    App.openModal('调整库存', body, async () => {
      const quantity = parseFloat(document.getElementById('m-quantity').value);
      if (quantity == null || quantity < 0) return App.toast('数量必须 ≥ 0', 'error');
      await API.put('/inventory/' + id, { quantity, avg_price: parseFloat(document.getElementById('m-avg_price').value) || 0 });
      await Storage.refreshCache();
      renderInventory();
      App.closeModal();
      App.toast('库存已更新', 'success');
    });
  }

  function openInventoryModal() {
    const products = Storage.getProductsSync();
    if (products.length === 0) { App.toast('请先在"商品"页添加商品，再录入库存', 'warning'); return; }
    const inventory = Storage.getInventorySync();
    const hasInvProductIds = new Set(inventory.map(i => Number(i.product_id)));
    const body = `
      <div class="form-group">
        <label class="form-label">选择商品 <span class="req">*</span></label>
        <div class="combobox" id="m-inv-product-cb">
          <input type="text" class="form-input cb-input" id="m-inv-product-input" placeholder="搜索商品名称..." autocomplete="off">
          <div class="cb-panel" id="m-inv-product-panel"></div>
          <input type="hidden" id="m-inv-product" value="">
        </div>
        <div class="dup-hint" id="m-inv-dup-hint"></div>
      </div>
      <div class="form-group"><label class="form-label">库存数量 <span class="req">*</span></label><input type="number" class="form-input" id="m-inv-qty" min="0" step="0.01" value="0"></div>
      <div class="form-group"><label class="form-label">均价</label><input type="number" class="form-input" id="m-inv-price" min="0" step="0.01" value="0"></div>`;
    App.openModal('添加库存', body, async () => {
      const product_id = Number(document.getElementById('m-inv-product').value);
      const quantity = parseFloat(document.getElementById('m-inv-qty').value);
      if (!product_id) return App.toast('请选择商品', 'error');
      if (hasInvProductIds.has(product_id)) {
        return App.openModal('提示', `<p style="color:#dc2626;font-weight:500;">该商品已添加库存，请勿重复添加。</p>`, () => App.closeModal());
      }
      if (quantity == null || quantity < 0) return App.toast('数量必须 ≥ 0', 'error');
      await API.post('/inventory', { product_id, quantity, avg_price: parseFloat(document.getElementById('m-inv-price').value) || 0 });
      await Storage.refreshCache();
      renderInventory();
      App.closeModal();
      App.toast('库存已保存', 'success');
    });
    bindInventoryProductSearch(products, inventory);
  }

  function bindInventoryProductSearch(products, inventory) {
    const input = document.getElementById('m-inv-product-input');
    const panel = document.getElementById('m-inv-product-panel');
    const hidden = document.getElementById('m-inv-product');
    const hint = document.getElementById('m-inv-dup-hint');
    if (!input || !panel || !hidden) return;
    const hasInvIds = new Set(inventory.map(i => Number(i.product_id)));

    function render() {
      const q = (input.value || '').trim().toLowerCase();
      if (!q) { panel.classList.remove('open'); return; }
      const hits = products.filter(p => String(p.name || '').toLowerCase().includes(q)).slice(0, 10);
      if (!hits.length) { panel.classList.remove('open'); return; }
      panel.innerHTML = hits.map(p => {
        const hasInv = hasInvIds.has(p.id);
        return `<div class="cb-option${hasInv ? ' disabled' : ''}" data-id="${hasInv ? '' : p.id}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}${p.category1 ? '（' + escapeHtml(p.category1) + '）' : ''}${hasInv ? ' <span class="tag">已添加库存</span>' : ''}</div>`;
      }).join('');
      panel.querySelectorAll('.cb-option:not(.disabled)').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hidden.value = el.dataset.id;
          input.value = el.dataset.name;
          panel.classList.remove('open');
          if (hint) hint.textContent = '';
          input.blur();
        });
      });
      panel.classList.add('open');
    }

    function showHint() {
      if (!hint) return;
      const v = input.value.trim();
      if (!v) { hint.textContent = ''; return; }
      const exact = products.find(p => String(p.name || '').trim() === v);
      if (exact && hasInvIds.has(exact.id)) {
        hint.textContent = '该商品已添加库存，请勿重复添加。';
      } else {
        hint.textContent = '';
      }
    }

    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('blur', () => {
      setTimeout(() => panel.classList.remove('open'), 150);
      showHint();
    });
  }

  async function delInventory(id) {
    if (!confirm('确认删除该库存记录？')) return;
    try {
      await API.del('/inventory/' + id);
      await Storage.refreshCache();
      renderInventory();
      App.toast('已删除', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  // ========== 收支项配置（杂费类别，账号隔离） ==========
  // MISC_KIND 对应 expense_items.kind='misc'（杂费支出类别）
  const MISC_KIND = 'misc';

  function renderExpenseItems() {
    const list = Storage.getExpenseItemsSync(MISC_KIND); // [{id, name}]
    const countEl = document.getElementById('miscItemCount');
    if (countEl) countEl.textContent = list.length;
    const addBtn = document.getElementById('addMiscItemBtn');
    if (addBtn) addBtn.style.display = Auth.canEdit() ? '' : 'none';
    const tbl = document.getElementById('miscItemTable');
    if (!tbl) return;
    if (list.length === 0) {
      tbl.innerHTML = '<tr><td colspan="3" class="empty-state">暂无杂费类别，点击右上角"添加类别"新增</td></tr>';
      return;
    }
    tbl.innerHTML = `<thead><tr><th>杂费类别</th><th>备注说明</th><th style="width:160px;">操作</th></tr></thead>
      <tbody>${list.map(i => `<tr>
        <td>${escapeHtml(i.name)}</td>
        <td class="misc-note">${escapeHtml(i.note || '') || '<span class="text-muted">—</span>'}</td>
        <td>${Auth.canEdit()
          ? `<button class="btn btn-secondary btn-sm" onclick="Business.openMiscItemModal(${i.id})">编辑</button> <button class="btn btn-danger btn-sm" onclick="Business.delMiscItem(${i.id})">删</button>`
          : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openMiscItemModal(id) {
    const edit = id != null;
    const rec = edit ? Storage.getExpenseItemsSync(MISC_KIND).find(i => i.id === id) : null;
    if (edit && !rec) return App.toast('类别不存在', 'error');
    const body = `
      <div class="form-group"><label class="form-label">杂费类别名称 <span class="req">*</span></label>
      <input type="text" class="form-input" id="m-misc-name" placeholder="如：水电费、差旅费" value="${rec ? escapeHtml(rec.name) : ''}"></div>
      <div class="form-group"><label class="form-label">备注说明 <span class="opt">(选填，描述用途或其他说明)</span></label>
      <textarea class="form-input" id="m-misc-note" rows="3" placeholder="如：含门店水费、电费、燃气费等公共事业费用">${rec ? escapeHtml(rec.note || '') : ''}</textarea></div>
      <div class="setting-desc">配置后，录入"杂费支出"时可在"杂费类别"下拉中选择该项</div>`;
    App.openModal(edit ? '编辑杂费类别' : '添加杂费类别', body, async () => {
      const name = document.getElementById('m-misc-name').value.trim();
      if (!name) return App.toast('类别名称必填', 'error');
      const note = document.getElementById('m-misc-note').value.trim();
      if (edit) await API.put('/expense-items/' + id, { name, note });
      else await API.post('/expense-items', { kind: MISC_KIND, name, note });
      await Storage.refreshCache();
      renderExpenseItems();
      Entry.render(); // 同步刷新录入页的杂费类别下拉
      App.closeModal();
      App.toast(edit ? '类别已更新' : '类别已添加', 'success');
    });
  }

  async function delMiscItem(id) {
    if (!confirm('确认删除该杂费类别？已录入的历史记录不受影响。')) return;
    try {
      await API.del('/expense-items/' + id);
      await Storage.refreshCache();
      renderExpenseItems();
      Entry.render();
      App.toast('已删除', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  // ========== 录入防重复：搜索提示 ==========
  // 为输入框绑定实时模糊搜索下拉，失焦时精确匹配提示
  function setupDupCheck({ inputId, panelId, getItems, label }) {
    const input = document.getElementById(inputId);
    const panel = document.getElementById(panelId);
    if (!input || !panel) return;

    function exactExists() {
      const v = input.value.trim();
      return v ? getItems().some(item => String(item.name || item).trim() === v) : false;
    }

    function showHint() {
      const hint = document.getElementById(inputId.replace('Name', 'DupHint'));
      if (!hint) return;
      if (exactExists()) {
        hint.textContent = `该${label}名称已被录入，请勿重复录入。`;
      } else {
        hint.textContent = '';
      }
    }

    function render() {
      const v = input.value.trim();
      const q = v.toLowerCase();
      if (!q) { panel.classList.remove('open'); return; }
      const hits = getItems().filter(item => {
        const n = String(item.name || item).trim();
        return n.toLowerCase().includes(q);
      }).slice(0, 10);
      if (!hits.length) { panel.classList.remove('open'); return; }
      panel.innerHTML = hits.map(item => {
        const n = String(item.name || item).trim();
        return `<div class="cb-option">${escapeHtml(n)} <span class="tag">已录入</span></div>`;
      }).join('');
      panel.classList.add('open');
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => {
      setTimeout(() => panel.classList.remove('open'), 150);
      showHint();
    });
  }

  // ========== 客户录入（内联表单） ==========
  function renderCustomerAdd() {
    document.getElementById('custAddName').value = '';
    document.getElementById('custAddType').value = '个人';
    document.getElementById('custAddContact').value = '';
    document.getElementById('custAddAddress').value = '';
    document.getElementById('custAddDupHint').textContent = '';
    document.getElementById('custAddName').focus();
  }

  function findCustomerExact(name) {
    return Storage.getCustomersSync().find(c => String(c.name || '').trim() === name.trim());
  }

  async function saveCustomerDirect() {
    const name = document.getElementById('custAddName').value.trim();
    const type = document.getElementById('custAddType').value;
    const contact = document.getElementById('custAddContact').value.trim();
    const address = document.getElementById('custAddAddress').value.trim();
    if (!name) return App.toast('客户名称必填', 'error');
    if (findCustomerExact(name)) {
      return App.openModal('提示',
        `<p style="color:#dc2626;font-weight:500;">该客户名称已被录入，请勿重复录入。</p>`,
        () => App.closeModal());
    }
    try {
      await API.post('/customers', { name, type, contact, address });
      await Storage.refreshCache();
      document.getElementById('custAddName').value = '';
      document.getElementById('custAddContact').value = '';
      document.getElementById('custAddAddress').value = '';
      document.getElementById('custAddDupHint').textContent = '';
      App.toast('客户已添加', 'success');
      if (App.currentPage === 'customer-query') renderCustomers();
      Entry.render();
    } catch (e) { App.toast(e.message, 'error'); }
  }

  function renderCustomerQuery() { renderCustomers(); }

  // ========== 商品录入（内联表单） ==========
  function renderProductAdd() {
    const cats = Storage.getCategoriesSync();
    const level1Set = [...new Set(cats.map(c => c.level1))];
    const sel = document.getElementById('prodAddCat1');
    sel.innerHTML = '<option value="">请选择</option>' + level1Set.map(c => `<option>${escapeHtml(c)}</option>`).join('');
    onCat1ChangeAdd();
    document.getElementById('prodAddName').value = '';
    document.getElementById('prodAddBrand').value = '';
    document.getElementById('prodAddPurchase').value = '0';
    document.getElementById('prodAddSale').value = '0';
    document.getElementById('prodAddDupHint').textContent = '';
    document.getElementById('prodAddName').focus();
  }

  function findProductExact(name) {
    return Storage.getProductsSync().find(p => String(p.name || '').trim() === name.trim());
  }

  async function saveProductDirect() {
    const name = document.getElementById('prodAddName').value.trim();
    const brand = document.getElementById('prodAddBrand').value;
    const category1 = document.getElementById('prodAddCat1').value;
    const category2 = document.getElementById('prodAddCat2').value;
    const unit = document.getElementById('prodAddUnit').value;
    const purchase_price = parseFloat(document.getElementById('prodAddPurchase').value) || 0;
    const sale_price = parseFloat(document.getElementById('prodAddSale').value) || 0;
    if (!name) return App.toast('商品名称必填', 'error');
    if (!category1) return App.toast('一级分类必选', 'error');
    if (findProductExact(name)) {
      return App.openModal('提示',
        `<p style="color:#dc2626;font-weight:500;">该商品名称已被录入，请勿重复录入。</p>`,
        () => App.closeModal());
    }
    try {
      await API.post('/products', { name, brand, category1, category2, unit, purchase_price, sale_price });
      await Storage.refreshCache();
      document.getElementById('prodAddName').value = '';
      document.getElementById('prodAddBrand').value = '';
      document.getElementById('prodAddDupHint').textContent = '';
      App.toast('商品已添加（库存已自动创建）', 'success');
      renderInventory();
      Entry.render();
    } catch (e) { App.toast(e.message, 'error'); }
  }

  function onCat1ChangeAdd() {
    const cats = Storage.getCategoriesSync();
    const l1 = document.getElementById('prodAddCat1').value;
    const l2s = cats.filter(c => c.level1 === l1).map(c => c.level2).filter(v => v && String(v).trim());
    const sel = document.getElementById('prodAddCat2');
    if (!l1) { sel.innerHTML = '<option value="">请先选一级分类</option>'; return; }
    sel.innerHTML = l2s.length
      ? l2s.map(c => `<option>${escapeHtml(c)}</option>`).join('')
      : '<option value="">无</option>';
  }

  function renderProductQuery() {
    const cats = Storage.getCategoriesSync();
    const level1Set = [...new Set(cats.map(c => c.level1))];
    const sel = document.getElementById('prodQCat1');
    if (sel) sel.innerHTML = '<option value="">全部一级分类</option>' + level1Set.map(c => `<option>${escapeHtml(c)}</option>`).join('');
    updateProdQCat2();
    renderProducts();
  }

  // 商品查询：一级分类变化时刷新二级分类下拉
  function updateProdQCat2() {
    const cats = Storage.getCategoriesSync();
    const l1 = document.getElementById('prodQCat1').value;
    const l2s = l1 ? cats.filter(c => c.level1 === l1).map(c => c.level2).filter(v => v && String(v).trim()) : [];
    const sel = document.getElementById('prodQCat2');
    sel.innerHTML = '<option value="">全部二级分类</option>' + l2s.map(c => `<option>${escapeHtml(c)}</option>`).join('');
  }

  function renderContract() { renderContracts(); }
  function renderInventoryQuery() { renderInventory(); }

  // ========== 导出当前查询结果 ==========
  function exportCustomerQuery() { Export.exportCustomers(currentCustomerRows); }
  function exportProductQuery() { Export.exportProducts(currentProductRows); }

  // ========== 查询重置（清空筛选条件，展示全部） ==========
  function resetCustomerFilters() {
    customerFilters = { name: '', type: '' };
    const n = document.getElementById('custQName'); if (n) n.value = '';
    const t = document.getElementById('custQType'); if (t) t.value = '';
    renderCustomers();
  }
  function resetProductFilters() {
    productFilters = { name: '', cat1: '', cat2: '' };
    const n = document.getElementById('prodQName'); if (n) n.value = '';
    const c1 = document.getElementById('prodQCat1'); if (c1) c1.value = '';
    updateProdQCat2();
    const c2 = document.getElementById('prodQCat2'); if (c2) c2.value = '';
    renderProducts();
  }
  function resetContractFilters() {
    contractFilter = { customer: '' };
    const c = document.getElementById('contractQCustomer'); if (c) c.value = '';
    renderContracts();
  }
  function resetInventoryFilters() {
    inventoryFilter = { product: '' };
    const p = document.getElementById('invQProduct'); if (p) p.value = '';
    renderInventory();
  }

  function bind() {
    // 客户录入：保存
    const custSave = document.getElementById('custAddSave');
    if (custSave) custSave.addEventListener('click', saveCustomerDirect);
    setupDupCheck({
      inputId: 'custAddName', panelId: 'custAddNamePanel',
      getItems: () => Storage.getCustomersSync(), label: '客户'
    });
    // 客户查询：筛选
    const custQName = document.getElementById('custQName');
    if (custQName) custQName.addEventListener('input', () => { customerFilters.name = custQName.value.trim(); renderCustomers(); });
    const custQType = document.getElementById('custQType');
    if (custQType) custQType.addEventListener('change', () => { customerFilters.type = custQType.value; renderCustomers(); });
    const custResetBtn = document.getElementById('custResetBtn');
    if (custResetBtn) custResetBtn.addEventListener('click', resetCustomerFilters);

    // 商品录入：保存
    const prodSave = document.getElementById('prodAddSave');
    if (prodSave) prodSave.addEventListener('click', saveProductDirect);
    setupDupCheck({
      inputId: 'prodAddName', panelId: 'prodAddNamePanel',
      getItems: () => Storage.getProductsSync(), label: '商品'
    });
    // 商品查询：筛选
    const prodQName = document.getElementById('prodQName');
    if (prodQName) prodQName.addEventListener('input', () => { productFilters.name = prodQName.value.trim(); renderProducts(); });
    const prodQCat1 = document.getElementById('prodQCat1');
    if (prodQCat1) prodQCat1.addEventListener('change', () => { productFilters.cat1 = prodQCat1.value; productFilters.cat2 = ''; updateProdQCat2(); renderProducts(); });
    const prodQCat2 = document.getElementById('prodQCat2');
    if (prodQCat2) prodQCat2.addEventListener('change', () => { productFilters.cat2 = prodQCat2.value; renderProducts(); });
    const prodResetBtn = document.getElementById('prodResetBtn');
    if (prodResetBtn) prodResetBtn.addEventListener('click', resetProductFilters);

    // 合同：客户名称模糊搜索
    const contractQCustomer = document.getElementById('contractQCustomer');
    if (contractQCustomer) contractQCustomer.addEventListener('input', () => { contractFilter.customer = contractQCustomer.value.trim(); renderContracts(); });
    const contractResetBtn = document.getElementById('contractResetBtn');
    if (contractResetBtn) contractResetBtn.addEventListener('click', resetContractFilters);

    // 库存：商品名称模糊搜索
    const invQProduct = document.getElementById('invQProduct');
    if (invQProduct) invQProduct.addEventListener('input', () => { inventoryFilter.product = invQProduct.value.trim(); renderInventory(); });
    const invResetBtn = document.getElementById('invResetBtn');
    if (invResetBtn) invResetBtn.addEventListener('click', resetInventoryFilters);
  }

  // ========== 收支类型管理（费用类型，可配置方向/联动/启停） ==========
  function renderExpenseTypes() {
    const list = Storage.getExpenseTypesSync(null, { enabledOnly: false });
    const countEl = document.getElementById('etCount');
    if (countEl) countEl.textContent = list.length;
    const addBtn = document.getElementById('etAddBtn');
    if (addBtn) addBtn.style.display = Auth.canEdit() ? '' : 'none';
    const tbl = document.getElementById('etTable');
    if (!tbl) return;
    if (list.length === 0) {
      tbl.innerHTML = '<tr><td colspan="7" class="empty-state">暂无收支类型，点击右上角"新增类型"添加</td></tr>';
      return;
    }
    const dirLabel = d => d === 'income' ? '收入' : '支出';
    const catLabel = c => c === 'processing' ? '加工类别' : (c === 'misc' ? '杂费类别' : '—');
    const rowHtml = list.map(t => {
      const editable = Auth.canEdit();
      const toggleBtn = editable
        ? `<button class="btn btn-sm ${t.enabled ? 'btn-secondary' : 'btn-primary'}" onclick="Business.toggleExpenseType(${t.id}, ${!t.enabled})">${t.enabled ? '停用' : '启用'}</button>`
        : '';
      const editBtn = editable ? `<button class="btn btn-secondary btn-sm" onclick="Business.openExpenseTypeModal(${t.id})">编辑</button>` : '';
      const delBtn = editable ? `<button class="btn btn-danger btn-sm" onclick="Business.delExpenseType(${t.id})">删</button>` : '';
      return `<tr>
        <td>${escapeHtml(t.name)}</td>
        <td>${dirLabel(t.direction)}</td>
        <td>${t.link_customer ? '是' : '否'}</td>
        <td>${t.link_product ? '是' : '否'}</td>
        <td>${catLabel(t.link_cat)}</td>
        <td>${t.enabled ? '<span class="badge-ok">启用中</span>' : '<span class="badge-off">已停用</span>'}</td>
        <td>${toggleBtn} ${editBtn} ${delBtn}</td>
      </tr>`;
    }).join('');
    tbl.innerHTML = `<thead><tr><th>类型名称</th><th>方向</th><th>关联客户</th><th>关联商品</th><th>细分</th><th>状态</th><th style="width:200px;">操作</th></tr></thead><tbody>${rowHtml}</tbody>`;
  }

  function openExpenseTypeModal(id) {
    const edit = id != null;
    const rec = edit ? Storage.getExpenseTypesSync(null, { enabledOnly: false }).find(t => t.id === id) : null;
    if (edit && !rec) return App.toast('类型不存在', 'error');
    const dir = rec ? rec.direction : 'expense';
    const lc = rec ? !!rec.link_customer : true;
    const lp = rec ? !!rec.link_product : true;
    const lcat = rec ? (rec.link_cat || '') : '';
    const body = `
      <div class="form-group"><label class="form-label">收支方向 <span class="req">*</span></label>
        <label class="chk"><input type="radio" name="et-dir" value="expense" ${dir === 'expense' ? 'checked' : ''}> 支出</label>
        <label class="chk"><input type="radio" name="et-dir" value="income" ${dir === 'income' ? 'checked' : ''}> 收入</label>
      </div>
      <div class="form-group"><label class="form-label">类型名称 <span class="req">*</span></label>
        <input type="text" class="form-input" id="et-name" placeholder="如：材料采购、销售收入" value="${rec ? escapeHtml(rec.name) : ''}"></div>
      <div class="form-group"><label class="form-label">录入时联动显示</label>
        <label class="chk"><input type="checkbox" id="et-cust" ${lc ? 'checked' : ''}> 关联客户</label>
        <label class="chk"><input type="checkbox" id="et-prod" ${lp ? 'checked' : ''}> 关联商品</label>
        <select class="form-select" id="et-cat" style="margin-top:6px;">
          <option value="" ${lcat === '' ? 'selected' : ''}>无细分</option>
          <option value="processing" ${lcat === 'processing' ? 'selected' : ''}>加工类别（委托加工）</option>
          <option value="misc" ${lcat === 'misc' ? 'selected' : ''}>杂费类别（杂费支出）</option>
        </select>
      </div>
      <div class="setting-desc">关联客户/商品：录入该类型时表单是否展示对应字段；细分：展示哪个支出项下拉（需在"杂费类别设置"中预先配置）。</div>`;
    App.openModal(edit ? '编辑收支类型' : '新增收支类型', body, async () => {
      const name = document.getElementById('et-name').value.trim();
      if (!name) return App.toast('类型名称必填', 'error');
      const direction = document.querySelector('input[name="et-dir"]:checked').value;
      const link_customer = document.getElementById('et-cust').checked;
      const link_product = document.getElementById('et-prod').checked;
      const link_cat = document.getElementById('et-cat').value;
      const payload = { name, direction, link_customer, link_product, link_cat };
      if (edit) await API.put('/expense-types/' + id, payload);
      else await API.post('/expense-types', payload);
      await Storage.refreshCache();
      renderExpenseTypes();
      Entry.render(); // 同步刷新录入页的类型下拉
      App.closeModal();
      App.toast(edit ? '类型已更新' : '类型已添加', 'success');
    });
  }

  async function delExpenseType(id) {
    if (!confirm('确认删除该收支类型？已录入的历史记录仍按名称显示，不受影响。')) return;
    try {
      await API.del('/expense-types/' + id);
      await Storage.refreshCache();
      renderExpenseTypes();
      Entry.render();
      App.toast('已删除', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  async function toggleExpenseType(id, enabled) {
    try {
      const rec = Storage.getExpenseTypesSync(null, { enabledOnly: false }).find(t => t.id === id);
      if (!rec) return App.toast('类型不存在', 'error');
      // 后端 PUT 要求 name 必填，故带上完整字段
      await API.put('/expense-types/' + id, {
        name: rec.name, direction: rec.direction,
        link_customer: !!rec.link_customer, link_product: !!rec.link_product,
        link_cat: rec.link_cat || '', enabled
      });
      await Storage.refreshCache();
      renderExpenseTypes();
      Entry.render();
      App.toast(enabled ? '已启用' : '已停用', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  return { render, bind, openContractModal, delContract, openCustomerModal, delCustomer,
           openProductModal, onCat1Change, delProduct, editInventory, openInventoryModal, delInventory,
           renderExpenseItems, openMiscItemModal, delMiscItem,
           renderExpenseTypes, openExpenseTypeModal, delExpenseType, toggleExpenseType,
           renderCustomerAdd, renderCustomerQuery, saveCustomerDirect,
           renderProductAdd, renderProductQuery, onCat1ChangeAdd, saveProductDirect,
           renderContract, renderInventoryQuery, exportCustomerQuery, exportProductQuery };
})();
