// MCP server (Streamable HTTP, stateless JSON) so an AI assistant — Claude, ChatGPT, Gemini — can use the platform.
// No SDK: the protocol is just JSON-RPC over POST. Each tool forwards to the app's own REST API on loopback,
// so the AI goes through exactly the same rules as the web app.
// Connect with  https://<host>/mcp/<token>  (or /mcp with "Authorization: Bearer <token>").
const crypto = require('crypto');
const store = require('./db');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const COLLECTIONS = ['orders', 'products', 'customers', 'ingredients', 'expenses', 'assets', 'journal'];
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---- tokens --------------------------------------------------------------
// Only a hash is kept, so the link is shown once when it's made.
const tokens = () => (store.db.mcpTokens = store.db.mcpTokens || []);
const publicToken = ({ hash: _, ...t }) => t;
function findToken(raw) {
  if (!raw) return null;
  const h = hash(raw);
  return tokens().find((t) => crypto.timingSafeEqual(Buffer.from(t.hash), Buffer.from(h))) || null;
}

// ---- tools ---------------------------------------------------------------
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const anyObj = (description) => ({ type: 'object', description, additionalProperties: true });
const coll = (list = COLLECTIONS) => str('Which part of the platform', { enum: list });
const RO = { readOnlyHint: true, openWorldHint: false };

const FIELDS = `Fields — products: name, category, description, variants[{label, price, cost, recipe?}], stock (null = untracked), leadDays, active, image.
customers: name, phone, address, notes. ingredients: name, unit (g/kg/ml/l/pcs), stock, reorder, cost (per unit), autoPrice, marketQuery.
expenses: date (YYYY-MM-DD), category, description, amount. assets: name, file (URL), type, tag.
journal (create only): debit, credit (account codes from get_accounts), amount, date, memo.
orders (update only): status (New, Confirmed, Baking, Ready, Out for delivery, Delivered, Cancelled), amountPaid, deliveryDate, deliveryType, address, phone, notes, items, shipping, discount.`;

const TOOLS = [
  { name: 'get_dashboard', description: 'Business overview: order counts by status, revenue, collected, outstanding, profit, best sellers, low-stock ingredients.', inputSchema: obj({}), annotations: RO, run: (c) => c.api('GET', '/api/stats') },
  {
    name: 'list', description: 'List records. Optional text search across all fields. Orders can be filtered by status.', annotations: RO,
    inputSchema: obj({ collection: coll(), search: str('Text to match (case-insensitive)'), status: str('Orders only: exact status') }, ['collection']),
    run: async (c, a) => {
      let rows = await c.api('GET', '/api/' + a.collection);
      if (a.status) rows = rows.filter((r) => r.status === a.status);
      if (a.search) { const q = a.search.toLowerCase(); rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)); }
      return rows;
    },
  },
  {
    name: 'get', description: 'Get one record by id (orders also by order number like ORD-0012 or tracking code).', annotations: RO,
    inputSchema: obj({ collection: coll(), id: str('id, order number or tracking code') }, ['collection', 'id']),
    run: async (c, a) => {
      const id = String(a.id).toLowerCase();
      const r = (await c.api('GET', '/api/' + a.collection)).find((x) => [x.id, x.number, x.trackCode].some((v) => v && String(v).toLowerCase() === id));
      if (!r) throw new Error(`No ${a.collection} record "${a.id}"`);
      return r;
    },
  },
  {
    name: 'create', description: `Add a product, customer, ingredient, expense, asset or manual journal entry. (Orders: use create_order.)\n${FIELDS}`, annotations: { openWorldHint: false },
    inputSchema: obj({ collection: coll(COLLECTIONS.filter((x) => x !== 'orders')), data: anyObj('The record') }, ['collection', 'data']),
    run: (c, a) => c.api('POST', '/api/' + a.collection, a.data),
  },
  {
    name: 'update', description: `Change fields on a record (only send what changes). Changing an order's status records it in the order history and adjusts stock.\n${FIELDS}`, annotations: { openWorldHint: false },
    inputSchema: obj({ collection: coll(COLLECTIONS.filter((x) => x !== 'journal')), id: str('Record id'), data: anyObj('Fields to change') }, ['collection', 'id', 'data']),
    run: (c, a) => c.api('PUT', `/api/${a.collection}/${encodeURIComponent(a.id)}`, a.data),
  },
  {
    name: 'delete', description: 'Permanently delete a record. Prefer cancelling orders (update status to Cancelled) over deleting them.', annotations: { destructiveHint: true, openWorldHint: false },
    inputSchema: obj({ collection: coll(), id: str('Record id') }, ['collection', 'id']),
    run: async (c, a) => { await c.api('DELETE', `/api/${a.collection}/${encodeURIComponent(a.id)}`); return { deleted: a.id }; },
  },
  {
    name: 'create_order', permission: 'createOrders', annotations: { openWorldHint: false },
    description: 'Create a new customer order (needs the "create orders" permission on this connection). Confirm the details with the user first. Look up product ids/prices with list products.',
    inputSchema: obj({
      customerName: str('Customer name'), phone: str('Phone / WhatsApp'), address: str('Delivery address'),
      items: { type: 'array', items: obj({ productId: str('Product id'), name: str('Item name incl. size, e.g. "Traditional Fruit Cake – 750 g"'), qty: { type: 'number' }, unitPrice: { type: 'number' }, cost: { type: 'number', description: 'Cost per unit (from the product variant)' } }, ['name', 'qty', 'unitPrice']) },
      deliveryDate: str('YYYY-MM-DD'), deliveryType: str('Delivery or Pickup', { enum: ['Delivery', 'Pickup'] }),
      shipping: { type: 'number' }, discount: { type: 'number' }, amountPaid: { type: 'number', description: 'Advance already paid' },
      source: str('Where the order came from, e.g. Instagram, WhatsApp'), notes: str('Notes'),
    }, ['customerName', 'items']),
    run: (c, a) => c.api('POST', '/api/orders', a),
  },
  {
    name: 'get_invoice_link', description: "Link to an order's invoice PDF (gives the order an invoice number the first time it's opened).", annotations: RO,
    inputSchema: obj({ id: str('Order id') }, ['id']),
    run: async (c, a) => {
      if (!(await c.api('GET', '/api/orders')).some((o) => o.id === a.id)) throw new Error('Not found — check the id');
      return { url: `${c.origin}/api/orders/${encodeURIComponent(a.id)}/invoice.pdf` };
    },
  },
  {
    name: 'get_accounts', description: 'Accounts: P&L, balance sheet, trial balance, ledgers and the double-entry journal, optionally for a date range. Also lists account codes.', annotations: RO,
    inputSchema: obj({ from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD') }),
    run: (c, a) => c.api('GET', '/api/accounts?' + new URLSearchParams(Object.entries(a).filter(([, v]) => v))),
  },
  { name: 'get_settings', description: 'Business settings (name, invoice details, labour/gas rates, price-lookup options). API keys are never shown.', inputSchema: obj({}), annotations: RO, run: (c) => c.api('GET', '/api/settings') },
  {
    name: 'update_settings', description: 'Change business settings (only send what changes). Changing labour or gas rates re-costs every recipe.', annotations: { openWorldHint: false },
    inputSchema: obj({ data: anyObj('e.g. {"labourRate": 200}') }, ['data']),
    run: (c, a) => { const { groqApiKey, hackclubApiKey, ...d } = a.data; return c.api('PUT', '/api/settings', d); },
  },
  { name: 'refresh_market_prices', description: 'Look up today\'s prices for ingredients marked "auto price" and re-cost recipes.', inputSchema: obj({}), annotations: { openWorldHint: true }, run: (c) => c.api('POST', '/api/market/update') },
];

const allowed = (tool, token) => !tool.permission || token.permissions?.[tool.permission];

// ---- JSON-RPC ------------------------------------------------------------
async function handle(msg, token, ctx) {
  const { method, params = {} } = msg;
  if (method === 'initialize') {
    return {
      protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'christmas-baker', version: '1.0.0' },
      instructions: `Tools for running ${store.db.settings.businessName}: orders, products & recipes, customers, ingredients, expenses, assets, accounts and settings. Money is in ${store.db.settings.currency}.`
        + (token.permissions?.createOrders ? '' : ' This connection cannot create orders.'),
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS.filter((t) => allowed(t, token)).map(({ run, permission, ...t }) => t) };
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) throw Object.assign(new Error('Unknown tool ' + params.name), { code: -32602 });
    if (!allowed(tool, token)) return { content: [{ type: 'text', text: 'This connection is not allowed to create orders. Ask the owner to enable "Can create orders" for this AI in Settings.' }], isError: true };
    try {
      const out = await tool.run(ctx, params.arguments || {});
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
  }
  throw Object.assign(new Error('Method not found: ' + method), { code: -32601 });
}

