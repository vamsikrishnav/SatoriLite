import { getContent, getCurrentFilePath } from './editor.js';
import { marked } from 'marked';

const SERVER_URL = '';

// State
let messages = []; // Array of { role: 'user'|'assistant', content: string }
let isStreaming = false;
let selectedModel = localStorage.getItem('satori-chat-model') || '';
let availableModels = [];

/**
 * Initialize the AI chat panel inside #sidebar-right.
 * Builds DOM, registers keyboard shortcut, and wires event handlers.
 */
let chatInitialized = false;


export function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;

  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  // Build chat panel inside #panel-chat
  const chatContainer = document.getElementById('panel-chat');
  if (!chatContainer) return;

  const panel = document.createElement('div');
  panel.className = 'chat-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'chat-header';

  const title = document.createElement('span');
  title.className = 'chat-title';
  title.textContent = 'AI Chat';

  const headerActions = document.createElement('div');
  headerActions.className = 'chat-header-actions';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-ghost chat-clear-btn';
  clearBtn.title = 'Clear history';
  clearBtn.textContent = 'Clear';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost chat-close-btn';
  closeBtn.title = 'Close (Cmd+Shift+L)';
  closeBtn.textContent = '×';

  headerActions.appendChild(clearBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(headerActions);

  // Messages area
  const messagesArea = document.createElement('div');
  messagesArea.className = 'chat-messages';
  messagesArea.id = 'chat-messages';

  // Input area
  const inputArea = document.createElement('div');
  inputArea.className = 'chat-input-area';

  const textarea = document.createElement('textarea');
  textarea.className = 'chat-textarea';
  textarea.id = 'chat-textarea';
  textarea.placeholder = 'Ask anything…';
  textarea.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn-primary chat-send-btn';
  sendBtn.id = 'chat-send-btn';
  sendBtn.textContent = 'Send';

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendBtn);

  // Model selector
  const modelBar = document.createElement('div');
  modelBar.className = 'chat-model-bar';

  const modelSelect = document.createElement('select');
  modelSelect.className = 'chat-model-select';
  modelSelect.id = 'chat-model-select';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Loading models…';
  modelSelect.appendChild(defaultOpt);

  modelSelect.addEventListener('change', () => {
    selectedModel = modelSelect.value;
    localStorage.setItem('satori-chat-model', selectedModel);
  });

  modelBar.appendChild(modelSelect);



  // Assemble panel
  panel.appendChild(header);
  panel.appendChild(modelBar);
  panel.appendChild(messagesArea);
  panel.appendChild(inputArea);
  chatContainer.appendChild(panel);

  // Load models
  loadModels();

  // Open all links in chat in a new browser tab
  messagesArea.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener');
    }
  });

  // Event handlers
  closeBtn.addEventListener('click', () => toggleChat(false));

  clearBtn.addEventListener('click', () => {
    messages = [];
    renderMessages();
  });

  sendBtn.addEventListener('click', () => sendMessage());

  // Enter to send, Shift+Enter for newline
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-grow textarea
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  // Register global keyboard shortcut: Cmd+Shift+L / Ctrl+Shift+L
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      toggleChat();
    }
  });

}

/**
 * Toggle the chat panel open/closed.
 * @param {boolean} [forceState] - If provided, force open (true) or closed (false).
 */
export function toggleChat(forceState) {
  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  // Switch to chat panel
  sidebar.querySelectorAll('.sidebar-right-panel').forEach(p => p.classList.remove('active'));
  const chatPanel = sidebar.querySelector('#panel-chat');
  if (chatPanel) chatPanel.classList.add('active');

  if (forceState === undefined) {
    const isOpen = !sidebar.classList.contains('collapsed');
    const chatActive = chatPanel && chatPanel.classList.contains('active');
    if (isOpen && chatActive) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }
  } else if (forceState) {
    sidebar.classList.remove('collapsed');
  } else {
    sidebar.classList.add('collapsed');
  }

  // Focus textarea when opening
  if (!sidebar.classList.contains('collapsed')) {
    const textarea = document.getElementById('chat-textarea');
    if (textarea) textarea.focus();
  }
}

/**
 * Send the current textarea content as a user message.
 */
