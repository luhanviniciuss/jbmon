// PvP entre jogadores: solo (1x1), grupo contra grupo e guerra de clãs.
// Tudo é AUTORITATIVO aqui e SEGURO para os Pokémon: a luta usa CÓPIAS nivelada no Lv.50 (até 3 da equipe),
// então ninguém perde HP, EXP ou Pokémon. O que persiste é só o ranking (rating), vitórias/derrotas e os pontos do clã.
// Cada lado tem o mesmo número de jogadores; o jogador N de um lado enfrenta o jogador N do outro (duelos em paralelo).
// Vence o lado com mais duelos ganhos (desempate: mais HP restante). Turnos simultâneos: os dois escolhem, então resolve.
const { SPECIES, calcStats } = require('../public/species.js');
const { getMove, calcHit, effText, nameOf } = require('./battle.js');

const LEVEL = 50;
const TEAM_MAX = 3;
const TURN_MS = 30000;
const CHALLENGE_MS = 30000;
const AFK_LIMIT = 3; // turnos seguidos sem jogar = desiste do duelo
const FARM_LIMIT = 4; // lutas valendo pontos por hora contra os mesmos adversários
const K = { solo: 32, group: 24, clan: 24 };
const MODES = ['solo', 'group', 'clan'];
const CLAN_WIN = 30;
const CLAN_LOSS = 10;
const RANK = { member: 1, officer: 2, leader: 3 };

