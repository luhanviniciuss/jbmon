// Eventos (Quiz Pokémon): chip do HUD com a contagem do evento e o overlay do quiz dentro do Salão de Eventos.
// O servidor manda em tudo (perguntas, tempo, pontos); aqui só desenhamos e enviamos a escolha.
const Events = (() => {
  const OPT = ['A', 'B', 'C', 'D'];
  let status = null; // { name, icon, phase, startsIn, n, total, players } + recebidoEm
  let inside = false;
  let q = null; // pergunta atual { n, total, text, options, endEnd (local), ms }
  let mine = null; // escolha do jogador na pergunta atual
  let reveal = null;
  let end = null;
  let last = null; // último placar { score, rank, of }
  let tick = 0;

  const now = () => Date.now();
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const lobbyLeft = () => (status && status.phase === 'lobby' ? status.startsAt - now() : 0);
  const ITEM = { masterballs: 'Master Ball', ultraballs: 'Ultra Ball', greatballs: 'Great Ball', pokeballs: 'Pokébola', apricorns: 'Bolotas', shards: 'Fragmentos' };
  const prizeTxt = (p) => (p ? Object.entries(p).map(([k, n]) => n + '× ' + (ITEM[k] || k)).join(' · ') : 'sem prêmio dessa vez');

  const socket = () => window.worldScene?.socket;

  // ---------------------------------------------------------------- chip do HUD
  function updateChip() {
    const c = $('eventChip');
    if (!status) { c.hidden = true; return; }
    c.hidden = false;
    c.textContent = status.icon + ' ' + status.name + ' · ' + (status.phase === 'lobby' ? 'abre em ' + fmt(lobbyLeft()) : status.phase === 'running' ? 'em andamento ' + status.n + '/' + status.total : 'encerrando');
  }

  // ---------------------------------------------------------------- overlay do quiz
  function draw() {
    const box = $('quiz');
    box.hidden = !inside;
    if (!inside) return;
    const body = $('quizBody');
    let html = '';
    if (end) {
      const y = end.you;
      const medal = y.rank === 1 ? '🥇' : y.rank === 2 ? '🥈' : y.rank === 3 ? '🥉' : '🎖';
      html = '<div class="qz-end"><div class="qz-medal">' + medal + '</div><h3>Você ficou em ' + y.rank + 'º de ' + y.of + '</h3><p>' + y.score + ' pontos · ' + y.correct + '/' + end.total + ' acertos</p>' +
        '<div class="qz-prize">🎁 ' + esc(prizeTxt(y.prize)) + '</div>' +
        '<ol class="qz-top">' + end.top.slice(0, 5).map((r, i) => '<li' + (r.name === $('hudName').textContent ? ' class="me"' : '') + '><span>' + (i + 1) + '</span><b>' + esc(r.name) + '</b><em>' + r.score + '</em></li>').join('') + '</ol></div>';
    } else if (q && now() < q.endLocal && !reveal) {
      const left = q.endLocal - now(), pct = Math.max(0, Math.min(100, (left / q.ms) * 100));
      html = '<div class="qz-top-row"><span>' + (q.tie ? '⚔ DESEMPATE' : 'Pergunta ' + q.n + '/' + q.total) + '</span><span class="qz-time' + (left < 5000 ? ' hot' : '') + '">⏱ ' + Math.ceil(left / 1000) + 's</span></div><div class="qz-bar"><i style="width:' + pct + '%"></i></div>' +
        '<h3 class="qz-q">' + esc(q.text) + '</h3><div class="qz-opts">' +
        q.options.map((o, i) => '<button class="qz-opt' + (mine === i ? ' sel' : '') + '" data-i="' + i + '"' + (mine !== null || q.spectator ? ' disabled' : '') + '><b>' + OPT[i] + '</b><span>' + esc(o) + '</span></button>').join('') + '</div>' +
        '<p class="qz-hint">' + (q.spectator ? '👀 Desempate entre os empatados em 1º. Você assiste!' : mine !== null ? '✔ Resposta enviada! Aguarde o tempo acabar…' : 'Quanto mais rápido, mais pontos!') + (last ? ' · ' + last.score + ' pts' : '') + '</p>';
    } else if (reveal && q) {
      const ok = reveal.choice === reveal.correct;
      html = '<div class="qz-top-row"><span>' + (reveal.tie ? '⚔ DESEMPATE' : 'Pergunta ' + reveal.n + '/' + q.total) + '</span><span>' + reveal.score + ' pts · ' + reveal.rank + 'º/' + reveal.of + '</span></div><h3 class="qz-q">' + esc(q.text) + '</h3><div class="qz-opts">' +
        q.options.map((o, i) => '<div class="qz-opt ' + (i === reveal.correct ? 'right' : i === reveal.choice ? 'wrong' : 'dim') + '"><b>' + OPT[i] + '</b><span>' + esc(o) + '</span></div>').join('') + '</div>' +
        '<p class="qz-hint ' + (ok ? 'good' : 'bad') + '">' + (reveal.tie ? (reveal.left.length > 1 ? '⚔ Seguem no desempate: ' + reveal.left.map(esc).join(', ') : '🏆 Desempate decidido: ' + esc(reveal.left[0])) : reveal.choice === null ? '⏰ Tempo esgotado!' : ok ? '✔ Acertou! +' + reveal.gained + ' pontos' : '✖ Errou!') + '</p>' +
        '<ol class="qz-top mini">' + reveal.top.map((r, i) => '<li><span>' + (i + 1) + '</span><b>' + esc(r.name) + '</b><em>' + r.score + '</em></li>').join('') + '</ol>';
    } else if (status && status.phase === 'lobby') {
      html = '<div class="qz-wait"><div class="qz-ico">' + status.icon + '</div><h3>' + esc(status.name) + '</h3><p class="qz-count">' + fmt(lobbyLeft()) + '</p><p>' + status.players + ' jogador' + (status.players === 1 ? '' : 'es') + ' no salão. Fique aqui para participar!</p></div>';
    } else if (status && status.phase === 'running') {
      html = '<div class="qz-wait"><div class="qz-ico">' + status.icon + '</div><h3>' + esc(status.name) + '</h3><p>Preparando a próxima pergunta… ' + status.n + '/' + status.total + '</p></div>';
    } else {
      html = '<div class="qz-wait"><div class="qz-ico">🎉</div><h3>Salão de Eventos</h3><p>Nenhum evento agora. Eles acontecem de 20 em 20 minutos e são anunciados para todos!</p></div>';
    }
    // não recria o DOM enquanto nada mudou (mantém o toque nos botões estável)
    if (body.dataset.h !== html) { body.dataset.h = html; body.innerHTML = html; }
  }

  function screen() {
    if (end) return { title: '🏆 ' + end.top[0]?.name, sub: end.top[0] ? end.top[0].score + ' pontos' : 'Fim!' };
    if (q && !reveal && now() < q.endLocal) return { title: '❓ Pergunta ' + q.n + '/' + q.total, sub: 'Responda no seu celular/tela! ⏱ ' + Math.ceil((q.endLocal - now()) / 1000) + 's' };
    if (reveal) return { title: reveal.choice === reveal.correct ? '✔ Resposta certa!' : 'Resposta revelada', sub: 'Placar: você em ' + reveal.rank + 'º' };
    if (status?.phase === 'lobby') return { title: status.icon + ' ' + status.name, sub: 'Começa em ' + fmt(lobbyLeft()) + ' · ' + status.players + ' no salão' };
    if (status?.phase === 'running') return { title: status.icon + ' ' + status.name, sub: 'Já começou! ' + status.n + '/' + status.total };
    return { title: '🎉 Salão de Eventos', sub: 'Aguardando o próximo evento' };
  }

  // ---------------------------------------------------------------- entrada de eventos do servidor
  function setStatus(s) {
    status = s ? { ...s, startsAt: now() + (s.startsIn || 0) } : null;
    if (!s) { q = null; reveal = null; mine = null; }
    updateChip(); draw();
  }
  function bindSocket(sock) {
    sock.on('event:status', setStatus);
    sock.on('event:joined', (j) => {
      end = null; reveal = null; mine = null;
      if (j.q) q = { ...j.q, endLocal: now() + j.q.left };
      draw();
    });
    sock.on('event:question', (x) => { end = null; reveal = null; mine = null; q = { ...x, endLocal: now() + x.left }; draw(); });
    sock.on('event:answered', () => draw());
    sock.on('event:tie', (t) => { toast('⚔ Empate em 1º! Desempate: ' + t.names.join(', ')); });
    sock.on('event:reveal', (r) => { reveal = r; last = { score: r.score, rank: r.rank, of: r.of }; draw(); });
    sock.on('event:end', (e) => { end = e; q = null; reveal = null; mine = null; draw(); });
    sock.on('event:cancel', () => { q = null; reveal = null; mine = null; end = null; toast('O evento foi cancelado.'); draw(); });
    sock.on('events:entered', () => { inside = true; end = null; last = null; draw(); });
    sock.on('events:exited', () => { inside = false; q = null; reveal = null; mine = null; end = null; draw(); });
    sock.emit('event:sync'); // o status inicial pode ter chegado antes de ligarmos os ouvintes
  }

  // O WorldScene expõe o socket depois do login: espera e liga os ouvintes uma vez
  const wait = setInterval(() => {
    const s = socket();
    if (!s) return;
    clearInterval(wait);
    bindSocket(s);
  }, 300);

  $('quizBody').addEventListener('click', (e) => {
    const b = e.target.closest('.qz-opt[data-i]');
    if (!b || !q || q.spectator || mine !== null || now() >= q.endLocal) return;
    mine = +b.dataset.i;
    socket()?.emit('event:answer', { n: q.n, choice: mine });
    draw();
  });
  $('quizHide').addEventListener('click', () => $('quiz').classList.toggle('min'));
  $('eventChip').addEventListener('click', () => toast(status ? 'Vá ao Salão de Eventos: casa da direita na Cidade (mundo Cidade, pelo ginásio).' : 'Nenhum evento agora.'));

  tick = setInterval(() => { if (status?.phase === 'lobby' || q) { updateChip(); if (inside) draw(); } else if (status) updateChip(); }, 500);
  return { screen };
})();
window.Events = Events; // a cena do salão (hall.js) lê o telão daqui
