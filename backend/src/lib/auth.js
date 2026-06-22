// Password hashing (bcryptjs — pure JS, no native build) + JWT helpers.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '12h';
const COOKIE_NAME = 'mm_token';

const hashPassword = (plain) => bcrypt.hash(plain, 10);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, COOKIE_NAME, TOKEN_TTL };