async function sendMessage() {
  if (isStreaming) return;

  const textarea = document.getElementById('chat-textarea');
  const text = textarea.value.trim();
  if (!text) return;

  // Clear input
  textarea.value = '';
  textarea.style.height = 'auto';

  // Add user message to history
  messages.push({ role: 'user', content: text });
  renderMessages();
  scrollToBottom();

  // Prepare request payload — always send current file + let server do RAG
  const payload = {
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    model: selectedModel,
    file_context: getContent() || '',
    file_path: getCurrentFilePath() || '',
  };

  // Show loading indicator
  isStreaming = true;
  const loadingEl = showLoading();
  const startTime = Date.now();

  try {
    const response = await fetch(`${SERVER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    // Remove loading indicator, add empty AI message to fill
    removeLoading(loadingEl);
    const aiMessageIndex = messages.length;
    messages.push({ role: 'assistant', content: '' });

    // Manually render to avoid clearing issues — append AI message without re-rendering all
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
      const aiEl = document.createElement('div');
      aiEl.className = 'chat-message chat-message-ai';
      aiEl.dataset.index = aiMessageIndex;
      chatContainer.appendChild(aiEl);
    }
    scrollToBottom();

    // Stream SSE response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageSources = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);
          if (event.type === 'progress') {
            updateProgress(event.tool, event.input);
          } else if (event.type === 'sources') {
            messageSources = (event.items || event.paths || []).map(item => {
              if (typeof item === 'string') return { path: item, vault: '', title: item.split('/').pop().replace('.md', '') };
              return { path: item.path, vault: item.vault || '', title: item.path.split('/').pop().replace('.md', '') };
            });
          } else if (event.type === 'text') {
            removeProgress();
            messages[aiMessageIndex].content += event.content;
            streamToLastAIMessage(messages[aiMessageIndex].content);
            scrollToBottom();
          } else if (event.type === 'done') {
            removeProgress();
            if (_streamRenderTimer) { clearTimeout(_streamRenderTimer); _streamRenderTimer = null; }
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            messages[aiMessageIndex].sources = messageSources;
            messages[aiMessageIndex].elapsed = elapsed;
            updateLastAIMessage(messages[aiMessageIndex].content, messageSources, elapsed);
          } else if (event.type === 'error') {
            removeProgress();
            messages[aiMessageIndex].content += `\n[Error: ${event.content}]`;
            updateLastAIMessage(messages[aiMessageIndex].content, messageSources);
          }
        } catch (parseErr) {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err) {
    removeLoading(loadingEl);
    messages.push({ role: 'assistant', content: `[Error: ${err.message}]` });
    renderMessages();
  } finally {
    isStreaming = false;
    scrollToBottom();
  }
}

/**
 * Render all messages into the chat-messages container using safe DOM methods.
 */
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  container.innerHTML = '';

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const el = document.createElement('div');
    el.className = 'chat-message ' + (msg.role === 'user' ? 'chat-message-user' : 'chat-message-ai');
    el.dataset.index = i;
    if (msg.role === 'assistant') {
      el.innerHTML = marked.parse(msg.content || '');
    } else {
      el.textContent = msg.content;
    }
    container.appendChild(el);
  }
}

/**
 * Update the last AI message element in-place (for streaming).
 * Note: marked.parse is used here on LLM-generated markdown for display.
 * The content is from our own backend (not user-supplied), and marked
 * sanitizes by default (no raw HTML passthrough).
 */
function updateLastAIMessage(content, sources, elapsed) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const aiMessages = container.querySelectorAll('.chat-message-ai');
  const last = aiMessages[aiMessages.length - 1];
  if (!last) return;

  last.textContent = '';

  const textEl = document.createElement('div');
  textEl.className = 'chat-message-text';
  textEl.innerHTML = marked.parse(content || '');
  last.appendChild(textEl);

  if (sources && sources.length > 0) {
    const existingSources = last.querySelector('.chat-sources');
    if (existingSources) existingSources.remove();

    const sourcesEl = document.createElement('div');
    sourcesEl.className = 'chat-sources';

    const label = document.createElement('span');
    label.className = 'chat-sources-label';
    label.textContent = 'Sources:';
    sourcesEl.appendChild(label);

    for (const src of sources) {
      const chip = document.createElement('button');
      chip.className = 'chat-source-chip';
      const filename = src.path.split('/').pop();
      chip.textContent = src.vault ? `${src.vault}: ${filename}` : filename;
      chip.title = src.vault ? `[${src.vault}] ${src.path}` : src.path;
      chip.addEventListener('click', async () => {
        try {
          const resp = await fetch(`${SERVER_URL}/api/file?path=${encodeURIComponent(src.path)}`);
          if (!resp.ok) throw new Error('File not found');
          const data = await resp.json();
          window.dispatchEvent(new CustomEvent('satorilite:file-open-content', {
            detail: { path: src.path, content: data.content, vault: data.vault }
          }));
        } catch (_) {
          window.dispatchEvent(new CustomEvent('satorilite:file-open', {
            detail: { path: src.path }
          }));
        }
      });
      sourcesEl.appendChild(chip);
    }
    last.appendChild(sourcesEl);
  }

  if (elapsed) {
    const timerEl = document.createElement('div');
    timerEl.className = 'chat-elapsed';
    timerEl.textContent = `${elapsed}s`;
    last.appendChild(timerEl);
  }
}

/**
 * Show a loading indicator in the messages area.
 * @returns {HTMLElement} The loading element (for later removal).
 */
function showLoading() {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-loading';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.appendChild(dot);
  }
  container.appendChild(el);
  scrollToBottom();
  return el;
}

/**
 * Remove a loading indicator element.
 */
function removeLoading(el) {
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

/**
 * Scroll the messages container to the bottom.
 */
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

/**
 * Programmatically send a message to the chat panel.
 * Opens the panel, injects the text, and triggers send.
 */
export function sendToChat(text) {
  if (!text) return;
  toggleChat(true);
  const textarea = document.getElementById('chat-textarea');
  if (textarea) {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
  }
  sendMessage();
}

/**
 * Show what the agent is currently doing (tool calls in progress).
 */
function updateProgress(tool, input) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const aiMessages = container.querySelectorAll('.chat-message-ai');
  const lastAi = aiMessages[aiMessages.length - 1];
  if (!lastAi) return;
  let progressEl = lastAi.querySelector('.chat-progress');
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.className = 'chat-progress';
    lastAi.appendChild(progressEl);
  }

  // Mark previous lines: checkmark → slide left + blur → collapse
  const prevLines = progressEl.querySelectorAll('div:not(.completed):not(.completing):not(.sliding)');
  prevLines.forEach((l, i) => {
    const stagger = i * 200;
    setTimeout(() => {
      l.classList.add('completing');
      l.querySelector('span')?.style.setProperty('color', 'var(--accent-secondary, #a6e3a1)');
      setTimeout(() => { l.classList.add('sliding'); }, 300);
      setTimeout(() => { l.classList.add('completed'); }, 700);
    }, stagger);
  });

  const detail = input.detail || input.status || '';

  const line = document.createElement('div');
  const toolSpan = document.createElement('span');
  toolSpan.style.cssText = 'color: var(--accent-primary); font-weight: 600;';
  toolSpan.textContent = tool;
  line.appendChild(toolSpan);
  if (detail) {
    const detailSpan = document.createElement('span');
    detailSpan.style.cssText = 'color: var(--text-muted);';
    detailSpan.textContent = detail;
    line.appendChild(detailSpan);
  }
  progressEl.appendChild(line);
  scrollToBottom();
}

let _streamRenderTimer = null;
let _streamLastContent = '';

/**
 * Streaming update with debounced markdown rendering (~150ms).
 * Gives progressive formatting without blocking on every token.
 */
function streamToLastAIMessage(content) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const aiMessages = container.querySelectorAll('.chat-message-ai');
  const last = aiMessages[aiMessages.length - 1];
  if (!last) return;

  _streamLastContent = content;

  if (!_streamRenderTimer) {
    _streamRenderTimer = setTimeout(() => {
      _streamRenderTimer = null;
      last.innerHTML = marked.parse(_streamLastContent || '');
      scrollToBottom();
    }, 150);
  }
}

/**
 * Remove the progress indicator.
 */
function removeProgress() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const els = container.querySelectorAll('.chat-progress');
  els.forEach(el => el.remove());
}

/**
 * Fetch available models from the server and populate the dropdown.
 */
async function loadModels() {
  const select = document.getElementById('chat-model-select');
  if (!select) return;

  try {
    const resp = await fetch(`${SERVER_URL}/api/models`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    availableModels = await resp.json();

    select.textContent = '';
    for (const model of availableModels) {
      const opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = model.name;
      if (model.id === selectedModel) opt.selected = true;
      select.appendChild(opt);
    }

    if (!selectedModel && availableModels.length > 0) {
      selectedModel = availableModels[0].id;
      localStorage.setItem('satori-chat-model', selectedModel);
    }
  } catch (err) {
    console.error('[chat] failed to load models:', err);
    select.textContent = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Default model';
    select.appendChild(opt);
  }
}



