// One-command bootstrap: ensure the SQLite schema exists, seed it on first run,
// then start the server. `npm start` runs this.
const { execSync } = require('child_process');
const path = require('path');

// Default DB location so child `prisma` processes (which inherit this env) and
// the in-process client both resolve without any .env setup.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';

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
