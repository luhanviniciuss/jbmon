// Itens (compartilhado cliente/servidor): tipos de Pokébola, materiais e receitas de craft.
const BALLS = {
  poke: { name: 'Pokébola', rarity: 'common', mult: 1, col: 'pokeballs' },
  great: { name: 'Great Ball', rarity: 'uncommon', mult: 1.5, col: 'greatballs' },
  ultra: { name: 'Ultra Ball', rarity: 'rare', mult: 2, col: 'ultraballs' },
  master: { name: 'Master Ball', rarity: 'legendary', mult: 1000, guaranteed: true, col: 'masterballs' },
};

const MATERIALS = {
  apricorns: { name: 'Bolotas', hint: 'Caem de qualquer Pokémon derrotado ou capturado' },
  shards: { name: 'Fragmentos', hint: 'Mais comuns em Pokémon raros, épicos e lendários' },
};

const RECIPES = [
  { id: 'poke', gives: { poke: 3 }, cost: { apricorns: 3 } },
  { id: 'great', gives: { great: 1 }, cost: { apricorns: 4, shards: 1 } },
  { id: 'ultra', gives: { ultra: 1 }, cost: { apricorns: 6, shards: 3 } },
  { id: 'master', gives: { master: 1 }, cost: { apricorns: 30, shards: 12 } },
];

if (typeof module !== 'undefined') module.exports = { BALLS, MATERIALS, RECIPES };
