// Looks up retail prices for ingredients with a free AI API, priced per each ingredient's own unit.
// Providers: Groq (built-in web search) and Hack Club AI (OpenAI-compatible chat model; web
// search comes from Hack Club's Exa proxy, which we query ourselves and hand to the model to read).

const PROVIDERS = {
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keyField: 'groqApiKey',
    search: true,
    // Web-searching setups, best first. Not every account can use every model, so we ask Groq
    // which ones this key has and fall through on "model not found / no access".
    models: [
      { model: 'groq/compound' },
      { model: 'groq/compound-mini' },
      { model: 'openai/gpt-oss-120b', tools: [{ type: 'browser_search' }] },
      { model: 'openai/gpt-oss-20b', tools: [{ type: 'browser_search' }] },
    ],
    hint: 'In console.groq.com → Settings → Limits, allow openai/gpt-oss-120b.',
  },
  hackclub: {
    label: 'Hack Club AI',
    base: 'https://ai.hackclub.com/proxy/v1',
    keyField: 'hackclubApiKey',
    search: false, // the chat model itself can't browse; see usesExa()
    models: [{ model: 'qwen/qwen3-32b' }, { model: 'openai/gpt-oss-120b' }, { model: 'moonshotai/kimi-k2-thinking' }],
    hint: 'Check the key at ai.hackclub.com, or type a model name from its list in the Model box.',
  },
};
const DAY = 24 * 60 * 60 * 1000;
const BATCH = 8; // ingredients per request
const SANITY = 4; // a new price more than 4× off the old one is reported, not applied

const provider = (s) => PROVIDERS[s.aiProvider] || PROVIDERS.groq;
const keyOf = (s) => s[provider(s).keyField];
// Hack Club AI can search through its Exa proxy (same key). On by default; costs ~1¢ per ingredient.
const usesExa = (s) => provider(s) === PROVIDERS.hackclub && s.hackclubSearch !== false;
const live = (s) => provider(s).search || usesExa(s); // are prices backed by real search results?

const auth = (s) => ({ Authorization: `Bearer ${keyOf(s)}` });

