const { SPECIES, RARITY, MOVE_NAMES, WILD_TABLE, calcStats, evolveTarget, effectiveness } = require('../public/species.js');
const { BALLS } = require('../public/items.js');

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const mineView = (p) => ({
  id: p.id, species_id: p.species_id, nickname: p.nickname, level: p.level,
  hp: p.current_hp, maxHp: p.hp, exp: p.current_exp, expMax: p.level * 20,
});
const wildView = (w) => ({ species_id: w.species_id, level: w.level, hp: w.hp, maxHp: w.maxHp });
const nameOf = (p) => p.nickname || SPECIES[p.species_id].name;

function pickSpecies(table = WILD_TABLE) {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  return (table.find(([, w]) => (r -= w) < 0) || table[0])[0];
}

function makeWild(id, level) {
  const st = calcStats(id, level);
  return { species_id: id, level, hp: st.hp, maxHp: st.hp, attack: st.attack, defense: st.defense };
}

// ---------- Golpes e dano com tipos ----------
// 'attack' = Investida (Normal). 'strong' = golpe do tipo principal do atacante (com STAB).
function getMove(kind, types) {
  if (kind === 'strong') return { name: MOVE_NAMES[types[0]], type: types[0], power: 70, acc: 0.85 };
  return { name: 'Investida', type: 'normal', power: 40, acc: 1 };
}

// Dano = base × aleatório × STAB × efetividade × crítico.
// Super efetivo aumenta MUITO a chance de crítico (30%); resistido quase zera (3%); normal 1/16.
function calcHit(level, mv, atk, def, atkTypes, defTypes) {
  const eff = effectiveness(mv.type, defTypes);
  if (eff === 0) return { dmg: 0, eff, crit: false };
  const stab = atkTypes.includes(mv.type) ? 1.5 : 1;
  const crit = Math.random() < (eff > 1 ? 0.3 : eff < 1 ? 0.03 : 1 / 16);
  const base = Math.floor((((2 * level) / 5 + 2) * mv.power * atk) / def / 50) + 2;
  return { dmg: Math.max(1, Math.floor(base * (0.85 + Math.random() * 0.15) * stab * eff * (crit ? 1.5 : 1))), eff, crit };
}

const effText = (eff) => (eff === 0 ? ' Não afeta o alvo…' : eff > 1 ? ' É super efetivo!' : eff < 1 ? ' Não é muito efetivo…' : '');

function catchChance(species_id, hp, maxHp, ball, bonus = 1) {
  if (ball.guaranteed) return 1;
  const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp);
  return Math.min(0.95, hpFactor * SPECIES[species_id].catch * 1.5 * ball.mult * bonus);
}

function rollDrops(rarity) {
  const apricorns = rand(1, 3);
  let shards = 0;
  if (Math.random() < RARITY[rarity].dropShard) shards = { common: 1, uncommon: 1, rare: rand(1, 2), epic: rand(2, 3), legendary: rand(4, 6) }[rarity];
  return { apricorns, shards };
}

// Recalcula stats ao subir de nível/evoluir, preservando o HP já perdido
function applyStats(p) {
  const st = calcStats(p.species_id, p.level);
  p.current_hp += st.hp - p.hp;
  Object.assign(p, { hp: st.hp, attack: st.attack, defense: st.defense });
}

// Dá EXP, sobe níveis e evolui. Callbacks opcionais para narrar cada evento.
function gainExp(mon, exp, { onLevel, onEvolve } = {}) {
  mon.current_exp += exp;
  while (mon.current_exp >= mon.level * 20 && mon.level < 100) {
    mon.current_exp -= mon.level * 20;
    mon.level++;
    applyStats(mon);
    onLevel?.(mon.level);
    const to = evolveTarget(mon.species_id, mon.level);
    if (to) {
      const from = nameOf(mon);
      mon.species_id = to;
      applyStats(mon);
      onEvolve?.(from, to);
    }
  }
}

/**
 * Resolve um turno (ação do jogador + resposta do selvagem), mutando o estado `b`:
 * b = { team: [rows Pokemon], mine, wild, inv }
 * Retorna { log, result: null|'win'|'lose'|'caught'|'fled', capture, drops }
 */
