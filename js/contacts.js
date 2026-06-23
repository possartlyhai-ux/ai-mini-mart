/* =========================================================================
 * contacts.js — "Contact" popup (Line / Telegram) for the storefront
 * -------------------------------------------------------------------------
 * Adds the header Contact button. Clicking it opens a card listing each
 * contact's Line + Telegram. Two ways to reach the chat:
 *   - tap the NAME  -> opens that chat directly (line.me / t.me link)
 *   - tap the QR icon on a card -> expands inline QR codes to scan
 *
 * Self-contained like auth.js: a plain <script> after auth.js, before app.js.
 * It injects its own scrim + modal into <body>, so it needs nothing from
 * app.js. QR images come from the free api.qrserver.com endpoint (no build,
 * no dependency) and are tinted Line-green / Telegram-blue to match the brand.
 *
 * EDIT YOUR HANDLES HERE -------------------------------------------------
 * For each contact fill in the display name + chat link:
 *   Line      -> https://line.me/ti/p/~<your-line-id>      (or a line.me URL)
 *   Telegram  -> https://t.me/<your-username>
 * Leave a side as null to hide just that one (Line OR Telegram).
 * ========================================================================= */

const CONTACTS = [
  {
    title: 'CONTACT .1',
    // qrImg: optional custom QR image (e.g. your branded LINE/Telegram code).
    // If the file is missing it auto-falls back to a generated QR of the URL.
    line: { name: 'Ai Laundry',  url: 'https://line.me/ti/p/KHJri67Hl7', qrImg: 'assets/contact1-line.png' },
    tg:   { name: '@ailaundry1', url: 'https://t.me/ailaundry1',         qrImg: 'assets/contact1-telegram.png' },
  },
  {
    title: 'CONTACT .2',
    line: { name: 'ร้านซักรีด ศุกนิชา', url: 'https://line.me/ti/p/PvMW5jmszW', qrImg: 'assets/contact2-line.png' },
    tg:   { name: '@ailaundry2',         url: 'https://t.me/ailaundry2',        qrImg: 'assets/contact2-telegram.png' },
  },
];

// Brand colours for the tinted QR codes (hex, no '#': qrserver wants it raw).
const QR_LINE = '06C755';   // Line green
const QR_TG   = '229ED9';   // Telegram blue

