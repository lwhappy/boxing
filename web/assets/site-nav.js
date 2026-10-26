/**
 * SilentJab — Nav active-link marker (progressive enhancement)
 * ---------------------------------------------------------------
 * The header, navigation links, and breadcrumbs are now static HTML
 * in every page (for SEO compliance — search engine crawlers don't
 * execute JS). This script only marks the active nav link with
 * aria-current="page" based on window.PAGE.section.
 *
 * The static HTML uses data-section attributes on nav links:
 *   <a href="/moves/" data-section="moves">Moves</a>
 *
 * Usage (after the static header in the page):
 *   <script src="/assets/site-nav.js"></script>
 */
(function () {
  var page = window.PAGE || {};
  var currentSection = page.section || '';

  if (!currentSection) return;

  // Mark the active nav link
  var navLinks = document.querySelectorAll('.site-head .nav a[data-section]');
  for (var i = 0; i < navLinks.length; i++) {
    var link = navLinks[i];
    if (link.getAttribute('data-section') === currentSection) {
      link.setAttribute('aria-current', 'page');
    }
  }
})();
