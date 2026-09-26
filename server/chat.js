// Chat em tempo real: global (todos), grupo (só os membros do seu grupo) e sussurro (/w nome mensagem).
// O histórico do global fica só na memória (últimas mensagens para quem acabou de entrar); nada é gravado no banco.
const HISTORY = 60;
const MAX_LEN = 200;
const BURST = 5; // mensagens seguidas permitidas
const REFILL_MS = 1500; // 1 mensagem nova liberada a cada 1,5 s

module.exports = function createChat({ io, socketByUser, meByUser, groupMembers, clanMembers, moderation }) {
  const history = [];
  const buckets = new Map(); // uid -> { tokens, last }
  let nextId = 1;

  const allow = (uid) => {
    const now = Date.now();
    const b = buckets.get(uid) || { tokens: BURST, last: now };
    b.tokens = Math.min(BURST, b.tokens + (now - b.last) / REFILL_MS);
    b.last = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    buckets.set(uid, b);
    return ok;
  };
  // remove caracteres de controle e de direção de texto (evitam mensagens "invisíveis" ou que embaralham a tela)
  const clean = (t) => String(t ?? '').replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);

  function bind(socket, uid) {
    const error = (msg) => socket.emit('chat:error', msg);
    socket.emit('chat:history', history);
    socket.on('chat:send', (p) => {
      const me = meByUser.get(uid);
      if (!me || !p || typeof p !== 'object') return;
      const text = clean(p.text);
      if (!text) return;
      const muted = moderation.muteOf(uid);
      if (muted) return error('🔇 Você está silenciado ' + moderation.describe(muted));
      if (!allow(uid)) return error('Devagar! Você está enviando mensagens rápido demais.');
      const base = { id: nextId++, from: me.username, fromId: uid, text, ts: Date.now(), admin: me.role === 'admin', tag: me.clan?.tag || null };

      if (p.ch === 'group') {
        const members = groupMembers(uid);
        if (!members.length) return error('Você não está em um grupo.');
        members.forEach((id) => socketByUser.get(id)?.emit('chat:msg', { ...base, ch: 'group' }));
      } else if (p.ch === 'clan') {
        if (!me.clan) return error('Você não está em um clã.');
        clanMembers(me.clan.id).forEach((id) => socketByUser.get(id)?.emit('chat:msg', { ...base, ch: 'clan' }));
      } else if (p.ch === 'w') {
        const to = String(p.to || '').trim().toLowerCase();
        const target = [...meByUser.values()].find((m) => m.username.toLowerCase() === to);
        if (!target || target.id === uid) return error('Jogador não encontrado (ele precisa estar online).');
        [uid, target.id].forEach((id) => socketByUser.get(id)?.emit('chat:msg', { ...base, ch: 'w', to: target.username }));
      } else {
        const msg = { ...base, ch: 'global' };
        history.push(msg);
        if (history.length > HISTORY) history.shift();
        io.emit('chat:msg', msg);
      }
    });
  }

  return { bind };
};
