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

const CATEGORIES = [
  ['electronics', 'Electronics'], ['home', 'Home'], ['apparel', 'Apparel'],
  ['accessories', 'Accessories'], ['tools', 'Tools'], ['grocery', 'Grocery'],
];

// ---- app state ----------------------------------------------------------
const state = { user: null, permissions: [], route: 'pos', cart: [], currency: 'THB' };
const can = (perm) => state.permissions.includes(perm);

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
$('#nav-toggle').addEventListener('click', () => $('#sidenav').classList.toggle('open'));

function go(route) {
  state.route = route;
  $$('.navlink').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  $('#sidenav').classList.remove('open');
  const view = $('#view');
  view.innerHTML = '<div class="empty">Loading…</div>';
  ({ pos: renderPOS, products: renderProducts, bills: renderBills, reports: renderReports, staff: renderStaff, printers: renderPrinters }[route] || renderPOS)(view);
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
      const { product } = await API.get(`/products/lookup?code=${encodeURIComponent(code)}`);
      addToCart(product);
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
      results.innerHTML = products.length
        ? products.map((p) => `
          <div class="pos-prod" data-id="${p.id}">
            <img class="thumb" src="${esc(p.imageUrl || '')}" onerror="this.style.visibility='hidden'" />
            <div class="nm">${esc(p.name)}<small>${esc(p.sku || '')} · ${fmtMinor(p.sellPriceMinor, state.currency)} · stock ${p.stockQty}</small></div>
            <span class="badge ${p.stockStatus}">${p.stockStatus}</span>
          </div>`).join('')
        : '<div class="empty">No matches.</div>';
      $$('.pos-prod', results).forEach((el) => {
        const p = products.find((x) => x.id === Number(el.dataset.id));
        el.onclick = () => addToCart(p);
      });
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#psearch', view).addEventListener('input', (e) => doSearch(e.target.value.trim()));

  $('#charge', view).addEventListener('click', charge);
  drawCart();
}

function addToCart(p) {
  if (p.stockQty <= 0) return toast(`"${p.name}" is out of stock.`, 'err');
  const line = state.cart.find((l) => l.productId === p.id);
  if (line) {
    if (line.qty + 1 > p.stockQty) return toast(`Only ${p.stockQty} in stock.`, 'err');
    line.qty += 1;
  } else {
    state.cart.push({ productId: p.id, name: p.name, unitPriceMinor: p.sellPriceMinor, qty: 1, stockQty: p.stockQty });
  }
  toast(`Added ${p.name}`);
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
  q = Math.max(1, Math.min(q || 1, l.stockQty));
  l.qty = q;
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
      items: state.cart.map((l) => ({ productId: l.productId, qty: l.qty })),
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
  view.innerHTML = `
    <div class="page-head">
      <h2>📦 Products</h2><div class="spacer"></div>
      ${can('products:write') ? '<button id="add-prod" class="btn btn-primary">+ Add product</button>' : ''}
    </div>
    <div class="toolbar">
      <input id="p-search" class="grow" placeholder="Search name, SKU, barcode…" />
      <select id="p-cat"><option value="">All categories</option>${CATEGORIES.map(([id, l]) => `<option value="${id}">${l}</option>`).join('')}</select>
      <select id="p-stock"><option value="">Any stock</option><option value="in">In stock</option><option value="low">Low</option><option value="out">Out</option></select>
    </div>
    <div id="p-table" class="table-wrap"></div>`;

  const load = async () => {
    const qs = new URLSearchParams();
    if ($('#p-search', view).value.trim()) qs.set('search', $('#p-search', view).value.trim());
    if ($('#p-cat', view).value) qs.set('category', $('#p-cat', view).value);
    if ($('#p-stock', view).value) qs.set('stock', $('#p-stock', view).value);
    const { products } = await API.get(`/products?${qs.toString()}`);
    drawProducts(products);
  };
  $('#p-search', view).addEventListener('input', debounce(load, 250));
  $('#p-cat', view).onchange = load;
  $('#p-stock', view).onchange = load;
  if (can('products:write')) $('#add-prod', view).onclick = () => productForm(null, load);
  load();
}

