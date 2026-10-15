// Eventos do jogo, todos pelo Salão de Eventos (a casa da direita da Cidade), um de cada vez.
// Ciclo comum: anúncio para todos -> lobby (quem entrar no salão se inscreve) -> evento roda -> resultado e prêmios.
// Tipos "de salão" (quiz, quem-é-esse-pokémon, roleta, duelo relâmpago): o jogador fica na telinha do evento.
// Tipos "de mundo" (caça ao tesouro, corrida, chuva de bolas, hora da sorte): depois de se inscrever, o jogador sai
// e joga na Praça da Cidade; o servidor valida tudo pelo movimento real (mesmo anti-cheat do resto do jogo).
// Um evento novo = uma entrada em `types` com { name, icon, desc, run(ev), competitive } que define o ranking (ou não).
const { makeQuiz } = require('./quiz-bank.js');
const { SPECIES } = require('../public/species.js');
const { rand, pickSpecies } = require('./battle.js');
const { isXmasActive } = require('./season.js');

const LOBBY_MS = 120000; // inscrições abertas
const FAST = process.env.EVENT_FAST === '1'; // só para testes automáticos: tempos curtos
const Q_MS = FAST ? 2500 : 15000; // tempo por pergunta (quiz e quem-é-esse-pokémon)
const REVEAL_MS = FAST ? 700 : 4500;
const END_MS = FAST ? 1500 : 10000;
const QUIZ_N = 10;
const WHOSTHAT_N = 8;
const EVERY_MS = 20 * 60000; // automático: de 20 em 20 minutos
const WB_EVERY_MS = 120 * 60000; // Chefe de Mundo automático: de 2 em 2 horas
const WB_TYPE = { id: 'worldboss', name: 'Chefe de Mundo', icon: '🐉', desc: 'Um chefe gigante na Praça da Cidade: todos lutam juntos, em tempo real, contra a mesma vida. Até 5 Master Balls para quem mais causar dano!' };

const TREASURE_N = 16, TREASURE_MS = FAST ? 20000 : 300000; // 5 min
const TREASURE_TIERS = [[{ val: 1, icon: '🥉' }, 10], [{ val: 3, icon: '🥈' }, 5], [{ val: 8, icon: '🥇' }, 1.4]];
const GIFT_N = 18, GIFT_MS = FAST ? 20000 : 300000; // 5 min — evento sazonal de Natal
const GIFT_TIERS = [[{ val: 2, icon: '🎁' }, 10], [{ val: 5, icon: '🎀' }, 5], [{ val: 12, icon: '⭐' }, 1.4]];
const BALLRAIN_MS = FAST ? 20000 : 600000; // 10 min
const BALLRAIN_WAVE_MS = FAST ? 2500 : 15000;
const BALLRAIN_PER_WAVE = 5;
const RACE_CHECKPOINTS = [[46, 46], [55, 45], [58, 54], [50, 58], [42, 50]].map(([x, y]) => ({ x: (x + 0.5) * 32, y: (y + 0.5) * 32 }));
const LUCK_MS = FAST ? 15000 : 900000; // 15 min
const LUCK_BONUS = { apricorns: 3, shards: 1 }; // bônus extra em CADA vitória/captura, pra todo mundo, durante a Hora da Sorte
const WHEEL_WAIT_MS = FAST ? 1000 : 3500;
const WHEEL_PRIZES = [[{ apricorns: 5 }, 38], [{ apricorns: 10, shards: 3 }, 26], [{ greatballs: 2 }, 16], [{ ultraballs: 1, shards: 5 }, 12], [{ ultraballs: 2, apricorns: 15 }, 6], [{ masterballs: 1 }, 2]];
const DUEL_ROUND_MS = FAST ? 1500 : 6000;
const PICKUP_R = 30; // px pra encostar num item espalhado pelo mapa
const CAPTURE_MS = FAST ? 20000 : 300000; // 5 min de Captura Relâmpago
const LIGHTNING_N = 15, LIGHTNING_MS = FAST ? 1200 : 6000; // Pergunta Relâmpago: mais perguntas, bem mais rápidas
const GOLDEN_MS = FAST ? 3000 : 20000; // Pergunta de Ouro: uma só, quem acerta primeiro leva tudo

// Prêmios (Ultra Ball e Master Ball só saem em eventos)
const PRIZES = {
  1: { masterballs: 1, ultraballs: 3, apricorns: 20, shards: 8 },
  2: { ultraballs: 2, apricorns: 15, shards: 5 },
  3: { ultraballs: 1, apricorns: 10, shards: 3 },
  good: { greatballs: 2, apricorns: 5 }, // 5 ou mais acertos / boa pontuação
  any: { apricorns: 3 }, // participou
};
const ITEM_NAMES = { pokeballs: 'Pokébolas', greatballs: 'Great Balls', ultraballs: 'Ultra Balls', masterballs: 'Master Ball', apricorns: 'Bolotas', shards: 'Fragmentos' };

