// Login diário (cliente): botão no HUD + painel com a sequência de 7 dias. O servidor decide tudo (se já
// resgatou hoje, qual é o prêmio, se a sequência zerou); aqui só mostramos e enviamos o pedido de resgate.
const Daily = (() => {
  let state = null; // { claimed, streak, day, prize, xmas, days:[{day,icon,label}] }
  let popped = false; // já mostramos o aviso automático nesta sessão?

  const ITEM = { masterballs: 'Master Ball', ultraballs: 'Ultra Ball', greatballs: 'Great Ball', pokeballs: 'Pokébola', apricorns: 'Bolotas', shards: 'Fragmentos' };
  const prizeTxt = (p) => Object.entries(p || {}).map(([k, n]) => n + '× ' + (ITEM[k] || k)).join(' · ');

  function isOpen() { return $('daily').classList.contains('open'); }

  function gridHtml() {
    if (!state) return '';
    return '<div class="daily-grid">' + state.days.map((d) => {
      const got = d.day < state.day || (state.claimed && d.day === state.day);
      const cur = !state.claimed && d.day === state.day;
      return '<div class="daily-day' + (got ? ' done' : '') + (cur ? ' cur' : '') + '"><span class="dn">Dia ' + d.day + '</span><span class="di">' + d.icon + '</span><span class="dl">' + esc(d.label) + '</span></div>';
    }).join('') + '</div>';
  }

  function render() {
    if (!state) { $('dailyBody').innerHTML = '<p class="empty">Carregando…</p>'; return; }
    const xmasNote = state.xmas ? '<p class="hintline">🎄 Época de Natal: +5 Bolotas de bônus em cada resgate!</p>' : '';
    const action = state.claimed
      ? '<p class="qz-roam-hint">Você já resgatou hoje. Volte amanhã para continuar a sequência!</p>'
      : '<button class="btn primary" id="dailyClaimBtn">🎁 Resgatar dia ' + state.day + ' — ' + esc(prizeTxt(state.prize)) + '</button>';
    $('dailyBody').innerHTML = '<p class="hintline">Sequência atual: <b>' + state.streak + '</b> dia' + (state.streak === 1 ? '' : 's') + ' seguido' + (state.streak === 1 ? '' : 's') + '. Falte um dia e ela zera.</p>' +
      xmasNote + gridHtml() + action;
    $('dailyClaimBtn')?.addEventListener('click', () => { $('dailyClaimBtn').disabled = true; socket()?.emit('daily:claim'); });
    updateBadge();
  }

  function updateBadge() {
    const dot = $('dailyBadge');
    if (dot) dot.hidden = !state || state.claimed;
  }

  function openDaily(open = !isOpen()) {
    $('daily').classList.toggle('open', open);
    $('daily').setAttribute('aria-hidden', !open);
    if (open) { $('drawer').classList.remove('open'); $('bag').classList.remove('open'); $('group').classList.remove('open'); render(); }
  }

  const socket = () => window.worldScene?.socket;
  function bindSocket(sock) {
    sock.on('daily:state', (s) => {
      state = s;
      updateBadge();
      if (!popped && !state.claimed) {
        popped = true;
        setTimeout(() => { if (!inBattle && !$('hud').hidden) openDaily(true); }, 1400);
      }
      if (isOpen()) render();
    });
    sock.on('daily:claimed', (r) => {
      if (r.error) { toast(r.error); return; }
      Snd.sfx('win');
      toast('🎁 ' + esc(r.label) + '!', true);
      if (state) { state.claimed = true; state.streak = r.streak; state.day = r.day; }
      updateBadge();
      if (isOpen()) {
        $('dailyBody').innerHTML = '<div class="qz-end"><div class="qz-medal">' + r.icon + '</div><h3>Dia ' + r.day + '/7 resgatado!</h3><div class="qz-prize">' + esc(prizeTxt(r.prize)) + '</div><p>Sequência: ' + r.streak + ' dia' + (r.streak === 1 ? '' : 's') + '.</p></div>';
      }
    });
  }

  const wait = setInterval(() => {
    const s = socket();
    if (!s) return;
    clearInterval(wait);
    bindSocket(s);
  }, 300);

  $('dailyBtn')?.addEventListener('click', () => openDaily());
  $('closeDaily')?.addEventListener('click', () => openDaily(false));

  return { open: openDaily };
})();
window.Daily = Daily;
