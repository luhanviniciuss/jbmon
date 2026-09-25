// Equipe: até 6 Pokémon com `slot` 1..6 (a ordem importa: o slot 1 entra primeiro em batalha). Os demais ficam no box (slot null).

// Equipe do jogador em ordem de slot. Contas antigas ainda sem slots: os 6 primeiros capturados viram a equipe.
async function loadTeam(prisma, userId) {
  const team = await prisma.pokemon.findMany({ where: { user_id: userId, slot: { not: null } }, orderBy: { slot: 'asc' } });
  if (team.length) return team;
  const first = await prisma.pokemon.findMany({ where: { user_id: userId }, orderBy: { id: 'asc' }, take: 6 });
  if (!first.length) return [];
  await prisma.$transaction(first.map((p, i) => prisma.pokemon.update({ where: { id: p.id }, data: { slot: i + 1 } })));
  return first.map((p, i) => ({ ...p, slot: i + 1 }));
}

// Primeiro slot livre da equipe (1..6) ou null se estiver cheia (o novo Pokémon vai para o box)
async function nextFreeSlot(prisma, userId) {
  const used = new Set((await prisma.pokemon.findMany({ where: { user_id: userId, slot: { not: null } }, select: { slot: true } })).map((x) => x.slot));
  for (let i = 1; i <= 6; i++) if (!used.has(i)) return i;
  return null;
}

async function partyOf(prisma, userId) {
  await loadTeam(prisma, userId);
  const all = await prisma.pokemon.findMany({ where: { user_id: userId } });
  return {
    party: all.filter((p) => p.slot != null).sort((a, b) => a.slot - b.slot),
    box: all.filter((p) => p.slot == null).sort((a, b) => a.id - b.id),
  };
}

module.exports = { loadTeam, nextFreeSlot, partyOf };
