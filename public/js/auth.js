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
  function isAdmin() { return currentUser && currentUser.role === 'admin'; }
  function canEdit() { return currentUser && (currentUser.role === 'admin' || currentUser.role === 'editor'); }

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
    document.getElementById('appPage').style.display = 'block';
    // 渲染用户信息
    const u = currentUser;
    document.getElementById('userDisplayName').textContent = u.display_name || u.username;
    const roleMap = { admin: '管理员', editor: '录入员', viewer: '查看者' };
    document.getElementById('userRoleTag').textContent = roleMap[u.role] || u.role;
    // 权限控制：仅 admin 显示用户管理
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin() ? '' : 'none';
    });
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
