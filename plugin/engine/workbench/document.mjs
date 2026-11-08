// A deliberately small, non-executing Markdown reader with original-source coordinates.
function parts(text, start) {
  const out = []; let at = 0;
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) out.push({ text: text.slice(at, match.index), start: start + at });
    const bold = match[1] !== undefined, offset = bold ? 2 : 1;
    out.push({ text: match[1] ?? match[2], start: start + match.index + offset, style: bold ? 'strong' : 'code' }); at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), start: start + at });
  return out;
}
function cells(line) {
  const separators = []; for (let i = 0; i < line.text.length; i++) if (line.text[i] === '|') { let j = i - 1; while (j >= 0 && line.text[j] === '\\') j--; if ((i - j - 1) % 2 === 0) separators.push(i); }
  const ranges = [-1, ...separators, line.text.length], out = [];
  for (let i = 0; i < ranges.length - 1; i++) {
    const start = ranges[i] + 1, text = line.text.slice(start, ranges[i + 1]);
    if ((i === 0 || i === ranges.length - 2) && !text.trim()) continue;
    const trim = text.length - text.trimStart().length;
    out.push({ text: text.trim(), parts: parts(text.trim(), line.start + start + trim) });
  }
  return out;
}
export function parseDocument(raw) {
  const lines = []; let offset = 0;
  for (const full of raw.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || []) { if (!full) continue; lines.push({ text: full.replace(/[\r\n]+$/, ''), start: offset, full }); offset += full.length; }
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (!line.text.trim()) continue;
    if (/^\s*```/.test(line.text)) {
      const content = []; while (++i < lines.length && !/^\s*```/.test(lines[i].text)) content.push({ text: lines[i].full, start: lines[i].start });
      blocks.push({ type: 'code', parts: content }); continue;
    }
    if (line.text.includes('|') && lines[i + 1] && cells(lines[i + 1]).length > 1 && cells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c.text))) {
      const header = { cells: cells(line) }, rows = []; i++;
      while (lines[i + 1]?.text.includes('|') && lines[i + 1].text.trim()) {
        const row = { cells: cells(lines[++i]) }; row.shotId = row.cells.find(c => /^s\d+[\w-]*$/i.test(c.text))?.text || null; rows.push(row);
      }
      blocks.push({ type: 'table', header, rows }); continue;
    }
    const heading = /^(#{1,6})\s+/.exec(line.text), list = /^\s*(?:[-*+] |\d+\. )/.exec(line.text), quote = /^>\s?/.exec(line.text);
    const prefix = heading?.[0] || list?.[0] || quote?.[0] || '';
    blocks.push({ type: heading ? 'heading' : list ? 'list' : quote ? 'quote' : 'paragraph', level: heading?.[1].length, parts: parts(line.text.slice(prefix.length), line.start + prefix.length) });
  }
  return blocks;
}
export function renderDocument(raw, formatted = true) {
  const root = document.createElement(formatted ? 'article' : 'pre'); root.className = 'document ' + (formatted ? 'formatted' : 'raw'); root.id = 'document'; root.tabIndex = 0; root.setAttribute('aria-label', '只读文档');
  const append = (parent, values) => { for (const part of values) { const span = document.createElement(part.style || 'span'); span.dataset.source = part.start; span.textContent = part.text; parent.append(span); } };
  if (!formatted) { append(root, [{ text: raw, start: 0 }]); return root; }
  for (const block of parseDocument(raw)) {
    if (block.type === 'table') {
      const wrap = document.createElement('div'); wrap.className = 'table-wrap';
      const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody');
      for (const [index, row] of [block.header, ...block.rows].entries()) {
        const tr = document.createElement('tr'); if (row.shotId) { tr.dataset.shot = row.shotId; tr.tabIndex = -1; }
        row.cells.forEach((cell, column) => { const td = document.createElement(index ? 'td' : 'th'); if (!index) td.scope = 'col'; else td.dataset.label = block.header.cells[column]?.text || ''; append(td, cell.parts); tr.append(td); });
        (index ? body : head).append(tr);
      }
      table.append(head, body); wrap.append(table); root.append(wrap);
    } else {
      const node = document.createElement(block.type === 'heading' ? 'h' + block.level : block.type === 'code' ? 'pre' : block.type === 'quote' ? 'blockquote' : 'p');
      if (block.type === 'list') node.className = 'list-line'; append(node, block.parts); root.append(node);
    }
  }
  return root;
}
export function documentAnchor(root, selection, raw) {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const spans = [...root.querySelectorAll('[data-source]')].filter(s => s.firstChild && range.intersectsNode(s.firstChild));
  if (!spans.length) return null;
  const first = spans[0], last = spans.at(-1);
  const start = Number(first.dataset.source) + (range.startContainer === first.firstChild ? range.startOffset : 0);
  const end = Number(last.dataset.source) + (range.endContainer === last.firstChild ? range.endOffset : last.textContent.length);
  return end > start && end - start <= 10000 ? { type: 'text', start, end, quote: raw.slice(start, end) } : null;
}
export function revealDocumentAnchor(root, anchor) {
  const spans = [...root.querySelectorAll('[data-source]')], start = spans.find(s => Number(s.dataset.source) + s.textContent.length > anchor.start), end = [...spans].reverse().find(s => Number(s.dataset.source) < anchor.end);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start.firstChild, Math.max(0, anchor.start - Number(start.dataset.source)));
  range.setEnd(end.firstChild, Math.min(end.textContent.length, anchor.end - Number(end.dataset.source)));
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const rect = range.getBoundingClientRect(); root.scrollTop += rect.top - root.getBoundingClientRect().top - 70;
}
