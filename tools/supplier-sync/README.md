# Supplier Sync (manual)

The scheduled GitHub Action can no longer refresh the supplier data: the Lark
base now requires a signed-in **user** token to read, which a headless cron
can't obtain (it needs an interactive browser login). Use this tool to refresh
the data by hand, then commit the files.

## Why it must run on port 9123

Lark only redirects back to a **redirect URI registered on the app**. This tool
reuses the same app + proxy as `mineski-stephen/lark-user-login`, whose
registered local redirect is `http://127.0.0.1:9123/`. So the tool must be
served at exactly that address (served as the folder's `index.html`).

## Steps

1. From the repo root, serve this folder on port 9123:

   ```bash
   python -m http.server 9123 --bind 127.0.0.1 --directory tools/supplier-sync
   ```

2. Open **http://127.0.0.1:9123/** (not any other host/port).
3. Click **Sign in to Lark** and approve in the browser.
4. Click **Fetch supplier data** → **Download suppliers.json**.
5. (Optional) pick your `data/catalog.json` → **Download rate-suggestions.json**.
6. Move the downloaded file(s) into `data/`, then commit & push:

   ```bash
   git add data/suppliers.json data/rate-suggestions.json
   git commit -m "Refresh supplier data (manual)"
   git push
   ```

## If the base moves again

Paste the new Lark base link into the box at step 1 — the tool parses
`app_token` / `table_id` / `view_id` from it. (Also update `js/config.js` and
`scripts/scrape_suppliers.py` if you want the old automated path to match.)

## If sign-in fails

- **redirect_uri mismatch** → you're not on `http://127.0.0.1:9123/`, or that
  URI isn't registered on the Lark app (ask Stephen to add it).
- **error 20010 (availability)** → your Lark user isn't in the app's
  availability range (ask Stephen / the Lark admin).
- **permission / empty** → your Lark user doesn't have access to the base.

The token is short-lived (~2h) and kept only in this tab's sessionStorage.
Nothing is stored in the repo.
