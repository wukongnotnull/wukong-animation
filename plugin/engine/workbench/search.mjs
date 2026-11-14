// Highlight ranges preserve the document's text nodes and source coordinates for notes.
const RESULTS = 'document-search-results';
const CURRENT = 'document-search-current';

/** @param {string} text @param {string} query @returns {{start: number, end: number}[]} */
export function findTextMatches(text, query) {
  if (!query.trim()) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(text.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length }));
}

/** @param {number} index @param {number} count @param {number} direction @returns {number} */
export function nextMatchIndex(index, count, direction) {
  return count ? (index + direction + count) % count : -1;
}

/** @param {HTMLElement} root @param {string} query @returns {Range[]} */
export function documentSearchRanges(root, query) {
  if (!query.trim()) return [];
  const groups = new Map();
  for (const span of root.querySelectorAll('[data-source]')) {
    if (!span.firstChild || !span.getClientRects().length) continue;
    const parent = span.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(span.firstChild);
  }
  return [...groups.values()].flatMap(nodes => {
    let offset = 0;
    const pieces = nodes.map(node => {
      const start = offset; offset += node.textContent.length;
      return { node, start, end: offset };
    });
    let startIndex = 0, endIndex = 0;
    return findTextMatches(nodes.map(node => node.textContent).join(''), query).map(match => {
      while (pieces[startIndex].end <= match.start) startIndex++;
      endIndex = Math.max(startIndex, endIndex);
      while (pieces[endIndex].end < match.end) endIndex++;
      const first = pieces[startIndex], last = pieces[endIndex];
      const range = root.ownerDocument.createRange();
      range.setStart(first.node, match.start - first.start);
      range.setEnd(last.node, match.end - last.start);
      return range;
    });
  });
}

function revealMatch(root, range) {
  const parent = range.startContainer.parentElement;
  const table = parent.closest('.table-wrap');
  if (table) {
    const box = table.getBoundingClientRect(), rect = range.getBoundingClientRect();
    table.scrollLeft += rect.left - box.left - box.width / 2 + rect.width / 2;
  }
  const box = root.getBoundingClientRect(), rect = range.getBoundingClientRect();
  root.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
  root.scrollLeft += rect.left - box.left - box.width / 2 + rect.width / 2;
}

/** @param {HTMLElement} controls @returns {{bind: (root: HTMLElement|null, key: string) => void}} */
export function createDocumentSearch(controls) {
  const input = controls.querySelector('input');
  const status = controls.querySelector('[role=status]');
  const previous = controls.querySelector('[data-search=previous]');
  const next = controls.querySelector('[data-search=next]');
  const clear = controls.querySelector('[data-search=clear]');
  const registry = globalThis.CSS?.highlights;
  const canHighlight = !!registry && typeof globalThis.Highlight === 'function';
  let root = null, key = null, ranges = [], index = -1, fallback = null, restoreFocus = false;

  function clearHighlights() {
    registry?.delete(RESULTS); registry?.delete(CURRENT);
    fallback?.classList.remove('search-current-fallback'); fallback = null;
  }
  function show(scroll = false) {
    status.textContent = !input.value.trim() ? '' : ranges.length ? `${index + 1} / ${ranges.length}` : '无匹配';
    previous.disabled = next.disabled = !ranges.length;
    clear.disabled = !input.value;
    registry?.delete(CURRENT);
    fallback?.classList.remove('search-current-fallback'); fallback = null;
    if (index < 0) return;
    if (canHighlight) {
      const active = new Highlight(ranges[index]); active.priority = 1;
      registry.set(CURRENT, active);
    } else {
      fallback = ranges[index].startContainer.parentElement;
      fallback.classList.add('search-current-fallback');
    }
    if (scroll) revealMatch(root, ranges[index]);
  }
  function search(scroll = true) {
    clearHighlights();
    ranges = root ? documentSearchRanges(root, input.value) : [];
    index = ranges.length ? 0 : -1;
    if (canHighlight && ranges.length) {
      const highlight = new Highlight();
      for (const range of ranges) highlight.add(range);
      registry.set(RESULTS, highlight);
    }
    show(scroll);
  }
  function move(direction) { index = nextMatchIndex(index, ranges.length, direction); show(true); }
  input.addEventListener('input', event => { if (!event.isComposing) search(); });
  input.addEventListener('compositionend', () => search());
  controls.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && event.target === input) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = ''; search(false); input.focus(); }
  });
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  clear.addEventListener('click', () => { input.value = ''; search(false); input.focus(); });
  // app.css hides table headers at this breakpoint; only count visible text.
  globalThis.matchMedia('(max-width:600px)').addEventListener('change', () => search(false));
  return { bind(documentRoot, documentKey) {
    if (key !== documentKey) { input.value = ''; restoreFocus = false; }
    else if (!documentRoot && controls.ownerDocument.activeElement === input) restoreFocus = true;
    root = documentRoot; key = documentKey; controls.hidden = !root;
    search(false);
    if (root && restoreFocus) {
      if (controls.ownerDocument.activeElement === controls.ownerDocument.body) input.focus({ preventScroll: true });
      restoreFocus = false;
    }
  } };
}
