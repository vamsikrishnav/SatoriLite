/**
 * SatoriLite — Markdown Preview Renderer
 * Renders markdown content into the preview pane with live updates.
 * Lazy-loads mermaid and KaTeX when needed (fails silently if libs missing).
 */

import { marked, Renderer } from 'marked';

// --- Utilities ---

/**
 * Strip YAML frontmatter from markdown content
 * @param {string} content - Raw markdown string
 * @returns {string} Content without frontmatter
 */
function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- Marked Configuration ---

/**
 * Create a custom marked renderer for SatoriLite
 */
function createRenderer() {
  const renderer = new Renderer();

  // Code blocks: language tag + copy button, mermaid detection
  renderer.code = function ({ text, lang }) {
    const langStr = lang || '';

    // Mermaid blocks — wrap in placeholder div for lazy rendering
    if (langStr === 'mermaid') {
      return `<div class="mermaid-block" data-mermaid-source="${escapeHtml(text)}">${escapeHtml(text)}</div>`;
    }

    // Standard code blocks with toolbar (lang tag + copy button)
    const langTag = langStr
      ? `<span class="code-lang-tag">${escapeHtml(langStr)}</span>`
      : '<span class="code-lang-tag"></span>';

    const copyBtn = `<button class="code-copy-btn" title="Copy code">
      <svg class="code-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <svg class="code-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </button>`;

    const toolbar = `<div class="code-toolbar">${langTag}${copyBtn}</div>`;
    const codeClass = langStr ? ` class="language-${escapeHtml(langStr)}"` : '';

    return `<pre>${toolbar}<code${codeClass}>${escapeHtml(text)}</code></pre>`;
  };

  // Links: handle internal .md links
  renderer.link = function ({ href, title, text }) {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

    // External links — open in new tab
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener">${text}</a>`;
    }

    // Internal links — mark with data attribute for interception
    return `<a href="${escapeHtml(href || '')}"${titleAttr} data-internal="true">${text}</a>`;
  };

  return renderer;
}

// --- KaTeX Handling ---

/**
 * Process math expressions in rendered HTML using DOM walking.
 * Detects $...$ (inline) and $$...$$ (block) patterns.
 * Lazy-loads KaTeX — fails silently if not available.
 * @param {HTMLElement} container - The preview pane element
 */
async function processKaTeX(container) {
  let katex;
  try {
    katex = await import('/lib/katex/katex.min.js');
    if (katex.default) katex = katex.default;
  } catch {
    // KaTeX not available yet — skip silently
    return;
  }

  // Ensure KaTeX CSS is loaded
  if (!document.querySelector('link[href*="katex"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/lib/katex/katex.min.css';
    document.head.appendChild(link);
  }

  // Walk text nodes looking for math delimiters
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip nodes inside <pre>, <code>, .mermaid-block
      const parent = node.parentElement;
      if (parent && (parent.closest('pre') || parent.closest('code') || parent.closest('.mermaid-block'))) {
        return NodeFilter.FILTER_REJECT;
      }
      // Only accept nodes that contain $ patterns
      if (node.textContent.includes('$')) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    }
  });

  const textNodes = [];
  let current;
  while ((current = walker.nextNode())) {
    textNodes.push(current);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent;
    // Match $$...$$ (block) and $...$ (inline)
    const regex = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
    let match;
    const parts = [];
    let lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }

      const isBlock = match[1] !== undefined;
      const mathContent = isBlock ? match[1] : match[2];

      try {
        const html = katex.renderToString(mathContent.trim(), {
          displayMode: isBlock,
          throwOnError: false,
        });
        parts.push({ type: 'math', html, isBlock });
      } catch {
        // If KaTeX fails to parse, leave as-is
        parts.push({ type: 'text', content: match[0] });
      }

      lastIndex = match.index + match[0].length;
    }

    // If no matches, skip this node
    if (parts.length === 0) continue;

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    // Replace text node with fragment
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (part.type === 'text') {
        fragment.appendChild(document.createTextNode(part.content));
      } else {
        const wrapper = document.createElement(part.isBlock ? 'div' : 'span');
        wrapper.className = part.isBlock ? 'math-block' : 'math-inline';
        wrapper.innerHTML = part.html;
        fragment.appendChild(wrapper);
      }
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

