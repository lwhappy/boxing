/**
 * SilentJab — Global head injector (Google Analytics + AdSense)
 * -----------------------------------------------------
 * Reads window.SITE (global config) to inject:
 *   - Google Analytics (gtag.js) — if SITE.gaId is set
 *   - Google AdSense — if SITE.adsenseClient is set
 *
 * ALL SEO meta tags (title, description, canonical, OG, JSON-LD) remain
 * in the static HTML of each page — they must be crawlable.
 *
 * Only GA and AdSense are injected here so you can change the IDs
 * in ONE file (site-config.js) without editing every page.
 *
 * Usage (in <head>, after site-config.js):
 *   <script src="/assets/site-config.js"></script>
 *   <script src="/assets/site-head.js"></script>
 */
(function () {
  var site = window.SITE || {};
  var head = document.head;

  // ── Google Analytics ──
  if (site.gaId) {
    // Avoid double-injection if GA is already in the page HTML
    if (!head.querySelector('script[src*="googletagmanager"]')) {
      var gaScript = document.createElement('script');
      gaScript.async = true;
      gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + site.gaId;
      head.appendChild(gaScript);

      var gaInit = document.createElement('script');
      gaInit.textContent =
        'window.dataLayer = window.dataLayer || [];\n' +
        'function gtag(){dataLayer.push(arguments);}\n' +
        "gtag('js', new Date());\n" +
        "gtag('config', '" + site.gaId + "');";
      head.appendChild(gaInit);
    }
  }

  // ── Google AdSense ──
  if (site.adsenseClient) {
    if (!head.querySelector('script[src*="adsbygoogle"]')) {
      var adScript = document.createElement('script');
      adScript.async = true;
      adScript.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + site.adsenseClient;
      adScript.crossOrigin = 'anonymous';
      head.appendChild(adScript);

      var adMeta = document.createElement('meta');
      adMeta.name = 'google-adsense-account';
      adMeta.content = site.adsenseClient;
      head.appendChild(adMeta);
    }
  }
})();
