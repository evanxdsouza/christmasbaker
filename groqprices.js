// Looks up current retail prices for ingredients with Groq's web-searching model
// (groq/compound, on Groq's free plan) priced per each ingredient's own unit. Needs a free Groq API key.

const URL = 'https://api.groq.com/openai/v1/chat/completions';
const DAY = 24 * 60 * 60 * 1000;
const BATCH = 8; // ingredients per request
const SANITY = 4; // a new price more than 4× off the old one is reported, not applied

async function ask(s, items) {
  const where = s.marketLocation || 'India';
  const list = items.map((i, n) => `${n + 1}. id=${i.id} · ${i.marketQuery || i.name} · price per 1 ${i.unit}`).join('\n');
  const prompt = `Search the web for today's typical retail price in ${where} (in Indian rupees) for each baking ingredient below, as sold to a home baker in shops or on grocery apps (BigBasket, Blinkit, Amazon, local stores). Convert each to the price for exactly ONE of the unit given (e.g. per 1 g means divide a 500 g pack price by 500).

${list}

Reply with ONLY this JSON, nothing else:
{"prices":[{"id":"<id>","price":<number in INR per 1 unit>,"basis":"<pack and price you used, e.g. 500 g for ₹260>","source":"<shop or site>"}]}
Use null for price if you cannot find a reliable figure.`;
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.groqApiKey}` },
    body: JSON.stringify({ model: s.groqModel || 'groq/compound', temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`Groq replied ${r.status}${j.error && j.error.message ? ': ' + j.error.message : ''}`);
  }
  const text = (await r.json()).choices?.[0]?.message?.content || '';
  const m = text.match(/\{[\s\S]*\}/); // the model sometimes wraps the JSON in prose or ``` fences
  if (!m) throw new Error('Groq did not return prices');
  return JSON.parse(m[0]).prices || [];
}

// Updates every ingredient marked for automatic pricing. Returns a per-ingredient report.
async function update(db) {
  const s = db.settings;
  if (!s.groqApiKey) throw new Error('Add your Groq API key first');
  const todo = db.ingredients.filter((i) => i.autoPrice);
  const report = [];
  for (let n = 0; n < todo.length; n += BATCH) {
    const batch = todo.slice(n, n + BATCH);
    let prices;
    try { prices = await ask(s, batch); } catch (e) { batch.forEach((i) => report.push({ name: i.name, ok: false, msg: e.message })); continue; }
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
      ing.market = { basis: String(p.basis || ''), source: String(p.source || ''), at: Date.now() };
      report.push({ name: ing.name, ok: true, cost: ing.cost, unit: ing.unit, ...ing.market });
    }
  }
  s.marketLastRun = Date.now();
  return report;
}

// Refresh once a day while the server is running (and shortly after start if it's overdue).
function schedule(store, after) {
  const tick = async () => {
    const db = store.db;
    if (!db.settings.groqApiKey || !db.settings.marketAuto || !db.ingredients.some((i) => i.autoPrice)) return;
    if (Date.now() - (db.settings.marketLastRun || 0) < DAY - 60000) return;
    try { await update(db); after(); store.save(); } catch (e) { console.error('Price update failed:', e.message); }
  };
  setTimeout(tick, 10000);
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { update, schedule };
