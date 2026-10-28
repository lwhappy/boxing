/**
 * SilentJab — Global site config
 * -----------------------------------------------------
 * Edit this ONE file to change GA ID, AdSense, nav links,
 * footer text, etc. across ALL pages.
 *
 * Usage in HTML pages:
 *   <script src="/assets/site-config.js"></script>
 *   <script src="/assets/site-head.js"></script>
 *   <script src="/assets/site-nav.js"></script>
 *   <script src="/assets/site-foot.js"></script>
 *
 * Page-specific data is set BEFORE including site-head.js:
 *   <script>
 *   window.PAGE = {
 *     title: 'Jab — Boxing Basics in 3D | SilentJab',
 *     description: 'The fastest punch in boxing...',
 *     canonical: 'https://silentjab.com/moves/jab',
 *     section: 'moves'  // 'home' | 'moves' | 'combos' | 'training'
 *   };
 *   </script>
 */

window.SITE = {
  name: 'SilentJab',
  domain: 'silentjab.com',
  url: 'https://silentjab.com',

  // ── Google Analytics ──────────────────────────
  // Replace the ID or set to null to disable.
  gaId: 'G-0SCT9KVVQ6',

  // ── Google AdSense ─────────────────────────────
  // Paste your AdSense client ID (ca-pub-XXXXXXXX) here to enable.
  // Set to null to keep disabled.
  adsenseClient: null,  // e.g. 'ca-pub-1234567890123456'

  // ── Navigation links ───────────────────────────
  // Order is consistent across ALL pages.
  // The `section` key on window.PAGE controls which link is highlighted.
  nav: [
    { label: 'Moves',     href: '/moves/',     section: 'moves' },
    { label: 'Combos',    href: '/combos/',    section: 'combos' },
    { label: 'Training',  href: '/training.html',  section: 'training' },
  ],

  // ── Footer ──────────────────────────────────────
  footer: {
    copyright: '© 2026 SilentJab — technique reference for striking sports.',
    links: [
      { label: 'Home',     href: '/' },
      { label: 'Moves',    href: '/moves/' },
      { label: 'Combos',   href: '/combos/' },
      { label: 'Training', href: '/training.html' },
      { label: 'Guides',   href: '/guides/' },
      { label: 'Contact',  href: '/contact/' },
      { label: 'About',    href: '/about/' },
      { label: 'Privacy',  href: '/privacy/' },
      { label: 'Terms',    href: '/terms/' },
    ],
  },
};
