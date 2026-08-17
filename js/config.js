/* =====================================================================
 * config.js  --  Shared configuration & helpers for MG Ballpark
 * =====================================================================
 *
 *  Backend: NONE. The catalog is a static file, data/catalog.json, committed
 *  in the repo. The calculator fetches it directly; the admin edits it in the
 *  browser and exports a new catalog.json to commit. No database, no server.
 *
 *  Load order (in every HTML page, at end of <body>):
 *    1) this file      -> constants + helpers (+ supplier-lookup config)
 *    2) page script    -> calculator.js / admin.js (each fetch catalog.json)
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * Static catalog location (relative to the page, so it works locally and on
 * GitHub Pages). calculator.js and admin.js both read this.
 * ------------------------------------------------------------------- */
const CATALOG_PATH = 'data/catalog.json';

/* ---------------------------------------------------------------------
 * Supplier price reference (live) — reads a coworker's procurement data
 * through his public Lark CORS proxy. Reference only; never feeds the
 * ballpark math. See js/suppliers.js. Update these if he changes the proxy.
 * ------------------------------------------------------------------- */
const SUPPLIER_PROXY = 'https://lark-proxy-dwiw.onrender.com';
const LARK_APP_TOKEN = 'WW2pb1ht1aSTEDstV1qlTR2Igpe';
const LARK_TABLE_ID = 'tblvHDMbE51scSwf';

// Static snapshot committed by the scheduled GitHub Action (scripts/
// scrape_suppliers.py). The panel reads this first (instant, works even when
// the proxy is asleep); "Refresh" bypasses it and hits the proxy live.
const SUPPLIERS_PATH = 'data/suppliers.json';

function supplierLookupConfigured() {
  return typeof SUPPLIER_PROXY === 'string' && /^https?:\/\//.test(SUPPLIER_PROXY) &&
    !!LARK_APP_TOKEN && !!LARK_TABLE_ID;
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
