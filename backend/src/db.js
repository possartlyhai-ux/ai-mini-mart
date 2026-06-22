// Single shared PrismaClient instance for the whole process.
// Default the SQLite location so the app runs with zero env setup (one command).
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = { prisma };
