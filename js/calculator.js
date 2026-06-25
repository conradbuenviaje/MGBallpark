/* =====================================================================
 * calculator.js  --  CLIENT-facing Service Package Calculator
 * =====================================================================
 *
 *  Depends on globals from config.js (loaded first):
 *    db, MARKUP, STD_MULTIPLIER, FAB_MULTIPLIER, LOGISTICS, peso(), pct()
 *
 *  Responsibilities:
 *    1. Fetch settings + categories + services from Supabase (by sort_order).
 *    2. Render logistics radios + categories/services with quantity inputs.
 *    3. Keep each service's HIDDEN data (base_rate, is_fabrication) in JS
 *       state ONLY -- never in client-visible DOM text.
 *    4. On "Generate", compute the ballpark estimate per the business rules
 *       and render the results table + summary + budget range.
 *
 *  IMPORTANT (privacy): the COST (base_rate) and the hidden 30% markup are
 *  never exposed. In the service-selection area only quantities are shown
 *  (no rates at all). The results table DOES show the marked-up selling
 *  "Unit Price" the client will actually pay (as required by the spec) --
 *  but never the underlying base cost or the markup itself.
 * ===================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------
   * Module state
   * ------------------------------------------------------------------- */

  // Global settings (with sensible defaults until fetched).
  var settings = { asf_rate: 0.125, vat_rate: 0.12, usd_php_rate: DEFAULT_USD_PHP };

  // Categories fetched from DB (ordered by sort_order).
  var categories = [];

  // Services fetched from DB (ordered by sort_order).
  var services = [];

  // HIDDEN per-service data, keyed by service id.
  //   id -> { base_rate: Number, is_fabrication: Boolean, name: String }
  // This is the only place base_rate lives; it is never written to the DOM.
  var serviceState = new Map();

  /* -------------------------------------------------------------------
   * Cached DOM references (populated on DOMContentLoaded)
   * ------------------------------------------------------------------- */
  var els = {};

  function cacheEls() {
    els.nonVatToggle      = document.getElementById('nonVatToggle');
    els.fabricationToggle = document.getElementById('fabricationToggle');
    els.fabBadge          = document.getElementById('fabBadge');
    els.logisticsRadios   = document.getElementById('logisticsRadios');
    els.discountInput     = document.getElementById('discountInput');
    els.serviceSearch     = document.getElementById('serviceSearch');
    els.servicesContainer = document.getElementById('servicesContainer');
    els.generateBtn       = document.getElementById('generateBtn');
    els.errorBanner       = document.getElementById('errorBanner');

    // Results
    els.resultsSection    = document.getElementById('resultsSection');
    els.resultsLocation   = document.getElementById('resultsLocation');
    els.resultsFabrication = document.getElementById('resultsFabrication');
    els.resultsTableBody  = document.getElementById('resultsTableBody');
    els.sumSubtotal       = document.getElementById('sumSubtotal');
    els.sumAsf            = document.getElementById('sumAsf');
    els.discountRow       = document.getElementById('discountRow');
    els.sumDiscount       = document.getElementById('sumDiscount');
    els.vatRow            = document.getElementById('vatRow');
    els.sumVat            = document.getElementById('sumVat');
    els.sumTotal          = document.getElementById('sumTotal');
    els.sumTotalUsd       = document.getElementById('sumTotalUsd');
    els.budgetRange       = document.getElementById('budgetRange');
    els.budgetRangeUsd    = document.getElementById('budgetRangeUsd');
  }

  /* -------------------------------------------------------------------
   * Small UI helpers
   * ------------------------------------------------------------------- */

  // Show a friendly error message (never crash the page).
  function showError(msg) {
    if (!els.errorBanner) {
      // Fallback if banner element is missing for some reason.
      window.alert(msg);
      return;
    }
    els.errorBanner.textContent = msg;
    els.errorBanner.hidden = false;
  }

  // Hide the error banner.
  function clearError() {
    if (els.errorBanner) {
      els.errorBanner.hidden = true;
      els.errorBanner.textContent = '';
    }
  }

  // Whether the Non-VAT client toggle is checked.
  function isNonVat() {
    return !!(els.nonVatToggle && els.nonVatToggle.checked);
  }

  // Whether fabrication was manually toggled on.
  function manualFab() {
    return !!(els.fabricationToggle && els.fabricationToggle.checked);
  }

  // Read the currently selected logistics entry ({value, label}); defaults
  // to the first LOGISTICS entry if nothing is checked.
  function selectedLogistics() {
    var checked = document.querySelector('input[name="logistics"]:checked');
    var value = checked ? checked.value : (LOGISTICS[0] && LOGISTICS[0].value);
    for (var i = 0; i < LOGISTICS.length; i++) {
      if (LOGISTICS[i].value === value) return LOGISTICS[i];
    }
    return LOGISTICS[0] || { value: '', label: '' };
  }

  // Return true if ANY service with qty > 0 is flagged as fabrication.
  function anyFabricationSelected() {
    var inputs = els.servicesContainer.querySelectorAll('.qty-input');
    for (var i = 0; i < inputs.length; i++) {
      var qty = parseQty(inputs[i].value);
      if (qty > 0) {
        var id = inputs[i].getAttribute('data-service-id');
        var state = serviceState.get(String(id));
        if (state && state.is_fabrication === true) return true;
      }
    }
    return false;
  }

  // Effective fabrication flag = manual toggle OR auto-detected from qtys.
  function fabricationIncluded() {
    return manualFab() || anyFabricationSelected();
  }

  // Parse a quantity input value into a non-negative integer.
  function parseQty(raw) {
    var n = parseInt(raw, 10);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  // Read the manual discount (a non-negative PHP amount). Invalid/blank -> 0.
  function discountAmount() {
    if (!els.discountInput) return 0;
    var n = parseFloat(els.discountInput.value);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  // Live USD <-> PHP rate (PHP per 1 USD), with a safe fallback.
  function fxRate() {
    var r = Number(settings.usd_php_rate);
    return r > 0 ? r : DEFAULT_USD_PHP;
  }

  // Filter the (large) service catalog by the search box text. Hides
  // non-matching service rows and any category whose rows all hid.
  function filterServices() {
    if (!els.servicesContainer) return;
    var q = els.serviceSearch ? els.serviceSearch.value.trim().toLowerCase() : '';
    var cards = els.servicesContainer.querySelectorAll('.category-card');
    Array.prototype.forEach.call(cards, function (card) {
      var rows = card.querySelectorAll('.service-row');
      var anyVisible = false;
      Array.prototype.forEach.call(rows, function (row) {
        var nameEl = row.querySelector('.service-name');
        var name = nameEl ? nameEl.textContent.toLowerCase() : '';
        var match = !q || name.indexOf(q) !== -1;
        row.hidden = !match;
        if (match) anyVisible = true;
      });
      // Hide the whole category card when nothing in it matches.
      card.hidden = !anyVisible;
    });
  }

  /* -------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */

  // Render the logistics radio buttons from the LOGISTICS config.
  // First entry (metro-manila) is checked by default.
  function renderLogistics() {
    if (!els.logisticsRadios) return;
    els.logisticsRadios.innerHTML = '';

    LOGISTICS.forEach(function (opt, idx) {
      var id = 'logistics-' + opt.value;

      var label = document.createElement('label');
      label.className = 'radio-label';
      label.setAttribute('for', id);

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'logistics';
      input.id = id;
      input.value = opt.value;
      if (idx === 0) input.checked = true; // metro-manila default

      var span = document.createElement('span');
      span.textContent = opt.label;

      label.appendChild(input);
      label.appendChild(span);
      els.logisticsRadios.appendChild(label);
    });
  }

  // Render categories + their services into #servicesContainer.
  // Stores hidden base_rate / is_fabrication in serviceState (NOT the DOM).
  function renderServices() {
    if (!els.servicesContainer) return;
    els.servicesContainer.innerHTML = '';

    if (!categories.length) {
      var empty = document.createElement('p');
      empty.className = 'loading-msg';
      empty.textContent = 'No services are available right now.';
      els.servicesContainer.appendChild(empty);
      return;
    }

    categories.forEach(function (cat) {
      var section = document.createElement('section');
      section.className = 'category-card';

      // Category heading + description.
      var h2 = document.createElement('h2');
      h2.className = 'category-name';
      h2.textContent = cat.name || 'Category';
      section.appendChild(h2);

      if (cat.description) {
        var desc = document.createElement('p');
        desc.className = 'category-desc';
        desc.textContent = cat.description;
        section.appendChild(desc);
      }

      // Services belonging to this category (already sorted by sort_order).
      var catServices = services.filter(function (s) {
        return s.category_id === cat.id;
      });

      if (!catServices.length) {
        var none = document.createElement('p');
        none.className = 'muted';
        none.textContent = 'No services in this category yet.';
        section.appendChild(none);
      } else {
        var list = document.createElement('div');
        list.className = 'service-list';

        catServices.forEach(function (svc) {
          list.appendChild(renderServiceRow(svc));
        });

        section.appendChild(list);
      }

      els.servicesContainer.appendChild(section);
    });
  }

  // Render a single service row: visible name + unit + qty input.
  // NOTE: in the selection area NO rates are shown (cost or selling) --
  // only the quantity input is interactive. The marked-up unit price
  // appears later, in the results table, after "Generate".
  function renderServiceRow(svc) {
    // Stash hidden pricing data in state, keyed by id (string key for safety).
    serviceState.set(String(svc.id), {
      base_rate: Number(svc.base_rate) || 0,
      is_fabrication: svc.is_fabrication === true,
      name: svc.name || 'Service',
      unit: svc.unit || '',
    });

    var row = document.createElement('div');
    row.className = 'service-row';

    var inputId = 'qty-' + svc.id;

    // Visible label: service name (+ unit hint). NO rate shown.
    var label = document.createElement('label');
    label.className = 'service-label';
    label.setAttribute('for', inputId);

    var nameSpan = document.createElement('span');
    nameSpan.className = 'service-name';
    nameSpan.textContent = svc.name || 'Service';
    label.appendChild(nameSpan);

    if (svc.unit) {
      var unitSpan = document.createElement('span');
      unitSpan.className = 'service-unit';
      unitSpan.textContent = 'per ' + svc.unit;
      label.appendChild(unitSpan);
    }

    // Quantity input (the ONLY interactive/visible numeric field).
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'qty-input';
    input.id = inputId;
    input.setAttribute('data-service-id', String(svc.id));
    input.min = '0';
    input.step = '1';
    input.value = '0';
    input.setAttribute('aria-label', 'Quantity for ' + (svc.name || 'service'));

    // Live-update the fabrication badge when quantities change (nice-to-have).
    input.addEventListener('input', updateFabBadge);

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  // Keep the user-facing footnote percentages in sync with the business-rule
  // constants (config.js) and the live settings, so static copy can never
  // drift from the actual computation. Uses the pct() helper from config.js.
  function populateFootnotes() {
    var set = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('fnAsfPct', pct(settings.asf_rate));
    set('fnVatPct', pct(settings.vat_rate));
    set('fnStdPct', '+' + pct(STD_MULTIPLIER));
    set('fnFabPct', '+' + pct(FAB_MULTIPLIER));
  }

  // Update the fabrication badge to reflect the active high-end multiplier.
  function updateFabBadge() {
    if (!els.fabBadge) return;
    var fab = fabricationIncluded();
    var mult = fab ? FAB_MULTIPLIER : STD_MULTIPLIER;
    els.fabBadge.textContent = '+' + Math.round(mult * 100) + '%';
    els.fabBadge.classList.toggle('badge-fab', fab);
  }

  /* -------------------------------------------------------------------
   * Calculation  (business rules -- implemented EXACTLY as specified)
   * ------------------------------------------------------------------- */

  // Compute the full estimate from current inputs.
  // Returns an object the renderer consumes.
  function computeEstimate() {
    var nonVat = isNonVat();
    var vatRate = Number(settings.vat_rate) || 0;
    var asfRate = Number(settings.asf_rate) || 0;

    var lineItems = [];
    var subtotal = 0;

    // Walk every qty input; include only services with qty > 0.
    var inputs = els.servicesContainer.querySelectorAll('.qty-input');
    Array.prototype.forEach.call(inputs, function (input) {
      var qty = parseQty(input.value);
      if (qty <= 0) return;

      var id = String(input.getAttribute('data-service-id'));
      var state = serviceState.get(id);
      if (!state) return;

      var baseRate = Number(state.base_rate) || 0;

      // --- core formula (hidden markup applied here) ---
      var sellingRate = baseRate * MARKUP;
      var unitPrice = nonVat ? sellingRate * (1 + vatRate) : sellingRate;
      var amount = qty * unitPrice;

      subtotal += amount;

      lineItems.push({
        name: state.name,
        qty: qty,
        unitPrice: unitPrice,
        amount: amount,
      });
    });

    var asf = subtotal * asfRate;

    // Discount is applied AFTER ASF and BEFORE VAT (matching the company
    // quote sheet). Clamp it so it can't exceed subtotal + ASF.
    var discount = Math.min(discountAmount(), subtotal + asf);

    var preVatBase = subtotal + asf - discount;
    var vat = nonVat ? 0 : preVatBase * vatRate;
    var total = preVatBase + vat;

    var fab = fabricationIncluded();
    var low = total;
    var high = total * (1 + (fab ? FAB_MULTIPLIER : STD_MULTIPLIER));

    var fx = fxRate();

    return {
      lineItems: lineItems,
      subtotal: subtotal,
      asf: asf,
      discount: discount,
      vat: vat,
      total: total,
      low: low,
      high: high,
      // USD equivalents (PHP / FX) for dual-currency display.
      fx: fx,
      lowUsd: low / fx,
      highUsd: high / fx,
      totalUsd: total / fx,
      nonVat: nonVat,
      fabricationIncluded: fab,
      location: selectedLogistics(),
    };
  }

  // Render the results section from a computed estimate.
  function renderResults(est) {
    if (!els.resultsSection) return;

    // Meta: location + fabrication state.
    if (els.resultsLocation) {
      els.resultsLocation.textContent = est.location.label || '—';
    }
    if (els.resultsFabrication) {
      els.resultsFabrication.textContent =
        est.fabricationIncluded ? 'Included' : 'Not included';
    }

    // Table body: one row per selected service (qty > 0).
    els.resultsTableBody.innerHTML = '';
    if (!est.lineItems.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'muted';
      td.textContent = 'No services selected. Enter a quantity above.';
      tr.appendChild(td);
      els.resultsTableBody.appendChild(tr);
    } else {
      est.lineItems.forEach(function (item) {
        var tr = document.createElement('tr');

        var nameTd = document.createElement('td');
        nameTd.textContent = item.name;

        var qtyTd = document.createElement('td');
        qtyTd.className = 'num';
        qtyTd.textContent = String(item.qty);

        var priceTd = document.createElement('td');
        priceTd.className = 'num';
        priceTd.textContent = peso(item.unitPrice);

        var amtTd = document.createElement('td');
        amtTd.className = 'num';
        amtTd.textContent = peso(item.amount);

        tr.appendChild(nameTd);
        tr.appendChild(qtyTd);
        tr.appendChild(priceTd);
        tr.appendChild(amtTd);
        els.resultsTableBody.appendChild(tr);
      });
    }

    // Summary lines.
    if (els.sumSubtotal) els.sumSubtotal.textContent = peso(est.subtotal);
    if (els.sumAsf) els.sumAsf.textContent = peso(est.asf);

    // Discount row: shown only when a discount was entered.
    if (els.sumDiscount) els.sumDiscount.textContent = '−' + peso(est.discount);
    if (els.discountRow) els.discountRow.hidden = !(est.discount > 0);

    if (els.sumVat) els.sumVat.textContent = peso(est.vat);
    if (els.sumTotal) els.sumTotal.textContent = peso(est.total);
    if (els.sumTotalUsd) els.sumTotalUsd.textContent = '≈ ' + usd(est.totalUsd);

    // Hide the VAT row for Non-VAT clients.
    if (els.vatRow) els.vatRow.hidden = est.nonVat;

    // Budget range (em dash between low and high), in PHP and USD.
    if (els.budgetRange) {
      els.budgetRange.textContent = peso(est.low) + ' — ' + peso(est.high);
    }
    if (els.budgetRangeUsd) {
      els.budgetRangeUsd.textContent =
        '≈ ' + usd(est.lowUsd) + ' — ' + usd(est.highUsd) +
        '  (USD @ ₱' + est.fx.toFixed(2) + '/$)';
    }

    // Reveal results and bring them into view.
    els.resultsSection.hidden = false;
    els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Generate handler: compute then render.
  function onGenerate() {
    try {
      clearError();
      updateFabBadge();
      var est = computeEstimate();
      renderResults(est);
    } catch (err) {
      // Defensive: never let a calculation error crash the page.
      console.error('Failed to generate estimate:', err);
      showError('Sorry, something went wrong generating your estimate. Please try again.');
    }
  }

  /* -------------------------------------------------------------------
   * Data fetching (Supabase)
   * ------------------------------------------------------------------- */

  // Detect the unconfigured-credentials placeholder so we can warn nicely.
  function credentialsMissing() {
    // db is null when config.js could not create the client (placeholder /
    // invalid URL / CDN blocked). Treat any of those as "not configured".
    return (
      typeof db === 'undefined' || !db ||
      typeof SUPABASE_URL === 'undefined' ||
      typeof SUPABASE_ANON_KEY === 'undefined' ||
      SUPABASE_URL === 'YOUR_SUPABASE_URL' ||
      SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY' ||
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY
    );
  }

  // Fetch settings, categories and services. Returns true on success.
  async function loadData() {
    // Settings (single row, id = 1). Fall back to defaults if absent.
    var settingsRes = await db
      .from('settings')
      .select('asf_rate, vat_rate, usd_php_rate')
      .eq('id', 1)
      .maybeSingle();
    if (settingsRes.error) throw settingsRes.error;
    if (settingsRes.data) {
      settings = {
        asf_rate: Number(settingsRes.data.asf_rate),
        vat_rate: Number(settingsRes.data.vat_rate),
        usd_php_rate: Number(settingsRes.data.usd_php_rate) || DEFAULT_USD_PHP,
      };
    }

    // Categories, ordered by sort_order.
    var catRes = await db
      .from('categories')
      .select('id, name, description, sort_order')
      .order('sort_order', { ascending: true });
    if (catRes.error) throw catRes.error;
    categories = catRes.data || [];

    // Services, ordered by sort_order.
    var svcRes = await db
      .from('services')
      .select('id, category_id, name, base_rate, unit, is_fabrication, sort_order')
      .order('sort_order', { ascending: true });
    if (svcRes.error) throw svcRes.error;
    services = svcRes.data || [];

    return true;
  }

  /* -------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------- */

  async function init() {
    cacheEls();
    renderLogistics();
    updateFabBadge();
    populateFootnotes();

    // Wire up interactions.
    if (els.generateBtn) {
      els.generateBtn.addEventListener('click', onGenerate);
    }
    if (els.fabricationToggle) {
      els.fabricationToggle.addEventListener('change', updateFabBadge);
    }
    if (els.serviceSearch) {
      els.serviceSearch.addEventListener('input', filterServices);
    }

    // Guard: missing Supabase credentials -> friendly message, no crash.
    if (credentialsMissing()) {
      if (els.servicesContainer) {
        els.servicesContainer.innerHTML =
          '<p class="loading-msg">Services are not configured yet.</p>';
      }
      showError(
        'This calculator is not connected to a database yet. Please configure ' +
        'Supabase credentials in js/config.js.'
      );
      return;
    }

    // Fetch + render, with graceful failure handling.
    try {
      await loadData();
      renderServices();
      filterServices();
      updateFabBadge();
      populateFootnotes();
      clearError();
    } catch (err) {
      console.error('Failed to load services:', err);
      if (els.servicesContainer) {
        els.servicesContainer.innerHTML =
          '<p class="loading-msg">Unable to load services.</p>';
      }
      showError(
        'Sorry, we could not load the service catalog right now. ' +
        'Please refresh the page or try again later.'
      );
    }
  }

  // Kick things off once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
