/**
 * Status Bar Module
 * Updates path, word count, character count, and estimated token count.
 */

let statusPathEl;
let statusWordsEl;
let statusCharsEl;
let statusTokensEl;
let showReadingTime = false;

function updateCounts(content) {
  const words = content.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const charCount = content.length;
  const tokenEstimate = Math.round(wordCount * 1.3);

  if (showReadingTime) {
    const minutes = Math.max(1, Math.round(wordCount / 200));
    statusWordsEl.textContent = `~${minutes} min read`;
  } else {
    statusWordsEl.textContent = `${wordCount} words`;
  }

  statusCharsEl.textContent = `${charCount} chars`;
  statusTokensEl.textContent = `~${tokenEstimate} tokens`;
}

/**
 * Initialize the status bar listeners
 */
export function initStatusBar() {
  statusPathEl = document.getElementById('status-path');
  statusWordsEl = document.getElementById('status-words');
  statusCharsEl = document.getElementById('status-chars');
  statusTokensEl = document.getElementById('status-tokens');

  if (!statusPathEl || !statusWordsEl || !statusCharsEl || !statusTokensEl) {
    console.warn('Status bar elements not found');
    return;
  }

  // Toggle reading time on click
  statusWordsEl.addEventListener('click', () => {
    showReadingTime = !showReadingTime;
    // Re-trigger update with last known content
    if (lastContent !== null) {
      updateCounts(lastContent);
    }
  });

  window.addEventListener('satorilite:file-loaded', (e) => {
    const { path, content } = e.detail;
    statusPathEl.textContent = path;
    lastContent = content;
    updateCounts(content);
  });

  window.addEventListener('satorilite:content-changed', (e) => {
    const { content, path } = e.detail;
    if (path) {
      statusPathEl.textContent = path;
    }
    lastContent = content;
    updateCounts(content);
  });
}

let lastContent = null;
