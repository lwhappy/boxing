/* ======================================================================
 * Manual AdSense units
 * ----------------------------------------------------------------------
 * Markup (one unit per banner, slot id lives on the ins element):
 *
 *   <aside class="ad-banner" aria-label="Advertisement">
 *     <span class="ad-banner-tag">Advertisement</span>
 *     <ins class="adsbygoogle"
 *          style="display:block"
 *          data-ad-client="ca-pub-8470399807799168"
 *          data-ad-slot="1234567890"
 *          data-ad-format="horizontal"
 *          data-full-width-responsive="true"></ins>
 *   </aside>
 *
 * One fill request per unit, in DOM order (AdSense matches each push to the
 * next unfilled <ins>). A banner collapses itself when Google reports
 * "unfilled", or when nothing comes back at all — a blocked request must not
 * leave an empty card sitting between two content blocks.
 * ====================================================================== */
(function () {
  var banners = document.querySelectorAll('.ad-banner');
  if (!banners.length) return;

  function hide(banner) {
    banner.classList.add('is-empty');
  }

  Array.prototype.forEach.call(banners, function (banner) {
    var ins = banner.querySelector('ins.adsbygoogle');
    var slot = ins && (ins.getAttribute('data-ad-slot') || '').trim();
    /* no usable slot id (placeholder) → keep the banner out of the layout */
    if (!ins || !/^\d{9,10}$/.test(slot) || slot === '0000000000') return hide(banner);

    if (!ins.getAttribute('data-adsbygoogle-status')) {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* loader missing */ }
    }

    /* data-ad-status is Google's verdict: "filled" or "unfilled" */
    function settle() {
      if (ins.getAttribute('data-ad-status') === 'unfilled') hide(banner);
    }
    settle();
    if (window.MutationObserver) {
      new MutationObserver(settle).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    }
    /* nothing answered (blocked, offline, script never ran) → collapse */
    setTimeout(function () {
      if (!ins.getAttribute('data-ad-status')) hide(banner);
    }, 8000);
  });
})();
