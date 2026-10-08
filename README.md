# The Christmas Baker

Order, product, invoice and tracking manager for a home bakery.

    npm install
    npm start        # http://localhost:3000

Data lives in `data/db.json`, uploads in `uploads/` (Settings → Download backup exports the data).

- **Dashboard** – open orders, sales, pending payments, profit, best sellers, low ingredients
- **Orders** – list or board view, status flow (New → Delivered), payments/advances, WhatsApp updates, invoice PDF
- **Products** – photos, sizes/prices, cost & margin, stock, lead time, hide/show
- **Recipes & costing** – a recipe per size (batch yield, ingredients in g/kg/ml/l/pcs, your minutes, gas minutes, packaging); works out the cost per piece including your time (₹/hour) and gas (cylinder price ÷ hours it lasts) and keeps product costs up to date when ingredient prices or rates change
- **Assets** – library for logos, photos, packaging, PDFs
- **Customers** – built automatically from orders, with history
- **Ingredients**, **Expenses** – stock alerts and real profit
- **Automatic prices** – tick "Look up price automatically" on an ingredient and its cost is refreshed daily (or on demand) using a free AI API: **Groq** (web search, so today's shop prices; `groq/compound`, falling back to `openai/gpt-oss-120b` with browser search) or **Hack Club AI** (`ai.hackclub.com`: its Exa web search finds shop listings, `qwen/qwen3-32b` reads them; ~1¢ per ingredient, switchable off for AI estimates only). Prices more than 4× away from the current one are reported, not applied
- **Accounts** – simple summary (income, expenses, profit, cash, what customers owe) with a Double-entry view: journal generated from orders and expenses, trial balance, ledgers, P&L, balance sheet, manual journal entries (owner's money, loans) and CSV export
- **/track** – public page customers use with their tracking code
- **Invoices** – `/api/orders/:id/invoice.pdf`, numbered TCB-0001…, FSSAI number and thank-you text from Settings
