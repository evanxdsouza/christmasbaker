/* The Christmas Baker — single-page admin app (vanilla JS, no build step) */
const STATUSES = ['New', 'Confirmed', 'Baking', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'];
const FLOW = STATUSES.slice(0, 6);
const STATUS_CHIP = { New: 'gold', Confirmed: '', Baking: 'gold', Ready: '', 'Out for delivery': 'gold', Delivered: '', Cancelled: 'grey' };
const CATEGORIES = ['Cakes', 'Cookies', 'Pastries', 'Sweets', 'Gift Boxes', 'Savouries', 'Other'];
const ASSET_TAGS = ['Logo', 'Product photo', 'Packaging', 'Social media', 'Invoice / documents', 'General'];
const EXPENSE_CATS = ['Ingredients', 'Packaging', 'Delivery', 'Marketing', 'Equipment', 'Other'];

const S = { settings: {}, products: [], orders: [], customers: [], assets: [], ingredients: [], expenses: [], ui: { orderView: 'list', orderFilter: 'open', q: '', cat: 'All', tag: 'All' } };

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cur = () => S.settings.currency || '₹';
const money = (n) => cur() + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const fdate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const totals = (o) => {
  const sub = o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const total = sub + (+o.shipping || 0) - (+o.discount || 0);
  const paid = +o.amountPaid || 0;
  return { sub, total, paid, balance: total - paid };
};
const payChip = (o) => {
  if (o.status === 'Cancelled') return '';
  const t = totals(o);
  if (t.total > 0 && t.balance <= 0) return '<span class="chip">Paid</span>';
  if (t.paid > 0) return `<span class="chip gold">Advance ${money(t.paid)}</span>`;
  return '<span class="chip red">Unpaid</span>';
};

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
  return r.status === 204 ? null : r.json();
}
async function loadAll() {
  const [settings, products, orders, customers, assets, ingredients, expenses] = await Promise.all(
    ['settings', 'products', 'orders', 'customers', 'assets', 'ingredients', 'expenses'].map((k) => api('GET', '/api/' + k)));
  Object.assign(S, { settings, products, orders, customers, assets, ingredients, expenses });
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400);
}
function modal(html, { wide } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}">${html}</div>`;
  m.hidden = false;
  m.onmousedown = (ev) => { if (ev.target === m) closeModal(); };
  return m.firstChild;
}
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
const confirmDo = (msg) => window.confirm(msg);
const field = (label, inner, cls = '') => `<div class="${cls}"><label>${label}</label>${inner}</div>`;
const empty = (icon, msg, btn = '') => `<div class="empty"><div class="big">${icon}</div><p>${msg}</p>${btn}</div>`;

// ---------- routing ----------
const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: '🎄', render: dashboard },
  { id: 'orders', label: 'Orders', icon: '🧾', render: orders, badge: () => S.orders.filter((o) => o.status === 'New').length },
  { id: 'products', label: 'Products', icon: '🍰', render: products },
  { id: 'assets', label: 'Assets', icon: '🖼️', render: assets },
  { id: 'customers', label: 'Customers', icon: '👥', render: customers },
  { id: 'inventory', label: 'Ingredients', icon: '🧈', render: inventory, badge: () => S.ingredients.filter((i) => i.stock <= i.reorder).length },
  { id: 'expenses', label: 'Expenses', icon: '💸', render: expenses },
  { id: 'settings', label: 'Settings', icon: '⚙️', render: settings },
];
function route() {
  const id = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  $('#nav').innerHTML = ROUTES.map((x) => {
    const b = x.badge ? x.badge() : 0;
    return `<a href="#/${x.id}" class="${x.id === r.id ? 'on' : ''}"><span class="ic">${x.icon}</span>${x.label}${b ? `<span class="badge">${b}</span>` : ''}</a>`;
  }).join('');
  $('#title').textContent = r.label;
  $('#actions').innerHTML = '';
  $('#side').classList.remove('open');
  r.render();
}
const setActions = (html) => ($('#actions').innerHTML = html);
async function refresh() { await loadAll(); route(); }

