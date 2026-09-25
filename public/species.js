// Espécies, tipos e raridades (compartilhado cliente/servidor).
// S(nome, tipos, hp, atk, def, catch, exp, rarity): stats base; catch = facilidade de captura; exp = base de EXP
const S = (name, types, hp, atk, def, catch_, exp, rarity = 'common') => ({ name, types: types.split('/'), hp, atk, def, catch: catch_, exp, rarity });

const SPECIES = {
  1: S('Bulbasaur', 'grass/poison', 45, 49, 49, 0.45, 64, 'uncommon'), 2: S('Ivysaur', 'grass/poison', 60, 62, 63, 0.3, 142, 'uncommon'), 3: S('Venusaur', 'grass/poison', 80, 82, 83, 0.2, 236, 'rare'),
  4: S('Charmander', 'fire', 39, 52, 43, 0.45, 62, 'uncommon'), 5: S('Charmeleon', 'fire', 58, 64, 58, 0.3, 142, 'uncommon'), 6: S('Charizard', 'fire/flying', 78, 84, 78, 0.2, 240, 'rare'),
  7: S('Squirtle', 'water', 44, 48, 65, 0.45, 63, 'uncommon'), 8: S('Wartortle', 'water', 59, 63, 80, 0.3, 142, 'uncommon'), 9: S('Blastoise', 'water', 79, 83, 100, 0.2, 239, 'rare'),
  10: S('Caterpie', 'bug', 45, 30, 35, 0.9, 39), 11: S('Metapod', 'bug', 50, 20, 55, 0.6, 72, 'uncommon'), 12: S('Butterfree', 'bug/flying', 60, 45, 50, 0.4, 178, 'rare'),
  13: S('Weedle', 'bug/poison', 40, 35, 30, 0.9, 39), 14: S('Kakuna', 'bug/poison', 45, 25, 50, 0.6, 72, 'uncommon'), 15: S('Beedrill', 'bug/poison', 65, 90, 40, 0.4, 178, 'rare'),
  16: S('Pidgey', 'normal/flying', 40, 45, 40, 0.85, 50), 17: S('Pidgeotto', 'normal/flying', 63, 60, 55, 0.5, 122, 'uncommon'), 18: S('Pidgeot', 'normal/flying', 83, 80, 75, 0.25, 216, 'rare'),
  19: S('Rattata', 'normal', 30, 56, 35, 0.9, 51), 20: S('Raticate', 'normal', 55, 81, 60, 0.5, 145, 'uncommon'),
  25: S('Pikachu', 'electric', 35, 55, 40, 0.4, 112, 'rare'), 26: S('Raichu', 'electric', 60, 90, 55, 0.2, 218, 'rare'),
  27: S('Sandshrew', 'ground', 50, 75, 85, 0.7, 60, 'uncommon'), 28: S('Sandslash', 'ground', 75, 100, 110, 0.4, 158, 'rare'),
  29: S('Nidoran♀', 'poison', 55, 47, 52, 0.7, 55, 'uncommon'), 30: S('Nidorina', 'poison', 70, 62, 67, 0.4, 128, 'uncommon'), 31: S('Nidoqueen', 'poison/ground', 90, 92, 87, 0.2, 227, 'rare'),
  32: S('Nidoran♂', 'poison', 46, 57, 40, 0.7, 55, 'uncommon'), 33: S('Nidorino', 'poison', 61, 72, 57, 0.4, 128, 'uncommon'), 34: S('Nidoking', 'poison/ground', 81, 102, 77, 0.2, 227, 'rare'),
  35: S('Clefairy', 'normal', 70, 45, 48, 0.5, 113, 'uncommon'), 36: S('Clefable', 'normal', 95, 70, 73, 0.2, 217, 'rare'),
  37: S('Vulpix', 'fire', 38, 41, 40, 0.5, 60, 'uncommon'), 38: S('Ninetales', 'fire', 73, 76, 75, 0.2, 177, 'rare'),
  39: S('Jigglypuff', 'normal', 115, 45, 20, 0.6, 95, 'uncommon'), 40: S('Wigglytuff', 'normal', 140, 70, 45, 0.25, 196, 'rare'),
  41: S('Zubat', 'poison/flying', 40, 45, 35, 0.85, 49), 42: S('Golbat', 'poison/flying', 75, 80, 70, 0.4, 159, 'uncommon'),
  43: S('Oddish', 'grass/poison', 45, 50, 55, 0.85, 64), 44: S('Gloom', 'grass/poison', 60, 65, 70, 0.5, 138, 'uncommon'), 45: S('Vileplume', 'grass/poison', 75, 80, 85, 0.25, 221, 'rare'),
  52: S('Meowth', 'normal', 40, 45, 35, 0.8, 58), 53: S('Persian', 'normal', 65, 70, 60, 0.4, 154, 'uncommon'),
  54: S('Psyduck', 'water', 50, 52, 48, 0.6, 64, 'uncommon'), 55: S('Golduck', 'water', 80, 82, 78, 0.3, 175, 'rare'),
  56: S('Mankey', 'fighting', 40, 80, 35, 0.7, 61, 'uncommon'), 57: S('Primeape', 'fighting', 65, 105, 60, 0.3, 159, 'rare'),
  58: S('Growlithe', 'fire', 55, 70, 45, 0.5, 70, 'rare'), 59: S('Arcanine', 'fire', 90, 110, 80, 0.15, 194, 'epic'),
  60: S('Poliwag', 'water', 40, 50, 40, 0.8, 60), 61: S('Poliwhirl', 'water', 65, 65, 65, 0.45, 135, 'uncommon'), 62: S('Poliwrath', 'water/fighting', 90, 85, 95, 0.2, 230, 'rare'),
  63: S('Abra', 'psychic', 25, 20, 15, 0.5, 62, 'uncommon'), 64: S('Kadabra', 'psychic', 40, 35, 30, 0.35, 140, 'rare'), 65: S('Alakazam', 'psychic', 55, 50, 45, 0.2, 225, 'epic'),
  66: S('Machop', 'fighting', 70, 80, 50, 0.6, 61, 'uncommon'), 67: S('Machoke', 'fighting', 80, 100, 70, 0.35, 142, 'rare'), 68: S('Machamp', 'fighting', 90, 130, 80, 0.2, 227, 'epic'),
  69: S('Bellsprout', 'grass/poison', 50, 75, 35, 0.85, 60), 70: S('Weepinbell', 'grass/poison', 65, 90, 50, 0.5, 137, 'uncommon'), 71: S('Victreebel', 'grass/poison', 80, 105, 65, 0.25, 221, 'rare'),
  72: S('Tentacool', 'water/poison', 40, 40, 35, 0.75, 105), 73: S('Tentacruel', 'water/poison', 80, 70, 65, 0.3, 205, 'rare'),
  74: S('Geodude', 'rock/ground', 40, 80, 100, 0.75, 60, 'uncommon'), 75: S('Graveler', 'rock/ground', 55, 95, 115, 0.4, 137, 'rare'), 76: S('Golem', 'rock/ground', 80, 120, 130, 0.2, 223, 'epic'),
  77: S('Ponyta', 'fire', 50, 85, 55, 0.5, 82, 'rare'), 78: S('Rapidash', 'fire', 65, 100, 70, 0.25, 175, 'epic'),
  79: S('Slowpoke', 'water/psychic', 90, 65, 65, 0.6, 63, 'uncommon'), 80: S('Slowbro', 'water/psychic', 95, 75, 110, 0.25, 172, 'rare'),
  90: S('Shellder', 'water', 30, 65, 100, 0.75, 61, 'uncommon'), 91: S('Cloyster', 'water/ice', 50, 95, 180, 0.25, 184, 'rare'),
  98: S('Krabby', 'water', 30, 105, 90, 0.75, 65, 'uncommon'), 99: S('Kingler', 'water', 55, 130, 115, 0.3, 166, 'rare'),
  116: S('Horsea', 'water', 30, 40, 70, 0.7, 59, 'uncommon'), 117: S('Seadra', 'water', 55, 65, 95, 0.3, 154, 'rare'),
  118: S('Goldeen', 'water', 45, 67, 60, 0.75, 64), 119: S('Seaking', 'water', 80, 92, 65, 0.3, 158, 'uncommon'),
  120: S('Staryu', 'water', 30, 45, 55, 0.7, 68, 'uncommon'), 121: S('Starmie', 'water/psychic', 60, 75, 85, 0.25, 182, 'rare'),
  129: S('Magikarp', 'water', 20, 10, 55, 0.95, 40), 130: S('Gyarados', 'water/flying', 95, 125, 79, 0.2, 189, 'epic'),
  131: S('Lapras', 'water/ice', 130, 85, 80, 0.25, 187, 'epic'),
  133: S('Eevee', 'normal', 55, 55, 50, 0.3, 65, 'epic'), 134: S('Vaporeon', 'water', 130, 65, 60, 0.2, 184, 'epic'), 135: S('Jolteon', 'electric', 65, 65, 60, 0.2, 184, 'epic'), 136: S('Flareon', 'fire', 65, 130, 60, 0.2, 184, 'epic'),
  143: S('Snorlax', 'normal', 160, 110, 65, 0.15, 189, 'epic'),
  144: S('Articuno', 'ice/flying', 90, 85, 100, 0.05, 290, 'legendary'), 145: S('Zapdos', 'electric/flying', 90, 90, 85, 0.05, 290, 'legendary'), 146: S('Moltres', 'fire/flying', 90, 100, 90, 0.05, 290, 'legendary'),
  147: S('Dratini', 'dragon', 41, 64, 45, 0.25, 60, 'epic'),
  150: S('Mewtwo', 'psychic', 106, 110, 90, 0.03, 340, 'legendary'), 151: S('Mew', 'psychic', 100, 100, 100, 0.05, 270, 'legendary'),
};

