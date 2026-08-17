/* =====================================================================
 * gate.js  --  Lightweight admin sign-in gate for MG Ballpark
 * =====================================================================
 *
 *  ⚠️ THIS IS A SOFT GATE, NOT REAL SECURITY.
 *  The admin is a static page on a PUBLIC repo, so this check runs entirely
 *  in the browser. The password HASHES below are visible in the page source
 *  and the check can be bypassed in devtools. The real protection is that
 *  edits only go live when someone with git push access commits the exported
 *  catalog.json. Treat this only as a "keep casual visitors out + tag who is
 *  editing" speed bump. Do NOT reuse these passwords for anything sensitive.
 *
 *  To add/change a user: compute SHA-256 of "<email>:<password>" and add a
 *  row to USERS. (Passwords are never stored — only the hash.)
 * ===================================================================== */

window.AdminGate = (function () {
  'use strict';

  var SESSION_KEY = 'mgb_admin_user';

  // hash = sha256("<email>:<password>")
  var USERS = [
    { email: 'brian.buenviaje@mineskiglobal.com', name: 'Brian Buenviaje', hash: '362846ea0afea3394fc3a31287afaa3a40f2496dd4ee6ce6732acc2e87452a40' },
    { email: 'christine.yuson@mineskiglobal.com', name: 'Christine Yuson', hash: '8e693877823a03389cadd08d9374312527b2e05bf25fe6104d398c672a39cf15' },
    { email: 'kylene.lim@mineskiglobal.com', name: 'Kylene Lim', hash: 'c0537659370152aa0d22db8ba8e6126c2f60a555932e61b31d351b59cd42b075' },
  ];

  function sha256Hex(str) {
    var enc = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  function currentUser() {
    try { return sessionStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; }
  }

  function signOut() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    location.reload();
  }

  // Inject a small "signed in as NAME · Log out" control into the header.
  function showSignedIn(name) {
    var actions = document.querySelector('.admin-header-actions');
    if (!actions || document.getElementById('gateWhoami')) return;
    var span = document.createElement('span');
    span.id = 'gateWhoami';
    span.className = 'muted gate-whoami';
    span.textContent = '👤 ' + name;
    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'btn btn-ghost';
    out.textContent = 'Log out';
    out.addEventListener('click', signOut);
    actions.appendChild(span);
    actions.appendChild(out);
  }

  function buildOverlay(resolve) {
    var ov = document.createElement('div');
    ov.className = 'gate-overlay';
    ov.innerHTML =
      '<form class="gate-card" autocomplete="on">' +
      '<h1>🔒 Admin sign-in</h1>' +
      '<p class="muted">Manage rates, services and packages.</p>' +
      '<label for="gateEmail">Email</label>' +
      '<input id="gateEmail" type="email" class="text-input" autocomplete="username" required />' +
      '<label for="gatePassword">Password</label>' +
      '<input id="gatePassword" type="password" class="text-input" autocomplete="current-password" required />' +
      '<p id="gateError" class="gate-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-large">Sign in</button>' +
      '<p class="muted gate-note">This is an internal soft gate, not a secure login.</p>' +
      '<p class="muted"><a href="index.html">← Back to calculator</a></p>' +
      '</form>';
    document.body.appendChild(ov);

    var form = ov.querySelector('.gate-card');
    var emailEl = ov.querySelector('#gateEmail');
    var pwEl = ov.querySelector('#gatePassword');
    var errEl = ov.querySelector('#gateError');
    emailEl.focus();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (emailEl.value || '').trim().toLowerCase();
      var pw = pwEl.value || '';
      sha256Hex(email + ':' + pw).then(function (hex) {
        var u = USERS.filter(function (x) { return x.email === email && x.hash === hex; })[0];
        if (!u) {
          errEl.textContent = 'Incorrect email or password.';
          errEl.hidden = false;
          pwEl.value = '';
          return;
        }
        try { sessionStorage.setItem(SESSION_KEY, u.name); } catch (er) {}
        ov.parentNode.removeChild(ov);
        showSignedIn(u.name);
        resolve(u.name);
      });
    });
  }

  // Resolve once the visitor is authenticated (immediately if already signed
  // in this session). admin.js awaits this before touching the catalog.
  function require() {
    return new Promise(function (resolve) {
      var name = currentUser();
      if (name) { showSignedIn(name); resolve(name); return; }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { buildOverlay(resolve); });
      } else {
        buildOverlay(resolve);
      }
    });
  }

  return { require: require, signOut: signOut, currentUser: currentUser };
})();
