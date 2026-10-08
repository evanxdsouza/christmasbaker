// Tiny JSON-file store. Fine for one home baker; swap for SQLite if it ever grows.
const fs = require('fs');
const path = require('path');

// STORAGE_DIR lets a container keep data + uploads on a mounted volume
const STORAGE = process.env.STORAGE_DIR || __dirname;
const FILE = path.join(STORAGE, 'data', 'db.json');

const DEFAULTS = {
  settings: {
    businessName: 'The Christmas Baker',
    tagline: 'Taste the magic of Christmas',
    fssai: '21224192003360',
    phone: '',
    instagram: '@the_christmasbaker',
    address: '',
    currency: '₹',
    thankYou: 'Thank you for choosing our Christmas creations. May your season be warm, bright, and filled with joy. Merry Christmas!',
    paymentNote: '',
    nextInvoiceNo: 1,
    invoicePrefix: 'TCB-',
    labourRate: 150, // what an hour of your time is worth
    gasCylinderPrice: 900,
    gasCylinderHours: 40, // hours of oven/stove use one cylinder lasts
    aiProvider: 'groq', // 'groq' (web search) or 'hackclub' (Hack Club AI)
    groqApiKey: '', // free key from console.groq.com
    hackclubApiKey: '', // key from ai.hackclub.com
    hackclubModel: '', // optional: force a specific Hack Club AI model
    hackclubSearch: true, // use Hack Club's Exa web search so prices are real, not estimates
    marketLocation: '', // city / state prices are looked up for
    marketAuto: true,
    marketLastRun: 0,
  },
  products: [],
  customers: [],
  orders: [],
  assets: [],
  ingredients: [],
  expenses: [],
  journal: [], // manual double-entry entries (owner money, loans…)
};

let db;

function load() {
  try {
    db = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    db.settings = { ...DEFAULTS.settings, ...db.settings };
  } catch {
    db = structuredClone(DEFAULTS);
    seed();
    save();
  }
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE); // atomic, so a crash can't leave half a file
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function seed() {
  db.products = [
    { id: uid(), name: 'Traditional Fruit Cake', category: 'Cakes', description: 'Rich, rum-soaked Christmas fruit cake, baked slow and matured.', variants: [{ label: '400 g', price: 690, cost: 380 }, { label: '750 g', price: 1150, cost: 640 }], image: '', active: true, stock: null, leadDays: 3, created: Date.now() },
    { id: uid(), name: 'Gingerbread Cookies', category: 'Cookies', description: 'Crisp, spiced gingerbread men. Box of 12.', variants: [{ label: 'Box of 12', price: 450, cost: 190 }], image: '', active: true, stock: null, leadDays: 2, created: Date.now() },
    { id: uid(), name: 'Star Mince Pies', category: 'Pastries', description: 'Buttery shortcrust with homemade mincemeat. Box of 6.', variants: [{ label: 'Box of 6', price: 520, cost: 240 }], image: '', active: true, stock: null, leadDays: 2, created: Date.now() },
    { id: uid(), name: 'Kulkuls', category: 'Sweets', description: 'Traditional Goan Christmas curls, sugar-glazed.', variants: [{ label: '250 g', price: 300, cost: 130 }, { label: '500 g', price: 560, cost: 250 }], image: '', active: true, stock: null, leadDays: 2, created: Date.now() },
    { id: uid(), name: 'Christmas Gift Tin', category: 'Gift Boxes', description: 'Red ribboned tin with cake and a handwritten Merry Christmas card.', variants: [{ label: 'Small tin', price: 850, cost: 470 }], image: '', active: true, stock: null, leadDays: 4, created: Date.now() },
  ];
  db.ingredients = [
    { id: uid(), name: 'Plain flour (maida)', unit: 'kg', stock: 8, reorder: 3, cost: 48 },
    { id: uid(), name: 'Butter', unit: 'kg', stock: 2, reorder: 2, cost: 560 },
    { id: uid(), name: 'Dark rum', unit: 'ml', stock: 900, reorder: 500, cost: 1.2 },
    { id: uid(), name: 'Mixed dried fruit', unit: 'kg', stock: 5, reorder: 2, cost: 620 },
  ];
}

load();

const collections = ['products', 'customers', 'orders', 'assets', 'ingredients', 'expenses', 'journal'];

module.exports = { STORAGE, get db() { return db; }, save, uid, collections };
