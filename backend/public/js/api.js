// Thin fetch wrapper with two auth transports:
//  • Browser admin (same-origin): API_BASE='' and the JWT rides in the httpOnly
//    cookie automatically.
//  • Android (Capacitor) app: API_BASE is the deployed backend (different
//    origin), so we send the JWT as `Authorization: Bearer` from localStorage.
const API = (() => {
  const BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
  const TOKEN_KEY = 'mm_token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  };

  async function request(method, path, body, isForm) {
    const opts = { method, credentials: BASE ? 'include' : 'same-origin', headers: {} };
    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      if (isForm) {
        opts.body = body; // FormData — let the browser set the boundary
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(`${BASE}/api${path}`, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON (e.g. receipt) — ignore */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    upload: (p, formData) => request('POST', p, formData, true),
    setToken,
    getToken,
  };
})();
