/* =========================================================================
 * app.js — Ai Mini-Mart staff/POS single-page admin (vanilla JS).
 * Auth → permission-gated nav → views (POS, Products, Bills, Reports,
 * Staff, Printer). Server enforces all permissions; the UI only hides.
 * ========================================================================= */

// ---- money (mirror of backend src/lib/currency.js) ----------------------
const RATES = { THB: 1, KHR: 114 };
const CUR = {
  THB: { symbol: '฿', decimals: 2, position: 'before' },
  KHR: { symbol: '៛', decimals: 0, position: 'after' },
};
function fmtMinor(minor, code = 'THB') {
  const cfg = CUR[code] || CUR.THB;
  const value = (Number(minor) / 100) * (RATES[code] ?? 1);
  const num = value.toLocaleString('en-US', { minimumFractionDigits: cfg.decimals, maximumFractionDigits: cfg.decimals });
  return cfg.position === 'after' ? `${num} ${cfg.symbol}` : `${cfg.symbol}${num}`;
}

// ---- tiny DOM + util helpers --------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d).toLocaleString('en-GB', { hour12: false }).replace(',', '');
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---- app state ----------------------------------------------------------
const state = { user: null, permissions: [], route: 'pos', cart: [], currency: 'THB', categories: [] };
const can = (perm) => state.permissions.includes(perm);

// Categories come from the DB now (staff-editable). Cache them; pass force=true
// after a change to refresh.
async function loadCategories(force = false) {
  if (!force && state.categories.length) return state.categories;
  try {
    const { categories } = await API.get('/categories');
    state.categories = categories;
  } catch {
    state.categories = [];
  }
  return state.categories;
}

function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// ---- modal --------------------------------------------------------------
function openModal(title, bodyNode) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(bodyNode);
  $('#modal-root').hidden = false;
}
function closeModal() { $('#modal-root').hidden = true; }
$('#modal-root').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function node(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// =========================================================================
// AUTH
// =========================================================================
async function boot() {
  try {
    const { user } = await API.get('/auth/me');
    onAuthed(user);
  } catch {
    showLogin();
  }
}
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}
function onAuthed(user) {
  state.user = user;
  state.permissions = user.permissions || [];
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#whoami').textContent = `${user.name} · ${user.role}`;
  buildNav();
  applyNavCollapsed();
  // pick a default route the user is allowed to see
  const first = $$('.navlink').find((a) => !a.hidden);
  go(first ? first.dataset.route : 'pos');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#login-error').hidden = true;
  try {
    const { user } = await API.post('/auth/login', { username: f.username.value, password: f.password.value });
    onAuthed(user);
    f.reset();
  } catch (err) {
    const box = $('#login-error');
    box.textContent = err.message;
    box.hidden = false;
  }
});
$('#logout').addEventListener('click', async () => { await API.post('/auth/logout'); location.reload(); });

// ---- nav ----------------------------------------------------------------
function buildNav() {
  $$('.navlink').forEach((a) => {
    const perm = a.dataset.perm;
    a.hidden = perm && !can(perm) && !(perm === 'bills:read:own' && can('bills:read'));
    a.onclick = () => go(a.dataset.route);
  });
}
// ☰ toggles the off-canvas drawer on mobile, and collapses to an icon rail on
// desktop (persisted across reloads).
const NAV_KEY = 'mymart.navCollapsed';
function applyNavCollapsed() {
  $('#sidenav').classList.toggle('collapsed', localStorage.getItem(NAV_KEY) === '1');
}
$('#nav-toggle').addEventListener('click', () => {
  const sidenav = $('#sidenav');
  if (window.matchMedia('(max-width: 820px)').matches) {
    sidenav.classList.toggle('open');
  } else {
    const collapsed = sidenav.classList.toggle('collapsed');
    localStorage.setItem(NAV_KEY, collapsed ? '1' : '0');
  }
});

function go(route) {
  state.route = route;
  $$('.navlink').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  $('#sidenav').classList.remove('open');
  const view = $('#view');
  view.innerHTML = '<div class="empty">Loading…</div>';
  ({ pos: renderPOS, products: renderProducts, categories: renderCategories, bills: renderBills, reports: renderReports, staff: renderStaff, printers: renderPrinters }[route] || renderPOS)(view);
}