module.exports = function mount(app, port) {
  // REST calls on loopback, so tools share every rule (validation, stock, costing) with the web app
  const api = async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error || (r.status === 404 ? 'Not found — check the id' : `${r.status} ${r.statusText}`));
    return data;
  };

  // token management for the Settings page
  app.get('/api/mcp-tokens', (req, res) => res.json(tokens().map(publicToken)));
  app.post('/api/mcp-tokens', (req, res) => {
    const raw = crypto.randomBytes(24).toString('base64url');
    const t = { id: store.uid(), name: String(req.body.name || 'AI assistant').slice(0, 60), permissions: { createOrders: !!req.body.createOrders }, created: Date.now(), lastUsed: 0, hash: hash(raw) };
    tokens().push(t);
    store.save();
    res.status(201).json({ ...publicToken(t), token: raw });
  });
  app.put('/api/mcp-tokens/:id', (req, res) => {
    const t = tokens().find((x) => x.id === req.params.id);
    if (!t) return res.sendStatus(404);
    if ('createOrders' in req.body) t.permissions.createOrders = !!req.body.createOrders;
    store.save();
    res.json(publicToken(t));
  });
  app.delete('/api/mcp-tokens/:id', (req, res) => {
    store.db.mcpTokens = tokens().filter((x) => x.id !== req.params.id);
    store.save();
    res.sendStatus(204);
  });

  app.all(['/mcp', '/mcp/:token'], async (req, res) => {
    const token = findToken(req.params.token || (req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!token) return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid or revoked token' } });
    if (req.method !== 'POST') return res.set('Allow', 'POST').sendStatus(405); // no server-sent stream; everything is request/response
    if (Date.now() - token.lastUsed > 60000) { token.lastUsed = Date.now(); store.save(); }

    const origin = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
    const ctx = { api, origin };
    const one = async (msg) => {
      if (msg?.id === undefined || msg.id === null) return null; // notification
      try { return { jsonrpc: '2.0', id: msg.id, result: await handle(msg, token, ctx) }; }
      catch (e) { return { jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }; }
    };
    const body = req.body;
    const out = Array.isArray(body) ? (await Promise.all(body.map(one))).filter(Boolean) : await one(body);
    if (!out || (Array.isArray(out) && !out.length)) return res.sendStatus(202);
    res.json(out);
  });
};
