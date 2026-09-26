// Eventos do jogo. O primeiro tipo é o QUIZ POKÉMON, no Salão de Eventos (a casa da direita da Cidade).
// Ciclo: anúncio para todos -> lobby (quem entrar no salão participa) -> perguntas -> resultado e prêmios.
// O servidor manda em tudo: sorteia as perguntas, guarda a resposta certa até a revelação, mede o tempo e pontua.
// Um evento novo = uma entrada em `types` com { name, icon, desc, run(ev, helpers) } que devolve o ranking.
const { makeQuiz } = require('./quiz-bank.js');

const LOBBY_MS = 120000; // inscrições abertas
const FAST = process.env.EVENT_FAST === '1'; // só para testes automáticos: tempos curtos
const Q_MS = FAST ? 2500 : 15000; // tempo por pergunta
const REVEAL_MS = FAST ? 700 : 4500;
const END_MS = FAST ? 1500 : 10000;
const QUIZ_N = 10;
const EVERY_MS = 20 * 60000; // automático: de 20 em 20 minutos
const MASTER_COOLDOWN_MS = 6 * 3600000; // a mesma pessoa não ganha Master Ball a cada quiz

// Prêmios (Ultra Ball e Master Ball só saem em eventos)
const PRIZES = {
  1: { masterballs: 1, ultraballs: 3, apricorns: 20, shards: 8 },
  2: { ultraballs: 2, apricorns: 15, shards: 5 },
  3: { ultraballs: 1, apricorns: 10, shards: 3 },
  good: { greatballs: 2, apricorns: 5 }, // 5 ou mais acertos
  any: { apricorns: 3 }, // participou
};
const ITEM_NAMES = { pokeballs: 'Pokébolas', greatballs: 'Great Balls', ultraballs: 'Ultra Balls', masterballs: 'Master Ball', apricorns: 'Bolotas', shards: 'Fragmentos' };

