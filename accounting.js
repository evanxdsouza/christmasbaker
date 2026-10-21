// Double-entry books generated from orders, expenses and manual journal entries.
// Nothing is stored except the manual entries: the journal is rebuilt on every request,
// so editing an order or expense always keeps the books in step.
const { orderTotals } = require('./invoice');

const ACCOUNTS = [
  { code: '1000', name: 'Cash & bank', type: 'Asset' },
  { code: '1100', name: 'Customers owe you', type: 'Asset' },
  { code: '1500', name: 'Equipment', type: 'Asset' },
  { code: '2000', name: 'Customer advances', type: 'Liability' },
  { code: '2100', name: 'Loans & bills to pay', type: 'Liability' },
  { code: '3000', name: "Owner's capital", type: 'Equity' },
  { code: '3100', name: "Owner's drawings", type: 'Equity' },
  { code: '4000', name: 'Sales', type: 'Income' },
  { code: '4100', name: 'Delivery charges collected', type: 'Income' },
  { code: '4900', name: 'Discounts given', type: 'Income' }, // contra-income, normally a debit
  { code: '5000', name: 'Ingredients', type: 'Expense' },
  { code: '5100', name: 'Packaging', type: 'Expense' },
  { code: '5200', name: 'Delivery costs', type: 'Expense' },
  { code: '5300', name: 'Marketing', type: 'Expense' },
  { code: '5400', name: 'Gas & utilities', type: 'Expense' },
  { code: '5900', name: 'Other expenses', type: 'Expense' },
];
const EXPENSE_ACCOUNT = { Ingredients: '5000', Packaging: '5100', Delivery: '5200', Marketing: '5300', 'Gas & utilities': '5400', Equipment: '1500' };
const DEBIT_NORMAL = new Set(['Asset', 'Expense']);

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
const dr = (account, amount) => ({ account, debit: r2(amount), credit: 0 });
const cr = (account, amount) => ({ account, debit: 0, credit: r2(amount) });
const entry = (e) => ({ ...e, lines: e.lines.filter((l) => l.debit > 0 || l.credit > 0) });

function journal({ orders, expenses, journal: manual = [] }) {
  const out = [];
  for (const o of orders) {
    if (o.status === 'Cancelled' || o.status === 'Pending') continue;
    const t = orderTotals(o);
    if (o.status !== 'Delivered') {
      // Money taken before delivery is owed to the customer until the order is handed over
      if (t.paid > 0) out.push(entry({ date: day(o.created), ref: o.number, source: 'order', sourceId: o.id, memo: `Advance from ${o.customerName}`, lines: [dr('1000', t.paid), cr('2000', t.paid)] }));
      continue;
    }
    const at = ([...o.history].reverse().find((h) => h.status === 'Delivered') || {}).at || o.created;
    out.push(entry({
      date: day(at), ref: o.number, source: 'order', sourceId: o.id, memo: `Sale to ${o.customerName}`,
      lines: [
        dr('1000', t.paid),
        dr('1100', Math.max(0, t.total - t.paid)),
        dr('4900', t.discount),
        cr('4000', t.sub),
        cr('4100', t.shipping),
        cr('2000', Math.max(0, t.paid - t.total)), // overpaid: still owed back
      ],
    }));
  }
  for (const e of expenses) {
    out.push(entry({ date: e.date || day(e.created), ref: 'EXP', source: 'expense', sourceId: e.id, memo: e.title, lines: [dr(EXPENSE_ACCOUNT[e.category] || '5900', e.amount), cr('1000', e.amount)] }));
  }
  for (const m of manual) out.push(entry({ date: m.date, ref: 'JNL', source: 'manual', sourceId: m.id, memo: m.memo, lines: m.lines }));
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

function balances(entries) {
  const b = Object.fromEntries(ACCOUNTS.map((a) => [a.code, { ...a, debit: 0, credit: 0 }]));
  for (const e of entries) for (const l of e.lines) if (b[l.account]) { b[l.account].debit += l.debit; b[l.account].credit += l.credit; }
  for (const a of Object.values(b)) {
    a.debit = r2(a.debit); a.credit = r2(a.credit);
    a.balance = r2(DEBIT_NORMAL.has(a.type) ? a.debit - a.credit : a.credit - a.debit); // in the account's normal direction
  }
  return b;
}

// Profit & loss for [from, to]; balance sheet as at `to`.
function report(data, { from = '', to = '' } = {}) {
  const all = journal(data);
  const upTo = all.filter((e) => !to || e.date <= to);
  const period = upTo.filter((e) => !from || e.date >= from);
  const pb = balances(period);
  const bb = balances(upTo);
  const pick = (b, type) => Object.values(b).filter((a) => a.type === type && (a.debit || a.credit));
  const sum = (list) => r2(list.reduce((s, a) => s + a.balance, 0));

  const income = pick(pb, 'Income'), expense = pick(pb, 'Expense');
  const profit = r2(sum(income) - sum(expense));
  const profitToDate = r2(sum(pick(bb, 'Income')) - sum(pick(bb, 'Expense')));
  const assets = pick(bb, 'Asset'), liabilities = pick(bb, 'Liability'), equity = pick(bb, 'Equity');
  const equityTotal = r2(sum(equity) + profitToDate);

  const trial = Object.values(pb).filter((a) => a.debit || a.credit).map((a) => {
    const net = r2(a.debit - a.credit);
    return { code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  });
  const tDr = r2(trial.reduce((s, a) => s + a.debit, 0)), tCr = r2(trial.reduce((s, a) => s + a.credit, 0));

  return {
    accounts: ACCOUNTS,
    journal: period,
    trial: { rows: trial, debit: tDr, credit: tCr, balanced: Math.abs(tDr - tCr) < 0.01 },
    pnl: { income, expense, totalIncome: sum(income), totalExpense: sum(expense), profit },
    balanceSheet: {
      assets, liabilities, equity, profitToDate,
      totalAssets: sum(assets), totalLiabilities: sum(liabilities), totalEquity: equityTotal,
      balanced: Math.abs(sum(assets) - sum(liabilities) - equityTotal) < 0.01,
    },
    cash: bb['1000'].balance, receivable: bb['1100'].balance, advances: bb['2000'].balance,
  };
}

module.exports = { ACCOUNTS, journal, report };
