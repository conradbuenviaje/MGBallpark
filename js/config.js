/* =====================================================================
 * config.js  --  Shared configuration & helpers for MG Ballpark
 * =====================================================================
 *
 *  Backend: PocketBase (self-hosted). Set PB_URL below to your PocketBase
 *  base URL — the public tunnel for the live site, or http://127.0.0.1:8090
 *  for local testing.
 *
 *  Load order (in every HTML page, at end of <body>):
 *    1) PocketBase SDK (CDN) -> defines window.PocketBase
 *    2) this file            -> defines `db` (a Supabase-compatible shim over
 *                               PocketBase) + constants + helpers
 *    3) page script          -> calculator.js / admin.js
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * PocketBase base URL
 * ------------------------------------------------------------------- */
const PB_URL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
  ? 'http://127.0.0.1:8090'                          // local dev (PocketBase on this PC)
  : 'https://aids-apple-cornflake.ngrok-free.dev';   // live site via ngrok tunnel

function credentialsConfigured() {
  return typeof PB_URL === 'string' && /^https?:\/\//.test(PB_URL) &&
    PB_URL.indexOf('YOUR_') === -1;
}

/* ---------------------------------------------------------------------
 * PocketBase client (created defensively — never break the whole page).
 * ------------------------------------------------------------------- */
let pb = null;
try {
  if (typeof PocketBase === 'undefined') throw new Error('PocketBase SDK did not load (CDN blocked?).');
  if (!credentialsConfigured()) throw new Error('PB_URL is not set in js/config.js.');
  pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  // ngrok free serves a browser-warning interstitial unless this header is set.
  pb.beforeSend = function (url, options) {
    options.headers = Object.assign({}, options.headers, { 'ngrok-skip-browser-warning': 'true' });
    return { url: url, options: options };
  };
} catch (err) {
  console.error('PocketBase client not created. Set PB_URL in js/config.js. Details:', err);
}

/* ---------------------------------------------------------------------
 * `db` — a minimal Supabase/PostgREST-compatible shim over PocketBase so the
 * existing page code keeps working. Supports only the subset this app uses:
 *   from().select().eq()/.in().order().maybeSingle()/.single()
 *   insert()[.select().single()], update().eq()/.in(), delete().eq()/.in(),
 *   upsert(), and auth.getSession()/signInWithPassword()/signOut().
 * Returns Supabase-style { data, error }.
 * ------------------------------------------------------------------- */
const db = pb ? makePbShim(pb) : null;

