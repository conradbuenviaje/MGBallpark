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

  // Service rows by id (from DB) -- used to price/label packages regardless
  // of DOM render order. id -> service object.
  var serviceById = {};

  // Active packages fetched from DB, each with an .items array
  //   { id, core, name, description, discount_type, discount_value, items:[{service_id, quantity}] }
  var packages = [];

  // Currently selected package per core: { 'MET': pkgId, ... }. One per core.
  var selectedPackages = {};

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
    els.serviceSort       = document.getElementById('serviceSort');
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

  /* ---- Package helpers ---------------------------------------------- */

  // Current quantity for a service id (reads its qty input).
  function qtyOf(serviceId) {
    var inp = els.servicesContainer.querySelector(
      '.qty-input[data-service-id="' + serviceId + '"]');
    return inp ? parseQty(inp.value) : 0;
  }

  // Set the quantity input for a service id (if present).
  function setQtyOf(serviceId, q) {
    var inp = els.servicesContainer.querySelector(
      '.qty-input[data-service-id="' + serviceId + '"]');
    if (inp) inp.value = String(q);
  }

  // Selling unit price for a service id, honoring the Non-VAT toggle.
  function unitPriceOf(serviceId, nonVat, vatRate) {
    var s = serviceById[serviceId];
    var selling = (s ? Number(s.base_rate) || 0 : 0) * MARKUP;
    return nonVat ? selling * (1 + vatRate) : selling;
  }

  // Original (undiscounted) selling subtotal of a package's items.
  function packageOriginal(pkg, nonVat, vatRate) {
    var sum = 0;
    (pkg.items || []).forEach(function (it) {
      sum += it.quantity * unitPriceOf(it.service_id, nonVat, vatRate);
    });
    return sum;
  }

  // Discounted package price. 'percentage' -> original*(1-value);
  // 'fixed' -> the fixed PHP value (VAT-adjusted in Non-VAT mode).
  function packagePrice(pkg, original, nonVat, vatRate) {
    if (pkg.discount_type === 'fixed') {
      var fixed = Number(pkg.discount_value) || 0;
      return nonVat ? fixed * (1 + vatRate) : fixed;
    }
    var d = Number(pkg.discount_value) || 0; // fraction, e.g. 0.10
    return original * (1 - d);
  }

  function findPackage(id) {
    for (var i = 0; i < packages.length; i++) {
      if (packages[i].id === id) return packages[i];
    }
    return null;
  }

  // A selected package is "intact" only if every included service still has
  // qty >= the package quantity. Reducing below it voids the discount.
  function packageIntact(pkg) {
    return (pkg.items || []).every(function (it) {
      return qtyOf(it.service_id) >= it.quantity;
    });
  }

  // Select a package: clears any previously selected package in the same core
  // (resetting its qtys), then sets this package's service quantities.
  function selectPackage(pkg) {
    var prevId = selectedPackages[pkg.core];
    if (prevId && prevId !== pkg.id) {
      var prev = findPackage(prevId);
      if (prev) prev.items.forEach(function (it) { setQtyOf(it.service_id, 0); });
    }
    selectedPackages[pkg.core] = pkg.id;
    pkg.items.forEach(function (it) { setQtyOf(it.service_id, it.quantity); });
    syncPackageUI(pkg.core);
    updateFabBadge();
  }

  // Deselect the active package in a core (resets its service quantities).
  function deselectPackage(core) {
    var id = selectedPackages[core];
    if (id) {
      var pkg = findPackage(id);
      if (pkg) pkg.items.forEach(function (it) { setQtyOf(it.service_id, 0); });
    }
    selectedPackages[core] = null;
    syncPackageUI(core);
    updateFabBadge();
  }

  // Reflect the selected package in the card UI (highlight + radio state).
  function syncPackageUI(core) {
    var card = els.servicesContainer.querySelector('.core-card[data-core="' + core + '"]');
    if (!card) return;
    var sel = selectedPackages[core] || null;
    var pkgCards = card.querySelectorAll('.package-card');
    Array.prototype.forEach.call(pkgCards, function (pc) {
      var on = String(pc.getAttribute('data-package-id')) === String(sel);
      pc.classList.toggle('package-selected', on);
      var radio = pc.querySelector('.package-radio');
      if (radio) radio.checked = on;
    });
  }

  // Filter the (large) service catalog by the search box text. While a query
  // is present, auto-expand cores that have matches; when cleared, restore
  // each core to its checkbox (collapsed/expanded) state.
  function filterServices() {
    if (!els.servicesContainer) return;
    var q = els.serviceSearch ? els.serviceSearch.value.trim().toLowerCase() : '';
    var cards = els.servicesContainer.querySelectorAll('.core-card');
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
      if (q) {
        card.hidden = !anyVisible;
        setCoreOpen(card, anyVisible); // expand to reveal matches
      } else {
        card.hidden = false;
        var cb = card.querySelector('.core-toggle');
        setCoreOpen(card, !!(cb && cb.checked)); // restore manual state
      }
    });
  }

  // Re-order service rows within each core's list per the sort dropdown.
  // Reorders DOM nodes in place so quantity inputs / state are preserved.
  function sortServices() {
    if (!els.servicesContainer) return;
    var mode = els.serviceSort ? els.serviceSort.value : 'name-asc';
    var lists = els.servicesContainer.querySelectorAll('.core-body .service-list');
    Array.prototype.forEach.call(lists, function (list) {
      var rows = Array.prototype.slice.call(list.querySelectorAll('.service-row'));
      rows.sort(function (a, b) {
        var an = ((a.querySelector('.service-name') || {}).textContent || '').toUpperCase();
        var bn = ((b.querySelector('.service-name') || {}).textContent || '').toUpperCase();
        if (an === bn) return 0;
        if (mode === 'name-desc') return an > bn ? -1 : 1;
        return an < bn ? -1 : 1;
      });
      rows.forEach(function (r) { list.appendChild(r); });
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

  // Resolve a category id to its core code. Prefer the DB `core` column
  // (admin-managed); fall back to the config map, then FALLBACK_CORE.
  function coreForCategoryId(catId) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === catId) {
        return categories[i].core || CATEGORY_CORE[categories[i].name] || FALLBACK_CORE;
      }
    }
    return FALLBACK_CORE;
  }

  // Show/hide a core's body (the flat service list).
  function setCoreOpen(card, open) {
    var body = card.querySelector('.core-body');
    if (body) body.hidden = !open;
    card.classList.toggle('core-open', open);
  }

  // Render services grouped under the 3 CORES. Each core is a collapsible
  // checkbox; checking it reveals a FLAT list of all its sub-services.
  // Hidden base_rate / is_fabrication live in serviceState (NOT the DOM).
  function renderServices() {
    if (!els.servicesContainer) return;
    els.servicesContainer.innerHTML = '';

    if (!services.length) {
      var empty = document.createElement('p');
      empty.className = 'loading-msg';
      empty.textContent = 'No services are available right now.';
      els.servicesContainer.appendChild(empty);
      return;
    }

    // Group services by core code.
    var byCore = {};
    services.forEach(function (svc) {
      var code = coreForCategoryId(svc.category_id);
      (byCore[code] = byCore[code] || []).push(svc);
    });

    // Render one collapsible card per core, in CORES order.
    CORES.forEach(function (core) {
      var list = (byCore[core.code] || []).slice().sort(function (a, b) {
        return String(a.name).toUpperCase() < String(b.name).toUpperCase() ? -1 : 1;
      });
      if (!list.length) return; // skip empty cores

      var card = document.createElement('section');
      card.className = 'core-card';
      card.setAttribute('data-core', core.code);

      // Header = checkbox + core name + count (acts as the disclosure).
      var header = document.createElement('label');
      header.className = 'core-header';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'core-toggle';
      cb.addEventListener('change', function () {
        setCoreOpen(card, cb.checked);
      });

      var title = document.createElement('span');
      title.className = 'core-title';
      title.textContent = core.name;

      var count = document.createElement('span');
      count.className = 'core-count';
      count.textContent = list.length + ' services';

      header.appendChild(cb);
      header.appendChild(title);
      header.appendChild(count);
      card.appendChild(header);

      if (core.description) {
        var desc = document.createElement('p');
        desc.className = 'core-desc';
        desc.textContent = core.description;
        card.appendChild(desc);
      }

      // Collapsible body: package options (if any) + flat sub-service list.
      var body = document.createElement('div');
      body.className = 'core-body';
      body.hidden = true;

      var pkgSection = renderPackageSection(core.code);
      if (pkgSection) body.appendChild(pkgSection);

      var listWrap = document.createElement('div');
      listWrap.className = 'service-list';
      list.forEach(function (svc) {
        listWrap.appendChild(renderServiceRow(svc));
      });
      body.appendChild(listWrap);

      card.appendChild(body);
      els.servicesContainer.appendChild(card);
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

  // Render the "Package Options" block for a core (or null if no packages).
  function renderPackageSection(coreCode) {
    var list = packages.filter(function (p) { return p.core === coreCode; });
    if (!list.length) return null;

    var nonVat = isNonVat();
    var vatRate = Number(settings.vat_rate) || 0;

    var section = document.createElement('div');
    section.className = 'package-section';

    var h = document.createElement('h4');
    h.className = 'package-section-title';
    h.textContent = '📦 Package Options';
    section.appendChild(h);

    var grid = document.createElement('div');
    grid.className = 'package-grid';

    list.forEach(function (pkg) {
      var original = packageOriginal(pkg, nonVat, vatRate);
      var price = packagePrice(pkg, original, nonVat, vatRate);
      var savePct = original > 0 ? Math.round((1 - price / original) * 100) : 0;

      var card = document.createElement('div');
      card.className = 'package-card';
      card.setAttribute('data-package-id', String(pkg.id));

      var header = document.createElement('div');
      header.className = 'package-header';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.className = 'package-radio';
      radio.name = 'package-' + coreCode;
      radio.addEventListener('change', function () { selectPackage(pkg); });
      var nm = document.createElement('h5');
      nm.className = 'package-name';
      nm.textContent = pkg.name;
      header.appendChild(radio);
      header.appendChild(nm);
      if (savePct > 0) {
        var badge = document.createElement('span');
        badge.className = 'package-badge';
        badge.textContent = 'Save ' + savePct + '%';
        header.appendChild(badge);
      }
      card.appendChild(header);

      if (pkg.description) {
        var d = document.createElement('p');
        d.className = 'package-description';
        d.textContent = pkg.description;
        card.appendChild(d);
      }

      if (pkg.items && pkg.items.length) {
        var inc = document.createElement('div');
        inc.className = 'package-includes';
        var small = document.createElement('small');
        small.textContent = 'Includes:';
        inc.appendChild(small);
        var ul = document.createElement('ul');
        pkg.items.forEach(function (it) {
          var s = serviceById[it.service_id];
          var li = document.createElement('li');
          li.textContent = it.quantity + '× ' + (s ? s.name : ('Service #' + it.service_id));
          ul.appendChild(li);
        });
        inc.appendChild(ul);
        card.appendChild(inc);
      }

      var pricing = document.createElement('div');
      pricing.className = 'package-pricing';
      if (price < original) {
        var op = document.createElement('span');
        op.className = 'original-price';
        op.textContent = peso(original);
        pricing.appendChild(op);
      }
      var dp = document.createElement('span');
      dp.className = 'discounted-price';
      dp.textContent = peso(price);
      pricing.appendChild(dp);
      card.appendChild(pricing);

      var actions = document.createElement('div');
      actions.className = 'package-actions';
      var selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'btn btn-primary select-package-btn';
      selBtn.textContent = 'Select Package';
      selBtn.addEventListener('click', function () { selectPackage(pkg); });
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-ghost deselect-package-btn';
      delBtn.textContent = 'Deselect';
      delBtn.addEventListener('click', function () { deselectPackage(coreCode); });
      actions.appendChild(selBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);

      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
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
    var notes = [];
    var subtotal = 0;

    // 1) Active packages (selected AND intact) bill at their discounted price.
    //    Track how much of each service is "covered" so extra qty bills as add-on.
    var pkgBase = {}; // serviceId -> qty covered by active packages
    Object.keys(selectedPackages).forEach(function (core) {
      var id = selectedPackages[core];
      if (!id) return;
      var pkg = findPackage(id);
      if (!pkg) return;

      if (packageIntact(pkg)) {
        var original = packageOriginal(pkg, nonVat, vatRate);
        var price = packagePrice(pkg, original, nonVat, vatRate);
        subtotal += price;
        lineItems.push({
          name: '📦 ' + pkg.name,
          qty: 1,
          unitPrice: price,
          amount: price,
          isPackage: true,
          original: original,
        });
        pkg.items.forEach(function (it) {
          pkgBase[it.service_id] = (pkgBase[it.service_id] || 0) + it.quantity;
        });
      } else {
        // Customized below package quantities -> discount voided (individual rates).
        notes.push('Package "' + pkg.name + '" was customized — individual pricing applied.');
      }
    });

    // 2) Individual lines: bill qty NOT covered by an active package.
    var inputs = els.servicesContainer.querySelectorAll('.qty-input');
    Array.prototype.forEach.call(inputs, function (input) {
      var qty = parseQty(input.value);
      if (qty <= 0) return;

      var id = String(input.getAttribute('data-service-id'));
      var state = serviceState.get(id);
      if (!state) return;

      var covered = pkgBase[id] || 0;
      var billable = qty - Math.min(qty, covered);
      if (billable <= 0) return; // fully covered by a package

      var sellingRate = (Number(state.base_rate) || 0) * MARKUP;
      var unitPrice = nonVat ? sellingRate * (1 + vatRate) : sellingRate;
      var amount = billable * unitPrice;

      subtotal += amount;
      lineItems.push({
        name: state.name + (covered > 0 ? ' (add-on)' : ''),
        qty: billable,
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
      notes: notes,
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
        if (item.isPackage) tr.className = 'package-line';

        var nameTd = document.createElement('td');
        nameTd.textContent = item.name;

        var qtyTd = document.createElement('td');
        qtyTd.className = 'num';
        qtyTd.textContent = String(item.qty);

        var priceTd = document.createElement('td');
        priceTd.className = 'num';
        if (item.isPackage && item.original > item.amount) {
          // Package: original price crossed out, discounted price beside it.
          var orig = document.createElement('span');
          orig.className = 'original-price';
          orig.textContent = peso(item.original);
          var disc = document.createElement('span');
          disc.className = 'discounted-price';
          disc.textContent = peso(item.unitPrice);
          priceTd.appendChild(orig);
          priceTd.appendChild(document.createTextNode(' '));
          priceTd.appendChild(disc);
        } else {
          priceTd.textContent = peso(item.unitPrice);
        }

        var amtTd = document.createElement('td');
        amtTd.className = 'num';
        amtTd.textContent = peso(item.amount);

        tr.appendChild(nameTd);
        tr.appendChild(qtyTd);
        tr.appendChild(priceTd);
        tr.appendChild(amtTd);
        els.resultsTableBody.appendChild(tr);
      });

      // Customization notes (e.g. a package whose discount was voided).
      (est.notes || []).forEach(function (n) {
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = 4;
        td.className = 'muted package-note';
        td.textContent = '⚠ ' + n;
        tr.appendChild(td);
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
      .select('id, name, description, sort_order, core')
      .order('sort_order', { ascending: true });
    if (catRes.error) throw catRes.error;
    categories = catRes.data || [];

    // Services, ordered by sort_order.
    // select('*') is resilient to the is_active column not existing yet.
    var svcRes = await db
      .from('services')
      .select('*')
      .order('sort_order', { ascending: true });
    if (svcRes.error) throw svcRes.error;
    // Hide services the admin disabled (is_active === false). Missing column
    // (undefined) is treated as active.
    services = (svcRes.data || []).filter(function (s) { return s.is_active !== false; });
    serviceById = {};
    services.forEach(function (s) { serviceById[s.id] = s; });

    // Packages (optional). Resilient: if the tables don't exist yet, skip
    // silently so the rest of the catalog still loads.
    packages = [];
    try {
      var pkgRes = await db
        .from('packages')
        .select('id, core, name, description, discount_type, discount_value, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (!pkgRes.error && pkgRes.data && pkgRes.data.length) {
        var psRes = await db
          .from('package_services')
          .select('package_id, service_id, quantity, sort_order')
          .order('sort_order', { ascending: true });
        var items = (!psRes.error && psRes.data) ? psRes.data : [];
        pkgRes.data.forEach(function (p) {
          p.items = items
            .filter(function (i) { return i.package_id === p.id; })
            .map(function (i) { return { service_id: i.service_id, quantity: i.quantity }; });
        });
        packages = pkgRes.data;
      }
    } catch (e) {
      console.warn('Packages unavailable:', e);
      packages = [];
    }

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
    if (els.serviceSort) {
      els.serviceSort.addEventListener('change', sortServices);
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
