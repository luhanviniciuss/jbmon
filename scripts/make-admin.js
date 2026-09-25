// Concede (ou retira) o papel de administrador a uma conta. Só quem tem acesso ao servidor consegue rodar isto.
//   npm run make-admin -- nome_da_conta            (torna admin)
//   npm run make-admin -- nome_da_conta --revoke   (volta a jogador comum)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const [name, flag] = process.argv.slice(2);
  if (!name) { console.error('Uso: npm run make-admin -- <usuario> [--revoke]'); process.exit(1); }
  const prisma = new PrismaClient();
  const role = flag === '--revoke' ? 'player' : 'admin';
  const r = await prisma.user.updateMany({ where: { username: name }, data: { role } });
  console.log(r.count ? `${name} agora é "${role}".` : `Conta "${name}" não encontrada.`);
  await prisma.$disconnect();
  process.exit(r.count ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