function makePbShim(pbClient) {
  function quote(v) {
    return (typeof v === 'number' || typeof v === 'boolean')
      ? String(v) : ('"' + String(v).replace(/"/g, '\\"') + '"');
  }
  function q(collection) {
    var st = { collection: collection, filters: [], sort: [], op: 'select', payload: null };
    function filterStr() {
      return st.filters.map(function (f) {
        if (f.type === 'in') return '(' + f.vals.map(function (v) { return f.field + '=' + quote(v); }).join('||') + ')';
        return f.field + '=' + quote(f.val);
      }).join(' && ');
    }
    function idsFromFilters() {
      var ids = [];
      st.filters.forEach(function (f) {
        if (f.field === 'id') { if (f.type === 'in') ids = ids.concat(f.vals); else ids.push(f.val); }
      });
      return ids;
    }
    async function run(single) {
      try {
        var coll = pbClient.collection(st.collection);
        if (st.op === 'select') {
          var opts = { requestKey: null };
          if (st.sort.length) opts.sort = st.sort.join(',');
          // settings has a random PocketBase id, so ignore id filters for it.
          var f = (st.collection === 'settings') ? '' : filterStr();
          if (f) opts.filter = f;
          var list = await coll.getFullList(opts);
          return single ? { data: list[0] || null, error: null } : { data: list, error: null };
        }
        if (st.op === 'insert') {
          if (Array.isArray(st.payload)) {
            var out = [];
            for (var i = 0; i < st.payload.length; i++) out.push(await coll.create(st.payload[i]));
            return { data: out, error: null };
          }
          var rec = await coll.create(st.payload);
          return { data: single ? rec : [rec], error: null };
        }
        if (st.op === 'update') {
          var uids = idsFromFilters(), ures = [];
          for (var j = 0; j < uids.length; j++) ures.push(await coll.update(uids[j], st.payload));
          return { data: ures, error: null };
        }
        if (st.op === 'delete') {
          var dids = idsFromFilters();
          for (var k = 0; k < dids.length; k++) await coll.delete(dids[k]);
          return { data: null, error: null };
        }
        if (st.op === 'upsert') {
          var p = Object.assign({}, st.payload); delete p.id;
          var existing = await coll.getFullList({ requestKey: null });
          if (existing.length) return { data: await coll.update(existing[0].id, p), error: null };
          return { data: await coll.create(p), error: null };
        }
        return { data: null, error: new Error('unsupported op') };
      } catch (e) { return { data: null, error: e }; }
    }
    var builder = {
      select: function () { return builder; },
      eq: function (field, val) { st.filters.push({ type: 'eq', field: field, val: val }); return builder; },
      in: function (field, vals) { st.filters.push({ type: 'in', field: field, vals: vals }); return builder; },
      order: function (field, opts) { st.sort.push(((opts && opts.ascending === false) ? '-' : '') + field); return builder; },
      limit: function () { return builder; },
      maybeSingle: function () { return run(true); },
      single: function () { return run(true); },
      insert: function (payload) { st.op = 'insert'; st.payload = payload; return builder; },
      update: function (payload) { st.op = 'update'; st.payload = payload; return builder; },
      delete: function () { st.op = 'delete'; return builder; },
      upsert: function (payload) { st.op = 'upsert'; st.payload = payload; return builder; },
      then: function (res, rej) { return run(false).then(res, rej); },
    };
    return builder;
  }
  return {
    from: function (t) { return q(t); },
    auth: {
      getSession: async function () {
        var valid = pbClient.authStore && pbClient.authStore.isValid;
        return { data: { session: valid ? { token: pbClient.authStore.token } : null }, error: null };
      },
      signInWithPassword: async function (cred) {
        try { await pbClient.collection('_superusers').authWithPassword(cred.email, cred.password); return { data: {}, error: null }; }
        catch (e) { return { data: null, error: e }; }
      },
      signOut: async function () { try { pbClient.authStore.clear(); } catch (e) {} return { error: null }; },
    },
  };
}

/* ---------------------------------------------------------------------
 * Pricing business rules (non-negotiable; mirrored in calculator.js)
 * ------------------------------------------------------------------- */

// Hidden markup applied client-side to every base rate.
//   sellingRate = baseRate * MARKUP   (i.e. base cost + 30%)
const MARKUP = 1.30;

// High-end range multiplier when NO fabrication is involved (+50%).
const STD_MULTIPLIER = 0.50;

// High-end range multiplier when fabrication IS involved (+70%).
const FAB_MULTIPLIER = 0.70;

/* ---------------------------------------------------------------------
 * Logistics / delivery locations.
 * `value` is the stored slug, `label` is the human-readable text.
 * Order matters: this is the order radios are rendered in.
 * ------------------------------------------------------------------- */
const LOGISTICS = [
  { value: 'metro-manila', label: 'Metro Manila' },
  { value: 'luzon',        label: 'Luzon' },
  { value: 'visayas',      label: 'Visayas' },
  { value: 'mindanao',     label: 'Mindanao' },
  { value: 'sea',          label: 'SEA' },
  { value: 'apac',         label: 'APAC' },
  { value: 'others',       label: 'Others' },
];

/* ---------------------------------------------------------------------
 * Core services. The catalog is grouped under these 3 cores: the client
 * picks a core (checkbox), which reveals its sub-services. Each category
 * maps to one core via CATEGORY_CORE below (by category name).
 * ------------------------------------------------------------------- */
const CORES = [
  {
    code: 'MET',
    name: 'MET — Event Management & Production',
    description:
      'End-to-end event management and technical operations: single accountable ' +
      'team, contingency + tech redundancy, talent logistics, hospitality, security ' +
      'and post-event leisure — polished, compliant, on-time and on-budget.',
  },
  {
    code: 'MMARK',
    name: 'MMARK — Marketing (Make your MARK)',
    description:
      'Integrated creative + marketing: film / physical / OOH production, plus ' +
      'digital — influencer marketing, social & community management, PR and media ' +
      'planning/buying. Cohesive content, synchronized distribution, performance-driven.',
  },
  {
    code: 'M-TECH',
    name: 'M-TECH — AI, Software, Hardware & Innovation',
    description:
      'Immersive, interactive installations: AI automation, 2D/3D billboards, ' +
      'projection mapping, AR/VR, CGI/VFX and FOOH — end-to-end tech design, ' +
      'deployment and live support that differentiates brands.',
  },
];

// Category name -> core code. Categories not listed fall back to FALLBACK_CORE.
const FALLBACK_CORE = 'MET';
const CATEGORY_CORE = {
  // MET — Event Management & Production
  'Manpower (Crew Day Rates)': 'MET',
  'Venue & Spaces': 'MET',
  'Permits & Safety': 'MET',
  'Power & Electrical': 'MET',
  'Lighting': 'MET',
  'Audio': 'MET',
  'Truss, Stage & Rigging': 'MET',
  'Fabrication & Signage': 'MET',
  'Transport & Logistics': 'MET',
  'Furniture & Decor': 'MET',
  'Special Effects': 'MET',
  'Other Equipment': 'MET',
  // MMARK — Marketing
  'Camera & Grip': 'MMARK',
  'Awards & Print Collateral': 'MMARK',
  'Merchandise & Apparel': 'MMARK',
  // M-TECH — AI, Software, Hardware & Innovation
  'Internet & Network': 'M-TECH',
  'LED & Display': 'M-TECH',
  'IT & Computing': 'M-TECH',
};

/* ---------------------------------------------------------------------
 * Formatting helpers
 * ------------------------------------------------------------------- */

/**
 * Format a number as Philippine Peso currency.
 * Uses the Peso sign (₱) and always shows 2 decimal places.
 * Falls back to 0 for null/undefined/NaN input.
 *   peso(1234.5) -> "₱1,234.50"
 */
function peso(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a number as US Dollars (used for the PHP -> USD conversion shown
 * alongside the peso totals). Falls back to 0 for null/undefined/NaN.
 *   usd(1234.5) -> "$1,234.50"
 */
function usd(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Fallback USD -> PHP exchange rate, used only if settings.usd_php_rate is
// missing. The live value comes from the settings table (admin-editable).
const DEFAULT_USD_PHP = 55.89;

/**
 * Format a fractional rate (e.g. 0.125) as a trimmed percentage string.
 * Trailing zeros (and a trailing dot) are removed for a clean display.
 *   pct(0.125) -> "12.5%"
 *   pct(0.12)  -> "12%"
 */
function pct(rate) {
  return (Number(rate) * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
}

/* ---------------------------------------------------------------------
 * Branding + integrations (PDF / Email / Analytics)
 * ------------------------------------------------------------------- */

// Shown on the PDF estimate header.
const COMPANY_NAME = 'MG Ballpark';

// Google Analytics 4. Put your Measurement ID here (e.g. 'G-ABCD1234').
// Leave as the placeholder to disable analytics.
const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';

// EmailJS (https://www.emailjs.com) for the "Email Estimate" button.
// Fill all three from your EmailJS dashboard. Placeholders = email disabled.
const EMAILJS = {
  publicKey: 'YOUR_EMAILJS_PUBLIC_KEY',
  serviceId: 'YOUR_EMAILJS_SERVICE_ID',
  templateId: 'YOUR_EMAILJS_TEMPLATE_ID',
};

function gaEnabled() {
  return typeof GA_MEASUREMENT_ID === 'string' && /^G-/.test(GA_MEASUREMENT_ID) &&
    GA_MEASUREMENT_ID !== 'G-XXXXXXXXXX';
}
function emailjsConfigured() {
  return EMAILJS && EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateId &&
    EMAILJS.publicKey.indexOf('YOUR_') !== 0 &&
    EMAILJS.serviceId.indexOf('YOUR_') !== 0 &&
    EMAILJS.templateId.indexOf('YOUR_') !== 0;
}

// Fire a GA4 event if analytics is configured (safe no-op otherwise).
function track(event, params) {
  try { if (gaEnabled() && typeof window.gtag === 'function') window.gtag('event', event, params || {}); }
  catch (e) { /* ignore */ }
}

// Load Google Analytics (gtag) once, if configured. Auto-sends page_view.
(function loadGA() {
  if (!gaEnabled()) return;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID);
})();
