// Pulls today's mandi (wholesale) prices from Agmarknet via data.gov.in and turns them into
// an estimated shop price per ingredient unit. Needs a free API key from data.gov.in.
const Costing = require('./public/js/costing');

const RESOURCE = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
const DAY = 24 * 60 * 60 * 1000;

const isoDate = (d) => String(d || '').replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1'); // Agmarknet uses dd/mm/yyyy
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function fetchRecords(apiKey, commodity, state) {
  const q = new URLSearchParams({ 'api-key': apiKey, format: 'json', limit: '100', 'filters[commodity]': commodity });
  if (state) q.set('filters[state]', state);
  const r = await fetch(`${RESOURCE}?${q}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`data.gov.in replied ${r.status}`);
  const j = await r.json();
  return (j.records || []).filter((x) => Number(x.modal_price) > 0);
}

// Median modal price across markets, in ₹ per kg (Agmarknet quotes ₹ per quintal = 100 kg).
async function lookup(apiKey, commodity, state) {
  let recs = state ? await fetchRecords(apiKey, commodity, state) : [];
  let scope = state;
  if (!recs.length) { recs = await fetchRecords(apiKey, commodity, ''); scope = 'All India'; }
  if (!recs.length) return null;
  const markets = [...new Set(recs.map((x) => x.market))];
  return {
    perKg: median(recs.map((x) => Number(x.modal_price))) / 100,
    date: recs.map((x) => isoDate(x.arrival_date)).sort().pop() || '',
    where: `${scope} · ${markets.length} market${markets.length === 1 ? '' : 's'}`,
  };
}

// Updates every ingredient linked to a market commodity. Returns a per-ingredient report.
async function update(db) {
  const s = db.settings;
  if (!s.marketApiKey) throw new Error('Add your data.gov.in API key first');
  const markup = Number(s.marketMarkup) || 0;
  const report = [];
  const cache = {};
  for (const ing of db.ingredients) {
    if (!ing.marketCommodity) continue;
    if (!Costing.UNITS[ing.unit] || Costing.UNITS[ing.unit][0] !== 'mass') {
      report.push({ name: ing.name, ok: false, msg: `Market prices are per kg — "${ing.unit}" can't be converted` });
      continue;
    }
    try {
      const key = ing.marketCommodity.toLowerCase();
      cache[key] = cache[key] || lookup(s.marketApiKey, ing.marketCommodity, s.marketState);
      const m = await cache[key];
      if (!m) { report.push({ name: ing.name, ok: false, msg: `No prices found for "${ing.marketCommodity}"` }); continue; }
      const extra = ing.marketMarkup === '' || ing.marketMarkup === undefined || ing.marketMarkup === null ? markup : Number(ing.marketMarkup) || 0;
      // 4 decimals so per-gram prices (₹0.0525/g) stay accurate
      ing.cost = Math.round(Costing.convert(m.perKg, ing.unit, 'kg') * (1 + extra / 100) * 10000) / 10000;
      ing.market = { perKg: Costing.round(m.perKg), markup: extra, date: m.date, where: m.where, at: Date.now() };
      report.push({ name: ing.name, ok: true, cost: ing.cost, ...ing.market });
    } catch (e) {
      report.push({ name: ing.name, ok: false, msg: e.message });
    }
  }
  s.marketLastRun = Date.now();
  return report;
}

// Refresh once a day while the server is running (and shortly after start if it's overdue).
function schedule(store, after) {
  const tick = async () => {
    const db = store.db;
    if (!db.settings.marketApiKey || !db.settings.marketAuto) return;
    if (Date.now() - (db.settings.marketLastRun || 0) < DAY - 60000) return;
    try { await update(db); after(); store.save(); } catch (e) { console.error('Market price update failed:', e.message); }
  };
  setTimeout(tick, 10000);
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { update, schedule, lookup };
