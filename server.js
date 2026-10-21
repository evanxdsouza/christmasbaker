const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const store = require('./db');
const { renderInvoice, orderTotals } = require('./invoice');
const Costing = require('./public/js/costing');
const accounting = require('./accounting');
const market = require('./aiprices');

const app = express();
const PORT = process.env.PORT || 3000;
const STATUSES = ['New', 'Confirmed', 'Baking', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'];

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(store.STORAGE, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ---- uploads -------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(store.STORAGE, 'uploads', req.params.kind === 'products' ? 'products' : 'assets');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, store.uid() + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')),
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\/|application\/pdf/.test(file.mimetype)),
});

// ---- helpers -------------------------------------------------------------
const db = () => store.db;
const strip = (o) => { const { id, ...rest } = o; return rest; };

function trackCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s; do { s = Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join(''); } while (db().orders.some((o) => o.trackCode === s));
  return s;
}

function nextOrderNumber() {
  const n = db().orders.reduce((m, o) => Math.max(m, /^ORD-/.test(o.number) ? parseInt(o.number.replace(/\D/g, '')) || 0 : 0), 0) + 1;
  return 'ORD-' + String(n).padStart(4, '0');
}

// Catalog requests get a temporary id (TMP-0001…) until the baker confirms them.
function nextTempNumber() {
  const n = db().orders.reduce((m, o) => Math.max(m, /^TMP-/.test(o.number) ? parseInt(o.number.replace(/\D/g, '')) || 0 : 0), 0) + 1;
  return 'TMP-' + String(n).padStart(4, '0');
}

// Find or create a customer from an order so the customer book builds itself.
function upsertCustomer(o) {
  if (!o.customerName || o.status === 'Pending') return;
  let c = db().customers.find((x) => (o.customerId && x.id === o.customerId) || (o.phone && x.phone === o.phone) || x.name.toLowerCase() === o.customerName.toLowerCase());
  if (!c) {
    c = { id: store.uid(), name: o.customerName, phone: o.phone || '', address: o.address || '', notes: '', created: Date.now() };
    db().customers.push(c);
  } else {
    if (o.phone && !c.phone) c.phone = o.phone;
    if (o.address && !c.address) c.address = o.address;
  }
  o.customerId = c.id;
}

const cleanItems = (items = []) => items
  .filter((i) => i && (i.name || i.description))
  .map((i) => ({ productId: i.productId || '', name: i.name || i.description, description: i.description || i.name, qty: Number(i.qty) || 1, unitPrice: Number(i.unitPrice) || 0, cost: Number(i.cost) || 0 }));

// Deduct product stock (when tracked) as orders are confirmed; restore if cancelled.
function adjustStock(order, dir) {
  for (const i of order.items) {
    const p = db().products.find((x) => x.id === i.productId);
    if (p && p.stock !== null && p.stock !== undefined && p.stock !== '') p.stock = Math.max(0, Number(p.stock) + dir * i.qty);
  }
}

// Variants with a recipe get their cost worked out from it (ingredients + your time + gas + packaging).
function costVariant(v) {
  if (Costing.hasRecipe(v)) v.cost = Costing.round(Costing.recipeCost(v.recipe, db().ingredients, db().settings).each.total);
}
function recalcCosts() { for (const p of db().products) for (const v of p.variants) costVariant(v); }

const cleanRecipe = (r) => (r ? {
  yield: Math.max(1, Number(r.yield) || 1),
  items: (r.items || []).filter((i) => i.ingredientId && Number(i.qty)).map((i) => ({ ingredientId: i.ingredientId, qty: Number(i.qty), unit: i.unit || '' })),
  labourMins: Number(r.labourMins) || 0,
  gasMins: Number(r.gasMins) || 0,
  packaging: Number(r.packaging) || 0,
} : null);

// ---- settings ------------------------------------------------------------
// API keys never go back to the browser; it only learns whether one is set.
const SECRETS = ['groqApiKey', 'hackclubApiKey'];
const publicSettings = () => {
  const s = { ...db().settings };
  for (const k of SECRETS) { s[k.replace('ApiKey', 'KeySet')] = !!s[k]; delete s[k]; }
  return s;
};
app.get('/api/settings', (req, res) => res.json(publicSettings()));
app.put('/api/settings', (req, res) => {
  const { groqKeySet, hackclubKeySet, ...b } = req.body;
  for (const k of SECRETS) if (!b[k]) delete b[k]; // blank field = keep the saved key
  delete b.aiModelResolved; delete b.aiLastCost;
  db().settings = { ...db().settings, ...b };
  recalcCosts();
  store.save();
  res.json(publicSettings());
});

