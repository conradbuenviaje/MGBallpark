/* =====================================================================
 * theme.js  --  Light/Dark theme (auto + manual toggle), shared by all pages
 * =====================================================================
 *  Load this in <head> (before paint) so the saved/system theme applies with
 *  no flash. Stored preference: 'auto' (follow system), 'light', or 'dark'.
 *  Buttons with class "theme-toggle" flip light<->dark and show ☀️/🌙.
 * ===================================================================== */
(function () {
  'use strict';
  var KEY = 'mgb-theme';

  function stored() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
  }
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function effective() {
    var t = stored();
    if (t === 'light' || t === 'dark') return t;
    return systemDark() ? 'dark' : 'light';
  }
  function apply() {
    document.documentElement.setAttribute('data-theme', effective());
  }

  // Apply immediately (this script runs in <head>, before <body> paints).
  apply();

  // Follow system changes while in 'auto'.
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (stored() === 'auto') { apply(); updateButtons(); }
      });
    } catch (e) { /* older browsers: ignore */ }
  }

  function setTheme(t) {
    try { localStorage.setItem(KEY, t); } catch (e) {}
    apply();
    updateButtons();
  }
  function toggle() {
    setTheme(effective() === 'dark' ? 'light' : 'dark');
  }
  function updateButtons() {
    var dark = effective() === 'dark';
    var btns = document.querySelectorAll('.theme-toggle');
    Array.prototype.forEach.call(btns, function (b) {
      b.textContent = dark ? '☀️' : '🌙';
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      b.setAttribute('title', dark ? 'Light mode' : 'Dark mode');
    });
  }

  function wire() {
    updateButtons();
    var btns = document.querySelectorAll('.theme-toggle');
    Array.prototype.forEach.call(btns, function (b) { b.addEventListener('click', toggle); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.MGBTheme = { setTheme: setTheme, toggle: toggle, effective: effective };
})();
