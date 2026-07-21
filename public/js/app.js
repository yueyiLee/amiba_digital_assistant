/**
 * app.js — 主应用控制器
 * 页面路由切换、初始化流程、Modal 管理、Toast 通知。
 */
const App = (() => {
  let currentKey = 'dashboard';

  // 二级页面 key → 渲染动作（复用各模块细粒度渲染函数）
  const ROUTES = {
    'dashboard':      () => { Dashboard.renderUnitFilter(); Dashboard.render(); },
    'entry-add':      () => { Entry.renderAdd(); },
    'entry-query':    () => { Entry.renderQuery(); },
    'customer-add':   () => { Business.renderCustomerAdd(); },
    'customer-query': () => { Business.renderCustomerQuery(); },
    'product-add':    () => { Business.renderProductAdd(); },
    'product-query':  () => { Business.renderProductQuery(); },
    'contract':       () => { Business.renderContract(); },
    'inventory':      () => { Business.renderInventoryQuery(); },
    'emp-roster':     () => { Employees.renderRoster(); },
    'emp-history':    () => { Employees.renderHistory(); },
    'emp-hours':      () => { Employees.renderHours(); },
    'set-dept':       () => { Settings.renderDept(); },
    'set-display':    () => { Settings.renderDisplay(); },
    'set-misc':       () => { Business.renderExpenseItems(); },
    'set-types':      () => { Business.renderExpenseTypes(); },
    'users':          () => { Users.render(); }
  };

  // ========== 初始化 ==========
  async function init() {
    // 检查登录状态
    if (!Auth.isLoggedIn()) { Auth.showLogin(); return; }
    try {
      const user = await Auth.fetchCurrentUser();
      if (!user) { Auth.showLogin(); return; }
    } catch (e) {
      Auth.showLogin();
      return;
    }

    Auth.showApp();
    // 加载缓存
    await Storage.refreshCache();
    // 获取实时汇率
    await Currency.fetchRates();
    // 同步设置页币种
    const savedCur = Storage.getSettingsSync().currency || '¥';
    const curCode = savedCur === '$' ? 'USD' : (savedCur === '€' ? 'EUR' : 'CNY');
    Currency.setDisplayCurrency(curCode);
    const setCurSel = document.getElementById('setCurrency');
    if (setCurSel) setCurSel.value = savedCur;
    // 绑定事件
    bindNav();
    Dashboard.bind();
    Entry.bind();
    Business.bind();
    Employees.bind();
    Settings.bind();
    Auth.bindLogin();
    // 权限控制：非 admin 超级账号隐藏「账号管理」入口
    const isAdmin = Auth.isAdmin();
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = isAdmin ? 'flex' : 'none'; });
    // 默认显示看板
    switchPage('dashboard');
  }

  // ========== 页面路由 ==========
  function switchPage(key) {
    if (!ROUTES[key]) return;
    // 「账号管理」仅 admin 超级账号可访问
    if (key === 'users' && !Auth.isAdmin()) {
      toast('权限不足，仅系统管理员可访问账号管理', 'error');
      return;
    }
    currentKey = key;
    // 切换导航高亮（清除旧的，激活当前 key 项并展开其所属分组）
    document.querySelectorAll('#sidebarNav .nav-item, #sidebarNav .nav-sub').forEach(el => el.classList.remove('active'));
    const target = document.querySelector(`#sidebarNav [data-key="${key}"]`);
    if (target) {
      target.classList.add('active');
      const group = target.closest('.nav-group.has-sub');
      if (group) group.classList.add('open');
    }
    // 切换页面显示
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById('page-' + key);
    if (section) section.classList.add('active');
    // 更新顶栏标题
    const titleEl = document.getElementById('topbarTitle');
    if (titleEl && target) {
      const isSub = target.classList.contains('nav-sub');
      const title = isSub
        ? target.textContent.replace('•', '').trim()
        : (target.querySelector('.ni-label') ? target.querySelector('.ni-label').textContent : key);
      titleEl.textContent = title;
    }
    // 渲染对应页面
    ROUTES[key]();
  }

  function refreshAll() {
    if (ROUTES[currentKey]) ROUTES[currentKey]();
  }

  // ========== 导航绑定 ==========
  function bindNav() {
    // 可点击菜单项（二级项与无子级的一级项均带 data-key）
    document.querySelectorAll('#sidebarNav [data-key]').forEach(el => {
      el.addEventListener('click', () => switchPage(el.dataset.key));
    });
    // 带子级的一级项：点击仅展开/收起二级菜单
    document.querySelectorAll('#sidebarNav [data-toggle="sub"]').forEach(el => {
      el.addEventListener('click', () => {
        const group = el.closest('.nav-group.has-sub');
        if (group) group.classList.toggle('open');
      });
    });
  }

  // ========== Modal ==========
  function openModal(title, bodyHTML, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHTML;
    const footer = document.getElementById('modalFooter');
    footer.innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">取消</button>
      <button class="btn btn-primary" id="modalConfirmBtn">确认</button>`;
    document.getElementById('modalOverlay').style.display = 'flex';
    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '处理中...';
      try { await onConfirm(); }
      catch (e) { toast(e.message, 'error'); }
      finally { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    };
  }

  function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
  }

  // 点击遮罩关闭
  document.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  // ========== Toast ==========
  function toast(message, type) {
    type = type || 'info';
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span class="ic">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; setTimeout(() => el.remove(), 300); }, 3000);
  }

  return { init, switchPage, refreshAll, openModal, closeModal, toast,
           get currentPage() { return currentKey; } };
})();

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', () => {
  Auth.bindLogin();
  App.init();
});
