/* =====================================================================
 * admin.js  --  Admin panel for MG Ballpark
 * =====================================================================
 *
 *  Responsibilities:
 *    - Load & save global settings (settings row id = 1).
 *        * Inputs DISPLAY / ACCEPT percentages (e.g. 12.5, 12).
 *        * The DB stores FRACTIONS (0.125, 0.12).
 *        * Multiply by 100 on load, divide by 100 on save.
 *    - Full CRUD on categories (add / edit / delete).
 *    - Full CRUD on services per category (add / edit / delete).
 *    - All writes go straight to Supabase via the global `db` client
 *      defined in config.js. After every mutation we re-fetch and
 *      re-render so the UI stays in sync with the database.
 *    - User feedback flows through a single status bar (#statusBar).
 *
 *  Dependencies (all globals from config.js, loaded before this file):
 *    db   -> Supabase client
 *  This script binds to the ids declared in admin.html.
 * ===================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------
   * Element references (resolved once on DOMContentLoaded)
   * ----------------------------------------------------------------- */
  let statusBar;
  let asfRateInput;
  let vatRateInput;
  let usdRateInput;
  let updateSettingsBtn;
  let categoriesContainer;
  let addCategoryBtn;
  let addCategoryForm;
  let cancelAddCategoryBtn;
  let newCategoryName;
  let newCategoryDescription;

  /* Captured catalog (set on each load) + package working state. */
  let allCategories = [];
  let allServices = [];
  let packagesData = [];
  let editingPackageItems = []; // [{service_id, quantity, name}] for the open form
  const selectedServiceIds = new Set(); // bulk selection in the services table

  /* Auto-hide timer handle for the status bar. */
  let statusTimer = null;

  /* ===================================================================
   * Status / feedback helpers
   * ================================================================= */

  /**
   * Show a transient message in the status bar.
   * @param {string} message  Text to display.
   * @param {('success'|'error'|'info')} [type='info']  Visual style.
   */
  function showStatus(message, type) {
    if (!statusBar) return;
    type = type || 'info';
    statusBar.textContent = message;
    statusBar.className = 'status-bar status-' + type;
    statusBar.hidden = false;

    if (statusTimer) clearTimeout(statusTimer);
    // Errors linger longer than successes so they are not missed.
    statusTimer = setTimeout(function () {
      statusBar.hidden = true;
    }, type === 'error' ? 6000 : 3500);
  }

  /* ===================================================================
   * Settings: load & save
   * ================================================================= */

  /**
   * Fetch the single settings row (id = 1) and populate the inputs.
   * DB stores fractions; inputs display percentages -> multiply by 100.
   */
  async function loadSettings() {
    // Schema defaults, used both when the row is missing and as a fallback.
    const DEFAULTS = { asf_rate: 0.125, vat_rate: 0.12, usd_php_rate: 55.89 };
    try {
      // maybeSingle() returns null (not an error) when the row is absent, so a
      // missing settings row can't lock the admin out of the form.
      const { data, error } = await db
        .from('settings')
        .select('asf_rate, vat_rate, usd_php_rate')
        .eq('id', 1)
        .maybeSingle();

      if (error) throw error;

      const src = data || DEFAULTS;
      // fraction -> percent for display; toFixed(4) trims float noise
      // (e.g. 0.145 * 100 = 14.499999...) while preserving DECIMAL(5,4) scale.
      asfRateInput.value = trimNum(Number(src.asf_rate) * 100);
      vatRateInput.value = trimNum(Number(src.vat_rate) * 100);
      // FX rate is a plain number (PHP per USD), not a percentage.
      usdRateInput.value = trimNum(Number(src.usd_php_rate) || DEFAULTS.usd_php_rate);

      if (!data) {
        showStatus('No settings row found — showing defaults. Click "Save Settings" to create it.', 'info');
      }
    } catch (err) {
      console.error('loadSettings failed:', err);
      // Still prefill defaults so the admin can recover by saving.
      asfRateInput.value = trimNum(DEFAULTS.asf_rate * 100);
      vatRateInput.value = trimNum(DEFAULTS.vat_rate * 100);
      usdRateInput.value = trimNum(DEFAULTS.usd_php_rate);
      showStatus('Could not load settings: ' + (err.message || err), 'error');
    }
  }

  /** Trim floating-point noise from a percentage value for display. */
  function trimNum(n) {
    return parseFloat(Number(n).toFixed(4));
  }

  /**
   * Persist the settings inputs to the DB.
   * Inputs are percentages; the DB stores fractions -> divide by 100.
   * Always targets the single settings row (id = 1).
   */
  async function saveSettings() {
    // Parse + validate the inputs defensively.
    const asfPercent = parseFloat(asfRateInput.value);
    const vatPercent = parseFloat(vatRateInput.value);
    const usdRate = parseFloat(usdRateInput.value);

    if (isNaN(asfPercent) || asfPercent < 0 ||
        isNaN(vatPercent) || vatPercent < 0) {
      showStatus('Please enter valid, non-negative percentages.', 'error');
      return;
    }
    if (isNaN(usdRate) || usdRate <= 0) {
      showStatus('Please enter a valid USD → PHP rate (greater than 0).', 'error');
      return;
    }

    updateSettingsBtn.disabled = true;
    try {
      // upsert (not update) so the single settings row is created if missing
      // and updated if present — keeps the admin usable even on a fresh DB.
      const { error } = await db
        .from('settings')
        .upsert({
          id: 1,
          asf_rate: asfPercent / 100, // percent -> fraction
          vat_rate: vatPercent / 100, // percent -> fraction
          usd_php_rate: usdRate,      // plain PHP-per-USD rate
        });

      if (error) throw error;

      showStatus('Settings saved.', 'success');
      // Re-fetch so the inputs reflect exactly what was stored.
      await loadSettings();
    } catch (err) {
      console.error('saveSettings failed:', err);
      showStatus('Could not save settings: ' + (err.message || err), 'error');
    } finally {
      updateSettingsBtn.disabled = false;
    }
  }

  /* ===================================================================
   * Categories + services: fetch & render
   * ================================================================= */

  /**
   * Fetch all categories and all services (ordered by sort_order),
   * then re-render the categories container from scratch.
   */
  async function loadCategoriesAndServices() {
    try {
      const [catRes, svcRes] = await Promise.all([
        db.from('categories')
          .select('id, name, description, sort_order, core')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }),
        db.from('services')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }),
      ]);

      if (catRes.error) throw catRes.error;
      if (svcRes.error) throw svcRes.error;

      allCategories = catRes.data || [];
      allServices = svcRes.data || [];
      renderCategories(allCategories, allServices);
      renderServicesTable();
    } catch (err) {
      console.error('loadCategoriesAndServices failed:', err);
      categoriesContainer.innerHTML =
        '<p class="notice notice-error">Could not load categories: ' +
        escapeHtml(err.message || String(err)) + '</p>';
    }
  }

  /**
   * Render every category card (with its services) into the container.
   * @param {Array} categories
   * @param {Array} services
   */
  function renderCategories(categories, services) {
    categoriesContainer.innerHTML = '';

    if (!categories.length) {
      categoriesContainer.innerHTML =
        '<p class="muted">No categories yet. Click &ldquo;Add Category&rdquo; to create one.</p>';
      return;
    }

    // Group services by their category_id for quick lookup.
    const byCategory = {};
    services.forEach(function (svc) {
      (byCategory[svc.category_id] = byCategory[svc.category_id] || []).push(svc);
    });

    categories.forEach(function (cat) {
      categoriesContainer.appendChild(
        buildCategoryCard(cat, byCategory[cat.id] || [])
      );
    });
  }

  /* ===================================================================
   * Category card builder
   * ================================================================= */

  /**
   * Build one editable category card (name/description + delete/save),
   * its services table, and an "add service" form.
   * @param {Object} cat
   * @param {Array} svcList
   * @returns {HTMLElement}
   */
  function buildCategoryCard(cat, svcList) {
    const card = document.createElement('section');
    card.className = 'category-card';
    card.dataset.categoryId = cat.id;

    /* ---- Editable category header ---- */
    const head = document.createElement('div');
    head.className = 'category-edit field-row';

    head.appendChild(makeField('Name', makeInput('text', cat.name || '', 'cat-name')));
    head.appendChild(
      makeField('Description', makeInput('text', cat.description || '', 'cat-description'))
    );
    head.appendChild(makeField('Core', makeCoreSelect(cat.core, 'cat-core')));

    const headActions = document.createElement('div');
    headActions.className = 'field field-action';

    const saveCatBtn = makeButton('Save', 'btn btn-primary');
    saveCatBtn.addEventListener('click', function () {
      saveCategory(cat.id, card);
    });

    const delCatBtn = makeButton('Delete', 'btn btn-danger');
    delCatBtn.addEventListener('click', function () {
      deleteCategory(cat.id, cat.name);
    });

    headActions.appendChild(saveCatBtn);
    headActions.appendChild(delCatBtn);
    head.appendChild(headActions);
    card.appendChild(head);
    return card; // services are managed in the dedicated Services table below
  }

  /* ===================================================================
   * Services data table (filter / sort / bulk / inline edit)
   * ================================================================= */

  function categoryName(id) {
    for (var i = 0; i < allCategories.length; i++) {
      if (allCategories[i].id === id) return allCategories[i].name;
    }
    return '';
  }

  // Fill the category filter (once) and the add-service category select.
  function populateServiceFilterDropdowns() {
    var catFilter = document.getElementById('svcCategoryFilter');
    var addCat = document.getElementById('newServiceCategory');
    if (catFilter && catFilter.dataset.filled !== '1') {
      var opts = '<option value="">All categories</option>';
      allCategories.forEach(function (c) {
        opts += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      });
      catFilter.innerHTML = opts;
      catFilter.dataset.filled = '1';
    }
    if (addCat) {
      var a = '';
      allCategories.forEach(function (c) {
        a += '<option value="' + c.id + '">' + escapeHtml(c.name) + ' (' + (c.core || 'MET') + ')</option>';
      });
      addCat.innerHTML = a;
    }
  }

  function getFilteredServices() {
    var q = ((document.getElementById('svcSearch') || {}).value || '').trim().toLowerCase();
    var core = (document.getElementById('svcCoreFilter') || {}).value || '';
    var cat = (document.getElementById('svcCategoryFilter') || {}).value || '';
    var status = (document.getElementById('svcStatusFilter') || {}).value || '';
    var sort = (document.getElementById('svcSort') || {}).value || 'name-asc';

    var list = allServices.filter(function (s) {
      if (q && String(s.name).toLowerCase().indexOf(q) === -1) return false;
      if (core && coreOfService(s) !== core) return false;
      if (cat && String(s.category_id) !== String(cat)) return false;
      if (status === 'active' && s.is_active === false) return false;
      if (status === 'inactive' && s.is_active !== false) return false;
      return true;
    });
    list.sort(function (a, b) {
      var an = String(a.name).toUpperCase(), bn = String(b.name).toUpperCase();
      switch (sort) {
        case 'name-desc': return an < bn ? 1 : (an > bn ? -1 : 0);
        case 'rate-asc': return (Number(a.base_rate) || 0) - (Number(b.base_rate) || 0);
        case 'rate-desc': return (Number(b.base_rate) || 0) - (Number(a.base_rate) || 0);
        default: return an < bn ? -1 : (an > bn ? 1 : 0);
      }
    });
    return list;
  }

  function renderServicesTable() {
    var wrap = document.getElementById('servicesTableWrap');
    if (!wrap) return;
    populateServiceFilterDropdowns();

    // Drop selections for services that no longer exist.
    var liveIds = {};
    allServices.forEach(function (s) { liveIds[s.id] = true; });
    Array.from(selectedServiceIds).forEach(function (id) { if (!liveIds[id]) selectedServiceIds.delete(id); });

    var list = getFilteredServices();
    var countEl = document.getElementById('svcResultCount');
    if (countEl) countEl.textContent = list.length + ' service' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      wrap.innerHTML = '<p class="muted">No services match the filters.</p>';
      updateBulkBar();
      return;
    }

    var table = document.createElement('table');
    table.className = 'svc-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th class="col-check"><input type="checkbox" id="svcSelectAll" aria-label="Select all shown"></th>' +
      '<th>Name</th><th>Core</th><th>Category</th><th class="num">Base Rate</th>' +
      '<th>Unit</th><th class="col-c">Fab</th><th class="col-c">Active</th><th>Actions</th>' +
      '</tr></thead>';
    var tbody = document.createElement('tbody');
    list.forEach(function (svc) { tbody.appendChild(buildServiceTableRow(svc)); });
    table.appendChild(tbody);
    wrap.innerHTML = '';
    wrap.appendChild(table);

    var selAll = document.getElementById('svcSelectAll');
    if (selAll) {
      selAll.addEventListener('change', function () {
        Array.prototype.forEach.call(tbody.querySelectorAll('.svc-select'), function (c) {
          c.checked = selAll.checked;
          var id = parseInt(c.getAttribute('data-id'), 10);
          if (selAll.checked) selectedServiceIds.add(id); else selectedServiceIds.delete(id);
        });
        updateBulkBar();
      });
    }
    updateBulkBar();
  }

  function buildServiceTableRow(svc) {
    var tr = document.createElement('tr');
    tr.dataset.serviceId = svc.id;
    if (svc.is_active === false) tr.classList.add('svc-inactive');

    var tdC = document.createElement('td'); tdC.className = 'col-check';
    var chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'svc-select'; chk.setAttribute('data-id', svc.id);
    chk.checked = selectedServiceIds.has(svc.id);
    chk.addEventListener('change', function () {
      if (chk.checked) selectedServiceIds.add(svc.id); else selectedServiceIds.delete(svc.id);
      updateBulkBar();
    });
    tdC.appendChild(chk); tr.appendChild(tdC);

    var tdN = document.createElement('td');
    tdN.appendChild(makeInput('text', svc.name || '', 'svc-name')); tr.appendChild(tdN);

    var tdCore = document.createElement('td'); tdCore.textContent = coreOfService(svc); tr.appendChild(tdCore);

    var tdCat = document.createElement('td'); tdCat.className = 'muted';
    tdCat.textContent = categoryName(svc.category_id); tr.appendChild(tdCat);

    var tdR = document.createElement('td'); tdR.className = 'num';
    var rIn = makeInput('number', svc.base_rate != null ? svc.base_rate : '', 'svc-base-rate');
    rIn.min = '0'; rIn.step = '0.01'; rIn.inputMode = 'decimal';
    tdR.appendChild(rIn); tr.appendChild(tdR);

    var tdU = document.createElement('td');
    tdU.appendChild(makeInput('text', svc.unit || '', 'svc-unit')); tr.appendChild(tdU);

    var tdF = document.createElement('td'); tdF.className = 'col-c';
    var fIn = document.createElement('input'); fIn.type = 'checkbox'; fIn.className = 'svc-is-fabrication';
    fIn.checked = !!svc.is_fabrication; tdF.appendChild(fIn); tr.appendChild(tdF);

    var tdA = document.createElement('td'); tdA.className = 'col-c';
    var aIn = document.createElement('input'); aIn.type = 'checkbox'; aIn.className = 'svc-active';
    aIn.checked = svc.is_active !== false; tdA.appendChild(aIn); tr.appendChild(tdA);

    var tdAct = document.createElement('td');
    var save = makeButton('Save', 'btn btn-primary btn-sm');
    save.addEventListener('click', function () { saveService(svc.id, tr); });
    var del = makeButton('Del', 'btn btn-danger btn-sm');
    del.addEventListener('click', function () { deleteService(svc.id, svc.name); });
    tdAct.appendChild(save); tdAct.appendChild(del); tr.appendChild(tdAct);

    return tr;
  }

  function updateBulkBar() {
    var bar = document.getElementById('svcBulkBar');
    if (!bar) return;
    var n = selectedServiceIds.size;
    bar.hidden = n === 0;
    var c = document.getElementById('svcBulkCount');
    if (c) c.textContent = n + ' selected';
  }

  async function bulkSetActive(active) {
    if (!selectedServiceIds.size) return;
    var ids = Array.from(selectedServiceIds);
    try {
      var r = await db.from('services').update({ is_active: active }).in('id', ids);
      if (r.error) throw r.error;
      showStatus((active ? 'Enabled ' : 'Disabled ') + ids.length + ' service(s).', 'success');
      selectedServiceIds.clear();
      await loadCategoriesAndServices();
    } catch (err) { showStatus('Bulk update failed: ' + (err.message || err), 'error'); }
  }

  async function bulkDeleteServices() {
    if (!selectedServiceIds.size) return;
    var ids = Array.from(selectedServiceIds);
    if (!window.confirm('Delete ' + ids.length + ' selected service(s)? This cannot be undone.')) return;
    try {
      var r = await db.from('services').delete().in('id', ids);
      if (r.error) throw r.error;
      showStatus('Deleted ' + ids.length + ' service(s).', 'success');
      selectedServiceIds.clear();
      await loadCategoriesAndServices();
    } catch (err) { showStatus('Bulk delete failed: ' + (err.message || err), 'error'); }
  }

  async function addServiceFromForm() {
    var catEl = document.getElementById('newServiceCategory');
    var nameEl = document.getElementById('newServiceName');
    var rateEl = document.getElementById('newServiceRate');
    var unitEl = document.getElementById('newServiceUnit');
    var fabEl = document.getElementById('newServiceFab');
    var categoryId = catEl ? parseInt(catEl.value, 10) : NaN;
    var name = (nameEl.value || '').trim();
    var baseRate = parseFloat(rateEl.value);
    if (!categoryId) { showStatus('Pick a category for the new service.', 'error'); return; }
    if (!name) { showStatus('Service name is required.', 'error'); return; }
    if (isNaN(baseRate) || baseRate < 0) { showStatus('Base rate must be a valid, non-negative number.', 'error'); return; }
    try {
      var r = await db.from('services').insert({
        category_id: categoryId, name: name, base_rate: baseRate,
        unit: (unitEl.value || '').trim(), is_fabrication: fabEl.checked, is_active: true,
      });
      if (r.error) throw r.error;
      nameEl.value = ''; rateEl.value = ''; unitEl.value = ''; fabEl.checked = false;
      showStatus('Service added.', 'success');
      await loadCategoriesAndServices();
    } catch (err) { showStatus('Could not add service: ' + (err.message || err), 'error'); }
  }

  /* ===================================================================
   * Category mutations (insert / update / delete)
   * ================================================================= */

  /** Insert a new category from the top-level add-category form. */
  async function addCategory() {
    const name = (newCategoryName.value || '').trim();
    const description = (newCategoryDescription.value || '').trim();
    const coreEl = document.getElementById('newCategoryCore');
    const core = coreEl ? coreEl.value : 'MET';

    if (!name) {
      showStatus('Category name is required.', 'error');
      return;
    }

    try {
      const { error } = await db
        .from('categories')
        .insert({ name: name, description: description, core: core });

      if (error) throw error;

      // Reset + hide the form, then refresh.
      newCategoryName.value = '';
      newCategoryDescription.value = '';
      addCategoryForm.hidden = true;

      showStatus('Category added.', 'success');
      await loadCategoriesAndServices();
    } catch (err) {
      console.error('addCategory failed:', err);
      showStatus('Could not add category: ' + (err.message || err), 'error');
    }
  }

  /**
   * Update an existing category from its card's inputs.
   * @param {number} categoryId
   * @param {HTMLElement} card
   */
  async function saveCategory(categoryId, card) {
    const name = (card.querySelector('.cat-name').value || '').trim();
    const description = (card.querySelector('.cat-description').value || '').trim();
    const coreEl = card.querySelector('.cat-core');
    const core = coreEl ? coreEl.value : 'MET';

    if (!name) {
      showStatus('Category name is required.', 'error');
      return;
    }

    try {
      const { error } = await db
        .from('categories')
        .update({ name: name, description: description, core: core })
        .eq('id', categoryId);

      if (error) throw error;

      showStatus('Category saved.', 'success');
      await loadCategoriesAndServices();
    } catch (err) {
      console.error('saveCategory failed:', err);
      showStatus('Could not save category: ' + (err.message || err), 'error');
    }
  }

  /**
   * Delete a category (and, via ON DELETE CASCADE, its services).
   * Confirms first.
   * @param {number} categoryId
   * @param {string} categoryName
   */
  async function deleteCategory(categoryId, categoryName) {
    const label = categoryName ? '"' + categoryName + '"' : 'this category';
    const ok = window.confirm(
      'Delete ' + label + ' and ALL of its services?\nThis cannot be undone.'
    );
    if (!ok) return;

    try {
      const { error } = await db
        .from('categories')
        .delete()
        .eq('id', categoryId);

      if (error) throw error;

      showStatus('Category deleted.', 'success');
      await loadCategoriesAndServices();
    } catch (err) {
      console.error('deleteCategory failed:', err);
      showStatus('Could not delete category: ' + (err.message || err), 'error');
    }
  }

  /* ===================================================================
   * Service mutations (insert / update / delete)
   * ================================================================= */

  /**
   * Insert a new service into a category from its add-service form.
   * @param {number} categoryId
   * @param {HTMLElement} form
   */
  async function addService(categoryId, form) {
    const name = (form.querySelector('.new-svc-name').value || '').trim();
    const baseRateRaw = form.querySelector('.new-svc-base-rate').value;
    const unit = (form.querySelector('.new-svc-unit').value || '').trim();
    const isFab = form.querySelector('.new-svc-is-fabrication').checked;

    const baseRate = parseFloat(baseRateRaw);

    if (!name) {
      showStatus('Service name is required.', 'error');
      return;
    }
    if (isNaN(baseRate) || baseRate < 0) {
      showStatus('Base rate must be a valid, non-negative number.', 'error');
      return;
    }

    try {
      const { error } = await db
        .from('services')
        .insert({
          category_id: categoryId,
          name: name,
          base_rate: baseRate,
          unit: unit,
          is_fabrication: isFab,
        });

      if (error) throw error;

      showStatus('Service added.', 'success');
      await loadCategoriesAndServices();
    } catch (err) {
      console.error('addService failed:', err);
      showStatus('Could not add service: ' + (err.message || err), 'error');
    }
  }

  /**
   * Update an existing service from its row's inputs.
   * @param {number} serviceId
   * @param {HTMLElement} row
   */
  async function saveService(serviceId, row) {
    const name = (row.querySelector('.svc-name').value || '').trim();
    const baseRateRaw = row.querySelector('.svc-base-rate').value;
    const unit = (row.querySelector('.svc-unit').value || '').trim();
    const isFab = row.querySelector('.svc-is-fabrication').checked;
    const activeEl = row.querySelector('.svc-active');
    const isActive = activeEl ? activeEl.checked : true;

    const baseRate = parseFloat(baseRateRaw);

    if (!name) {
      showStatus('Service name is required.', 'error');
      return;
    }
    if (isNaN(baseRate) || baseRate < 0) {
      showStatus('Base rate must be a valid, non-negative number.', 'error');
      return;
    }

    try {
      const { error } = await db
        .from('services')
        .update({
          name: name,
          base_rate: baseRate,
          unit: unit,
          is_fabrication: isFab,
          is_active: isActive,
        })
        .eq('id', serviceId);

      if (error) throw error;

      showStatus('Service saved.', 'success');
      await loadCategoriesAndServices();
    } catch (err) {
      console.error('saveService failed:', err);
      showStatus('Could not save service: ' + (err.message || err), 'error');
    }
  }

  /**
   * Delete a single service. Confirms first.
   * @param {number} serviceId
   * @param {string} serviceName
   */
  async function deleteService(serviceId, serviceName) {
    const label = serviceName ? '"' + serviceName + '"' : 'this service';
    const ok = window.confirm('Delete ' + label + '?\nThis cannot be undone.');
    if (!ok) return;

    try {
      const { error } = await db
        .from('services')
        .delete()
        .eq('id', serviceId);

      if (error) throw error;

      showStatus('Service deleted.', 'success');
      await loadCategoriesAndServices();
    } catch (err) {
      console.error('deleteService failed:', err);
      showStatus('Could not delete service: ' + (err.message || err), 'error');
    }
  }

  /* ===================================================================
   * Small DOM helpers
   * ================================================================= */

  /* ===================================================================
   * Packages: fetch, render, CRUD
   * ================================================================= */

  // Core code for a service (via its category's core).
  function coreOfService(svc) {
    for (var i = 0; i < allCategories.length; i++) {
      if (allCategories[i].id === svc.category_id) return allCategories[i].core || 'MET';
    }
    return 'MET';
  }

  function serviceName(id) {
    for (var i = 0; i < allServices.length; i++) {
      if (allServices[i].id === id) return allServices[i].name;
    }
    return 'Service #' + id;
  }

  async function loadPackages() {
    if (typeof db === 'undefined' || !db) return;
    try {
      const [pkgRes, psRes] = await Promise.all([
        db.from('packages').select('*')
          .order('sort_order', { ascending: true }).order('id', { ascending: true }),
        db.from('package_services').select('package_id, service_id, quantity, sort_order')
          .order('sort_order', { ascending: true }),
      ]);
      if (pkgRes.error) throw pkgRes.error;
      const items = (!psRes.error && psRes.data) ? psRes.data : [];
      packagesData = (pkgRes.data || []).map(function (p) {
        p.items = items.filter(function (i) { return i.package_id === p.id; });
        return p;
      });
      renderPackagesList();
    } catch (err) {
      console.error('loadPackages failed:', err);
      const list = document.getElementById('packagesList');
      if (list) {
        list.innerHTML = '<p class="notice notice-error">Could not load packages: ' +
          escapeHtml(err.message || String(err)) +
          '. Make sure the packages SQL has been run.</p>';
      }
    }
  }

  function renderPackagesList() {
    const wrap = document.getElementById('packagesList');
    if (!wrap) return;
    const filter = (document.getElementById('packageCoreFilter') || {}).value || '';
    const list = packagesData.filter(function (p) { return !filter || p.core === filter; });
    wrap.innerHTML = '';
    if (!list.length) {
      wrap.innerHTML = '<p class="muted">No packages yet. Click &ldquo;Add Package&rdquo;.</p>';
      return;
    }
    list.forEach(function (p) {
      const card = document.createElement('div');
      card.className = 'package-admin-item';

      const disc = p.discount_type === 'percentage'
        ? ((Number(p.discount_value) * 100).toFixed(2).replace(/\.?0+$/, '') + '% off')
        : ('₱' + Number(p.discount_value).toLocaleString('en-PH'));

      const head = document.createElement('div');
      head.className = 'package-admin-head';
      const title = document.createElement('strong');
      title.textContent = p.name;
      const status = document.createElement('span');
      status.className = 'package-status ' + (p.is_active ? 'active' : 'inactive');
      status.textContent = p.is_active ? 'Active' : 'Inactive';
      head.appendChild(title);
      head.appendChild(status);
      card.appendChild(head);

      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.style.fontSize = '0.85rem';
      meta.textContent = 'Core: ' + p.core + '  ·  ' + disc + '  ·  ' + (p.items ? p.items.length : 0) + ' services';
      card.appendChild(meta);

      const inc = document.createElement('div');
      inc.className = 'muted';
      inc.style.fontSize = '0.8rem';
      inc.textContent = (p.items || []).map(function (it) {
        return it.quantity + '× ' + serviceName(it.service_id);
      }).join(', ');
      card.appendChild(inc);

      const act = document.createElement('div');
      act.className = 'field-action';
      const e = makeButton('✏️ Edit', 'btn btn-primary');
      e.addEventListener('click', function () { openPackageForm(p); });
      const t = makeButton(p.is_active ? 'Deactivate' : 'Activate', 'btn btn-ghost');
      t.addEventListener('click', function () { togglePackage(p); });
      const d = makeButton('🗑️ Delete', 'btn btn-danger');
      d.addEventListener('click', function () { deletePackage(p); });
      act.appendChild(e);
      act.appendChild(t);
      act.appendChild(d);
      card.appendChild(act);

      wrap.appendChild(card);
    });
  }

  function populatePackageServiceSelect(core) {
    const sel = document.getElementById('packageServiceSelect');
    if (!sel) return;
    sel.innerHTML = '';
    allServices
      .filter(function (s) { return coreOfService(s) === core; })
      .slice()
      .sort(function (a, b) { return a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1; })
      .forEach(function (s) {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        sel.appendChild(o);
      });
  }

  function renderEditingItems() {
    const ul = document.getElementById('packageItemsList');
    if (!ul) return;
    ul.innerHTML = '';
    editingPackageItems.forEach(function (it, idx) {
      const li = document.createElement('li');
      li.textContent = it.quantity + '× ' + (it.name || serviceName(it.service_id)) + ' ';
      const x = makeButton('remove', 'btn btn-ghost');
      x.style.minHeight = '28px';
      x.style.padding = '0.1rem 0.5rem';
      x.addEventListener('click', function () {
        editingPackageItems.splice(idx, 1);
        renderEditingItems();
      });
      li.appendChild(x);
      ul.appendChild(li);
    });
  }

  function openPackageForm(pkg) {
    const form = document.getElementById('packageForm');
    if (!form) return;
    form.hidden = false;
    document.getElementById('packageId').value = pkg ? pkg.id : '';
    document.getElementById('packageCore').value = pkg ? pkg.core : 'MET';
    document.getElementById('packageName').value = pkg ? pkg.name : '';
    document.getElementById('packageDescription').value = pkg ? (pkg.description || '') : '';
    document.getElementById('packageDiscountType').value = pkg ? pkg.discount_type : 'percentage';
    document.getElementById('packageActive').checked = pkg ? !!pkg.is_active : true;
    let dv = '';
    if (pkg) dv = pkg.discount_type === 'percentage' ? Number(pkg.discount_value) * 100 : Number(pkg.discount_value);
    document.getElementById('packageDiscountValue').value = dv === '' ? '' : +Number(dv).toFixed(4);
    editingPackageItems = pkg
      ? (pkg.items || []).map(function (it) { return { service_id: it.service_id, quantity: it.quantity, name: serviceName(it.service_id) }; })
      : [];
    populatePackageServiceSelect(document.getElementById('packageCore').value);
    renderEditingItems();
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closePackageForm() {
    const f = document.getElementById('packageForm');
    if (f) f.hidden = true;
    editingPackageItems = [];
  }

  function addServiceToPackage() {
    const sel = document.getElementById('packageServiceSelect');
    const qtyEl = document.getElementById('packageServiceQty');
    if (!sel || !sel.value) return;
    const id = parseInt(sel.value, 10);
    let q = parseInt(qtyEl.value, 10);
    if (!q || q < 1) q = 1;
    const existing = editingPackageItems.find(function (it) { return it.service_id === id; });
    if (existing) existing.quantity = q;
    else editingPackageItems.push({ service_id: id, quantity: q, name: sel.options[sel.selectedIndex].textContent });
    renderEditingItems();
  }

  async function savePackage() {
    const id = document.getElementById('packageId').value;
    const core = document.getElementById('packageCore').value;
    const name = (document.getElementById('packageName').value || '').trim();
    const description = (document.getElementById('packageDescription').value || '').trim();
    const dtype = document.getElementById('packageDiscountType').value;
    const dvalRaw = parseFloat(document.getElementById('packageDiscountValue').value);
    const active = document.getElementById('packageActive').checked;

    if (!name) { showStatus('Package name is required.', 'error'); return; }
    if (isNaN(dvalRaw) || dvalRaw < 0) { showStatus('Enter a valid discount value.', 'error'); return; }
    // Percentage packages need services (to compute the discount); fixed-price
    // packages (project-type tiers) may have none — the price is set directly.
    if (dtype === 'percentage' && !editingPackageItems.length) {
      showStatus('Percentage packages need at least one service (to compute the discount).', 'error');
      return;
    }
    // percentage stored as fraction (10 -> 0.10); fixed stored as PHP amount.
    const dvalue = dtype === 'percentage' ? dvalRaw / 100 : dvalRaw;

    try {
      let pkgId;
      if (id) {
        const up = await db.from('packages')
          .update({ core: core, name: name, description: description, discount_type: dtype, discount_value: dvalue, is_active: active })
          .eq('id', id);
        if (up.error) throw up.error;
        pkgId = parseInt(id, 10);
        const del = await db.from('package_services').delete().eq('package_id', pkgId);
        if (del.error) throw del.error;
      } else {
        const ins = await db.from('packages')
          .insert({ core: core, name: name, description: description, discount_type: dtype, discount_value: dvalue, is_active: active })
          .select('id').single();
        if (ins.error) throw ins.error;
        pkgId = ins.data.id;
      }
      const rows = editingPackageItems.map(function (it, i) {
        return { package_id: pkgId, service_id: it.service_id, quantity: it.quantity, sort_order: i + 1 };
      });
      const insPs = await db.from('package_services').insert(rows);
      if (insPs.error) throw insPs.error;

      showStatus('Package saved.', 'success');
      closePackageForm();
      await loadPackages();
    } catch (err) {
      console.error('savePackage failed:', err);
      showStatus('Could not save package: ' + (err.message || err), 'error');
    }
  }

  async function togglePackage(p) {
    try {
      const r = await db.from('packages').update({ is_active: !p.is_active }).eq('id', p.id);
      if (r.error) throw r.error;
      showStatus(p.is_active ? 'Package deactivated.' : 'Package activated.', 'success');
      await loadPackages();
    } catch (err) {
      showStatus('Could not update package: ' + (err.message || err), 'error');
    }
  }

  async function deletePackage(p) {
    if (!window.confirm('Delete package "' + p.name + '"?\nThis cannot be undone.')) return;
    try {
      const r = await db.from('packages').delete().eq('id', p.id);
      if (r.error) throw r.error;
      showStatus('Package deleted.', 'success');
      await loadPackages();
    } catch (err) {
      showStatus('Could not delete package: ' + (err.message || err), 'error');
    }
  }

  /** Create a labelled field wrapper around a control. */
  function makeField(labelText, control) {
    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    // Tie label to control for accessibility.
    const id = 'f_' + Math.random().toString(36).slice(2, 9);
    control.id = id;
    label.setAttribute('for', id);
    field.appendChild(label);
    field.appendChild(control);
    return field;
  }

  /** Create a text/number input with a value and class. */
  function makeInput(type, value, className) {
    const input = document.createElement('input');
    input.type = type;
    input.className = 'text-input ' + className;
    if (value !== null && value !== undefined) input.value = value;
    return input;
  }

  /** Create a core <select> (MET / MMARK / M-TECH) from CORES config. */
  function makeCoreSelect(current, className) {
    const sel = document.createElement('select');
    sel.className = 'text-input ' + className;
    const cores = (typeof CORES !== 'undefined' && CORES) ? CORES : [{ code: 'MET' }];
    cores.forEach(function (core) {
      const o = document.createElement('option');
      o.value = core.code;
      o.textContent = core.code;
      if ((current || 'MET') === core.code) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  /** Create a button element. */
  function makeButton(text, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = text;
    return btn;
  }

  /** Minimal HTML escaping for error text injected via innerHTML. */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ===================================================================
   * Init / wiring
   * ================================================================= */

  async function init() {
    // Resolve element references.
    statusBar = document.getElementById('statusBar');
    asfRateInput = document.getElementById('asfRateInput');
    vatRateInput = document.getElementById('vatRateInput');
    usdRateInput = document.getElementById('usdRateInput');
    updateSettingsBtn = document.getElementById('updateSettingsBtn');
    categoriesContainer = document.getElementById('categoriesContainer');
    addCategoryBtn = document.getElementById('addCategoryBtn');
    addCategoryForm = document.getElementById('addCategoryForm');
    cancelAddCategoryBtn = document.getElementById('cancelAddCategoryBtn');
    newCategoryName = document.getElementById('newCategoryName');
    newCategoryDescription = document.getElementById('newCategoryDescription');

    // Keep the notice's markup percentage in sync with the MARKUP constant
    // (config.js) so the copy can't drift from the actual client-side math.
    const markupEl = document.getElementById('markupPct');
    if (markupEl && typeof MARKUP === 'number') {
      markupEl.textContent = pct(MARKUP - 1);
    }

    // Settings save.
    if (updateSettingsBtn) {
      updateSettingsBtn.addEventListener('click', saveSettings);
    }

    // Reveal / hide the add-category form.
    if (addCategoryBtn) {
      addCategoryBtn.addEventListener('click', function () {
        if (!addCategoryForm) return;
        addCategoryForm.hidden = !addCategoryForm.hidden;
        if (!addCategoryForm.hidden && newCategoryName) newCategoryName.focus();
      });
    }
    if (cancelAddCategoryBtn) {
      cancelAddCategoryBtn.addEventListener('click', function () {
        addCategoryForm.hidden = true;
        newCategoryName.value = '';
        newCategoryDescription.value = '';
      });
    }
    if (addCategoryForm) {
      addCategoryForm.addEventListener('submit', function (evt) {
        evt.preventDefault();
        addCategory();
      });
    }

    // If config.js could not create the Supabase client (placeholder/invalid
    // credentials or a blocked CDN), don't fire DB calls -- show a clear setup
    // message but still prefill the settings inputs with defaults.
    if (typeof db === 'undefined' || !db) {
      showStatus(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.',
        'error'
      );
      asfRateInput.value = trimNum(0.125 * 100);
      vatRateInput.value = trimNum(0.12 * 100);
      usdRateInput.value = trimNum(55.89);
      if (categoriesContainer) {
        categoriesContainer.innerHTML =
          '<p class="notice notice-warning">Connect Supabase (js/config.js) to manage categories and services.</p>';
      }
      return;
    }

    // Services table: filters, sort, add, bulk.
    ['svcSearch', 'svcCoreFilter', 'svcCategoryFilter', 'svcStatusFilter', 'svcSort'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(id === 'svcSearch' ? 'input' : 'change', renderServicesTable);
    });
    const addServiceForm = document.getElementById('addServiceForm');
    if (addServiceForm) addServiceForm.addEventListener('submit', function (e) { e.preventDefault(); addServiceFromForm(); });
    const svcBulkEnable = document.getElementById('svcBulkEnable');
    if (svcBulkEnable) svcBulkEnable.addEventListener('click', function () { bulkSetActive(true); });
    const svcBulkDisable = document.getElementById('svcBulkDisable');
    if (svcBulkDisable) svcBulkDisable.addEventListener('click', function () { bulkSetActive(false); });
    const svcBulkDelete = document.getElementById('svcBulkDelete');
    if (svcBulkDelete) svcBulkDelete.addEventListener('click', bulkDeleteServices);
    const svcBulkClear = document.getElementById('svcBulkClear');
    if (svcBulkClear) svcBulkClear.addEventListener('click', function () { selectedServiceIds.clear(); renderServicesTable(); });

    // Package controls.
    const addPackageBtn = document.getElementById('addPackageBtn');
    if (addPackageBtn) addPackageBtn.addEventListener('click', function () { openPackageForm(null); });
    const cancelPackageBtn = document.getElementById('cancelPackageBtn');
    if (cancelPackageBtn) cancelPackageBtn.addEventListener('click', closePackageForm);
    const packageForm = document.getElementById('packageForm');
    if (packageForm) packageForm.addEventListener('submit', function (e) { e.preventDefault(); savePackage(); });
    const packageAddServiceBtn = document.getElementById('packageAddServiceBtn');
    if (packageAddServiceBtn) packageAddServiceBtn.addEventListener('click', addServiceToPackage);
    const packageCore = document.getElementById('packageCore');
    if (packageCore) packageCore.addEventListener('change', function () { populatePackageServiceSelect(packageCore.value); });
    const packageCoreFilter = document.getElementById('packageCoreFilter');
    if (packageCoreFilter) packageCoreFilter.addEventListener('change', renderPackagesList);

    // Log out.
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        try { await db.auth.signOut(); } catch (e) { /* ignore */ }
        window.location.replace('login.html');
      });
    }

    // Auth gate: must be signed in (Supabase Auth) to use the admin panel.
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) { window.location.replace('login.html'); return; }
    } catch (e) {
      window.location.replace('login.html');
      return;
    }

    // Initial data load (packages load after the catalog so names/cores resolve).
    loadSettings();
    loadCategoriesAndServices().then(loadPackages);
  }

  // Run after the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
