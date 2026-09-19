# The Christmas Baker

Order, product, invoice and tracking manager for a home bakery.

    npm install
    npm start        # http://localhost:3000

Data lives in `data/db.json`, uploads in `uploads/` (Settings → Download backup exports the data).

- **Dashboard** – open orders, sales, pending payments, profit, best sellers, low ingredients
- **Orders** – list or board view, status flow (New → Delivered), payments/advances, WhatsApp updates, invoice PDF
- **Products** – photos, sizes/prices, cost & margin, stock, lead time, hide/show
- **Assets** – library for logos, photos, packaging, PDFs
- **Customers** – built automatically from orders, with history
- **Ingredients**, **Expenses** – stock alerts and real profit
- **/track** – public page customers use with their tracking code
- **Invoices** – `/api/orders/:id/invoice.pdf`, numbered TCB-0001…, FSSAI number and thank-you text from Settings
