/* =====================================================================
 * suppliers.js  --  Live supplier-price reference for MG Ballpark
 * =====================================================================
 *
 *  Pulls real procurement prices (approved POs) from a coworker's Lark base,
 *  through his public CORS proxy (SUPPLIER_PROXY / LARK_APP_TOKEN /
 *  LARK_TABLE_ID in config.js). This is a READ-ONLY REFERENCE panel — it never
 *  feeds the ballpark math. The proxy holds the Lark credentials, so no secret
 *  lives here.
 *
 *  Fetch protocol (mirrors the coworker's js/lark.js):
 *    GET  {proxy}/token                      -> { code:0, app_access_token }
 *    POST {proxy}/proxy?url=<lark search url> (Bearer token, body "{}")
 *      -> { data: { items:[{fields}], has_more, page_token, total } }
 *
 *  The whole thing degrades gracefully: if the proxy is asleep/down, the panel
 *  shows a message and the calculator keeps working.
 * ===================================================================== */

window.Suppliers = (function () {
  'use strict';

  var LARK_HOST = 'https://open.larksuite.com';
  var PAGE_SIZE = 500;
  var MAX_PAGES = 200;
  var PAGE_DELAY_MS = 120;
  var CACHE_KEY = 'mgb_supplier_rows_v1';
  var DISPLAY_LIMIT = 300; // cap rendered rows for performance

  var rows = null;       // cached mapped+approved rows
  var inflight = null;   // Promise while a fetch is running
  var generatedAt = null; // snapshot timestamp when loaded from the static file
  var source = null;     // 'snapshot' | 'live'

  function configured() {
    return typeof supplierLookupConfigured === 'function' && supplierLookupConfigured();
  }
  function proxyBase() {
    return String(typeof SUPPLIER_PROXY !== 'undefined' ? SUPPLIER_PROXY : '').replace(/\/+$/, '');
  }

  /* ---- Lark cell flattening (values arrive as string/number/array/object) -- */
  function cellText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      return v.map(function (e) {
        if (e == null) return '';
        if (typeof e === 'string' || typeof e === 'number') return String(e);
        if (typeof e !== 'object') return '';
        return e.text || e.name || e.en_name || e.email || '';
      }).filter(Boolean).join(', ');
    }
    if (typeof v === 'object') return v.text || v.name || '';
    return '';
  }
  function num(v) {
    var t = cellText(v).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(t);
    return isNaN(n) ? null : n;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmtDate(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return '';
    var d = new Date(n + 8 * 3600 * 1000); // Asia/Manila
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /* ---- One record -> lean row -------------------------------------------- */
  function mapRecord(f) {
    f = f || {};
    return {
      item: cellText(f['Particulars_Item']),
      unitPrice: num(f['Particulars_Unit Price']),
      currency: cellText(f['Particulars_Unit Price-Currency']) || 'PHP',
      qty: cellText(f['Particulars_Quantity']),
      supplier: cellText(f['Supplier Details_Supplier Name']),
      project: cellText(f['Project Name']),
      status: cellText(f['Status']),
      date: fmtDate(f['Completed at'] || f['Submitted at']),
    };
  }

  /* ---- Networking -------------------------------------------------------- */
  async function getToken() {
    var resp = await fetch(proxyBase() + '/token');
    var json = await resp.json().catch(function () { return null; });
    if (!json || json.code !== 0 || !json.app_access_token) {
      throw new Error('token failed' + (json && json.msg ? ': ' + json.msg : ''));
    }
    return json.app_access_token;
  }
  function searchUrl(pageToken) {
    var url = LARK_HOST + '/open-apis/bitable/v1/apps/' + LARK_APP_TOKEN +
      '/tables/' + LARK_TABLE_ID + '/records/search?page_size=' + PAGE_SIZE;
    if (pageToken) url += '&page_token=' + encodeURIComponent(pageToken);
    return url;
  }

  async function fetchAll(onProgress) {
    if (!configured()) throw new Error('Supplier lookup is not configured.');
    var token = await getToken();
    var base = proxyBase();
    var out = [];
    var pageToken = '', pages = 0, hasMore = true, total = null;

    while (hasMore && pages < MAX_PAGES) {
      var resp = await fetch(base + '/proxy?url=' + encodeURIComponent(searchUrl(pageToken)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: '{}',
      });
      var text = await resp.text();
      var json = null;
      try { json = JSON.parse(text); } catch (e) { /* handled below */ }
      if (!json) { if (pages === 0) throw new Error('proxy returned non-JSON (HTTP ' + resp.status + ')'); break; }
      if (json.code !== 0) { if (pages === 0) throw new Error('Lark error ' + json.code + (json.msg ? ' (' + json.msg + ')' : '')); break; }

      var d = json.data || {};
      if (Array.isArray(d.items)) {
        for (var i = 0; i < d.items.length; i++) out.push(mapRecord(d.items[i].fields || {}));
      }
      if (typeof d.total === 'number') total = d.total;
      hasMore = !!d.has_more;
      pageToken = d.page_token || '';
      pages++;
      if (onProgress) onProgress(out.length, total);
      if (hasMore && !pageToken) break;
      if (hasMore) await new Promise(function (r) { setTimeout(r, PAGE_DELAY_MS); });
    }
    return out;
  }

  /* ---- Public API -------------------------------------------------------- */

  // Try the static snapshot committed by the GitHub Action (fast, offline-ok).
  function loadSnapshot() {
    var path = (typeof SUPPLIERS_PATH !== 'undefined' && SUPPLIERS_PATH) ? SUPPLIERS_PATH : 'data/suppliers.json';
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('no snapshot');
      return r.json();
    }).then(function (j) {
      var list = (j && j.rows) ? j.rows : [];
      if (!list.length) throw new Error('empty snapshot');
      rows = list.filter(function (r) { return r.item && r.unitPrice != null; });
      generatedAt = j._generated || null;
      source = 'snapshot';
      return rows;
    });
  }

  // Load rows (approved only). Order: in-memory cache → static snapshot →
  // live proxy. `force` skips straight to the live proxy (the Refresh button).
  // Returns a Promise<rows>. onProgress(count,total) is optional.
  function load(onProgress, force) {
    if (rows && !force) return Promise.resolve(rows);
    if (inflight && !force) return inflight;

    if (!force) {
      try {
        var cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) { rows = JSON.parse(cached); source = source || 'snapshot'; return Promise.resolve(rows); }
      } catch (e) { /* ignore */ }
    }

    // Prefer the committed snapshot unless the user forced a live refresh.
    var start = force ? Promise.reject(new Error('forced live')) : loadSnapshot();

    inflight = start.then(function (r) {
      inflight = null;
      return r;
    }).catch(function () {
      // No snapshot (or forced) → go live through the proxy.
      return fetchLive(onProgress);
    });
    return inflight;
  }

  function fetchLive(onProgress) {
    return fetchAll(onProgress).then(function (all) {
      source = 'live';
      // Keep only approved records with a usable item + price.
      rows = all.filter(function (r) {
        return (!r.status || /approved/i.test(r.status)) && r.item && r.unitPrice != null;
      });
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* quota */ }
      inflight = null;
      return rows;
    }).catch(function (err) {
      inflight = null;
      throw err;
    });
  }

  // Filter loaded rows by a query over item + supplier, cheapest first.
  function search(q) {
    if (!rows) return [];
    q = (q || '').trim().toLowerCase();
    var list = rows;
    if (q) {
      list = rows.filter(function (r) {
        return (r.item && r.item.toLowerCase().indexOf(q) !== -1) ||
          (r.supplier && r.supplier.toLowerCase().indexOf(q) !== -1);
      });
    }
    return list.slice().sort(function (a, b) { return (a.unitPrice || 0) - (b.unitPrice || 0); });
  }

  return {
    configured: configured,
    load: load,
    search: search,
    count: function () { return rows ? rows.length : 0; },
    info: function () { return { generatedAt: generatedAt, source: source }; },
    DISPLAY_LIMIT: DISPLAY_LIMIT,
  };
})();

