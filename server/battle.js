const { SPECIES, RARITY, MOVE_NAMES, WILD_TABLE, LEGEND_MOVES, POWER_CD, MAX_LEVEL, expToNext, calcStats, evolveTarget, effectiveness } = require('../public/species.js');
const { BALLS } = require('../public/items.js');

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// ---------- EXP ----------
const XP_RATE = 1.3; // multiplicador geral de EXP
const SHARE = 0.35; // fração que os membros da equipe que NÃO lutaram recebem (EXP compartilhado)
// Fração do EXP cheio por resultado: toda batalha dá EXP, mas a vitória rende mais
const EXP_MULT = { win: 1, caught: 0.8, lose: 0.3, fled: 0.12 };

const mineView = (p) => ({
  id: p.id, species_id: p.species_id, nickname: p.nickname, level: p.level,
  hp: p.current_hp, maxHp: p.hp, exp: p.current_exp, expMax: expToNext(p.level),
  pw: LEGEND_MOVES[p.species_id] ? { name: LEGEND_MOVES[p.species_id].name, type: LEGEND_MOVES[p.species_id].type, cd: p.cd || 0 } : null, // Poder Lendário (só lendários)
});
const teamView = (b) => b.team.map(mineView);
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
function getMove(kind, types, species) {
  if (kind === 'power' && LEGEND_MOVES[species]) { const lm = LEGEND_MOVES[species]; return { name: '✦ ' + lm.name, type: lm.type, power: lm.power, acc: 0.9, legend: true }; }
  if (kind === 'strong') return { name: MOVE_NAMES[types[0]], type: types[0], power: 70, acc: 0.85 };
  return { name: 'Investida', type: 'normal', power: 40, acc: 1 };
}