function drawProducts(products) {
  const showCost = can('products:cost');
  const wrap = $('#p-table');
  if (!products.length) { wrap.innerHTML = '<div class="empty">No products match.</div>'; return; }
  wrap.innerHTML = `
    <table><thead><tr>
      <th></th><th>Name</th><th>SKU / Barcode</th><th class="num">Sell</th>${showCost ? '<th class="num">Cost</th>' : ''}
      <th class="num">Stock</th><th>Status</th><th>In store</th><th></th>
    </tr></thead><tbody>
    ${products.map((p) => `
      <tr>
        <td><img class="thumb" src="${esc(p.imageUrl || '')}" onerror="this.style.visibility='hidden'"/></td>
        <td><strong>${esc(p.name)}</strong><br/><small class="muted">${esc(p.unit || '')} ${p.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</small></td>
        <td><small>${esc(p.sku || '—')}<br/>${esc(p.barcode || '—')}</small></td>
        <td class="num">${fmtMinor(p.sellPriceMinor, 'THB')}${p.comparePriceMinor ? `<br/><small class="muted" style="text-decoration:line-through">${fmtMinor(p.comparePriceMinor, 'THB')}</small>` : ''}</td>
        ${showCost ? `<td class="num">${fmtMinor(p.costPriceMinor, 'THB')}</td>` : ''}
        <td class="num">${p.stockQty}</td>
        <td><span class="badge ${p.stockStatus}">${p.stockStatus}</span></td>
        <td>${can('storefront:toggle')
          ? `<label class="switch"><input type="checkbox" data-vis="${p.id}" ${p.isVisible ? 'checked' : ''}/><span class="slider"></span></label>`
          : `<span class="badge ${p.isVisible ? 'in' : 'muted'}">${p.isVisible ? 'on' : 'off'}</span>`}</td>
        <td><div class="row-actions">
          ${can('products:write') ? `<button class="btn btn-sm" data-stock="${p.id}">Stock</button>` : ''}
          ${can('products:write') ? `<button class="btn btn-sm" data-edit="${p.id}">Edit</button>` : ''}
          ${can('products:delete') ? `<button class="btn btn-sm btn-danger" data-del="${p.id}">Del</button>` : ''}
        </div></td>
      </tr>`).join('')}
    </tbody></table>`;

  const reload = () => go('products');
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
  wrap.querySelectorAll('[data-stock]').forEach((el) => (el.onclick = async () => {
    const { product } = await API.get(`/products/${el.dataset.stock}`);
    stockForm(product, reload);
  }));
  wrap.querySelectorAll('[data-del]').forEach((el) => (el.onclick = async () => {
    if (!confirm('Delete (retire) this product? It will be hidden from the store and POS.')) return;
    try { await API.del(`/products/${el.dataset.del}`); toast('Product removed'); reload(); }
    catch (err) { toast(err.message, 'err'); }
  }));
}

function productForm(p, onSaved) {
  const isNew = !p;
  const showCost = can('products:cost');
  const tags = (p && p.tags) || [];
  const form = node(`<form>
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${esc(p?.name || '')}"/></label>
      <label>SKU<input name="sku" value="${esc(p?.sku || '')}"/></label>
      <label>Barcode<input name="barcode" value="${esc(p?.barcode || '')}"/></label>
      <label>Sell price (THB)<input name="sellPrice" type="number" step="0.01" min="0" required value="${p ? p.sellPrice : ''}"/></label>
      ${showCost ? `<label>Cost price (THB)<input name="costPrice" type="number" step="0.01" min="0" value="${p ? (p.costPrice ?? '') : ''}"/></label>` : ''}
      <label>Compare-at / was (THB)<input name="comparePrice" type="number" step="0.01" min="0" value="${p && p.comparePrice != null ? p.comparePrice : ''}"/></label>
      <label>Unit<input name="unit" placeholder="e.g. 250 g" value="${esc(p?.unit || '')}"/></label>
      <label>Stock qty<input name="stockQty" type="number" min="0" value="${p ? p.stockQty : 0}" ${p ? 'readonly title="Use the Stock button to adjust"' : ''}/></label>
      <label>Low-stock threshold<input name="lowStockThreshold" type="number" min="0" value="${p ? p.lowStockThreshold : 5}"/></label>
      <label class="full">Image URL<input name="imageUrl" value="${esc(p?.imageUrl || '')}" placeholder="https://… or upload below"/></label>
      ${p ? '<label class="full">Upload image<input name="imageFile" type="file" accept="image/*"/></label>' : ''}
      <div class="full"><div class="muted" style="margin-bottom:.3rem">Categories</div>
        <div class="checks">${CATEGORIES.map(([id, l]) => `<label><input type="checkbox" name="tags" value="${id}" ${tags.includes(id) ? 'checked' : ''}/>${l}</label>`).join('')}</div>
      </div>
      <label class="full checks"><input type="checkbox" name="isVisible" ${p ? (p.isVisible ? 'checked' : '') : 'checked'}/> Show in store</label>
    </div>
    <p class="error" data-err hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Cancel</button>
      <button class="btn btn-primary">${isNew ? 'Create' : 'Save'}</button>
    </div>
  </form>`);
  form.querySelector('[data-close]').onclick = closeModal;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('[data-err]');
    errBox.hidden = true;
    const fd = new FormData(form);
    const body = {
      name: fd.get('name'),
      sku: fd.get('sku'),
      barcode: fd.get('barcode'),
      sellPrice: fd.get('sellPrice'),
      comparePrice: fd.get('comparePrice') || null,
      unit: fd.get('unit'),
      lowStockThreshold: fd.get('lowStockThreshold'),
      imageUrl: fd.get('imageUrl'),
      isVisible: fd.get('isVisible') === 'on',
      tags: fd.getAll('tags'),
    };
    if (showCost) body.costPrice = fd.get('costPrice') || 0;
    if (isNew) body.stockQty = fd.get('stockQty');
    try {
      const saved = isNew ? await API.post('/products', body) : await API.patch(`/products/${p.id}`, body);
      const file = fd.get('imageFile');
      if (file && file.size) {
        const imgFd = new FormData();
        imgFd.append('image', file);
        await API.upload(`/products/${(saved.product || p).id}/image`, imgFd);
      }
      toast(isNew ? 'Product created' : 'Product saved');
      closeModal();
      onSaved();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });
  openModal(isNew ? 'Add product' : 'Edit product', form);
}

function stockForm(p, onSaved) {
  const form = node(`<form>
    <p>Current stock for <strong>${esc(p.name)}</strong>: <strong>${p.stockQty}</strong></p>
    <div class="form-grid">
      <label>Action<select name="type"><option value="IN">Add (IN)</option><option value="OUT">Remove (OUT)</option><option value="ADJUST">Set to (ADJUST)</option></select></label>
      <label>Quantity<input name="qty" type="number" min="0" value="1" required/></label>
      <label class="full">Reason<input name="reason" placeholder="e.g. delivery, damaged, recount"/></label>
    </div>
    <p class="error" data-err hidden></p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Apply</button></div>
  </form>`);
  form.querySelector('[data-close]').onclick = closeModal;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = form.querySelector('[data-err]');
    errBox.hidden = true;
    const fd = new FormData(form);
    try {
      await API.post(`/products/${p.id}/stock`, { type: fd.get('type'), qty: fd.get('qty'), reason: fd.get('reason') });
      toast('Stock updated');
      closeModal();
      onSaved();
    } catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
  });
  openModal('Adjust stock', form);
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
