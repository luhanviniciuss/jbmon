// Voz do grupo (VoIP). O áudio NÃO passa pelo servidor: os jogadores do mesmo grupo se conectam direto (WebRTC).
// Aqui só fazemos a sinalização: quem tem a voz ligada, e o repasse de ofertas/respostas/ICE — sempre e só entre
// membros do MESMO grupo que estão com a voz ligada (o servidor confere o grupo a cada mensagem).
const BURST = 120;
const REFILL_PER_S = 60;
const MAX_SIGNAL = 12000; // bytes (SDP costuma ter < 5 KB)

module.exports = function createVoip({ socketByUser, groupInfo }) {
  const on = new Set(); // uid com a voz ligada
  const buckets = new Map();
  const emit = (uid, ev, data) => socketByUser.get(uid)?.emit(ev, data);
  const mates = (uid) => (groupInfo(uid)?.members || []).filter((id) => id !== uid);

  const allow = (uid) => {
    const now = Date.now();
    const b = buckets.get(uid) || { t: BURST, last: now };
    b.t = Math.min(BURST, b.t + ((now - b.last) / 1000) * REFILL_PER_S);
    b.last = now;
    const ok = b.t >= 1;
    if (ok) b.t -= 1;
    buckets.set(uid, b);
    return ok;
  };

  function leave(uid) {
    if (!on.delete(uid)) return;
    mates(uid).forEach((id) => emit(id, 'voip:peer-left', { id: uid }));
  }

  function bind(socket, uid) {
    socket.on('voip:join', () => {
      const ms = mates(uid);
      if (!ms.length) return leave(uid);
      on.add(uid);
      socket.emit('voip:peers', ms.filter((id) => on.has(id)));
      ms.filter((id) => on.has(id)).forEach((id) => emit(id, 'voip:peer-joined', { id: uid }));
    });
    socket.on('voip:leave', () => leave(uid));
    socket.on('voip:signal', (p) => {
      if (!p || typeof p !== 'object' || !Number.isInteger(p.to) || !p.data || typeof p.data !== 'object') return;
      if (!allow(uid) || !on.has(uid) || !on.has(p.to) || !mates(uid).includes(p.to)) return;
      let size = 0;
      try { size = JSON.stringify(p.data).length; } catch { return; }
      if (size > MAX_SIGNAL) return;
      emit(p.to, 'voip:signal', { from: uid, data: p.data });
    });
  }

  return { bind, onDisconnect: (uid) => { leave(uid); buckets.delete(uid); } };
};
