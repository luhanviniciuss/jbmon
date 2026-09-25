// Espécies (compartilhado cliente/servidor).
// hp/atk/def = stats base; catch = facilidade de captura; exp = base de EXP; rarity = common|uncommon|rare|epic|legendary
const S = (name, hp, atk, def, catch_, exp, rarity = 'common') => ({ name, hp, atk, def, catch: catch_, exp, rarity });

const SPECIES = {
  1: S('Bulbasaur', 45, 49, 49, 0.45, 64, 'uncommon'), 2: S('Ivysaur', 60, 62, 63, 0.3, 142, 'uncommon'), 3: S('Venusaur', 80, 82, 83, 0.2, 236, 'rare'),
  4: S('Charmander', 39, 52, 43, 0.45, 62, 'uncommon'), 5: S('Charmeleon', 58, 64, 58, 0.3, 142, 'uncommon'), 6: S('Charizard', 78, 84, 78, 0.2, 240, 'rare'),
  7: S('Squirtle', 44, 48, 65, 0.45, 63, 'uncommon'), 8: S('Wartortle', 59, 63, 80, 0.3, 142, 'uncommon'), 9: S('Blastoise', 79, 83, 100, 0.2, 239, 'rare'),
  10: S('Caterpie', 45, 30, 35, 0.9, 39), 11: S('Metapod', 50, 20, 55, 0.6, 72, 'uncommon'), 12: S('Butterfree', 60, 45, 50, 0.4, 178, 'rare'),
  13: S('Weedle', 40, 35, 30, 0.9, 39), 14: S('Kakuna', 45, 25, 50, 0.6, 72, 'uncommon'), 15: S('Beedrill', 65, 90, 40, 0.4, 178, 'rare'),
  16: S('Pidgey', 40, 45, 40, 0.85, 50), 17: S('Pidgeotto', 63, 60, 55, 0.5, 122, 'uncommon'), 18: S('Pidgeot', 83, 80, 75, 0.25, 216, 'rare'),
  19: S('Rattata', 30, 56, 35, 0.9, 51), 20: S('Raticate', 55, 81, 60, 0.5, 145, 'uncommon'),
  25: S('Pikachu', 35, 55, 40, 0.4, 112, 'rare'), 26: S('Raichu', 60, 90, 55, 0.2, 218, 'rare'),
  27: S('Sandshrew', 50, 75, 85, 0.7, 60, 'uncommon'), 28: S('Sandslash', 75, 100, 110, 0.4, 158, 'rare'),
  29: S('Nidoran♀', 55, 47, 52, 0.7, 55, 'uncommon'), 30: S('Nidorina', 70, 62, 67, 0.4, 128, 'uncommon'), 31: S('Nidoqueen', 90, 92, 87, 0.2, 227, 'rare'),
  32: S('Nidoran♂', 46, 57, 40, 0.7, 55, 'uncommon'), 33: S('Nidorino', 61, 72, 57, 0.4, 128, 'uncommon'), 34: S('Nidoking', 81, 102, 77, 0.2, 227, 'rare'),
  35: S('Clefairy', 70, 45, 48, 0.5, 113, 'uncommon'), 36: S('Clefable', 95, 70, 73, 0.2, 217, 'rare'),
  37: S('Vulpix', 38, 41, 40, 0.5, 60, 'uncommon'), 38: S('Ninetales', 73, 76, 75, 0.2, 177, 'rare'),
  39: S('Jigglypuff', 115, 45, 20, 0.6, 95, 'uncommon'), 40: S('Wigglytuff', 140, 70, 45, 0.25, 196, 'rare'),
  41: S('Zubat', 40, 45, 35, 0.85, 49), 42: S('Golbat', 75, 80, 70, 0.4, 159, 'uncommon'),
  43: S('Oddish', 45, 50, 55, 0.85, 64), 44: S('Gloom', 60, 65, 70, 0.5, 138, 'uncommon'), 45: S('Vileplume', 75, 80, 85, 0.25, 221, 'rare'),
  52: S('Meowth', 40, 45, 35, 0.8, 58), 53: S('Persian', 65, 70, 60, 0.4, 154, 'uncommon'),
  54: S('Psyduck', 50, 52, 48, 0.6, 64, 'uncommon'), 55: S('Golduck', 80, 82, 78, 0.3, 175, 'rare'),
  56: S('Mankey', 40, 80, 35, 0.7, 61, 'uncommon'), 57: S('Primeape', 65, 105, 60, 0.3, 159, 'rare'),
  58: S('Growlithe', 55, 70, 45, 0.5, 70, 'rare'), 59: S('Arcanine', 90, 110, 80, 0.15, 194, 'epic'),
  63: S('Abra', 25, 20, 15, 0.5, 62, 'uncommon'), 64: S('Kadabra', 40, 35, 30, 0.35, 140, 'rare'), 65: S('Alakazam', 55, 50, 45, 0.2, 225, 'epic'),
  66: S('Machop', 70, 80, 50, 0.6, 61, 'uncommon'), 67: S('Machoke', 80, 100, 70, 0.35, 142, 'rare'), 68: S('Machamp', 90, 130, 80, 0.2, 227, 'epic'),
  69: S('Bellsprout', 50, 75, 35, 0.85, 60), 70: S('Weepinbell', 65, 90, 50, 0.5, 137, 'uncommon'), 71: S('Victreebel', 80, 105, 65, 0.25, 221, 'rare'),
  74: S('Geodude', 40, 80, 100, 0.75, 60, 'uncommon'), 75: S('Graveler', 55, 95, 115, 0.4, 137, 'rare'), 76: S('Golem', 80, 120, 130, 0.2, 223, 'epic'),
  77: S('Ponyta', 50, 85, 55, 0.5, 82, 'rare'), 78: S('Rapidash', 65, 100, 70, 0.25, 175, 'epic'),
  129: S('Magikarp', 20, 10, 55, 0.95, 40), 130: S('Gyarados', 95, 125, 79, 0.2, 189, 'epic'),
  131: S('Lapras', 130, 85, 80, 0.25, 187, 'epic'),
  133: S('Eevee', 55, 55, 50, 0.3, 65, 'epic'), 134: S('Vaporeon', 130, 65, 60, 0.2, 184, 'epic'), 135: S('Jolteon', 65, 65, 60, 0.2, 184, 'epic'), 136: S('Flareon', 65, 130, 60, 0.2, 184, 'epic'),
  143: S('Snorlax', 160, 110, 65, 0.15, 189, 'epic'),
  144: S('Articuno', 90, 85, 100, 0.05, 290, 'legendary'), 145: S('Zapdos', 90, 90, 85, 0.05, 290, 'legendary'), 146: S('Moltres', 90, 100, 90, 0.05, 290, 'legendary'),
  147: S('Dratini', 41, 64, 45, 0.25, 60, 'epic'),
  150: S('Mewtwo', 106, 110, 90, 0.03, 340, 'legendary'), 151: S('Mew', 100, 100, 100, 0.05, 270, 'legendary'),
};

