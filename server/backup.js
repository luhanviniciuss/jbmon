// Backup periódico do arquivo SQLite (consistente: faz checkpoint do WAL antes de copiar).
const fs = require('fs');
const path = require('path');

const KEEP = 48; // backups mantidos

function dbPath() {
  const url = process.env.DATABASE_URL || 'file:./dev.db';
  const p = url.replace(/^file:/, '').split('?')[0];
  return path.isAbsolute(p) ? p : path.resolve(__dirname, '..', 'prisma', p); // relativo ao schema.prisma
}

async function backupNow(prisma) {
  const src = dbPath();
  if (!fs.existsSync(src)) return;
  try { await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* segue mesmo assim */ }
  const dir = path.join(path.dirname(src), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(dir, `backup-${stamp}.db`);
  fs.copyFileSync(src, file);
  fs.readdirSync(dir).filter((f) => f.startsWith('backup-')).sort().slice(0, -KEEP).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  return file;
}

function startBackups(prisma, everyMin = 60) {
  const run = () => backupNow(prisma).then((f) => f && console.log('Backup do banco:', path.basename(f))).catch((e) => console.error('Falha no backup:', e.message));
  run();
  setInterval(run, everyMin * 60000).unref();
}

module.exports = { startBackups, backupNow };
