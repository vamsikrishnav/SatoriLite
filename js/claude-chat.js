import { getContent, getCurrentFilePath } from './editor.js';
import { marked } from 'marked';

let initialized = false;
let sessionId = '';
let isStreaming = false;
let abortController = null;

export function initClaudeChat() {
  if (initialized) return;
  initialized = true;

  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  const container = document.getElementById('panel-claude-code');
  if (!container) return;

  const panel = document.createElement('div');
  panel.className = 'cc-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'cc-header';

  const title = document.createElement('span');
  title.className = 'cc-title';
  title.textContent = 'Claude Code';

  const headerActions = document.createElement('div');
  headerActions.className = 'cc-header-actions';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-ghost cc-clear-btn';
  clearBtn.title = 'New session';
  clearBtn.textContent = 'Clear';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost cc-close-btn';
  closeBtn.title = 'Close (Cmd+Shift+K)';
  closeBtn.textContent = '×';

  headerActions.appendChild(clearBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(headerActions);

  // Messages area
  const messagesArea = document.createElement('div');
  messagesArea.className = 'cc-messages';
  messagesArea.id = 'cc-messages';

  // Input area
  const inputArea = document.createElement('div');
  inputArea.className = 'cc-input-area';

  const textarea = document.createElement('textarea');
  textarea.className = 'cc-textarea';
  textarea.id = 'cc-textarea';
  textarea.placeholder = 'Ask Claude Code…';
  textarea.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn-primary cc-send-btn';
  sendBtn.id = 'cc-send-btn';
  sendBtn.textContent = 'Send';

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendBtn);

  // Assemble
  panel.appendChild(header);
  panel.appendChild(messagesArea);
  panel.appendChild(inputArea);
  container.appendChild(panel);

  // Event handlers
  closeBtn.addEventListener('click', () => toggleClaudeChat(false));
  clearBtn.addEventListener('click', clearSession);
  sendBtn.addEventListener('click', sendMessage);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  // Global shortcut: Cmd+Shift+K
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      e.preventDefault();
      toggleClaudeChat();
    }
  });

  checkAvailability();
}


async function checkAvailability() {
  try {
    const resp = await fetch('/api/cc/status');
    const data = await resp.json();
    if (!data.available) {
      const btn = document.getElementById('btn-claude-code');
      if (btn) {
        btn.classList.add('disabled');
        btn.title = 'Claude Code not installed';
      }
    }
  } catch {
    // Server not running, ignore
  }
}


export function toggleClaudeChat(forceState) {
  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  sidebar.querySelectorAll('.sidebar-right-panel').forEach(p => p.classList.remove('active'));
  const ccPanel = document.getElementById('panel-claude-code');
  if (ccPanel) ccPanel.classList.add('active');

  if (forceState === undefined) {
    const isOpen = !sidebar.classList.contains('collapsed');
    const ccActive = ccPanel && ccPanel.classList.contains('active');
    if (isOpen && ccActive) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }
  } else if (forceState) {
    sidebar.classList.remove('collapsed');
  } else {
    sidebar.classList.add('collapsed');
  }

  if (!sidebar.classList.contains('collapsed')) {
    const textarea = document.getElementById('cc-textarea');
    if (textarea) textarea.focus();
  }
}


function clearSession() {
  sessionId = '';
  const container = document.getElementById('cc-messages');
  if (container) container.innerHTML = '';
}


