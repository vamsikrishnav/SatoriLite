import { getContent, getEditorView } from './editor.js';
import { sendToChat } from './chat.js';

let menuEl = null;

export function initAIActions() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      showActionsMenu();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) {
      hideMenu();
    }
  });
}

function getSelection() {
  const view = getEditorView();
  if (!view) return '';
  const { from, to } = view.state.selection.main;
  if (from === to) return '';
  return view.state.sliceDoc(from, to);
}

export function showActionsMenu() {
  hideMenu();

  const selection = getSelection();
  const content = getContent();
  if (!content) return;

  menuEl = document.createElement('div');
  menuEl.className = 'ai-actions-menu';

  const actions = [
    { label: 'Summarize note', action: () => runAction('summarize') },
    { label: 'Generate TOC', action: () => runAction('toc') },
    { label: 'Explain selection', action: () => runAction('explain'), disabled: !selection },
    { label: 'Rewrite selection', action: () => runAction('rewrite'), disabled: !selection },
    { label: 'Continue writing', action: () => runAction('continue') },
  ];

  for (const { label, action, disabled } of actions) {
    const item = document.createElement('div');
    item.className = 'ai-actions-item' + (disabled ? ' disabled' : '');
    item.textContent = label;
    if (!disabled) {
      item.addEventListener('click', () => {
        hideMenu();
        action();
      });
    }
    menuEl.appendChild(item);
  }

  document.body.appendChild(menuEl);
}

function hideMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function runAction(type) {
  const selection = getSelection();
  const content = getContent();

  let prompt = '';
  switch (type) {
    case 'summarize':
      prompt = 'Summarize this note in 3-5 bullet points. Be concise and capture the key ideas.';
      break;
    case 'toc':
      prompt = 'Generate a markdown table of contents for this note based on its headings and structure. Output only the TOC as a markdown list with links.';
      break;
    case 'explain':
      prompt = `Explain the following selected text in simple terms:\n\n"${selection}"`;
      break;
    case 'rewrite':
      prompt = `Rewrite the following text to be clearer and more concise, keeping the same meaning:\n\n"${selection}"`;
      break;
    case 'continue':
      prompt = 'Continue writing from where the note ends. Match the tone, style, and topic. Write 2-3 paragraphs.';
      break;
  }

  sendToChat(prompt);
}
