// Thin fetch wrapper. Cookies (the auth JWT) ride along automatically with
// same-origin requests, but we set credentials explicitly to be safe.
const API = (() => {
  async function request(method, path, body, isForm) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      if (isForm) {
        opts.body = body; // FormData — let the browser set the boundary
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(`/api${path}`, opts);
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
  };
})();