module.exports = function createEvents({ io, prisma, socketByUser, meByUser, durable }) {
  let ev = null; // evento em andamento
  let autoOn = true;
  let nextAt = Date.now() + EVERY_MS;
  const lastMaster = new Map(); // uid -> quando ganhou Master Ball
  let statusTimer = 0;

  const types = {
    quiz: { id: 'quiz', name: 'Quiz Pokémon', icon: '❓', desc: '10 perguntas sobre Pokémon, 15 s cada. Quanto mais rápido, mais pontos. Prêmios: Master e Ultra Balls!', run: runQuiz },
  };

  const sleepUntil = (e, ms) => new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => { if (e.cancelled || Date.now() - t0 >= ms) { clearInterval(iv); resolve(); } }, 120);
  });
  const emit = (uid, event, data) => socketByUser.get(uid)?.emit(event, data);
  const inHall = (uid) => meByUser.get(uid)?.inside === 'events';
  const hallOf = (e) => [...e.parts.keys()].filter(inHall); // quem está dentro do salão agora

  const status = () => (ev ? { id: ev.id, type: ev.type, name: types[ev.type].name, icon: types[ev.type].icon, phase: ev.phase, startsAt: ev.startsAt, startsIn: Math.max(0, ev.startsAt - Date.now()), n: ev.q?.n || 0, total: ev.total || 0, players: ev.parts.size } : null);
  const pushStatus = (force = true) => {
    if (!force) { if (Date.now() - statusTimer < 1500) return; }
    statusTimer = Date.now();
    io.emit('event:status', status());
  };

  // ---------------------------------------------------------------- participação
  function join(uid) {
    if (!ev || !(ev.phase === 'lobby' || ev.phase === 'running') || !inHall(uid)) return;
    if (!ev.parts.has(uid)) { ev.parts.set(uid, { name: meByUser.get(uid).username, score: 0, correct: 0, answered: 0, time: 0, streak: 0 }); pushStatus(); }
    emit(uid, 'event:joined', { id: ev.id, phase: ev.phase, startsAt: ev.startsAt, startsIn: Math.max(0, ev.startsAt - Date.now()), players: ev.parts.size, q: ev.q && Date.now() < ev.q.endsAt ? publicQ(ev.q) : null });
  }
  const publicQ = (qq) => ({ n: qq.n, total: ev.total, text: qq.text, options: qq.options, endsAt: qq.endsAt, left: Math.max(0, qq.endsAt - Date.now()), ms: Q_MS, answered: false });

  function answer(uid, { n, choice } = {}) {
    if (!ev || ev.phase !== 'running' || !ev.q || ev.q.n !== n || !Number.isInteger(choice) || choice < 0 || choice > 3) return;
    const p = ev.parts.get(uid);
    const now = Date.now();
    if (!p || !inHall(uid) || ev.q.answers.has(uid) || now > ev.q.endsAt + 350) return;
    const right = choice === ev.q.answer;
    const took = Math.min(Q_MS, now - ev.q.startedAt);
    let gained = 0;
    if (right) { p.streak++; gained = 100 + Math.round(100 * (1 - took / Q_MS)) + Math.min(p.streak - 1, 5) * 10; p.correct++; } else p.streak = 0;
    p.score += gained; p.answered++; p.time += took;
    ev.q.answers.set(uid, { choice, gained, right });
    emit(uid, 'event:answered', { n });
  }

  // ---------------------------------------------------------------- ranking e prêmios
  const rank = (e) => [...e.parts.entries()].map(([uid, p]) => ({ uid, ...p })).sort((a, b) => b.score - a.score || a.time - b.time);

  function prizeFor(list, i, total) {
    const r = list[i];
    let prize = null;
    if (list.length >= 2 && i < 3 && r.score > 0) prize = { ...PRIZES[i + 1] };
    else if (r.correct >= 5) prize = { ...PRIZES.good };
    else if (r.answered > 0) prize = { ...PRIZES.any };
    if (prize?.masterballs) { // Master Ball: só com 3+ jogadores e sem ter ganhado outra recentemente
      const recent = Date.now() - (lastMaster.get(r.uid) || 0) < MASTER_COOLDOWN_MS;
      if (list.length < 3 || recent) { prize.ultraballs = (prize.ultraballs || 0) + 2; delete prize.masterballs; }
    }
    return prize;
  }

  async function grant(uid, prize) {
    if (!prize) return;
    const data = {};
    for (const [k, n] of Object.entries(prize)) data[k] = { increment: n };
    const u = await durable('evento-premio', () => prisma.user.update({ where: { id: uid }, data }));
    if (u) emit(uid, 'inventory', { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });
    if (prize.masterballs) lastMaster.set(uid, Date.now());
  }

  async function finish(e) {
    e.phase = 'results';
    e.q = null;
    const list = rank(e);
    const prizes = list.map((r, i) => prizeFor(list, i, list.length));
    await Promise.all(list.map((r, i) => grant(r.uid, prizes[i])));
    const top = list.slice(0, 10).map((r) => ({ name: r.name, score: r.score, correct: r.correct }));
    list.forEach((r, i) => emit(r.uid, 'event:end', { id: e.id, top, total: e.total, you: { rank: i + 1, of: list.length, score: r.score, correct: r.correct, prize: prizes[i] } }));
    if (list[0]) io.emit('notice', { msg: `🏆 ${types[e.type].name}: ${list[0].name} venceu com ${list[0].score} pontos! (${list.length} jogador${list.length > 1 ? 'es' : ''})`, big: true });
    await durable('evento-log', () => prisma.eventLog.create({ data: { type: e.type, players: list.length, winner: list[0]?.name || '', data: JSON.stringify({ by: e.by, top }).slice(0, 2000) } }));
    pushStatus();
    await sleepUntil({ cancelled: false }, END_MS);
  }

  // ---------------------------------------------------------------- tipo: QUIZ
  async function runQuiz(e) {
    const qs = makeQuiz(QUIZ_N);
    e.total = qs.length;
    e.phase = 'running';
    for (let i = 0; i < qs.length && !e.cancelled; i++) {
      const qq = qs[i];
      const startedAt = Date.now();
      e.q = { n: i + 1, text: qq.text, options: qq.options, answer: qq.answer, startedAt, endsAt: startedAt + Q_MS, answers: new Map() };
      pushStatus();
      hallOf(e).forEach((uid) => emit(uid, 'event:question', publicQ(e.q)));
      await sleepUntil(e, Q_MS + 250);
      if (e.cancelled) return false;
      const list = rank(e);
      const top = list.slice(0, 5).map((r) => ({ name: r.name, score: r.score }));
      for (const [uid, p] of e.parts) {
        const a = e.q.answers.get(uid);
        if (!a) p.streak = 0; // não respondeu: perde a sequência
        emit(uid, 'event:reveal', { n: e.q.n, correct: qq.answer, choice: a ? a.choice : null, gained: a?.gained || 0, score: p.score, rank: list.findIndex((r) => r.uid === uid) + 1, of: list.length, top });
      }
      if (i < qs.length - 1) await sleepUntil(e, REVEAL_MS);
    }
    return !e.cancelled;
  }

  // ---------------------------------------------------------------- ciclo de vida
  function start(typeId, { by = 'auto', lobbyMs = LOBBY_MS } = {}) {
    const def = types[typeId];
    if (!def) return { error: 'Tipo de evento desconhecido' };
    if (ev) return { error: 'Já existe um evento em andamento' };
    const e = { id: Date.now(), type: typeId, by, phase: 'lobby', startsAt: Date.now() + lobbyMs, parts: new Map(), cancelled: false, total: 0, q: null };
    ev = e;
    io.emit('event:announce', { id: e.id, type: typeId, name: def.name, icon: def.icon, startsAt: e.startsAt, startsIn: lobbyMs, where: 'Salão de Eventos, na Cidade (casa da direita)' });
    io.emit('notice', { msg: `${def.icon} ${def.name} abre em ${Math.round(lobbyMs / 1000)} s no Salão de Eventos (Cidade)! Entre pela casa da direita.`, big: true });
    pushStatus();
    for (const uid of meByUser.keys()) join(uid); // quem já está dentro do salão entra na hora
    (async () => {
      try {
        await sleepUntil(e, lobbyMs);
        if (e.cancelled) return;
        if (!e.parts.size) { io.emit('notice', { msg: `${def.icon} ${def.name} cancelado: ninguém entrou no salão.` }); return; }
        const ok = await def.run(e);
        if (ok) await finish(e);
      } catch (err) {
        console.error('[eventos] falha', err);
      } finally {
        if (e.cancelled) io.emit('notice', { msg: `${def.icon} ${def.name} foi cancelado.` });
        if (ev === e) { ev = null; io.emit('event:status', null); }
      }
    })();
    return { ok: true };
  }

  function cancel() {
    if (!ev) return { error: 'Não há evento em andamento' };
    ev.cancelled = true;
    for (const uid of ev.parts.keys()) emit(uid, 'event:cancel', {});
    return { ok: true };
  }

  // ---------------------------------------------------------------- agendamento automático (persistido em Meta)
  async function loadSettings() {
    try {
      const a = await prisma.meta.findUnique({ where: { key: 'events.auto' } });
      const n = await prisma.meta.findUnique({ where: { key: 'events.next' } });
      if (a) autoOn = a.value === '1';
      const saved = Number(n?.value);
      nextAt = Number.isFinite(saved) && saved > Date.now() ? saved : Date.now() + EVERY_MS;
    } catch (e) { console.error('[eventos] config', e.message); }
  }
  const saveSetting = (key, value) => durable('evento-config', () => prisma.meta.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } }));
  async function setAuto(on) { autoOn = !!on; await saveSetting('events.auto', autoOn ? '1' : '0'); if (autoOn && nextAt < Date.now()) { nextAt = Date.now() + EVERY_MS; await saveSetting('events.next', nextAt); } }

  const timer = setInterval(() => {
    if (!autoOn || Date.now() < nextAt) return;
    if (ev) { nextAt = Date.now() + 60000; return; } // ocupado: tenta de novo em 1 min
    if (start('quiz', { by: 'auto' }).ok) { nextAt = Date.now() + EVERY_MS; saveSetting('events.next', nextAt); }
  }, 5000);
  timer.unref();

  async function summary() {
    const recent = await prisma.eventLog.findMany({ orderBy: { id: 'desc' }, take: 8 });
    return {
      types: Object.values(types).map((t) => ({ id: t.id, name: t.name, icon: t.icon, desc: t.desc })),
      current: status(),
      auto: { enabled: autoOn, nextAt: autoOn ? nextAt : null, everyMin: EVERY_MS / 60000 },
      recent: recent.map((r) => ({ type: r.type, at: r.started_at, players: r.players, winner: r.winner })),
    };
  }

  function bind(socket, uid) {
    socket.emit('event:status', status());
    socket.on('event:sync', () => socket.emit('event:status', status()));
    socket.on('event:answer', (p) => answer(uid, p || {}));
  }
  const onEnter = (uid) => join(uid);
  const onLeave = () => {};

  return { start, cancel, setAuto, summary, bind, onEnter, onLeave, init: loadSettings, status, PRIZES, ITEM_NAMES };
};
