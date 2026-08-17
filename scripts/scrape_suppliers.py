#!/usr/bin/env python3
"""
scrape_suppliers.py  --  MG Ballpark supplier-data scraper + rate-suggestion draft

Fetches procurement PO history from the coworker's Lark base (through his public
CORS proxy) and writes two static files into data/:

  data/suppliers.json        approved supplier price rows (the lookup panel reads
                             this instead of hammering the proxy live).
  data/rate-suggestions.json a DRAFT proposal that matches procurement items to
                             the catalog's 702 services and suggests base_rate
                             updates from real supplier prices. NEVER auto-applied
                             to catalog.json — a human reviews/applies via admin.

Stdlib only (urllib/json/re/statistics), so it runs unchanged on a GitHub Actions
runner with no pip install. The proxy holds the Lark credentials, so no secret is
needed here; larkAppToken / larkTableId are public config (mirrors js/config.js).

Exit codes: 0 = wrote files; 3 = too few records fetched (kept existing files).
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from statistics import median

# ---- Config (public; mirrors js/config.js) --------------------------------
PROXY = os.environ.get("SUPPLIER_PROXY", "https://lark-proxy-dwiw.onrender.com").rstrip("/")
LARK_APP_TOKEN = os.environ.get("LARK_APP_TOKEN", "WW2pb1ht1aSTEDstV1qlTR2Igpe")
LARK_TABLE_ID = os.environ.get("LARK_TABLE_ID", "tblvHDMbE51scSwf")
LARK_HOST = "https://open.larksuite.com"
PAGE_SIZE = 500
MAX_PAGES = 200
TIMEOUT = 120  # seconds; the proxy (Render free tier) can cold-start ~30-60s

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
SUPPLIERS_OUT = os.path.join(DATA_DIR, "suppliers.json")
SUGGEST_OUT = os.path.join(DATA_DIR, "rate-suggestions.json")
CATALOG_IN = os.path.join(DATA_DIR, "catalog.json")

MIN_RECORDS = 50  # sanity floor: below this we assume a bad fetch and don't clobber


# ---- Lark cell flattening -------------------------------------------------
def cell_text(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, list):
        out = []
        for e in v:
            if e is None:
                continue
            if isinstance(e, (str, int, float)):
                out.append(str(e))
            elif isinstance(e, dict):
                out.append(e.get("text") or e.get("name") or e.get("en_name") or e.get("email") or "")
        return ", ".join([x for x in out if x])
    if isinstance(v, dict):
        return v.get("text") or v.get("name") or ""
    return ""


def to_number(v):
    t = re.sub(r"[^0-9.\-]", "", cell_text(v))
    try:
        return float(t)
    except ValueError:
        return None


def fmt_date(v):
    try:
        n = float(v if not isinstance(v, (list, dict)) else cell_text(v))
    except (ValueError, TypeError):
        return ""
    if not n or n <= 0:
        return ""
    # Asia/Manila (UTC+8); n is epoch ms.
    t = time.gmtime((n / 1000.0) + 8 * 3600)
    return time.strftime("%Y-%m-%d", t)


def map_record(f):
    return {
        "item": cell_text(f.get("Particulars_Item")),
        "unitPrice": to_number(f.get("Particulars_Unit Price")),
        "currency": (cell_text(f.get("Particulars_Unit Price-Currency")) or "PHP").upper(),
        "qty": cell_text(f.get("Particulars_Quantity")),
        "supplier": cell_text(f.get("Supplier Details_Supplier Name")),
        "project": cell_text(f.get("Project Name")),
        "status": cell_text(f.get("Status")),
        "date": fmt_date(f.get("Completed at") or f.get("Submitted at")),
    }


# ---- Networking -----------------------------------------------------------
def http_json(req, retries=3):
    # The proxy (Render free tier) cold-starts after idle, so the first call can
    # time out while it wakes. Retry a few times with backoff before giving up.
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - transient network/cold-start
            last = e
            if attempt < retries - 1:
                wait = 10 * (attempt + 1)
                print("  request failed (%s); retrying in %ds..." % (e, wait))
                time.sleep(wait)
    raise last


def get_token():
    return http_json(urllib.request.Request(PROXY + "/token"))


def search_url(page_token=""):
    u = (LARK_HOST + "/open-apis/bitable/v1/apps/" + LARK_APP_TOKEN +
         "/tables/" + LARK_TABLE_ID + "/records/search?page_size=" + str(PAGE_SIZE))
    if page_token:
        u += "&page_token=" + urllib.parse.quote(page_token)
    return u


def fetch_all():
    tok = get_token()
    if not tok or tok.get("code") != 0 or not tok.get("app_access_token"):
        raise RuntimeError("token request failed: " + json.dumps(tok)[:200])
    token = tok["app_access_token"]

    rows = []
    page_token, pages, has_more = "", 0, True
    while has_more and pages < MAX_PAGES:
        target = PROXY + "/proxy?url=" + urllib.parse.quote(search_url(page_token), safe="")
        req = urllib.request.Request(
            target, data=b"{}", method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        )
        j = http_json(req)
        if j.get("code") != 0:
            if pages == 0:
                raise RuntimeError("Lark error: " + json.dumps(j)[:200])
            break
        d = j.get("data") or {}
        for it in (d.get("items") or []):
            rows.append(map_record(it.get("fields") or {}))
        has_more = bool(d.get("has_more"))
        page_token = d.get("page_token") or ""
        pages += 1
        print("  page %d - %d records so far" % (pages, len(rows)))
        if has_more and not page_token:
            break
        if has_more:
            time.sleep(0.12)
    return rows


# ---- Rate-suggestion matching (fuzzy; draft only) -------------------------
STOP = set("per day pcs pc set sets unit units of the a an and or for with to hrs hr hour "
           "hours pax lot lots ea each x rate fee".split())


def tokens(s):
    s = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    return set(t for t in s.split() if t and t not in STOP and len(t) > 1)


def jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / float(len(a | b)) if inter else 0.0


def build_suggestions(catalog, supplier_rows, usd_php):
    services = catalog.get("services", [])
    # Pre-tokenize approved PHP-priced supplier rows (convert USD->PHP for compare).
    priced = []
    for r in supplier_rows:
        if r["unitPrice"] is None or r["unitPrice"] <= 0 or not r["item"]:
            continue
        php = r["unitPrice"] * (usd_php if r["currency"] == "USD" else 1.0)
        priced.append((tokens(r["item"]), php, r))

    suggestions = []
    for s in services:
        st = tokens(s.get("name", ""))
        if not st:
            continue
        matches = []
        for it_tok, php, r in priced:
            sim = jaccard(st, it_tok)
            if sim >= 0.5:
                matches.append((sim, php, r))
        if len(matches) < 2:
            continue
        prices = [m[1] for m in matches]
        suggested = round(median(prices), 2)
        current = float(s.get("base_rate") or 0)
        # Only surface a meaningful change (>5% and >= PHP 1 difference).
        if current > 0 and abs(suggested - current) / current < 0.05:
            continue
        matches.sort(key=lambda m: m[0], reverse=True)
        avg_sim = sum(m[0] for m in matches) / len(matches)
        suggestions.append({
            "service_id": s.get("id"),
            "service_name": s.get("name"),
            "category": s.get("category"),
            "current_base_rate": current,
            "suggested_base_rate": suggested,
            "match_count": len(matches),
            "confidence": "high" if (len(matches) >= 3 and avg_sim >= 0.6) else "low",
            "basis": "median of %d matched supplier price(s), PHP-normalized" % len(matches),
            "sample_matches": [
                {"item": m[2]["item"], "price_php": round(m[1], 2),
                 "supplier": m[2]["supplier"], "similarity": round(m[0], 2)}
                for m in matches[:5]
            ],
        })
    # Most confident / largest sample first.
    suggestions.sort(key=lambda x: (x["confidence"] == "high", x["match_count"]), reverse=True)
    return suggestions


# ---- Main -----------------------------------------------------------------
def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    print("Fetching supplier records from %s ..." % PROXY)
    all_rows = fetch_all()
    approved = [r for r in all_rows if (not r["status"] or re.search(r"approved", r["status"], re.I))
                and r["item"] and r["unitPrice"] is not None]
    print("Fetched %d rows (%d approved with a price)." % (len(all_rows), len(approved)))

    if len(approved) < MIN_RECORDS:
        print("Too few records (%d < %d) - keeping existing files, exiting 3." % (len(approved), MIN_RECORDS))
        return 3

    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Sort cheapest-first for a stable, review-friendly file.
    approved.sort(key=lambda r: (r["item"].lower(), r["unitPrice"]))
    with open(SUPPLIERS_OUT, "w", encoding="utf-8") as f:
        json.dump({"_generated": stamp, "count": len(approved), "rows": approved},
                  f, ensure_ascii=False, indent=1)
    print("Wrote %s (%d rows)." % (SUPPLIERS_OUT, len(approved)))

    usd_php = 55.89
    suggestions = []
    if os.path.exists(CATALOG_IN):
        with open(CATALOG_IN, encoding="utf-8") as f:
            catalog = json.load(f)
        usd_php = float((catalog.get("settings") or {}).get("usd_php_rate") or usd_php)
        suggestions = build_suggestions(catalog, approved, usd_php)
    with open(SUGGEST_OUT, "w", encoding="utf-8") as f:
        json.dump({
            "_generated": stamp,
            "note": "DRAFT ONLY - not applied to catalog.json. Review each suggestion and "
                    "apply the ones you trust via the admin page, then Export catalog.json.",
            "usd_php_rate_used": usd_php,
            "count": len(suggestions),
            "suggestions": suggestions,
        }, f, ensure_ascii=False, indent=1)
    print("Wrote %s (%d suggestions)." % (SUGGEST_OUT, len(suggestions)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
