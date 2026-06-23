// One-command bootstrap: ensure the (Postgres) schema exists, seed it on first
// run, then start the server. `npm start` runs this — also the Render start cmd.
const { execSync } = require('child_process');
const path = require('path');

// DATABASE_URL must be a Postgres URL (Render injects it in prod). Fall back to a
// local Postgres for dev so child `prisma` processes and the client both resolve.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_mini_mart';
}

const ROOT = path.join(__dirname, '..');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

(async () => {
  try {
    console.log('› Ensuring database schema (prisma db push)…');
    // `db push` creates dev.db from schema.prisma if missing and (re)generates
    // the client. Idempotent — safe to run every start.
    run('npx prisma db push --skip-generate || npx prisma db push');
  } catch (e) {
    // Fall back to a full push (also generates the client) on first run.
    run('npx prisma db push');
  }

  const { prisma } = require('../src/db');
  const userCount = await prisma.user.count().catch(() => 0);
  if (userCount === 0) {
    console.log('› Empty database — seeding sample data…');
    const { seed } = require('../prisma/seed');
    await seed(prisma);
  }

  require('../src/server').start();
})().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