const RARITY = {
  common: { label: 'Comum', color: '#7c86b3', expMul: 1, dropShard: 0.15 },
  uncommon: { label: 'Incomum', color: '#2fbf83', expMul: 1.2, dropShard: 0.3 },
  rare: { label: 'Raro', color: '#3d8bff', expMul: 1.5, dropShard: 0.6 },
  epic: { label: 'Épico', color: '#8f5cff', expMul: 2, dropShard: 1 },
  legendary: { label: 'Lendário', color: '#f0b400', expMul: 3, dropShard: 1 },
};

// ---------- Tipos ----------
const TYPES = {
  normal: { label: 'Normal', color: '#a8a878' }, fire: { label: 'Fogo', color: '#f08030' }, water: { label: 'Água', color: '#6890f0' },
  grass: { label: 'Planta', color: '#78c850' }, electric: { label: 'Elétrico', color: '#e6b800' }, ice: { label: 'Gelo', color: '#7fcfcf' },
  fighting: { label: 'Lutador', color: '#c03028' }, poison: { label: 'Veneno', color: '#a040a0' }, ground: { label: 'Terra', color: '#c9a84c' },
  flying: { label: 'Voador', color: '#a890f0' }, psychic: { label: 'Psíquico', color: '#f85888' }, bug: { label: 'Inseto', color: '#a8b820' },
  rock: { label: 'Pedra', color: '#b8a038' }, ghost: { label: 'Fantasma', color: '#705898' }, dragon: { label: 'Dragão', color: '#7038f8' },
};

