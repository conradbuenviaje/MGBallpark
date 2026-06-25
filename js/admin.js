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
          .select('id, name, description, sort_order')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }),
        db.from('services')
          .select('id, category_id, name, base_rate, unit, is_fabrication, sort_order')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }),
      ]);

      if (catRes.error) throw catRes.error;
      if (svcRes.error) throw svcRes.error;

      renderCategories(catRes.data || [], svcRes.data || []);
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

    if (!name) {
      showStatus('Category name is required.', 'error');
      return;
    }

    try {
      const { error } = await db
        .from('categories')
        .insert({ name: name, description: description });

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

    if (!name) {
      showStatus('Category name is required.', 'error');
      return;
    }

    try {
      const { error } = await db
        .from('categories')
        .update({ name: name, description: description })
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

    // Initial data load.
    loadSettings();
    loadCategoriesAndServices();
  }

  // Run after the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
