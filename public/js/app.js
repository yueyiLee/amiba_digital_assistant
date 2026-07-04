/**
 * app.js — 主应用控制器
 * 页面路由切换、初始化流程、Modal 管理、Toast 通知。
 */
const App = (() => {
  let currentPage = 'dashboard';

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
    // 同步设置页币种到看板切换器
    const savedCur = Storage.getSettingsSync().currency || '¥';
    const curCode = savedCur === '$' ? 'USD' : (savedCur === '€' ? 'EUR' : 'CNY');
    Currency.setDisplayCurrency(curCode);
    const dashCurSel = document.getElementById('dashboardCurrency');
    if (dashCurSel) dashCurSel.value = curCode;
    // 同步设置页下拉
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
    // 默认显示看板
    switchPage('dashboard');
  }

  // ========== 页面路由 ==========
  function switchPage(page) {
    // 权限校验：用户管理仅 admin
    if (page === 'users' && !Auth.isAdmin()) {
      toast('权限不足，仅管理员可访问用户管理', 'error');
      return;
    }
    currentPage = page;
    // 切换导航高亮
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.page === page);
    });
    // 切换页面显示
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById('page-' + page);
    if (section) section.classList.add('active');

    // 渲染对应页面
    refreshPage(page);
  }

  function refreshPage(page) {
    switch (page) {
      case 'dashboard':
        Dashboard.renderUnitFilter();
        Dashboard.render();
        break;
      case 'entry': Entry.render(); break;
      case 'business': Business.render(); break;
      case 'employees': Employees.render(); break;
      case 'settings': Settings.render(); break;
      case 'users': Users.render(); break;
    }
  }

  function refreshAll() {
    Dashboard.renderUnitFilter();
    Dashboard.render();
    Entry.render();
    Business.render();
    Employees.render();
    Settings.render();
    if (Auth.isAdmin()) Users.render();
  }

  // ========== 导航绑定 ==========
  function bindNav() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => switchPage(tab.dataset.page));
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

  return { init, switchPage, refreshPage, refreshAll, openModal, closeModal, toast,
           get currentPage() { return currentPage; } };
})();

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', () => {
  Auth.bindLogin();
  App.init();
});
