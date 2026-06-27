/* =====================================================================
 * config.js  --  Shared configuration & helpers for MG Ballpark
 * =====================================================================
 *
 *  >>> ACTION REQUIRED <<<
 *  Before this app will work, replace the two placeholder values below
 *  with the credentials from your Supabase project:
 *
 *    1. SUPABASE_URL      -> Project Settings > API > "Project URL"
 *    2. SUPABASE_ANON_KEY -> Project Settings > API > "anon / public" key
 *
 *  The anon key is safe to expose in a public/static site (it is gated by
 *  your Row Level Security policies). Do NOT put the service_role key here.
 *
 *  Load order (in every HTML page, at end of <body>):
 *    1) Supabase CDN  -> defines window.supabase
 *    2) this file     -> defines `db` + constants + helpers
 *    3) page script   -> calculator.js (index.html) / admin.js (admin.html)
 *
 *  This file is dependency-free aside from the Supabase CDN global.
 *  All symbols are plain globals shared across the page's <script> tags.
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * Supabase credentials (REPLACE THESE)
 * ------------------------------------------------------------------- */
const SUPABASE_URL = 'https://qvuvntyhyromzmnzhzzs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXZudHloeXJvbXptbnpoenpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NTUzODYsImV4cCI6MjA5ODAzMTM4Nn0.pxY1Z6jws02UDWsNlWi4DXy4VGnf93GLfXkO83OVrrk';

/* ---------------------------------------------------------------------
 * Are the credentials still the unconfigured placeholders (or empty)?
 * Page scripts use this to show a friendly "set up Supabase" message
 * instead of failing on a network call.
 * ------------------------------------------------------------------- */
function credentialsConfigured() {
  return (
    typeof SUPABASE_URL === 'string' && !!SUPABASE_URL &&
    typeof SUPABASE_ANON_KEY === 'string' && !!SUPABASE_ANON_KEY &&
    SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
    SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
  );
}

/* ---------------------------------------------------------------------
 * Supabase client.
 * NOTE: the CDN exposes the library as the global `window.supabase`.
 * We name our created client `db` so we don't shadow that CDN global.
 *
 * IMPORTANT: createClient() THROWS on an invalid URL (e.g. the placeholder
 * before setup) and if the CDN fails to load. We create it defensively so a
 * single failure never breaks the whole page -- on failure `db` is null and
 * the page scripts (calculator.js / admin.js) show a friendly setup message.
 * ------------------------------------------------------------------- */
let db = null;
try {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase library did not load (CDN blocked?).');
  }
  if (!credentialsConfigured()) {
    throw new Error('Supabase credentials are not set in js/config.js yet.');
  }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error(
    'Supabase client not created. Set SUPABASE_URL and SUPABASE_ANON_KEY in ' +
    'js/config.js (Supabase > Project Settings > API). Details:',
    err
  );
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
