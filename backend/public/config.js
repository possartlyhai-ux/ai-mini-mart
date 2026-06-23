// Runtime config, loaded before api.js.
//
// API_BASE = where the JSON API lives:
//   • Browser admin (served BY the backend itself)  -> same origin ('').
//   • Android (Capacitor) app: the UI is bundled on the device, so it must call
//     the deployed backend by absolute URL. Capacitor sets window.Capacitor in
//     the native webview, so this one file works for both.
window.API_BASE =
  (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    ? 'https://ai-mini-mart-api.onrender.com'
    : '';

// Prefix a relative /uploads path with the API host (local-disk images live on
// the server, not in the app bundle). Cloudinary URLs are already absolute and
// pass through unchanged.
window.assetUrl = (u) =>
  (typeof u === 'string' && u.startsWith('/')) ? (window.API_BASE || '') + u : (u || '');