module.exports = function createPvp({ biomeOf, app, prisma, auth, io, socketByUser, meByUser, groupInfo, isBusy, setBusy, markCombat, loadTeam, durable, clanSync }) {
  const inMatch = new Map(); // uid -> match
  const challenges = new Map(); // uid desafiado -> { id, mode, from, to, exp }
  const recent = new Map(); // "a-b" -> [timestamps] (anti-farm)
  let nextId = 1;

  const emit = (uid, ev, data) => socketByUser.get(uid)?.emit(ev, data);
  const notice = (uid, msg) => emit(uid, 'notice', { msg });
  const nameById = (uid) => meByUser.get(uid)?.username || '?';
  const fail = (msg) => { throw new Error(msg); };

  // ------------------------------------------------------------ desafios
  function sideFor(uid, mode, who) {
    const g = groupInfo(uid);
    if (mode === 'solo') return [uid];
    if (mode === 'group' || g) {
      if (!g) fail(`${who} precisa estar em um grupo`);
      if (g.leader !== uid) fail(`Só o líder do grupo pode participar (${who} não é o líder)`);
      return g.members;
    }
    return [uid]; // guerra de clãs sem grupo = duelo 1x1 entre membros de clãs
  }

  function buildSides(from, to, mode) {
    const a = meByUser.get(from), b = meByUser.get(to);
    if (!a || !b) fail('Jogador não está mais online');
    const A = sideFor(from, mode, 'Você');
    const B = sideFor(to, mode, b.username);
    if (A.length !== B.length) fail(`Os lados precisam ter o mesmo tamanho (${A.length} contra ${B.length})`);
    if (A.some((id) => B.includes(id))) fail('Você não pode enfrentar seu próprio grupo');
    for (const id of [...A, ...B]) {
      if (!meByUser.has(id)) fail('Alguém do grupo ficou offline');
      if (isBusy(id) || inMatch.has(id)) fail(`${nameById(id)} está ocupado(a) em outra batalha`);
    }
    if (mode === 'clan') {
      if (!a.clan || !b.clan) fail('Guerra de clãs: os dois lados precisam ter clã');
      if (a.clan.id === b.clan.id) fail('Você não pode declarar guerra ao seu próprio clã');
      if (RANK[a.clan.role] < RANK.officer) fail('Só líder e oficiais declaram guerra');
      if (RANK[b.clan.role] < RANK.officer) fail(`${b.username} não é oficial do clã dele`);
      if (A.some((id) => meByUser.get(id).clan?.id !== a.clan.id)) fail('Todos do seu grupo precisam ser do seu clã');
      if (B.some((id) => meByUser.get(id).clan?.id !== b.clan.id)) fail('Todos do grupo adversário precisam ser do clã dele');
    }
    return [A, B];
  }

  function challenge(uid, { mode, target } = {}) {
    if (!MODES.includes(mode)) fail('Modo inválido');
    const t = [...meByUser.values()].find((m) => m.username.toLowerCase() === String(target || '').trim().toLowerCase());
    if (!t || t.id === uid) fail('Jogador não encontrado (ele precisa estar online)');
    const cur = challenges.get(t.id);
    if (cur && cur.exp > Date.now()) fail(`${t.username} já tem um desafio pendente`);
    for (const c of challenges.values()) if (c.from === uid && c.exp > Date.now()) fail('Você já tem um desafio aguardando resposta');
    const [A] = buildSides(uid, t.id, mode);
    const me = meByUser.get(uid);
    const ch = { id: nextId++, mode, from: uid, to: t.id, exp: Date.now() + CHALLENGE_MS };
    challenges.set(t.id, ch);
    setTimeout(() => {
      if (challenges.get(t.id) === ch) {
        challenges.delete(t.id);
        notice(uid, `${t.username} não respondeu ao desafio.`);
        emit(t.id, 'pvp:challenge-gone', { id: ch.id });
      }
    }, CHALLENGE_MS + 200).unref();
    emit(t.id, 'pvp:challenged', { id: ch.id, mode, from: me.username, size: A.length, clan: me.clan?.name || null, ms: CHALLENGE_MS });
    notice(uid, `⚔ Desafio enviado a ${t.username}.`);
  }

  async function respond(uid, { id, accept } = {}) {
    const ch = challenges.get(uid);
    if (!ch || ch.id !== id) return;
    challenges.delete(uid);
    if (!accept) return notice(ch.from, `${nameById(uid)} recusou o desafio.`);
    if (ch.exp < Date.now()) return notice(uid, 'O desafio expirou.');
    const [A, B] = buildSides(ch.from, ch.to, ch.mode);
    await startMatch(ch.mode, A, B);
  }

  // ------------------------------------------------------------ partida
  async function makePlayer(uid) {
    const rows = (await loadTeam(prisma, uid)).slice(0, TEAM_MAX);
    if (!rows.length) fail(`${nameById(uid)} não tem Pokémon na equipe`);
    const team = rows.map((p) => {
      const st = calcStats(p.species_id, LEVEL);
      return { species_id: p.species_id, nickname: p.nickname, level: LEVEL, hp: st.hp, maxHp: st.hp, attack: st.attack, defense: st.defense };
    });
    return { uid, name: nameById(uid), team, idx: 0, choice: null, forced: false, afk: 0 };
  }

  async function startMatch(mode, A, B) {
    const ids = [...A, ...B];
    ids.forEach((id) => { setBusy(id, true); markCombat(id, 'pvp'); }); // reserva já, para ninguém entrar em outra batalha
    try {
      const players = await Promise.all(ids.map(makePlayer));
      const pa = players.slice(0, A.length), pb = players.slice(A.length);
      const match = {
        id: nextId++, mode, sides: [A, B], over: false, biome: biomeOf ? biomeOf(A[0]) : 'field',
        clans: mode === 'clan' ? [meByUser.get(A[0]).clan.id, meByUser.get(B[0]).clan.id] : null,
        clanNames: mode === 'clan' ? [meByUser.get(A[0]).clan.name, meByUser.get(B[0]).clan.name] : null,
        duels: pa.map((p, i) => ({ n: i, p: [p, pb[i]], over: false, winner: null, timer: null, deadline: 0 })),
      };
      ids.forEach((id) => inMatch.set(id, match));
      match.duels.forEach((d) => pushState(match, d, [{ msg: `⚔ ${d.p[0].name} contra ${d.p[1].name}! Todos lutam no Lv.${LEVEL} — seus Pokémon não correm risco.` }]));
      match.duels.forEach((d) => armTimer(match, d));
    } catch (e) {
      ids.forEach((id) => { setBusy(id, false); markCombat(id, null); inMatch.delete(id); });
      ids.forEach((id) => notice(id, 'Não foi possível iniciar o PvP: ' + e.message));
    }
  }

  const pub = (t) => t.map((m) => ({ species_id: m.species_id, nickname: m.nickname, level: m.level, hp: m.hp, maxHp: m.maxHp }));
  const summary = (match) => match.duels.map((d) => ({ a: d.p[0].name, b: d.p[1].name, winner: d.over ? d.winner : null }));

  function pushState(match, duel, log = []) {
    duel.p.forEach((pl, k) => {
      const foe = duel.p[1 - k];
      emit(pl.uid, 'pvp:state', {
        match: match.id, mode: match.mode, biome: match.biome, duel: duel.n, clans: match.clanNames, side: match.sides[0].includes(pl.uid) ? 0 : 1,
        you: { name: pl.name, team: pub(pl.team), idx: pl.idx, forced: pl.forced, chose: !!pl.choice },
        foe: { name: foe.name, team: pub(foe.team), idx: foe.idx },
        log: log.map((e) => (e.atk ? { ...e, atk: { type: e.atk.type, by: e.atk.by === k ? 'me' : 'foe' } } : e)), deadline: duel.over ? 0 : duel.deadline, over: duel.over, won: duel.over ? (duel.winner === k ? 'you' : 'foe') : null,
        duels: summary(match).map((s) => ({ ...s })),
      });
    });
  }

  function armTimer(match, duel) {
    clearTimeout(duel.timer);
    if (duel.over) return;
    duel.deadline = Date.now() + TURN_MS;
    duel.timer = setTimeout(() => {
      if (duel.over) return;
      const waiting = duel.p.some((q) => q.forced) ? duel.p.filter((q) => q.forced) : duel.p;
      for (const q of waiting) {
        if (q.choice) continue;
        q.afk++;
        if (q.afk >= AFK_LIMIT) return endDuel(match, duel, 1 - duel.p.indexOf(q), [{ msg: `${q.name} ficou ausente e desistiu do duelo.` }]);
        q.choice = q.forced ? 'switch:' + q.team.findIndex((m) => m.hp > 0) : 'attack';
      }
      resolve(match, duel);
    }, TURN_MS + 100);
    duel.timer.unref?.();
  }

  const okAction = (pl, a) => {
    if (pl.forced) return /^switch:\d$/.test(a) && switchOk(pl, a);
    return a === 'attack' || a === 'strong' || (/^switch:\d$/.test(a) && switchOk(pl, a));
  };
  const switchOk = (pl, a) => { const m = pl.team[Number(a.slice(7))]; return !!m && m.hp > 0 && (pl.forced || Number(a.slice(7)) !== pl.idx); };

  function choose(uid, { match: mid, action } = {}) {
    const match = inMatch.get(uid);
    if (!match || match.id !== mid || typeof action !== 'string') return;
    const duel = match.duels.find((d) => d.p.some((q) => q.uid === uid));
    if (!duel || duel.over) return;
    const k = duel.p.findIndex((q) => q.uid === uid);
    const pl = duel.p[k];
    const anyForced = duel.p.some((q) => q.forced);
    if (pl.choice || (anyForced && !pl.forced) || !okAction(pl, action)) return;
    pl.choice = action;
    pl.afk = 0;
    const need = anyForced ? duel.p.filter((q) => q.forced) : duel.p;
    if (need.every((q) => q.choice)) resolve(match, duel);
    else pushState(match, duel); // mostra "aguardando o adversário"
  }

  function resolve(match, duel) {
    clearTimeout(duel.timer);
    const log = [];
    const cur = (q) => q.team[q.idx];
    const doSwitch = (q, free) => {
      const to = Number(q.choice.slice(7));
      if (!free) log.push({ msg: `Volte, ${nameOf(cur(q))}!` });
      q.idx = to;
      q.forced = false;
      log.push({ msg: `${q.name}: Vai, ${nameOf(cur(q))}!`, fx: 'switch' });
    };
    if (duel.p.some((q) => q.forced)) duel.p.filter((q) => q.forced).forEach((q) => doSwitch(q, true));
    else {
      duel.p.forEach((q) => q.choice.startsWith('switch:') && doSwitch(q, false));
      const order = [0, 1].filter((k) => !duel.p[k].choice.startsWith('switch:')).sort(() => Math.random() - 0.5);
      for (const k of order) {
        const att = duel.p[k], def = duel.p[1 - k];
        const am = cur(att), dm = cur(def);
        if (am.hp <= 0) continue;
        const aT = SPECIES[am.species_id].types, dT = SPECIES[dm.species_id].types;
        const mv = getMove(att.choice, aT);
        if (Math.random() > mv.acc) { log.push({ msg: `${nameOf(am)} de ${att.name} usou ${mv.name}, mas errou!` }); continue; }
        const h = calcHit(LEVEL, mv, am.attack, dm.defense, aT, dT);
        dm.hp = Math.max(0, dm.hp - h.dmg);
        log.push({ msg: `${nameOf(am)} de ${att.name} usou ${mv.name}!${effText(h.eff)}${h.crit ? ' Acerto crítico!' : ''} (-${h.dmg})`, eff: h.eff, atk: { type: mv.type, by: k } });
        if (dm.hp <= 0) log.push({ msg: `${nameOf(dm)} de ${def.name} desmaiou!` });
      }
    }
    duel.p.forEach((q) => (q.choice = null));
    // desmaios: sem Pokémon vivo = perdeu; senão precisa trocar (troca grátis)
    for (let k = 0; k < 2; k++) {
      const q = duel.p[k];
      if (cur(q).hp > 0) { q.forced = false; continue; }
      if (!q.team.some((m) => m.hp > 0)) return endDuel(match, duel, 1 - k, log);
      q.forced = true;
    }
    pushState(match, duel, log);
    armTimer(match, duel);
  }

  function endDuel(match, duel, winner, log = []) {
    clearTimeout(duel.timer);
    duel.over = true;
    duel.winner = winner;
    duel.p.forEach((q) => (q.forced = false));
    log.push({ msg: `🏁 ${duel.p[winner].name} venceu o duelo!` });
    match.duels.forEach((d) => pushState(match, d, d === duel ? log : []));
    if (match.duels.every((d) => d.over)) finishMatch(match);
  }

  function forfeit(uid) {
    const match = inMatch.get(uid);
    if (!match) return;
    const duel = match.duels.find((d) => d.p.some((q) => q.uid === uid));
    if (duel && !duel.over) {
      const k = duel.p.findIndex((q) => q.uid === uid);
      endDuel(match, duel, 1 - k, [{ msg: `${duel.p[k].name} desistiu do duelo.` }]);
    }
  }

  // ------------------------------------------------------------ resultado e ranking
  const expected = (own, opp) => 1 / (1 + 10 ** ((opp - own) / 400));

  async function finishMatch(match) {
    if (match.over) return;
    match.over = true;
    const wins = [0, 0];
    const hpLeft = [0, 0]; // fração de HP restante dos vencedores de duelo (desempate)
    match.duels.forEach((d) => {
      wins[d.winner]++;
      hpLeft[d.winner] += d.p[d.winner].team.reduce((s, m) => s + m.hp / m.maxHp, 0);
    });
    const side = wins[0] !== wins[1] ? (wins[0] > wins[1] ? 0 : 1) : hpLeft[0] !== hpLeft[1] ? (hpLeft[0] > hpLeft[1] ? 0 : 1) : -1;
    const ids = [...match.sides[0], ...match.sides[1]];
    const result = { side, wins, deltas: new Map(), farm: false, clan: null };

    try {
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, pvp_rating: true } });
      const rating = new Map(users.map((u) => [u.id, u.pvp_rating]));
      const avg = (s) => s.reduce((t, id) => t + (rating.get(id) ?? 1000), 0) / s.length;
      const avgs = [avg(match.sides[0]), avg(match.sides[1])];

      // anti-farm: as mesmas duas pontas lutando muitas vezes na hora não rendem mais pontos
      const key = [match.sides[0][0], match.sides[1][0]].sort().join('-');
      const now = Date.now();
      const hist = (recent.get(key) || []).filter((t) => now - t < 3600000);
      result.farm = hist.length >= FARM_LIMIT;
      if (side !== -1) { hist.push(now); recent.set(key, hist); }

      const ops = [];
      for (let s = 0; s < 2; s++) {
        for (const id of match.sides[s]) {
          const score = side === -1 ? 0.5 : side === s ? 1 : 0;
          let delta = 0;
          if (!result.farm) {
            delta = Math.round(K[match.mode] * (score - expected(rating.get(id) ?? 1000, avgs[1 - s])));
            if (side !== -1 && delta === 0) delta = score === 1 ? 1 : -1;
          }
          const next = Math.max(100, (rating.get(id) ?? 1000) + delta);
          result.deltas.set(id, { delta: next - (rating.get(id) ?? 1000), rating: next });
          ops.push({ id, rating: next, w: side === s ? 1 : 0, l: side !== -1 && side !== s ? 1 : 0 });
        }
      }

      let clanOps = null;
      if (match.mode === 'clan' && side !== -1 && !result.farm) {
        const win = match.clans[side], lose = match.clans[1 - side];
        const lc = await prisma.clan.findUnique({ where: { id: lose }, select: { points: true } });
        clanOps = { win, lose, loseNext: Math.max(0, (lc?.points ?? 0) - CLAN_LOSS) };
        result.clan = { winner: match.clanNames[side], loser: match.clanNames[1 - side], loseDelta: clanOps.loseNext - (lc?.points ?? 0) };
      }

      await durable('pvp', () => prisma.$transaction([
        ...ops.map((o) => prisma.user.update({ where: { id: o.id }, data: { pvp_rating: o.rating, pvp_wins: { increment: o.w }, pvp_losses: { increment: o.l } } })),
        ...(clanOps ? [
          prisma.clan.update({ where: { id: clanOps.win }, data: { points: { increment: CLAN_WIN }, wins: { increment: 1 } } }),
          prisma.clan.update({ where: { id: clanOps.lose }, data: { points: clanOps.loseNext, losses: { increment: 1 } } }),
        ] : []),
      ]));
    } catch (e) {
      console.error('[pvp] falha ao gravar resultado', e.message);
    }

    for (let s = 0; s < 2; s++) {
      for (const id of match.sides[s]) {
        const d = result.deltas.get(id) || { delta: 0, rating: null };
        emit(id, 'pvp:end', {
          match: match.id, mode: match.mode, result: side === -1 ? 'draw' : side === s ? 'win' : 'lose',
          wins: [wins[s], wins[1 - s]], delta: d.delta, rating: d.rating, farm: result.farm,
          clanPoints: result.clan ? (side === s ? CLAN_WIN : result.clan.loseDelta) : null,
        });
        inMatch.delete(id);
        setBusy(id, false);
        markCombat(id, null);
      }
    }
    if (result.clan) {
      io.emit('notice', { msg: `🏰 Guerra de clãs: [${match.clanNames[side]}] venceu [${match.clanNames[1 - side]}]! (+${CLAN_WIN} pontos)` });
      match.clans.forEach((c) => clanSync?.(c));
    }
  }

  // ------------------------------------------------------------ rede
  function bind(socket, uid) {
    const guard = (fn) => async (p) => { try { await fn(p); } catch (e) { notice(uid, e.message.startsWith('Não foi') ? e.message : e.message); } };
    socket.on('pvp:challenge', guard((p) => challenge(uid, p || {})));
    socket.on('pvp:respond', guard((p) => respond(uid, p || {})));
    socket.on('pvp:action', (p) => choose(uid, p || {}));
    socket.on('pvp:forfeit', () => forfeit(uid));
    socket.on('pvp:cancel', () => {
      for (const [to, c] of challenges) if (c.from === uid) { challenges.delete(to); emit(to, 'pvp:challenge-gone', { id: c.id }); }
    });
  }

  function onDisconnect(uid) {
    forfeit(uid);
    challenges.delete(uid);
    for (const [to, c] of challenges) if (c.from === uid) { challenges.delete(to); emit(to, 'pvp:challenge-gone', { id: c.id }); }
  }

  // Ranking: top jogadores por rating + situação do próprio jogador
  app.get('/api/pvp/top', auth, async (req, res) => {
    try {
      const rows = await prisma.user.findMany({
        where: { OR: [{ pvp_wins: { gt: 0 } }, { pvp_losses: { gt: 0 } }] },
        orderBy: [{ pvp_rating: 'desc' }, { pvp_wins: 'desc' }], take: 20,
        select: { id: true, username: true, pvp_rating: true, pvp_wins: true, pvp_losses: true, clan: { select: { tag: true } } },
      });
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { pvp_rating: true, pvp_wins: true, pvp_losses: true } });
      res.json({ top: rows.map((r, i) => ({ pos: i + 1, username: r.username, tag: r.clan?.tag || null, rating: r.pvp_rating, wins: r.pvp_wins, losses: r.pvp_losses })), me });
    } catch (e) { console.error('[pvp] top', e); res.status(500).json({ error: 'Erro interno' }); }
  });

  // Jogadores online para desafiar (com clã, situação e rating)
  app.get('/api/pvp/online', auth, async (req, res) => {
    try {
      const others = [...meByUser.values()].filter((m) => m.id !== req.user.id);
      const rows = await prisma.user.findMany({ where: { id: { in: others.map((m) => m.id) } }, select: { id: true, pvp_rating: true } });
      const rating = new Map(rows.map((r) => [r.id, r.pvp_rating]));
      res.json(others.map((m) => ({ username: m.username, tag: m.clan?.tag || null, busy: isBusy(m.id) || inMatch.has(m.id), group: groupInfo(m.id)?.members.length || 0, rating: rating.get(m.id) ?? 1000 })));
    } catch (e) { console.error('[pvp] online', e); res.status(500).json({ error: 'Erro interno' }); }
  });

  return { bind, onDisconnect, inMatch: (uid) => inMatch.has(uid) };
};
