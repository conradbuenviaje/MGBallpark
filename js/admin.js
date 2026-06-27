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
          .select('id, category_id, name, base_rate, unit, is_fabrication, sort_order')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }),
      ]);

      if (catRes.error) throw catRes.error;
      if (svcRes.error) throw svcRes.error;

      allCategories = catRes.data || [];
      allServices = svcRes.data || [];
      renderCategories(allCategories, allServices);
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

    /* ---- Services list ---- */
    const svcWrap = document.createElement('div');
    svcWrap.className = 'services-list';

    const svcTitle = document.createElement('h3');
    svcTitle.className = 'services-title';
    svcTitle.textContent = 'Services';
    svcWrap.appendChild(svcTitle);

    if (svcList.length) {
      svcList.forEach(function (svc) {
        svcWrap.appendChild(buildServiceRow(svc));
      });
    } else {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No services in this category yet.';
      svcWrap.appendChild(empty);
    }

    card.appendChild(svcWrap);

    /* ---- Add-service form for this category ---- */
    card.appendChild(buildAddServiceForm(cat.id));

    return card;
  }

  /* ===================================================================
   * Service row builder (editable)
   * ================================================================= */

  /**
   * Build one editable service row (name, base rate, unit, fabrication
   * checkbox + save/delete).
   * @param {Object} svc
   * @returns {HTMLElement}
   */
  function buildServiceRow(svc) {
    const row = document.createElement('div');
    row.className = 'service-row field-row';
    row.dataset.serviceId = svc.id;

    row.appendChild(makeField('Name', makeInput('text', svc.name || '', 'svc-name')));

    const rateInput = makeInput('number', svc.base_rate != null ? svc.base_rate : '', 'svc-base-rate');
    rateInput.min = '0';
    rateInput.step = '0.01';
    rateInput.inputMode = 'decimal';
    row.appendChild(makeField('Base Rate (cost)', rateInput));

    row.appendChild(makeField('Unit', makeInput('text', svc.unit || '', 'svc-unit')));

    /* Fabrication checkbox in its own labelled field. */
    const fabField = document.createElement('div');
    fabField.className = 'field field-check';
    const fabLabel = document.createElement('label');
    const fabInput = document.createElement('input');
    fabInput.type = 'checkbox';
    fabInput.className = 'svc-is-fabrication';
    fabInput.checked = !!svc.is_fabrication;
    fabLabel.appendChild(fabInput);
    fabLabel.appendChild(document.createTextNode(' Is Fabrication?'));
    fabField.appendChild(fabLabel);
    row.appendChild(fabField);

    /* Save / Delete actions. */
    const actions = document.createElement('div');
    actions.className = 'field field-action';

    const saveBtn = makeButton('Save', 'btn btn-primary');
    saveBtn.addEventListener('click', function () {
      saveService(svc.id, row);
    });

    const delBtn = makeButton('Delete', 'btn btn-danger');
    delBtn.addEventListener('click', function () {
      deleteService(svc.id, svc.name);
    });

    actions.appendChild(saveBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);

    return row;
  }

  /* ===================================================================
   * Add-service form builder
   * ================================================================= */

  /**
   * Build the "add a new service" form for a given category.
   * @param {number} categoryId
   * @returns {HTMLElement}
   */
  function buildAddServiceForm(categoryId) {
    const form = document.createElement('form');
    form.className = 'inline-form add-service-form';

    const row = document.createElement('div');
    row.className = 'field-row';

    const nameInput = makeInput('text', '', 'new-svc-name');
    nameInput.placeholder = 'Service name';
    row.appendChild(makeField('Name', nameInput));

    const rateInput = makeInput('number', '', 'new-svc-base-rate');
    rateInput.min = '0';
    rateInput.step = '0.01';
    rateInput.inputMode = 'decimal';
    rateInput.placeholder = '0.00';
    row.appendChild(makeField('Base Rate (cost)', rateInput));

    const unitInput = makeInput('text', '', 'new-svc-unit');
    unitInput.placeholder = 'e.g. per day';
    row.appendChild(makeField('Unit', unitInput));

    const fabField = document.createElement('div');
    fabField.className = 'field field-check';
    const fabLabel = document.createElement('label');
    const fabInput = document.createElement('input');
    fabInput.type = 'checkbox';
    fabInput.className = 'new-svc-is-fabrication';
    fabLabel.appendChild(fabInput);
    fabLabel.appendChild(document.createTextNode(' Is Fabrication?'));
    fabField.appendChild(fabLabel);
    fabField.classList.add('field-check');
    row.appendChild(fabField);

    const actions = document.createElement('div');
    actions.className = 'field field-action';
    const addBtn = makeButton('+ Add Service', 'btn btn-accent');
    addBtn.type = 'submit';
    actions.appendChild(addBtn);
    row.appendChild(actions);

    form.appendChild(row);

    form.addEventListener('submit', function (evt) {
      evt.preventDefault();
      addService(categoryId, form);
    });

    return form;
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
    if (!editingPackageItems.length) { showStatus('Add at least one service to the package.', 'error'); return; }
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

  function init() {
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
