// Grupos e Boss lendário cooperativo (a cada 3 h).
// Fluxo: boss aparece no mapa -> jogadores formam grupo (2-4) -> encostam no boss -> raid por turnos:
//   Fase 1 (luta): cada membro age na sua vez; o boss revida no atacante. Ao chegar em 15% de HP ele fica exausto.
//   Fase 2 (captura): o boss segue com vida; cada membro tem UMA rodada para lançar uma Pokébola.
const { SPECIES, RARITY, BOSS_TABLE, calcStats, effectiveness } = require('../public/species.js');
const { BALLS } = require('../public/items.js');
const { durable } = require('./durable.js');
const { loadTeam, nextFreeSlot } = require('./team.js');
const { rand, pickSpecies, mineView, nameOf, getMove, calcHit, effText, catchChance, awardExp, XP_RATE } = require('./battle.js');

const envNum = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
const CFG = {
  interval: envNum('BOSS_INTERVAL_MIN', 180) * 60000, // a cada 3 horas
  first: envNum('BOSS_FIRST_DELAY_MIN', 2) * 60000, // primeiro boss logo após ligar o servidor
  life: envNum('BOSS_LIFETIME_MIN', 30) * 60000, // quanto tempo espera por desafiantes
};
const BOSS_LEVEL = 100; // todo lendário é nível 100 (o máximo): é preciso treinar bastante antes
const MAX_GROUP = 4;
const TURN_MS = 25000;
const EXHAUST = 0.15; // o boss fica com 15% de HP na fase de captura
const HP_MULT = 4;
const DMG_MULT = 0.7;
const CATCH_BONUS = 3; // bônus de captura do boss exausto
const TOUCH_R = 64; // px para encostar no boss
const NEAR_R = 640; // membros precisam estar a esta distância do boss

