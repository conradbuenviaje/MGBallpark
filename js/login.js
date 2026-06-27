/* =====================================================================
 * login.js  --  Admin sign-in (Supabase Auth)
 * =====================================================================
 *  Uses the shared `db` client from config.js. On success the session is
 *  persisted (localStorage) by supabase-js and admin.html reads it.
 * ===================================================================== */

(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var emailEl = document.getElementById('loginEmail');
  var passEl = document.getElementById('loginPassword');
  var btn = document.getElementById('loginBtn');
  var errEl = document.getElementById('loginError');

  function showError(msg) {
    if (!errEl) { window.alert(msg); return; }
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  function clearError() {
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  }

  // No client configured -> can't authenticate.
  if (typeof db === 'undefined' || !db) {
    showError('Supabase is not configured (js/config.js). Cannot sign in.');
    if (btn) btn.disabled = true;
    return;
  }

  // Already signed in? Skip straight to the admin panel.
  db.auth.getSession().then(function (res) {
    if (res && res.data && res.data.session) {
      window.location.replace('admin.html');
    }
  });

  form.addEventListener('submit', async function (evt) {
    evt.preventDefault();
    clearError();
    var email = (emailEl.value || '').trim();
    var password = passEl.value || '';
    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      var out = await db.auth.signInWithPassword({ email: email, password: password });
      if (out.error) throw out.error;
      window.location.replace('admin.html');
    } catch (err) {
      console.error('Login failed:', err);
      showError(err.message || 'Sign in failed. Check your credentials.');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();
