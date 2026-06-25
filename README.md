# MG Ballpark — Service Package Calculator

A lightweight, static web app for generating **ballpark budget estimates** for service
packages. Clients enter the quantities they need and get an estimated budget range; an
internal admin panel manages the underlying catalog and pricing knobs.

---

## 1. Overview

**MG Ballpark** is a zero-build, static site (plain HTML + vanilla JS) backed by
[Supabase](https://supabase.com) for data storage. It has two pages:

- **Client calculator (`index.html`)** — the customer-facing estimator. It pulls the
  service catalog from Supabase, lets the client pick quantities, logistics location,
  and VAT/fabrication options, then shows an itemized estimate and a budget range.
  A **hidden 30% markup** is applied client-side on top of every internal base rate, so
  clients only ever see selling prices — never the raw cost.
- **Admin panel (`admin.html`)** — an internal page to manage categories and services
  (add / edit / delete), set base rates, flag fabrication items, and tune the ASF %,
  VAT %, and USD → PHP rate.

The seed catalog (~700 services) is generated from the company rate cards (Labor Rates +
Asset Rates V2). The client page includes a search box, an optional discount, and shows
PHP totals with an indicative USD equivalent.

The catalog, pricing settings, and seed data all live in **Supabase** (Postgres). The
whole thing is designed to be hosted for free on **GitHub Pages** — no server, no build
step, no backend code to deploy.

---

## 2. Business Rules Summary

| Rule | Value / Behavior |
| --- | --- |
| **Hidden markup** | Every internal `base_rate` is multiplied by **1.30** (cost + **30%**) client-side. Clients never see the base cost. |
| **ASF** (Agency Service Fee) | Default **12.5%** of the subtotal. Adjustable in the admin panel. |
| **VAT** | Default **12%**, computed on **subtotal + ASF**. Toggleable per client. |
| **Non-VAT clients** | When the "Non-VAT Client" toggle is on, VAT is treated as already **tucked into each service rate** — no separate VAT line is shown. |
| **Discount** | Optional. Entered as a PHP amount, applied **after ASF and before VAT** (matching the company quote sheet). Clamped so it can't exceed subtotal + ASF. |
| **Budget range (high end)** | Standard packages add **+50%** to the base total. If **any fabrication** service is included, the high end uses **+70%** instead, to account for scope variability. |
| **Fabrication detection** | Fabrication applies if the manual "Includes Fabrication Services" toggle is on **or** any service flagged `is_fabrication` is selected with quantity > 0. |
| **Logistics location** | Client selects one delivery location: Metro Manila, Luzon, Visayas, Mindanao, SEA, APAC, or Others. |
| **Line items shown** | Only services with **quantity > 0** appear in the results table. |
| **Currency** | Philippine Peso (₱), 2 decimal places. The base total and budget range also show an indicative **USD** equivalent, converted at the admin-set **USD → PHP rate** (default 55.89). |

---

## 3. Supabase Setup

1. Create a free account and a new project at **[supabase.com](https://supabase.com)**.
   Pick a region and a strong database password (the password isn't needed by this app).
2. In the project dashboard, open **SQL Editor** → **New query**.
3. Open [`sql/schema.sql`](sql/schema.sql) from this repo, copy its **entire** contents,
   paste into the editor, and click **Run**.
   - This creates the three tables (`settings`, `categories`, `services`), inserts the
     single settings row, and seeds demo categories + services.
   - The script is **safe to re-run** — it drops and recreates the tables each time
     (you get a clean slate, but you also lose any edits you made in the admin panel).

### Seed data (from the company rate cards)

`schema.sql` seeds **~700 services across 18 categories**, generated from the company
rate sheet (the **Labor Rates** and **Asset Rates V2** tabs). All `base_rate` values are
internal **costs in PHP**; the client app applies the hidden markup on top.

- **Manpower (Crew Day Rates)** — 24 internal roles with day rates (from Labor Rates).
- **Asset categories** — Venue & Spaces, Permits & Safety, Internet & Network, Power &
  Electrical, Camera & Grip, Lighting, Audio, LED & Display, Truss/Stage/Rigging,
  Fabrication & Signage (flagged `is_fabrication`), Awards & Print, Transport & Logistics,
  Furniture & Decor, Special Effects, Merchandise & Apparel, IT & Computing, and Other
  Equipment (from Asset Rates V2).

Rows that were **excluded** from the source sheet: zero-rate items, named individuals
(e.g. specific hosts/casters), and social-media/bot services. Everything is editable in
the **admin panel** (`admin.html`) — add, edit, delete, or reclassify as needed. The
client page has a **search box** to navigate the large catalog.

### Row Level Security (RLS)

This is an unauthenticated demo. The admin panel writes to the database directly using
the public **anon key**, so:

- **Keep RLS disabled** on `settings`, `categories`, and `services` (the default after
  running `schema.sql`), **or**
- If you enable RLS, you must add **permissive policies** for the `anon` role. The bottom
  of `schema.sql` includes ready-to-paste `CREATE POLICY ... FOR ALL TO anon USING (true)
  WITH CHECK (true)` examples.

> ⚠️ **Security trade-off:** the anon key is public (it ships in the static site), so with
> RLS disabled or fully permissive, **anyone with the URL can read and write** your data.
> That's acceptable for an **internal or demo** tool, but **not** for untrusted public use.
> See [Security note](#9-security-note) below.

---

## 4. Configure

Open [`js/config.js`](js/config.js) and replace the two placeholder constants near the top:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Find these values in your Supabase dashboard under
**Project Settings → API**:

- `SUPABASE_URL` → the **Project URL**
- `SUPABASE_ANON_KEY` → the **`anon` / `public`** key

> Use the **anon / public** key only. **Never** put the `service_role` key here — it would
> be exposed in the static site and grants full admin access to your database.

---

## 5. Run Locally

Because the app loads the Supabase library from a CDN and uses `fetch`, it must be served
over **HTTP** — opening `index.html` directly via `file://` can break the CDN/network
requests. Serve the project folder from its root with any static server:

**Python (built in on most systems):**

```bash
cd D:/GitHub/MGBallpark
python -m http.server 8000
```

Then open **http://localhost:8000/** (calculator) and
**http://localhost:8000/admin.html** (admin).

**VS Code Live Server:** install the *Live Server* extension, right-click `index.html`,
and choose **"Open with Live Server."**

---

## 6. Deploy to GitHub Pages

1. Make sure `js/config.js` has your real Supabase credentials, then commit and push:

   ```bash
   git add .
   git commit -m "Configure Supabase credentials"
   git push origin main
   ```

2. On GitHub, go to the repo's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose
   the **`main`** branch and the **`/ (root)`** folder, then **Save**.
4. Wait a minute or two for the build, then refresh — GitHub will show the live URL.

Your site will live at:

- **Calculator:** `https://<user>.github.io/<repo>/`
- **Admin panel:** `https://<user>.github.io/<repo>/admin.html`

(Replace `<user>` with your GitHub username and `<repo>` with this repository's name.)

---

## 7. Using the Admin Panel

Open `admin.html` (locally or on the deployed site) to manage everything the calculator
reads:

- **Global settings** — adjust the **ASF %**, **VAT %**, and the **USD → PHP rate**. The
  percentages are stored as fractions in the `settings` table (e.g. `0.125` = 12.5%); the
  FX rate is a plain number (PHP per USD). All apply across every estimate.
- **Categories** — add, edit, or delete categories (e.g. Manpower, Lighting, Audio), set their
  description and display order.
- **Services** — add, edit, or delete services under each category; set the **base rate**
  (internal cost), **unit** label, and display order.
- **Fabrication flag** — toggle **`is_fabrication`** on services that should bump the
  high-end budget multiplier from +50% to +70% when selected.

Changes save directly to Supabase and take effect immediately in the calculator.

---

## 8. File Structure

```
MGBallpark/
├── index.html          # Client calculator page
├── admin.html          # Admin management page
├── README.md           # This file
├── .gitattributes
├── css/
│   └── style.css       # Shared styles (referenced by both pages)
├── js/
│   ├── config.js       # Supabase credentials + business-rule constants + helpers
│   ├── calculator.js   # Client calculator logic (markup, totals, budget range)
│   └── admin.js        # Admin panel CRUD logic
└── sql/
    └── schema.sql      # Tables + seed data (run once in Supabase SQL Editor)
```

Script load order on every page: **Supabase CDN → `js/config.js` → page script**
(`calculator.js` for `index.html`, `admin.js` for `admin.html`).

---

## 9. Security Note

The Supabase **anon key is public** — it is embedded in this static site and visible to
anyone. With RLS disabled (or with fully permissive `anon` policies), **anyone with the
site URL can read and modify** the catalog and settings. This is intentional for a simple
**internal / demo** tool. **Do not** expose it to untrusted public users without adding
proper authentication and restrictive RLS policies, and **never** ship the `service_role`
key in the client.