// ---------- dashboard ----------
async function dashboard() {
  const st = await api('GET', '/api/stats');
  setActions('<button class="btn primary" onclick="orderForm()">+ New order</button>');
  const upcoming = S.orders.filter((o) => !['Delivered', 'Cancelled'].includes(o.status)).sort((a, b) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999')).slice(0, 6);
  const months = Object.entries(st.months).sort().slice(-6);
  const max = Math.max(1, ...months.map((m) => m[1]));
  $('#view').innerHTML = `
  <p class="muted" style="margin:0 0 16px">${esc(S.settings.tagline || '')} · Welcome back, Head Elf 🎅</p>
  <div class="grid stats">
    <div class="card stat"><div class="n">${st.open}</div><div class="l">Open orders</div></div>
    <div class="card stat"><div class="n">${money(st.revenue)}</div><div class="l">Total sales</div></div>
    <div class="card stat red"><div class="n">${money(st.outstanding)}</div><div class="l">Payment pending</div></div>
    <div class="card stat"><div class="n">${money(st.profit)}</div><div class="l">Est. profit (after costs &amp; expenses)</div></div>
  </div>
  <div class="grid cols2" style="margin-top:16px">
    <div class="card"><h3>Upcoming deliveries</h3>
      ${upcoming.length ? `<table>${upcoming.map((o) => `<tr class="click" onclick="orderDetail('${o.id}')"><td><b>${esc(o.customerName)}</b><div class="small muted">${o.number} · ${o.items.reduce((s, i) => s + i.qty, 0)} items</div></td><td>${fdate(o.deliveryDate)}</td><td class="r"><span class="chip ${STATUS_CHIP[o.status]}">${o.status}</span></td></tr>`).join('')}</table>` : empty('🎁', 'No open orders right now.')}
    </div>
    <div class="card"><h3>Orders by stage</h3>
      <div style="display:grid;gap:8px;margin-top:10px">${FLOW.map((s) => `<div style="display:flex;justify-content:space-between"><span>${s}</span><b>${st.byStatus[s]}</b></div>`).join('')}</div>
      ${st.lowStock.length ? `<hr><h3>Low on ingredients</h3><div class="chips" style="margin-top:8px">${st.lowStock.map((i) => `<span class="chip red">${esc(i.name)}: ${i.stock} ${esc(i.unit)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="card"><h3>Best sellers</h3>
      ${st.top.length ? `<table>${st.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="r muted">${t.qty} sold</td><td class="r"><b>${money(t.revenue)}</b></td></tr>`).join('')}</table>` : empty('🍪', 'Sales will show up here.')}
    </div>
    <div class="card"><h3>Sales by month</h3>
      ${months.length ? `<div class="bars">${months.map((m) => `<div class="bar" style="height:${(m[1] / max) * 100}%"><span>${money(m[1])}</span></div>`).join('')}</div><div style="display:flex;gap:10px">${months.map((m) => `<div class="bar-l">${m[0]}</div>`).join('')}</div>` : empty('📈', 'No sales yet.')}
    </div>
  </div>`;
}

// ---------- orders ----------
function orders() {
  const u = S.ui;
  setActions(`<div class="seg"><button class="${u.orderView === 'list' ? 'on' : ''}" onclick="S.ui.orderView='list';route()">List</button><button class="${u.orderView === 'board' ? 'on' : ''}" onclick="S.ui.orderView='board';route()">Board</button></div><button class="btn primary" onclick="orderForm()">+ New order</button>`);
  const q = u.q.toLowerCase();
  let list = S.orders.filter((o) => !q || [o.customerName, o.number, o.phone, o.trackCode].some((v) => (v || '').toLowerCase().includes(q)));
  if (u.orderView === 'list') {
    const f = u.orderFilter;
    list = list.filter((o) => f === 'all' || (f === 'open' ? !['Delivered', 'Cancelled'].includes(o.status) : f === 'unpaid' ? o.status !== 'Cancelled' && totals(o).balance > 0 : o.status === f));
  }
  list.sort((a, b) => b.created - a.created);
  const toolbar = `<div class="toolbar"><input id="q" placeholder="Search name, phone, order no…" value="${esc(u.q)}">
    ${u.orderView === 'list' ? `<select id="of">${[['open', 'Open orders'], ['all', 'All orders'], ['unpaid', 'Payment pending'], ...STATUSES.map((s) => [s, s])].map(([v, l]) => `<option value="${v}" ${u.orderFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>`;
  let body;
  if (!S.orders.length) body = empty('🧾', 'No orders yet — add your first one!', '<button class="btn primary" onclick="orderForm()">+ New order</button>');
  else if (u.orderView === 'board') {
    body = `<div class="board">${STATUSES.filter((s) => s !== 'Cancelled').map((s) => {
      const c = list.filter((o) => o.status === s);
      return `<div class="col"><h4>${s}<span>${c.length}</span></h4>${c.map((o) => `<div class="tile" onclick="orderDetail('${o.id}')"><b>${esc(o.customerName)}</b><div class="small muted">${o.number} · ${fdate(o.deliveryDate)}</div><div class="small">${o.items.map((i) => `${i.qty}× ${esc(i.description)}`).join(', ')}</div><div style="display:flex;justify-content:space-between;margin-top:6px"><b>${money(totals(o).total)}</b>${payChip(o)}</div></div>`).join('')}</div>`;
    }).join('')}</div>`;
  } else {
    body = list.length ? `<div class="card table-wrap" style="padding:6px"><table><tr><th>Order</th><th>Customer</th><th>Delivery</th><th>Status</th><th>Payment</th><th class="r">Total</th></tr>${list.map((o) => `<tr class="click" onclick="orderDetail('${o.id}')"><td><b>${o.number}</b><div class="small muted">${fdate(o.created)}</div></td><td>${esc(o.customerName)}<div class="small muted">${esc(o.phone)}</div></td><td>${fdate(o.deliveryDate)}<div class="small muted">${esc(o.deliveryType)}</div></td><td><span class="chip ${STATUS_CHIP[o.status]}">${o.status}</span></td><td>${payChip(o)}</td><td class="r"><b>${money(totals(o).total)}</b></td></tr>`).join('')}</table></div>` : empty('🔍', 'Nothing matches.');
  }
  $('#view').innerHTML = toolbar + body;
  $('#q').oninput = (e) => { S.ui.q = e.target.value; const pos = e.target.selectionStart; orders(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  if ($('#of')) $('#of').onchange = (e) => { S.ui.orderFilter = e.target.value; orders(); };
}

function statusSteps(o, hist = o.history) {
  if (o.status === 'Cancelled') return '<p><span class="chip grey">Cancelled</span></p>';
  const idx = FLOW.indexOf(o.status);
  return `<div class="steps">${FLOW.map((s, i) => `<div class="step ${i < idx ? 'done' : i === idx ? 'done now' : ''}">${s}${(hist.find((h) => h.status === s) || {}).at ? `<div class="small muted" style="font-weight:400">${fdate(new Date(hist.find((h) => h.status === s).at).toISOString())}</div>` : ''}</div>`).join('')}</div>`;
}

const waLink = (o, text) => `https://wa.me/${(o.phone || '').replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(text)}`;
const trackUrl = (o) => `${location.origin}/track?c=${o.trackCode}`;

function orderDetail(id) {
  const o = S.orders.find((x) => x.id === id); if (!o) return;
  const t = totals(o);
  const next = FLOW[FLOW.indexOf(o.status) + 1];
  const msg = `Hi ${o.customerName.split(' ')[0]}! 🎄 Your order ${o.number} from ${S.settings.businessName} is now *${o.status}*.` + (o.deliveryDate ? ` Delivery: ${fdate(o.deliveryDate)}.` : '') + ` Track it here: ${trackUrl(o)}`;
  modal(`
  <div style="display:flex;justify-content:space-between;gap:10px;align-items:start"><div><h2>${o.number} · ${esc(o.customerName)}</h2><div class="muted small">Placed ${fdate(o.created)} · via ${esc(o.source)} · Track code <b>${o.trackCode}</b></div></div><button class="btn sm" onclick="closeModal()">✕</button></div>
  ${statusSteps(o)}
  <div class="grid cols2" style="gap:12px;margin:8px 0">
    <div><label>Contact</label>${esc(o.phone) || '—'}<div class="small muted">${esc(o.address) || 'No address'}</div></div>
    <div><label>${esc(o.deliveryType)}</label>${fdate(o.deliveryDate)}${o.notes ? `<div class="small muted">📝 ${esc(o.notes)}</div>` : ''}</div>
  </div>
  <table><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr>${o.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${i.qty}</td><td class="r">${money(i.unitPrice)}</td><td class="r">${money(i.qty * i.unitPrice)}</td></tr>`).join('')}</table>
  <div class="totals"><div><span>Subtotal</span><span>${money(t.sub)}</span></div>${o.shipping ? `<div><span>Shipping</span><span>${money(o.shipping)}</span></div>` : ''}${o.discount ? `<div><span>Discount</span><span>-${money(o.discount)}</span></div>` : ''}<div class="grand"><span>Total</span><span>${money(t.total)}</span></div><div><span>Paid</span><span>${money(t.paid)}</span></div><div style="color:${t.balance > 0 ? 'var(--red)' : 'var(--green)'}"><b>Balance</b><b>${money(t.balance)}</b></div></div>
  <hr>
  <div class="foot" style="justify-content:flex-start">
    ${next ? `<button class="btn green" onclick="setStatus('${o.id}','${next}')">Mark as ${next} →</button>` : ''}
    <select style="width:auto" onchange="setStatus('${o.id}',this.value)">${STATUSES.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    ${t.balance > 0 && o.status !== 'Cancelled' ? `<button class="btn" onclick="markPaid('${o.id}')">💰 Mark fully paid</button>` : ''}
  </div>
  <div class="foot" style="justify-content:flex-start;margin-top:8px">
    <a class="btn primary" href="/api/orders/${o.id}/invoice.pdf" target="_blank">📄 Invoice PDF</a>
    <a class="btn" href="/api/orders/${o.id}/invoice.pdf?download=1">⬇ Download</a>
    ${o.phone ? `<a class="btn" target="_blank" href="${waLink(o, msg)}">💬 WhatsApp update</a>` : ''}
    <button class="btn" onclick="navigator.clipboard.writeText('${trackUrl(o)}').then(()=>toast('Tracking link copied'))">🔗 Copy tracking link</button>
    <button class="btn" onclick="orderForm('${o.id}')">Edit</button>
    <button class="btn danger" onclick="delOrder('${o.id}')">Delete</button>
  </div>`, { wide: true });
}
async function setStatus(id, status) {
  await api('PUT', '/api/orders/' + id, { status });
  await loadAll(); route(); orderDetail(id); toast('Status: ' + status);
}
async function markPaid(id) {
  const o = S.orders.find((x) => x.id === id);
  await api('PUT', '/api/orders/' + id, { amountPaid: totals(o).total });
  await loadAll(); route(); orderDetail(id); toast('Marked paid');
}
async function delOrder(id) {
  if (!confirmDo('Delete this order permanently? (Use "Cancelled" status to keep a record.)')) return;
  await api('DELETE', '/api/orders/' + id); closeModal(); await refresh(); toast('Order deleted');
}

let draft = null;
function orderForm(id, preProduct) {
  const ex = id && S.orders.find((x) => x.id === id);
  draft = ex ? structuredClone(ex) : { customerName: '', phone: '', address: '', items: [], shipping: 0, discount: 0, amountPaid: 0, deliveryDate: '', deliveryType: 'Delivery', source: 'Instagram', notes: '' };
  if (preProduct) { const p = S.products.find((x) => x.id === preProduct); if (p) addLine(p, p.variants[0]); }
  drawOrderForm(ex);
}
function addLine(p, v) {
  draft.items.push({ productId: p.id, name: p.name, description: v ? `${p.name} ${v.label}` : p.name, qty: 1, unitPrice: v ? v.price : 0, cost: v ? v.cost : 0 });
}
function drawOrderForm(ex) {
  const val = (k) => esc(draft[k] ?? '');
  const t = totals(draft);
  modal(`
  <h2>${ex ? 'Edit ' + ex.number : 'New order'}</h2>
  <div class="form">
    ${field('Customer name', `<input id="f_customerName" list="custs" value="${val('customerName')}" autocomplete="off"><datalist id="custs">${S.customers.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>`)}
    ${field('Phone / WhatsApp', `<input id="f_phone" value="${val('phone')}" inputmode="tel">`)}
    ${field('Delivery address', `<textarea id="f_address" rows="2">${val('address')}</textarea>`, 'full')}
    ${field('Delivery / pickup date', `<input type="date" id="f_deliveryDate" value="${val('deliveryDate')}">`)}
    ${field('Type', `<select id="f_deliveryType">${['Delivery', 'Pickup', 'Courier'].map((x) => `<option ${draft.deliveryType === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
  </div>
  <hr><h3>Items</h3>
  <div class="items" id="items"></div>
  <div class="toolbar"><select id="pickProduct" style="flex:1"><option value="">+ Add a product…</option>${S.products.filter((p) => p.active).map((p) => p.variants.length ? p.variants.map((v, i) => `<option value="${p.id}|${i}">${esc(p.name)} — ${esc(v.label)} (${money(v.price)})</option>`).join('') : `<option value="${p.id}|-1">${esc(p.name)}</option>`).join('')}</select><button class="btn" onclick="draft.items.push({name:'Custom item',description:'Custom item',qty:1,unitPrice:0,cost:0});syncDraft();drawOrderForm(${ex ? `S.orders.find(o=>o.id==='${ex.id}')` : 'null'})">+ Custom line</button></div>
  <div class="form">
    ${field('Shipping', `<input type="number" min="0" id="f_shipping" value="${draft.shipping}">`)}
    ${field('Discount', `<input type="number" min="0" id="f_discount" value="${draft.discount}">`)}
    ${field('Advance / amount paid', `<input type="number" min="0" id="f_amountPaid" value="${draft.amountPaid}">`)}
    ${field('Order came from', `<select id="f_source">${['Instagram', 'WhatsApp', 'Phone call', 'Walk-in', 'Referral', 'Other'].map((x) => `<option ${draft.source === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
    ${field('Notes (message on cake, allergies, packaging…)', `<textarea id="f_notes" rows="2">${val('notes')}</textarea>`, 'full')}
  </div>
  <div class="totals" id="tot"></div>
  <div class="foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveOrder(${ex ? `'${ex.id}'` : ''})">${ex ? 'Save changes' : 'Create order'}</button></div>`, { wide: true });
  drawItems();
  $('#pickProduct').onchange = (e) => {
    if (!e.target.value) return;
    const [pid, vi] = e.target.value.split('|'); const p = S.products.find((x) => x.id === pid);
    syncDraft(); addLine(p, p.variants[+vi]); drawOrderForm(ex);
  };
  ['shipping', 'discount', 'amountPaid'].forEach((k) => ($('#f_' + k).oninput = () => { syncDraft(); drawTotals(); }));
}
function drawItems() {
  $('#items').innerHTML = draft.items.length ? `<div class="row h"><span>Description</span><span>Qty</span><span>Unit price</span><span class="lt">Line total</span><span></span></div>` + draft.items.map((i, n) => `<div class="row"><input data-n="${n}" data-k="description" value="${esc(i.description)}"><input data-n="${n}" data-k="qty" type="number" min="1" value="${i.qty}"><input data-n="${n}" data-k="unitPrice" type="number" min="0" value="${i.unitPrice}"><span class="lt r" id="lt${n}">${money(i.qty * i.unitPrice)}</span><button class="btn sm danger" onclick="syncDraft();draft.items.splice(${n},1);drawOrderForm(${draft.id ? `S.orders.find(o=>o.id==='${draft.id}')` : 'null'})">✕</button></div>`).join('') : '<p class="muted small">No items yet — pick a product below.</p>';
  $$('#items input').forEach((inp) => (inp.oninput = () => { syncDraft(); draft.items.forEach((i, n) => { const el = $('#lt' + n); if (el) el.textContent = money(i.qty * i.unitPrice); }); drawTotals(); }));
  drawTotals();
}
function drawTotals() {
  const t = totals(draft);
  $('#tot').innerHTML = `<div><span>Subtotal</span><span>${money(t.sub)}</span></div><div class="grand"><span>Total</span><span>${money(t.total)}</span></div><div><span>Balance due</span><span>${money(t.balance)}</span></div>`;
}
function syncDraft() {
  for (const k of ['customerName', 'phone', 'address', 'deliveryDate', 'deliveryType', 'source', 'notes']) if ($('#f_' + k)) draft[k] = $('#f_' + k).value;
  for (const k of ['shipping', 'discount', 'amountPaid']) if ($('#f_' + k)) draft[k] = +$('#f_' + k).value || 0;
  $$('#items input').forEach((inp) => { const i = draft.items[+inp.dataset.n]; if (i) i[inp.dataset.k] = inp.dataset.k === 'description' ? inp.value : +inp.value || 0; });
}
async function saveOrder(id) {
  syncDraft();
  if (!draft.customerName.trim()) return toast('Please enter the customer name');
  if (!draft.items.length) return toast('Add at least one item');
  draft.items.forEach((i) => { if (!i.name || i.name === 'Custom item') i.name = i.description; });
  const saved = id ? await api('PUT', '/api/orders/' + id, draft) : await api('POST', '/api/orders', draft);
  await refresh(); orderDetail(saved.id); toast(id ? 'Order updated' : 'Order created 🎄');
}

// ---------- products ----------
function products() {
  setActions('<button class="btn primary" onclick="productForm()">+ Add product</button>');
  const cats = ['All', ...new Set([...CATEGORIES, ...S.products.map((p) => p.category)].filter((c) => c === 'All' || S.products.some((p) => p.category === c)))];
  const list = S.products.filter((p) => S.ui.cat === 'All' || p.category === S.ui.cat);
  $('#view').innerHTML = `<div class="toolbar">${cats.map((c) => `<button class="btn sm ${S.ui.cat === c ? 'green' : ''}" onclick="S.ui.cat='${esc(c)}';products()">${esc(c)}</button>`).join('')}</div>` +
    (list.length ? `<div class="grid products">${list.map((p) => `<div class="card product ${p.active ? '' : 'off'}">
      <div class="img" style="${p.image ? `background-image:url('${esc(p.image)}')` : ''}">${p.image ? '' : '🎂'}</div>
      <div class="body"><div class="chips"><span class="chip">${esc(p.category)}</span>${p.active ? '' : '<span class="chip grey">Hidden</span>'}${p.stock !== null && p.stock <= 0 ? '<span class="chip red">Sold out</span>' : p.stock !== null ? `<span class="chip gold">${p.stock} left</span>` : ''}</div>
      <div class="name">${esc(p.name)}</div><div class="desc">${esc(p.description)}</div>
      <div>${p.variants.map((v) => `<div style="display:flex;justify-content:space-between" class="small"><span>${esc(v.label)}</span><b>${money(v.price)}</b></div>`).join('')}</div>
      <div class="small muted">${p.leadDays ? `Needs ${p.leadDays} days' notice` : ''}${p.variants[0] && p.variants[0].cost ? ` · margin ${Math.round((1 - p.variants[0].cost / p.variants[0].price) * 100)}%` : ''}</div>
      <div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm primary" onclick="orderForm(null,'${p.id}')">Order</button><button class="btn sm" onclick="productForm('${p.id}')">Edit</button></div></div></div>`).join('')}</div>` : empty('🍰', 'No products here yet.', '<button class="btn primary" onclick="productForm()">+ Add product</button>'));
}
let pDraft;
function productForm(id) {
  const ex = id && S.products.find((p) => p.id === id);
  pDraft = ex ? structuredClone(ex) : { name: '', category: 'Cakes', description: '', variants: [{ label: '', price: '', cost: '' }], image: '', active: true, stock: null, leadDays: 2 };
  drawProductForm(ex);
}
function drawProductForm(ex) {
  const p = pDraft;
  modal(`<h2>${ex ? 'Edit product' : 'Add product'}</h2>
  <div class="form">
    ${field('Name', `<input id="p_name" value="${esc(p.name)}" placeholder="e.g. Rum Fruit Cake">`, 'full')}
    ${field('Category', `<select id="p_category">${[...new Set([...CATEGORIES, p.category])].map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`)}
    ${field('Lead time (days notice)', `<input type="number" min="0" id="p_leadDays" value="${p.leadDays}">`)}
    ${field('Description', `<textarea id="p_description" rows="2">${esc(p.description)}</textarea>`, 'full')}
    <div class="full"><label>Photo</label><div style="display:flex;gap:12px;align-items:center">
      <div style="width:90px;height:68px;border-radius:10px;background:var(--soft-green) center/cover;${p.image ? `background-image:url('${esc(p.image)}')` : ''}"></div>
      <input type="file" id="p_file" accept="image/*" style="flex:1">
      ${S.assets.some((a) => a.type.startsWith('image/')) ? '<button class="btn sm" onclick="pickAsset()">Pick from assets</button>' : ''}</div></div>
    <div class="full variants"><label>Sizes / variants &amp; prices (cost = what it costs you to make, optional)</label>
      ${p.variants.map((v, n) => `<div class="row"><input data-vn="${n}" data-k="label" placeholder="e.g. 750 g" value="${esc(v.label)}"><input data-vn="${n}" data-k="price" type="number" min="0" placeholder="Price" value="${v.price}"><input data-vn="${n}" data-k="cost" type="number" min="0" placeholder="Cost" value="${v.cost}"><button class="btn sm danger" onclick="pSync();pDraft.variants.splice(${n},1);drawProductForm(${ex ? 'S.products.find(x=>x.id===pDraft.id)' : 'null'})">✕</button></div>`).join('')}
      <button class="btn sm" onclick="pSync();pDraft.variants.push({label:'',price:'',cost:''});drawProductForm(${ex ? 'S.products.find(x=>x.id===pDraft.id)' : 'null'})">+ Add size</button></div>
    ${field('Stock on hand (leave blank if made to order)', `<input type="number" min="0" id="p_stock" value="${p.stock ?? ''}">`)}
    ${field('Visible for new orders', `<select id="p_active"><option value="1" ${p.active ? 'selected' : ''}>Yes</option><option value="0" ${p.active ? '' : 'selected'}>No — hidden</option></select>`)}
  </div>
  <div class="foot">${ex ? `<button class="btn danger" style="margin-right:auto" onclick="delProduct('${ex.id}')">Delete</button>` : ''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveProduct(${ex ? `'${ex.id}'` : ''})">Save product</button></div>`);
  $('#p_file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    pSync(); const fd = new FormData(); fd.append('files', f);
    const [r] = await (await fetch('/api/upload/products', { method: 'POST', body: fd })).json();
    pDraft.image = r.url; drawProductForm(ex);
  };
}
function pickAsset() {
  pSync();
  const imgs = S.assets.filter((a) => a.type.startsWith('image/'));
  modal(`<h2>Pick an image</h2><div class="grid assets">${imgs.map((a) => `<div class="card asset" style="cursor:pointer" onclick="pDraft.image='${a.file}';drawProductForm(${pDraft.id ? `S.products.find(x=>x.id==='${pDraft.id}')` : 'null'})"><div class="thumb cover" style="background-image:url('${a.file}')"></div><div class="meta"><b>${esc(a.name)}</b></div></div>`).join('')}</div>`);
}
function pSync() {
  const p = pDraft;
  if (!$('#p_name')) return;
  p.name = $('#p_name').value; p.category = $('#p_category').value; p.description = $('#p_description').value;
  p.leadDays = $('#p_leadDays').value; p.stock = $('#p_stock').value === '' ? null : $('#p_stock').value; p.active = $('#p_active').value === '1';
  $$('.variants input').forEach((i) => (p.variants[+i.dataset.vn][i.dataset.k] = i.value));
}
async function saveProduct(id) {
  pSync();
  if (!pDraft.name.trim()) return toast('Product needs a name');
  if (!pDraft.variants.some((v) => v.label && +v.price)) return toast('Add at least one size with a price');
  id ? await api('PUT', '/api/products/' + id, pDraft) : await api('POST', '/api/products', pDraft);
  closeModal(); await refresh(); toast('Product saved');
}
async function delProduct(id) {
  if (!confirmDo('Delete this product? Existing orders keep their details.')) return;
  await api('DELETE', '/api/products/' + id); closeModal(); await refresh();
}

// ---------- assets ----------
function assets() {
  setActions('');
  const tags = ['All', ...ASSET_TAGS];
  const list = S.assets.filter((a) => S.ui.tag === 'All' || a.tag === S.ui.tag).sort((a, b) => b.created - a.created);
  $('#view').innerHTML = `
  <div class="drop" id="drop"><b>Drop photos, logos, videos or PDFs here</b><br><span class="small">or click to choose files</span>
    <div style="margin-top:10px" onclick="event.stopPropagation()"><label style="display:inline">Save as</label> <select id="uptag" style="width:auto">${ASSET_TAGS.map((t) => `<option ${t === 'Product photo' ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <input type="file" id="upfile" multiple hidden accept="image/*,video/*,application/pdf"></div>
  <div class="toolbar">${tags.map((t) => `<button class="btn sm ${S.ui.tag === t ? 'green' : ''}" onclick="S.ui.tag='${t}';assets()">${t}</button>`).join('')}</div>
  ${list.length ? `<div class="grid assets">${list.map((a) => `<div class="card asset"><div class="thumb ${a.type.startsWith('image/') ? '' : ''}" style="${a.type.startsWith('image/') ? `background-image:url('${a.file}')` : ''}">${a.type.startsWith('image/') ? '' : a.type.startsWith('video/') ? '🎬' : '📄'}</div>
    <div class="meta"><b title="${esc(a.name)}">${esc(a.name)}</b><span class="chip grey">${esc(a.tag)}</span><div style="display:flex;gap:4px;margin-top:8px"><a class="btn sm" href="${a.file}" target="_blank">Open</a><button class="btn sm" onclick="navigator.clipboard.writeText(location.origin+'${a.file}').then(()=>toast('Link copied'))">Copy link</button><button class="btn sm danger" onclick="delAsset('${a.id}')">✕</button></div></div></div>`).join('')}</div>` : empty('🖼️', 'Your asset library is empty. Upload your logo, product photos and packaging shots.')}`;
  const drop = $('#drop'), inp = $('#upfile');
  drop.onclick = () => inp.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); uploadAssets(e.dataTransfer.files); };
  inp.onchange = () => uploadAssets(inp.files);
}
async function uploadAssets(files) {
  if (!files.length) return;
  const fd = new FormData(); fd.append('tag', $('#uptag').value);
  [...files].forEach((f) => fd.append('files', f));
  toast('Uploading…');
  const r = await fetch('/api/upload/assets', { method: 'POST', body: fd });
  if (!r.ok) return toast('Upload failed');
  await refresh(); toast('Uploaded');
}
async function delAsset(id) { if (confirmDo('Delete this file?')) { await api('DELETE', '/api/assets/' + id); await refresh(); } }

// ---------- customers ----------
function customers() {
  setActions('<button class="btn primary" onclick="customerForm()">+ Add customer</button>');
  const rows = S.customers.map((c) => { const os = S.orders.filter((o) => o.customerId === c.id && o.status !== 'Cancelled'); return { c, n: os.length, spent: os.reduce((s, o) => s + totals(o).total, 0), last: Math.max(0, ...os.map((o) => o.created)) }; }).sort((a, b) => b.spent - a.spent);
  $('#view').innerHTML = rows.length ? `<div class="card table-wrap" style="padding:6px"><table><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Last order</th><th class="r">Total spent</th></tr>${rows.map(({ c, n, spent, last }) => `<tr class="click" onclick="customerForm('${c.id}')"><td><b>${esc(c.name)}</b>${n >= 3 ? ' <span class="chip gold">Regular ★</span>' : ''}<div class="small muted">${esc(c.address)}</div></td><td>${esc(c.phone)}</td><td>${n}</td><td>${last ? fdate(new Date(last).toISOString()) : '—'}</td><td class="r"><b>${money(spent)}</b></td></tr>`).join('')}</table></div>` : empty('👥', 'Customers are added automatically when you create orders.');
}
function customerForm(id) {
  const c = (id && S.customers.find((x) => x.id === id)) || { name: '', phone: '', address: '', notes: '' };
  const os = id ? S.orders.filter((o) => o.customerId === id) : [];
  modal(`<h2>${id ? esc(c.name) : 'Add customer'}</h2><div class="form">
    ${field('Name', `<input id="c_name" value="${esc(c.name)}">`)}${field('Phone', `<input id="c_phone" value="${esc(c.phone)}">`)}
    ${field('Address', `<textarea id="c_address" rows="2">${esc(c.address)}</textarea>`, 'full')}
    ${field('Notes (allergies, favourites, birthdays…)', `<textarea id="c_notes" rows="2">${esc(c.notes)}</textarea>`, 'full')}</div>
  ${os.length ? `<hr><h3>Order history</h3><table>${os.map((o) => `<tr class="click" onclick="orderDetail('${o.id}')"><td>${o.number}</td><td>${fdate(o.created)}</td><td><span class="chip ${STATUS_CHIP[o.status]}">${o.status}</span></td><td class="r">${money(totals(o).total)}</td></tr>`).join('')}</table>` : ''}
  <div class="foot">${id ? `<button class="btn danger" style="margin-right:auto" onclick="delCustomer('${id}')">Delete</button>` : ''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveCustomer('${id || ''}')">Save</button></div>`);
}
async function saveCustomer(id) {
  const b = { name: $('#c_name').value.trim(), phone: $('#c_phone').value, address: $('#c_address').value, notes: $('#c_notes').value };
  if (!b.name) return toast('Name required');
  id ? await api('PUT', '/api/customers/' + id, b) : await api('POST', '/api/customers', b);
  closeModal(); await refresh();
}
async function delCustomer(id) { if (confirmDo('Delete this customer? Their orders remain.')) { await api('DELETE', '/api/customers/' + id); closeModal(); await refresh(); } }

// ---------- ingredients ----------
function inventory() {
  setActions('<button class="btn primary" onclick="ingForm()">+ Add ingredient</button>');
  $('#view').innerHTML = S.ingredients.length ? `<p class="muted small">Keep track of pantry stock. Ingredients at or below their reorder level are flagged on the dashboard.</p><div class="card table-wrap" style="padding:6px"><table><tr><th>Ingredient</th><th>In stock</th><th>Reorder at</th><th class="r">Cost / unit</th><th></th></tr>${S.ingredients.map((i) => `<tr><td><b>${esc(i.name)}</b> ${i.stock <= i.reorder ? '<span class="chip red">Low</span>' : ''}</td><td><button class="btn sm" onclick="bump('${i.id}',-1)">−</button> <b style="display:inline-block;min-width:56px;text-align:center">${i.stock} ${esc(i.unit)}</b> <button class="btn sm" onclick="bump('${i.id}',1)">+</button></td><td>${i.reorder} ${esc(i.unit)}</td><td class="r">${money(i.cost)}</td><td class="r"><button class="btn sm" onclick="ingForm('${i.id}')">Edit</button></td></tr>`).join('')}</table></div>` : empty('🧈', 'Add your ingredients to track stock.');
}
async function bump(id, d) { const i = S.ingredients.find((x) => x.id === id); await api('PUT', '/api/ingredients/' + id, { stock: Math.max(0, +(i.stock + d * (i.unit === 'ml' || i.unit === 'g' ? 100 : 1)).toFixed(2)) }); await loadAll(); inventory(); route(); }
function ingForm(id) {
  const i = (id && S.ingredients.find((x) => x.id === id)) || { name: '', unit: 'kg', stock: 0, reorder: 0, cost: 0 };
  modal(`<h2>${id ? 'Edit' : 'Add'} ingredient</h2><div class="form">${field('Name', `<input id="i_name" value="${esc(i.name)}">`)}${field('Unit', `<select id="i_unit">${['kg', 'g', 'l', 'ml', 'pcs', 'dozen'].map((u) => `<option ${u === i.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>`)}${field('In stock', `<input id="i_stock" type="number" step="any" value="${i.stock}">`)}${field('Reorder level', `<input id="i_reorder" type="number" step="any" value="${i.reorder}">`)}${field('Cost per unit', `<input id="i_cost" type="number" step="any" value="${i.cost}">`)}</div>
  <div class="foot">${id ? `<button class="btn danger" style="margin-right:auto" onclick="delIng('${id}')">Delete</button>` : ''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveIng('${id || ''}')">Save</button></div>`);
}
async function saveIng(id) {
  const b = { name: $('#i_name').value.trim(), unit: $('#i_unit').value, stock: $('#i_stock').value, reorder: $('#i_reorder').value, cost: $('#i_cost').value };
  if (!b.name) return toast('Name required');
  id ? await api('PUT', '/api/ingredients/' + id, b) : await api('POST', '/api/ingredients', b);
  closeModal(); await refresh();
}
async function delIng(id) { if (confirmDo('Delete ingredient?')) { await api('DELETE', '/api/ingredients/' + id); closeModal(); await refresh(); } }

// ---------- expenses ----------
function expenses() {
  setActions('<button class="btn primary" onclick="expForm()">+ Add expense</button>');
  const list = [...S.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const sum = list.reduce((s, e) => s + e.amount, 0);
  $('#view').innerHTML = list.length ? `<div class="grid stats" style="margin-bottom:16px"><div class="card stat red"><div class="n">${money(sum)}</div><div class="l">Total spent</div></div>${EXPENSE_CATS.map((c) => ({ c, v: list.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0) })).filter((x) => x.v).map((x) => `<div class="card stat"><div class="n">${money(x.v)}</div><div class="l">${x.c}</div></div>`).join('')}</div>
  <div class="card table-wrap" style="padding:6px"><table><tr><th>Date</th><th>What</th><th>Category</th><th class="r">Amount</th><th></th></tr>${list.map((e) => `<tr><td>${fdate(e.date)}</td><td>${esc(e.title)}</td><td><span class="chip grey">${esc(e.category)}</span></td><td class="r"><b>${money(e.amount)}</b></td><td class="r"><button class="btn sm danger" onclick="delExp('${e.id}')">✕</button></td></tr>`).join('')}</table></div>` : empty('💸', 'Log ingredient runs, packaging and delivery costs to see your real profit.');
}
function expForm() {
  modal(`<h2>Add expense</h2><div class="form">${field('What was it for?', `<input id="e_title">`, 'full')}${field('Amount', `<input id="e_amount" type="number" min="0">`)}${field('Date', `<input id="e_date" type="date" value="${today()}">`)}${field('Category', `<select id="e_cat">${EXPENSE_CATS.map((c) => `<option>${c}</option>`).join('')}</select>`)}</div>
  <div class="foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveExp()">Save</button></div>`);
}
async function saveExp() {
  const b = { title: $('#e_title').value.trim(), amount: $('#e_amount').value, date: $('#e_date').value, category: $('#e_cat').value };
  if (!b.title || !+b.amount) return toast('Enter what it was and the amount');
  await api('POST', '/api/expenses', b); closeModal(); await refresh();
}
async function delExp(id) { if (confirmDo('Delete expense?')) { await api('DELETE', '/api/expenses/' + id); await refresh(); } }

// ---------- settings ----------
function settings() {
  setActions('');
  const s = S.settings;
  const inp = (k, l, type = 'text', cls = '') => field(l, `<input id="s_${k}" type="${type}" value="${esc(s[k])}">`, cls);
  $('#view').innerHTML = `<div class="card" style="max-width:760px"><h3>Business &amp; invoice details</h3><div class="form" style="margin-top:12px">
    ${inp('businessName', 'Business name')}${inp('tagline', 'Tagline')}${inp('fssai', 'FSSAI number (printed on invoices)')}${inp('phone', 'Phone / WhatsApp')}${inp('instagram', 'Instagram')}${inp('currency', 'Currency symbol')}
    ${field('Address', `<textarea id="s_address" rows="2">${esc(s.address)}</textarea>`, 'full')}
    ${inp('invoicePrefix', 'Invoice number prefix')}${inp('nextInvoiceNo', 'Next invoice number', 'number')}
    ${field('Thank-you message on invoice', `<textarea id="s_thankYou" rows="3">${esc(s.thankYou)}</textarea>`, 'full')}
    ${field('Payment details on invoice (UPI ID, bank…) — optional', `<textarea id="s_paymentNote" rows="2">${esc(s.paymentNote)}</textarea>`, 'full')}
  </div><div class="foot"><a class="btn" href="/api/backup">⬇ Download backup</a><button class="btn primary" onclick="saveSettings()">Save settings</button></div></div>`;
}
async function saveSettings() {
  const b = {}; $$('[id^=s_]').forEach((el) => (b[el.id.slice(2)] = el.type === 'number' ? +el.value || 1 : el.value));
  S.settings = await api('PUT', '/api/settings', b); toast('Settings saved');
}

// ---------- boot ----------
$('#burger').onclick = () => $('#side').classList.toggle('open');
window.addEventListener('hashchange', route);
loadAll().then(route);
