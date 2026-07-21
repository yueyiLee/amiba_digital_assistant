/**
 * auth.js — 登录 / 登出 / Token 管理（PRD 22.2 身份认证，本版新增）
 */
const Auth = (() => {
  let currentUser = null;

  async function login(username, password) {
    const data = await API.post('/auth/login', { username, password });
    localStorage.setItem('amoeba_token', data.token);
    currentUser = data.user;
    return data.user;
  }

  function logout(silent) {
    localStorage.removeItem('amoeba_token');
    currentUser = null;
    if (!silent) App.toast('已退出登录', 'success');
    showLogin();
  }

  async function fetchCurrentUser() {
    try {
      const data = await API.get('/auth/me');
      currentUser = data.user;
      return currentUser;
    } catch (e) {
      return null;
    }
  }

  function getUser() { return currentUser; }
  function isLoggedIn() { return !!localStorage.getItem('amoeba_token'); }
  // 仅 admin 超级账号是平台管理员（可管理所有租户账号）；判断依据为用户名，稳定可靠
  function isAdmin() { return !!currentUser && currentUser.username === 'admin'; }
  // 业务数据层面：每个账号对自己隔离的数据均拥有全部编辑权限
  function canEdit() { return true; }

  async function changePassword(oldPassword, newPassword) {
    return API.put('/auth/password', { oldPassword, newPassword });
  }

  // ---- UI 渲染 ----
  function showLogin() {
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('appPage').style.display = 'none';
  }

  function showApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appPage').style.display = 'flex';
    // 渲染用户信息
    const u = currentUser;
    document.getElementById('userDisplayName').textContent = u.display_name || u.username;
    // admin 为平台系统管理员；其他账号在自己数据范围内为管理员
    document.getElementById('userRoleTag').textContent = isAdmin() ? '系统管理员' : '管理员';
    // 「账号管理」仅对 admin 超级账号可见（默认由 CSS 隐藏，此处显式展开）
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = isAdmin() ? 'flex' : 'none'; });
  }

  // ---- 绑定登录表单 ----
  function bindLogin() {
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginError');
      errEl.style.display = 'none';
      try {
        await login(username, password);
        App.toast('登录成功，欢迎回来！', 'success');
        await App.init();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => logout());
  }

  return { login, logout, fetchCurrentUser, getUser, isLoggedIn, isAdmin, canEdit,
           changePassword, showLogin, showApp, bindLogin };
})();
