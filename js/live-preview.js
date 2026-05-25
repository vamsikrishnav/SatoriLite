import { marked } from 'marked';
import { getCurrentFilePath } from './editor.js';

let mermaidLib = null;
let mermaidSeq = 0;

async function loadMermaid() {
  if (mermaidLib) return mermaidLib;
  if (globalThis.mermaid) {
    mermaidLib = globalThis.mermaid;
    mermaidLib.initialize({ startOnLoad: false, theme: 'dark' });
    return mermaidLib;
  }
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/lib/mermaid.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    mermaidLib = globalThis.mermaid;
    if (!mermaidLib) return null;
    mermaidLib.initialize({ startOnLoad: false, theme: 'dark' });
    return mermaidLib;
  } catch {
    return null;
  }
}

export function createLivePreview(StateField, Decoration, WidgetType, EditorView) {

  class BulletWidget extends WidgetType {
    constructor(indent) {
      super();
      this.indent = indent;
    }
    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-bullet';
      span.style.paddingLeft = (this.indent * 8) + 'px';
      span.textContent = '•';
      return span;
    }
  }

  class CheckboxWidget extends WidgetType {
    constructor(checked, togglePos) {
      super();
      this.checked = checked;
      this.togglePos = togglePos;
    }
    toDOM(view) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.checked;
      cb.className = 'cm-checkbox';
      cb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const newChar = this.checked ? ' ' : 'x';
        view.dispatch({ changes: { from: this.togglePos, to: this.togglePos + 1, insert: newChar } });
      });
      return cb;
    }
  }

  class TableWidget extends WidgetType {
    constructor(rawLines, lineOffsets) {
      super();
      this.rawLines = rawLines;
      this.lineOffsets = lineOffsets;
    }

    parseCells(line) {
      const cells = [];
      let pos = line.startsWith('|') ? 1 : 0;
      const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
      const parts = trimmed.split('|');
      for (const part of parts) {
        const start = pos;
        const end = pos + part.length;
        cells.push({ text: part.trim(), start, end });
        pos = end + 1;
      }
      return cells;
    }

    toDOM(view) {
      const table = document.createElement('table');
      table.className = 'cm-table';

      const allCells = this.rawLines.map(line => this.parseCells(line));

      const inlineTokenRe = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(~~([^~]+)~~)/g;

      function tokenize(text) {
        const tokens = [];
        let lastIdx = 0;
        let m;
        inlineTokenRe.lastIndex = 0;
        while ((m = inlineTokenRe.exec(text)) !== null) {
          if (m.index > lastIdx) {
            tokens.push({ type: 'text', raw: text.slice(lastIdx, m.index), display: text.slice(lastIdx, m.index), start: lastIdx, end: m.index });
          }
          if (m[1]) {
            tokens.push({ type: 'link', raw: m[1], display: m[2], href: m[3], start: m.index, end: m.index + m[1].length });
          } else if (m[4]) {
            tokens.push({ type: 'bold', raw: m[4], display: m[5], start: m.index, end: m.index + m[4].length });
          } else if (m[6]) {
            tokens.push({ type: 'italic', raw: m[6], display: m[7], start: m.index, end: m.index + m[6].length });
          } else if (m[8]) {
            tokens.push({ type: 'code', raw: m[8], display: m[9], start: m.index, end: m.index + m[8].length });
          } else if (m[10]) {
            tokens.push({ type: 'strike', raw: m[10], display: m[11], start: m.index, end: m.index + m[10].length });
          }
          lastIdx = m.index + m[0].length;
        }
        if (lastIdx < text.length) {
          tokens.push({ type: 'text', raw: text.slice(lastIdx), display: text.slice(lastIdx), start: lastIdx, end: text.length });
        }
        return tokens;
      }

      function renderCellContent(el, text) {
        el.innerHTML = '';
        const tokens = tokenize(text || '');
        for (const tok of tokens) {
          if (tok.type === 'text') {
            el.appendChild(document.createTextNode(tok.display));
          } else if (tok.type === 'link') {
            const a = document.createElement('a');
            a.href = tok.href;
            a.textContent = tok.display;
            a.dataset.start = tok.start;
            a.dataset.end = tok.end;
            a.dataset.raw = tok.raw;
            el.appendChild(a);
          } else if (tok.type === 'bold') {
            const b = document.createElement('strong');
            b.textContent = tok.display;
            b.dataset.start = tok.start;
            b.dataset.end = tok.end;
            b.dataset.raw = tok.raw;
            el.appendChild(b);
          } else if (tok.type === 'italic') {
            const i = document.createElement('em');
            i.textContent = tok.display;
            i.dataset.start = tok.start;
            i.dataset.end = tok.end;
            i.dataset.raw = tok.raw;
            el.appendChild(i);
          } else if (tok.type === 'code') {
            const c = document.createElement('code');
            c.textContent = tok.display;
            c.dataset.start = tok.start;
            c.dataset.end = tok.end;
            c.dataset.raw = tok.raw;
            el.appendChild(c);
          } else if (tok.type === 'strike') {
            const s = document.createElement('s');
            s.textContent = tok.display;
            s.dataset.start = tok.start;
            s.dataset.end = tok.end;
            s.dataset.raw = tok.raw;
            el.appendChild(s);
          }
        }
      }

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      if (allCells.length > 0) {
        allCells[0].forEach((cell, colIdx) => {
          const th = document.createElement('th');
          renderCellContent(th, cell.text);
          th.dataset.row = '0';
          th.dataset.col = String(colIdx);
          headerRow.appendChild(th);
        });
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (let r = 2; r < allCells.length; r++) {
        const tr = document.createElement('tr');
        allCells[r].forEach((cell, colIdx) => {
          const td = document.createElement('td');
          renderCellContent(td, cell.text);
          td.dataset.row = String(r);
          td.dataset.col = String(colIdx);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);

      const self = this;
      let activeCell = null;

      function deactivateCell(cellEl) {
        if (!cellEl || cellEl !== activeCell) return;
        const newText = cellEl.textContent || '';
        const rowIdx = parseInt(cellEl.dataset.row || '0');
        const colIdx = parseInt(cellEl.dataset.col || '0');
        const info = allCells[rowIdx] ? allCells[rowIdx][colIdx] : null;
        cellEl.removeAttribute('contenteditable');
        cellEl.classList.remove('cm-cell-editing');
        if (info) renderCellContent(cellEl, info.text);
        activeCell = null;
        if (!info || newText === info.text) return;
        const lineOffset = self.lineOffsets[rowIdx];
        if (lineOffset === undefined) return;
        const from = lineOffset + info.start;
        const to = lineOffset + info.end;
        view.dispatch({ changes: { from, to, insert: ' ' + newText + ' ' } });
      }

      function activateCell(cellEl, clickX) {
        if (cellEl === activeCell) return;
        if (activeCell) deactivateCell(activeCell);
        const rowIdx = parseInt(cellEl.dataset.row || '0');
        const colIdx = parseInt(cellEl.dataset.col || '0');
        const info = allCells[rowIdx] ? allCells[rowIdx][colIdx] : null;
        if (!info) return;

        cellEl.textContent = info.text;
        cellEl.contentEditable = 'true';
        cellEl.classList.add('cm-cell-editing');
        activeCell = cellEl;
        cellEl.focus();

        const tNode = cellEl.firstChild;
        if (tNode && tNode.nodeType === Node.TEXT_NODE && clickX !== undefined) {
          const range = document.createRange();
          const text = tNode.textContent || '';
          let bestOffset = text.length;
          for (let c = 0; c <= text.length; c++) {
            range.setStart(tNode, c);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            if (rect.left >= clickX) { bestOffset = c; break; }
          }
          range.setStart(tNode, bestOffset);
          range.collapse(true);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        }

        const onBlur = () => {
          cellEl.removeEventListener('blur', onBlur);
          cellEl.removeEventListener('keydown', onKey);
          deactivateCell(cellEl);
        };

        const onKey = (ke) => {
          if (ke.key === 'Escape') {
            ke.preventDefault();
            const info2 = allCells[rowIdx] ? allCells[rowIdx][colIdx] : null;
            cellEl.removeAttribute('contenteditable');
            cellEl.classList.remove('cm-cell-editing');
            cellEl.removeEventListener('blur', onBlur);
            cellEl.removeEventListener('keydown', onKey);
            if (info2) renderCellContent(cellEl, info2.text);
            activeCell = null;
            return;
          }
          if (ke.key === 'Enter') {
            ke.preventDefault();
            cellEl.removeEventListener('blur', onBlur);
            cellEl.removeEventListener('keydown', onKey);
            deactivateCell(cellEl);
            return;
          }
          if (ke.key === 'Tab' || ke.key === 'ArrowRight' || ke.key === 'ArrowLeft' ||
              ke.key === 'ArrowUp' || ke.key === 'ArrowDown') {
            const sel = window.getSelection();
            const curPos = sel ? sel.anchorOffset : 0;
            const len = (cellEl.textContent || '').length;
            let nextRow = rowIdx, nextCol = colIdx;

            if (ke.key === 'Tab') {
              ke.preventDefault();
              cellEl.removeEventListener('blur', onBlur);
              cellEl.removeEventListener('keydown', onKey);
              deactivateCell(cellEl);
              nextCol = ke.shiftKey ? colIdx - 1 : colIdx + 1;
            } else if (ke.key === 'ArrowRight' && curPos >= len) {
              ke.preventDefault();
              cellEl.removeEventListener('blur', onBlur);
              cellEl.removeEventListener('keydown', onKey);
              deactivateCell(cellEl);
              nextCol = colIdx + 1;
            } else if (ke.key === 'ArrowLeft' && curPos === 0) {
              ke.preventDefault();
              cellEl.removeEventListener('blur', onBlur);
              cellEl.removeEventListener('keydown', onKey);
              deactivateCell(cellEl);
              nextCol = colIdx - 1;
            } else if (ke.key === 'ArrowDown') {
              ke.preventDefault();
              cellEl.removeEventListener('blur', onBlur);
              cellEl.removeEventListener('keydown', onKey);
              deactivateCell(cellEl);
              nextRow = rowIdx + 1;
              if (nextRow === 1) nextRow = 2;
            } else if (ke.key === 'ArrowUp') {
              ke.preventDefault();
              cellEl.removeEventListener('blur', onBlur);
              cellEl.removeEventListener('keydown', onKey);
              deactivateCell(cellEl);
              nextRow = rowIdx - 1;
              if (nextRow === 1) nextRow = 0;
            } else {
              return;
            }

            const numCols = allCells[0] ? allCells[0].length : 1;
            if (nextCol >= numCols) { nextCol = 0; nextRow++; if (nextRow === 1) nextRow = 2; }
            if (nextCol < 0) { nextCol = numCols - 1; nextRow--; if (nextRow === 1) nextRow = 0; }

            const target = table.querySelector('[data-row="' + nextRow + '"][data-col="' + nextCol + '"]');
            if (target) activateCell(target, undefined);
          }
        };

        cellEl.addEventListener('blur', onBlur);
        cellEl.addEventListener('keydown', onKey);
      }

      table.addEventListener('mousedown', (e) => {
        const target = e.target;

        const link = target.closest('a');
        if (link) {
          e.preventDefault();
          e.stopPropagation();
          let href = link.getAttribute('href') || '';
          if (href.startsWith('http://') || href.startsWith('https://')) {
            window.open(href, '_blank', 'noopener');
          } else {
            if (!href.endsWith('.md')) href += '.md';
            const current = getCurrentFilePath();
            if (current && !href.startsWith('/')) {
              const dir = current.substring(0, current.lastIndexOf('/'));
              if (dir) href = dir + '/' + href;
            }
            try { href = decodeURIComponent(href); } catch {}
            const parts = href.split('/');
            const resolved = [];
            for (const p of parts) {
              if (p === '..') resolved.pop();
              else if (p && p !== '.') resolved.push(p);
            }
            href = resolved.join('/');
            window.dispatchEvent(new CustomEvent('satorilite:file-open', {
              detail: { path: href }
            }));
          }
          return;
        }

        const cell = target.closest('th, td');
        if (cell) {
          e.preventDefault();
          e.stopPropagation();
          activateCell(cell, e.clientX);
        }
      });

      return table;
    }

    eq(other) {
      return this.rawLines.join('\n') === other.rawLines.join('\n');
    }
  }

  class ImageWidget extends WidgetType {
    constructor(src, alt) {
      super();
      this.src = src;
      this.alt = alt;
    }
    eq(other) {
      return this.src === other.src;
    }
    toDOM() {
      const img = document.createElement('img');
      img.src = this.src;
      img.alt = this.alt;
      img.className = 'cm-image';
      return img;
    }
  }

  class MermaidWidget extends WidgetType {
    constructor(code) {
      super();
      this.code = code;
    }
    eq(other) {
      return this.code === other.code;
    }
    toDOM() {
      const container = document.createElement('div');
      container.className = 'cm-mermaid';
      loadMermaid().then(m => {
        if (!m) { container.textContent = 'Mermaid unavailable'; return; }
        const id = 'cm-mermaid-' + (++mermaidSeq);
        m.render(id, this.code).then(function(result) {
          const tmpl = document.createElement('template');
          tmpl.innerHTML = result.svg;
          container.appendChild(tmpl.content);
        }).catch(function() {
          container.textContent = 'Mermaid render error';
          container.classList.add('mermaid-error');
        });
      });
      return container;
    }
  }

  class CodeLangWidget extends WidgetType {
    constructor(lang) {
      super();
      this.lang = lang;
    }
    eq(other) { return this.lang === other.lang; }
    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-code-lang-tag';
      span.textContent = this.lang;
      return span;
    }
  }

  function cursorInRange(cursor, from, to) {
    return cursor >= from && cursor <= to;
  }

  function buildDecorations(state) {
    const ranges = [];
    const cursor = state.selection.main.head;
    const doc = state.doc;

    const tableRanges = [];
    const tableLineSet = new Set();
    let tableStart = -1;
    for (let i = 1; i <= doc.lines; i++) {
      const text = doc.line(i).text;
      if (text.trimStart().startsWith('|')) {
        if (tableStart === -1) tableStart = i;
      } else {
        if (tableStart !== -1) {
          if (i - 1 - tableStart + 1 >= 2) tableRanges.push({ start: tableStart, end: i - 1 });
          tableStart = -1;
        }
      }
    }
    if (tableStart !== -1 && doc.lines - tableStart + 1 >= 2) {
      tableRanges.push({ start: tableStart, end: doc.lines });
    }

    for (const t of tableRanges) {
      const startLn = doc.line(t.start);
      const endLn = doc.line(t.end);
      for (let r = t.start; r <= t.end; r++) tableLineSet.add(r);

      const rawLines = [];
      const lineOffsets = [];
      for (let r = t.start; r <= t.end; r++) {
        const ln = doc.line(r);
        rawLines.push(ln.text);
        lineOffsets.push(ln.from);
      }
      ranges.push(Decoration.replace({
        widget: new TableWidget(rawLines, lineOffsets),
        block: true,
      }).range(startLn.from, endLn.to));
    }

    const mermaidLineSet = new Set();
    for (let i = 1; i <= doc.lines; i++) {
      const text = doc.line(i).text;
      if (/^```mermaid\s*$/.test(text)) {
        const startLine = i;
        let endLine = -1;
        for (let j = i + 1; j <= doc.lines; j++) {
          if (/^```\s*$/.test(doc.line(j).text)) { endLine = j; break; }
        }
        if (endLine === -1) continue;

        const startLn = doc.line(startLine);
        const endLn = doc.line(endLine);

        if (!cursorInRange(cursor, startLn.from, endLn.to)) {
          const codeLines = [];
          for (let j = startLine + 1; j < endLine; j++) {
            codeLines.push(doc.line(j).text);
          }
          ranges.push(Decoration.replace({
            widget: new MermaidWidget(codeLines.join('\n')),
            block: true,
          }).range(startLn.from, endLn.to));
        }

        for (let j = startLine; j <= endLine; j++) mermaidLineSet.add(j);
        i = endLine;
      }
    }

    for (let i = 1; i <= doc.lines; i++) {
      if (mermaidLineSet.has(i)) continue;
      const text = doc.line(i).text;
      const langMatch = text.match(/^```(\w+)\s*$/);
      if (langMatch) {
        const ln = doc.line(i);
        ranges.push(Decoration.widget({
          widget: new CodeLangWidget(langMatch[1]),
          side: 1,
        }).range(ln.to));
      }
    }

    for (let i = 1; i <= doc.lines; i++) {
      if (tableLineSet.has(i) || mermaidLineSet.has(i)) continue;
      const ln = doc.line(i);
      const text = ln.text;

      const headerMatch = text.match(/^(#{1,6})\s/);
      if (headerMatch) {
        if (!cursorInRange(cursor, ln.from, ln.to)) {
          ranges.push(Decoration.replace({}).range(ln.from, ln.from + headerMatch[1].length + 1));
        }
      }

      const bqMatch = text.match(/^>\s?/);
      if (bqMatch) {
        const markEnd = ln.from + bqMatch[0].length;
        if (!cursorInRange(cursor, ln.from, markEnd)) {
          ranges.push(Decoration.replace({}).range(ln.from, markEnd));
          ranges.push(Decoration.line({ class: 'cm-blockquote-line' }).range(ln.from));
        }
      }

      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(text)) {
        if (!cursorInRange(cursor, ln.from, ln.to)) {
          ranges.push(Decoration.line({ class: 'cm-hr-line' }).range(ln.from));
        }
      }

      const bulletMatch = text.match(/^(\s*)([-*])\s/);
      if (bulletMatch && !text.match(/^(\s*[-*]\s)\[[ xX]\]/)) {
        const markEnd = ln.from + bulletMatch[0].length;
        if (!cursorInRange(cursor, ln.from, markEnd)) {
          const indent = Math.floor(bulletMatch[1].length / 2);
          ranges.push(Decoration.replace({
            widget: new BulletWidget(indent),
          }).range(ln.from, markEnd));
        }
      }

      const checkMatch = text.match(/^(\s*- \[)([ xX])(\])\s/);
      if (checkMatch) {
        const checkEnd = ln.from + checkMatch[1].length + 1 + checkMatch[3].length + 1;
        if (!cursorInRange(cursor, ln.from, checkEnd)) {
          const checked = checkMatch[2] !== ' ';
          ranges.push(Decoration.replace({
            widget: new CheckboxWidget(checked, ln.from + checkMatch[1].length),
          }).range(ln.from, checkEnd));
        }
      }

      const boldRe = /\*\*(.+?)\*\*|__(.+?)__/g;
      let b;
      boldRe.lastIndex = 0;
      while ((b = boldRe.exec(text)) !== null) {
        const start = ln.from + b.index;
        const end = start + b[0].length;
        if (!cursorInRange(cursor, start, end)) {
          ranges.push(Decoration.replace({}).range(start, start + 2));
          ranges.push(Decoration.replace({}).range(end - 2, end));
        }
      }

      const italicRe = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
      let it;
      italicRe.lastIndex = 0;
      while ((it = italicRe.exec(text)) !== null) {
        const start = ln.from + it.index;
        const end = start + it[0].length;
        if (!cursorInRange(cursor, start, end)) {
          ranges.push(Decoration.replace({}).range(start, start + 1));
          ranges.push(Decoration.replace({}).range(end - 1, end));
        }
      }

      const codeRe = /`([^`]+)`/g;
      let cd;
      codeRe.lastIndex = 0;
      while ((cd = codeRe.exec(text)) !== null) {
        const start = ln.from + cd.index;
        const end = start + cd[0].length;
        if (!cursorInRange(cursor, start, end)) {
          ranges.push(Decoration.replace({}).range(start, start + 1));
          ranges.push(Decoration.replace({}).range(end - 1, end));
        }
      }

      const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const imgPositions = new Set();
      let im;
      imgRe.lastIndex = 0;
      while ((im = imgRe.exec(text)) !== null) {
        const start = ln.from + im.index;
        const end = start + im[0].length;
        if (!cursorInRange(cursor, ln.from, ln.to)) {
          const src = im[2];
          if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
            const isFullLine = im[0].length === text.length;
            ranges.push(Decoration.replace({
              widget: new ImageWidget(src, im[1]),
              block: isFullLine,
            }).range(isFullLine ? ln.from : start, isFullLine ? ln.to : end));
          }
        }
        for (let ci = im.index; ci < im.index + im[0].length; ci++) imgPositions.add(ci);
      }

      const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
      let lk;
      linkRe.lastIndex = 0;
      while ((lk = linkRe.exec(text)) !== null) {
        if (imgPositions.has(lk.index) || (lk.index > 0 && text[lk.index - 1] === '!')) continue;
        const matchStart = ln.from + lk.index;
        const matchEnd = matchStart + lk[0].length;
        const textStart = matchStart + 1;
        const textEnd = textStart + lk[1].length;

        if (cursorInRange(cursor, matchStart, matchEnd)) continue;

        ranges.push(Decoration.replace({}).range(matchStart, textStart));
        ranges.push(Decoration.mark({
          class: 'cm-link-text',
          attributes: { 'data-href': lk[2] },
        }).range(textStart, textEnd));
        ranges.push(Decoration.replace({}).range(textEnd, matchEnd));
      }

      const strikeRe = /~~(.+?)~~/g;
      let st;
      strikeRe.lastIndex = 0;
      while ((st = strikeRe.exec(text)) !== null) {
        const start = ln.from + st.index;
        const end = start + st[0].length;
        if (!cursorInRange(cursor, start, end)) {
          ranges.push(Decoration.replace({}).range(start, start + 2));
          ranges.push(Decoration.replace({}).range(end - 2, end));
        }
      }
    }

    ranges.sort((a, b) => a.from - b.from || a.startSide - b.startSide);
    return Decoration.set(ranges, true);
  }

  return StateField.define({
    create(state) {
      return buildDecorations(state);
    },
    update(decos, tr) {
      if (tr.docChanged || tr.selection) {
        return buildDecorations(tr.state);
      }
      return decos;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}
