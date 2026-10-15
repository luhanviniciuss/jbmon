// Eventos: chip do HUD + overlay do Salão de Eventos. O servidor manda em tudo (perguntas, tempo, pontos);
// aqui só desenhamos e enviamos as respostas/ações. Dois estilos de evento:
// - "De salão" (quiz, pergunta relâmpago, pergunta de ouro, quem-é-esse-pokémon, roleta, duelo): fica na tela do evento.
// - "De mundo" (caça ao tesouro, corrida, chuva de bolas, hora da sorte): depois de se inscrever, sai e joga na Praça;
//   um painel pequeno e flutuante acompanha o placar sem travar o mapa.
const Events = (() => {
  const OPT = ['A', 'B', 'C', 'D'];
  const ROAM = { treasure: 1, race: 1, ballrain: 1, luck: 1 }; // tipos "de mundo": não travam a tela
  let status = null; // { id, type, name, icon, phase, startsIn, n, total, players, where } + recebidoEm
  let inside = false;
  let joined = false; // já me inscrevi neste evento (recebi event:joined)?
  let q = null; // pergunta/rodada atual
  let mine = null; // escolha (múltipla escolha) do jogador na pergunta atual
  let guessed = false; // já enviei uma resposta de texto (quem-é-esse-pokémon)?
  let reveal = null;
  let end = null;
  let last = null; // último placar { score, rank, of }
  let log = []; // mensagens recentes (duelo, corrida, achados) pro painel flutuante
  let checkpoint = null; // { next, total, x, y } — corrida
  let tick = 0;

  const now = () => Date.now();
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const lobbyLeft = () => (status && status.phase === 'lobby' ? status.startsAt - now() : 0);
  const ITEM = { masterballs: 'Master Ball', ultraballs: 'Ultra Ball', greatballs: 'Great Ball', pokeballs: 'Pokébola', apricorns: 'Bolotas', shards: 'Fragmentos' };
  const prizeTxt = (p) => (p ? Object.entries(p).map(([k, n]) => n + '× ' + (ITEM[k] || k)).join(' · ') : 'sem prêmio dessa vez');
  const addLog = (msg) => { log.unshift(msg); log = log.slice(0, 4); };

  const socket = () => window.worldScene?.socket;
  const isRoam = () => status && ROAM[status.type];
  const visible = () => !!status && (end || (isRoam() ? joined : inside));

  // ---------------------------------------------------------------- chip do HUD
  function updateChip() {
    const c = $('eventChip');
    if (!status) { c.hidden = true; return; }
    c.hidden = false;
    c.textContent = status.icon + ' ' + status.name + ' · ' + (status.phase === 'lobby' ? 'abre em ' + fmt(lobbyLeft()) : status.phase === 'running' ? (isRoam() ? 'em andamento' : status.total ? status.n + '/' + status.total : 'em andamento') : 'encerrando');
  }

  // ---------------------------------------------------------------- overlay
  function draw() {
    const box = $('quiz');
    const show = visible();
    box.hidden = !show;
    box.classList.toggle('roam', !!(isRoam() && !end));
    if (!show) return;
    const body = $('quizBody');
    let html = '';
    if (end) html = drawEnd();
    else if (status.type === 'whosthat') html = drawWhosThat();
    else if (status.type === 'duel') html = drawDuel();
    else if (status.type === 'wheel') html = drawWheel();
    else if (status.type === 'treasure' || status.type === 'ballrain') html = drawRoamScore(status.type === 'treasure' ? '💰' : '🌧️');
    else if (status.type === 'race') html = drawRace();
    else if (status.type === 'luck') html = drawLuck();
    else html = drawQuiz(); // quiz, lightning, golden: múltipla escolha padrão
    if (body.dataset.h !== html) { body.dataset.h = html; body.innerHTML = html; }
  }

  function drawEnd() {
    const y = end.you;
    if (end.custom) { // Hora da Sorte / Roleta: sem ranking competitivo
      if (y?.prize) return '<div class="qz-end"><div class="qz-medal">🎁</div><h3>Você ganhou!</h3><div class="qz-prize">' + esc(prizeTxt(y.prize)) + '</div></div>';
      return '<div class="qz-end"><div class="qz-medal">🍀</div><h3>' + esc(status.name) + ' terminou</h3><p>Até a próxima!</p></div>';
    }
    const medal = y.rank === 1 ? '🥇' : y.rank === 2 ? '🥈' : y.rank === 3 ? '🥉' : '🎖';
    const acertos = ['quiz', 'lightning', 'whosthat', 'golden'].includes(status.type) ? y.correct + '/' + end.total + ' acertos · ' : '';
    return '<div class="qz-end"><div class="qz-medal">' + medal + '</div><h3>Você ficou em ' + y.rank + 'º de ' + y.of + '</h3><p>' + acertos + y.score + ' pontos</p>' +
      '<div class="qz-prize">🎁 ' + esc(prizeTxt(y.prize)) + '</div>' +
      '<ol class="qz-top">' + end.top.slice(0, 5).map((r, i) => '<li' + (r.name === $('hudName').textContent ? ' class="me"' : '') + '><span>' + (i + 1) + '</span><b>' + esc(r.name) + '</b><em>' + r.score + '</em></li>').join('') + '</ol></div>';
  }

  function drawQuiz() {
    if (q && !reveal && now() < q.endLocal) {
      const left = q.endLocal - now(), pct = Math.max(0, Math.min(100, (left / q.ms) * 100));
      return '<div class="qz-top-row"><span>' + (q.tie ? '⚔ DESEMPATE' : (status.type === 'golden' ? '🌟 Pergunta de Ouro' : 'Pergunta ' + q.n + '/' + q.total)) + '</span><span class="qz-time' + (left < 5000 ? ' hot' : '') + '">⏱ ' + Math.ceil(left / 1000) + 's</span></div><div class="qz-bar"><i style="width:' + pct + '%"></i></div>' +
        '<h3 class="qz-q">' + esc(q.text) + '</h3><div class="qz-opts">' +
        q.options.map((o, i) => '<button class="qz-opt' + (mine === i ? ' sel' : '') + '" data-i="' + i + '"' + (mine !== null || q.spectator ? ' disabled' : '') + '><b>' + OPT[i] + '</b><span>' + esc(o) + '</span></button>').join('') + '</div>' +
        '<p class="qz-hint">' + (q.spectator ? '👀 Desempate entre os empatados em 1º. Você assiste!' : mine !== null ? '✔ Resposta enviada! Aguarde o tempo acabar…' : status.type === 'golden' ? 'Só o primeiro a acertar leva o prêmio!' : 'Quanto mais rápido, mais pontos!') + (last ? ' · ' + last.score + ' pts' : '') + '</p>';
    }
    if (reveal && q) {
      const ok = reveal.choice === reveal.correct;
      const goldenMsg = status.type === 'golden' ? (reveal.rank === 1 ? '🏆 Você acertou primeiro! Prêmio garantido!' : ok ? 'Você acertou, mas alguém foi mais rápido…' : '✖ Errou!') : null;
      return '<div class="qz-top-row"><span>' + (reveal.tie ? '⚔ DESEMPATE' : 'Pergunta ' + reveal.n + '/' + q.total) + '</span><span>' + reveal.score + ' pts · ' + reveal.rank + 'º/' + reveal.of + '</span></div><h3 class="qz-q">' + esc(q.text) + '</h3><div class="qz-opts">' +
        q.options.map((o, i) => '<div class="qz-opt ' + (i === reveal.correct ? 'right' : i === reveal.choice ? 'wrong' : 'dim') + '"><b>' + OPT[i] + '</b><span>' + esc(o) + '</span></div>').join('') + '</div>' +
        '<p class="qz-hint ' + (ok ? 'good' : 'bad') + '">' + (goldenMsg || (reveal.tie ? (reveal.left.length > 1 ? '⚔ Seguem no desempate: ' + reveal.left.map(esc).join(', ') : '🏆 Desempate decidido: ' + esc(reveal.left[0])) : reveal.choice === null ? '⏰ Tempo esgotado!' : ok ? '✔ Acertou! +' + reveal.gained + ' pontos' : '✖ Errou!')) + '</p>' +
        (reveal.top?.length ? '<ol class="qz-top mini">' + reveal.top.map((r, i) => '<li><span>' + (i + 1) + '</span><b>' + esc(r.name) + '</b><em>' + r.score + '</em></li>').join('') + '</ol>' : '');
    }
    return drawWait();
  }

  function drawWhosThat() {
    if (q && !reveal && now() < q.endLocal) {
      const left = q.endLocal - now(), pct = Math.max(0, Math.min(100, (left / q.ms) * 100));
      return '<div class="qz-top-row"><span>Pergunta ' + q.n + '/' + q.total + '</span><span class="qz-time' + (left < 5000 ? ' hot' : '') + '">⏱ ' + Math.ceil(left / 1000) + 's</span></div><div class="qz-bar"><i style="width:' + pct + '%"></i></div>' +
        '<h3 class="qz-q">Quem é esse Pokémon?</h3><div class="qz-silhouette"><img src="' + spriteUrl(q.species_id) + '" alt="" /></div>' +
        '<div class="qz-guess"><input id="qzGuess" maxlength="24" autocomplete="off" placeholder="Nome do Pokémon…" ' + (guessed ? 'disabled' : '') + ' /><button id="qzGuessBtn" class="btn primary"' + (guessed ? ' disabled' : '') + '>Responder</button></div>' +
        '<p class="qz-hint">' + (guessed ? '✔ Resposta enviada! Aguarde o tempo acabar…' : 'Digite o nome e aperte Enter') + (last ? ' · ' + last.score + ' pts' : '') + '</p>';
    }
    if (reveal && q) {
      const ok = reveal.choice && reveal.choice.toString().trim().length && reveal.gained > 0;
      return '<div class="qz-top-row"><span>Pergunta ' + reveal.n + '/' + q.total + '</span><span>' + reveal.score + ' pts · ' + reveal.rank + 'º/' + reveal.of + '</span></div>' +
        '<h3 class="qz-q">Era ' + esc(reveal.correct) + '!</h3><div class="qz-silhouette revealed"><img src="' + spriteUrl(q.species_id) + '" alt="" /></div>' +
        '<p class="qz-hint ' + (ok ? 'good' : 'bad') + '">' + (!reveal.choice ? '⏰ Tempo esgotado!' : ok ? '✔ Acertou! +' + reveal.gained + ' pontos' : '✖ Você disse "' + esc(reveal.choice) + '"') + '</p>' +
        (reveal.top?.length ? '<ol class="qz-top mini">' + reveal.top.map((r, i) => '<li><span>' + (i + 1) + '</span><b>' + esc(r.name) + '</b><em>' + r.score + '</em></li>').join('') + '</ol>' : '');
    }
    return drawWait();
  }

  function drawDuel() {
    const me = $('hudName').textContent;
    return '<div class="qz-wait"><div class="qz-ico">⚔️</div><h3>Duelo Relâmpago</h3>' +
      (log.length ? '<div class="qz-duelog">' + log.map((m) => '<p>' + esc(m) + '</p>').join('') : '<p>Aguardando a próxima rodada…</p>') + '</div>';
  }

  function drawWheel() {
    return '<div class="qz-wait"><div class="qz-ico">🎡</div><h3>Roleta Dourada</h3><p>Girando a roleta…</p></div>';
  }

  function drawRoamScore(icon) {
    return '<div class="qz-roam"><b>' + icon + ' ' + esc(status.name) + '</b></div>' +
      '<p class="qz-roam-hint">Ande pela Praça da Cidade e encoste nos itens pra coletar!</p>' +
      (log.length ? '<div class="qz-duelog">' + log.map((m) => '<p>' + esc(m) + '</p>').join('') : '');
  }

  function drawRace() {
    const p = window.worldScene?.player;
    let dist = '';
    if (checkpoint && p) dist = Math.round(Math.hypot(checkpoint.x - p.x, checkpoint.y - p.y) / 32) + ' tiles';
    return '<div class="qz-roam"><b>🏁 Corrida da Praça</b></div>' +
      (checkpoint ? '<p class="qz-roam-hint">Bandeira ' + (checkpoint.next + 1) + '/' + checkpoint.total + ' — ' + dist + '</p>' : '<p class="qz-roam-hint">Você terminou! Aguarde os outros…</p>') +
      (log.length ? '<div class="qz-duelog">' + log.map((m) => '<p>' + esc(m) + '</p>').join('') : '');
  }

  function drawLuck() {
    return '<div class="qz-roam"><b>🍀 Hora da Sorte</b></div><p class="qz-roam-hint">Toda captura ou vitória rende Bolotas e Fragmentos extras, em qualquer lugar do jogo!</p>' +
      (log.length ? '<div class="qz-duelog">' + log.map((m) => '<p>' + esc(m) + '</p>').join('') : '');
  }

  function drawWait() {
    if (status.phase === 'lobby') return '<div class="qz-wait"><div class="qz-ico">' + status.icon + '</div><h3>' + esc(status.name) + '</h3><p class="qz-count">' + fmt(lobbyLeft()) + '</p><p>' + status.players + ' jogador' + (status.players === 1 ? '' : 'es') + ' inscrito' + (status.players === 1 ? '' : 's') + '. Fique aqui para participar!</p></div>';
    if (status.phase === 'running') return '<div class="qz-wait"><div class="qz-ico">' + status.icon + '</div><h3>' + esc(status.name) + '</h3><p>Preparando a próxima rodada…</p></div>';
    return '<div class="qz-wait"><div class="qz-ico">🎉</div><h3>Salão de Eventos</h3><p>Nenhum evento agora. Eles acontecem com frequência e são anunciados para todos!</p></div>';
  }

  function screen() {
    if (end) return { title: '🏆 ' + (end.top?.[0]?.name || status?.name), sub: end.top?.[0] ? end.top[0].score + ' pontos' : 'Fim!' };
    if (q && !reveal && now() < q.endLocal) return { title: (status?.type === 'whosthat' ? '👤 Quem é esse Pokémon?' : '❓ Pergunta ' + q.n + '/' + q.total), sub: 'Responda no seu celular/tela! ⏱ ' + Math.ceil((q.endLocal - now()) / 1000) + 's' };
    if (reveal) return { title: 'Resposta revelada', sub: 'Placar: você em ' + reveal.rank + 'º' };
    if (status?.phase === 'lobby') return { title: status.icon + ' ' + status.name, sub: 'Começa em ' + fmt(lobbyLeft()) + ' · ' + status.players + ' inscritos' };
    if (status?.phase === 'running') return { title: status.icon + ' ' + status.name, sub: 'Em andamento!' };
    return { title: '🎉 Salão de Eventos', sub: 'Aguardando o próximo evento' };
  }

  // ---------------------------------------------------------------- entrada de eventos do servidor
  function setStatus(s) {
    const changedType = !status || !s || status.type !== s.type || status.id !== s.id;
    status = s ? { ...s, startsAt: now() + (s.startsIn || 0) } : null;
    if (!s || changedType) { q = null; reveal = null; mine = null; guessed = false; log = []; checkpoint = null; joined = false; }
    updateChip(); draw();
  }
  function bindSocket(sock) {
    sock.on('event:status', setStatus);
    sock.on('event:joined', (j) => {
      joined = true;
      end = null; reveal = null; mine = null; guessed = false;
      if (j.q) q = { ...j.q, endLocal: now() + j.q.left };
      draw();
    });
    sock.on('event:question', (x) => { end = null; reveal = null; mine = null; guessed = false; q = { ...x, endLocal: now() + x.left }; draw(); });
    sock.on('event:answered', () => draw());
    sock.on('event:tie', (t) => { toast('⚔ Empate em 1º! Desempate: ' + t.names.join(', ')); });
    sock.on('event:reveal', (r) => { Snd.sfx(r.choice === r.correct || r.gained > 0 ? 'correct' : 'wrong'); reveal = r; last = { score: r.score, rank: r.rank, of: r.of }; draw(); });
    sock.on('event:pickup', (p) => { addLog((p.name ? esc(p.name) + ' · ' : '') + '+' + p.val + ' ' + (p.icon || '')); toast((p.icon || '🎁') + ' +' + p.val, false); Snd.sfx('correct'); draw(); });
    sock.on('event:checkpoint', (c) => { checkpoint = c; addLog('🚩 Bandeira ' + (c.next + 1) + '/' + c.total); Snd.sfx('notice'); draw(); });
    sock.on('event:finish', (f) => { checkpoint = null; toast('🏁 Você terminou em ' + (f.time / 1000).toFixed(1) + ' s!', true); Snd.sfx('win'); draw(); });
    sock.on('event:duel', (d) => { addLog((d.win ? '✔ Venceu' : '✖ Perdeu') + ' contra ' + d.opponent + ' (rodada ' + d.round + ')'); toast('⚔ ' + (d.win ? 'Você venceu' : 'Você perdeu') + ' contra ' + d.opponent + '!', true); Snd.sfx(d.win ? 'correct' : 'wrong'); draw(); });
    sock.on('event:wheel', (w) => { toast('🎡 Você ganhou: ' + esc(prizeTxt(w.prize)) + '!', true); Snd.sfx('win'); draw(); });
    sock.on('event:luck', (l) => { toast('🍀 +' + l.apricorns + ' Bolotas, +' + l.shards + ' Fragmentos (Hora da Sorte)', false); });
    sock.on('event:end', (e) => { Snd.sfx(e.custom ? (e.you ? 'win' : 'notice') : e.you.rank === 1 ? 'win' : 'notice'); end = e; q = null; reveal = null; mine = null; guessed = false; draw(); });
    sock.on('event:cancel', () => { q = null; reveal = null; mine = null; guessed = false; end = null; joined = false; toast('O evento foi cancelado.'); draw(); });
    sock.on('events:entered', () => { inside = true; end = null; last = null; Snd.music('quiz'); draw(); });
    sock.on('events:exited', () => { inside = false; Snd.music(window.worldMusic()); draw(); });
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
    if (b && q && !q.spectator && mine === null && now() < q.endLocal) {
      mine = +b.dataset.i;
      socket()?.emit('event:answer', { n: q.n, choice: mine });
      draw();
      return;
    }
    if (e.target.closest('#qzGuessBtn')) sendGuess();
  });
  $('quizBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'qzGuess') sendGuess(); });
  function sendGuess() {
    const input = $('qzGuess');
    if (!input || guessed || !q || now() >= q.endLocal) return;
    const guess = input.value.trim();
    if (!guess) return;
    guessed = true;
    socket()?.emit('event:guess', { n: q.n, guess });
    draw();
  }
  $('quizHide').addEventListener('click', () => $('quiz').classList.toggle('min'));
  $('eventChip').addEventListener('click', () => toast(status ? (isRoam() ? 'Vá à Praça da Cidade participar de ' + status.name + '!' : 'Vá ao Salão de Eventos: casa da direita na Cidade (mundo Cidade, pelo ginásio).') : 'Nenhum evento agora.'));

  let lastTickSec = null;
  tick = setInterval(() => {
    if (q && !reveal) { const left = q.endLocal - now(); const sec = Math.ceil(left / 1000); if (left > 0 && left <= 5000 && sec !== lastTickSec) { lastTickSec = sec; Snd.sfx('tick'); } if (left > 5000) lastTickSec = null; }
    if (status) updateChip();
    if (visible() && (status?.phase === 'lobby' || q || isRoam())) draw();
  }, 500);
  return { screen };
})();
window.Events = Events; // a cena do salão (hall.js) lê o telão daqui
