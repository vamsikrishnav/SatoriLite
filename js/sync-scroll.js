let previewPane = null;
let syncing = false;
let bound = false;

function maxScroll(el) {
  return el.scrollHeight - el.clientHeight;
}

function isSplitMode() {
  const ec = document.querySelector('.editor-content');
  return ec && !ec.classList.contains('mode-editor') && !ec.classList.contains('mode-preview');
}

function onEditorScroll(e) {
  if (syncing || !isSplitMode()) return;
  syncing = true;
  const source = e.target;
  const max = maxScroll(source);
  const r = max > 0 ? source.scrollTop / max : 0;
  previewPane.scrollTo({ top: r * maxScroll(previewPane) });
  requestAnimationFrame(() => { syncing = false; });
}

function onPreviewScroll() {
  if (syncing || !isSplitMode()) return;
  syncing = true;
  const max = maxScroll(previewPane);
  const r = max > 0 ? previewPane.scrollTop / max : 0;
  const cmScroller = document.querySelector('.cm-scroller');
  if (cmScroller) cmScroller.scrollTo({ top: r * maxScroll(cmScroller) });
  requestAnimationFrame(() => { syncing = false; });
}

function tryBind() {
  if (bound) return;
  const cmScroller = document.querySelector('.cm-scroller');
  if (!cmScroller) return;
  cmScroller.addEventListener('scroll', onEditorScroll, { passive: true });
  bound = true;
}

export function initSyncScroll() {
  previewPane = document.getElementById('preview-pane');
  if (!previewPane) return;
  previewPane.addEventListener('scroll', onPreviewScroll, { passive: true });
  tryBind();
  window.addEventListener('satorilite:file-loaded', tryBind);
}