// =========================================================================
// POS — Make Bill
// =========================================================================
function renderPOS(view) {
  state.cart = state.cart || [];
  view.innerHTML = `
    <div class="page-head"><h2>🧾 Make Bill</h2></div>
    <div class="pos">
      <section>
        <div class="card" style="padding:1rem">
          <form id="scan-form" class="toolbar" style="margin:0">
            <input id="scan" class="grow" placeholder="Scan barcode / type barcode or SKU, press Enter" autocomplete="off" />
            <button class="btn btn-primary">Add</button>
          </form>
          <p id="scan-msg" class="error" hidden></p>
          <div class="toolbar" style="margin:.75rem 0 .5rem">
            <input id="psearch" class="grow" placeholder="Or search products by name…" autocomplete="off" />
          </div>
          <div id="pos-results" class="pos-results"></div>
        </div>
      </section>
      <aside>
        <div class="card" style="padding:1rem">
          <h3>Current bill</h3>
          <div id="cart"></div>
          <div class="form-row" style="margin-top:1rem">
            <div class="form-grid">
              <label>Currency
                <select id="pos-currency">
                  <option value="THB">THB (฿)</option>
                  <option value="KHR">KHR (៛)</option>
                </select>
              </label>
              <label>Payment
                <select id="pos-payment"><option value="CASH">Cash</option><option value="OTHER">Other</option></select>
              </label>
              <label class="full">Customer name (optional)
                <input id="pos-customer" placeholder="Walk-in" />
              </label>
            </div>
          </div>
          <button id="charge" class="btn btn-primary btn-block">Charge &amp; Save bill</button>
        </div>
      </aside>
    </div>`;

  const scan = $('#scan', view);
  scan.focus();
  $('#pos-currency', view).value = state.currency;
  $('#pos-currency', view).onchange = (e) => { state.currency = e.target.value; drawCart(); };

  $('#scan-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = scan.value.trim();
    if (!code) return;
    const msg = $('#scan-msg', view);
    msg.hidden = true;
    try {
      const { variant, product } = await API.get(`/products/lookup?code=${encodeURIComponent(code)}`);
      addToCart(variant, product);
      scan.value = '';
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
    scan.focus();
  });

  const results = $('#pos-results', view);
  const doSearch = debounce(async (q) => {
    if (!q) { results.innerHTML = ''; return; }
    try {
      const { products } = await API.get(`/products?search=${encodeURIComponent(q)}`);
      // flatten to one selectable row per variant
      const rows = [];
      products.forEach((p) => (p.variants || []).forEach((vr) => rows.push({ p, vr })));
      results.innerHTML = rows.length
        ? rows.map((r, i) => `
          <div class="pos-prod" data-i="${i}">
            <img class="thumb" src="${esc(r.vr.imageUrl || r.p.imageUrl || '')}" onerror="this.style.visibility='hidden'" />
            <div class="nm">${esc(r.p.name)} — ${esc(r.vr.name)}<small>${esc(r.vr.barcode || '')} · ${fmtMinor(r.vr.sellPriceMinor, state.currency)}</small></div>
            <span class="badge ${r.vr.inStock ? 'in' : 'out'}">${r.vr.inStock ? 'in stock' : 'out'}</span>
          </div>`).join('')
        : '<div class="empty">No matches.</div>';
      $$('.pos-prod', results).forEach((el) => {
        const r = rows[Number(el.dataset.i)];
        el.onclick = () => addToCart(r.vr, r.p);
      });
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#psearch', view).addEventListener('input', (e) => doSearch(e.target.value.trim()));

  $('#charge', view).addEventListener('click', charge);
  drawCart();
}

function addToCart(variant, product) {
  if (!variant.inStock) return toast(`"${variant.name}" is marked out of stock.`, 'err');
  const name = `${product.name} — ${variant.name}`;
  const line = state.cart.find((l) => l.variantId === variant.id);
  if (line) line.qty += 1;
  else state.cart.push({ variantId: variant.id, name, unitPriceMinor: variant.sellPriceMinor, qty: 1 });
  toast(`Added ${name}`);
  drawCart();
}

function drawCart() {
  const box = $('#cart');
  if (!box) return;
  if (!state.cart.length) { box.innerHTML = '<div class="empty">Scan or search to add items.</div>'; updateTotals(); return; }
  box.innerHTML = state.cart.map((l, i) => `
    <div class="cart-line">
      <div>${esc(l.name)}<br/><small class="muted">${fmtMinor(l.unitPriceMinor, state.currency)}</small></div>
      <div class="qty-ctl">
        <button class="btn btn-sm" data-act="dec" data-i="${i}">−</button>
        <input type="number" min="1" value="${l.qty}" data-act="set" data-i="${i}" />
        <button class="btn btn-sm" data-act="inc" data-i="${i}">+</button>
      </div>
      <div style="text-align:right;white-space:nowrap">
        ${fmtMinor(l.unitPriceMinor * l.qty, state.currency)}
        <button class="btn btn-sm btn-danger" data-act="rm" data-i="${i}">✕</button>
      </div>
    </div>`).join('') + `<div id="totals" style="margin-top:.6rem"></div>`;

  box.querySelectorAll('[data-act]').forEach((el) => {
    const i = Number(el.dataset.i);
    const act = el.dataset.act;
    if (act === 'set') el.onchange = () => setQty(i, Number(el.value));
    else el.onclick = () => ({ inc: () => setQty(i, state.cart[i].qty + 1), dec: () => setQty(i, state.cart[i].qty - 1), rm: () => { state.cart.splice(i, 1); drawCart(); } }[act]());
  });
  updateTotals();
}
function setQty(i, q) {
  const l = state.cart[i];
  if (!l) return;
  l.qty = Math.max(1, q || 1);
  drawCart();
}
function updateTotals() {
  const el = $('#totals');
  if (!el) return;
  const subtotal = state.cart.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);
  el.innerHTML = `
    <div class="totebar"><span class="muted">Items</span><span>${state.cart.reduce((s, l) => s + l.qty, 0)}</span></div>
    <div class="totebar grand"><span>Total</span><span>${fmtMinor(subtotal, state.currency)}</span></div>`;
}

async function charge() {
  if (!state.cart.length) return toast('Add at least one item.', 'err');
  const btn = $('#charge');
  btn.disabled = true;
  try {
    const payload = {
      items: state.cart.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      paymentMethod: $('#pos-payment').value,
      customerName: $('#pos-customer').value.trim() || undefined,
      currency: state.currency,
    };
    const { bill } = await API.post('/bills', payload);
    toast(`Saved ${bill.billNo}`, 'ok');
    state.cart = [];
    drawCart();
    if (can('printers:read')) window.open(`/api/bills/${bill.id}/receipt?print=1`, '_blank');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

// =========================================================================
// PRODUCTS
// =========================================================================
async function renderProducts(view) {
  await loadCategories();
  view.innerHTML = `
    <div class="page-head">
      <h2>📦 Products</h2><div class="spacer"></div>
      ${can('products:write') ? '<button id="add-prod" class="btn btn-primary">+ Add product</button>' : ''}
    </div>
    <div class="toolbar">
      <input id="p-search" class="grow" placeholder="Search name, SKU, barcode…" />
      <select id="p-cat"><option value="">All categories</option>${state.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.label)}</option>`).join('')}</select>
      <select id="p-stock"><option value="">Any stock</option><option value="in">In stock</option><option value="out">Out of stock</option></select>
    </div>
    <p class="muted" style="margin:-.5rem 0 1rem;font-size:.8rem">Drag the ⠿ handle to set the order products appear in the storefront (top = first). Reordering is off while a search or filter is active.</p>
    <div id="p-table" class="table-wrap"></div>`;

  const load = async () => {
    const search = $('#p-search', view).value.trim();
    const cat = $('#p-cat', view).value;
    const stock = $('#p-stock', view).value;
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (cat) qs.set('category', cat);
    if (stock) qs.set('stock', stock);
    const { products } = await API.get(`/products?${qs.toString()}`);
    drawProducts(products, { reorderable: !search && !cat && !stock, reload: load });
  };
  $('#p-search', view).addEventListener('input', debounce(load, 250));
  $('#p-cat', view).onchange = load;
  $('#p-stock', view).onchange = load;
  if (can('products:write')) $('#add-prod', view).onclick = () => productForm(null, load);
  load();
}

const fmtKhr = (riel) => `${Number(riel || 0).toLocaleString('en-US')} ៛`;

function drawProducts(products, { reorderable = false, reload = () => go('products') } = {}) {
  const canWrite = can('products:write');
  const canDrag = reorderable && canWrite;
  const wrap = $('#p-table');
  if (!products.length) { wrap.innerHTML = '<div class="empty">No products match.</div>'; return; }
  const handleTitle = reorderable ? 'Drag to reorder' : 'Clear search/filters to reorder';

  // One <tbody> per product (so its variant rows drag together as a group).
  wrap.innerHTML = `
    <table><thead><tr>
      <th></th><th></th><th>Item / Variant</th><th>Type</th><th class="num">Price</th>
      <th>Barcode</th><th>In stock</th><th>In store</th><th></th>
    </tr></thead>
    ${products.map((p) => `
      <tbody class="prod-group" data-id="${p.id}" ${canDrag ? 'draggable="true"' : ''}>
        <tr class="prod-row">
          <td class="drag-handle" aria-disabled="${!canDrag}" title="${handleTitle}">⠿</td>
          <td><img class="thumb" src="${esc(p.imageUrl || '')}" onerror="this.style.visibility='hidden'"/></td>
          <td><strong>${esc(p.name)}</strong><br/><small class="muted">${p.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</small></td>
          <td>${esc(p.unit || '')}</td>
          <td></td><td></td><td></td>
          <td>${can('storefront:toggle')
            ? `<label class="switch"><input type="checkbox" data-vis="${p.id}" ${p.isVisible ? 'checked' : ''}/><span class="slider"></span></label>`
            : `<span class="badge ${p.isVisible ? 'in' : 'muted'}">${p.isVisible ? 'on' : 'off'}</span>`}</td>
          <td><div class="row-actions">
            ${canWrite ? `<button class="btn btn-sm" data-edit="${p.id}">Edit</button>` : ''}
            ${can('products:delete') ? `<button class="btn btn-sm btn-danger" data-del="${p.id}">Del</button>` : ''}
          </div></td>
        </tr>
        ${(p.variants || []).map((vr) => `
          <tr class="var-row">
            <td></td>
            <td><img class="thumb sm" src="${esc(vr.imageUrl || '')}" onerror="this.style.visibility='hidden'"/></td>
            <td class="var-name">↳ ${esc(vr.name)}</td>
            <td></td>
            <td class="num">${fmtMinor(vr.sellPriceMinor, 'THB')}<br/><small class="muted">${fmtKhr(vr.sellPriceKhr)}</small></td>
            <td><small class="muted">${esc(vr.barcode || '—')}</small></td>
            <td>${canWrite
              ? `<label class="switch"><input type="checkbox" data-vstock="${vr.id}" ${vr.inStock ? 'checked' : ''}/><span class="slider"></span></label>`
              : `<span class="badge ${vr.inStock ? 'in' : 'out'}">${vr.inStock ? 'in' : 'out'}</span>`}</td>
            <td></td><td></td>
          </tr>`).join('')}
      </tbody>`).join('')}
    </table>`;

  wrap.querySelectorAll('[data-vstock]').forEach((el) => {
    el.onchange = async () => {
      try { await API.patch(`/products/variants/${el.dataset.vstock}/stock`, { inStock: el.checked }); toast(el.checked ? 'Variant in stock' : 'Variant out of stock'); }
      catch (err) { toast(err.message, 'err'); el.checked = !el.checked; }
    };
  });
  wrap.querySelectorAll('[data-vis]').forEach((el) => {
    el.onchange = async () => {
      try { await API.patch(`/products/${el.dataset.vis}/visibility`, { isVisible: el.checked }); toast('Visibility updated'); }
      catch (err) { toast(err.message, 'err'); el.checked = !el.checked; }
    };
  });
  wrap.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = async () => {
    const { product } = await API.get(`/products/${el.dataset.edit}`);
    productForm(product, reload);
  }));
  wrap.querySelectorAll('[data-del]').forEach((el) => (el.onclick = async () => {
    if (!confirm('Delete (retire) this product? It will be hidden from the store and POS.')) return;
    try { await API.del(`/products/${el.dataset.del}`); toast('Product removed'); reload(); }
    catch (err) { toast(err.message, 'err'); }
  }));

  if (canDrag) wireReorder(wrap.querySelector('table'));
}

// HTML5 drag-and-drop reordering of product groups (<tbody>) -> PATCH /products/reorder.
function wireReorder(table) {
  let dragEl = null;
  table.querySelectorAll('tbody[draggable]').forEach((tb) => {
    tb.addEventListener('dragstart', (e) => { dragEl = tb; tb.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    tb.addEventListener('dragend', () => {
      tb.classList.remove('dragging');
      table.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
      dragEl = null;
    });
    tb.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === tb) return;
      const rect = tb.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      table.insertBefore(dragEl, before ? tb : tb.nextSibling);
    });
  });
  table.addEventListener('drop', async (e) => {
    e.preventDefault();
    const order = [...table.querySelectorAll('tbody[data-id]')].map((tb) => Number(tb.dataset.id));
    try { await API.patch('/products/reorder', { order }); toast('Order saved'); }
    catch (err) { toast(err.message, 'err'); go('products'); }
  });
}

function productForm(p, onSaved) {
  const isNew = !p;
  const tags = (p && p.tags) || [];
  const form = node(`<form>
    <div class="form-grid">
      <label class="full">Item name<input name="name" required value="${esc(p?.name || '')}"/></label>
      <label>Type / unit<input name="unit" placeholder="e.g. Unit, 250 g" value="${esc(p?.unit || '')}"/></label>
      <label class="full checks" style="align-self:end"><input type="checkbox" name="isVisible" ${p ? (p.isVisible ? 'checked' : '') : 'checked'}/> Show in store</label>
      <div class="full"><div class="muted" style="margin-bottom:.3rem">Categories</div>
        <div class="checks">${state.categories.length
          ? state.categories.map((c) => `<label><input type="checkbox" name="tags" value="${esc(c.slug)}" ${tags.includes(c.slug) ? 'checked' : ''}/>${esc(c.label)}</label>`).join('')
          : '<span class="muted">No categories yet — add some on the Categories page.</span>'}</div>
      </div>
      <div class="full">
        <div class="muted" style="margin-bottom:.3rem">Variants — each has its own price, barcode, image &amp; stock</div>
        <div class="variants" data-variants></div>
        <button type="button" class="btn btn-sm" data-add-variant>+ Add variant</button>
      </div>
    </div>
    <p class="error" data-err hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Cancel</button>
      <button class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button>
    </div>
  </form>`);
  form.querySelector('[data-close]').onclick = closeModal;

  // ---- variants editor (each variant is its own SKU) ----
  const variantsBox = form.querySelector('[data-variants]');
  const addVariantRow = (vr = {}) => {
    const row = node(`<div class="variant-card" data-vrow>
      <div class="variant-card-head">
        <input data-vname placeholder="Variant name e.g. Big" value="${esc(vr.name || '')}"/>
        <button type="button" class="btn btn-sm btn-danger" data-vremove title="Remove variant">✕</button>
      </div>
      <div class="variant-card-grid">
        <label>Barcode<input data-vbarcode placeholder="scan / type" value="${esc(vr.barcode || '')}"/></label>
        <label>Price (THB) ฿<input data-vthb type="number" step="0.01" min="0" value="${vr.sellPrice != null ? vr.sellPrice : ''}"/></label>
        <label>Price (KHR) ៛<input data-vkhr type="number" step="1" min="0" value="${vr.sellPriceKhr != null ? vr.sellPriceKhr : 0}"/></label>
        <label class="checks vstock"><input type="checkbox" data-vstock ${vr.inStock === false ? '' : 'checked'}/> In stock</label>
        <div class="vimg">
          <img class="img-preview" data-vpreview src="${esc(vr.imageUrl || '')}" onerror="this.style.visibility='hidden'" alt=""/>
          <input type="file" data-vfile accept="image/*"/>
        </div>
      </div>
    </div>`);
    row.dataset.imageUrl = vr.imageUrl || '';
    if (vr.id != null) row.dataset.vid = vr.id;
    const preview = row.querySelector('[data-vpreview]');
    if (!vr.imageUrl) preview.style.visibility = 'hidden';
    row.querySelector('[data-vfile]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) { preview.src = URL.createObjectURL(file); preview.style.visibility = 'visible'; }
    });
    row.querySelector('[data-vremove]').onclick = () => row.remove();
    variantsBox.appendChild(row);
  };
  const seed = (p?.variants && p.variants.length) ? p.variants : [{}];
  seed.forEach(addVariantRow);
  form.querySelector('[data-add-variant]').onclick = () => addVariantRow();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('[data-err]');
    errBox.hidden = true;
    const submitBtn = form.querySelector('.btn-primary');
    const fd = new FormData(form);
    const rows = [...variantsBox.querySelectorAll('[data-vrow]')].filter((r) => r.querySelector('[data-vname]').value.trim());
    if (!rows.length) { errBox.textContent = 'Add at least one variant.'; errBox.hidden = false; return; }

    submitBtn.disabled = true;
    try {
      // Upload any newly-picked variant images first, then fold the URLs in.
      const variants = [];
      for (const r of rows) {
        let imageUrl = r.dataset.imageUrl || '';
        const file = r.querySelector('[data-vfile]').files[0];
        if (file) {
          const imgFd = new FormData();
          imgFd.append('image', file);
          imageUrl = (await API.upload('/products/upload-image', imgFd)).imageUrl;
        }
        variants.push({
          id: r.dataset.vid || undefined,
          name: r.querySelector('[data-vname]').value.trim(),
          barcode: r.querySelector('[data-vbarcode]').value.trim(),
          imageUrl,
          sellPrice: r.querySelector('[data-vthb]').value || 0,
          sellPriceKhr: r.querySelector('[data-vkhr]').value || 0,
          inStock: r.querySelector('[data-vstock]').checked,
        });
      }
      const body = {
        name: fd.get('name'),
        unit: fd.get('unit'),
        isVisible: fd.get('isVisible') === 'on',
        tags: fd.getAll('tags'),
        variants,
      };
      if (isNew) await API.post('/products', body);
      else await API.patch(`/products/${p.id}`, body);
      toast(isNew ? 'Product created' : 'Product saved');
      closeModal();
      onSaved();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
  openModal(isNew ? 'Add product' : 'Edit product', form);
}

// =========================================================================
// CATEGORIES (editable; owner only)
// =========================================================================
async function renderCategories(view) {
  view.innerHTML = `
    <div class="page-head"><h2>🏷️ Categories</h2><div class="spacer"></div>
      <button id="add-cat" class="btn btn-primary">+ Add category</button></div>
    <p class="muted" style="margin:-.5rem 0 1rem;font-size:.85rem">Categories drive the storefront filters. Drag order is set by the Sort field. Removing a category just unlists it — products keep working.</p>
    <div id="c-table" class="table-wrap"></div>`;
  const load = async () => {
    await loadCategories(true);
    const wrap = $('#c-table', view);
    if (!state.categories.length) { wrap.innerHTML = '<div class="empty">No categories yet.</div>'; return; }
    wrap.innerHTML = `
      <table><thead><tr><th>Icon</th><th>Label</th><th>Slug</th><th class="num">Sort</th><th></th></tr></thead>
      <tbody>${state.categories.map((c) => `
        <tr>
          <td style="font-size:1.2rem">${esc(c.icon || '')}</td>
          <td><strong>${esc(c.label)}</strong></td>
          <td><small class="muted">${esc(c.slug)}</small></td>
          <td class="num">${c.sortOrder}</td>
          <td><div class="row-actions">
            <button class="btn btn-sm" data-edit="${c.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del="${c.id}">Del</button>
          </div></td>
        </tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () =>
      categoryForm(state.categories.find((x) => x.id === Number(el.dataset.edit)), load)));
    wrap.querySelectorAll('[data-del]').forEach((el) => (el.onclick = async () => {
      if (!confirm('Remove this category? Products tagged with it keep working; it just disappears from the list.')) return;
      try { await API.del(`/categories/${el.dataset.del}`); toast('Category removed'); load(); }
      catch (err) { toast(err.message, 'err'); }
    }));
  };
  $('#add-cat', view).onclick = () => categoryForm(null, load);
  load();
}

function categoryForm(c, onSaved) {
  const isNew = !c;
  const form = node(`<form>
    <div class="form-grid">
      <label class="full">Label<input name="label" required value="${esc(c?.label || '')}" placeholder="e.g. Beverages"/></label>
      <label>Icon (emoji)<input name="icon" value="${esc(c?.icon || '')}" placeholder="🥤" maxlength="4"/></label>
      <label>Sort order<input name="sortOrder" type="number" min="0" value="${c ? c.sortOrder : 0}"/></label>
      ${isNew ? '' : `<label class="full">Slug<input name="slug" value="${esc(c.slug)}"/></label>`}
    </div>
    <p class="muted" style="font-size:.8rem">${isNew ? 'The slug is generated from the label.' : 'Changing the slug will unlink products tagged with the old slug.'}</p>
    <p class="error" data-err hidden></p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button></div>
  </form>`);
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('[data-err]');
    errBox.hidden = true;
    const fd = new FormData(form);
    const body = { label: fd.get('label'), icon: fd.get('icon'), sortOrder: fd.get('sortOrder') };
    if (!isNew) body.slug = fd.get('slug');
    try {
      if (isNew) await API.post('/categories', body); else await API.patch(`/categories/${c.id}`, body);
      toast(isNew ? 'Category created' : 'Category saved');
      closeModal();
      onSaved();
    } catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
  });
  openModal(isNew ? 'Add category' : 'Edit category', form);
}

// =========================================================================
// BILL HISTORY
// =========================================================================
async function renderBills(view) {
  const canAll = can('bills:read');
  let staffList = [];
  if (can('staff:manage')) { try { staffList = (await API.get('/staff')).staff; } catch {} }
  view.innerHTML = `
    <div class="page-head"><h2>🗂️ Bill History</h2></div>
    <div class="toolbar">
      <label class="muted">From <input id="b-from" type="date"/></label>
      <label class="muted">To <input id="b-to" type="date"/></label>
      ${canAll && staffList.length ? `<select id="b-staff"><option value="">All staff</option>${staffList.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>` : ''}
      <button id="b-go" class="btn btn-primary">Filter</button>
    </div>
    <div id="b-table" class="table-wrap"></div>`;

  const load = async () => {
    const qs = new URLSearchParams();
    if ($('#b-from', view).value) qs.set('from', $('#b-from', view).value);
    if ($('#b-to', view).value) qs.set('to', $('#b-to', view).value);
    if ($('#b-staff', view) && $('#b-staff', view).value) qs.set('staffId', $('#b-staff', view).value);
    const { bills } = await API.get(`/bills?${qs.toString()}`);
    const wrap = $('#b-table', view);
    if (!bills.length) { wrap.innerHTML = '<div class="empty">No bills found.</div>'; return; }
    wrap.innerHTML = `
      <table><thead><tr><th>Bill</th><th>Date</th><th>Staff</th><th class="num">Items</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${bills.map((b) => `
        <tr>
          <td><strong>${esc(b.billNo)}</strong></td>
          <td>${esc(fmtDate(b.createdAt))}</td>
          <td>${esc(b.staff?.name || '—')}</td>
          <td class="num">${b.items.reduce((s, it) => s + it.qty, 0)}</td>
          <td class="num">${fmtMinor(b.totalMinor, b.currency)}</td>
          <td><span class="badge ${b.status === 'PAID' ? 'in' : 'muted'}">${esc(b.status)}</span></td>
          <td><div class="row-actions">
            <button class="btn btn-sm" data-view="${b.id}">View</button>
            ${can('printers:read') ? `<button class="btn btn-sm" data-print="${b.id}">Reprint</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('[data-view]').forEach((el) => (el.onclick = () => billDetail(el.dataset.view)));
    wrap.querySelectorAll('[data-print]').forEach((el) => (el.onclick = () => window.open(`/api/bills/${el.dataset.print}/receipt?print=1`, '_blank')));
  };
  $('#b-go', view).onclick = load;
  load();
}

async function billDetail(id) {
  const { bill } = await API.get(`/bills/${id}`);
  const body = node(`<div>
    <p><strong>${esc(bill.billNo)}</strong> · ${esc(fmtDate(bill.createdAt))}<br/>
       <span class="muted">Cashier: ${esc(bill.staff?.name || '—')} · Payment: ${esc(bill.paymentMethod)} ${bill.customerName ? '· ' + esc(bill.customerName) : ''}</span></p>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line</th></tr></thead>
    <tbody>${bill.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="num">${it.qty}</td><td class="num">${fmtMinor(it.unitPriceMinor, bill.currency)}</td><td class="num">${fmtMinor(it.lineTotalMinor, bill.currency)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th colspan="3">Total</th><th class="num">${fmtMinor(bill.totalMinor, bill.currency)}</th></tr></tfoot></table></div>
    <div class="modal-actions">
      ${can('printers:read') ? `<button class="btn" id="rp">Reprint receipt</button>` : ''}
      <button class="btn btn-primary" data-close>Close</button>
    </div></div>`);
  body.querySelector('[data-close]').onclick = closeModal;
  if (body.querySelector('#rp')) body.querySelector('#rp').onclick = () => window.open(`/api/bills/${bill.id}/receipt?print=1`, '_blank');
  openModal('Bill detail', body);
}

// =========================================================================
// REPORTS
// =========================================================================
async function renderReports(view) {
  view.innerHTML = `
    <div class="page-head"><h2>📊 Reports</h2></div>
    <div class="toolbar">
      <select id="r-period"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select>
      <label class="muted">From <input id="r-from" type="date"/></label>
      <label class="muted">To <input id="r-to" type="date"/></label>
      <select id="r-cur"><option value="THB">THB</option><option value="KHR">KHR</option></select>
      <button id="r-go" class="btn btn-primary">Run</button>
    </div>
    <div id="r-body"></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ period: $('#r-period', view).value, currency: $('#r-cur', view).value });
    if ($('#r-from', view).value) qs.set('from', $('#r-from', view).value);
    if ($('#r-to', view).value) qs.set('to', $('#r-to', view).value);
    const r = await API.get(`/reports?${qs.toString()}`);
    $('#r-body', view).innerHTML = `
      <div class="stat-grid">
        <div class="card stat"><div class="k">Total sales</div><div class="v">${esc(r.summary.totalDisplay)}</div></div>
        <div class="card stat"><div class="k">Bills</div><div class="v">${r.summary.billCount}</div></div>
        <div class="card stat"><div class="k">Items sold</div><div class="v">${r.summary.itemsSold}</div></div>
        <div class="card stat"><div class="k">Avg bill</div><div class="v">${esc(r.summary.averageBillDisplay)}</div></div>
      </div>
      <div class="pos" style="grid-template-columns:1fr 1fr">
        <div><h3>By ${esc(r.period)}</h3><div class="table-wrap"><table><thead><tr><th>Period</th><th class="num">Bills</th><th class="num">Items</th><th class="num">Sales</th></tr></thead>
          <tbody>${r.buckets.length ? r.buckets.map((b) => `<tr><td>${esc(b.bucket)}</td><td class="num">${b.billCount}</td><td class="num">${b.itemsSold}</td><td class="num">${esc(b.salesDisplay)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No sales in range.</td></tr>'}</tbody></table></div></div>
        <div><h3>Top products</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead>
          <tbody>${r.topProducts.length ? r.topProducts.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.qty}</td><td class="num">${esc(t.salesDisplay)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">—</td></tr>'}</tbody></table></div></div>
      </div>`;
  };
  $('#r-go', view).onclick = load;
  load();
}

// =========================================================================
// STAFF
// =========================================================================
async function renderStaff(view) {
  view.innerHTML = `
    <div class="page-head"><h2>👥 Staff</h2><div class="spacer"></div><button id="add-staff" class="btn btn-primary">+ Add staff</button></div>
    <div id="s-table" class="table-wrap"></div>`;
  const load = async () => {
    const { staff } = await API.get('/staff');
    $('#s-table', view).innerHTML = `
      <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${staff.map((s) => `
        <tr><td>${esc(s.name)}</td><td>${esc(s.username)}</td><td><span class="badge ${s.role === 'OWNER' ? 'in' : 'muted'}">${esc(s.role)}</span></td>
        <td><span class="badge ${s.active ? 'in' : 'out'}">${s.active ? 'active' : 'inactive'}</span></td>
        <td><div class="row-actions"><button class="btn btn-sm" data-edit="${s.id}">Edit</button></div></td></tr>`).join('')}</tbody></table>`;
    $$('[data-edit]', $('#s-table', view)).forEach((el) => (el.onclick = () => staffForm(staff.find((x) => x.id === Number(el.dataset.edit)), load)));
  };
  $('#add-staff', view).onclick = () => staffForm(null, load);
  load();
}

function staffForm(s, onSaved) {
  const isNew = !s;
  const form = node(`<form>
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${esc(s?.name || '')}"/></label>
      <label>Username<input name="username" required value="${esc(s?.username || '')}" ${isNew ? '' : 'readonly'}/></label>
      <label>Role<select name="role"><option value="STAFF" ${s?.role === 'STAFF' ? 'selected' : ''}>Staff</option><option value="OWNER" ${s?.role === 'OWNER' ? 'selected' : ''}>Owner</option></select></label>
      <label class="full">${isNew ? 'Password' : 'New password (leave blank to keep)'}<input name="password" type="password" ${isNew ? 'required' : ''} minlength="6"/></label>
      ${isNew ? '' : `<label class="full checks"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}/> Active</label>`}
    </div>
    <p class="error" data-err hidden></p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button></div>
  </form>`);
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('[data-err]');
    errBox.hidden = true;
    const fd = new FormData(form);
    const body = { name: fd.get('name'), role: fd.get('role') };
    if (isNew) { body.username = fd.get('username'); body.password = fd.get('password'); }
    else { body.active = fd.get('active') === 'on'; if (fd.get('password')) body.password = fd.get('password'); }
    try {
      if (isNew) await API.post('/staff', body); else await API.patch(`/staff/${s.id}`, body);
      toast(isNew ? 'Staff created' : 'Staff saved');
      closeModal();
      onSaved();
    } catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
  });
  openModal(isNew ? 'Add staff' : 'Edit staff', form);
}

// =========================================================================
// PRINTER SETTINGS
// =========================================================================
async function renderPrinters(view) {
  const canManage = can('printers:manage');
  view.innerHTML = `
    <div class="page-head"><h2>🖨️ Printer Settings</h2><div class="spacer"></div>${canManage ? '<button id="add-pr" class="btn btn-primary">+ Add printer</button>' : ''}</div>
    <p class="muted">v1 “print” = a browser-printed HTML receipt sized to the chosen paper width. ESC/POS integration is a future extension.</p>
    <div id="pr-table" class="table-wrap"></div>`;
  const load = async () => {
    const { printers } = await API.get('/printers');
    $('#pr-table', view).innerHTML = printers.length ? `
      <table><thead><tr><th>Name</th><th>Paper</th><th>Type</th><th>Default</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${printers.map((p) => `
        <tr><td>${esc(p.name)}</td><td>${esc(p.paperWidth)}</td><td>${esc(p.type)}</td>
        <td>${p.isDefault ? '<span class="badge in">default</span>' : (canManage ? `<button class="btn btn-sm" data-def="${p.id}">Set default</button>` : '')}</td>
        ${canManage ? `<td><div class="row-actions"><button class="btn btn-sm" data-edit="${p.id}">Edit</button><button class="btn btn-sm btn-danger" data-del="${p.id}">Del</button></div></td>` : ''}</tr>`).join('')}</tbody></table>`
      : '<div class="empty">No printers configured.</div>';
    if (canManage) {
      $$('[data-def]', view).forEach((el) => (el.onclick = async () => { await API.patch(`/printers/${el.dataset.def}`, { isDefault: true }); toast('Default set'); load(); }));
      $$('[data-edit]', view).forEach((el) => (el.onclick = async () => { const { printers: ps } = await API.get('/printers'); printerForm(ps.find((x) => x.id === Number(el.dataset.edit)), load); }));
      $$('[data-del]', view).forEach((el) => (el.onclick = async () => { if (!confirm('Delete this printer?')) return; await API.del(`/printers/${el.dataset.del}`); toast('Deleted'); load(); }));
    }
  };
  if (canManage) $('#add-pr', view).onclick = () => printerForm(null, load);
  load();
}

function printerForm(p, onSaved) {
  const isNew = !p;
  const form = node(`<form>
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${esc(p?.name || '')}"/></label>
      <label>Paper width<select name="paperWidth">${['58mm', '80mm', 'A4'].map((w) => `<option ${p?.paperWidth === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
      <label>Type<select name="type">${['thermal', 'normal'].map((t) => `<option ${p?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="full">Header text<textarea name="headerText">${esc(p?.headerText || '')}</textarea></label>
      <label class="full">Footer text<textarea name="footerText">${esc(p?.footerText || '')}</textarea></label>
      <label class="full checks"><input type="checkbox" name="isDefault" ${p?.isDefault ? 'checked' : ''}/> Make default</label>
    </div>
    <p class="error" data-err hidden></p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button></div>
  </form>`);
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('[data-err]');
    errBox.hidden = true;
    const fd = new FormData(form);
    const body = { name: fd.get('name'), paperWidth: fd.get('paperWidth'), type: fd.get('type'), headerText: fd.get('headerText'), footerText: fd.get('footerText'), isDefault: fd.get('isDefault') === 'on' };
    try {
      if (isNew) await API.post('/printers', body); else await API.patch(`/printers/${p.id}`, body);
      toast('Saved');
      closeModal();
      onSaved();
    } catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
  });
  openModal(isNew ? 'Add printer' : 'Edit printer', form);
}

// ---- go ----
boot();
