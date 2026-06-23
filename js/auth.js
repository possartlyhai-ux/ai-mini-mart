/* =========================================================================
 * auth.js — "Sign in with Google" for the storefront
 * -------------------------------------------------------------------------
 * Real Google OAuth via Google Identity Services (GIS). No backend, no build:
 * GIS runs entirely client-side, returns a signed ID-token (JWT), and we read
 * the name / email / picture out of it. The signed-in name auto-fills the
 * checkout form (see showDrawerView in app.js).
 *
 * SETUP — one time, then it just works:
 *   1. Google Cloud Console -> APIs & Services -> Credentials.
 *   2. Create an "OAuth client ID", type "Web application".
 *   3. Add these to "Authorized JavaScript origins":
 *        http://localhost:5173        (local dev)
 *        https://ai-mini-mart.web.app (production)
 *   4. Copy the Client ID and paste it into GOOGLE_CLIENT_ID below.
 * Until a real ID is set, the header shows a disabled "Sign in" placeholder.
 *
 * Load order: this file is a plain <script> after currency.js and before
 * app.js (it defines the `auth` global that app.js reads). The GIS library
 * itself loads from accounts.google.com (script tag in index.html) and calls
 * window.onGoogleLibraryLoad when ready.
 * ========================================================================= */

const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

// localStorage key kept in the same mymart.* namespace as the rest of the app.
const AUTH_LS_KEY = 'mymart.user';

function authLoadUser() {
  try { return JSON.parse(localStorage.getItem(AUTH_LS_KEY)) || null; }
  catch (e) { return null; }
}
function authSaveUser(u) {
  if (u) localStorage.setItem(AUTH_LS_KEY, JSON.stringify(u));
  else localStorage.removeItem(AUTH_LS_KEY);
}

// Single source of truth for the signed-in user (or null).
const auth = { user: authLoadUser() };

function googleConfigured() {
  return GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('YOUR_');
}

// Decode a JWT payload (base64url) without verifying — GIS already verified the
// signature server-side before handing us the token; we only read display data.
function authDecodeJwt(token) {
  const part = token.split('.')[1];
  const json = decodeURIComponent(
    atob(part.replace(/-/g, '+').replace(/_/g, '/'))
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(json);
}

function authHandleCredential(resp) {
  let p;
  try { p = authDecodeJwt(resp.credential); }
  catch (e) { return; }
  auth.user = { name: p.name, email: p.email, picture: p.picture };
  authSaveUser(auth.user);
  renderAuth();
  // Live-fill the checkout name if that form is on screen and still empty.
  const nm = document.querySelector('#view-checkout')?.name;
  if (nm && !nm.value) nm.value = auth.user.name || '';
}

function signOutGoogle() {
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  auth.user = null;
  authSaveUser(null);
  renderAuth();
}

// Initialise GIS once the library is present + a real Client ID is set.
function initGoogleAuth() {
  if (googleConfigured() && window.google?.accounts?.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: authHandleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  }
  renderAuth();
}

// GIS calls this global automatically when its <script> finishes loading.
window.onGoogleLibraryLoad = initGoogleAuth;

/* ---------- Render the header auth control ---------- */
function renderAuth() {
  const slot = document.getElementById('auth-slot');
  if (!slot) return;

  // Signed in -> avatar + first name, with a small pop-over to sign out.
  if (auth.user) {
    const first = (auth.user.name || auth.user.email || '').split(' ')[0];
    const pic = auth.user.picture
      ? `<img class="authbtn__pic" src="${auth.user.picture}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="authbtn__pic authbtn__pic--ph">${(first[0] || '?').toUpperCase()}</span>`;
    slot.innerHTML = `
      <button class="authbtn" id="auth-toggle" aria-haspopup="true" aria-expanded="false" title="${auth.user.email || ''}">
        ${pic}<span class="authbtn__name">${first}</span>
      </button>
      <div class="auth-pop" id="auth-pop" hidden>
        <div class="auth-pop__id">
          <strong>${auth.user.name || ''}</strong>
          <small>${auth.user.email || ''}</small>
        </div>
        <button class="btn btn--ghost auth-pop__out" id="auth-signout">Sign out</button>
      </div>`;
    const toggle = slot.querySelector('#auth-toggle');
    const pop = slot.querySelector('#auth-pop');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    slot.querySelector('#auth-signout').addEventListener('click', signOutGoogle);
    // Close on outside click.
    document.addEventListener('click', () => { pop.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }, { once: true });
    return;
  }

  // Signed out + configured -> render the official Google button.
  if (googleConfigured() && window.google?.accounts?.id) {
    slot.innerHTML = `<div id="g-signin"></div>`;
    google.accounts.id.renderButton(slot.querySelector('#g-signin'), {
      theme: 'outline', size: 'medium', type: 'standard', shape: 'pill', text: 'signin_with',
    });
    return;
  }

  // Not configured yet -> disabled placeholder so the UI still reads correctly.
  slot.innerHTML = `
    <button class="authbtn authbtn--g" id="g-fallback" disabled
            title="Set GOOGLE_CLIENT_ID in js/auth.js to enable Google sign-in">
      <span class="g-ico" aria-hidden="true">G</span>
      <span class="authbtn__name">Sign in</span>
    </button>`;
}

// Render immediately on DOM ready (shows the avatar/placeholder); the Google
// button itself appears via onGoogleLibraryLoad once GIS finishes loading.
document.addEventListener('DOMContentLoaded', initGoogleAuth);