function scrollToBottom() {
  const container = document.getElementById('cc-messages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}


async function sendMessage() {
  if (isStreaming) {
    await cancelStream();
    return;
  }

  const textarea = document.getElementById('cc-textarea');
  const text = textarea.value.trim();
  if (!text) return;

  textarea.value = '';
  textarea.style.height = 'auto';

  appendMessage('user', text);
  scrollToBottom();

  const payload = {
    message: text,
    session_id: sessionId,
    file_context: getContent() || '',
    file_path: getCurrentFilePath() || '',
  };

  isStreaming = true;
  updateSendButton();

  const aiEl = appendMessage('assistant', '');
  const startTime = Date.now();

  try {
    abortController = new AbortController();
    const response = await fetch('/api/cc/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);
          switch (event.type) {
            case 'session':
              sessionId = event.session_id;
              break;
            case 'text':
              fullText += event.content;
              renderStreamingText(aiEl, fullText);
              scrollToBottom();
              break;
            case 'tool_start':
              appendToolActivity(aiEl, event.tool, event.input);
              scrollToBottom();
              break;
            case 'error':
              appendError(aiEl, event.content);
              break;
            case 'done': {
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              finalizeMessage(aiEl, fullText, elapsed);
              break;
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      appendError(aiEl, err.message);
    }
  } finally {
    isStreaming = false;
    abortController = null;
    updateSendButton();
    scrollToBottom();
  }
}


async function cancelStream() {
  if (abortController) {
    abortController.abort();
  }
  if (sessionId) {
    fetch('/api/cc/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {});
  }
  isStreaming = false;
  updateSendButton();
}


function updateSendButton() {
  const btn = document.getElementById('cc-send-btn');
  if (btn) {
    btn.textContent = isStreaming ? 'Stop' : 'Send';
    btn.classList.toggle('cc-stop-btn', isStreaming);
  }
}


function appendMessage(role, content) {
  const container = document.getElementById('cc-messages');
  if (!container) return null;

  const el = document.createElement('div');
  el.className = `cc-message cc-message-${role}`;

  if (role === 'user') {
    el.textContent = content;
  }

  container.appendChild(el);
  return el;
}


let _renderTimer = null;

function renderStreamingText(el, text) {
  if (_renderTimer) return;
  _renderTimer = setTimeout(() => {
    _renderTimer = null;
    let textEl = el.querySelector('.cc-message-text');
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.className = 'cc-message-text';
      el.appendChild(textEl);
    }
    textEl.innerHTML = marked.parse(text);
  }, 100);
}


function finalizeMessage(el, text, elapsed) {
  if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }

  let textEl = el.querySelector('.cc-message-text');
  if (!textEl) {
    textEl = document.createElement('div');
    textEl.className = 'cc-message-text';
    el.appendChild(textEl);
  }
  textEl.innerHTML = marked.parse(text || '');

  if (elapsed) {
    const timerEl = document.createElement('div');
    timerEl.className = 'cc-elapsed';
    timerEl.textContent = `${elapsed}s`;
    el.appendChild(timerEl);
  }
}


function appendToolActivity(messageEl, toolName, input) {
  const block = document.createElement('div');
  block.className = 'cc-tool-activity';

  const header = document.createElement('div');
  header.className = 'cc-tool-header';

  const chevron = document.createElement('span');
  chevron.className = 'cc-tool-chevron';
  chevron.textContent = '▶';

  const label = document.createElement('span');
  label.className = 'cc-tool-label';
  label.textContent = toolName;

  const summary = document.createElement('span');
  summary.className = 'cc-tool-summary';
  summary.textContent = formatToolSummary(toolName, input);

  header.appendChild(chevron);
  header.appendChild(label);
  header.appendChild(summary);

  const details = document.createElement('div');
  details.className = 'cc-tool-details hidden';
  details.textContent = JSON.stringify(input, null, 2);

  header.addEventListener('click', () => {
    details.classList.toggle('hidden');
    chevron.textContent = details.classList.contains('hidden') ? '▶' : '▼';
  });

  block.appendChild(header);
  block.appendChild(details);
  messageEl.appendChild(block);
}


function formatToolSummary(tool, input) {
  if (tool === 'Read' && input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (tool === 'Bash' && input.command) {
    return input.command.length > 40 ? input.command.slice(0, 40) + '…' : input.command;
  }
  if (tool === 'Edit' && input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (tool === 'Write' && input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (input.query) return input.query;
  if (input.file_path) return input.file_path.split('/').pop();
  return '';
}


function appendError(el, message) {
  const errEl = document.createElement('div');
  errEl.className = 'cc-error';
  errEl.textContent = `Error: ${message}`;
  el.appendChild(errEl);
}
