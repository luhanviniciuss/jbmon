// Exporta todas as contas e Pokémon para JSON (backup independente do banco). Uso: npm run export > backup.json
// (as senhas continuam em hash bcrypt)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  const users = await prisma.user.findMany({ include: { pokemons: true }, orderBy: { id: 'asc' } });
  process.stdout.write(JSON.stringify({ exportedAt: new Date().toISOString(), users }, null, 2));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