// Tabela de efetividade: atacante -> defensor -> multiplicador (o que não está listado é ×1)
const CHART = {
  normal: { rock: 0.5, ghost: 0 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 2, flying: 0.5, psychic: 2, ghost: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2 },
  ghost: { normal: 0, psychic: 2, ghost: 2 },
  dragon: { dragon: 2 },
};

// Golpe assinatura (o 2º ataque usa o tipo principal do Pokémon; o 1º é sempre Normal)
const MOVE_NAMES = {
  normal: 'Golpe Forte', fire: 'Lança-chamas', water: "Jato d'Água", grass: 'Chicote de Vinha', electric: 'Choque do Trovão',
  ice: 'Raio de Gelo', fighting: 'Golpe Karatê', poison: 'Ácido', ground: 'Terremoto', flying: 'Ataque de Asa',
  psychic: 'Psíquico', bug: 'Picada', rock: 'Pedrada', ghost: 'Lambida', dragon: 'Ira do Dragão',
};

const effectiveness = (atkType, defTypes) => defTypes.reduce((m, t) => m * (CHART[atkType]?.[t] ?? 1), 1);

// Evolução por nível: espécie -> [nível, destino] (destino pode ser lista: escolhe um ao acaso)
const EVOLUTIONS = {
  1: [16, 2], 2: [32, 3], 4: [16, 5], 5: [36, 6], 7: [16, 8], 8: [36, 9],
  10: [7, 11], 11: [10, 12], 13: [7, 14], 14: [10, 15], 16: [18, 17], 17: [36, 18], 19: [20, 20],
  25: [30, 26], 27: [22, 28], 29: [16, 30], 30: [36, 31], 32: [16, 33], 33: [36, 34],
  35: [30, 36], 37: [30, 38], 39: [30, 40], 41: [22, 42], 43: [21, 44], 44: [36, 45],
  52: [28, 53], 54: [33, 55], 56: [28, 57], 58: [36, 59], 60: [25, 61], 61: [36, 62], 63: [16, 64], 64: [36, 65],
  66: [28, 67], 67: [36, 68], 69: [21, 70], 70: [36, 71], 72: [30, 73], 74: [25, 75], 75: [38, 76],
  77: [40, 78], 79: [37, 80], 90: [36, 91], 98: [28, 99], 116: [32, 117], 118: [33, 119], 120: [36, 121],
  129: [20, 130], 133: [30, [134, 135, 136]],
};

// Tabelas de encontro: [species_id, peso]. Terra: na grama alta. Água: nas margens dos lagos.
const WILD_TABLE = [
  [10, 14], [13, 14], [16, 14], [19, 14], [41, 12], [43, 12], [69, 10], [52, 9],
  [27, 5], [29, 5], [32, 5], [74, 5], [56, 4], [66, 4], [39, 4], [37, 3.5], [35, 3.5], [63, 3.5],
  [25, 2], [58, 2], [77, 2],
  [133, 0.8], [147, 0.8], [143, 0.6],
  [144, 0.15], [145, 0.15], [146, 0.15], [150, 0.05], [151, 0.08],
];
const WATER_TABLE = [
  [118, 14], [60, 14], [72, 12], [129, 10],
  [54, 6], [98, 6], [116, 6], [120, 6], [90, 5], [79, 5],
  [131, 0.7],
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

if (typeof module !== 'undefined') {
  module.exports = { SPECIES, RARITY, TYPES, CHART, MOVE_NAMES, EVOLUTIONS, WILD_TABLE, WATER_TABLE, calcStats, evolveTarget, effectiveness };
}