// ---- generic-ish CRUD for simple collections -----------------------------
function crud(name, { prepare, after } = {}) {
  app.get(`/api/${name}`, (req, res) => res.json(db()[name]));
  app.post(`/api/${name}`, (req, res) => {
    const item = { ...req.body, id: store.uid(), created: Date.now() };
    if (prepare) prepare(item);
    db()[name].push(item);
    if (after) after();
    store.save();
    res.status(201).json(item);
  });
  app.put(`/api/${name}/:id`, (req, res) => {
    const i = db()[name].findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.sendStatus(404);
    const item = { ...db()[name][i], ...strip(req.body) };
    if (prepare) prepare(item);
    db()[name][i] = item;
    if (after) after();
    store.save();
    res.json(item);
  });
  app.delete(`/api/${name}/:id`, (req, res) => {
    const item = db()[name].find((x) => x.id === req.params.id);
    if (!item) return res.sendStatus(404);
    if (name === 'assets' || name === 'products') {
      for (const f of [item.file, item.image]) if (f && f.startsWith('/uploads/')) fs.rm(path.join(store.STORAGE, f), { force: true }, () => {});
    }
    db()[name] = db()[name].filter((x) => x.id !== req.params.id);
    if (after) after();
    store.save();
    res.sendStatus(204);
  });
}

crud('products', {
  prepare: (p) => {
    p.variants = (p.variants || []).filter((v) => v.label).map((v) => ({ label: v.label, price: Number(v.price) || 0, cost: Number(v.cost) || 0, recipe: cleanRecipe(v.recipe) }));
    p.variants.forEach(costVariant);
    p.stock = p.stock === '' || p.stock === null || p.stock === undefined ? null : Number(p.stock);
    p.leadDays = Number(p.leadDays) || 0;
  },
});
crud('customers');
crud('ingredients', {
  prepare: (i) => {
    ['stock', 'reorder', 'cost'].forEach((k) => (i[k] = Number(i[k]) || 0));
    i.autoPrice = !!i.autoPrice && i.autoPrice !== '0';
    i.marketQuery = String(i.marketQuery || '').trim();
    if (!i.autoPrice) delete i.market;
  },
  after: recalcCosts,
});

