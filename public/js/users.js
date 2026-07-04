/**
 * users.js — 用户管理页面（PRD 新增功能）
 * 用户列表 + 添加/编辑/删除用户 + 重置密码 + 角色管理。
 * 仅 admin 角色可访问。
 */
const Users = (() => {

  function render() {
    const list = Storage.getUsersSync();
    document.getElementById('userCount').textContent = list.length;
    document.getElementById('userAdminCount').textContent = list.filter(u => u.role === 'admin').length;
    document.getElementById('userEditorCount').textContent = list.filter(u => u.role === 'editor').length;
    document.getElementById('userViewerCount').textContent = list.filter(u => u.role === 'viewer').length;

    const tbl = document.getElementById('userTable');
    if (list.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">暂无用户</td></tr>'; return; }
    const roleMap = { admin: ['管理员', 'r'], editor: ['录入员', 'b'], viewer: ['查看者', 'gray'] };
    const me = Auth.getUser();
    tbl.innerHTML = `<thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody>${list.map(u => {
        const [rName, rCls] = roleMap[u.role] || [u.role, 'gray'];
        const isMe = me && u.id === me.id;
        return `<tr>
          <td>${u.username}${isMe ? ' <span class="badge g">我</span>' : ''}</td>
          <td>${u.display_name}</td>
          <td><span class="badge ${rCls}">${rName}</span></td>
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
      <div class="form-group"><label class="form-label">显示名</label><input type="text" class="form-input" id="m-display_name" placeholder="用户昵称"></div>
      <div class="form-group"><label class="form-label">角色 <span class="req">*</span></label>
        <select class="form-select" id="m-role">
          <option value="viewer">查看者 — 只能查看数据</option>
          <option value="editor">录入员 — 可录入和编辑业务数据</option>
          <option value="admin">管理员 — 全部权限（含用户管理）</option>
        </select>
      </div>
      <div class="info-tip"><span class="ic">ℹ️</span><div>角色说明：管理员可管理用户账号；录入员可录入收支与业务数据；查看者仅可查看看板与列表。</div></div>`;
    App.openModal('添加用户', body, async () => {
      const data = {
        username: document.getElementById('m-username').value.trim(),
        password: document.getElementById('m-password').value,
        display_name: document.getElementById('m-display_name').value.trim(),
        role: document.getElementById('m-role').value
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
      <div class="form-group"><label class="form-label">显示名</label><input type="text" class="form-input" id="m-display_name" value="${u.display_name}"></div>
      <div class="form-group"><label class="form-label">角色</label>
        <select class="form-select" id="m-role">
          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>查看者 — 只能查看数据</option>
          <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>录入员 — 可录入和编辑业务数据</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员 — 全部权限（含用户管理）</option>
        </select>
      </div>`;
    App.openModal('编辑用户', body, async () => {
      const data = {
        display_name: document.getElementById('m-display_name').value.trim(),
        role: document.getElementById('m-role').value
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
