// Single shared PrismaClient instance for the whole process.
// DATABASE_URL must be a Postgres connection string. In prod Render injects it;
// for local dev set it in backend/.env (default below points at a local Postgres).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_mini_mart';
}
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = { prisma };