// ---- market prices (Groq web search) -------------------------------------
app.post('/api/market/update', async (req, res) => {
  try {
    const report = await market.update(db());
    recalcCosts();
    store.save();
    res.json(report);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
market.schedule(store, recalcCosts);
crud('expenses', { prepare: (e) => { e.amount = Number(e.amount) || 0; } });
crud('assets');

// ---- accounts (double entry) ---------------------------------------------
const ACCOUNT_CODES = new Set(accounting.ACCOUNTS.map((a) => a.code));
app.get('/api/accounts', (req, res) => res.json(accounting.report(db(), { from: req.query.from, to: req.query.to })));
app.get('/api/journal', (req, res) => res.json(db().journal));
app.post('/api/journal', (req, res) => {
  const b = req.body;
  const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
  if (!(amount > 0) || !ACCOUNT_CODES.has(b.debit) || !ACCOUNT_CODES.has(b.credit) || b.debit === b.credit) return res.status(400).json({ error: 'Pick two different accounts and an amount' });
  const e = { id: store.uid(), created: Date.now(), date: b.date || new Date().toISOString().slice(0, 10), memo: b.memo || '', lines: [{ account: b.debit, debit: amount, credit: 0 }, { account: b.credit, debit: 0, credit: amount }] };
  db().journal.push(e);
  store.save();
  res.status(201).json(e);
});
app.delete('/api/journal/:id', (req, res) => {
  db().journal = db().journal.filter((x) => x.id !== req.params.id);
  store.save();
  res.sendStatus(204);
});

// ---- file uploads --------------------------------------------------------
// kind=products -> returns a URL to put on a product; kind=assets -> also saved into the asset library
app.post('/api/upload/:kind', upload.array('files', 20), (req, res) => {
  const out = (req.files || []).map((f) => {
    const url = `/uploads/${req.params.kind === 'products' ? 'products' : 'assets'}/${f.filename}`;
    if (req.params.kind === 'products') return { url };
    const a = { id: store.uid(), name: path.parse(f.originalname).name, file: url, type: f.mimetype, size: f.size, tag: req.body.tag || 'General', created: Date.now() };
    db().assets.push(a);
    return a;
  });
  store.save();
  res.status(201).json(out);
});

// ---- orders --------------------------------------------------------------
app.get('/api/orders', (req, res) => res.json(db().orders));

app.post('/api/orders', (req, res) => {
  const b = req.body;
  if (!b.customerName) return res.status(400).json({ error: 'Customer name is required' });
  const o = {
    id: store.uid(), number: nextOrderNumber(), trackCode: trackCode(), created: Date.now(),
    customerName: b.customerName, phone: b.phone || '', address: b.address || '',
    items: cleanItems(b.items), shipping: Number(b.shipping) || 0, discount: Number(b.discount) || 0,
    amountPaid: Number(b.amountPaid) || 0, deliveryDate: b.deliveryDate || '', deliveryType: b.deliveryType || 'Delivery',
    notes: b.notes || '', source: b.source || 'Instagram', status: 'New', history: [{ status: 'New', at: Date.now() }],
  };
  upsertCustomer(o);
  db().orders.push(o);
  store.save();
  res.status(201).json(o);
});

app.put('/api/orders/:id', (req, res) => {
  const o = db().orders.find((x) => x.id === req.params.id);
  if (!o) return res.sendStatus(404);
  const b = req.body;
  const prevStatus = o.status;
  for (const k of ['customerName', 'phone', 'address', 'deliveryDate', 'deliveryType', 'notes', 'source']) if (k in b) o[k] = b[k];
  for (const k of ['shipping', 'discount', 'amountPaid']) if (k in b) o[k] = Number(b[k]) || 0;
  if ('items' in b) o.items = cleanItems(b.items);
  if (b.status && o.status !== 'Pending' && b.status !== o.status && STATUSES.includes(b.status)) { // Pending orders only leave that state through /confirm
    o.status = b.status;
    o.history.push({ status: b.status, at: Date.now() });
    if (prevStatus === 'New' && b.status === 'Confirmed') adjustStock(o, -1);
    if (b.status === 'Cancelled' && prevStatus !== 'New' && prevStatus !== 'Cancelled') adjustStock(o, +1);
  }
  upsertCustomer(o);
  store.save();
  res.json(o);
});

// A customer sends their cart from the public catalog. Prices come from the product list, never the browser.
// It is stored as a Pending order with a temporary id until the baker confirms it.
const catalogHits = new Map();
const MAX_PENDING = 100;
app.post('/api/catalog/order', (req, res) => {
  const now = Date.now();
  const hits = (catalogHits.get(req.ip) || []).filter((t) => now - t < 3600e3);
  if (hits.length >= 10) return res.status(429).json({ error: 'Too many orders from this device. Please message us directly.' });
  if (db().orders.filter((o) => o.status === 'Pending').length >= MAX_PENDING) return res.status(503).json({ error: 'We cannot take new requests right now. Please message us directly.' });
  const b = req.body || {};
  const asked = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  const items = [];
  for (const a of asked) {
    const p = db().products.find((x) => x.id === a.productId && x.active !== false);
    const v = p && p.variants[Number(a.variant)];
    const qty = Math.floor(Number(a.qty));
    if (!v || !(qty >= 1) || qty > 50) continue;
    if (p.stock !== null && p.stock !== undefined && p.stock !== '' && Number(p.stock) <= 0) continue;
    items.push({ productId: p.id, name: p.name, description: `${p.name} ${v.label}`, qty, unitPrice: v.price, cost: v.cost || 0 });
  }
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty or those items are no longer available.' });
  const clip = (x, n) => String(x || '').trim().slice(0, n);
  const o = {
    id: store.uid(), number: nextTempNumber(), trackCode: '', created: now,
    customerName: clip(b.name, 80) || 'Catalog customer', phone: '', address: '',
    items, shipping: 0, discount: 0, amountPaid: 0, deliveryDate: '', deliveryType: 'Delivery',
    notes: clip(b.note, 500), source: 'WhatsApp', status: 'Pending', history: [{ status: 'Pending', at: now }],
  };
  db().orders.push(o);
  hits.push(now); catalogHits.set(req.ip, hits);
  store.save();
  res.status(201).json({ number: o.number, total: orderTotals(o).total });
});

// Baker confirms a Pending request: it gets a regular order id, a tracking code and a customer record.
app.post('/api/orders/:id/confirm', (req, res) => {
  const o = db().orders.find((x) => x.id === req.params.id);
  if (!o) return res.sendStatus(404);
  if (o.status !== 'Pending') return res.status(400).json({ error: 'This order is already confirmed' });
  o.requestId = o.number;
  o.number = nextOrderNumber();
  o.trackCode = trackCode();
  o.status = 'Confirmed';
  o.history.push({ status: 'Confirmed', at: Date.now() });
  adjustStock(o, -1);
  upsertCustomer(o);
  store.save();
  res.json(o);
});

app.delete('/api/orders/:id', (req, res) => {
  db().orders = db().orders.filter((x) => x.id !== req.params.id);
  store.save();
  res.sendStatus(204);
});

app.get('/api/orders/:id/invoice.pdf', (req, res) => {
  const o = db().orders.find((x) => x.id === req.params.id);
  if (!o) return res.sendStatus(404);
  if (o.status === 'Pending') return res.status(400).send('Confirm this order before invoicing it');
  if (!o.invoiceNo) {
    const s = db().settings;
    o.invoiceNo = `${s.invoicePrefix || ''}${String(s.nextInvoiceNo || 1).padStart(4, '0')}`;
    o.invoiceDate = Date.now();
    s.nextInvoiceNo = (s.nextInvoiceNo || 1) + 1;
    store.save();
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="Invoice-${o.invoiceNo}-${o.customerName.replace(/[^\w]+/g, '_')}.pdf"`);
  renderInvoice(o, db().settings, res);
});

// ---- public order tracking (customer facing) -----------------------------
app.get('/api/track/:code', (req, res) => {
  const o = db().orders.find((x) => x.status !== 'Pending' && (x.trackCode === req.params.code.toUpperCase().trim() || x.number.toLowerCase() === req.params.code.toLowerCase().trim()));
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  // Order numbers are guessable, so those need the last 4 phone digits; the random code is enough on its own.
  if (!o || (o.number.toLowerCase() === req.params.code.toLowerCase() && !(phone && o.phone.replace(/\D/g, '').endsWith(phone.slice(-4))))) return res.status(404).json({ error: 'Order not found' });
  const s = db().settings;
  res.json({ number: o.number, customerName: o.customerName.split(' ')[0], status: o.status, history: o.history, deliveryDate: o.deliveryDate, deliveryType: o.deliveryType, items: o.items.map((i) => ({ description: i.description, qty: i.qty })), business: { name: s.businessName, phone: s.phone, instagram: s.instagram }, statuses: STATUSES });
});

// ---- public catalog (customer facing) ------------------------------------
// Only customer-safe fields: no costs, recipes or stock counts.
app.get('/api/catalog', (req, res) => {
  const s = db().settings;
  const products = db().products
    .filter((p) => p.active !== false)
    .map((p) => ({
      id: p.id, name: p.name, category: p.category || 'Other', description: p.description || '', image: p.image || '',
      leadDays: p.leadDays || 0,
      soldOut: p.stock !== null && p.stock !== undefined && p.stock !== '' && Number(p.stock) <= 0,
      variants: p.variants.map((v) => ({ label: v.label, price: v.price })),
    }));
  res.json({ business: { name: s.businessName, tagline: s.tagline, phone: s.phone, instagram: s.instagram, currency: s.currency }, products });
});

// ---- dashboard / reports -------------------------------------------------
app.get('/api/stats', (req, res) => {
  const { expenses, ingredients, products } = db();
  const orders = db().orders.filter((o) => o.status !== 'Pending');
  const live = orders.filter((o) => o.status !== 'Cancelled');
  const totalOf = (o) => orderTotals(o).total;
  const revenue = live.reduce((s, o) => s + totalOf(o), 0);
  const collected = live.reduce((s, o) => s + Math.min(orderTotals(o).paid, totalOf(o)), 0);
  const cogs = live.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty * (i.cost || 0), 0), 0);
  const spend = expenses.reduce((s, e) => s + e.amount, 0);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]));
  const top = {};
  for (const o of live) for (const i of o.items) { const k = i.name; top[k] = top[k] || { name: k, qty: 0, revenue: 0 }; top[k].qty += i.qty; top[k].revenue += i.qty * i.unitPrice; }
  const months = {};
  for (const o of live) { const m = new Date(o.created).toISOString().slice(0, 7); months[m] = (months[m] || 0) + totalOf(o); }
  res.json({
    orders: orders.length, open: orders.filter((o) => !['Delivered', 'Cancelled'].includes(o.status)).length,
    revenue, collected, outstanding: revenue - collected, cogs, spend, profit: accounting.report(db()).pnl.profit, // same figure as the Accounts page; recipe costs aren't subtracted again on top of logged expenses
    byStatus, top: Object.values(top).sort((a, b) => b.revenue - a.revenue).slice(0, 6), months,
    lowStock: ingredients.filter((i) => i.stock <= i.reorder), products: products.length,
  });
});

app.get('/api/backup', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="christmas-baker-backup.json"');
  const { mcpTokens, ...data } = db();
  res.json({ ...data, settings: publicSettings() });
});

// ---- MCP endpoint for AI assistants (/mcp/<token>) ------------------------
require('./mcp')(app, PORT);

// Public tracking page + SPA fallback
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.get('/catalog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'catalog.html')));

app.listen(PORT, () => console.log(`The Christmas Baker is running on http://localhost:${PORT}`));
