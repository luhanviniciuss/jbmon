// Chefe de Mundo cooperativo: um boss gigante aparece na praça da Cidade e TODOS os jogadores da Cidade podem lutar ao mesmo tempo.
// A vida do boss é uma só, no servidor. Cada jogador ataca em tempo real (com tempo de recarga por golpe) e o boss revida
// em jogadores aleatórios. Ao derrotá-lo, quem estava EM COMBATE recebe prêmios pela contribuição (dano):
// no máximo 5 Master Balls por rodada, uma para cada um dos 5 que mais causaram dano.
const { SPECIES, RARITY, LEGEND_MOVES, calcStats } = require('../public/species.js');
const { rand, mineView, nameOf, getMove, calcHit, effText, awardExp, XP_RATE } = require('./battle.js');
const { loadTeam } = require('./team.js');

const FAST = process.env.EVENT_FAST === '1'; // só para testes automáticos
const LIFE_MS = FAST ? 120000 : 15 * 60000; // tempo para derrotá-lo antes que ele fuja
const LEVEL = 1000; // o nível máximo do jogo: um desafio para os mais fortes
const HP_PER_PLAYER = 4; // cada jogador que entra soma 4x a vida base do boss (a luta escala com a multidão)
const DEF_CAP = 400; // defesa limitada: com defesa de nível 1000 quase ninguém conseguiria machucá-lo
const START_PLAYERS = 3; // vida inicial equivale a esta quantidade de jogadores
const TICK_MS = 500;
const BOSS_HIT_MS = 2500; // o boss ataca a cada 2,5 s
const DMG_MULT = 0.5;
const MAX_HIT_FRAC = 0.4; // um golpe nunca tira mais que 40% da vida máxima do Pokémon (ninguém cai de uma vez só)
const CD = { attack: 1200, strong: 3000, power: 8000, switch: 1500 }; // recarga de cada ação (ms)
const TOUCH_R = 120; // encostar no boss para entrar na luta
const MAX_MASTER = 5; // Master Balls por rodada (do 1º ao 5º em dano)
const POS = { x: 50.5 * 32, y: 48.5 * 32 }; // praça da Cidade, ao norte da fonte
const BOSSES = [
  { id: 143, title: 'Snorlax Gigante' }, { id: 150, title: 'Mewtwo Sombra' },
  { id: 384, title: 'Rayquaza Ancestral' }, { id: 249, title: 'Lugia Abissal' },
];

