// Configurações do jogador e voz do grupo (VoIP por WebRTC, ponto a ponto entre os membros do grupo).
// O servidor só faz a sinalização (server/voip.js); o áudio vai direto de um jogador para o outro.
const Settings = (() => {
  const KEY = 'jbmon.settings';
  const RTC = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  let cfg = { voip: false, muted: false, vol: 1, buddy: true };
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

  let socket = null;
  let stream = null; // microfone
  let starting = false;
  let actx = null;
  const peers = new Map(); // uid -> { pc, audio, pending:[], remoteSet, an, speaking }
  let me = { an: null, speaking: false };

  const isOpen = () => $('settings').classList.contains('open');
  const inGroup = () => !!GROUP && GROUP.members.length > 1;
  const nameOf = (id) => GROUP?.members.find((m) => m.id === id)?.username || '?';
  const send = (to, data) => socket.emit('voip:signal', { to, data });

  // ---------------------------------------------------------------- painel
  function open(on = !isOpen()) {
    $('settings').classList.toggle('open', on);
    $('settings').setAttribute('aria-hidden', !on);
    if (!on) return;
    ['drawer', 'bag', 'group', 'arena'].forEach((id) => $(id).classList.remove('open'));
    render();
  }

  function status() {
    if (!cfg.voip) return ['off', 'Desligada'];
    if (!inGroup()) return ['wait', 'Ligada — vale quando você estiver em um grupo com 2 ou mais jogadores'];
    if (!stream) return ['wait', 'Pedindo acesso ao microfone…'];
    const n = [...peers.values()].filter((p) => p.pc.connectionState === 'connected').length;
    return ['on', n ? 'Conectado com ' + n + ' jogador' + (n > 1 ? 'es' : '') : 'Ligada — aguardando os outros ligarem a voz'];
  }

  function render() {
    if (!isOpen()) return;
    const [st, txt] = status();
    const members = GROUP ? GROUP.members.filter((m) => m.id !== MY_ID) : [];
    $('settingsBody').innerHTML =
      '<div class="section-title">Jogo</div>' +
      '<label class="setrow"><span><b>Pokémon ao meu lado</b><small>Seu primeiro Pokémon anda com você (e você vê os dos outros jogadores).</small></span><input type="checkbox" class="switch" id="setBuddy"' + (cfg.buddy ? ' checked' : '') + ' /></label>' +
      '<button class="btn small" id="setTips">📘 Rever as dicas do jogo</button>' +
      '<div class="section-title">Voz do grupo (VoIP)</div>' +
      '<label class="setrow"><span><b>Conversar por voz com o grupo</b><small>Só quem está no seu grupo e com a voz ligada ouve você.</small></span><input type="checkbox" class="switch" id="setVoip"' + (cfg.voip ? ' checked' : '') + ' /></label>' +
      '<div class="voipstat ' + st + '">' + esc(txt) + '</div>' +
      '<label class="setrow"><span><b>Silenciar meu microfone</b><small>Você continua ouvindo os outros.</small></span><input type="checkbox" class="switch" id="setMute"' + (cfg.muted ? ' checked' : '') + ' /></label>' +
      '<label class="setrow col"><span><b>Volume dos colegas</b></span><input type="range" id="setVol" min="0" max="100" value="' + Math.round(cfg.vol * 100) + '" /></label>' +
      (GROUP ? '<div class="section-title">Grupo</div>' + members.map((m) => {
        const p = peers.get(m.id);
        const state = p?.pc.connectionState === 'connected' ? '🔊 na voz' : p ? '… conectando' : 'sem voz';
        return '<div class="item vm"><span class="avatar sm" data-vid="' + m.id + '">' + esc(m.username[0]) + '</span><div><b>' + esc(m.username) + '</b></div><em>' + state + '</em></div>';
      }).join('') : '') +
      '<p class="hintline">O áudio vai direto entre os jogadores (não passa pelo servidor). O navegador pede permissão do microfone, e a voz só funciona em <b>HTTPS</b> (ou localhost). Se a conexão não fechar, alguma rede pode estar bloqueando conexões diretas.</p>';
    $('setTips').addEventListener('click', () => { open(false); Story.showTips(true); });
    $('setBuddy').addEventListener('change', (e) => { cfg.buddy = e.target.checked; save(); });
    $('setVoip').addEventListener('change', (e) => { cfg.voip = e.target.checked; save(); sync(); });
    $('setMute').addEventListener('change', (e) => { cfg.muted = e.target.checked; save(); applyMute(); render(); });
    $('setVol').addEventListener('input', (e) => { cfg.vol = e.target.value / 100; save(); peers.forEach((p) => (p.audio.volume = cfg.vol)); });
  }

  function chip() {
    const c = $('voiceChip');
    const live = cfg.voip && inGroup() && !!stream;
    c.hidden = !live;
    c.textContent = cfg.muted ? '🔇 Mudo' : '🎙 Voz';
    c.classList.toggle('muted', cfg.muted);
  }

  // ---------------------------------------------------------------- microfone e conexões
  function applyMute() { stream?.getAudioTracks().forEach((t) => (t.enabled = !cfg.muted)); chip(); }

  function watch(target, s) { // detector de "quem está falando"
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const an = actx.createAnalyser();
      an.fftSize = 512;
      actx.createMediaStreamSource(s).connect(an);
      target.an = an;
      target.buf = new Uint8Array(an.fftSize);
    } catch {}
  }
  const level = (t) => { if (!t.an) return 0; t.an.getByteTimeDomainData(t.buf); let m = 0; for (const v of t.buf) m = Math.max(m, Math.abs(v - 128)); return m; };
  setInterval(() => {
    if (!stream) return;
    const mark = (id, on) => document.querySelectorAll('[data-vid="' + id + '"]').forEach((el) => el.classList.toggle('speaking', on));
    me.speaking = !cfg.muted && level(me) > 12;
    mark(MY_ID, me.speaking);
    peers.forEach((p, id) => { const s = level(p) > 12; if (s !== p.speaking) { p.speaking = s; mark(id, s); } });
  }, 200);

  function close(id) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    try { p.pc.close(); } catch {}
    p.audio.srcObject = null;
    render();
  }
  const closeAll = () => [...peers.keys()].forEach(close);

  function make(id) {
    close(id);
    const pc = new RTCPeerConnection(RTC);
    const p = { pc, audio: new Audio(), pending: [], remoteSet: false, an: null, speaking: false };
    p.audio.autoplay = true;
    p.audio.volume = cfg.vol;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => e.candidate && send(id, { ice: e.candidate });
    pc.ontrack = (e) => { p.audio.srcObject = e.streams[0]; p.audio.play().catch(() => {}); watch(p, e.streams[0]); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { if (peers.get(id) === p) close(id); }
      render();
    };
    peers.set(id, p);
    return p;
  }

  // Regra anti-colisão: o jogador de MENOR id é quem faz a oferta
  async function offerTo(id) {
    if (!stream || MY_ID > id) return;
    const cur = peers.get(id);
    if (cur && ['connected', 'connecting', 'new'].includes(cur.pc.connectionState)) return;
    const p = make(id);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    send(id, { sdp: p.pc.localDescription });
    render();
  }

  async function onSignal({ from, data }) {
    if (!stream || !inGroup() || !GROUP.members.some((m) => m.id === from)) return;
    let p = peers.get(from);
    if (data.sdp) {
      if (data.sdp.type === 'offer') p = make(from);
      if (!p) return;
      await p.pc.setRemoteDescription(data.sdp);
      p.remoteSet = true;
      for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === 'offer') {
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        send(from, { sdp: p.pc.localDescription });
      }
    } else if (data.ice && p) {
      if (p.remoteSet) await p.pc.addIceCandidate(data.ice).catch(() => {});
      else p.pending.push(data.ice);
    }
  }

  function leave() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; me = { an: null, speaking: false }; }
    closeAll();
    socket?.emit('voip:leave');
  }

  // Liga/desliga conforme a configuração e o grupo (chamada ao mudar qualquer um dos dois)
  async function sync() {
    if (!socket) return;
    const want = cfg.voip && inGroup();
    if (want) {
      if (!stream && !starting) {
        starting = true;
        try {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voz precisa de HTTPS (ou localhost)');
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
          watch(me, stream);
          applyMute();
        } catch (e) {
          toast('Voz: ' + (e.name === 'NotAllowedError' ? 'permissão do microfone negada' : e.message || 'microfone indisponível'));
          cfg.voip = false; save(); stream = null;
        }
        starting = false;
      }
      if (stream && cfg.voip && inGroup()) socket.emit('voip:join');
    } else if (stream || peers.size) leave();
    // ninguém fora do grupo fica conectado
    peers.forEach((_, id) => { if (!GROUP?.members.some((m) => m.id === id)) close(id); });
    chip();
    render();
  }

  function init(s) {
    socket = s;
    s.on('voip:peers', (ids) => ids.forEach(offerTo));
    s.on('voip:peer-joined', ({ id }) => offerTo(id));
    s.on('voip:peer-left', ({ id }) => close(id));
    s.on('voip:signal', (m) => onSignal(m).catch(console.error));
    s.on('group:update', () => setTimeout(sync, 0));
    s.on('disconnect', () => { if (stream || peers.size) { closeAll(); } });
    s.on('connect', () => { if (stream) socket.emit('voip:join'); });
    sync();
  }

  $('profileBtn').addEventListener('click', () => open());
  $('closeSettings').addEventListener('click', () => open(false));
  $('voiceChip').addEventListener('click', () => { cfg.muted = !cfg.muted; save(); applyMute(); render(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) open(false); });

  return { init, open, buddyOn: () => cfg.buddy };
})();