async function candidates(s) {
  const P = provider(s);
  const custom = P === PROVIDERS.hackclub && s.hackclubModel ? [{ model: s.hackclubModel }] : null; // a model the user typed wins
  let list = custom || P.models;
  if (!custom) {
    try {
      const r = await fetch(`${P.base}/models`, { headers: auth(s), signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const have = new Set(((await r.json()).data || []).map((m) => m.id));
        const usable = P.models.filter((m) => have.has(m.model));
        if (usable.length) list = usable;
      }
    } catch { /* fall back to trying them all */ }
  }
  const pref = s.aiModelResolved; // the one that worked last time goes first
  return [...list].sort((a, b) => (b.model === pref) - (a.model === pref));
}

async function complete(s, prompt) {
  const P = provider(s);
  let lastErr;
  const tried = await candidates(s);
  for (const c of tried) {
    const body = { model: c.model, temperature: 0, messages: [{ role: 'user', content: prompt }] };
    if (c.tools) Object.assign(body, { tools: c.tools, tool_choice: 'required' });
    const r = await fetch(`${P.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(s) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const detail = j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''));
      lastErr = new Error(`${P.label} replied ${r.status}${detail ? ': ' + detail : ''}`);
      if (r.status === 404 || r.status === 403 || (r.status === 400 && /model|tool/i.test(lastErr.message))) continue; // try the next model
      throw lastErr;
    }
    const msg = (await r.json()).choices?.[0]?.message || {};
    s.aiModelResolved = c.model;
    return msg.content || msg.reasoning || ''; // gpt-oss can leave content empty and answer in reasoning
  }
  throw new Error(`Your ${P.label} key can't use any of the models we tried (${tried.map((c) => c.model).join(', ')}). ${P.hint}${lastErr ? ' Last error: ' + lastErr.message : ''}`);
}

// One Exa search per ingredient. Returns { text, cost }; text is '' if nothing usable came back.
async function exaSearch(s, ing, where) {
  const q = `${ing.marketQuery || ing.name} price in ${where} buy online BigBasket Blinkit Amazon`;
  const r = await fetch(`${provider(s).base}/exa/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(s) },
    body: JSON.stringify({ query: q, numResults: 4, contents: { text: { maxCharacters: 600 } } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Exa search replied ${r.status}`);
  const j = await r.json();
  const text = (j.results || []).filter((x) => x.text).map((x, n) => `[${n + 1}] ${x.title || ''} (${x.url})\n${String(x.text).replace(/\s+/g, ' ').trim()}`).join('\n');
  return { text, cost: Number(j.costDollars && j.costDollars.total) || 0 };
}

async function ask(s, items, context = {}) {
  const where = s.marketLocation || 'India';
  const P = provider(s);
  const searched = usesExa(s);
  const list = items.map((i, n) => `${n + 1}. id=${i.id} · ${i.marketQuery || i.name} · price per 1 ${i.unit}` +
    (searched ? `\n   Search results:\n${(context[i.id] || '(none found — give your best estimate from knowledge)').replace(/^/gm, '   ')}` : '')).join('\n');
  const task = P.search
    ? "Search the web for today's typical retail price"
    : searched
      ? "Using the search results given under each ingredient (not your memory, unless an ingredient has none), work out the current typical retail price"
      : "From your own knowledge (you cannot browse), give your best estimate of the current typical retail price";
  const prompt = `${task} in ${where} (in Indian rupees) for each baking ingredient below, as sold to a home baker in shops or on grocery apps (BigBasket, Blinkit, Amazon, local stores). Convert each to the price for exactly ONE of the unit given (e.g. per 1 g means divide a 500 g pack price by 500).

${list}

Reply with ONLY this JSON, nothing else:
{"prices":[{"id":"<id>","price":<number in INR per 1 unit>,"basis":"<pack and price you used, e.g. 500 g for ₹260>","source":"<shop or site>"}]}
Use null for price if you cannot find a reliable figure.`;
  const text = await complete(s, prompt);
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, ''); // reasoning models (qwen, kimi) think out loud first
  const m = clean.match(/\{[\s\S]*\}/); // the model sometimes wraps the JSON in prose or ``` fences
  if (!m) throw new Error(`${P.label} did not return prices`);
  return JSON.parse(m[0]).prices || [];
}

// Updates every ingredient marked for automatic pricing. Returns a per-ingredient report.
async function update(db) {
  const s = db.settings;
  if (!keyOf(s)) throw new Error(`Add your ${provider(s).label} API key first`);
  const P = provider(s);
  const todo = db.ingredients.filter((i) => i.autoPrice);
  const report = [];
  let spent = 0;
  for (let n = 0; n < todo.length; n += BATCH) {
    const batch = todo.slice(n, n + BATCH);
    const context = {};
    if (usesExa(s)) {
      await Promise.all(batch.map(async (ing) => {
        try { const r = await exaSearch(s, ing, s.marketLocation || 'India'); context[ing.id] = r.text; spent += r.cost; }
        catch (e) { context[ing.id] = ''; } // no results -> the model estimates and the price is labelled as an estimate
      }));
    }
    let prices;
    try { prices = await ask(s, batch, context); } catch (e) { batch.forEach((i) => report.push({ name: i.name, ok: false, msg: e.message })); continue; }
    for (const ing of batch) {
      const p = prices.find((x) => String(x.id) === ing.id);
      const price = p && Number(p.price);
      if (!(price > 0)) { report.push({ name: ing.name, ok: false, msg: 'No reliable price found' }); continue; }
      const old = Number(ing.cost) || 0;
      if (old > 0 && (price > old * SANITY || price < old / SANITY)) {
        report.push({ name: ing.name, ok: false, msg: `Got ${price} per ${ing.unit} (${p.basis || 'no detail'}) — too far from your current ${old}, not applied` });
        continue;
      }
      ing.cost = Math.round(price * 10000) / 10000; // 4 decimals so per-gram prices stay accurate
      ing.market = { basis: String(p.basis || '') + (live(s) && (P.search || context[ing.id]) ? '' : ' · AI estimate'), source: String(p.source || ''), at: Date.now() };
      report.push({ name: ing.name, ok: true, cost: ing.cost, unit: ing.unit, ...ing.market });
    }
  }
  s.marketLastRun = Date.now();
  s.aiLastCost = Math.round(spent * 10000) / 10000; // dollars of Exa search, from Exa's own costDollars
  return report;
}

// Refresh once a day while the server is running (and shortly after start if it's overdue).
function schedule(store, after) {
  const tick = async () => {
    const db = store.db;
    if (!keyOf(db.settings) || !db.settings.marketAuto || !db.ingredients.some((i) => i.autoPrice)) return;
    if (Date.now() - (db.settings.marketLastRun || 0) < DAY - 60000) return;
    try { await update(db); after(); store.save(); } catch (e) { console.error('Price update failed:', e.message); }
  };
  setTimeout(tick, 10000);
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { update, schedule, PROVIDERS };