function resolveTurn(b, type) {
  const log = [];
  const w = b.wild;
  const wname = SPECIES[w.species_id].name;
  const wTypes = SPECIES[w.species_id].types;
  const push = (msg, fx, extra) => log.push({ msg, wildHp: w.hp, mine: mineView(b.mine), fx, ...extra });
  let result = null;
  let capture = null;
  const my = b.mine;
  const myTypes = SPECIES[my.species_id].types;

  if (type === 'attack' || type === 'strong') {
    const mv = getMove(type, myTypes);
    if (Math.random() > mv.acc) push(`${nameOf(my)} usou ${mv.name}, mas errou!`);
    else {
      const h = calcHit(my.level, mv, my.attack, w.defense, myTypes, wTypes);
      w.hp = Math.max(0, w.hp - h.dmg);
      push(`${nameOf(my)} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${h.dmg})`, null, { eff: h.eff });
    }
    if (w.hp <= 0) {
      const rarity = SPECIES[w.species_id].rarity;
      const exp = Math.floor(((SPECIES[w.species_id].exp * w.level) / 5) * RARITY[rarity].expMul);
      push(`${wname} selvagem foi derrotado! ${nameOf(my)} ganhou ${exp} EXP.`);
      gainExp(my, exp, {
        onLevel: (lvl) => push(`${nameOf(my)} subiu para o nível ${lvl}!`),
        onEvolve: (from, to) => push(`${from} evoluiu para ${SPECIES[to].name}!`, 'evolve'),
      });
      const drops = rollDrops(rarity);
      push(`Coletou ${drops.apricorns} Bolota(s)${drops.shards ? ` e ${drops.shards} Fragmento(s)` : ''}!`);
      return { log, result: 'win', capture, drops };
    }
  } else if (type.startsWith('ball:')) {
    const kind = type.slice(5);
    const ball = BALLS[kind];
    if (!ball || !(b.inv[kind] > 0)) return { log: [{ msg: 'Você não tem essa Pokébola!', wildHp: w.hp, mine: mineView(my) }], result: null, capture };
    b.inv[kind]--;
    push(`Você lançou uma ${ball.name}!`, 'ball', { kind });
    if (Math.random() < catchChance(w.species_id, w.hp, w.maxHp, ball)) {
      push(`Gotcha! ${wname} foi capturado!`, 'caught');
      const st = calcStats(w.species_id, w.level);
      capture = { species_id: w.species_id, level: w.level, hp: st.hp, attack: st.attack, defense: st.defense, current_hp: Math.max(1, w.hp) };
      const drops = rollDrops(SPECIES[w.species_id].rarity);
      push(`Coletou ${drops.apricorns} Bolota(s)${drops.shards ? ` e ${drops.shards} Fragmento(s)` : ''}!`);
      return { log, result: 'caught', capture, drops };
    }
    push(`Ah não! ${wname} escapou da ${ball.name}!`, 'escape');
  } else if (type === 'run') {
    if (Math.random() < 0.7) {
      push('Você fugiu com segurança!');
      return { log, result: 'fled', capture };
    }
    push('Não conseguiu fugir!');
  }

  // Turno do selvagem: usa o golpe do seu tipo com mais frequência se for super efetivo contra você
  const strongEff = effectiveness(wTypes[0], myTypes);
  const kind = Math.random() < (strongEff > 1 ? 0.7 : strongEff < 1 ? 0.1 : 0.25) ? 'strong' : 'attack';
  const mv = getMove(kind, wTypes);
  if (Math.random() > mv.acc) push(`${wname} usou ${mv.name}, mas errou!`);
  else {
    const h = calcHit(w.level, mv, w.attack, my.defense, wTypes, myTypes);
    my.current_hp = Math.max(0, my.current_hp - h.dmg);
    push(`${wname} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${h.dmg})`, null, { eff: h.eff });
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

module.exports = {
  rand, pickSpecies, makeWild, resolveTurn, mineView, wildView, nameOf,
  getMove, calcHit, effText, catchChance, rollDrops, gainExp,
};
