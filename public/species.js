// Espécies (compartilhado cliente/servidor). Stats base: hp/atk/def; catch = facilidade de captura; exp = base de EXP.
const SPECIES = {
  1: { name: 'Bulbasaur', hp: 45, atk: 49, def: 49, catch: 0.45, exp: 64 },
  4: { name: 'Charmander', hp: 39, atk: 52, def: 43, catch: 0.45, exp: 62 },
  7: { name: 'Squirtle', hp: 44, atk: 48, def: 65, catch: 0.45, exp: 63 },
  10: { name: 'Caterpie', hp: 45, atk: 30, def: 35, catch: 0.9, exp: 39 },
  13: { name: 'Weedle', hp: 40, atk: 35, def: 30, catch: 0.9, exp: 39 },
  16: { name: 'Pidgey', hp: 40, atk: 45, def: 40, catch: 0.85, exp: 50 },
  19: { name: 'Rattata', hp: 30, atk: 56, def: 35, catch: 0.9, exp: 51 },
  25: { name: 'Pikachu', hp: 35, atk: 55, def: 40, catch: 0.4, exp: 112 },
  27: { name: 'Sandshrew', hp: 50, atk: 75, def: 85, catch: 0.7, exp: 60 },
  29: { name: 'Nidoran♀', hp: 55, atk: 47, def: 52, catch: 0.7, exp: 55 },
  32: { name: 'Nidoran♂', hp: 46, atk: 57, def: 40, catch: 0.7, exp: 55 },
  35: { name: 'Clefairy', hp: 70, atk: 45, def: 48, catch: 0.5, exp: 113 },
  37: { name: 'Vulpix', hp: 38, atk: 41, def: 40, catch: 0.5, exp: 60 },
  39: { name: 'Jigglypuff', hp: 115, atk: 45, def: 20, catch: 0.6, exp: 95 },
  41: { name: 'Zubat', hp: 40, atk: 45, def: 35, catch: 0.85, exp: 49 },
  43: { name: 'Oddish', hp: 45, atk: 50, def: 55, catch: 0.85, exp: 64 },
  52: { name: 'Meowth', hp: 40, atk: 45, def: 35, catch: 0.8, exp: 58 },
  54: { name: 'Psyduck', hp: 50, atk: 52, def: 48, catch: 0.6, exp: 64 },
  56: { name: 'Mankey', hp: 40, atk: 80, def: 35, catch: 0.7, exp: 61 },
  58: { name: 'Growlithe', hp: 55, atk: 70, def: 45, catch: 0.5, exp: 70 },
  63: { name: 'Abra', hp: 25, atk: 20, def: 15, catch: 0.5, exp: 62 },
  66: { name: 'Machop', hp: 70, atk: 80, def: 50, catch: 0.6, exp: 61 },
  69: { name: 'Bellsprout', hp: 50, atk: 75, def: 35, catch: 0.85, exp: 60 },
  74: { name: 'Geodude', hp: 40, atk: 80, def: 100, catch: 0.75, exp: 60 },
  77: { name: 'Ponyta', hp: 50, atk: 85, def: 55, catch: 0.5, exp: 82 },
  129: { name: 'Magikarp', hp: 20, atk: 10, def: 55, catch: 0.95, exp: 40 },
  133: { name: 'Eevee', hp: 55, atk: 55, def: 50, catch: 0.4, exp: 65 },
};

// Tabela de encontros na grama alta: [species_id, peso]
const WILD_TABLE = [
  [10, 12], [13, 12], [16, 14], [19, 14], [41, 10], [43, 8], [69, 8], [52, 6], [29, 6], [32, 6],
  [27, 5], [74, 5], [56, 4], [54, 4], [129, 5], [35, 3], [37, 3], [39, 3], [25, 2], [58, 2], [63, 2], [66, 2], [77, 2], [133, 1],
];

function calcStats(id, level) {
  const s = SPECIES[id];
  return {
    hp: Math.floor((2 * s.hp * level) / 100) + level + 10,
    attack: Math.floor((2 * s.atk * level) / 100) + 5,
    defense: Math.floor((2 * s.def * level) / 100) + 5,
  };
}

if (typeof module !== 'undefined') module.exports = { SPECIES, WILD_TABLE, calcStats };