const RARITY = {
  common: { label: 'Comum', color: '#7c86b3', expMul: 1, dropShard: 0.15 },
  uncommon: { label: 'Incomum', color: '#2fbf83', expMul: 1.2, dropShard: 0.3 },
  rare: { label: 'Raro', color: '#3d8bff', expMul: 1.5, dropShard: 0.6 },
  epic: { label: 'Épico', color: '#8f5cff', expMul: 2, dropShard: 1 },
  legendary: { label: 'Lendário', color: '#f0b400', expMul: 3, dropShard: 1 },
};

// Evolução por nível: espécie -> [nível, destino] (destino pode ser lista: escolhe um ao acaso)
const EVOLUTIONS = {
  1: [16, 2], 2: [32, 3], 4: [16, 5], 5: [36, 6], 7: [16, 8], 8: [36, 9],
  10: [7, 11], 11: [10, 12], 13: [7, 14], 14: [10, 15], 16: [18, 17], 17: [36, 18], 19: [20, 20],
  25: [30, 26], 27: [22, 28], 29: [16, 30], 30: [36, 31], 32: [16, 33], 33: [36, 34],
  35: [30, 36], 37: [30, 38], 39: [30, 40], 41: [22, 42], 43: [21, 44], 44: [36, 45],
  52: [28, 53], 54: [33, 55], 56: [28, 57], 58: [36, 59], 63: [16, 64], 64: [36, 65],
  66: [28, 67], 67: [36, 68], 69: [21, 70], 70: [36, 71], 74: [25, 75], 75: [38, 76],
  77: [40, 78], 129: [20, 130], 133: [30, [134, 135, 136]],
};

// Tabela de encontros no mapa: [species_id, peso]. Raros e lendários quase não aparecem.
const WILD_TABLE = [
  [10, 14], [13, 14], [16, 14], [19, 14], [41, 12], [43, 12], [69, 10], [52, 9], [129, 8],
  [27, 5], [29, 5], [32, 5], [74, 5], [56, 4], [54, 4], [66, 4], [39, 4], [37, 3.5], [35, 3.5], [63, 3.5],
  [25, 2], [58, 2], [77, 2],
  [133, 0.8], [147, 0.8], [143, 0.6], [131, 0.6],
  [144, 0.15], [145, 0.15], [146, 0.15], [150, 0.05], [151, 0.08],
];

function calcStats(id, level) {
  const s = SPECIES[id];
  return {
    hp: Math.floor((2 * s.hp * level) / 100) + level + 10,
    attack: Math.floor((2 * s.atk * level) / 100) + 5,
    defense: Math.floor((2 * s.def * level) / 100) + 5,
  };
}

// Retorna o id da evolução se a espécie evolui neste nível, senão null
function evolveTarget(id, level) {
  const e = EVOLUTIONS[id];
  if (!e || level < e[0]) return null;
  return Array.isArray(e[1]) ? e[1][Math.floor(Math.random() * e[1].length)] : e[1];
}

if (typeof module !== 'undefined') module.exports = { SPECIES, RARITY, EVOLUTIONS, WILD_TABLE, calcStats, evolveTarget };