/* =====================================================================
 * Panel controller — binds to the #supplierPanel markup in index.html.
 * Lazy-loads on first open so the proxy is never hit until the user wants it.
 * ===================================================================== */
(function () {
  'use strict';

  function money(r) {
    var n = Number(r.unitPrice || 0);
    var s = n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var cur = (r.currency || 'PHP').toUpperCase();
    return cur === 'PHP' ? '₱' + s : (cur + ' ' + s);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() {
    var panel = document.getElementById('supplierPanel');
    if (!panel) return;
    var searchEl = document.getElementById('supplierSearch');
    var refreshEl = document.getElementById('supplierRefresh');
    var statusEl = document.getElementById('supplierStatus');
    var resultsEl = document.getElementById('supplierResults');

    if (!window.Suppliers || !Suppliers.configured()) {
      if (statusEl) statusEl.textContent = 'Supplier lookup is not configured.';
      if (refreshEl) refreshEl.disabled = true;
      return;
    }

    function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

    function render() {
      var q = searchEl ? searchEl.value : '';
      var list = Suppliers.search(q);
      var total = list.length;
      if (!total) {
        resultsEl.innerHTML = '<p class="muted">No matching supplier records.</p>';
        setStatus(Suppliers.count() + ' approved records loaded.');
        return;
      }
      var shown = list.slice(0, Suppliers.DISPLAY_LIMIT);
      var html = '<table class="supplier-table"><thead><tr>' +
        '<th>Item</th><th class="num">Unit Price</th><th>Supplier</th><th>Project</th><th>Date</th>' +
        '</tr></thead><tbody>';
      shown.forEach(function (r) {
        html += '<tr>' +
          '<td>' + esc(r.item) + '</td>' +
          '<td class="num">' + esc(money(r)) + '</td>' +
          '<td>' + esc(r.supplier) + '</td>' +
          '<td class="muted">' + esc(r.project) + '</td>' +
          '<td class="muted">' + esc(r.date) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
      resultsEl.innerHTML = html;
      var info = Suppliers.info ? Suppliers.info() : {};
      var origin = info.source === 'live'
        ? 'live'
        : (info.generatedAt ? 'snapshot ' + String(info.generatedAt).slice(0, 10) : 'snapshot');
      setStatus('Showing ' + shown.length + (total > shown.length ? ' of ' + total : '') +
        ' match' + (total === 1 ? '' : 'es') + ' · ' + Suppliers.count() + ' records (' + origin + ', cheapest first).');
    }

    var started = false;
    function ensureLoaded(force) {
      started = true;
      setStatus(force ? 'Refreshing live from source… (can take ~30–60s if it is asleep)' : 'Loading supplier prices…');
      if (resultsEl) resultsEl.innerHTML = '';
      Suppliers.load(function (count) { setStatus('Fetching… ' + count.toLocaleString() + ' records'); }, force)
        .then(function () { render(); })
        .catch(function (err) {
          console.warn('Supplier lookup failed:', err);
          setStatus('Supplier data unavailable right now (' + (err.message || err) + '). The calculator still works.');
        });
    }

    // Lazy-load the first time the panel is opened.
    panel.addEventListener('toggle', function () {
      if (panel.open && !started) ensureLoaded(false);
    });
    if (refreshEl) refreshEl.addEventListener('click', function () { ensureLoaded(true); });
    if (searchEl) searchEl.addEventListener('input', function () { if (Suppliers.count()) render(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