module.exports = function createRaidSystem(ctx) {
  const { io, prisma, MAP, clearing, socketByUser, meByUser, isBusy, setBusy, teleportHome } = ctx;
  const bossName = (id) => SPECIES[id].name;
  const notice = (uid, msg) => socketByUser.get(uid)?.emit('notice', { msg });
  const invOf = (u) => ({ poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });

  // ================= Grupos =================
  const groups = new Map(); // gid -> { id, leader, members:[uid] }
  const groupOf = new Map(); // uid -> gid
  const invites = new Map(); // uid -> { gid, from, exp }
  let nextGid = 1;

  const groupView = (g) => ({ id: g.id, leader: g.leader, members: g.members.map((id) => ({ id, username: meByUser.get(id)?.username || '?' })) });
  const emitGroup = (g) => g.members.forEach((id) => socketByUser.get(id)?.emit('group:update', groupView(g)));

  function leaveGroup(uid) {
    const gid = groupOf.get(uid);
    if (!gid) return;
    const g = groups.get(gid);
    groupOf.delete(uid);
    socketByUser.get(uid)?.emit('group:update', null);
    g.members = g.members.filter((x) => x !== uid);
    if (g.members.length < 2) { // grupo de 1 pessoa não faz sentido: desfaz
      g.members.forEach((m) => { groupOf.delete(m); socketByUser.get(m)?.emit('group:update', null); notice(m, 'O grupo foi desfeito'); });
      groups.delete(gid);
    } else {
      if (g.leader === uid) g.leader = g.members[0];
      emitGroup(g);
    }
  }

  function invite(uid, username) {
    const me = meByUser.get(uid);
    const target = [...meByUser.values()].find((m) => m.username.toLowerCase() === String(username || '').trim().toLowerCase());
    if (!target) return notice(uid, 'Jogador não encontrado (ele precisa estar online)');
    if (target.id === uid) return notice(uid, 'Você não pode convidar a si mesmo');
    if (groupOf.has(target.id)) return notice(uid, `${target.username} já está em um grupo`);
    let g = groups.get(groupOf.get(uid));
    if (g && g.leader !== uid) return notice(uid, 'Só o líder do grupo pode convidar');
    if (g && g.members.length >= MAX_GROUP) return notice(uid, `O grupo já tem ${MAX_GROUP} membros`);
    if (!g) {
      g = { id: nextGid++, leader: uid, members: [uid] };
      groups.set(g.id, g);
      groupOf.set(uid, g.id);
      emitGroup(g);
    }
    invites.set(target.id, { gid: g.id, from: me.username, exp: Date.now() + 60000 });
    socketByUser.get(target.id)?.emit('group:invited', { from: me.username });
    notice(uid, `Convite enviado para ${target.username}`);
  }

  function accept(uid) {
    const inv = invites.get(uid);
    invites.delete(uid);
    const g = inv && groups.get(inv.gid);
    if (!inv || inv.exp < Date.now() || !g) return notice(uid, 'Convite expirado');
    if (groupOf.has(uid)) return notice(uid, 'Saia do grupo atual primeiro');
    if (g.members.length >= MAX_GROUP) return notice(uid, 'O grupo está cheio');
    g.members.push(uid);
    groupOf.set(uid, g.id);
    emitGroup(g);
    g.members.forEach((m) => m !== uid && notice(m, `${meByUser.get(uid)?.username} entrou no grupo`));
  }

  // ================= Boss no mundo =================
  let boss = null; // { species_id, tx, ty, x, y, expiresAt, busy }
  let nextAt = null;
  const bossPublic = () => (boss && !boss.busy ? { species_id: boss.species_id, x: boss.x, y: boss.y, left: Math.max(0, boss.expiresAt - Date.now()) } : null);
  const emitBoss = (target = io) => target.emit('boss:state', { boss: bossPublic(), nextIn: nextAt ? Math.max(0, nextAt - Date.now()) : null });

  function spawnBoss(forced, lifeMs) { // forced/lifeMs: usados pelo painel admin
    if (boss && (!forced || boss.busy)) return false;
    let tx, ty;
    for (let i = 0; i < 500; i++) {
      tx = rand(4, 95); ty = rand(4, 95);
      const d = Math.hypot(tx - 50, ty - 50), t = MAP[ty][tx];
      if ((t === 0 || t === 4) && d >= 18 && d <= 38 && !clearing(tx, ty)) break;
    }
    const species_id = forced || pickSpecies(BOSS_TABLE);
    boss = { species_id, tx, ty, x: tx * 32 + 16, y: ty * 32 + 16, expiresAt: Date.now() + (lifeMs || CFG.life), busy: false };
    io.emit('notice', { msg: `✦ ${bossName(species_id)} lendário (Lv.${BOSS_LEVEL}) apareceu! Treine sua equipe, forme um grupo (G) e enfrente-o!`, big: true });
    emitBoss();
    console.log(`Boss: ${bossName(species_id)} em (${tx},${ty})`);
    return true;
  }

  // A hora do último boss fica no banco: o intervalo de 3 h vale mesmo se o servidor dormir ou reiniciar
  // (no plano gratuito do Render ele dorme sem jogadores; sem isso, todo despertar traria um boss novo).
  async function scheduleBosses() {
    let last = 0;
    try { last = Number((await prisma.meta.findUnique({ where: { key: 'lastBossAt' } }))?.value) || 0; } catch (e) { console.error('Meta indisponível:', e.message); }
    const dueIn = Math.max(CFG.first, last + CFG.interval - Date.now());
    nextAt = Date.now() + dueIn;
    const loop = async () => {
      const spawned = spawnBoss();
      nextAt = Date.now() + CFG.interval;
      emitBoss();
      if (spawned) {
        const value = String(Date.now());
        prisma.meta.upsert({ where: { key: 'lastBossAt' }, update: { value }, create: { key: 'lastBossAt', value } }).catch((e) => console.error('Falha ao salvar agenda do boss:', e.message));
      }
      setTimeout(loop, CFG.interval);
    };
    setTimeout(loop, dueIn);
    console.log(`Próximo boss em ${Math.round(dueIn / 60000)} min`);
    setInterval(() => { // expira se ninguém enfrentou
      if (boss && !boss.busy && Date.now() >= boss.expiresAt) {
        io.emit('notice', { msg: `${bossName(boss.species_id)} foi embora…` });
        boss = null;
        emitBoss();
      }
    }, 5000);
  }
  scheduleBosses();

  // ================= Raid =================
  const raids = new Map(); // uid -> raid
  let nextRid = 1;
  let starting = false;
  const lastHint = new Map();

  const memberView = (m) => ({ id: m.uid, username: m.username, eliminated: m.eliminated, left: m.left, mine: mineView(m.mine) });
  const stateFor = (r, m) => ({
    phase: r.phase,
    boss: { species_id: r.boss.species_id, level: r.level, hp: r.hp, maxHp: r.maxHp },
    turn: r.turn && { uid: r.turn.uid, left: Math.max(0, r.turn.deadline - Date.now()), forced: !!r.members.find((x) => x.uid === r.turn.uid)?.pendingSwitch },
    members: r.members.map(memberView),
    you: { balls: m.inv, mine: mineView(m.mine), team: m.team.map(mineView) },
  });
  const emitState = (r, log) => r.members.forEach((m) => !m.left && socketByUser.get(m.uid)?.emit('raid:update', { log, state: stateFor(r, m) }));

  async function tryStart(uid) {
    const me = meByUser.get(uid);
    if (!boss || boss.busy || starting || !me || raids.has(uid) || isBusy(uid)) return;
    if (Math.hypot(me.x - boss.x, me.y - boss.y) > TOUCH_R) return;
    const hint = (msg) => { if (Date.now() - (lastHint.get(uid) || 0) > 4000) { lastHint.set(uid, Date.now()); notice(uid, msg); } };
    const g = groups.get(groupOf.get(uid));
    if (!g || g.members.length < 2) return hint('Forme um grupo de 2 a 4 jogadores (tecla G) para enfrentar o lendário.');
    const near = g.members.filter((id) => {
      const p = meByUser.get(id);
      return p && Math.hypot(p.x - boss.x, p.y - boss.y) < NEAR_R && !isBusy(id) && !raids.has(id);
    });
    if (near.length < 2) return hint('Reúna pelo menos 2 membros do grupo perto do boss.');

    starting = true;
    boss.busy = true;
    near.forEach((id) => setBusy(id, true));
    try {
      const members = [];
      for (const id of near) {
        const team = await loadTeam(prisma, id);
        const mine = team.find((p) => p.current_hp > 0);
        const user = await prisma.user.findUnique({ where: { id } });
        if (!mine || !meByUser.get(id)) { setBusy(id, false); continue; }
        members.push({ uid: id, username: meByUser.get(id).username, team, mine, fighters: new Set([mine.id]), inv: invOf(user), eliminated: false, left: false, drops: null, persisted: false });
      }
      if (members.length < 2) {
        members.forEach((m) => setBusy(m.uid, false));
        boss.busy = false;
        emitBoss();
        return hint('Membros do grupo precisam ter Pokémon saudáveis.');
      }
      const level = BOSS_LEVEL;
      const avg = Math.round(members.reduce((s, m) => s + m.mine.level, 0) / members.length);
      if (avg < 60) members.forEach((m) => notice(m.uid, `⚠ ${bossName(boss.species_id)} é Lv.${level} e a média do grupo é Lv.${avg}. Vai ser MUITO difícil!`));
      const st = calcStats(boss.species_id, level);
      const r = {
        id: nextRid++, boss, members, level, atk: st.attack, def: st.defense, stats: st,
        maxHp: st.hp * HP_MULT, hp: st.hp * HP_MULT, threshold: Math.ceil(st.hp * HP_MULT * EXHAUST),
        phase: 'fight', busy: false, pendingSaves: [], turn: null, turnIdx: -1, capQueue: [], timer: null, done: false, winner: null,
      };
      members.forEach((m) => raids.set(m.uid, r));
      emitBoss(); // some do mapa enquanto a raid acontece
      members.forEach((m) => socketByUser.get(m.uid)?.emit('raid:start', { state: stateFor(r, m) }));
      const log = [{ msg: `${bossName(boss.species_id)} Lv.${level} bloqueia o caminho! (${members.map((m) => m.username).join(', ')})`, bossHp: r.hp }];
      nextTurn(r, log);
      emitState(r, log);
    } catch (e) {
      console.error('Falha ao iniciar raid', e);
      boss.busy = false;
      near.forEach((id) => setBusy(id, false));
      emitBoss();
    } finally {
      starting = false;
    }
  }

  // Define de quem é a próxima vez (ou encerra)
  function nextTurn(r, log) {
    clearTimeout(r.timer);
    let m = null;
    if (r.phase === 'fight') {
      for (let i = 1; i <= r.members.length; i++) {
        const c = r.members[(r.turnIdx + i) % r.members.length];
        if (!c.left && !c.eliminated) { r.turnIdx = r.members.indexOf(c); m = c; break; }
      }
      if (!m) return finish(r, 'fail', log);
    } else {
      while (r.capQueue.length) {
        const c = r.members.find((x) => x.uid === r.capQueue.shift());
        if (!c || c.left) continue;
        if (Object.values(c.inv).reduce((a, b) => a + b, 0) <= 0) { log.push({ msg: `${c.username} não tem Pokébolas e perde a vez.`, bossHp: r.hp }); continue; }
        m = c;
        break;
      }
      if (!m) return finish(r, 'fled', log);
    }
    r.turn = { uid: m.uid, deadline: Date.now() + TURN_MS };
    r.timer = setTimeout(() => timeout(r, m.uid), TURN_MS + 500);
  }

  function timeout(r, uid) {
    if (r.done || r.turn?.uid !== uid) return;
    const m = r.members.find((x) => x.uid === uid);
    if (r.phase === 'fight') {
      const t = m.pendingSwitch && m.team.find((p) => p.current_hp > 0);
      return act(uid, t ? 'switch:' + t.id : 'attack');
    }
    const log = [{ msg: `${m.username} demorou demais e perdeu a vez!`, bossHp: r.hp }];
    nextTurn(r, log);
    if (!r.done) emitState(r, log);
  }

  function enterCapture(r, push) {
    r.phase = 'capture';
    const b = SPECIES[r.boss.species_id];
    for (const m of r.members) {
      if (m.left) continue;
      // EXP de um lendário Lv.100: enorme para quem está bem abaixo dele (por isso vale treinar e voltar)
      const base = (p) => Math.max(1, Math.floor(((b.exp * r.level) / 5) * RARITY.legendary.expMul * Math.max(0.3, Math.min(2.5, r.level / p.level)) * XP_RATE));
      const res = awardExp(m.team, m.fighters, base);
      const main = res.find((x) => x.mon === m.mine) || res[0];
      const others = res.filter((x) => x !== main && x.toLevel > x.fromLevel).length;
      const evo = main.evolved.length ? ` e evoluiu para ${SPECIES[main.evolved[main.evolved.length - 1].to].name}!` : '';
      m.drops = { apricorns: rand(10, 20), shards: rand(6, 10) };
      push(`${m.username}: ${nameOf(main.mon)} +${main.amount} EXP${main.toLevel > main.fromLevel ? ` (Lv.${main.fromLevel}→${main.toLevel})` : ''}${evo}${others ? ` · ${others} da equipe também subiu${others > 1 ? 'ram' : ''} de nível` : ''}`, main.toLevel > main.fromLevel ? 'levelup' : null);
    }
    r.capQueue = r.members.filter((m) => !m.left).map((m) => m.uid);
    r.pendingSaves = r.members.filter((m) => !m.left).map((m) => saveMember(r, m)); // EXP/evolução e materiais já ficam no banco
  }

  // O boss revida em quem agiu. Se o Pokémon cair: com mais de um restante o jogador ESCOLHE o próximo (pendingSwitch,
  // sem gastar outro turno); com um só, ele entra sozinho; sem nenhum, o jogador é eliminado da luta.
  function bossRetaliates(r, m, push) {
    const uid = m.uid;
    const bName = bossName(r.boss.species_id);
    const bTypes = SPECIES[r.boss.species_id].types;
    const my = m.mine;
    const myTypes = SPECIES[my.species_id].types;
    const strongEff = effectiveness(bTypes[0], myTypes);
    const kind = Math.random() < (strongEff > 1 ? 0.7 : strongEff < 1 ? 0.15 : 0.4) ? 'strong' : 'attack';
    const bmv = getMove(kind, bTypes);
    if (Math.random() > bmv.acc) push(`${bName} usou ${bmv.name}, mas errou!`);
    else {
      const h = calcHit(r.level, bmv, r.atk, my.defense, bTypes, myTypes);
      const dmg = h.dmg === 0 ? 0 : Math.max(1, Math.floor(h.dmg * DMG_MULT));
      my.current_hp = Math.max(0, my.current_hp - dmg);
      push(`${bName} usou ${bmv.name} em ${m.username}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${dmg})`, null, { target: uid, targetMine: mineView(my) });
    }
    if (my.current_hp <= 0) {
      push(`${nameOf(my)} de ${m.username} desmaiou!`, null, { target: uid, targetMine: mineView(my) });
      const alive = m.team.filter((p) => p.current_hp > 0);
      if (alive.length === 1) {
        m.mine = alive[0];
        m.fighters.add(alive[0].id);
        push(`${m.username} enviou ${nameOf(alive[0])}!`, 'switch', { target: uid, targetMine: mineView(alive[0]) });
      } else if (alive.length > 1) {
        m.pendingSwitch = true;
        push(`${m.username} precisa escolher o próximo Pokémon!`);
      } else {
        m.eliminated = true;
        push(`${m.username} não tem mais Pokémon em condições de lutar!`);
      }
    }
  }

  async function act(uid, type) {
    const r = raids.get(uid);
    if (!r || r.done || r.busy || r.turn?.uid !== uid) return;
    const m = r.members.find((x) => x.uid === uid);
    if (type === 'run') return leaveRaid(uid);
    const log = [];
    const push = (msg, fx, extra) => log.push({ msg, bossHp: r.hp, actor: uid, fx, ...extra });
    const bName = bossName(r.boss.species_id);
    const bTypes = SPECIES[r.boss.species_id].types;

    if (r.phase === 'fight') {
      const isSwitch = type.startsWith('switch:');
      if (m.pendingSwitch && !isSwitch) return; // depois de um desmaio só vale escolher o próximo Pokémon
      if (!isSwitch && type !== 'attack' && type !== 'strong') return;
      if (isSwitch) {
        // Troca: voluntária gasta o turno (o boss ataca quem entra); depois de um desmaio é grátis
        const target = m.team.find((p) => p.id === Number(type.slice(7)));
        if (!target || target.current_hp <= 0 || target === m.mine) return notice(uid, 'Não dá para trocar para esse Pokémon.');
        clearTimeout(r.timer);
        const forced = !!m.pendingSwitch;
        m.pendingSwitch = false;
        if (!forced) push(`${m.username} chamou ${nameOf(m.mine)} de volta!`);
        m.mine = target;
        m.fighters.add(target.id);
        push(`${m.username} enviou ${nameOf(target)}!`, 'switch', { target: uid, targetMine: mineView(target) });
        if (!forced) bossRetaliates(r, m, push);
      } else {
        clearTimeout(r.timer);
        const my = m.mine;
        const myTypes = SPECIES[my.species_id].types;
        const mv = getMove(type, myTypes);
        let reached = false;
        let line;
        if (Math.random() > mv.acc) line = `${m.username}: ${nameOf(my)} usou ${mv.name}, mas errou!`;
        else {
          const h = calcHit(my.level, mv, my.attack, r.def, myTypes, bTypes);
          r.hp = Math.max(0, r.hp - h.dmg);
          if (r.hp <= r.threshold) { r.hp = r.threshold; reached = true; }
          line = `${m.username}: ${nameOf(my)} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${h.dmg})`;
        }
        push(line);
        if (reached) {
          push(`${bName} está exausto! Agora é hora de capturá-lo!`, 'exhaust');
          enterCapture(r, push);
        } else {
          bossRetaliates(r, m, push);
        }
      }
    } else {
      const kind = type.startsWith('ball:') ? type.slice(5) : null;
      const ball = BALLS[kind];
      if (!ball) return;
      if (!(m.inv[kind] > 0)) return notice(uid, 'Você não tem essa Pokébola!');
      clearTimeout(r.timer);
      m.inv[kind]--;
      push(`${m.username} lançou uma ${ball.name}!`, 'ball', { kind });
      if (Math.random() < catchChance(r.boss.species_id, r.hp, r.maxHp, ball, CATCH_BONUS)) {
        push(`Gotcha! ${bName} foi capturado por ${m.username}!`, 'caught');
        r.winner = uid;
        return finish(r, 'caught', log);
      }
      push(`${bName} escapou da ${ball.name}!`, 'escape');
    }
    // Grava ANTES de avisar os jogadores do resultado da ação (HP, Pokébolas gastas, EXP e materiais)
    r.busy = true;
    try { await Promise.all([saveMember(r, m), ...r.pendingSaves.splice(0)]); } finally { r.busy = false; }
    if (r.done || r.turn?.uid !== uid) return; // alguém saiu durante a gravação e a vez já avançou
    if (m.pendingSwitch) { // o Pokémon caiu: o mesmo jogador escolhe o próximo, sem passar a vez
      r.turn = { uid, deadline: Date.now() + TURN_MS };
      clearTimeout(r.timer);
      r.timer = setTimeout(() => timeout(r, uid), TURN_MS + 500);
      return emitState(r, log);
    }
    nextTurn(r, log);
    if (!r.done) emitState(r, log);
  }

  // Grava o estado do membro (equipe, bolas; materiais e captura uma única vez). Nunca lança: em caso de
  // falha a operação vai para a fila durável e é reenviada até funcionar.
  async function saveMember(r, m, { final = false, result } = {}) {
    if (final && result === 'fail') m.team.forEach((p) => (p.current_hp = p.hp)); // derrota: equipe curada
    const withDrops = !!m.drops && !m.dropsSaved;
    if (withDrops) m.dropsSaved = true; // marca antes: nunca credita materiais duas vezes, mesmo com nova tentativa
    const withCapture = final && r.winner === m.uid && !m.captureSaved;
    if (withCapture) m.captureSaved = true;
    const drops = m.drops;
    const inv = { ...m.inv };
    const team = m.team.map((p) => ({ id: p.id, species_id: p.species_id, level: p.level, hp: p.hp, attack: p.attack, defense: p.defense, current_exp: p.current_exp, current_hp: p.current_hp }));
    await durable('raid', async () => {
      const slot = withCapture ? await nextFreeSlot(prisma, m.uid) : null; // vaga na equipe ou box
      return prisma.$transaction([
      ...team.map(({ id, ...data }) => prisma.pokemon.update({ where: { id }, data })),
      prisma.user.update({
        where: { id: m.uid },
        data: {
          pokeballs: inv.poke, greatballs: inv.great, ultraballs: inv.ultra, masterballs: inv.master,
          ...(withDrops ? { apricorns: { increment: drops.apricorns }, shards: { increment: drops.shards } } : {}),
        },
      }),
      ...(withCapture ? [prisma.pokemon.create({ data: { user_id: m.uid, species_id: r.boss.species_id, level: r.level, hp: r.stats.hp, attack: r.stats.attack, defense: r.stats.defense, current_hp: r.stats.hp, slot } })] : []),
      ]);
    });
  }

  async function finish(r, result, log) {
    if (r.done) return;
    r.done = true;
    clearTimeout(r.timer);
    r.turn = null;
    const bName = bossName(r.boss.species_id);
    if (result === 'fail') log.push({ msg: `${bName} venceu! Todos foram levados ao Centro Pokémon…`, bossHp: r.hp });
    if (result === 'fled') log.push({ msg: `${bName} fugiu… ninguém conseguiu capturá-lo.`, bossHp: r.hp });
    emitState(r, log);
    const winner = r.members.find((m) => m.uid === r.winner);
    for (const m of r.members) {
      if (m.left) continue;
      await saveMember(r, m, { final: true, result }); // aguarda gravar ANTES de avisar o resultado
      raids.delete(m.uid);
      setBusy(m.uid, false);
      if (result === 'fail') teleportHome(m.uid);
      socketByUser.get(m.uid)?.emit('raid:end', {
        result, winner: winner?.username || null, you: r.winner === m.uid,
        capture: result === 'caught' ? { species_id: r.boss.species_id, level: r.level } : null,
        rewards: m.drops, balls: m.inv,
      });
    }
    if (result === 'fail') { // o boss continua lá, com vida cheia
      boss.busy = false;
      boss.expiresAt = Math.max(boss.expiresAt, Date.now() + 10 * 60000);
    } else {
      io.emit('notice', { msg: result === 'caught' ? `${winner.username} capturou ${bName}!` : `${bName} fugiu…` });
      boss = null;
    }
    emitBoss();
  }

  function leaveRaid(uid) {
    const r = raids.get(uid);
    if (!r || r.done) return;
    const m = r.members.find((x) => x.uid === uid);
    m.left = true;
    raids.delete(uid);
    saveMember(r, m, { final: true, result: 'left' }).finally(() => setBusy(uid, false));
    socketByUser.get(uid)?.emit('raid:end', { result: 'left', rewards: null, balls: m.inv });
    const log = [{ msg: `${m.username} deixou a batalha.`, bossHp: r.hp }];
    if (r.members.every((x) => x.left)) {
      r.done = true;
      clearTimeout(r.timer);
      boss.busy = false;
      boss.expiresAt = Math.max(boss.expiresAt, Date.now() + 10 * 60000);
      emitBoss();
      return;
    }
    if (r.turn?.uid === uid) nextTurn(r, log);
    if (!r.done) emitState(r, log);
  }

  // ================= Integração com os sockets =================
  function bind(socket, uid) {
    socket.on('group:invite', (name) => invite(uid, name));
    socket.on('group:accept', () => accept(uid));
    socket.on('group:decline', () => invites.delete(uid));
    socket.on('group:leave', () => { leaveRaid(uid); leaveGroup(uid); });
    socket.on('raid:action', (type) => typeof type === 'string' && act(uid, type));
    socket.on('online:list', () => socket.emit('online:list', [...meByUser.values()].filter((p) => p.id !== uid && !groupOf.has(p.id)).map((p) => p.username)));
    emitBoss(socket);
  }

  function onDisconnect(uid) {
    leaveRaid(uid);
    leaveGroup(uid);
    invites.delete(uid);
  }

  return { bind, onDisconnect, onMove: (uid) => tryStart(uid), inRaid: (uid) => raids.has(uid),
    groupInfo: (uid) => { const g = groups.get(groupOf.get(uid)); return g ? { id: g.id, leader: g.leader, members: [...g.members] } : null; },
    adminSpawnBoss: (species_id) => (spawnBoss(species_id || undefined, 60 * 60000) ? { ok: true } : { error: 'Há uma raid em andamento' }),
    bossInfo: () => (boss ? { species_id: boss.species_id, tx: boss.tx, ty: boss.ty, busy: boss.busy, leftMin: Math.max(0, Math.round((boss.expiresAt - Date.now()) / 60000)) } : null),
    groupMembers: (uid) => { const g = groups.get(groupOf.get(uid)); return g ? [...g.members] : []; } };
};
