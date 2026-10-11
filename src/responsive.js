/* Keep one set of table data and controls at every screen size. */
const mobileNavigation = matchMedia('(max-width: 1024px)');
let menuOpen = false;
let savedOverflow = '';
export const isNavigationOpen = () => menuOpen;

export function closeNavigation(restoreFocus = true) {
  if (!menuOpen) return;
  menuOpen = false;
  document.body.style.overflow = savedOverflow;
  syncNavigation();
  if (restoreFocus) document.querySelector('[data-action="mobile-menu"]')?.focus();
}
export function toggleNavigation() {
  if (menuOpen) return closeNavigation();
  menuOpen = true;
  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  syncNavigation();
  document.querySelector('.sidebar .nav-item.active')?.focus();
}
function syncNavigation() {
  const sidebar = document.querySelector('.sidebar');
  const compact = mobileNavigation.matches;
  if (!sidebar) return;
  sidebar.classList.toggle('open', compact && menuOpen);
  sidebar.inert = compact && !menuOpen;
  document.querySelector('.workspace').inert = compact && menuOpen;
  const backdrop = document.querySelector('.navigation-backdrop');
  if (backdrop) backdrop.hidden = !compact || !menuOpen;
  document.querySelector('[data-action="mobile-menu"]')?.setAttribute('aria-expanded', String(compact && menuOpen));
}
function enhanceTables() {
  for (const table of document.querySelectorAll('#app table, #overlay-root table')) {
    const headers = [...(table.tHead?.rows[0]?.cells || [])];
    if (!headers.length) continue;
    table.parentElement.classList.add('responsive-table-container');
    const cards=table.dataset.tableLayout!=='rows';
    table.classList.toggle('responsive-table',cards);
    table.classList.toggle('responsive-table-wide', cards && headers.length > 5);
    table.classList.toggle('responsive-table-extra-wide', cards && headers.length > 9);
    // Explicit roles preserve table navigation when CSS changes the visual layout.
    table.setAttribute('role', 'table');
    table.tHead.setAttribute('role', 'rowgroup');
    table.tHead.classList.toggle('has-table-controls', Boolean(table.tHead.querySelector('button,input,select')));
    for (const header of headers) {
      header.setAttribute('role', 'columnheader');
      header.setAttribute('scope', 'col');
      header.classList.toggle('has-table-control', Boolean(header.querySelector('button,input,select')));
    }
    for (const row of table.rows) row.setAttribute('role', 'row');
    for (const body of table.tBodies) {
      body.setAttribute('role', 'rowgroup');
      for (const row of body.rows) {
        let column = 0;
        for (const cell of row.cells) {
          const label = headers[column]?.textContent.replace(/[↕↑↓]/g, '').replace(/\s+/g, ' ').trim() || '';
          cell.setAttribute('role', 'cell');
          cell.dataset.columnLabel = cell.colSpan > 1 ? '' : label;
          cell.classList.toggle('responsive-cell-wide', cell.colSpan > 1);
          column += cell.colSpan;
        }
      }
    }
  }
}
let pending = false;
const observer = new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    enhanceTables();
    // A route change replaces the sidebar, so release the old menu's scroll lock.
    if (menuOpen && !document.querySelector('.sidebar.open')) closeNavigation(false);
    syncNavigation();
  });
});
observer.observe(document.querySelector('#app'), {childList: true, subtree: true});
observer.observe(document.querySelector('#overlay-root'), {childList: true, subtree: true});
mobileNavigation.addEventListener('change', () => { closeNavigation(false); syncNavigation(); });
document.addEventListener('click', event => {
  if (event.target.closest('[data-close-navigation]')) closeNavigation();
});
document.addEventListener('keydown', event => {
  if (!menuOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); closeNavigation();
  } else if (event.key === 'Tab') {
    const controls = [...document.querySelectorAll('.sidebar a, .sidebar button')].filter(x => x.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}, true);

// Keep dialog actions inside the visible area when the mobile keyboard opens.
function updateVisibleViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--visible-height', `${viewport?.height || innerHeight}px`);
  document.documentElement.style.setProperty('--visible-top', `${viewport?.offsetTop || 0}px`);
}
window.visualViewport?.addEventListener('resize', updateVisibleViewport);
window.visualViewport?.addEventListener('scroll', updateVisibleViewport);
window.addEventListener('resize', updateVisibleViewport);
updateVisibleViewport();
