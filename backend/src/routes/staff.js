// Staff management (Owner only): list, create, edit, activate/deactivate,
// reset password, change role.
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS, ROLES } = require('../config/permissions');
const { hashPassword } = require('../lib/auth');
const v = require('../lib/validate');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
});

router.use(requireAuth, requirePermission(PERMISSIONS.STAFF_MANAGE));

router.get('/', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ staff: users.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = v.requireString(req.body.name, 'Name', { max: 120 });
    const username = v.requireString(req.body.username, 'Username', { max: 60 }).toLowerCase();
    const password = v.requireString(req.body.password, 'Password', { min: 6, max: 200 });
    const role = v.oneOf(req.body.role || ROLES.STAFF, 'Role', Object.values(ROLES));
    const user = await prisma.user.create({
      data: { name, username, passwordHash: await hashPassword(password), role, active: true },
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(translateUnique(err));
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = {};
    if (req.body.name !== undefined) data.name = v.requireString(req.body.name, 'Name', { max: 120 });
    if (req.body.role !== undefined) data.role = v.oneOf(req.body.role, 'Role', Object.values(ROLES));
    if (req.body.active !== undefined) data.active = !!req.body.active;
    if (req.body.password) data.passwordHash = await hashPassword(v.requireString(req.body.password, 'Password', { min: 6, max: 200 }));

    // Guard: never let the last active Owner be demoted or disabled (lock-out).
    if (data.active === false || (data.role && data.role !== ROLES.OWNER)) {
      const target = await prisma.user.findUnique({ where: { id } });
      if (target?.role === ROLES.OWNER) {
        const owners = await prisma.user.count({ where: { role: ROLES.OWNER, active: true } });
        if (owners <= 1) throw v.badRequest('You cannot deactivate or demote the last active Owner.');
      }
    }

    const user = await prisma.user.update({ where: { id }, data });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(translateUnique(err));
  }
});

function translateUnique(err) {
  if (err?.code === 'P2002') return v.badRequest('That username is already taken.');
  return err;
}

module.exports = router;