// Build a tinted QR image URL for a chat link.
function contactQrSrc(url, colorHex) {
  const u = encodeURIComponent(url);
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=6&qzone=1`
       + `&color=${colorHex}&bgcolor=ffffff&data=${u}`;
}

// Tiny translator shim: use the app's t() if it's loaded, else fall back.
function ct(key, fallback) {
  return (typeof t === 'function' ? t(key) : null) || fallback;
}

const LINE_ICON = `<svg class="cc__ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <circle cx="12" cy="12" r="11" fill="#06C755"/>
  <path d="M12 6.2c-3.6 0-6.5 2.3-6.5 5.2 0 2.6 2.3 4.7 5.4 5.1.2 0 .5.1.6.3.1.2 0 .5 0 .6l-.1.6c0 .2-.1.7.6.4.7-.3 3.8-2.2 5.2-3.8 1-1 1.4-2 1.4-3.2 0-2.9-2.9-5.2-6.6-5.2Z" fill="#fff"/>
</svg>`;

const TG_ICON = `<svg class="cc__ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <circle cx="12" cy="12" r="11" fill="#229ED9"/>
  <path d="M6 11.8l10.2-3.9c.5-.2.9.1.7.8l-1.7 8.2c-.1.6-.5.7-1 .4l-2.7-2-1.3 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.1-4.6c.2-.2 0-.3-.3-.1l-6.3 4-2.7-.8c-.6-.2-.6-.6.1-.9Z" fill="#fff"/>
</svg>`;

const QR_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm9-2h2v2h-2v-2Zm4 0h1v2h-1v-2Zm-4 4h2v3h-2v-3Zm3 0h3v2h-2v1h-1v-3Z"
        fill="currentColor"/>
</svg>`;

function contactEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// One contact card (collapsed by default; QR icon expands the codes).
function contactCard(c, i) {
  const nameLink = (side, icon, cls) =>
    side && side.url
      ? `<a class="cc__name ${cls}" href="${contactEscape(side.url)}" target="_blank" rel="noopener">
           ${icon}<span>${contactEscape(side.name || '')}</span>
         </a>`
      : `<span class="cc__name cc__name--empty">—</span>`;

  const qrCell = (side, color, label) => {
    if (!side || !side.url) return '';
    // Prefer a custom QR image; if it 404s, fall back to a generated one.
    const gen = contactQrSrc(side.url, color);
    const src = side.qrImg || gen;
    return `<figure class="cc__qrcell">
           <img class="cc__qrimg" src="${contactEscape(src)}" alt="${contactEscape(label)} QR"
                onerror="this.onerror=null;this.src='${gen}'" />
           <figcaption>${contactEscape(label)}</figcaption>
         </figure>`;
  };

  return `
    <article class="cc" data-card="${i}">
      <header class="cc__head">
        <h3 class="cc__title">${contactEscape(c.title)}</h3>
        <button class="cc__qrbtn" data-qr-toggle="${i}" aria-expanded="false"
                title="${ct('contact_scan', 'Scan to chat')}" aria-label="${ct('contact_scan', 'Scan to chat')}">
          ${QR_ICON}
        </button>
      </header>
      <div class="cc__names">
        ${nameLink(c.line, LINE_ICON, 'cc__name--line')}
        ${nameLink(c.tg,   TG_ICON,   'cc__name--tg')}
      </div>
      <div class="cc__qrs" id="cc-qrs-${i}" hidden>
        ${qrCell(c.line, QR_LINE, 'Line')}
        ${qrCell(c.tg,   QR_TG,   'Telegram')}
      </div>
    </article>`;
}

let contactBuilt = false;

function buildContactModal() {
  if (contactBuilt) return;
  contactBuilt = true;

  const scrim = document.createElement('div');
  scrim.className = 'contact-scrim';
  scrim.id = 'contact-scrim';
  scrim.hidden = true;

  const modal = document.createElement('div');
  modal.className = 'contact-modal';
  modal.id = 'contact-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', ct('contact_title', 'Contact us'));

  modal.innerHTML = `
    <div class="contact-card">
      <button class="contact-close" id="contact-close" aria-label="Close">✕</button>
      <div class="contact-list">
        ${CONTACTS.map(contactCard).join('')}
      </div>
    </div>`;

  document.body.appendChild(scrim);
  document.body.appendChild(modal);

  scrim.addEventListener('click', closeContact);
  modal.querySelector('#contact-close').addEventListener('click', closeContact);

  // QR expand/collapse (event delegation on the card list).
  modal.querySelector('.contact-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qr-toggle]');
    if (!btn) return;
    const i = btn.dataset.qrToggle;
    const box = modal.querySelector('#cc-qrs-' + i);
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.closest('.cc').classList.toggle('cc--open', open);
  });
}

function openContact() {
  buildContactModal();
  $cm('#contact-scrim').hidden = false;
  $cm('#contact-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $cm('#contact-close').focus();
  document.addEventListener('keydown', contactEsc);
}

function closeContact() {
  const m = $cm('#contact-modal'), s = $cm('#contact-scrim');
  if (m) m.hidden = true;
  if (s) s.hidden = true;
  // Don't fight the cart drawer if it owns the scroll lock.
  if (!document.querySelector('#drawer.open')) document.body.style.overflow = '';
  document.removeEventListener('keydown', contactEsc);
  document.getElementById('contact-open')?.focus();
}

function contactEsc(e) { if (e.key === 'Escape') closeContact(); }

// Local query helper (app.js's $ may not be defined yet at wire time).
function $cm(sel) { return document.querySelector(sel); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('contact-open')?.addEventListener('click', openContact);
});