// --- Mermaid Handling ---

/**
 * Render mermaid diagrams in the preview pane.
 * Lazy-loads mermaid — fails silently if not available.
 * @param {HTMLElement} container - The preview pane element
 */
async function processMermaid(container) {
  const blocks = container.querySelectorAll('.mermaid-block[data-mermaid-source]');
  if (blocks.length === 0) return;

  let mermaid;
  try {
    const mod = await import('/lib/mermaid.esm.min.js');
    mermaid = mod.default || mod;
  } catch {
    // Mermaid not available yet — leave blocks as raw text
    return;
  }

  mermaid.initialize({ startOnLoad: false, theme: 'dark' });

  for (const block of blocks) {
    const source = block.getAttribute('data-mermaid-source');
    try {
      const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
      const { svg } = await mermaid.render(id, source);
      block.innerHTML = svg;
      block.removeAttribute('data-mermaid-source');
    } catch {
      // Failed to render — leave raw text visible
    }
  }
}

// --- Core Render Function ---

/** @type {HTMLElement|null} */
let previewPane = null;

/** @type {string|null} Current file path for resolving relative links */
let currentFilePath = null;

/**
 * Render markdown content into the preview pane
 * @param {string} content - Raw markdown content
 */
function renderPreview(content) {
  if (!previewPane) return;

  const stripped = stripFrontmatter(content);
  const html = marked(stripped);
  previewPane.innerHTML = html;

  // Post-process: lazy-load mermaid and KaTeX (fire-and-forget)
  processMermaid(previewPane);
  processKaTeX(previewPane);
}

// --- Event Handlers ---

/**
 * Handle clicks in the preview pane (event delegation)
 * - Internal links dispatch satorilite:file-open
 * - Copy buttons copy code to clipboard
 */
function handlePreviewClick(e) {
  // Internal link click
  const link = e.target.closest('a[data-internal="true"]');
  if (link) {
    e.preventDefault();
    let href = link.getAttribute('href');

    // Resolve relative path against current file's directory
    if (currentFilePath && !href.startsWith('/')) {
      const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      href = dir ? `${dir}/${href}` : href;
    }

    // Ensure .md extension
    if (!href.endsWith('.md')) {
      href += '.md';
    }

    window.dispatchEvent(new CustomEvent('satorilite:file-open', {
      detail: { path: href }
    }));
    return;
  }

  // Copy button click
  const copyBtn = e.target.closest('.code-copy-btn');
  if (copyBtn) {
    e.preventDefault();
    const pre = copyBtn.closest('pre');
    if (!pre) return;
    const code = pre.querySelector('code');
    if (!code) return;

    navigator.clipboard.writeText(code.textContent).then(() => {
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 2000);
    });
    return;
  }
}

// --- Init ---

/**
 * Initialize the markdown preview renderer.
 * Configures marked and sets up event listeners.
 */
export function initRenderer() {
  previewPane = document.getElementById('preview-pane');
  if (!previewPane) {
    console.error('Preview pane element not found');
    return;
  }

  // Configure marked with custom renderer
  marked.use({
    renderer: createRenderer(),
    gfm: true,
    breaks: false,
  });

  // Click handler for links and copy buttons
  previewPane.addEventListener('click', handlePreviewClick);

  // Listen for file-loaded events
  window.addEventListener('satorilite:file-loaded', (e) => {
    const { path, content } = e.detail;
    currentFilePath = path;
    renderPreview(content);
  });

  // Listen for content-changed events (debounced by editor)
  window.addEventListener('satorilite:content-changed', (e) => {
    const { content, path } = e.detail;
    if (path) currentFilePath = path;
    renderPreview(content);
  });
}
