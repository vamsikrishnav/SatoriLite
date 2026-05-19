import { marked } from 'marked';

let mermaidLib = null;
let mermaidSeq = 0;

async function loadMermaid() {
  if (mermaidLib) return mermaidLib;
  try {
    const mod = await import('/lib/mermaid.esm.min.js');
    mermaidLib = mod.default || mod;
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

      function renderCellContent(el, text) {
        el.textContent = text;
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

      function activateCell(cellEl, rIdx, cIdx, cursorPos) {
        const info = allCells[rIdx]?.[cIdx];
        if (!info) return;

        table.querySelectorAll('.cm-cell-editing').forEach(el => {
          el.classList.remove('cm-cell-editing');
          el.removeAttribute('contenteditable');
        });

        cellEl.textContent = info.text;
        cellEl.contentEditable = 'true';
        cellEl.classList.add('cm-cell-editing');
        cellEl.focus();

        const tNode = cellEl.firstChild;
        if (tNode && tNode.nodeType === Node.TEXT_NODE) {
          const tLen = (tNode.textContent || '').length;
          const pos = cursorPos !== undefined ? Math.min(cursorPos, tLen) : tLen;
          const r = document.createRange();
          r.setStart(tNode, pos);
          r.collapse(true);
          const s = window.getSelection();
          if (s) { s.removeAllRanges(); s.addRange(r); }
        }

        const commitCell = () => {
          const newText = cellEl.textContent || '';
          cellEl.removeAttribute('contenteditable');
          cellEl.classList.remove('cm-cell-editing');
          cellEl.removeEventListener('blur', commitCell);
          cellEl.removeEventListener('keydown', onCellKey);
          renderCellContent(cellEl, newText || info.text);
          if (newText === info.text) return;
          const lineOffset = self.lineOffsets[rIdx];
          if (lineOffset === undefined) return;
          const from = lineOffset + info.start;
          const to = lineOffset + info.end;
          view.dispatch({ changes: { from, to, insert: ' ' + newText + ' ' } });
        };

        const onCellKey = (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); commitCell(); return; }
          if (ke.key === 'Escape') {
            ke.preventDefault();
            cellEl.removeAttribute('contenteditable');
            cellEl.classList.remove('cm-cell-editing');
            cellEl.removeEventListener('blur', commitCell);
            cellEl.removeEventListener('keydown', onCellKey);
            renderCellContent(cellEl, info.text);
            return;
          }
          if (ke.key === 'Tab' || ke.key === 'ArrowRight' || ke.key === 'ArrowLeft' ||
              ke.key === 'ArrowUp' || ke.key === 'ArrowDown') {
            const sel = window.getSelection();
            const curPos = sel ? sel.anchorOffset : 0;
            const len = (cellEl.textContent || '').length;
            let nextRow = rIdx;
            let nextCol = cIdx;

            if (ke.key === 'Tab') {
              ke.preventDefault(); commitCell();
              nextCol = ke.shiftKey ? cIdx - 1 : cIdx + 1;
            } else if (ke.key === 'ArrowRight' && curPos >= len) {
              ke.preventDefault(); commitCell();
              nextCol = cIdx + 1;
            } else if (ke.key === 'ArrowLeft' && curPos === 0) {
              ke.preventDefault(); commitCell();
              nextCol = cIdx - 1;
            } else if (ke.key === 'ArrowDown') {
              ke.preventDefault(); commitCell();
              nextRow = rIdx + 1;
              if (nextRow === 1) nextRow = 2;
            } else if (ke.key === 'ArrowUp') {
              ke.preventDefault(); commitCell();
              nextRow = rIdx - 1;
              if (nextRow === 1) nextRow = 0;
            } else {
              return;
            }

            const numCols = allCells[0] ? allCells[0].length : 1;
            if (nextCol >= numCols) { nextCol = 0; nextRow++; if (nextRow === 1) nextRow = 2; }
            if (nextCol < 0) { nextCol = numCols - 1; nextRow--; if (nextRow === 1) nextRow = 0; }

            const targetCell = table.querySelector('[data-row="' + nextRow + '"][data-col="' + nextCol + '"]');
            if (targetCell) {
              const cPos = (ke.key === 'ArrowLeft' || ke.key === 'ArrowUp') ? 9999 : 0;
              activateCell(targetCell, nextRow, nextCol, cPos);
            }
          }
        };

        cellEl.addEventListener('blur', commitCell);
        cellEl.addEventListener('keydown', onCellKey);
      }

      table.addEventListener('mousedown', (e) => {
        const target = e.target;
        const cell = target.closest('th, td');
        if (!cell) return;
        e.preventDefault();
        e.stopPropagation();

        const rowIdx = parseInt(cell.dataset.row || '0');
        const colIdx = parseInt(cell.dataset.col || '0');
        const info = allCells[rowIdx] ? allCells[rowIdx][colIdx] : null;
        if (!info) return;

        activateCell(cell, rowIdx, colIdx, 0);

        const clickX = e.clientX;
        const textNode = cell.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const range = document.createRange();
          const text = textNode.textContent || '';
          let bestOffset = text.length;
          for (let c = 0; c <= text.length; c++) {
            range.setStart(textNode, c);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            if (rect.left >= clickX) { bestOffset = c; break; }
          }
          range.setStart(textNode, bestOffset);
          range.collapse(true);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
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

    tablePositions = [];
    for (const t of tableRanges) {
      const startLn = doc.line(t.start);
      const endLn = doc.line(t.end);
      for (let r = t.start; r <= t.end; r++) tableLineSet.add(r);
      tablePositions.push({ from: startLn.from, to: endLn.to });

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

  let tablePositions = [];

  return StateField.define({
    create(state) {
      return buildDecorations(state);
    },
    update(decos, tr) {
      if (tr.docChanged) {
        return buildDecorations(tr.state);
      }
      if (tr.selection) {
        const cursor = tr.state.selection.main.head;
        // Don't rebuild if cursor is inside a table (let widget handle it)
        for (const t of tablePositions) {
          if (cursor >= t.from && cursor <= t.to) return decos;
        }
        return buildDecorations(tr.state);
      }
      return decos;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}
