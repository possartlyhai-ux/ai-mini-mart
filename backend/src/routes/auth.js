// Auth routes: login (sets httpOnly cookie), logout, and "who am I".
const express = require('express');
const { prisma } = require('../db');
const { verifyPassword, signToken, COOKIE_NAME } = require('../lib/auth');
const { requireAuth } = require('../middleware/auth');
const { permissionsFor } = require('../config/permissions');
const { requireString } = require('../lib/validate');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  role: u.role,
  active: u.active,
  permissions: permissionsFor(u.role),
});

router.post('/login', async (req, res, next) => {
  try {
    const username = requireString(req.body.username, 'Username');
    const password = requireString(req.body.password, 'Password');
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = signToken(user);
    // Cookie keeps the same-origin browser admin working (httpOnly).
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });
    // token in the body is what the Android app stores + sends as a Bearer.
    res.json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
