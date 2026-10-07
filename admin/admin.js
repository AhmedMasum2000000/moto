/* Moto Market Studio — the site's back office.

   The site is static and lives in a GitHub repository, so the studio has no
   server of its own: it reads and writes the repository through the GitHub
   API and every save is a commit. GitHub Pages then republishes the site.

   Accounts live in data/users.json. Each account holds the repository token
   encrypted with that account's password (PBKDF2-SHA256 → AES-GCM), so the
   password is what unlocks publishing and nothing secret is stored in clear.

   Two roles:
   - Administrator: everything — content plus accounts, roles and passwords.
   - Content Editor: images, products, pages and journal posts. No accounts.
   Everyone can change their own password. */
(() => {
  'use strict';

  const REPO = { owner: 'AhmedMasum2000000', name: 'moto', source: 'main', publish: ['main', 'gh-pages'] };
  const API = `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;
  const SITE = 'https://ahmedmasum2000000.github.io/moto/';
  const SITE_BASE = new URL('../', location.href).href;   // where the live pages sit, for previews
  const USERS = 'data/users.json', PAGES = 'data/pages.json', POSTS = 'data/posts.json';
  const CORE = { 'index.html': 'Home', 'shop.html': 'Shop', 'book.html': 'Book a slot', 'blog.html': 'Journal (built from posts)' };
  const ITER = 600000;
  const MIN_PW = 10;

  const ROLES = {
    admin:  { title: 'Administrator', can: ['images', 'products', 'pages', 'posts', 'team', 'account'] },
    editor: { title: 'Content Editor',       can: ['images', 'products', 'pages', 'posts', 'account'] },
  };
  const SECTIONS = {
    team:     { label: 'Team & Access', group: 'Administration', icon: '<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3.5"/><path d="M22 19v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
    images:   { label: 'Images',   group: 'Content', icon: '<rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/>' },
    products: { label: 'Products', group: 'Content', icon: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>' },
    pages:    { label: 'Pages',    group: 'Content', icon: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>' },
    posts:    { label: 'Posts',    group: 'Content', icon: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
    account:  { label: 'My password', group: 'Account', icon: '<rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' },
  };

  /* -- small helpers ------------------------------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = s => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const taka = n => '৳' + Number(n).toLocaleString('en-IN');
  const stamp = () => Date.now().toString(36);

  let toastT;
  function toast(msg, error) {
    const t = $('[data-toast]');
    t.textContent = msg;
    t.classList.toggle('is-error', !!error);
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, error ? 7000 : 3500);
  }
  function busy(msg) {
    $('[data-busy-msg]').textContent = msg || 'Working…';
    $('[data-busy]').hidden = !msg;
  }
  async function task(msg, fn) {
    busy(msg);
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || String(e), true); return undefined; }
    finally { busy(null); }
  }

  /* -- crypto: the token is sealed with the account password -------------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = bytes => { let s = ''; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function keyFrom(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(secret, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pw, salt, ITER), enc.encode(secret));
    return { kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(v, pw) {
    const key = await keyFrom(pw, unb64(v.salt), v.iter || ITER);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct)));
  }

  /* -- GitHub ------------------------------------------------------------- */
  let TOKEN = null;
  const encPath = p => p.split('/').map(encodeURIComponent).join('/');
  function headers(accept, auth = true) {
    const h = { Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (auth && TOKEN) h.Authorization = `Bearer ${TOKEN}`;
    return h;
  }
  async function gh(path, { method = 'GET', body, token } = {}) {
    const h = headers();
    if (token) h.Authorization = `Bearer ${token}`;
    if (body) h['Content-Type'] = 'application/json';
    const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!r.ok) {
      let m = '';
      try { m = (await r.json()).message; } catch {}
      const e = new Error(r.status === 401 ? 'GitHub rejected the token (expired or revoked). Ask the administrator to set a new one.'
        : r.status === 403 || (r.status === 404 && method !== 'GET') ? `GitHub refused the change: ${m || r.status}. The token needs Contents: Read and write on ${REPO.owner}/${REPO.name}.`
        : `GitHub ${r.status}: ${m || r.statusText}`);
      e.status = r.status;
      throw e;
    }
    return r.status === 204 ? null : r.json();
  }
  async function readText(path, auth = true) {
    const r = await fetch(`${API}/contents/${encPath(path)}?ref=${REPO.source}&t=${stamp()}`,
      { headers: headers('application/vnd.github.raw+json', auth), cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Could not read ${path} (GitHub ${r.status})`);
    return r.text();
  }
  async function readJSON(path, fallback, auth = true) {
    const t = await readText(path, auth);
    if (t == null) return fallback;
    try { return JSON.parse(t); } catch { throw new Error(`${path} is not valid JSON`); }
  }
  async function listDir(path) {
    try { return await gh(`/contents/${encPath(path)}?ref=${REPO.source}`); }
    catch (e) { if (e.status === 404) return []; throw e; }
  }
  const json = o => JSON.stringify(o, null, 2) + '\n';

  // One commit per branch the site is built from, made of the same blobs.
  async function commit(changes, message) {
    const entries = [];
    for (const c of changes) {
      if (c.delete) { entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const blob = await gh('/git/blobs', { method: 'POST',
        body: c.base64 != null ? { content: c.base64, encoding: 'base64' } : { content: c.content, encoding: 'utf-8' } });
      entries.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const msg = `${message}\n\nPublished from Moto Market Studio by ${ME ? ME.username : 'setup'}.`;
    for (const branch of REPO.publish) {
      let ref;
      try { ref = await gh(`/git/ref/heads/${branch}`); }
      catch (e) { if (e.status === 404 && branch !== REPO.source) continue; throw e; }
      for (let attempt = 0; ; attempt++) {
        const parent = await gh(`/git/commits/${ref.object.sha}`);
        let tree;
        try { tree = await gh('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } }); }
        catch (e) {
          // a delete of a file this branch never had is not an error worth stopping for
          const keep = entries.filter(x => x.sha !== null);
          if (e.status !== 422 || keep.length === entries.length) throw e;
          tree = await gh('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: keep.length ? keep : [] } });
        }
        const c = await gh('/git/commits', { method: 'POST', body: { message: msg, tree: tree.sha, parents: [ref.object.sha] } });
        try { await gh(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: c.sha } }); break; }
        catch (e) {
          if (e.status !== 422 || attempt >= 2) throw e;   // someone else pushed meanwhile: rebuild on top
          ref = await gh(`/git/ref/heads/${branch}`);
        }
      }
    }
  }

  const fileToBase64 = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
  const IMG_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/avif'];
  async function uploadChange(file, folder) {
    if (!IMG_TYPES.includes(file.type)) throw new Error('Use a WebP, PNG, JPG, GIF, AVIF or SVG image.');
    if (file.size > 8 * 1024 * 1024) throw new Error('That image is over 8 MB. Export it smaller (WebP at 1600px wide is plenty).');
    if (file.size > 1024 * 1024) toast(`Heads up: ${(file.size / 1048576).toFixed(1)} MB will slow phones down. WebP under 400 KB is ideal.`);
    const dot = file.name.lastIndexOf('.');
    const ext = (dot > 0 ? file.name.slice(dot + 1) : file.type.split('/')[1]).toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const base = slugify(dot > 0 ? file.name.slice(0, dot) : file.name) || 'image';
    const path = `assets/uploads/${folder ? folder + '/' : ''}${base}-${stamp()}.${ext}`;
    return { path, change: { path, base64: await fileToBase64(file) } };
  }

  /* -- session ------------------------------------------------------------ */
  let ME = null;       // { username, name, role }
  let DB = null;       // users.json
  const SKEY = 'mm.studio.session';

  async function loadUsers(auth) {
    const d = await readJSON(USERS, null, auth);
    return d && Array.isArray(d.users) ? d : { version: 1, users: [] };
  }

  async function start() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
      if (s && s.token && s.username) {
        TOKEN = s.token;
        DB = await loadUsers(true);
        const u = DB.users.find(x => x.username === s.username && x.active !== false);
        if (u) { ME = { username: u.username, name: u.name, role: u.role }; return openApp(); }
      }
    } catch (e) { console.warn(e); }
    TOKEN = null;
    sessionStorage.removeItem(SKEY);
    showGate();
  }

  async function showGate() {
    $('[data-view="app"]').hidden = true;
    $('[data-view="gate"]').hidden = false;
    let d;
    try { d = await loadUsers(false); }
    catch (e) { d = { users: [] }; $('[data-form="login"] [data-msg]').textContent = e.message; }
    const fresh = !d.users.length;
    $('[data-form="login"]').hidden = fresh;
    $('[data-form="setup"]').hidden = !fresh;
    $(fresh ? '[data-form="setup"] input' : '[data-form="login"] input').focus();
    DB = d;
  }

  function formMsg(form, msg, kind) {
    const m = $('[data-msg]', form);
    m.textContent = msg || '';
    m.className = 'hint' + (kind ? ` is-${kind}` : '');
  }

  $('[data-form="login"]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    const username = f.username.value.trim().toLowerCase();
    formMsg(f, 'Checking…');
    const res = await task('Signing in…', async () => {
      DB = await loadUsers(false);
      const u = DB.users.find(x => x.username === username);
      if (!u) return 'Wrong username or password.';
      if (u.active === false) return 'This account is switched off. Ask an Administrator.';
      let token;
      try { token = await unseal(u.vault, f.password.value); } catch { return 'Wrong username or password.'; }
      TOKEN = token;
      ME = { username: u.username, name: u.name, role: u.role };
      sessionStorage.setItem(SKEY, JSON.stringify({ username: u.username, token }));
      return null;
    });
    if (res === undefined) { formMsg(f, ''); return; }
    if (res) { formMsg(f, res, 'error'); f.password.select(); return; }
    f.reset();
    formMsg(f, '');
    openApp();
  });

  $('[data-form="setup"]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    const token = f.token.value.trim();
    const username = f.username.value.trim().toLowerCase();
    const res = await task('Checking the token and creating your account…', async () => {
      let repo;
      try { repo = await gh('', { token }); }
      catch (err) { if (err.status === 401 || err.status === 404) return 'GitHub did not accept that token, or it cannot see the repository.'; throw err; }
      if (!repo.permissions || !repo.permissions.push) return 'That token can read the repository but not write to it. Give it Contents: Read and write.';
      TOKEN = token;
      const existing = await loadUsers(true);
      if (existing.users.length) return 'Someone finished setup a moment ago. Reload and sign in.';
      const now = new Date().toISOString();
      DB = { version: 1, users: [{ username, name: f.name.value.trim(), role: 'admin', active: true,
        vault: await seal(token, f.password.value), created: now, updated: now }] };
      ME = { username, name: DB.users[0].name, role: 'admin' };
      await commit([{ path: USERS, content: json(DB) }], 'Studio: create the first Administrator');
      sessionStorage.setItem(SKEY, JSON.stringify({ username, token }));
      return null;
    });
    if (res === undefined) return;
    if (res) { formMsg(f, res, 'error'); TOKEN = null; return; }
    f.reset();
    openApp();
  });

  $('[data-logout]').addEventListener('click', () => {
    sessionStorage.removeItem(SKEY);
    TOKEN = null; ME = null;
    location.hash = '';
    showGate();
  });

  /* -- app shell and routing --------------------------------------------- */
  const allowed = () => ROLES[ME.role] ? ROLES[ME.role].can : ['account'];
  function openApp() {
    $('[data-view="gate"]').hidden = true;
    $('[data-view="app"]').hidden = false;
    $('[data-me-name]').textContent = ME.name || ME.username;
    $('[data-me-role]').textContent = ROLES[ME.role] ? ROLES[ME.role].title : ME.role;
    let group = '';
    $('[data-nav]').innerHTML = allowed().map(k => {
      const s = SECTIONS[k];
      const g = s.group !== group ? `<p>${esc(s.group)}</p>` : '';
      group = s.group;
      return `${g}<button type="button" data-go="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg>${esc(s.label)}</button>`;
    }).join('');
    route();
  }
  $('[data-nav]').addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) location.hash = `#/${b.dataset.go}`;
  });
  window.addEventListener('hashchange', () => { if (ME) route(); });

  const VIEWS = {};
  function route() {
    const [key, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
    const can = allowed();
    const k = can.includes(key) ? key : can[0];
    $$('[data-go]').forEach(b => { if (b.dataset.go === k) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    // a fresh element per view, so listeners from the last view never stack up
    const old = $('[data-main]');
    const main = old.cloneNode(false);
    old.replaceWith(main);
    main.innerHTML = '<p class="hint">Loading…</p>';
    Promise.resolve(VIEWS[k](main, rest.map(decodeURIComponent))).catch(e => {
      console.error(e);
      main.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`;
    });
    main.focus({ preventScroll: true });
  }

  function head(title, hint, actions = '') {
    return `<div class="head"><div><p class="eyebrow">${esc(ROLES[ME.role].title)}</p><h1>${esc(title)}</h1>` +
      `${hint ? `<p class="hint">${hint}</p>` : ''}</div><div class="row">${actions}</div></div>`;
  }

  function dialog(html, onSubmit) {
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" class="form">${html}<p class="hint" data-msg></p></form>`;
    document.body.appendChild(d);
    const f = $('form', d);
    d.addEventListener('close', () => d.remove());
    $$('[data-cancel]', d).forEach(b => b.addEventListener('click', () => d.close()));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const err = await onSubmit(f, d);
      if (err) formMsg(f, err, 'error'); else if (d.open) d.close();
    });
    d.showModal();
    const first = $('input, select, textarea', d);
    if (first) first.focus();
    return d;
  }
  const confirmBox = (title, text, yes = 'Delete') => new Promise(res => {
    let ok = false;
    const d = dialog(`<h2>${esc(title)}</h2><p class="hint">${text}</p>
      <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">${esc(yes)}</button></div>`,
      () => { ok = true; return null; });
    d.addEventListener('close', () => res(ok));
  });

  /* =====================================================================
     TEAM & ACCESS (Administrator only)
     ===================================================================== */
  VIEWS.team = async main => {
    DB = await loadUsers(true);
    const admins = DB.users.filter(u => u.role === 'admin' && u.active !== false).length;
    main.innerHTML = head('Team & Access',
      'Add people, choose what they can do, switch accounts off and reset passwords. <b>Administrators</b> can do everything, including accounts; <b>Content Editors</b> change images, products, pages and posts.',
      '<button class="btn btn--red" type="button" data-add-user>+ Add person</button>') +
      `<div class="wrapx"><table class="table"><thead><tr><th>Person</th><th>Username</th><th>Role</th><th>Status</th><th>Last change</th><th></th></tr></thead><tbody>` +
      DB.users.map(u => `<tr>
        <td><b>${esc(u.name)}</b>${u.username === ME.username ? ' <span class="tag">You</span>' : ''}</td>
        <td><code>${esc(u.username)}</code></td>
        <td><span class="tag ${u.role === 'admin' ? 'tag--red' : ''}">${esc(ROLES[u.role] ? ROLES[u.role].title : u.role)}</span></td>
        <td><span class="tag ${u.active === false ? '' : 'tag--ok'}">${u.active === false ? 'Switched off' : 'Active'}</span></td>
        <td>${fmtDate((u.updated || '').slice(0, 10))}</td>
        <td><div class="row">
          <button class="btn btn--sm" type="button" data-edit="${esc(u.username)}">Edit access</button>
          <button class="btn btn--sm" type="button" data-reset="${esc(u.username)}">Reset password</button>
          <button class="btn btn--sm btn--danger" type="button" data-remove="${esc(u.username)}" ${u.username === ME.username ? 'disabled title="You cannot remove yourself"' : ''}>Remove</button>
        </div></td></tr>`).join('') +
      `</tbody></table></div>
      <div class="panel" style="margin-top:1rem"><p class="hint">Every account unlocks the same publishing token, sealed with its own password. To swap the token itself (for example when it expires), use <b>Replace GitHub token</b>; everyone keeps their password.</p>
      <div class="row" style="margin-top:.8rem"><button class="btn btn--sm" type="button" data-token>Replace GitHub token</button></div></div>`;

    const lastAdmin = u => u.role === 'admin' && u.active !== false && admins <= 1;
    const roleSelect = sel => `<select name="role">${Object.entries(ROLES).map(([k, r]) =>
      `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}</select>`;

    async function saveUsers(message, mutate) {
      const fresh = await loadUsers(true);
      const err = await mutate(fresh);
      if (err) return err;
      await commit([{ path: USERS, content: json(fresh) }], message);
      DB = fresh;
      return null;
    }

    $('[data-add-user]', main).addEventListener('click', () => dialog(`
      <h2>Add a person</h2>
      <label>Full name <input name="name" required></label>
      <label>Username <input name="username" required pattern="[a-z0-9._\\-]{3,32}" title="3–32 lowercase letters, digits, dot, dash or underscore" autocomplete="off"></label>
      <label>Role ${roleSelect('editor')}</label>
      <label>Starting password <input name="password" type="password" minlength="${MIN_PW}" required autocomplete="new-password"></label>
      <p class="hint">Share the password privately. They can change it under <b>My password</b>.</p>
      <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">Add person</button></div>`,
      async f => {
        const username = f.username.value.trim().toLowerCase();
        const r = await task('Adding…', () => saveUsers(`Studio: add ${username}`, async d => {
          if (d.users.some(u => u.username === username)) return 'That username is taken.';
          const now = new Date().toISOString();
          d.users.push({ username, name: f.name.value.trim(), role: f.role.value, active: true,
            vault: await seal(TOKEN, f.password.value), created: now, updated: now });
          return null;
        }));
        if (r) return r;
        if (r === null) { toast(`${username} added`); route(); }
        return null;
      }));

    main.addEventListener('click', async e => {
      const ed = e.target.closest('[data-edit]'), rs = e.target.closest('[data-reset]'), rm = e.target.closest('[data-remove]');
      if (e.target.closest('[data-token]')) {
        dialog(`<h2>Replace GitHub token</h2>
          <p class="hint">Paste a new fine-grained token with <b>Contents: Read and write</b> on ${REPO.owner}/${REPO.name}. You will need to re-enter each person's password, because their sealed copy can only be rebuilt with it; anyone you skip is switched off until you reset their password.</p>
          <label>New token <input name="token" type="password" required autocomplete="off"></label>
          <label>Your password <input name="password" type="password" required autocomplete="current-password"></label>
          <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">Replace</button></div>`,
          async f => {
            const token = f.token.value.trim();
            const r = await task('Checking the new token…', async () => {
              const repo = await gh('', { token });
              if (!repo.permissions || !repo.permissions.push) return 'That token cannot write to the repository.';
              const me = DB.users.find(u => u.username === ME.username);
              try { await unseal(me.vault, f.password.value); } catch { return 'Your password is wrong.'; }
              const old = TOKEN;
              TOKEN = token;
              try {
                return await saveUsers('Studio: replace the publishing token', async d => {
                  for (const u of d.users) {
                    if (u.username === ME.username) { u.vault = await seal(token, f.password.value); }
                    else { u.active = false; u.vault = await seal(token, crypto.getRandomValues(new Uint32Array(4)).join('-')); }
                    u.updated = new Date().toISOString();
                  }
                  return null;
                });
              } catch (err) { TOKEN = old; throw err; }
            });
            if (r) return r;
            if (r === null) {
              sessionStorage.setItem(SKEY, JSON.stringify({ username: ME.username, token }));
              toast('Token replaced. Reset each person’s password to switch them back on.');
              route();
            }
            return null;
          });
        return;
      }
      if (ed) {
        const u = DB.users.find(x => x.username === ed.dataset.edit);
        dialog(`<h2>Edit access · ${esc(u.username)}</h2>
          <label>Full name <input name="name" value="${esc(u.name)}" required></label>
          <label>Role ${roleSelect(u.role)}</label>
          <label>Status <select name="active"><option value="1"${u.active !== false ? ' selected' : ''}>Active — can sign in</option><option value="0"${u.active === false ? ' selected' : ''}>Switched off — cannot sign in</option></select></label>
          <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">Save</button></div>`,
          async f => {
            const role = f.role.value, active = f.active.value === '1';
            if (lastAdmin(u) && (role !== 'admin' || !active)) return 'This is the last active Administrator. Make someone else an administrator first.';
            const r = await task('Saving…', () => saveUsers(`Studio: update access for ${u.username}`, async d => {
              const x = d.users.find(y => y.username === u.username);
              if (!x) return 'That account no longer exists.';
              Object.assign(x, { name: f.name.value.trim(), role, active, updated: new Date().toISOString() });
              return null;
            }));
            if (r) return r;
            if (r === null) {
              toast('Access updated');
              if (u.username === ME.username && role !== ME.role) { ME.role = role; openApp(); return null; }
              route();
            }
            return null;
          });
      }
      if (rs) {
        const u = DB.users.find(x => x.username === rs.dataset.reset);
        dialog(`<h2>Reset password · ${esc(u.username)}</h2>
          <label>New password <input name="password" type="password" minlength="${MIN_PW}" required autocomplete="new-password"></label>
          <label>Type it again <input name="again" type="password" minlength="${MIN_PW}" required autocomplete="new-password"></label>
          <label><span><input type="checkbox" name="activate" checked style="width:auto"> Switch the account on as well</span></label>
          <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">Reset password</button></div>`,
          async f => {
            if (f.password.value !== f.again.value) return 'The two passwords do not match.';
            const r = await task('Resetting…', () => saveUsers(`Studio: reset the password for ${u.username}`, async d => {
              const x = d.users.find(y => y.username === u.username);
              if (!x) return 'That account no longer exists.';
              x.vault = await seal(TOKEN, f.password.value);
              if (f.activate.checked) x.active = true;
              x.updated = new Date().toISOString();
              return null;
            }));
            if (r) return r;
            if (r === null) { toast(`Password reset for ${u.username}`); route(); }
            return null;
          });
      }
      if (rm && !rm.disabled) {
        const u = DB.users.find(x => x.username === rm.dataset.remove);
        if (lastAdmin(u)) { toast('That is the last active Administrator.', true); return; }
        if (!(await confirmBox(`Remove ${u.name}?`, `<b>${esc(u.username)}</b> will no longer be able to sign in. This cannot be undone, but you can add them again.`, 'Remove'))) return;
        const r = await task('Removing…', () => saveUsers(`Studio: remove ${u.username}`, async d => {
          d.users = d.users.filter(y => y.username !== u.username);
          return null;
        }));
        if (r === null) { toast(`${u.username} removed`); route(); }
      }
    });
  };

  /* =====================================================================
     MY PASSWORD (everyone)
     ===================================================================== */
  VIEWS.account = async main => {
    main.innerHTML = head('My password', `Signed in as <b>${esc(ME.username)}</b>. Use at least ${MIN_PW} characters — a short sentence works well.`) +
      `<form class="panel form" style="max-width:480px" data-pw>
        <label>Current password <input name="current" type="password" required autocomplete="current-password"></label>
        <label>New password <input name="password" type="password" minlength="${MIN_PW}" required autocomplete="new-password"></label>
        <label>Type it again <input name="again" type="password" minlength="${MIN_PW}" required autocomplete="new-password"></label>
        <div class="row"><button class="btn btn--red" type="submit">Change password</button></div>
        <p class="hint" data-msg></p>
      </form>`;
    $('[data-pw]', main).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (f.password.value !== f.again.value) return formMsg(f, 'The two new passwords do not match.', 'error');
      const r = await task('Changing your password…', async () => {
        const d = await loadUsers(true);
        const me = d.users.find(u => u.username === ME.username);
        if (!me) return 'Your account no longer exists.';
        try { await unseal(me.vault, f.current.value); } catch { return 'Your current password is wrong.'; }
        me.vault = await seal(TOKEN, f.password.value);
        me.updated = new Date().toISOString();
        await commit([{ path: USERS, content: json(d) }], `Studio: ${ME.username} changed their password`);
        return null;
      });
      if (r) return formMsg(f, r, 'error');
      if (r === null) { f.reset(); formMsg(f, 'Password changed. Use the new one next time you sign in.', 'ok'); }
    });
  };

  /* =====================================================================
     Reading and writing the site's own HTML
     ===================================================================== */
  async function sitePages() {
    const list = await listDir('');
    return list.filter(f => f.type === 'file' && /\.html$/.test(f.name)).map(f => f.name);
  }
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  // source ranges of every product card whose Add button carries this id
  function cardRanges(text, id) {
    const out = [];
    const needle = `data-add="${id}"`;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
      const a = text.lastIndexOf('<article', i), b = text.indexOf('</article>', i);
      if (a >= 0 && b >= 0 && text.lastIndexOf('</article>', i) < a) out.push([a, b + 10]);
    }
    return out;
  }

  /* =====================================================================
     IMAGES (Content Editor)
     ===================================================================== */
  VIEWS.images = async main => {
    const files = await sitePages();
    const texts = {};
    await Promise.all(files.map(async f => { texts[f] = await readText(f); }));
    const map = new Map();
    for (const f of files) {
      const doc = parse(texts[f]);
      $$('img[src]', doc).forEach(img => {
        const src = img.getAttribute('src');
        if (!src || /^(data:|https?:|\/\/)/.test(src)) return;
        if (!map.has(src)) map.set(src, { src, alt: img.getAttribute('alt') || '', pages: new Set(), count: 0 });
        const m = map.get(src);
        m.pages.add(f); m.count++;
        if (!m.alt && img.getAttribute('alt')) m.alt = img.getAttribute('alt');
      });
    }
    const items = [...map.values()];
    main.innerHTML = head('Images', 'Every picture used on the site. <b>Replace</b> swaps it everywhere it appears in one go; the old file is kept, so nothing breaks while the site republishes (about a minute).') +
      `<div class="toolbar"><input type="search" placeholder="Search by file name or description" data-q>
        <select data-page><option value="">All pages</option>${files.map(f => `<option>${esc(f)}</option>`).join('')}</select></div>
      <div class="grid" data-grid></div>
      <input type="file" accept="${IMG_TYPES.join(',')}" hidden data-file>`;
    const grid = $('[data-grid]', main), q = $('[data-q]', main), pg = $('[data-page]', main), file = $('[data-file]', main);
    const draw = () => {
      const n = q.value.trim().toLowerCase(), p = pg.value;
      const shown = items.filter(i => (!p || i.pages.has(p)) && (!n || (i.src + ' ' + i.alt).toLowerCase().includes(n)));
      grid.innerHTML = shown.length ? shown.map(i => `<div class="tile">
          <figure><img src="${esc(SITE_BASE + i.src)}" alt="" loading="lazy"></figure>
          <div><b>${esc(i.alt || i.src.split('/').pop())}</b><small>${esc(i.src)}</small>
          <small>Used ${i.count}× on ${[...i.pages].map(esc).join(', ')}</small>
          <div class="row"><button class="btn btn--sm btn--red" type="button" data-replace="${esc(i.src)}">Replace</button>
          <button class="btn btn--sm" type="button" data-alt="${esc(i.src)}">Description</button></div></div></div>`).join('')
        : '<div class="empty">No images match.</div>';
    };
    q.addEventListener('input', draw); pg.addEventListener('change', draw);
    draw();

    const attrRe = src => new RegExp(`((?:src|href)=")${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`, 'g');
    let target = null;
    grid.addEventListener('click', e => {
      const r = e.target.closest('[data-replace]'), a = e.target.closest('[data-alt]');
      if (r) { target = items.find(i => i.src === r.dataset.replace); file.value = ''; file.click(); }
      if (a) {
        const it = items.find(i => i.src === a.dataset.alt);
        dialog(`<h2>Image description</h2><p class="hint">Read aloud by screen readers and shown by Google Images. Describe what is in the picture.</p>
          <label>Description <input name="alt" value="${esc(it.alt)}"></label>
          <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">Save</button></div>`,
          async f => {
            const alt = f.alt.value.trim();
            const r2 = await task('Saving the description…', async () => {
              const changes = [];
              for (const p of it.pages) {
                const t = await readText(p);
                const out = t.replace(/<img\b[^>]*>/g, tag => tag.includes(`src="${it.src}"`)
                  ? (/\balt="[^"]*"/.test(tag) ? tag.replace(/\balt="[^"]*"/, `alt="${esc(alt)}"`) : tag.replace(/<img\b/, `<img alt="${esc(alt)}"`)) : tag);
                if (out !== t) changes.push({ path: p, content: out });
              }
              if (changes.length) await commit(changes, `Studio: describe ${it.src}`);
              it.alt = alt;
              return null;
            });
            if (r2 === null) { toast('Description saved'); draw(); }
            return r2 || null;
          });
      }
    });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f || !target) return;
      const ok = await task(`Uploading ${f.name} and updating ${target.pages.size} page(s)…`, async () => {
        const up = await uploadChange(f, 'images');
        const changes = [up.change];
        for (const p of target.pages) {
          const t = await readText(p);
          const out = t.replace(attrRe(target.src), `$1${up.path}$2`);
          if (out !== t) changes.push({ path: p, content: out });
        }
        await commit(changes, `Studio: replace ${target.src}`);
        map.delete(target.src);
        target.src = up.path;
        map.set(up.path, target);
        return true;
      });
      if (ok) { toast('Image replaced. The live site updates in about a minute.'); items.splice(0, items.length, ...map.values()); draw(); }
    });
  };

  /* =====================================================================
     PRODUCTS (Content Editor)
     ===================================================================== */
  function readCard(card) {
    const btn = $('[data-add]', card);
    const priceEl = $('.card__price', card);
    const was = priceEl && $('s', priceEl) ? Number($('s', priceEl).textContent.replace(/[^\d]/g, '')) : 0;
    const photo = $('.card__photo', card);
    return {
      id: btn.dataset.add,
      name: ($('.card__name', card) || {}).textContent || btn.dataset.name || '',
      cat: btn.dataset.cat || '',
      catKey: card.dataset.cat || '',
      perk: ($('.card__perk', card) || {}).textContent || '',
      price: Number(btn.dataset.price || card.dataset.price || 0),
      was,
      badge: (($$('.badge', card).find(b => !b.classList.contains('badge--off'))) || {}).textContent || '',
      photo: photo ? photo.getAttribute('src') : '',
      art: ($('.card__art pre', card) || {}).textContent || '',
    };
  }
  // Writes only the fields in `changed`, so a page whose card differs from the
  // others (Home cards carry no selling-point line, for one) keeps its own shape.
  function writeCard(card, p, doc, changed) {
    const ch = k => changed.has(k);
    const save = p.was > p.price ? Math.round((p.was - p.price) / p.was * 100) : 0;
    const btn = $('[data-add]', card);
    btn.dataset.add = p.id;
    if (ch('name')) btn.dataset.name = p.name;
    const name = $('.card__name', card); if (name && ch('name')) name.textContent = p.name;
    if (ch('price')) {
      btn.dataset.price = String(p.price);
      card.dataset.price = String(p.price);
      card.dataset.save = String(save);
    }
    let perk = $('.card__perk', card);
    if (!ch('perk')) { /* untouched */ } else if (p.perk) {
      if (!perk) { perk = doc.createElement('p'); perk.className = 'card__perk'; (name || $('.card__cat', card)).after(perk); }
      perk.textContent = p.perk;
    } else if (perk) perk.remove();
    const pr = $('.card__price', card);
    if (pr && ch('price')) pr.innerHTML = (save ? `<s>${taka(p.was)}</s>` : '') + taka(p.price);
    let off = $('.badge--off', card);
    if (!ch('price')) { /* untouched */ } else if (save) {
      if (!off) { off = doc.createElement('span'); off.className = 'badge badge--off'; card.prepend(off); }
      off.textContent = `−${save}%`;
    } else if (off) off.remove();
    let badge = $$('.badge', card).find(b => !b.classList.contains('badge--off'));
    if (!ch('badge')) { /* untouched */ } else if (p.badge) {
      if (!badge) { badge = doc.createElement('span'); badge.className = 'badge'; if (off) off.after(badge); else card.prepend(badge); }
      badge.textContent = p.badge;
    } else if (badge) badge.remove();
    if (p.photo && ch('photo')) {
      const art = $('.card__art', card);
      if (art) {
        let img = $('.card__photo', art);
        if (!img) {
          img = doc.createElement('img');
          img.className = 'card__photo';
          img.loading = 'lazy';
          const pre = $('pre', art);
          if (pre) pre.replaceWith(img); else art.prepend(img);
        }
        img.setAttribute('src', p.photo);
        img.setAttribute('alt', p.name);
      }
    }
  }

  VIEWS.products = async main => {
    const files = await sitePages();
    const docs = {};
    await Promise.all(files.map(async f => { const t = await readText(f); if (t && t.includes('data-add=')) docs[f] = parse(t); }));
    const products = new Map();
    for (const [f, doc] of Object.entries(docs)) {
      $$('article.card', doc).forEach(card => {
        if (!$('[data-add]', card)) return;
        const p = readCard(card);
        if (!products.has(p.id)) products.set(p.id, { ...p, pages: [] });
        const known = products.get(p.id);
        known.pages.push(f);
        for (const k of ['perk', 'badge', 'photo', 'art']) if (!known[k] && p[k]) known[k] = p[k];   // fill gaps from other pages
      });
    }
    const cats = [...new Set([...products.values()].map(p => p.cat))].filter(Boolean);
    main.innerHTML = head('Products', `${products.size} products across ${Object.keys(docs).map(esc).join(' and ')}. A change applies to every page that shows the product. Prices are in taka; fill in <b>Was</b> to show a discount and its percentage badge.`) +
      `<div class="toolbar"><input type="search" placeholder="Search products" data-q>
        <select data-cat><option value="">All categories</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="grid" data-grid></div>`;
    const grid = $('[data-grid]', main), q = $('[data-q]', main), cf = $('[data-cat]', main);
    const draw = () => {
      const n = q.value.trim().toLowerCase(), c = cf.value;
      const shown = [...products.values()].filter(p => (!c || p.cat === c) && (!n || p.name.toLowerCase().includes(n)));
      grid.innerHTML = shown.length ? shown.map(p => `<div class="tile">
          <figure>${p.photo ? `<img src="${esc(SITE_BASE + p.photo)}" alt="" loading="lazy">` : `<pre>${esc(p.art)}</pre>`}</figure>
          <div><small>${esc(p.cat)}</small><b>${esc(p.name)}</b>
          <p class="price">${p.was > p.price ? `<s>${taka(p.was)}</s>` : ''}${taka(p.price)}</p>
          <small>On ${p.pages.map(esc).join(', ')}</small>
          <div class="row"><button class="btn btn--sm btn--red" type="button" data-edit="${esc(p.id)}">Edit</button>
          <button class="btn btn--sm" type="button" data-dup="${esc(p.id)}">Duplicate</button>
          <button class="btn btn--sm btn--danger" type="button" data-del="${esc(p.id)}">Delete</button></div></div></div>`).join('')
        : '<div class="empty">No products match.</div>';
    };
    q.addEventListener('input', draw); cf.addEventListener('change', draw);
    draw();

    // Only the product's own <article> is rewritten; the rest of each page is
    // left byte for byte, so other people's edits never collide with ours.
    async function publish(message, id, apply, extra = []) {
      return task('Publishing the product change…', async () => {
        const changes = [...extra];
        for (const f of Object.keys(docs)) {
          let t = await readText(f);                  // re-read: never overwrite someone else's newer save
          let hit = false;
          for (const [a, b] of cardRanges(t, id).reverse()) {
            const tpl = document.createElement('template');
            tpl.innerHTML = t.slice(a, b);
            const card = tpl.content.firstElementChild;
            const indent = (/[ \t]*$/.exec(t.slice(0, a)) || [''])[0];
            const out = apply(card).map(c => c.outerHTML).join(`\n${indent}`);
            if (out) t = t.slice(0, a) + out + t.slice(b);
            else t = t.slice(0, a - indent.length) + t.slice(t[b] === '\n' ? b + 1 : b);   // drop the whole line
            hit = true;
          }
          if (hit) changes.push({ path: f, content: t });
        }
        if (!changes.length) return 'Nothing to change — the product was not found on the live pages.';
        await commit(changes, message);
        return null;
      });
    }

    function editor(p, isNew, srcId) {
      dialog(`<h2>${isNew ? 'New product' : 'Edit product'}</h2>
        <label>Name <input name="name" value="${esc(p.name)}" required maxlength="80"></label>
        <label>Selling point <input name="perk" value="${esc(p.perk)}" maxlength="60" placeholder="e.g. Sealed · poured in front of you"></label>
        <div class="two" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <label>Price (৳) <input name="price" type="number" min="0" step="1" value="${p.price}" required></label>
          <label>Was (৳, optional) <input name="was" type="number" min="0" step="1" value="${p.was || ''}"></label>
        </div>
        <label>Badge (optional) <input name="badge" value="${esc(p.badge)}" maxlength="24" placeholder="Best seller, New, Limited…"></label>
        <label>Photo (optional) <input name="photo" type="file" accept="${IMG_TYPES.join(',')}"></label>
        <p class="hint">${p.photo ? 'A photo is set. Choose a new file to replace it.' : 'Without a photo the card keeps its drawn icon. A product cut-out on a transparent background looks best.'}</p>
        <div class="row"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn--red" type="submit">${isNew ? 'Add product' : 'Save'}</button></div>`,
        async f => {
          const price = Number(f.price.value), was = Number(f.was.value || 0);
          if (was && was <= price) return '“Was” must be higher than the price, or left empty.';
          const next = { ...p, name: f.name.value.trim(), perk: f.perk.value.trim(), price, was, badge: f.badge.value.trim() };
          if (isNew) next.id = `${slugify(next.name) || 'product'}-${stamp()}`;
          const changed = new Set(['name', 'perk', 'badge'].filter(k => next[k] !== p[k]));
          if (next.price !== p.price || next.was !== p.was) changed.add('price');
          const extra = [];
          const file = f.photo.files[0];
          if (file) {
            try { const up = await uploadChange(file, 'products'); next.photo = up.path; extra.push(up.change); changed.add('photo'); }
            catch (e) { return e.message; }
          }
          const r = await publish(isNew ? `Studio: add product ${next.name}` : `Studio: update product ${next.name}`, isNew ? srcId : p.id, card => {
            if (!isNew) { writeCard(card, next, document, changed); return [card]; }
            const copy = card.cloneNode(true);
            writeCard(copy, next, document, changed);
            return [card, copy];
          }, extra);
          if (r) return r;
          if (r === null) {
            if (isNew) products.set(next.id, { ...next, pages: [...p.pages] }); else products.set(p.id, { ...next, pages: p.pages });
            toast(isNew ? 'Product added next to the original' : 'Product saved');
            draw();
          }
          return null;
        });
    }

    grid.addEventListener('click', async e => {
      const ed = e.target.closest('[data-edit]'), du = e.target.closest('[data-dup]'), de = e.target.closest('[data-del]');
      if (ed) editor(products.get(ed.dataset.edit), false);
      if (du) { const p = products.get(du.dataset.dup); editor({ ...p, name: `${p.name} (copy)` }, true, p.id); }
      if (de) {
        const p = products.get(de.dataset.del);
        if (!(await confirmBox(`Delete ${p.name}?`, `It disappears from ${p.pages.map(esc).join(' and ')}. People with it in their cart keep it until they check out.`))) return;
        const r = await publish(`Studio: remove product ${p.name}`, p.id, () => []);
        if (r === null) { products.delete(p.id); toast('Product deleted'); draw(); }
        else if (r) toast(r, true);
      }
    });
  };

  /* =====================================================================
     Theme shell: every page and post is wrapped in the site's own header,
     menu, footer, styles and scripts, taken live from shop.html.
     ===================================================================== */
  let shellCache = null;
  async function themeShell() {
    if (!shellCache) {
      const t = await readText('shop.html');
      const a = t.indexOf('<main'), b = t.lastIndexOf('</main>');
      if (a < 0 || b < 0) throw new Error('shop.html has no <main> to build the theme from');
      shellCache = { head: t.slice(0, a), tail: t.slice(b + 7) };
    }
    return shellCache;
  }
  function build(shell, { title, description, path, body, kind, depth }) {
    const url = SITE + path;
    let h = shell.head
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} — Moto Market Kushtia</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
      .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}">`)
      .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(description)}`)
      .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`)
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '')
      .replace(/ aria-current="page"/g, '');
    if (depth) h = h.replace(/<meta charset="utf-8">/i, m => `${m}\n<base href="${'../'.repeat(depth)}">`);
    if (!/<link rel="canonical"/.test(h)) h = h.replace('</head>', `<link rel="canonical" href="${url}">\n</head>`);
    return `${h}<main data-cms="${kind}">\n<!-- cms:content -->\n${body}\n<!-- /cms:content -->\n</main>${shell.tail}`;
  }
  const between = html => {
    const m = /<!-- cms:content -->\n?([\s\S]*?)\n?<!-- \/cms:content -->/.exec(html || '');
    return m ? m[1] : '';
  };
  // previews load the live stylesheet and scripts from the published site
  const previewUrls = new WeakMap();
  function showPreview(frame, html) {
    const doc = html.replace(/<base href="[^"]*">/, '').replace(/<meta charset="utf-8">/i, m => `${m}\n<base href="${SITE_BASE}">`);
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    const y = frame.contentWindow ? frame.contentWindow.scrollY : 0;
    frame.addEventListener('load', () => { try { frame.contentWindow.scrollTo(0, y); } catch {} }, { once: true });
    frame.src = url;
    if (previewUrls.has(frame)) URL.revokeObjectURL(previewUrls.get(frame));
    previewUrls.set(frame, url);
  }
  async function sitemapChange(add, remove) {
    let t = await readText('sitemap.xml');
    if (!t) return null;
    const orig = t;
    for (const p of remove || []) t = t.replace(new RegExp(`\\s*<url>\\s*<loc>${(SITE + p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>`), '');
    for (const p of add || []) {
      const loc = SITE + p;
      const entry = `<url><loc>${loc}</loc><lastmod>${today()}</lastmod></url>`;
      if (t.includes(`<loc>${loc}</loc>`)) t = t.replace(new RegExp(`<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>(\\s*<lastmod>)[^<]*`), `<loc>${loc}</loc>$1${today()}`);
      else t = t.replace('</urlset>', `  ${entry}\n</urlset>`);
    }
    return t === orig ? null : { path: 'sitemap.xml', content: t };
  }

  /* =====================================================================
     PAGES (Content Editor) — new pages are written in code
     ===================================================================== */
  const PAGE_STARTER = `<section class="cms-page">
  <div class="wrap">
    <p class="label label--red">Moto Market · Kushtia</p>
    <h1 class="display">Page title</h1>

    <div class="prose">
      <p>Write the page here. Every class from the site works: <code>wrap</code>, <code>label</code>, <code>btn btn--red</code>, <code>prose</code>…</p>
      <h2>A section heading</h2>
      <p>Paragraph text.</p>
      <p><a class="btn btn--red" href="book.html">Book a free slot →</a></p>
    </div>
  </div>
</section>`;
  const SNIPPETS = {
    'Section with heading': `\n<section class="cms-page">\n  <div class="wrap">\n    <p class="label label--red">Eyebrow</p>\n    <h2 class="display">Section heading</h2>\n    <div class="prose"><p>Text…</p></div>\n  </div>\n</section>\n`,
    'Text block': `\n<div class="prose">\n  <p>Paragraph…</p>\n  <ul>\n    <li>Point one</li>\n    <li>Point two</li>\n  </ul>\n</div>\n`,
    'Red button': `<a class="btn btn--red" href="book.html">Book a free slot <span class="btn__arrow">→</span></a>`,
    'Outline button': `<a class="btn btn--ghost" href="shop.html">Shop the range</a>`,
    'Image': `<img src="assets/uploads/your-image.webp" alt="Describe the picture" loading="lazy" style="max-width:100%;height:auto">`,
    'WhatsApp link': `<a class="btn btn--ghost" href="https://wa.me/8801711154387" target="_blank" rel="noopener">WhatsApp the bay</a>`,
  };

  VIEWS.pages = async (main, [mode, slug]) => {
    if (mode === 'new' || mode === 'edit') return pageEditor(main, mode === 'new' ? null : slug);
    const [files, reg] = await Promise.all([sitePages(), readJSON(PAGES, { pages: [] })]);
    const custom = new Map(reg.pages.map(p => [p.file, p]));
    const rows = files.map(f => ({ file: f, core: !custom.has(f), meta: custom.get(f) }));
    main.innerHTML = head('Pages', 'Every page on the site. New pages are written in HTML and published inside the site’s own header, menu and footer, so they always match the theme.',
      '<a class="btn btn--red" href="#/pages/new">+ New page</a>') +
      `<div class="wrapx"><table class="table"><thead><tr><th>Page</th><th>Address</th><th>Type</th><th>Updated</th><th></th></tr></thead><tbody>` +
      rows.map(r => `<tr>
        <td><b>${esc(r.meta ? r.meta.title : CORE[r.file] || r.file)}</b></td>
        <td><code>${esc(r.file)}</code></td>
        <td><span class="tag ${r.core ? '' : 'tag--red'}">${r.core ? 'Theme page' : 'Custom page'}</span></td>
        <td>${r.meta ? fmtDate(r.meta.updated.slice(0, 10)) : '—'}</td>
        <td><div class="row"><a class="btn btn--sm" href="${esc(SITE_BASE + r.file)}" target="_blank" rel="noopener">View</a>
        ${r.core ? '' : `<a class="btn btn--sm btn--red" href="#/pages/edit/${encodeURIComponent(r.meta.slug)}">Edit code</a>
          <button class="btn btn--sm btn--danger" type="button" data-del="${esc(r.meta.slug)}">Delete</button>`}</div></td></tr>`).join('') +
      `</tbody></table></div><p class="hint" style="margin-top:1rem">Theme pages (Home, Shop, Book) are edited through <b>Images</b> and <b>Products</b>; the Journal page is rebuilt from <b>Posts</b>.</p>`;
    main.addEventListener('click', async e => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      const p = reg.pages.find(x => x.slug === d.dataset.del);
      if (!(await confirmBox(`Delete “${p.title}”?`, `<code>${esc(p.file)}</code> is removed from the site. Links to it will stop working.`))) return;
      const r = await task('Deleting the page…', async () => {
        const fresh = await readJSON(PAGES, { pages: [] });
        fresh.pages = fresh.pages.filter(x => x.slug !== p.slug);
        const changes = [{ path: p.file, delete: true }, { path: PAGES, content: json(fresh) }];
        const sm = await sitemapChange([], [p.file]); if (sm) changes.push(sm);
        await commit(changes, `Studio: delete page ${p.file}`);
        return null;
      });
      if (r === null) { toast('Page deleted'); route(); }
    });
  };

  async function pageEditor(main, slug) {
    const reg = await readJSON(PAGES, { pages: [] });
    const meta = slug ? reg.pages.find(p => p.slug === slug) : null;
    if (slug && !meta) throw new Error('That page is not a custom page.');
    const code = meta ? between(await readText(meta.file)) : PAGE_STARTER;
    const shell = await themeShell();
    main.innerHTML = head(meta ? `Edit · ${meta.title}` : 'New page',
      'Write the page body in HTML. The site header, menu, footer, fonts and colours are added for you. Scripts are allowed — publish only code you trust.',
      '<a class="btn" href="#/pages">Back to pages</a>') +
      `<div class="editor"><form class="panel form" data-f>
        <div class="two"><label>Page title <input name="title" required maxlength="80" value="${esc(meta ? meta.title : '')}"></label>
        <label>Address <input name="slug" required pattern="[a-z0-9\\-]{2,60}" value="${esc(meta ? meta.slug : '')}" ${meta ? 'readonly' : ''} title="Lowercase letters, digits and dashes"></label></div>
        <label>Search description <input name="description" maxlength="160" value="${esc(meta ? meta.description : '')}" placeholder="One sentence for Google, up to 160 characters"></label>
        <div class="row"><select data-snip style="width:auto"><option value="">Insert a block…</option>${Object.keys(SNIPPETS).map(k => `<option>${esc(k)}</option>`).join('')}</select>
          <span class="hint">Address: <code data-url></code></span></div>
        <label>Page code (HTML) <textarea class="code" name="code" spellcheck="false">${esc(code)}</textarea></label>
        <div class="row"><button class="btn btn--red" type="submit">${meta ? 'Publish changes' : 'Publish page'}</button><p class="hint" data-msg></p></div>
      </form>
      <div class="preview"><p>Live preview · theme applied</p><iframe title="Preview" data-pv></iframe></div></div>`;
    const f = $('[data-f]', main), pv = $('[data-pv]', main), urlEl = $('[data-url]', main);
    let slugTouched = !!meta;
    f.slug.addEventListener('input', () => { slugTouched = true; });
    let t;
    const refresh = () => {
      if (!slugTouched) f.slug.value = slugify(f.title.value);
      urlEl.textContent = `${f.slug.value || '…'}.html`;
      clearTimeout(t);
      t = setTimeout(() => {
        showPreview(pv, build(shell, { title: f.title.value || 'Untitled', description: f.description.value, path: `${f.slug.value}.html`, body: f.code.value, kind: 'page', depth: 0 }));
      }, 350);
    };
    f.addEventListener('input', refresh);
    refresh();
    f.code.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || e.shiftKey) return;
      e.preventDefault();
      f.code.setRangeText('  ', f.code.selectionStart, f.code.selectionEnd, 'end');
    });
    $('[data-snip]', main).addEventListener('change', e => {
      const s = SNIPPETS[e.target.value];
      e.target.value = '';
      if (!s) return;
      f.code.focus();
      f.code.setRangeText(s, f.code.selectionStart, f.code.selectionEnd, 'end');
      refresh();
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const s = f.slug.value;
      const file = `${s}.html`;
      if (!meta && (CORE[file] || ['admin', 'posts', 'data', 'assets'].includes(s))) return formMsg(f, 'That address is reserved. Pick another.', 'error');
      const r = await task('Publishing the page…', async () => {
        const fresh = await readJSON(PAGES, { pages: [] });
        if (!meta && ((await readText(file)) != null)) return `${file} already exists. Pick another address.`;
        const now = new Date().toISOString();
        const entry = { slug: s, file, title: f.title.value.trim(), description: f.description.value.trim(), updated: now, by: ME.username };
        const i = fresh.pages.findIndex(x => x.slug === s);
        if (i >= 0) fresh.pages[i] = { ...fresh.pages[i], ...entry }; else fresh.pages.push({ ...entry, created: now });
        const html = build(await themeShell(), { title: entry.title, description: entry.description, path: file, body: f.code.value, kind: 'page', depth: 0 });
        const changes = [{ path: file, content: html }, { path: PAGES, content: json(fresh) }];
        const sm = await sitemapChange([file]); if (sm) changes.push(sm);
        await commit(changes, `Studio: ${meta ? 'update' : 'create'} page ${file}`);
        return null;
      });
      if (r) return formMsg(f, r, 'error');
      if (r === null) { toast(`Published. Live at ${file} in about a minute.`); location.hash = '#/pages'; }
    });
  }

  /* =====================================================================
     POSTS (Content Editor) — fill in the template, the theme does the rest
     ===================================================================== */
  const CATS = ['Workshop news', 'Riding tips', 'Maintenance how-to', 'Offers', 'New arrivals'];
  const safeUrl = u => /^(https?:|mailto:|tel:|#|[a-z0-9_./?=&%#-]+$)/i.test(u) && !/^\s*javascript:/i.test(u) ? u : '#';
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
        const href = safeUrl(u.replace(/&amp;/g, '&'));
        return `<a href="${esc(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
      });
  }
  // A small, safe subset of Markdown: headings, lists, quotes, images, links, bold, italic.
  function markdown(src) {
    const out = [];
    const blocks = String(src || '').replace(/\r/g, '').split(/\n{2,}/);
    for (const raw of blocks) {
      const b = raw.trim();
      if (!b) continue;
      let m;
      if ((m = /^(#{2,3})\s+(.+)$/.exec(b)) && !b.includes('\n')) out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(b))) out.push(`<figure><img src="${esc(safeUrl(m[2]))}" alt="${esc(m[1])}" loading="lazy">${m[1] ? `<figcaption class="label">${esc(m[1])}</figcaption>` : ''}</figure>`);
      else if (b.split('\n').every(l => /^[-*]\s+/.test(l))) out.push(`<ul>${b.split('\n').map(l => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`);
      else if (b.split('\n').every(l => /^\d+[.)]\s+/.test(l))) out.push(`<ol>${b.split('\n').map(l => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`);
      else if (b.split('\n').every(l => /^>\s?/.test(l))) out.push(`<blockquote><p>${b.split('\n').map(l => inline(l.replace(/^>\s?/, ''))).join('<br>')}</p></blockquote>`);
      else out.push(`<p>${b.split('\n').map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
  }
  const readMins = s => Math.max(1, Math.round(String(s || '').split(/\s+/).filter(Boolean).length / 200));

  function postBody(p, author) {
    return `<article class="post">
  <div class="wrap">
    <nav class="post__crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a> / <a href="blog.html">Journal</a> / ${esc(p.category)}</nav>
    <p class="label label--red">${esc(p.category)}</p>
    <h1 class="post__title">${esc(p.title)}</h1>
    <p class="post__meta"><time datetime="${esc(p.date)}">${esc(fmtDate(p.date))}</time> · ${readMins(p.body)} min read${author ? ` · ${esc(author)}` : ''}</p>
    ${p.excerpt ? `<p class="post__excerpt">${esc(p.excerpt)}</p>` : ''}
    ${p.cover ? `<figure class="post__cover"><img src="${esc(p.cover)}" alt="${esc(p.coverAlt || p.title)}"></figure>` : ''}
    <div class="prose">
${markdown(p.body)}
    </div>
    <aside class="post__cta">
      <div><p class="label label--red">Moto Market · Kushtia</p><h2>Bring it to the bay</h2></div>
      <div><a class="btn btn--red" href="book.html">Book a free slot <span class="btn__arrow">→</span></a>
      <a class="btn btn--ghost" href="https://wa.me/8801711154387" target="_blank" rel="noopener">WhatsApp the bay</a></div>
    </aside>
  </div>
</article>`;
  }
  function journalBody(posts) {
    const list = posts.filter(p => p.status !== 'draft').sort((a, b) => b.date.localeCompare(a.date));
    return `<section class="journal">
  <div class="wrap">
    <div class="journal__head">
      <p class="label label--red">Moto Market Journal</p>
      <h1>From the bay</h1>
      <p class="lede">Riding tips, maintenance how-tos, new stock and offers from the workshop in Kushtia.</p>
    </div>
    ${list.length ? `<div class="journal__grid">
${list.map(p => `      <a class="journal__card" href="posts/${esc(p.slug)}.html">
        ${p.cover ? `<figure><img src="${esc(p.cover)}" alt="" loading="lazy"></figure>` : ''}
        <div><p class="label">${esc(p.category)} · ${esc(fmtDate(p.date))}</p><h2>${esc(p.title)}</h2>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}</div>
      </a>`).join('\n')}
    </div>` : '<p class="journal__empty">New stories are on the way.</p>'}
  </div>
</section>`;
  }

  VIEWS.posts = async (main, [mode, slug]) => {
    if (mode === 'new' || mode === 'edit') return postEditor(main, mode === 'new' ? null : slug);
    const reg = await readJSON(POSTS, { posts: [] });
    const list = [...reg.posts].sort((a, b) => b.date.localeCompare(a.date));
    main.innerHTML = head('Posts', 'Journal stories. Fill in the post template; it publishes in the site’s theme, joins the Journal page and the sitemap.',
      `${reg.posts.length ? `<a class="btn" href="${esc(SITE_BASE)}blog.html" target="_blank" rel="noopener">View Journal</a>` : ''}<a class="btn btn--red" href="#/posts/new">+ New post</a>`) +
      (list.length ? `<div class="grid">${list.map(p => `<div class="tile">
          <figure>${p.cover ? `<img src="${esc(SITE_BASE + p.cover)}" alt="" loading="lazy">` : '<pre>  JOURNAL</pre>'}</figure>
          <div><small>${esc(p.category)} · ${esc(fmtDate(p.date))}</small><b>${esc(p.title)}</b>
          ${p.status === 'draft' ? '<span class="tag">Draft — not listed</span>' : '<span class="tag tag--ok">Published</span>'}
          <div class="row"><a class="btn btn--sm btn--red" href="#/posts/edit/${encodeURIComponent(p.slug)}">Edit</a>
          <a class="btn btn--sm" href="${esc(SITE_BASE)}posts/${esc(p.slug)}.html" target="_blank" rel="noopener">View</a>
          <button class="btn btn--sm btn--danger" type="button" data-del="${esc(p.slug)}">Delete</button></div></div></div>`).join('')}</div>`
        : '<div class="empty">No posts yet. Start with something riders in Kushtia ask about every week.</div>');
    main.addEventListener('click', async e => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      const p = reg.posts.find(x => x.slug === d.dataset.del);
      if (!(await confirmBox(`Delete “${p.title}”?`, 'The post is removed from the site and the Journal page.'))) return;
      const r = await task('Deleting the post…', async () => {
        const fresh = await readJSON(POSTS, { posts: [] });
        fresh.posts = fresh.posts.filter(x => x.slug !== p.slug);
        await publishPosts(fresh, [{ path: `posts/${p.slug}.html`, delete: true }], `Studio: delete post ${p.slug}`, [], [`posts/${p.slug}.html`]);
        return null;
      });
      if (r === null) { toast('Post deleted'); route(); }
    });
  };

  async function publishPosts(reg, changes, message, addUrls, removeUrls) {
    const shell = await themeShell();
    changes.push({ path: POSTS, content: json(reg) });
    changes.push({ path: 'blog.html', content: build(shell, { title: 'Journal', description: 'Riding tips, maintenance how-tos, new stock and offers from Moto Market, Kushtia.', path: 'blog.html', body: journalBody(reg.posts), kind: 'journal', depth: 0 }) });
    const sm = await sitemapChange(['blog.html', ...addUrls], removeUrls); if (sm) changes.push(sm);
    await commit(changes, message);
  }

  async function postEditor(main, slug) {
    const reg = await readJSON(POSTS, { posts: [] });
    const p = slug ? reg.posts.find(x => x.slug === slug) : { title: '', slug: '', date: today(), category: CATS[0], excerpt: '', cover: '', coverAlt: '', body: '', status: 'published' };
    if (!p) throw new Error('That post does not exist.');
    const shell = await themeShell();
    main.innerHTML = head(slug ? `Edit · ${p.title}` : 'New post', 'The template sets the layout: title, date, cover, story and a booking call-to-action at the end. Write the story in plain text; the buttons above it add headings, lists and links.',
      '<a class="btn" href="#/posts">Back to posts</a>') +
      `<div class="editor"><form class="panel form" data-f>
        <label>Title <input name="title" required maxlength="100" value="${esc(p.title)}"></label>
        <div class="two"><label>Address <input name="slug" required pattern="[a-z0-9\\-]{2,60}" value="${esc(p.slug)}" ${slug ? 'readonly' : ''}></label>
        <label>Date <input name="date" type="date" required value="${esc(p.date)}"></label></div>
        <div class="two"><label>Category <input name="category" list="post-cats" required value="${esc(p.category)}"><datalist id="post-cats">${CATS.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label>
        <label>Status <select name="status"><option value="published"${p.status !== 'draft' ? ' selected' : ''}>Published — listed in the Journal</option><option value="draft"${p.status === 'draft' ? ' selected' : ''}>Draft — hidden from the Journal</option></select></label></div>
        <label>Summary <textarea name="excerpt" maxlength="220" style="min-height:4.5rem" placeholder="One or two sentences. Shown on the Journal page and to Google.">${esc(p.excerpt)}</textarea></label>
        <div class="two"><label>Cover image <input name="coverFile" type="file" accept="${IMG_TYPES.join(',')}"></label>
        <label>Cover description <input name="coverAlt" value="${esc(p.coverAlt || '')}" placeholder="What is in the picture"></label></div>
        <p class="hint">${p.cover ? `Current cover: <code>${esc(p.cover)}</code>` : 'No cover yet. A 1600 × 900 photo works best.'}</p>
        <div class="row" data-tools>
          <button class="btn btn--sm" type="button" data-md="## ">Heading</button>
          <button class="btn btn--sm" type="button" data-md="**|**">Bold</button>
          <button class="btn btn--sm" type="button" data-md="- ">List</button>
          <button class="btn btn--sm" type="button" data-md="> ">Quote</button>
          <button class="btn btn--sm" type="button" data-md="[|](https://)">Link</button>
          <button class="btn btn--sm" type="button" data-img>Photo…</button>
          <input type="file" accept="${IMG_TYPES.join(',')}" hidden data-imgfile>
        </div>
        <label>Story <textarea name="body" required style="min-height:20rem" placeholder="Leave an empty line between paragraphs.">${esc(p.body)}</textarea></label>
        <div class="row"><button class="btn btn--red" type="submit">${slug ? 'Publish changes' : 'Publish post'}</button><p class="hint" data-msg></p></div>
      </form>
      <div class="preview"><p>Live preview · post template</p><iframe title="Preview" data-pv></iframe></div></div>`;
    const f = $('[data-f]', main), pv = $('[data-pv]', main);
    let coverPreview = null, pendingCover = null;
    const bodyImages = [];
    let slugTouched = !!slug, t;
    f.slug.addEventListener('input', () => { slugTouched = true; });
    const current = () => ({ ...p, title: f.title.value.trim() || 'Untitled', slug: f.slug.value, date: f.date.value || today(), category: f.category.value.trim() || CATS[0],
      excerpt: f.excerpt.value.trim(), coverAlt: f.coverAlt.value.trim(), body: f.body.value, status: f.status.value });
    const refresh = () => {
      if (!slugTouched) f.slug.value = slugify(f.title.value);
      clearTimeout(t);
      t = setTimeout(() => {
        const c = current();
        if (coverPreview) c.cover = coverPreview;
        let html = build(shell, { title: c.title, description: c.excerpt, path: `posts/${c.slug}.html`, body: postBody(c, ME.name), kind: 'post', depth: 1 });
        bodyImages.forEach(b => { html = html.split(b.path).join(b.url); });
        showPreview(pv, html);
      }, 350);
    };
    f.addEventListener('input', refresh);
    f.coverFile.addEventListener('change', () => {
      pendingCover = f.coverFile.files[0] || null;
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      coverPreview = pendingCover ? URL.createObjectURL(pendingCover) : null;
      refresh();
    });
    refresh();

    const ta = f.body;
    $('[data-tools]', main).addEventListener('click', e => {
      const b = e.target.closest('[data-md]');
      if (b) {
        const [pre, post = ''] = b.dataset.md.split('|');
        const s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(s, en);
        const lineStart = !post && s > 0 && ta.value[s - 1] !== '\n' ? '\n\n' : '';
        ta.setRangeText(lineStart + pre + sel + post, s, en, 'end');
        ta.focus();
        refresh();
      }
      if (e.target.closest('[data-img]')) $('[data-imgfile]', main).click();
    });
    $('[data-imgfile]', main).addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const up = await uploadChange(file, 'posts');
        bodyImages.push({ ...up, url: URL.createObjectURL(file) });
        ta.setRangeText(`\n\n![${file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}](${up.path})\n\n`, ta.selectionStart, ta.selectionEnd, 'end');
        refresh();
        toast('Photo added. It uploads when you publish.');
      } catch (err) { toast(err.message, true); }
    });

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const c = current();
      const r = await task('Publishing the post…', async () => {
        const fresh = await readJSON(POSTS, { posts: [] });
        if (!slug && fresh.posts.some(x => x.slug === c.slug)) return 'A post with that address exists. Change the address.';
        const changes = [];
        if (pendingCover) { const up = await uploadChange(pendingCover, 'posts'); c.cover = up.path; changes.push(up.change); }
        bodyImages.filter(b => c.body.includes(b.path)).forEach(b => changes.push(b.change));
        const now = new Date().toISOString();
        const entry = { slug: c.slug, title: c.title, date: c.date, category: c.category, excerpt: c.excerpt, cover: c.cover || '', coverAlt: c.coverAlt,
          body: c.body, status: c.status, author: p.author || ME.name, updated: now, created: p.created || now };
        const i = fresh.posts.findIndex(x => x.slug === c.slug);
        if (i >= 0) fresh.posts[i] = entry; else fresh.posts.push(entry);
        const path = `posts/${c.slug}.html`;
        let html = build(await themeShell(), { title: c.title, description: c.excerpt, path, body: postBody(entry, entry.author), kind: 'post', depth: 1 });
        if (c.status === 'draft') html = html.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
        changes.push({ path, content: html });
        await publishPosts(fresh, changes, `Studio: ${slug ? 'update' : 'publish'} post ${c.slug}`, c.status === 'draft' ? [] : [path], c.status === 'draft' ? [path] : []);
        return null;
      });
      if (r) return formMsg(f, r, 'error');
      if (r === null) { toast('Published. Live in about a minute.'); location.hash = '#/posts'; }
    });
  }

  start();
})();