// Dano = base × aleatório × STAB × efetividade × crítico.
// Super efetivo aumenta MUITO a chance de crítico (30%); resistido quase zera (3%); normal 1/16.
function calcHit(level, mv, atk, def, atkTypes, defTypes) {
  let eff = effectiveness(mv.type, defTypes);
  if (mv.legend && eff < 1) eff = 1; // Poder Lendário ignora resistência e imunidade
  if (eff === 0) return { dmg: 0, eff, crit: false };
  const stab = atkTypes.includes(mv.type) ? 1.5 : 1;
  const crit = Math.random() < Math.max(mv.legend ? 0.25 : 0, eff > 1 ? 0.3 : eff < 1 ? 0.03 : 1 / 16);
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

// Recalcula stats ao subir de nível/evoluir, preservando o HP já perdido (quem desmaiou continua desmaiado)
function applyStats(p) {
  const st = calcStats(p.species_id, p.level);
  if (p.current_hp > 0) p.current_hp += st.hp - p.hp;
  Object.assign(p, { hp: st.hp, attack: st.attack, defense: st.defense });
}

// Dá EXP, sobe níveis e evolui. Callbacks opcionais para narrar cada evento.
function gainExp(mon, exp, { onLevel, onEvolve } = {}) {
  if (mon.level >= MAX_LEVEL) return;
  mon.current_exp += exp;
  while (mon.current_exp >= expToNext(mon.level) && mon.level < MAX_LEVEL) {
    mon.current_exp -= expToNext(mon.level);
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
  if (mon.level >= MAX_LEVEL) mon.current_exp = 0;
}

// EXP de derrotar um inimigo: cresce com o nível dele e com a raridade, e é maior quando ele é mais forte que você
// (e menor quando você já é muito mais forte: treinar em inimigos fracos rende pouco).
function expValue(foeSpecies, foeLevel, mon) {
  const sp = SPECIES[foeSpecies];
  const ratio = Math.max(0.3, Math.min(2.5, foeLevel / mon.level));
  return Math.max(1, Math.floor(((sp.exp * foeLevel) / 5) * RARITY[sp.rarity].expMul * ratio * XP_RATE));
}

/**
 * Distribui EXP pela equipe. `fighterIds` (quem lutou) recebe o valor cheio; os demais, SHARE dele.
 * `baseOf(mon)` = EXP cheio para aquele Pokémon. `hooks(mon)` pode devolver { onGain, onLevel, onEvolve }.
 * Retorna [{ mon, amount, fromLevel, toLevel, evolved: [{from, to}], fighter }]
 */
function awardExp(team, fighterIds, baseOf, { hooks, onlyFighters = false } = {}) {
  const out = [];
  for (const mon of team) {
    const fighter = fighterIds.has(mon.id);
    if (onlyFighters && !fighter) continue;
    const amount = Math.max(1, Math.floor(baseOf(mon) * (fighter ? 1 : SHARE)));
    const hk = hooks?.(mon);
    const rec = { mon, amount, fromLevel: mon.level, toLevel: mon.level, evolved: [], fighter };
    hk?.onGain?.(amount);
    gainExp(mon, amount, {
      onLevel: (lvl) => { rec.toLevel = lvl; hk?.onLevel?.(lvl); },
      onEvolve: (from, to) => { rec.evolved.push({ from, to }); hk?.onEvolve?.(from, to); },
    });
    out.push(rec);
  }
  return out;
}

/**
 * Resolve um turno (ação do jogador + resposta do selvagem), mutando o estado `b`:
 * b = { team: [rows Pokemon], mine, wild, inv, participants }
 * Retorna { log, result: null|'win'|'lose'|'caught'|'fled', capture, drops }
 */
function resolveTurn(b, type) {
  const log = [];
  const w = b.wild;
  const wname = SPECIES[w.species_id].name;
  const wTypes = SPECIES[w.species_id].types;
  const push = (msg, fx, extra) => log.push({ msg, wildHp: w.hp, mine: mineView(b.mine), fx, ...extra });
  b.participants ||= new Set(); // quem já lutou nesta batalha (recebe EXP cheio)
  b.participants.add(b.mine.id);
  let result = null;
  let capture = null;
  let my = b.mine;
  let myTypes = SPECIES[my.species_id].types;

  // Trocar de Pokémon. Voluntário = gasta o turno (o selvagem ataca quem entra); depois de um desmaio = grátis.
  if (b.forceSwitch && !type.startsWith('switch:')) {
    return { log: [{ msg: 'Escolha o próximo Pokémon!', wildHp: w.hp, mine: mineView(my) }], result: null, capture };
  }
  if (type.startsWith('switch:')) {
    const target = b.team.find((p) => p.id === Number(type.slice(7)));
    if (!target || target.current_hp <= 0 || target === b.mine) {
      return { log: [{ msg: 'Não dá para trocar para esse Pokémon.', wildHp: w.hp, mine: mineView(my) }], result: null, capture };
    }
    const forced = !!b.forceSwitch;
    b.forceSwitch = false;
    if (!forced) push(`Volte, ${nameOf(my)}!`);
    b.mine = my = target;
    myTypes = SPECIES[my.species_id].types;
    b.participants.add(target.id);
    push(`Vai, ${nameOf(target)}!`, 'switch');
    if (forced) return { log, result: null, capture };
  }

  // Toda batalha rende EXP. Vitória/captura: equipe inteira (quem lutou = cheio, os demais = compartilhado).
  // Derrota/fuga: só quem lutou, e menos, proporcional ao estrago que causou no inimigo.
  const giveExp = (res) => {
    const dealt = 1 - w.hp / w.maxHp;
    const fightOnly = res === 'lose' || res === 'fled';
    const scale = EXP_MULT[res] * (fightOnly ? 0.4 + 0.6 * dealt : 1);
    const why = { win: '', caught: '', lose: ' pela luta', fled: ' pela experiência' }[res];
    const results = awardExp(
      b.team, b.participants, (p) => expValue(w.species_id, w.level, p) * scale,
      {
        onlyFighters: fightOnly,
        hooks: (p) => (p === b.mine ? {
          onGain: (n) => push(`${nameOf(p)} ganhou ${n} EXP${why}.`),
          onLevel: (lvl) => push(`${nameOf(p)} subiu para o nível ${lvl}!`),
          onEvolve: (from, to) => push(`${from} evoluiu para ${SPECIES[to].name}!`, 'evolve'),
        } : undefined),
      },
    );
    const others = results.filter((r) => r.mon !== b.mine);
    if (others.length) {
      push(`Equipe: ${others.map((r) => `${nameOf(r.mon)} +${r.amount}${r.toLevel > r.fromLevel ? ` (Lv.${r.fromLevel}→${r.toLevel})` : ''}`).join(', ')}`);
      others.forEach((r) => r.evolved.forEach((e) => push(`${e.from} evoluiu para ${SPECIES[e.to].name}!`)));
    }
  };

  // Poder Lendário: só lendários, com recarga de POWER_CD turnos (a recarga anda a cada turno que o Pokémon age)
  if (type === 'power' && (!LEGEND_MOVES[my.species_id] || my.cd > 0)) {
    return { log: [{ msg: LEGEND_MOVES[my.species_id] ? 'O Poder Lendário ainda está recarregando!' : 'Esse Pokémon não tem Poder Lendário.', wildHp: w.hp, mine: mineView(my) }], result: null, capture };
  }
  if (!type.startsWith('switch:')) { if (type === 'power') my.cd = POWER_CD; else if (my.cd > 0) my.cd--; }

  if (type === 'attack' || type === 'strong' || type === 'power') {
    const mv = getMove(type, myTypes, my.species_id);
    if (Math.random() > mv.acc) push(`${nameOf(my)} usou ${mv.name}, mas errou!`);
    else {
      const h = calcHit(my.level, mv, my.attack, w.defense, myTypes, wTypes);
      w.hp = Math.max(0, w.hp - h.dmg);
      push(`${nameOf(my)} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${h.dmg})`, null, { eff: h.eff, atk: { type: mv.type, by: 'me', power: !!mv.legend } });
    }
    if (w.hp <= 0) {
      push(`${wname} selvagem foi derrotado!`);
      giveExp('win');
      const drops = rollDrops(SPECIES[w.species_id].rarity);
      push(`Coletou ${drops.apricorns} Bolota(s)${drops.shards ? ` e ${drops.shards} Fragmento(s)` : ''}!`);
      return { log, result: 'win', capture, drops };
    }
  } else if (type.startsWith('ball:')) {
    const kind = type.slice(5);
    if (b.noCatch) return { log: [{ msg: 'Não dá para capturar o Pokémon de um chefe de cenário!', wildHp: w.hp, mine: mineView(my) }], result: null, capture }; // Modo História
    const ball = BALLS[kind];
    if (!ball || !(b.inv[kind] > 0)) return { log: [{ msg: 'Você não tem essa Pokébola!', wildHp: w.hp, mine: mineView(my) }], result: null, capture };
    b.inv[kind]--;
    push(`Você lançou uma ${ball.name}!`, 'ball', { kind });
    if (Math.random() < catchChance(w.species_id, w.hp, w.maxHp, ball)) {
      push(`Gotcha! ${wname} foi capturado!`, 'caught');
      const st = calcStats(w.species_id, w.level);
      capture = { species_id: w.species_id, level: w.level, hp: st.hp, attack: st.attack, defense: st.defense, current_hp: Math.max(1, w.hp) };
      giveExp('caught');
      const drops = rollDrops(SPECIES[w.species_id].rarity);
      push(`Coletou ${drops.apricorns} Bolota(s)${drops.shards ? ` e ${drops.shards} Fragmento(s)` : ''}!`);
      return { log, result: 'caught', capture, drops };
    }
    push(`Ah não! ${wname} escapou da ${ball.name}!`, 'escape');
  } else if (type === 'run') {
    if (Math.random() < 0.7) {
      push('Você fugiu com segurança!');
      giveExp('fled');
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
    push(`${wname} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${h.dmg})`, null, { eff: h.eff, atk: { type: mv.type, by: 'foe' } });
  }
  if (my.current_hp <= 0) {
    push(`${nameOf(my)} desmaiou!`);
    const alive = b.team.filter((p) => p.current_hp > 0);
    if (alive.length === 1) { // só resta um: entra sozinho
      b.mine = alive[0];
      b.participants.add(alive[0].id);
      push(`Vai, ${nameOf(alive[0])}!`, 'switch');
    } else if (alive.length > 1) { // você escolhe quem entra (sem custo de turno)
      b.forceSwitch = true;
      push('Escolha o próximo Pokémon!');
    } else {
      push('Você não tem mais Pokémon! Levado ao Centro Pokémon…');
      giveExp('lose'); // perder também ensina: quem lutou ganha um pouco de EXP
      result = 'lose';
    }
  }
  return { log, result, capture };
}

module.exports = {
  rand, pickSpecies, makeWild, resolveTurn, mineView, wildView, nameOf,
  teamView, getMove, calcHit, effText, catchChance, rollDrops, gainExp, awardExp, expValue, XP_RATE, SHARE,
};
