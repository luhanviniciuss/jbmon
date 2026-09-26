// Pokédex do jogador (tabela user_pokedex): "visto" = encontrado em batalha; "capturado" = possui o Pokémon
// (captura, evolução, presente do Professor ou de um admin). O servidor registra sozinho; o cliente só lê.
const { SPECIES } = require('../public/species.js');

module.exports = function createPokedex({ app, prisma, auth, socketByUser, durable }) {
  const cache = new Map(); // uid -> Map(species_id -> 1 visto | 2 capturado)

  async function ensure(uid) {
    if (cache.has(uid)) return cache.get(uid);
    const rows = await prisma.pokedexEntry.findMany({ where: { user_id: uid }, select: { species_id: true, caught: true } });
    const m = new Map(rows.map((r) => [r.species_id, r.caught ? 2 : 1]));
    cache.set(uid, m);
    return m;
  }

  // kind: 'seen' | 'caught'. Nunca rebaixa (capturado continua capturado) e só grava quando muda.
  async function mark(uid, species, kind, { quiet = false } = {}) {
    if (!SPECIES[species]) return;
    try {
      const m = await ensure(uid);
      const want = kind === 'caught' ? 2 : 1;
      if ((m.get(species) || 0) >= want) return;
      m.set(species, want); // antes do await: duas marcações ao mesmo tempo não duplicam
      const now = new Date();
      await durable('pokedex', () => prisma.pokedexEntry.upsert({
        where: { user_id_species_id: { user_id: uid, species_id: species } },
        create: { user_id: uid, species_id: species, seen: true, caught: want === 2, first_seen_at: now, first_caught_at: want === 2 ? now : null },
        update: want === 2 ? { seen: true, caught: true, first_caught_at: now } : {},
      }));
      if (!quiet) socketByUser.get(uid)?.emit('dex:new', { species_id: species, kind });
    } catch (e) {
      console.error('[pokedex] falha ao registrar', e.message);
    }
  }

  // Tudo que o jogador possui vira "capturado" (contas antigas, evolução, presentes)
  async function syncOwned(uid, quiet = false) {
    try {
      const rows = await prisma.pokemon.findMany({ where: { user_id: uid }, select: { species_id: true } });
      for (const sp of new Set(rows.map((r) => r.species_id))) await mark(uid, sp, 'caught', { quiet });
    } catch (e) {
      console.error('[pokedex] sync', e.message);
    }
  }

  // GET /api/pokedex -> { entries: [{species_id, seen, caught}], best: {species_id: maior nível que você tem} }
  app.get('/api/pokedex', auth, async (req, res) => {
    try {
      const uid = req.user.id;
      await syncOwned(uid, true);
      const [rows, mons] = await Promise.all([
        prisma.pokedexEntry.findMany({ where: { user_id: uid }, select: { species_id: true, caught: true } }),
        prisma.pokemon.findMany({ where: { user_id: uid }, select: { species_id: true, level: true } }),
      ]);
      const best = {};
      for (const p of mons) best[p.species_id] = Math.max(best[p.species_id] || 0, p.level);
      res.json({ entries: rows.map((r) => ({ species_id: r.species_id, seen: true, caught: r.caught })), best, total: Object.keys(SPECIES).length });
    } catch (e) {
      console.error('[pokedex] GET', e);
      res.status(500).json({ error: 'Erro interno' });
    }
  });

  return { mark, syncOwned, load: ensure, drop: (uid) => cache.delete(uid) };
};
