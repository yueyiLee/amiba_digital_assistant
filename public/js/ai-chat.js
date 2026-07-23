/**
 * ai-chat.js — AI 对话面板前端组件
 * 通过 fetch + ReadableStream 接收 SSE 流式回复，
 * 支持 Markdown 渲染、工具执行状态显示、快捷操作。
 */
const AIChat = (() => {
  let messages = [];       // 对话历史（发给后端的）
  let isStreaming = false;  // 是否正在流式接收
  let abortController = null;

  const panel = () => document.getElementById('aiChatPanel');
  const body = () => document.getElementById('aiChatBody');
  const input = () => document.getElementById('aiChatInput');
  const sendBtn = () => document.getElementById('aiChatSend');

  // ========== 面板开关 ==========
  function togglePanel() {
    const p = panel();
    if (p.style.display === 'none') {
      p.style.display = 'flex';
      input().focus();
    } else {
      p.style.display = 'none';
    }
  }

  function closePanel() { panel().style.display = 'none'; }

  function clearChat() {
    messages = [];
    body().innerHTML = `
      <div class="ai-chat-welcome">
        <div class="ai-welcome-icon">👋</div>
        <p>你好！我是 AI 经营助手，可以帮你查询数据、录入记录、分析经营状况。</p>
        <div class="ai-quick-actions" id="aiQuickActions">
          <button class="ai-quick-btn" data-prompt="这个月的经营情况怎么样？">📊 本月经营概况</button>
          <button class="ai-quick-btn" data-prompt="帮我查看所有客户列表">👥 查看客户</button>
          <button class="ai-quick-btn" data-prompt="本月有哪些支出？按类型汇总">💰 支出汇总</button>
          <button class="ai-quick-btn" data-prompt="哪些客户还有应收款？">📋 应收账款</button>
          <button class="ai-quick-btn" data-prompt="帮我看看库存情况">📦 库存查询</button>
          <button class="ai-quick-btn" data-prompt="本月员工工时和工资是多少？">👤 工时工资</button>
        </div>
      </div>`;
    bindQuickActions();
  }

  // ========== 消息渲染 ==========
  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'ai-msg user';
    el.innerHTML = `<div class="ai-msg-avatar">👤</div><div class="ai-msg-bubble"></div>`;
    el.querySelector('.ai-msg-bubble').textContent = text;
    body().appendChild(el);
    scrollToBottom();
  }

  function addBotMessage() {
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.innerHTML = `<div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble"></div>`;
    body().appendChild(el);
    scrollToBottom();
    return el.querySelector('.ai-msg-bubble');
  }

  function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.id = 'aiTypingIndicator';
    el.innerHTML = `<div class="ai-msg-avatar">🤖</div><div class="ai-typing"><span></span><span></span><span></span></div>`;
    body().appendChild(el);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const el = document.getElementById('aiTypingIndicator');
    if (el) el.remove();
  }

  function addToolStatus(toolName) {
    const el = document.createElement('div');
    el.className = 'ai-tool-status';
    el.dataset.toolName = toolName;
    el.innerHTML = `<span class="spinner"></span><span>正在执行：${toolName}...</span>`;
    body().appendChild(el);
    scrollToBottom();
    return el;
  }

  function updateToolStatus(el, result) {
    if (!el) return;
    if (result.success) {
      el.classList.add('done');
      el.innerHTML = `<span>✓</span><span>${result.message || '操作成功'}</span>`;
    } else {
      el.classList.add('error');
      el.innerHTML = `<span>✕</span><span>${result.message || '操作失败'}</span>`;
    }
  }

  function renderMarkdown(text) {
    try {
      return marked.parse(text, { breaks: true });
    } catch (e) {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
  }

  function scrollToBottom() {
    const b = body();
    b.scrollTop = b.scrollHeight;
  }

  // ========== 发送消息（SSE 流式） ==========
  async function sendMessage(text) {
    if (!text || !text.trim() || isStreaming) return;
    text = text.trim();

    // 添加到消息历史
    messages.push({ role: 'user', content: text });
    addUserMessage(text);
    input().value = '';
    autoResize();
    setStreaming(true);

    const bubble = addBotMessage();
    addTypingIndicator();

    let fullText = '';

    try {
      abortController = new AbortController();
      const token = localStorage.getItem('amoeba_token') || '';

      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ messages }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: '请求失败' }));
        throw new Error(errData.error || `请求失败 (${resp.status})`);
      }

      removeTypingIndicator();

      // 读取 SSE 流
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的行

        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              // 处理 SSE 事件
              if (currentEvent === 'text' && data.text) {
                fullText += data.text;
                bubble.innerHTML = renderMarkdown(fullText);
                scrollToBottom();
              } else if (currentEvent === 'tool_start' && data.name) {
                addToolStatus(data.name);
              } else if (currentEvent === 'tool_end') {
                // 找到最后一个匹配的未完成 tool-status 元素
                const statusEls = body().querySelectorAll(`.ai-tool-status[data-tool-name="${data.name}"]:not(.done):not(.error)`);
                if (statusEls.length > 0) {
                  updateToolStatus(statusEls[statusEls.length - 1], data);
                }
              } else if (currentEvent === 'error') {
                bubble.innerHTML += `<div style="color:#ff4d4f;">⚠ ${data.message}</div>`;
              }
            } catch (e) { /* 忽略解析错误 */ }
            currentEvent = null;
          }
        }
      }

      // 将 AI 回复加入历史
      if (fullText) {
        messages.push({ role: 'assistant', content: fullText });
      }
    } catch (err) {
      removeTypingIndicator();
      if (err.name === 'AbortError') {
        bubble.innerHTML = '<em style="color:#999;">已取消</em>';
      } else {
        bubble.innerHTML = `<span style="color:#ff4d4f;">⚠ ${err.message}</span>`;
      }
    } finally {
      setStreaming(false);
      abortController = null;
    }
  }

  function setStreaming(val) {
    isStreaming = val;
    sendBtn().disabled = val;
    sendBtn().textContent = val ? '...' : '发送';
    input().disabled = val;
  }

  // ========== 事件绑定 ==========
  function autoResize() {
    const inp = input();
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  }

  function bindQuickActions() {
    document.querySelectorAll('.ai-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sendMessage(btn.dataset.prompt);
      });
    });
  }

  function bind() {
    document.getElementById('aiChatToggle').addEventListener('click', togglePanel);
    document.getElementById('aiChatClose').addEventListener('click', closePanel);
    document.getElementById('aiChatClear').addEventListener('click', clearChat);

    const inp = input();
    const btn = sendBtn();

    btn.addEventListener('click', () => sendMessage(inp.value));

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inp.value);
      }
    });

    inp.addEventListener('input', autoResize);

    bindQuickActions();
  }

  return { bind, togglePanel, sendMessage };
})();
