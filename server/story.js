// Modo História: progresso por jogador (tabela player_progress), missões, chefes de cenário, bloqueios e dicas.
// O servidor decide tudo: o cliente só mostra o estado ('story:state') e envia pedidos (falar, escolher inicial, desafiar chefe).
const { STARTERS, CHIEFS, STORY, GATES } = require('../public/story-data.js');
const { calcStats } = require('../public/species.js');
const { TILE } = require('../public/map.js');

module.exports = function createStory({ prisma, socketByUser, meByUser, durable, nextFreeSlot, dexMark, onTeamChanged }) {
  const states = new Map(); // uid -> { chapter, step, count, tips }

  const view = (st) => ({ chapter: st.chapter, step: st.step, count: st.count, tips: st.tips });
  const emitState = (uid) => { const st = states.get(uid); if (st) socketByUser.get(uid)?.emit('story:state', view(st)); };
  const say = (uid, msg, big) => socketByUser.get(uid)?.emit('notice', { msg, big });
  const stepOf = (st) => STORY[st.chapter - 1]?.steps[st.step] || null;
  const save = (uid) => {
    const st = states.get(uid);
    if (!st) return;
    return durable('historia', () => prisma.storyProgress.update({ where: { user_id: uid }, data: { chapter: st.chapter, step: st.step, count: st.count, tips: st.tips } }));
  };

  async function load(uid) {
    let row = await prisma.storyProgress.findUnique({ where: { user_id: uid } });
    if (!row) row = await prisma.storyProgress.create({ data: { user_id: uid } });
    states.set(uid, { chapter: row.chapter, step: row.step, count: row.count, tips: row.tips });
    emitState(uid);
  }

  async function grant(uid, reward) {
    const data = {};
    if (reward.pokeballs) data.pokeballs = { increment: reward.pokeballs };
    if (reward.greatballs) data.greatballs = { increment: reward.greatballs };
    if (reward.apricorns) data.apricorns = { increment: reward.apricorns };
    if (reward.shards) data.shards = { increment: reward.shards };
    const u = await durable('recompensa', () => prisma.user.update({ where: { id: uid }, data }));
    if (u) socketByUser.get(uid)?.emit('inventory', { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });
  }

  // A missão atual foi cumprida: avança (e, no fim do capítulo, entrega a recompensa e abre o próximo)
  async function complete(uid) {
    const st = states.get(uid);
    if (!st) return;
    const chapter = STORY[st.chapter - 1];
    if (!chapter) return;
    const done = chapter.steps[st.step];
    st.step++;
    st.count = 0;
    if (st.step >= chapter.steps.length) {
      st.chapter++;
      st.step = 0;
      await grant(uid, chapter.reward);
      socketByUser.get(uid)?.emit('story:complete', { chapter: chapter.id, title: chapter.title, reward: chapter.reward, last: !STORY[st.chapter - 1] });
    } else {
      say(uid, '✔ Missão cumprida: ' + done.text);
    }
    await save(uid);
    emitState(uid);
    // Quem já capturou Pokémon antes do Modo História não precisa capturar de novo
    const next = stepOf(st);
    if (next?.kind === 'capture') {
      const n = await prisma.pokemon.count({ where: { user_id: uid } });
      if (n >= 3) { await complete(uid); }
    }
  }

  // ---- eventos do jogo ----
  const inside = (uid) => meByUser.get(uid)?.inside;

  async function talk(uid) {
    const st = states.get(uid);
    if (!st || inside(uid) !== 'prof') return;
    if (stepOf(st)?.kind === 'talk') await complete(uid);
  }

  async function starter(uid, species) {
    const st = states.get(uid);
    if (!st || inside(uid) !== 'prof' || stepOf(st)?.kind !== 'starter' || !STARTERS.includes(species)) return false;
    const stt = calcStats(species, 5);
    const slot = await nextFreeSlot(prisma, uid);
    await durable('inicial', () => prisma.pokemon.create({ data: { user_id: uid, species_id: species, level: 5, hp: stt.hp, attack: stt.attack, defense: stt.defense, current_hp: stt.hp, slot } }));
    onTeamChanged?.(uid);
    await complete(uid);
    return true;
  }

  // Derrotou (ou capturou) um Pokémon selvagem comum
  async function onWildEnd(uid, result, worldId) {
    const st = states.get(uid);
    const step = st && stepOf(st);
    if (!step) return;
    if (step.kind === 'capture' && result === 'caught') st.count++;
    else if (step.kind === 'defeat' && step.world === worldId && (result === 'win' || result === 'caught')) st.count++;
    else return;
    if (st.count >= step.need) return complete(uid);
    await save(uid);
    emitState(uid);
  }

  async function onWorld(uid, worldId) {
    const st = states.get(uid);
    const step = st && stepOf(st);
    if (step?.kind === 'world' && step.world === worldId) await complete(uid);
  }

  async function onMove(uid, me) {
    const st = states.get(uid);
    const step = st && stepOf(st);
    if (step?.kind !== 'reach' || me.world !== step.world) return;
    if (Math.hypot(me.x / TILE - (step.tx + 0.5), me.y / TILE - (step.ty + 0.5)) <= step.radius) await complete(uid);
  }

  async function onChiefDefeated(uid, chiefId) {
    const st = states.get(uid);
    const step = st && stepOf(st);
    if (step?.kind === 'chief' && step.chief === chiefId) await complete(uid);
  }

  // O jogador tocou no chefe: devolve o chefe se pode lutar agora, ou uma mensagem explicando por quê não
  function challenge(uid, chiefId) {
    const chief = CHIEFS[chiefId];
    const me = meByUser.get(uid);
    const st = states.get(uid);
    if (!chief || !me || !st) return { error: 'Desafio inválido.' };
    if (me.world !== chief.world) return { error: 'Esse chefe está em outro mundo.' };
    if (Math.hypot(me.x / TILE - (chief.tx + 0.5), me.y / TILE - (chief.ty + 0.5)) > 3) return { error: 'Chegue mais perto do chefe.' };
    const step = stepOf(st);
    if (!(step?.kind === 'chief' && step.chief === chiefId)) {
      const done = st.chapter > (chiefId === 'ice' ? 2 : 3);
      return { error: done ? `${chief.name}: "Você já me derrotou! Siga em frente, treinador."` : `${chief.name}: "Ainda não é a hora. Cumpra as missões do Diário primeiro."` };
    }
    return { chief };
  }

  // Bloqueio dos mundos até concluir capítulos (admin ignora)
  function gate(uid, dest) {
    const g = GATES[dest];
    const me = meByUser.get(uid);
    const st = states.get(uid);
    if (!g || me?.role === 'admin' || !st) return null;
    return st.chapter - 1 >= g.chapters ? null : g.msg;
  }

  async function setTips(uid, mode) {
    const st = states.get(uid);
    if (!st) return;
    st.tips = mode === 'done' ? 1 : mode === 'skip' ? 2 : 0;
    await save(uid);
    emitState(uid);
  }

  return { load, drop: (uid) => states.delete(uid), talk, starter, onWildEnd, onWorld, onMove, onChiefDefeated, challenge, gate, setTips, state: (uid) => states.get(uid) };
};
