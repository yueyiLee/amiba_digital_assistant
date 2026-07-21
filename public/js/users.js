/**
 * users.js — 用户管理页面
 * 用户列表 + 添加/编辑/删除用户 + 重置密码。
 * 所有账号默认管理员权限，不再区分角色。
 */
const Users = (() => {

  function render() {
    const list = Storage.getUsersSync();
    document.getElementById('userCount').textContent = list.length;

    const tbl = document.getElementById('userTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="4" class="empty-state">暂无用户</td></tr>'; return; }
    const me = Auth.getUser();
    tbl.innerHTML = `<thead><tr><th>用户名</th><th>显示名</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody>${list.map(u => {
        const isMe = me && u.id === me.id;
        return `<tr>
          <td>${u.username}${isMe ? ' <span class="badge g">我</span>' : ''}</td>
          <td>${u.display_name}</td>
          <td>${u.created_at ? u.created_at.replace('T', ' ').substring(0, 16) : '—'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="Users.openEditModal(${u.id})">编辑</button>
            <button class="btn btn-secondary btn-sm" onclick="Users.openPwdModal(${u.id})">重置密码</button>
            ${!isMe ? `<button class="btn btn-danger btn-sm" onclick="Users.del(${u.id})">删</button>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  function openModal() {
    const body = `
      <div class="form-group"><label class="form-label">用户名 <span class="req">*</span></label><input type="text" class="form-input" id="m-username" placeholder="登录用户名"></div>
      <div class="form-group"><label class="form-label">密码 <span class="req">*</span></label><input type="password" class="form-input" id="m-password" placeholder="至少 6 位"></div>
      <div class="form-group"><label class="form-label">显示名</label><input type="text" class="form-input" id="m-display_name" placeholder="用户昵称"></div>`;
    App.openModal('添加用户', body, async () => {
      const data = {
        username: document.getElementById('m-username').value.trim(),
        password: document.getElementById('m-password').value,
        display_name: document.getElementById('m-display_name').value.trim()
      };
      if (!data.username) return App.toast('用户名必填', 'error');
      if (!data.password || data.password.length < 6) return App.toast('密码至少 6 位', 'error');
      try {
        await API.post('/users', data);
        await Storage.refreshCache();
        render();
        App.closeModal();
        App.toast('用户已添加', 'success');
      } catch (e) { App.toast(e.message, 'error'); }
    });
  }

  function openEditModal(id) {
    const list = Storage.getUsersSync();
    const u = list.find(x => x.id === id);
    if (!u) return;
    const body = `
      <div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" value="${u.username}" disabled></div>
      <div class="form-group"><label class="form-label">显示名</label><input type="text" class="form-input" id="m-display_name" value="${u.display_name}"></div>`;
    App.openModal('编辑用户', body, async () => {
      const data = {
        display_name: document.getElementById('m-display_name').value.trim()
      };
      try {
        await API.put('/users/' + id, data);
        await Storage.refreshCache();
        render();
        App.closeModal();
        App.toast('用户已更新', 'success');
      } catch (e) { App.toast(e.message, 'error'); }
    });
  }

  function openPwdModal(id) {
    const body = `
      <div class="form-group"><label class="form-label">新密码 <span class="req">*</span></label><input type="password" class="form-input" id="m-newPassword" placeholder="至少 6 位"></div>
      <div class="info-tip"><span class="ic">⚠️</span><div>重置后用户需使用新密码登录。</div></div>`;
    App.openModal('重置密码', body, async () => {
      const newPassword = document.getElementById('m-newPassword').value;
      if (!newPassword || newPassword.length < 6) return App.toast('新密码至少 6 位', 'error');
      try {
        await API.put(`/users/${id}/password`, { newPassword });
        App.closeModal();
        App.toast('密码已重置', 'success');
      } catch (e) { App.toast(e.message, 'error'); }
    });
  }

  async function del(id) {
    if (!confirm('确认删除该用户？此操作不可撤销。')) return;
    try {
      await API.del('/users/' + id);
      await Storage.refreshCache();
      render();
      App.toast('用户已删除', 'success');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  return { render, openModal, openEditModal, openPwdModal, del };
})();
