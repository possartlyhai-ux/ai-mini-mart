// scripts/backup.js — dump every DB table to a timestamped JSON file.
//
// Usage:
//   DATABASE_URL="<your Neon URL>" npm run db:backup
// (or set DATABASE_URL in backend/.env). Writes backend/backups/backup-<time>.json.
//
// The dump is a plain JSON object { ModelName: [rows...] } covering every table
// in schema.prisma — your own off-site copy. Keep these files private: they
// include user rows with password hashes. (Restore script available on request.)
const fs = require('fs');
const path = require('path');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../src/db');

(async () => {
  const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const dump = { _meta: { at: new Date().toISOString(), models } };

  for (const name of models) {
    const key = name[0].toLowerCase() + name.slice(1); // Prisma client uses camelCase
    dump[name] = await prisma[key].findMany();
  }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));

  const counts = models.map((m) => `${m}:${dump[m].length}`).join(', ');
  console.log(`✓ Backup written: ${file}`);
  console.log(`  rows -> ${counts}`);
  await prisma.$disconnect();
})().catch((err) => {
  console.error('Backup failed:', err.message || err);
  process.exit(1);
});