const SPECIES_IDS = Object.keys(SPECIES).map(Number).filter((id) => SPECIES[id].rarity !== 'legendary');
const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

module.exports = function createEvents({ io, prisma, socketByUser, meByUser, durable, worldBoss, world }) {
  let ev = null; // evento em andamento
  let autoOn = true;
  let nextAt = Date.now() + EVERY_MS;
  let nextWbAt = Date.now() + WB_EVERY_MS;
  let statusTimer = 0;
  let luckUntil = 0; // Hora da Sorte: enquanto Date.now() < luckUntil, toda vitória/captura rende um bônus extra pra todo mundo

  const types = {
    quiz: { id: 'quiz', name: 'Quiz Pokémon', icon: '❓', desc: '10 perguntas sobre Pokémon, 15 s cada. Quanto mais rápido, mais pontos. Empate em 1º = perguntas de desempate. O 1º ganha uma Master Ball!', run: runQuiz, where: 'Salão de Eventos' },
    lightning: { id: 'lightning', name: 'Pergunta Relâmpago', icon: '⚡', desc: `${LIGHTNING_N} perguntas bem mais rápidas (só ${(LIGHTNING_MS / 1000).toFixed(0)} s cada). Puro reflexo: quem lê e decide mais rápido, pontua mais.`, run: runLightning, where: 'Salão de Eventos' },
    golden: { id: 'golden', name: 'Pergunta de Ouro', icon: '🌟', desc: 'Uma pergunta só, com prêmio grande. Quem acertar PRIMEIRO leva tudo — os demais não ganham nada dessa vez.', run: runGolden, where: 'Salão de Eventos' },
    whosthat: { id: 'whosthat', name: 'Quem é Esse Pokémon?', icon: '👤', desc: '8 silhuetas pra adivinhar, 15 s cada. Digite o nome: quanto mais rápido, mais pontos.', run: runWhosThat, where: 'Salão de Eventos' },
    capture: { id: 'capture', name: 'Captura Relâmpago', icon: '🎯', desc: 'Inscreva-se no salão e saia pra capturar! Por 5 minutos, toda captura em qualquer mundo rende pontos (mais pontos por Pokémon mais raro). Quem mais pontuar, vence.', run: runCapture, where: 'Qualquer mundo' },
    treasure: { id: 'treasure', name: 'Caça ao Tesouro', icon: '💰', desc: `${TREASURE_N} tesouros espalhados pela Praça da Cidade por 5 minutos. Ache-os andando por cima; os dourados valem mais!`, run: runTreasure, where: 'Praça da Cidade' },
    race: { id: 'race', name: 'Corrida da Praça', icon: '🏁', desc: 'Toque as 5 bandeiras na Praça, em ordem, o mais rápido possível. O cronômetro é do servidor.', run: runRace, where: 'Praça da Cidade' },
    ballrain: { id: 'ballrain', name: 'Chuva de Pokébolas', icon: '🌧️', desc: 'Pokébolas grátis caem na Praça por 10 minutos, em levas. Ande por cima para coletar — quem pegar mais, ganha mais!', run: runBallRain, where: 'Praça da Cidade' },
    luck: { id: 'luck', name: 'Hora da Sorte', icon: '🍀', desc: 'Por 15 minutos, toda captura ou vitória em qualquer lugar do jogo rende Bolotas e Fragmentos extras pra todo mundo — sem precisar se inscrever!', run: runLuck, competitive: false },
    wheel: { id: 'wheel', name: 'Roleta Dourada', icon: '🎡', desc: 'Quem estiver no Salão de Eventos ganha um giro grátis na roleta, com prêmios de Pokébolas especiais. Sem perguntas, sem corrida — só sorte!', run: runWheel, competitive: false, where: 'Salão de Eventos' },
    duel: { id: 'duel', name: 'Duelo Relâmpago', icon: '⚔️', desc: 'Um torneio-sorteio eliminatório entre quem está no salão: cada rodada decide por sorte quem avança, até sobrar um campeão.', run: runDuel, where: 'Salão de Eventos' },
    xmas: { id: 'xmas', name: 'Caça aos Presentes de Natal', icon: '🎄', desc: `${GIFT_N} presentes espalhados pela Praça da Cidade por 5 minutos. Ache-os andando por cima; os com laço e estrela valem mais! Sazonal: só roda sozinho na época de Natal (1/dez a 6/jan), mas um admin pode iniciar fora dela.`, run: runXmas, where: 'Praça da Cidade', seasonal: true },
  };

  const sleepUntil = (e, ms) => new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => { if (e.cancelled || Date.now() - t0 >= ms) { clearInterval(iv); resolve(); } }, 120);
  });
  const emit = (uid, event, data) => socketByUser.get(uid)?.emit(event, data);
  const inHall = (uid) => meByUser.get(uid)?.inside === 'events';
  const hallOf = (e) => [...e.parts.keys()].filter(inHall); // quem está dentro do salão agora
  const wpick = (table) => pickSpecies(table); // [valor, peso] — mesma função genérica usada pra sortear espécie selvagem

  const status = () => (ev ? { id: ev.id, type: ev.type, name: types[ev.type].name, icon: types[ev.type].icon, phase: ev.phase, startsAt: ev.startsAt, startsIn: Math.max(0, ev.startsAt - Date.now()), n: ev.q?.n || 0, total: ev.total || 0, players: ev.parts.size, where: types[ev.type].where || null } : null);
  const pushStatus = (force = true) => {
    if (!force) { if (Date.now() - statusTimer < 1500) return; }
    statusTimer = Date.now();
    io.emit('event:status', status());
  };

  // ---------------------------------------------------------------- participação (comum a todos os tipos)
  function join(uid) {
    if (!ev || !(ev.phase === 'lobby' || ev.phase === 'running') || !inHall(uid)) return;
    if (!ev.parts.has(uid)) { ev.parts.set(uid, { name: meByUser.get(uid).username, score: 0, correct: 0, answered: 0, time: 0, streak: 0 }); pushStatus(); }
    emit(uid, 'event:joined', { id: ev.id, type: ev.type, phase: ev.phase, startsAt: ev.startsAt, startsIn: Math.max(0, ev.startsAt - Date.now()), players: ev.parts.size, q: ev.q && Date.now() < ev.q.endsAt ? publicQ(ev.q, uid) : null });
  }
  const publicQ = (qq, uid) => ({ n: qq.n, total: ev.total, text: qq.text, options: qq.options, species_id: qq.species_id, endsAt: qq.endsAt, left: Math.max(0, qq.endsAt - Date.now()), ms: ev.qms || Q_MS, answered: false, tie: !!qq.tie, spectator: !!(qq.tie && uid && !ev.tie?.has(uid)) });

  function answer(uid, { n, choice } = {}) {
    if (!ev || ev.phase !== 'running' || !['quiz', 'lightning', 'golden'].includes(ev.type) || !ev.q || ev.q.n !== n || !Number.isInteger(choice) || choice < 0 || choice > 3) return;
    const p = ev.parts.get(uid);
    const now = Date.now();
    if (!p || !inHall(uid) || ev.q.answers.has(uid) || now > ev.q.endsAt + 350) return;
    if (ev.tie && !ev.tie.has(uid)) return; // desempate: só quem empatou responde
    const ms = ev.qms || Q_MS;
    const right = choice === ev.q.answer;
    const took = Math.min(ms, now - ev.q.startedAt);
    if (ev.tie) { p.time += took; ev.q.answers.set(uid, { choice, gained: 0, right, took }); emit(uid, 'event:answered', { n }); return; }
    let gained = 0;
    if (ev.type === 'golden') gained = right ? 1 : 0; // Pergunta de Ouro: pontuação não importa, só quem respondeu certo primeiro
    else { if (right) { p.streak++; gained = 100 + Math.round(100 * (1 - took / ms)) + Math.min(p.streak - 1, 5) * 10; p.correct++; } else p.streak = 0; }
    p.score += gained; p.answered++; p.time += took;
    ev.q.answers.set(uid, { choice, gained, right, took });
    emit(uid, 'event:answered', { n });
  }

  // "Quem é Esse Pokémon?": resposta por texto (nome do Pokémon), não por múltipla escolha
  function answerText(uid, { n, guess } = {}) {
    if (!ev || ev.phase !== 'running' || ev.type !== 'whosthat' || !ev.q || ev.q.n !== n) return;
    const p = ev.parts.get(uid);
    const now = Date.now();
    if (!p || !inHall(uid) || ev.q.answers.has(uid) || now > ev.q.endsAt + 350) return;
    const right = normName(guess) === normName(SPECIES[ev.q.species_id].name);
    const took = Math.min(Q_MS, now - ev.q.startedAt);
    let gained = 0;
    if (right) { p.streak++; gained = 100 + Math.round(100 * (1 - took / Q_MS)) + Math.min(p.streak - 1, 5) * 10; p.correct++; } else p.streak = 0;
    p.score += gained; p.answered++; p.time += took;
    ev.q.answers.set(uid, { guess, gained, right, took });
    emit(uid, 'event:answered', { n });
  }

  // ---------------------------------------------------------------- eventos "de mundo": andar até o item/bandeira
  function onMove(uid, me) {
    if (!ev || ev.phase !== 'running' || me.world !== 'town' || !ev.parts.has(uid)) return;
    if (ev.type === 'treasure' || ev.type === 'ballrain' || ev.type === 'xmas') {
      for (const [id, pk] of ev.pickups) {
        if (Math.hypot(me.x - pk.x, me.y - pk.y) > PICKUP_R) continue;
        ev.pickups.delete(id);
        const p = ev.parts.get(uid);
        if (ev.type === 'treasure' || ev.type === 'xmas') { p.score += pk.tier.val; emit(uid, 'event:pickup', { icon: pk.tier.icon, val: pk.tier.val }); }
        else { p.score += pk.amount; durable('evento-bolas', () => prisma.user.update({ where: { id: uid }, data: { pokeballs: { increment: pk.amount } } })).then((u) => u && emit(uid, 'inventory', { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs })); emit(uid, 'event:pickup', { icon: '🎾', val: pk.amount }); }
        pushStatus(false);
        break;
      }
    } else if (ev.type === 'race') {
      const pr = ev.progress.get(uid) || { next: 0, t0: Date.now(), done: false };
      ev.progress.set(uid, pr);
      if (pr.done) return;
      const cp = RACE_CHECKPOINTS[pr.next];
      if (Math.hypot(me.x - cp.x, me.y - cp.y) > PICKUP_R) return;
      pr.next++;
      if (pr.next >= RACE_CHECKPOINTS.length) {
        pr.done = true;
        const time = Date.now() - pr.t0;
        const p = ev.parts.get(uid);
        p.time = time; p.score = Math.max(1, 1000000 - time); p.answered = 1;
        emit(uid, 'event:finish', { time });
        io.emit('notice', { msg: `🏁 ${p.name} terminou a Corrida da Praça em ${(time / 1000).toFixed(1)} s!` });
      } else emit(uid, 'event:checkpoint', { next: pr.next, total: RACE_CHECKPOINTS.length, x: cp.x, y: cp.y });
      pushStatus(false);
    }
  }

  // ---------------------------------------------------------------- captura/vitória (Captura Relâmpago, Hora da Sorte)
  const RARITY_PTS = { common: 5, uncommon: 10, rare: 18, epic: 32 };
  function onBattleEnd(uid, result, species_id) {
    if (Date.now() < luckUntil && (result === 'win' || result === 'caught')) {
      durable('evento-sorte', () => prisma.user.update({ where: { id: uid }, data: { apricorns: { increment: LUCK_BONUS.apricorns }, shards: { increment: LUCK_BONUS.shards } } }))
        .then((u) => u && emit(uid, 'inventory', { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs }));
      emit(uid, 'event:luck', { apricorns: LUCK_BONUS.apricorns, shards: LUCK_BONUS.shards });
    }
    if (!ev || ev.type !== 'capture' || ev.phase !== 'running' || result !== 'caught') return;
    const p = ev.parts.get(uid);
    if (!p) return;
    const pts = RARITY_PTS[SPECIES[species_id]?.rarity] || RARITY_PTS.common;
    p.score += pts; p.correct++; p.answered++;
    emit(uid, 'event:pickup', { icon: '🎯', val: pts, name: SPECIES[species_id]?.name });
    pushStatus(false);
  }

  // ---------------------------------------------------------------- ranking e prêmios (genérico pra todo tipo competitivo)
  const rank = (e) => [...e.parts.entries()].map(([uid, p]) => ({ uid, ...p })).sort((a, b) => (b.uid === e.winner) - (a.uid === e.winner) || b.score - a.score || a.time - b.time);

  function prizeFor(list, i, e) {
    if (e.type === 'golden') return i === 0 && e.winner ? { ...PRIZES[1] } : null; // tudo ou nada: só quem acertou primeiro leva prêmio
    const r = list[i];
    let prize = null;
    const winnerBypass = i === 0 && !!e.winner; // vencedor definido por e.winner (desempate do quiz, Duelo Relâmpago), não só por pontuação
    if (list.length >= 2 && i < 3 && (r.score > 0 || winnerBypass)) prize = { ...PRIZES[i + 1] };
    else if (r.correct >= 5 || r.score >= 20) prize = { ...PRIZES.good };
    else if (r.answered > 0 || r.score > 0) prize = { ...PRIZES.any };
    return prize;
  }

  async function grant(uid, prize) {
    if (!prize) return;
    const data = {};
    for (const [k, n] of Object.entries(prize)) data[k] = { increment: n };
    const u = await durable('evento-premio', () => prisma.user.update({ where: { id: uid }, data }));
    if (u) emit(uid, 'inventory', { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });
  }

  async function finish(e) {
    e.phase = 'results';
    e.q = null;
    const def = types[e.type];
    if (def.competitive === false) { // Hora da Sorte, Roleta Dourada: já concederam tudo dentro do run(); só anuncia o fim
      io.emit('notice', { msg: `${def.icon} ${def.name} acabou!`, big: true });
      for (const uid of e.parts.keys()) emit(uid, 'event:end', { id: e.id, custom: true, top: [], total: e.total, you: e.parts.get(uid).wonPrize !== undefined ? { prize: e.parts.get(uid).wonPrize } : null });
      await durable('evento-log', () => prisma.eventLog.create({ data: { type: e.type, players: e.parts.size, winner: '', data: '{}' } }));
      pushStatus();
      await sleepUntil({ cancelled: false }, END_MS);
      return;
    }
    const list = rank(e);
    const prizes = list.map((r, i) => prizeFor(list, i, e));
    await Promise.all(list.map((r, i) => grant(r.uid, prizes[i])));
    const top = list.slice(0, 10).map((r) => ({ name: r.name, score: r.score, correct: r.correct }));
    list.forEach((r, i) => emit(r.uid, 'event:end', { id: e.id, top, total: e.total, you: { rank: i + 1, of: list.length, score: r.score, correct: r.correct, prize: prizes[i] } }));
    if (e.type === 'golden' && !e.winner) io.emit('notice', { msg: `🌟 ${def.name}: ninguém acertou a tempo. O prêmio ficou pra próxima!`, big: true });
    else if (list[0]) io.emit('notice', { msg: `🏆 ${def.name}: ${list[0].name} venceu${e.type === 'duel' || e.type === 'golden' ? '' : ` com ${list[0].score} ponto${list[0].score === 1 ? '' : 's'}`}! (${list.length} jogador${list.length > 1 ? 'es' : ''})`, big: true });
    await durable('evento-log', () => prisma.eventLog.create({ data: { type: e.type, players: list.length, winner: list[0]?.name || '', data: JSON.stringify({ by: e.by, top }).slice(0, 2000) } }));
    pushStatus();
    await sleepUntil({ cancelled: false }, END_MS);
  }

  // ---------------------------------------------------------------- tipo: QUIZ e sua variante PERGUNTA RELÂMPAGO
  async function runTrivia(e, n, ms) {
    const qs = makeQuiz(n);
    e.total = qs.length;
    e.qms = ms;
    e.phase = 'running';
    for (let i = 0; i < qs.length && !e.cancelled; i++) {
      const qq = qs[i];
      const startedAt = Date.now();
      e.q = { n: i + 1, text: qq.text, options: qq.options, answer: qq.answer, startedAt, endsAt: startedAt + ms, answers: new Map() };
      pushStatus();
      hallOf(e).forEach((uid) => emit(uid, 'event:question', publicQ(e.q, uid)));
      await sleepUntil(e, ms + 250);
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
    if (e.cancelled) return false;
    await tiebreak(e);
    return !e.cancelled;
  }
  function runQuiz(e) { return runTrivia(e, QUIZ_N, Q_MS); }
  function runLightning(e) { return runTrivia(e, LIGHTNING_N, LIGHTNING_MS); }

  // Pergunta de Ouro: uma pergunta só; só quem acerta PRIMEIRO (menor tempo de resposta) ganha o prêmio — os demais, nada.
  async function runGolden(e) {
    const qq = makeQuiz(1)[0];
    e.total = 1;
    e.qms = GOLDEN_MS;
    e.phase = 'running';
    const startedAt = Date.now();
    e.q = { n: 1, text: qq.text, options: qq.options, answer: qq.answer, startedAt, endsAt: startedAt + GOLDEN_MS, answers: new Map() };
    pushStatus();
    hallOf(e).forEach((uid) => emit(uid, 'event:question', publicQ(e.q, uid)));
    await sleepUntil(e, GOLDEN_MS + 250);
    if (e.cancelled) return false;
    const correct = [...e.q.answers.entries()].filter(([, a]) => a.right).sort((a, b) => a[1].took - b[1].took);
    if (correct.length) e.winner = correct[0][0];
    for (const [uid, p] of e.parts) {
      const a = e.q.answers.get(uid);
      emit(uid, 'event:reveal', { n: 1, correct: qq.answer, choice: a ? a.choice : null, gained: uid === e.winner ? 1 : 0, score: p.score, rank: uid === e.winner ? 1 : 2, of: e.parts.size, top: [] });
    }
    return true;
  }

  // Captura Relâmpago: não tem "pergunta" — o placar roda sozinho conforme capturas acontecem em qualquer mundo (onBattleEnd)
  async function runCapture(e) {
    e.phase = 'running'; e.total = 0;
    pushStatus();
    await sleepUntil(e, CAPTURE_MS);
    return !e.cancelled;
  }

  // Desempate: se o 1º lugar está empatado, novas perguntas SÓ para os empatados (morte súbita).
  // Quem erra/não responde sai, se pelo menos um acertou. Sem vencedor em 8 rodadas: vence quem foi mais rápido.
  async function tiebreak(e) {
    const list = rank(e);
    if (list.length < 2) return;
    let tied = new Set(list.filter((r) => r.score === list[0].score).map((r) => r.uid));
    if (tied.size < 2) return;
    const nameOf = (u) => e.parts.get(u).name;
    e.hadTie = true;
    for (let round = 1; round <= 8 && tied.size > 1 && !e.cancelled; round++) {
      const names = [...tied].map(nameOf);
      hallOf(e).forEach((uid) => emit(uid, 'event:tie', { round, names }));
      io.emit('notice', { msg: `⚔ Empate em 1º no ${types[e.type].name}! Desempate: ${names.join(', ')}` });
      await sleepUntil(e, FAST ? 400 : 4000);
      if (e.cancelled) return;
      const qq = makeQuiz(1)[0];
      const startedAt = Date.now();
      const ms = e.qms || Q_MS;
      e.tie = tied;
      e.q = { n: e.total + round, tie: true, text: qq.text, options: qq.options, answer: qq.answer, startedAt, endsAt: startedAt + ms, answers: new Map() };
      hallOf(e).forEach((uid) => emit(uid, 'event:question', publicQ(e.q, uid)));
      await sleepUntil(e, ms + 250);
      if (e.cancelled) return;
      const right = [...tied].filter((u) => e.q.answers.get(u)?.right);
      if (right.length >= 1 && right.length < tied.size) tied = new Set(right);
      const list2 = rank(e);
      const top = list2.slice(0, 5).map((r) => ({ name: r.name, score: r.score }));
      for (const [uid] of e.parts) {
        const a = e.q.answers.get(uid);
        emit(uid, 'event:reveal', { n: e.q.n, tie: true, correct: qq.answer, choice: a ? a.choice : null, gained: 0, score: e.parts.get(uid).score, rank: list2.findIndex((r) => r.uid === uid) + 1, of: list2.length, top, left: [...tied].map(nameOf) });
      }
      await sleepUntil(e, REVEAL_MS);
    }
    e.tie = null;
    if (tied.size > 1) { // ainda empatados: o mais rápido nas respostas leva
      e.winner = [...tied].sort((a, b) => e.parts.get(a).time - e.parts.get(b).time)[0];
    } else e.winner = [...tied][0];
  }

  // ---------------------------------------------------------------- tipo: QUEM É ESSE POKÉMON?
  async function runWhosThat(e) {
    e.total = WHOSTHAT_N;
    e.phase = 'running';
    const seen = new Set();
    for (let i = 0; i < WHOSTHAT_N && !e.cancelled; i++) {
      let sid; do { sid = SPECIES_IDS[rand(0, SPECIES_IDS.length - 1)]; } while (seen.has(sid) && seen.size < SPECIES_IDS.length);
      seen.add(sid);
      const startedAt = Date.now();
      e.q = { n: i + 1, species_id: sid, startedAt, endsAt: startedAt + Q_MS, answers: new Map() };
      pushStatus();
      hallOf(e).forEach((uid) => emit(uid, 'event:question', publicQ(e.q, uid)));
      await sleepUntil(e, Q_MS + 250);
      if (e.cancelled) return false;
      const list = rank(e);
      const top = list.slice(0, 5).map((r) => ({ name: r.name, score: r.score }));
      for (const [uid, p] of e.parts) {
        const a = e.q.answers.get(uid);
        if (!a) p.streak = 0;
        emit(uid, 'event:reveal', { n: e.q.n, correct: SPECIES[sid].name, choice: a?.guess ?? null, gained: a?.gained || 0, score: p.score, rank: list.findIndex((r) => r.uid === uid) + 1, of: list.length, top });
      }
      if (i < WHOSTHAT_N - 1) await sleepUntil(e, REVEAL_MS);
    }
    return !e.cancelled;
  }

  // ---------------------------------------------------------------- tipo: CAÇA AO TESOURO
  function spawnTreasures(e) {
    let id = 0;
    for (let tries = 0; tries < 4000 && e.pickups.size < TREASURE_N; tries++) {
      const tx = rand(30, 70), ty = rand(30, 70);
      if (!world.isWalkable(tx, ty, 'town')) continue;
      e.pickups.set(id++, { x: (tx + 0.5) * 32, y: (ty + 0.5) * 32, tier: wpick(TREASURE_TIERS) });
    }
  }
  async function runTreasure(e) {
    e.phase = 'running'; e.total = 0; e.pickups = new Map();
    spawnTreasures(e);
    pushStatus();
    await sleepUntil(e, TREASURE_MS);
    e.pickups.clear();
    return !e.cancelled;
  }

  // ---------------------------------------------------------------- tipo: CAÇA AOS PRESENTES DE NATAL (sazonal)
  function spawnGifts(e) {
    let id = 0;
    for (let tries = 0; tries < 4000 && e.pickups.size < GIFT_N; tries++) {
      const tx = rand(30, 70), ty = rand(30, 70);
      if (!world.isWalkable(tx, ty, 'town')) continue;
      e.pickups.set(id++, { x: (tx + 0.5) * 32, y: (ty + 0.5) * 32, tier: wpick(GIFT_TIERS) });
    }
  }
  async function runXmas(e) {
    e.phase = 'running'; e.total = 0; e.pickups = new Map();
    spawnGifts(e);
    pushStatus();
    await sleepUntil(e, GIFT_MS);
    e.pickups.clear();
    return !e.cancelled;
  }

  // ---------------------------------------------------------------- tipo: CHUVA DE POKÉBOLAS
  async function runBallRain(e) {
    e.phase = 'running'; e.total = 0; e.pickups = new Map(); e.nextPid = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < BALLRAIN_MS && !e.cancelled) {
      for (let i = 0; i < BALLRAIN_PER_WAVE; i++) {
        for (let tries = 0; tries < 300; tries++) {
          const tx = rand(30, 70), ty = rand(30, 70);
          if (!world.isWalkable(tx, ty, 'town')) continue;
          e.pickups.set(e.nextPid++, { x: (tx + 0.5) * 32, y: (ty + 0.5) * 32, amount: rand(1, 3) });
          break;
        }
      }
      pushStatus();
      await sleepUntil(e, BALLRAIN_WAVE_MS);
    }
    e.pickups.clear();
    return !e.cancelled;
  }

  // ---------------------------------------------------------------- tipo: CORRIDA DA PRAÇA
  async function runRace(e) {
    e.phase = 'running'; e.total = RACE_CHECKPOINTS.length; e.progress = new Map();
    pushStatus();
    for (const uid of e.parts.keys()) emit(uid, 'event:checkpoint', { next: 0, total: RACE_CHECKPOINTS.length, x: RACE_CHECKPOINTS[0].x, y: RACE_CHECKPOINTS[0].y });
    await sleepUntil(e, FAST ? 20000 : 240000); // 4 min pra completar
    return !e.cancelled;
  }

  // ---------------------------------------------------------------- tipo: HORA DA SORTE (não-competitivo)
  async function runLuck(e) {
    e.phase = 'running'; e.total = 0;
    luckUntil = Date.now() + LUCK_MS;
    pushStatus();
    await sleepUntil(e, LUCK_MS);
    luckUntil = 0;
    return true;
  }

  // ---------------------------------------------------------------- tipo: ROLETA DOURADA (não-competitivo)
  async function runWheel(e) {
    e.phase = 'running'; e.total = 0;
    pushStatus();
    await sleepUntil(e, WHEEL_WAIT_MS);
    if (e.cancelled) return false;
    for (const [uid, p] of e.parts) {
      const prize = { ...wpick(WHEEL_PRIZES) };
      await grant(uid, prize);
      p.wonPrize = prize; p.score = 1;
      emit(uid, 'event:wheel', { prize });
    }
    return true;
  }

  // ---------------------------------------------------------------- tipo: DUELO RELÂMPAGO (torneio-sorteio)
  function shuffle(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = rand(0, i); [r[i], r[j]] = [r[j], r[i]]; } return r; }
  async function runDuel(e) {
    e.phase = 'running'; e.total = 0;
    let players = shuffle([...e.parts.keys()]);
    if (players.length < 2) { io.emit('notice', { msg: '⚔ Duelo Relâmpago cancelado: poucos participantes no salão.' }); return false; }
    let round = 1;
    while (players.length > 1 && !e.cancelled) {
      const next = [], results = [];
      for (let i = 0; i < players.length; i += 2) {
        if (i + 1 >= players.length) { next.push(players[i]); continue; } // bye: avança sozinho
        const [a, b] = [players[i], players[i + 1]];
        const winner = Math.random() < 0.5 ? a : b;
        next.push(winner);
        results.push({ a, b, winner });
        const pa = e.parts.get(a).name, pb = e.parts.get(b).name;
        emit(a, 'event:duel', { round, opponent: pb, win: winner === a });
        emit(b, 'event:duel', { round, opponent: pa, win: winner === b });
      }
      pushStatus();
      if (results.length) io.emit('notice', { msg: `⚔ Duelo Relâmpago — Rodada ${round}: ${results.map((r) => `${e.parts.get(r.a).name} × ${e.parts.get(r.b).name} → ${e.parts.get(r.winner).name}`).join(' · ')}` });
      await sleepUntil(e, DUEL_ROUND_MS);
      players = next;
      round++;
    }
    if (e.cancelled) return false;
    e.winner = players[0];
    return true;
  }

  // ---------------------------------------------------------------- ciclo de vida
  function start(typeId, { by = 'auto', lobbyMs = LOBBY_MS } = {}) {
    if (typeId === 'worldboss') return worldBoss.start({ by });
    const def = types[typeId];
    if (!def) return { error: 'Tipo de evento desconhecido' };
    if (ev) return { error: 'Já existe um evento em andamento' };
    const e = { id: Date.now(), type: typeId, by, phase: 'lobby', startsAt: Date.now() + lobbyMs, parts: new Map(), cancelled: false, total: 0, q: null };
    ev = e;
    io.emit('event:announce', { id: e.id, type: typeId, name: def.name, icon: def.icon, startsAt: e.startsAt, startsIn: lobbyMs, where: def.where ? `${def.where}, na Cidade` : 'Salão de Eventos, na Cidade (casa da direita)' });
    io.emit('notice', { msg: `${def.icon} ${def.name} abre em ${Math.round(lobbyMs / 1000)} s! Entre no Salão de Eventos (Cidade, casa da direita) para participar.`, big: true });
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

  function cancel(typeId) {
    if (typeId === 'worldboss' || (!ev && worldBoss.status())) return worldBoss.cancel();
    if (!ev) return { error: 'Não há evento em andamento' };
    ev.cancelled = true;
    for (const uid of ev.parts.keys()) emit(uid, 'event:cancel', {});
    return { ok: true };
  }

  // ---------------------------------------------------------------- agendamento automático (persistido em Meta)
  // O automático sorteia entre todos os tipos "de salão" cadastrados; os sazonais (Natal) só entram na época deles.
  const autoTypes = () => Object.keys(types).filter((t) => !types[t].seasonal || isXmasActive());
  async function loadSettings() {
    try {
      const a = await prisma.meta.findUnique({ where: { key: 'events.auto' } });
      const n = await prisma.meta.findUnique({ where: { key: 'events.next' } });
      if (a) autoOn = a.value === '1';
      const saved = Number(n?.value);
      nextAt = Number.isFinite(saved) && saved > Date.now() ? saved : Date.now() + EVERY_MS;
      const wbSaved = Number((await prisma.meta.findUnique({ where: { key: 'events.wb.next' } }))?.value);
      nextWbAt = Number.isFinite(wbSaved) && wbSaved > Date.now() ? wbSaved : Date.now() + WB_EVERY_MS;
    } catch (e) { console.error('[eventos] config', e.message); }
  }
  const saveSetting = (key, value) => durable('evento-config', () => prisma.meta.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } }));
  async function setAuto(on) { autoOn = !!on; await saveSetting('events.auto', autoOn ? '1' : '0'); if (autoOn && nextAt < Date.now()) { nextAt = Date.now() + EVERY_MS; await saveSetting('events.next', nextAt); } }

  const timer = setInterval(() => {
    if (autoOn && Date.now() >= nextWbAt) { // Chefe de Mundo: de 2 em 2 h
      if (worldBoss.status()) nextWbAt = Date.now() + 60000;
      else if (worldBoss.start({ by: 'auto' }).ok) { nextWbAt = Date.now() + WB_EVERY_MS; saveSetting('events.wb.next', nextWbAt); }
    }
    if (!autoOn || Date.now() < nextAt) return;
    if (ev) { nextAt = Date.now() + 60000; return; } // ocupado: tenta de novo em 1 min
    const pool = autoTypes();
    const pick = pool[rand(0, pool.length - 1)];
    if (start(pick, { by: 'auto' }).ok) { nextAt = Date.now() + EVERY_MS; saveSetting('events.next', nextAt); }
  }, 5000);
  timer.unref();

  async function summary() {
    const recent = await prisma.eventLog.findMany({ orderBy: { id: 'desc' }, take: 8 });
    return {
      types: [...Object.values(types), WB_TYPE].map((t) => ({ id: t.id, name: t.name, icon: t.icon, desc: t.desc })),
      worldboss: worldBoss.status(),
      current: status(),
      auto: { enabled: autoOn, nextAt: autoOn ? nextAt : null, everyMin: EVERY_MS / 60000, wbNextAt: autoOn ? nextWbAt : null, wbEveryMin: WB_EVERY_MS / 60000 },
      recent: recent.map((r) => ({ type: r.type, at: r.started_at, players: r.players, winner: r.winner })),
    };
  }

  function bind(socket, uid) {
    socket.emit('event:status', status());
    socket.on('event:sync', () => socket.emit('event:status', status()));
    socket.on('event:answer', (p) => answer(uid, p || {}));
    socket.on('event:guess', (p) => answerText(uid, p || {}));
  }
  const onEnter = (uid) => join(uid);
  const onLeave = () => {};

  return { start, cancel, setAuto, summary, bind, onEnter, onLeave, onMove, onBattleEnd, init: loadSettings, status, PRIZES, ITEM_NAMES };
};
