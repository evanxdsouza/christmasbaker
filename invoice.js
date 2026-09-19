// Renders an invoice PDF in The Christmas Baker's format:
// centred logo, INVOICE title, FSSAI/date/customer block, grey-headed table, green thank-you line.
const PDFDocument = require('pdfkit');
const path = require('path');

const F = (f) => path.join(__dirname, 'fonts', f);
const GREEN = '#0a7a0a';
const money = (n) => String(Math.round((Number(n) || 0) * 100) / 100);

function orderTotals(o) {
  const sub = (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const shipping = Number(o.shipping) || 0;
  const discount = Number(o.discount) || 0;
  const total = sub + shipping - discount;
  const paid = Number(o.amountPaid) || 0;
  return { sub, shipping, discount, total, paid, balance: total - paid };
}

function renderInvoice(order, settings, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice ${order.invoiceNo || order.number}`, Author: settings.businessName } });
  doc.registerFont('R', F('LiberationSans-Regular.ttf'));
  doc.registerFont('B', F('LiberationSans-Bold.ttf'));
  doc.registerFont('U', F('DejaVuSans.ttf')); // Liberation lacks the ₹ glyph, so headers fall back to DejaVu
  doc.registerFont('UB', F('DejaVuSans-Bold.ttf'));
  doc.pipe(res);

  const W = doc.page.width;
  const L = 60, R = W - 60, TW = R - L;
  const cur = settings.currency || '₹';
  const t = orderTotals(order);

  // Logo: crop the chef + wordmark out of the wreath artwork
  const src = path.join(__dirname, 'public', 'logo-wreath.png');
  const cw = 150, s = cw / 245, ch = 318 * s;
  doc.save().rect((W - cw) / 2, 40, cw, ch).clip();
  doc.image(src, (W - cw) / 2 - 395 * s, 40 - 328 * s, { width: 1031 * s });
  doc.restore();

  let y = 40 + ch + 25;
  doc.font('B').fontSize(24).fillColor('#000').text('INVOICE', 0, y, { align: 'center', width: W });
  y += 45;

  doc.font('R').fontSize(11);
  const line = (txt) => { doc.text(txt, L, y); y += 15; };
  if (settings.fssai) line(`FSSAI No: ${settings.fssai}`);
  line(`Invoice No: ${order.invoiceNo || order.number}`);
  line(`Date: ${new Date(order.invoiceDate || order.created).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`);
  y += 12;
  line(`Customer: ${order.customerName}`);
  if (order.phone) line(`Phone: ${order.phone}`);
  if (order.address) { const h = doc.heightOfString(`Address: ${order.address}`, { width: TW }); doc.text(`Address: ${order.address}`, L, y, { width: TW }); y += h + 4; }
  const cakeNames = [...new Set((order.items || []).map((i) => i.name))].join(', ');
  line(`Cake: ${cakeNames || 'Custom order'}`);
  const qty = (order.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
  line(`Quantity: ${qty || '—'}`);
  y += 16;

  // Table
  const cols = [0.46, 0.14, 0.2, 0.2].map((f) => f * TW);
  const xs = [L]; cols.forEach((c, i) => xs.push(xs[i] + c));
  const rowH = 26;
  const cell = (i, txt, yy, o = {}) => {
    const pad = 8;
    doc.font(o.uni ? (o.bold ? 'UB' : 'U') : o.bold ? 'B' : 'R').fontSize(o.uni ? 10 : 11).fillColor('#000');
    // money columns use the DejaVu font so ₹ shows
    doc.text(String(txt), xs[i] + pad, yy + 8, { width: cols[i] - pad * 2, align: o.align || 'left', lineBreak: false });
  };
  const rowBox = (yy, fill) => {
    if (fill) doc.rect(L, yy, TW, rowH).fill(fill);
    doc.lineWidth(1.2).strokeColor('#000').rect(L, yy, TW, rowH).stroke();
    xs.slice(1, -1).forEach((x) => doc.moveTo(x, yy).lineTo(x, yy + rowH).stroke());
  };

  rowBox(y, '#d3d3d3');
  cell(0, 'Description', y, { bold: true });
  cell(1, 'Qty', y, { bold: true });
  cell(2, `Unit Price (${cur})`, y, { bold: true, align: 'center', uni: true });
  cell(3, `Line Total (${cur})`, y, { bold: true, align: 'center', uni: true });
  y += rowH;

  const rows = (order.items || []).map((i) => [i.description || i.name, i.qty, money(i.unitPrice), money(i.qty * i.unitPrice)]);
  const extra = [];
  extra.push(['Shipping', '', '', t.shipping ? money(t.shipping) : '']);
  if (t.discount) extra.push(['Discount', '', '', '-' + money(t.discount)]);
  extra.push(['Total', '', '', money(t.total), true]);
  if (t.paid) { extra.push(['Paid', '', '', money(t.paid)]); extra.push(['Balance Due', '', '', money(t.balance), true]); }

  for (const r of [...rows, ...extra]) {
    if (y > doc.page.height - 130) { doc.addPage(); y = 60; }
    rowBox(y);
    const bold = r[4];
    cell(0, r[0], y, { bold });
    cell(1, r[1], y, { align: 'center' });
    cell(2, r[2], y, { align: 'center' });
    cell(3, r[3], y, { align: 'center', bold });
    y += rowH;
  }

  y += 40;
  doc.font('R').fontSize(12).fillColor(GREEN).text(settings.thankYou, L, y, { width: TW });
  if (settings.paymentNote) { y = doc.y + 14; doc.fillColor('#333').fontSize(10).text(settings.paymentNote, L, y, { width: TW }); }
  if (order.notes) { y = doc.y + 10; doc.fillColor('#555').fontSize(10).text('Note: ' + order.notes, L, y, { width: TW }); }
  doc.end();
}

module.exports = { renderInvoice, orderTotals };
