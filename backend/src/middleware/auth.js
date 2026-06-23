// Auth + RBAC middleware. Token transport: `Authorization: Bearer <jwt>` (the
// Android/Capacitor app, cross-origin) OR the httpOnly cookie (same-origin
// browser admin). The Bearer header wins when both are present.
const { prisma } = require('../db');
const { verifyToken, COOKIE_NAME } = require('../lib/auth');
const { permissionsFor, hasPermission } = require('../config/permissions');

// Loads the current user onto req.user (or null). Does not block.
async function attachUser(req, _res, next) {
  req.user = null;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = bearer || req.cookies?.[COOKIE_NAME];
  if (token) {
    const payload = verifyToken(token);
    if (payload?.uid) {
      const user = await prisma.user.findUnique({ where: { id: payload.uid } });
      if (user && user.active) {
        req.user = user;
        req.permissions = permissionsFor(user.role);
      }
    }
  }
  next();
}

// Blocks unless a valid, active user is attached.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

// Blocks unless the signed-in user's role grants `permission`.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requirePermission };
