const { SPECIES, WILD_TABLE, calcStats } = require('../public/species.js');

const MOVES = {
  attack: { name: 'Investida', power: 40, acc: 1 },
  strong: { name: 'Golpe Forte', power: 70, acc: 0.8 },
};
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const mineView = (p) => ({
  id: p.id, species_id: p.species_id, nickname: p.nickname, level: p.level,
  hp: p.current_hp, maxHp: p.hp, exp: p.current_exp, expMax: p.level * 20,
});
const wildView = (w) => ({ species_id: w.species_id, level: w.level, hp: w.hp, maxHp: w.maxHp });
const nameOf = (p) => p.nickname || SPECIES[p.species_id].name;

function pickSpecies() {
  const total = WILD_TABLE.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  return (WILD_TABLE.find(([, w]) => (r -= w) < 0) || WILD_TABLE[0])[0];
}

function makeWild(id, level) {
  const st = calcStats(id, level);
  return { species_id: id, level, hp: st.hp, maxHp: st.hp, attack: st.attack, defense: st.defense };
}

function damage(level, power, atk, def) {
  const base = Math.floor((((2 * level) / 5 + 2) * power * atk) / def / 50) + 2;
  const crit = Math.random() < 1 / 16;
  return { dmg: Math.max(1, Math.floor(base * (0.85 + Math.random() * 0.15) * (crit ? 1.5 : 1))), crit };
}

/**
 * Resolve um turno (ação do jogador + resposta do selvagem), mutando o estado `b`:
 * b = { team: [rows Pokemon], mine, wild, balls }
 * Retorna { log, result: null|'win'|'lose'|'caught'|'fled', capture }
 */
function resolveTurn(b, type) {
  const log = [];
  const w = b.wild;
  const wname = SPECIES[w.species_id].name;
  const push = (msg, fx) => log.push({ msg, wildHp: w.hp, mine: mineView(b.mine), fx });
  let result = null;
  let capture = null;
  const my = b.mine;

  if (type === 'attack' || type === 'strong') {
    const mv = MOVES[type];
    if (Math.random() > mv.acc) push(`${nameOf(my)} usou ${mv.name}, mas errou!`);
    else {
      const { dmg, crit } = damage(my.level, mv.power, my.attack, w.defense);
      w.hp = Math.max(0, w.hp - dmg);
      push(`${nameOf(my)} usou ${mv.name}! (-${dmg})${crit ? ' Acerto crítico!' : ''}`);
    }
    if (w.hp <= 0) {
      const exp = Math.floor((SPECIES[w.species_id].exp * w.level) / 5);
      my.current_exp += exp;
      push(`${wname} selvagem foi derrotado! ${nameOf(my)} ganhou ${exp} EXP.`);
      while (my.current_exp >= my.level * 20 && my.level < 100) {
        my.current_exp -= my.level * 20;
        my.level++;
        const st = calcStats(my.species_id, my.level);
        my.current_hp += st.hp - my.hp;
        Object.assign(my, { hp: st.hp, attack: st.attack, defense: st.defense });
        push(`${nameOf(my)} subiu para o nível ${my.level}!`);
      }
      return { log, result: 'win', capture };
    }
  } else if (type === 'ball') {
    if (b.balls <= 0) return { log: [{ msg: 'Você não tem Pokébolas!', wildHp: w.hp, mine: mineView(my) }], result: null, capture };
    b.balls--;
    push('Você lançou uma Pokébola!', 'ball');
    const chance = Math.min(0.95, ((3 * w.maxHp - 2 * w.hp) / (3 * w.maxHp)) * SPECIES[w.species_id].catch * 1.5);
    if (Math.random() < chance) {
      push(`Gotcha! ${wname} foi capturado!`, 'caught');
      const st = calcStats(w.species_id, w.level);
      capture = { species_id: w.species_id, level: w.level, hp: st.hp, attack: st.attack, defense: st.defense, current_hp: Math.max(1, w.hp) };
      return { log, result: 'caught', capture };
    }
    push(`Ah não! ${wname} escapou da Pokébola!`, 'escape');
  } else if (type === 'run') {
    if (Math.random() < 0.7) {
      push('Você fugiu com segurança!');
      return { log, result: 'fled', capture };
    }
    push('Não conseguiu fugir!');
  }

  // Turno do selvagem
  const strong = Math.random() < 0.25;
  const mv = strong ? { name: 'Golpe Forte', power: 65, acc: 0.8 } : { name: 'Investida', power: 40, acc: 1 };
  if (Math.random() > mv.acc) push(`${wname} usou ${mv.name}, mas errou!`);
  else {
    const { dmg, crit } = damage(w.level, mv.power, w.attack, my.defense);
    my.current_hp = Math.max(0, my.current_hp - dmg);
    push(`${wname} usou ${mv.name}! (-${dmg})${crit ? ' Acerto crítico!' : ''}`);
  }
  if (my.current_hp <= 0) {
    push(`${nameOf(my)} desmaiou!`);
    const next = b.team.find((p) => p.current_hp > 0);
    if (next) {
      b.mine = next;
      push(`Vai, ${nameOf(next)}!`);
    } else {
      push('Você não tem mais Pokémon! Levado ao Centro Pokémon…');
      result = 'lose';
    }
  }
  return { log, result, capture };
}

module.exports = { pickSpecies, makeWild, resolveTurn, mineView, wildView };
