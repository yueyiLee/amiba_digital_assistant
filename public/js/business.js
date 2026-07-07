/**
 * business.js — 业务页面（PRD 5.3）
 * 4 Tab 切换：合同 / 客户 / 商品 / 库存，每个 Tab 独立 CRUD。
 */
const Business = (() => {

  function render() {
    renderContracts();
    renderCustomers();
    renderProducts();
    renderInventory();
  }

  // ========== 合同 ==========
  function renderContracts() {
    const list = Storage.getContractsSync();
    document.getElementById('contractCount').textContent = list.length;
    document.getElementById('contractAmount').textContent = Calculator.fmtMoney(list.reduce((s, c) => s + c.amount, 0));
    document.getElementById('contractActive').textContent = list.filter(c => c.status === '进行中').length;

    const tbl = document.getElementById('contractTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无合同</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>合同号</th><th>客户</th><th>金额</th><th>状态</th><th>开始日期</th><th>操作</th></tr></thead>
      <tbody>${list.map(c => `<tr>
        <td>${c.contract_no}</td><td>${c.customer_name || '—'}</td>
        <td class="amt pos">${Calculator.fmtMoney(c.amount)}</td>
        <td><span class="badge ${c.status === '进行中' ? 'g' : 'gray'}">${c.status}</span></td>
        <td>${c.start_date || '—'}</td>
        <td>${Auth.canEdit() ? `<button class="btn btn-danger btn-sm" onclick="Business.delContract(${c.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openContractModal() {
    const customers = Storage.getCustomerOptions();
    const body = `
      <div class="form-group"><label class="form-label">合同编号 <span class="req">*</span></label><input type="text" class="form-input" id="m-contract_no" placeholder="HT-2026-XXX"></div>
      <div class="form-group"><label class="form-label">客户 <span class="req">*</span></label><select class="form-select" id="m-customer_id">${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">合同金额 <span class="req">*</span></label><input type="number" class="form-input" id="m-amount" min="0" step="0.01"></div>
      <div class="form-group"><label class="form-label">状态</label><select class="form-select" id="m-status"><option>进行中</option><option>已完成</option><option>已终止</option></select></div>
      <div class="form-group"><label class="form-label">开始日期</label><input type="date" class="form-input" id="m-start_date"></div>
      <div class="form-group"><label class="form-label">结束日期</label><input type="date" class="form-input" id="m-end_date"></div>`;
    App.openModal('添加合同', body, async () => {
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
      await API.post('/contracts', data);
      await Storage.refreshCache();
      renderContracts();
      App.closeModal();
      App.toast('合同已添加', 'success');
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
    const list = Storage.getCustomersSync();
    document.getElementById('customerCount').textContent = list.length;
    document.getElementById('customerPersonal').textContent = list.filter(c => c.type === '个人').length;
    document.getElementById('customerCompany').textContent = list.filter(c => c.type === '公司').length;

    const tbl = document.getElementById('customerTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="5" class="empty-state">暂无客户</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>客户名称</th><th>类型</th><th>联系方式</th><th>地址</th><th>操作</th></tr></thead>
      <tbody>${list.map(c => `<tr>
        <td>${c.name}</td>
        <td><span class="badge ${c.type === '公司' ? 'p' : 'b'}">${c.type}</span></td>
        <td>${c.contact || '—'}</td><td>${c.address || '—'}</td>
        <td>${Auth.canEdit() ? `<button class="btn btn-danger btn-sm" onclick="Business.delCustomer(${c.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openCustomerModal() {
    const body = `
      <div class="form-group"><label class="form-label">客户名称 <span class="req">*</span></label><input type="text" class="form-input" id="m-name"></div>
      <div class="form-group"><label class="form-label">客户类型 <span class="req">*</span></label><select class="form-select" id="m-type"><option>个人</option><option>公司</option></select></div>
      <div class="form-group"><label class="form-label">联系方式</label><input type="text" class="form-input" id="m-contact"></div>
      <div class="form-group"><label class="form-label">地址</label><input type="text" class="form-input" id="m-address"></div>`;
    App.openModal('添加客户', body, async () => {
      const data = {
        name: document.getElementById('m-name').value.trim(),
        type: document.getElementById('m-type').value,
        contact: document.getElementById('m-contact').value,
        address: document.getElementById('m-address').value
      };
      if (!data.name) return App.toast('客户名称必填', 'error');
      await API.post('/customers', data);
      await Storage.refreshCache();
      renderCustomers();
      Entry.render();
      App.closeModal();
      App.toast('客户已添加', 'success');
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
    const list = Storage.getProductsSync();
    const cats = new Set(list.map(p => p.category1));
    const avgPrice = list.length ? list.reduce((s, p) => s + p.sale_price, 0) / list.length : 0;
    document.getElementById('productCount').textContent = list.length;
    document.getElementById('productCatCount').textContent = cats.size;
    document.getElementById('productAvgPrice').textContent = Calculator.fmtMoney(avgPrice);

    const tbl = document.getElementById('productTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无商品</td></tr>'; return; }
    tbl.innerHTML = `<thead><tr><th>商品名称</th><th>一级分类</th><th>二级分类</th><th>采购价</th><th>销售价</th><th>操作</th></tr></thead>
      <tbody>${list.map(p => `<tr>
        <td>${p.name}${p.brand ? ' (' + p.brand + ')' : ''}</td>
        <td><span class="badge b">${p.category1}</span></td>
        <td>${p.category2 || '—'}</td>
        <td>${Calculator.fmtMoney(p.purchase_price)}</td>
        <td class="amt pos">${Calculator.fmtMoney(p.sale_price)}</td>
        <td>${Auth.canEdit() ? `<button class="btn btn-danger btn-sm" onclick="Business.delProduct(${p.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  function openProductModal() {
    const cats = Storage.getCategoriesSync();
    const level1Set = [...new Set(cats.map(c => c.level1))];
    const body = `
      <div class="form-group"><label class="form-label">商品名称 <span class="req">*</span></label><input type="text" class="form-input" id="m-name"></div>
      <div class="form-group"><label class="form-label">品牌</label><input type="text" class="form-input" id="m-brand"></div>
      <div class="form-group"><label class="form-label">一级分类 <span class="req">*</span></label><select class="form-select" id="m-category1" onchange="Business.onCat1Change()"><option value="">请选择</option>${level1Set.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">二级分类</label><select class="form-select" id="m-category2"><option value="">请先选一级分类</option></select></div>
      <div class="form-group"><label class="form-label">单位</label><select class="form-select" id="m-unit"><option>件</option><option>条</option><option>个</option><option>套</option><option>双</option></select></div>
      <div class="form-group"><label class="form-label">采购价</label><input type="number" class="form-input" id="m-purchase_price" min="0" step="0.01" value="0"></div>
      <div class="form-group"><label class="form-label">销售价</label><input type="number" class="form-input" id="m-sale_price" min="0" step="0.01" value="0"></div>`;
    App.openModal('添加商品', body, async () => {
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
      await API.post('/products', data);
      await Storage.refreshCache();
      renderProducts();
      Entry.render();
      App.closeModal();
      App.toast('商品已添加（库存已自动创建）', 'success');
    });
  }

  function onCat1Change() {
    const cats = Storage.getCategoriesSync();
    const l1 = document.getElementById('m-category1').value;
    const l2s = cats.filter(c => c.level1 === l1).map(c => c.level2);
    document.getElementById('m-category2').innerHTML = l2s.length ? l2s.map(c => `<option>${c}</option>`).join('') : '<option value="">无</option>';
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
    const list = Storage.getInventorySync();
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
    const opts = products.map(p => `<option value="${p.id}">${p.name}${p.category1 ? '（' + p.category1 + '）' : ''}</option>`).join('');
    const body = `
      <div class="form-group"><label class="form-label">选择商品 <span class="req">*</span></label><select class="form-select" id="m-inv-product">${opts}</select></div>
      <div class="form-group"><label class="form-label">库存数量 <span class="req">*</span></label><input type="number" class="form-input" id="m-inv-qty" min="0" step="0.01" value="0"></div>
      <div class="form-group"><label class="form-label">均价</label><input type="number" class="form-input" id="m-inv-price" min="0" step="0.01" value="0"></div>`;
    App.openModal('添加库存', body, async () => {
      const product_id = Number(document.getElementById('m-inv-product').value);
      const quantity = parseFloat(document.getElementById('m-inv-qty').value);
      if (!product_id) return App.toast('请选择商品', 'error');
      if (quantity == null || quantity < 0) return App.toast('数量必须 ≥ 0', 'error');
      await API.post('/inventory', { product_id, quantity, avg_price: parseFloat(document.getElementById('m-inv-price').value) || 0 });
      await Storage.refreshCache();
      renderInventory();
      App.closeModal();
      App.toast('库存已保存', 'success');
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

  function bind() {
    document.querySelectorAll('.tab-item[data-btab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-item[data-btab]').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.btab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('btab-' + tab.dataset.btab).classList.add('active');
      });
    });
  }

  return { render, bind, openContractModal, delContract, openCustomerModal, delCustomer,
           openProductModal, onCat1Change, delProduct, editInventory, openInventoryModal, delInventory };
})();