module.exports = function createWorldBoss({ io, prisma, socketByUser, meByUser, durable, isBusy, setBusy, buddyRefresh }) {
  let wb = null;
  const joining = new Set();
  const emit = (uid, ev, d) => socketByUser.get(uid)?.emit(ev, d);
  const inTown = (uid) => meByUser.get(uid)?.world === 'town';

  const mapView = () => (wb ? { world: 'town', species_id: wb.species_id, title: wb.title, level: LEVEL, x: POS.x, y: POS.y, hp: wb.hp, maxHp: wb.maxHp, left: Math.max(0, wb.expiresAt - Date.now()), players: wb.parts.size } : null);
  let lastMapAt = 0;
  const pushMap = (force) => { if (!force && Date.now() - lastMapAt < 1500) return; lastMapAt = Date.now(); io.emit('wboss:map', mapView()); };

  const status = () => (wb ? { id: wb.id, type: 'worldboss', name: wb.title, icon: '🐉', phase: 'running', hpPct: Math.round((wb.hp / wb.maxHp) * 100), players: wb.parts.size, left: Math.max(0, wb.expiresAt - Date.now()) } : null);

  const rank = () => [...wb.parts.values()].sort((a, b) => b.dmg - a.dmg);
  const log = (msg) => { wb.log.push(msg); if (wb.log.length > 6) wb.log.shift(); };

  function stateFor(p) {
    const now = Date.now();
    const rem = (k) => Math.max(0, (p.cds[k] || 0) - now);
    return {
      hp: wb.hp, maxHp: wb.maxHp, left: Math.max(0, wb.expiresAt - now), players: wb.parts.size,
      top: rank().slice(0, 6).map((r) => ({ name: r.name, dmg: r.dmg, out: r.eliminated })),
      log: wb.log.slice(),
      you: { mine: mineView(p.mine), team: p.team.map(mineView), dmg: p.dmg, eliminated: p.eliminated, cds: { attack: rem('attack'), strong: rem('strong'), power: rem('power'), switch: rem('switch') } },
    };
  }
  const broadcast = () => { for (const p of wb.parts.values()) emit(p.uid, 'wboss:state', stateFor(p)); };

  function saveTeam(p) {
    const team = p.team.map((m) => ({ id: m.id, species_id: m.species_id, level: m.level, hp: m.hp, attack: m.attack, defense: m.defense, current_exp: m.current_exp, current_hp: m.current_hp }));
    return durable('wboss-equipe', () => prisma.$transaction(team.map(({ id, ...data }) => prisma.pokemon.update({ where: { id }, data }))));
  }

  // ---------------------------------------------------------------- entrar / sair / agir
  async function join(uid) {
    if (!wb || wb.done || wb.parts.has(uid) || joining.has(uid)) return;
    const me = meByUser.get(uid);
    if (!me || me.world !== 'town' || me.hidden) return;
    if (isBusy(uid)) return;
    joining.add(uid);
    try {
      const team = await loadTeam(prisma, uid);
      const mine = team.find((m) => m.current_hp > 0);
      if (!mine) return emit(uid, 'notice', { msg: 'Seu time está sem forças: cure no Centro Pokémon antes de enfrentar o Chefe de Mundo.' });
      if (!wb || wb.done || isBusy(uid) || !meByUser.get(uid)) return;
      const p = { uid, name: me.username, team, mine, fighters: new Set([mine.id]), dmg: 0, eliminated: false, cds: {} };
      wb.parts.set(uid, p);
      setBusy(uid, true);
      const add = wb.stats.hp * HP_PER_PLAYER; // mais gente na luta = boss mais resistente
      wb.maxHp += add;
      wb.hp += add;
      log(`⚔ ${p.name} entrou na luta!`);
      emit(uid, 'wboss:joined', { title: wb.title, species_id: wb.species_id, level: LEVEL });
      emit(uid, 'wboss:state', stateFor(p));
      pushMap(true);
    } finally { joining.delete(uid); }
  }

  function leave(uid, silent) {
    const p = wb?.parts.get(uid);
    if (!p) return;
    wb.parts.delete(uid);
    setBusy(uid, false);
    saveTeam(p).then(() => buddyRefresh?.(uid));
    if (!silent) emit(uid, 'wboss:left', {});
    log(`${p.name} deixou a luta.`);
  }

  function act(uid, type) {
    const p = wb?.parts.get(uid);
    if (!p || wb.done || p.eliminated || typeof type !== 'string') return;
    const now = Date.now();
    if (type.startsWith('switch:')) {
      if ((p.cds.switch || 0) > now) return;
      const target = p.team.find((m) => m.id === Number(type.slice(7)));
      if (!target || target.current_hp <= 0 || target === p.mine) return;
      p.mine = target;
      p.fighters.add(target.id);
      p.cds.switch = now + CD.switch;
      return emit(uid, 'wboss:state', stateFor(p));
    }
    if (!CD[type] || type === 'switch') return;
    if ((p.cds[type] || 0) > now) return;
    if (type === 'power' && !LEGEND_MOVES[p.mine.species_id]) return;
    p.cds[type] = now + CD[type];
    const my = p.mine, myTypes = SPECIES[my.species_id].types, bTypes = SPECIES[wb.species_id].types;
    const mv = getMove(type, myTypes, my.species_id);
    if (Math.random() > mv.acc) {
      emit(uid, 'wboss:hit', { kind: type, miss: true });
      log(`${p.name}: ${nameOf(my)} usou ${mv.name}, mas errou!`);
    } else {
      const h = calcHit(my.level, mv, my.attack, wb.stats.defense, myTypes, bTypes);
      const dealt = Math.min(h.dmg, wb.hp);
      wb.hp -= dealt;
      p.dmg += dealt;
      emit(uid, 'wboss:hit', { kind: type, dmg: dealt, crit: h.crit, eff: h.eff, type: mv.type, power: !!mv.legend });
      log(`${p.name}: ${nameOf(my)} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Crítico!' : ''} (-${dealt})`);
    }
    emit(uid, 'wboss:state', stateFor(p));
    if (wb.hp <= 0) victory();
  }

  // ---------------------------------------------------------------- o boss revida
  function hitPlayer(p, kind, mult) {
    const bTypes = SPECIES[wb.species_id].types, my = p.mine, myTypes = SPECIES[my.species_id].types;
    const bmv = getMove(kind, bTypes, wb.species_id);
    if (Math.random() > bmv.acc) return log(`${wb.title} usou ${bmv.name} em ${p.name}, mas errou!`);
    const h = calcHit(wb.level, bmv, wb.stats.attack, my.defense, bTypes, myTypes);
    const dmg = h.dmg === 0 ? 0 : Math.max(1, Math.min(Math.floor(h.dmg * DMG_MULT * mult), Math.ceil(my.hp * MAX_HIT_FRAC)));
    my.current_hp = Math.max(0, my.current_hp - dmg);
    log(`${wb.title} usou ${bmv.name} em ${p.name}!${effText(h.eff)} (-${dmg})`);
    emit(p.uid, 'wboss:hurt', { dmg, power: !!bmv.legend });
    if (my.current_hp > 0) return;
    const next = p.team.find((m) => m.current_hp > 0);
    if (next) { p.mine = next; p.fighters.add(next.id); log(`${p.name}: ${nameOf(my)} desmaiou! Entrou ${nameOf(next)}.`); }
    else { p.eliminated = true; log(`${p.name} ficou sem Pokémon em condições de lutar!`); saveTeam(p); }
  }

  function bossTurn() {
    const alive = [...wb.parts.values()].filter((p) => !p.eliminated);
    if (!alive.length) return;
    wb.turns++;
    if (LEGEND_MOVES[wb.species_id] && wb.turns % 4 === 0) { // o Poder Lendário do boss atinge todo mundo (com dano reduzido)
      log(`✦ ${wb.title} liberou seu poder sobre todos!`);
      alive.forEach((p) => hitPlayer(p, 'power', 0.6));
      return;
    }
    const n = Math.min(alive.length, 1 + Math.floor(alive.length / 3));
    for (let i = 0; i < n; i++) {
      const p = alive.splice(rand(0, alive.length - 1), 1)[0];
      hitPlayer(p, Math.random() < 0.4 ? 'strong' : 'attack', 1);
    }
  }

  // ---------------------------------------------------------------- fim
  async function victory() {
    const w = wb;
    if (!w || w.done) return;
    w.done = true;
    clearInterval(w.tick); clearInterval(w.hitT);
    // Recompensa só para quem estava EM COMBATE quando o boss caiu (ainda na luta, mesmo com o time caído) e causou dano
    const ranked = rank().filter((p) => p.dmg > 0);
    const total = ranked.reduce((s, p) => s + p.dmg, 0) || 1;
    const sp = SPECIES[w.species_id];
    const prizes = new Map();
    ranked.forEach((p, i) => {
      const share = p.dmg / total;
      prizes.set(p.uid, { ...(i < MAX_MASTER ? { masterballs: 1 } : {}), ultraballs: 1 + Math.round(share * 6), apricorns: 8 + Math.round(share * 20), shards: 3 + Math.round(share * 12) });
    });
    const top = ranked.slice(0, 10).map((p) => ({ name: p.name, dmg: p.dmg, master: prizes.get(p.uid).masterballs || 0 }));
    await Promise.all([...w.parts.values()].map(async (p) => {
      const prize = prizes.get(p.uid) || null;
      const share = prize ? p.dmg / total : 0;
      let exp = null;
      if (prize) {
        const base = (m) => Math.max(1, Math.floor(((sp.exp * LEVEL) / 5) * RARITY[sp.rarity].expMul * Math.max(0.3, Math.min(2.5, LEVEL / m.level)) * XP_RATE * (0.3 + share * 1.7)));
        const res = awardExp(p.team, p.fighters, base);
        const main = res.find((x) => x.mon === p.mine) || res[0];
        exp = main ? { name: nameOf(main.mon), amount: main.amount, toLevel: main.toLevel > main.fromLevel ? main.toLevel : null } : null;
      }
      const team = p.team.map((m) => ({ id: m.id, species_id: m.species_id, level: m.level, hp: m.hp, attack: m.attack, defense: m.defense, current_exp: m.current_exp, current_hp: m.current_hp }));
      const inc = {};
      if (prize) for (const [k, n] of Object.entries(prize)) inc[k] = { increment: n };
      const res = await durable('wboss-premio', () => prisma.$transaction([...team.map(({ id, ...data }) => prisma.pokemon.update({ where: { id }, data })), ...(prize ? [prisma.user.update({ where: { id: p.uid }, data: inc })] : [])]));
      const u = prize && Array.isArray(res) ? res[res.length - 1] : null;
      if (u) emit(p.uid, 'inventory', { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });
      const idx = ranked.indexOf(p);
      emit(p.uid, 'wboss:end', { result: 'won', title: w.title, top, you: { rank: idx >= 0 ? idx + 1 : null, of: ranked.length, dmg: p.dmg, prize, exp } });
      setBusy(p.uid, false);
      buddyRefresh?.(p.uid);
    }));
    io.emit('notice', { msg: `🏆 ${w.title} foi derrotado!${ranked[0] ? ` Maior dano: ${ranked[0].name} (${ranked[0].dmg}).` : ''} ${Math.min(MAX_MASTER, ranked.length)} Master Ball(s) entregue(s)!`, big: true });
    durable('evento-log', () => prisma.eventLog.create({ data: { type: 'worldboss', players: ranked.length, winner: ranked[0]?.name || '', data: JSON.stringify({ by: w.by, boss: w.title, top }).slice(0, 2000) } }));
    wb = null;
    io.emit('wboss:map', null);
  }

  async function endWithout(result) { // fugiu (tempo esgotado) ou cancelado
    const w = wb;
    if (!w || w.done) return;
    w.done = true;
    clearInterval(w.tick); clearInterval(w.hitT);
    await Promise.all([...w.parts.values()].map(async (p) => {
      await saveTeam(p);
      emit(p.uid, 'wboss:end', { result, title: w.title, top: [], you: null });
      setBusy(p.uid, false);
      buddyRefresh?.(p.uid);
    }));
    io.emit('notice', { msg: result === 'fled' ? `${w.title} fugiu… ninguém conseguiu derrotá-lo a tempo.` : `${w.title} foi cancelado.`, big: true });
    wb = null;
    io.emit('wboss:map', null);
  }

  // ---------------------------------------------------------------- ciclo de vida
  function start({ by = 'auto', species } = {}) {
    if (wb) return { error: 'Já existe um Chefe de Mundo em andamento' };
    const def = BOSSES.find((b) => b.id === species) || BOSSES[rand(0, BOSSES.length - 1)];
    const stats = calcStats(def.id, LEVEL);
    stats.defense = Math.min(stats.defense, DEF_CAP);
    const e = { id: Date.now(), by, species_id: def.id, title: def.title, level: LEVEL, stats, maxHp: stats.hp * HP_PER_PLAYER * START_PLAYERS, hp: 0, expiresAt: Date.now() + LIFE_MS, parts: new Map(), log: [], turns: 0, done: false };
    e.hp = e.maxHp;
    wb = e;
    e.tick = setInterval(() => {
      if (wb !== e || e.done) return;
      if (Date.now() >= e.expiresAt) return endWithout('fled');
      if (e.parts.size) broadcast();
      pushMap(false);
    }, TICK_MS);
    e.hitT = setInterval(() => { if (wb === e && !e.done) bossTurn(); }, BOSS_HIT_MS);
    io.emit('notice', { msg: `🐉 ${def.title} (Lv.${LEVEL}) apareceu na Praça da Cidade! Todos juntos: encoste nele para lutar! Até ${MAX_MASTER} Master Balls para os que mais causarem dano!`, big: true });
    pushMap(true);
    return { ok: true };
  }
  const cancel = () => (wb ? (endWithout('cancel'), { ok: true }) : { error: 'Não há Chefe de Mundo em andamento' });

  // encostar no boss entra na luta
  function onMove(uid) {
    if (!wb || wb.done || wb.parts.has(uid)) return;
    const me = meByUser.get(uid);
    if (me && me.world === 'town' && Math.hypot(me.x - POS.x, me.y - POS.y) < TOUCH_R) join(uid);
  }

  function bind(socket, uid) {
    socket.emit('wboss:map', mapView());
    socket.on('wboss:join', () => { const me = meByUser.get(uid); if (wb && me && Math.hypot(me.x - POS.x, me.y - POS.y) < 700) join(uid); });
    socket.on('wboss:leave', () => leave(uid));
    socket.on('wboss:act', (t) => act(uid, t));
  }

  return { start, cancel, status, bind, onMove, onDisconnect: (uid) => leave(uid, true), inFight: (uid) => !!wb?.parts.has(uid) || joining.has(uid), BOSSES };
};
