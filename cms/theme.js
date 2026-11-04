// Day / night switch. Night is the brand default; the choice is remembered.
const KEY = 'mm.theme';
const sun = '<svg class="theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const moon = '<svg class="theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.theme = 'light'; else root.dataset.theme = 'dark';
  try { localStorage.setItem(KEY, theme); } catch { /* Private mode: the switch still works for this page. */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#F5F4F7' : '#1F1E22';
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-pressed', String(theme === 'light'));
    button.setAttribute('aria-label', theme === 'light' ? 'Switch to night mode' : 'Switch to day mode');
    button.title = theme === 'light' ? 'Night mode' : 'Day mode';
  });
}

export function themeToggle() {
  const util = document.querySelector('.nav__util');
  if (!util || util.querySelector('[data-theme-toggle]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav__icon theme-toggle';
  button.dataset.themeToggle = '';
  button.innerHTML = sun + moon;
  button.addEventListener('click', () => setTheme(currentTheme() === 'light' ? 'dark' : 'light'));
  util.prepend(button);
  setTheme(currentTheme());
}

themeToggle();
