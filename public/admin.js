// Painel de administração (só aparece para contas com papel "admin"; o servidor confere o papel a cada ação).
// Mobile-first: gaveta inferior no celular, abas roláveis, alvos de toque de 44px e campos com 16px.
const Admin = (() => {
  let tab = 'players';
  let st = null; // /state: jogadores online + estatísticas
  let users = null; // /users?q=: contas encontradas na busca
  let logRows = null;
  let evsAt = 0, evLobbyVal = 0;
  let evs = null; // /events: tipos, evento atual, agendamento e histórico
  let q = '';
  let openRow = null; // jogador com o menu de ações aberto
  let form = null; // { action: 'mute'|'ban', username } formulário de punição aberto
  let timer = null;
  let searchTimer = null;

  const SPECIES_LIST = Object.entries(SPECIES).map(([id, s]) => ({ id: +id, name: s.name, rarity: s.rarity })).sort((a, b) => a.name.localeCompare(b.name));
  const DURATIONS = [[5, '5 minutos'], [30, '30 minutos'], [60, '1 hora'], [360, '6 horas'], [1440, '1 dia'], [10080, '7 dias'], [43200, '30 dias'], ['perm', 'Permanente']];
  const ITEMS = [['poke', 'Pokébola'], ['great', 'Great Ball'], ['ultra', 'Ultra Ball'], ['master', 'Master Ball'], ['apricorns', 'Bolotas'], ['shards', 'Fragmentos']];

  async function api(method, path, body) {
    const r = await fetch('/api/admin' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
    return j;
  }
  async function act(path, body, okMsg) {
    try { await api('POST', path, body); toast(okMsg || 'Feito ✔'); } catch (e) { toast('⚠ ' + e.message); }
    refresh();
  }
  const fieldFocused = () => { const a = document.activeElement; return a && $('adminBody').contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName); };
  const fmtDate = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const untilTxt = (d) => (new Date(d).getFullYear() >= 9999 ? 'permanente' : 'até ' + fmtDate(d));
  const speciesOptions = (filter = '', sel = null, onlyLegendary = false) =>
    SPECIES_LIST.filter((s) => (!onlyLegendary || s.rarity === 'legendary') && (!filter || s.name.toLowerCase().includes(filter.toLowerCase())))
      .slice(0, 80).map((s) => '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + ' #' + s.id + (s.rarity === 'legendary' ? ' ✦' : '') + '</option>').join('');
  const picker = (p, onlyLegendary = false) => '<input id="' + p + 'F" class="af" placeholder="Filtrar espécie (ex.: char)" autocomplete="off" /><select id="' + p + 'S" class="af">' + (onlyLegendary ? '<option value="">🎲 Sorteio (aleatório)</option>' : '') + speciesOptions('', null, onlyLegendary) + '</select>';
  function bindPicker(p, onlyLegendary = false) {
    const f = $(p + 'F'), s = $(p + 'S');
    if (!f) return;
    f.addEventListener('input', () => { s.innerHTML = (onlyLegendary ? '<option value="">🎲 Sorteio (aleatório)</option>' : '') + speciesOptions(f.value, null, onlyLegendary); });
  }
  const num = (id, d) => { const n = parseInt($(id)?.value, 10); return Number.isFinite(n) ? n : d; };

  // ---------------- abas ----------------
  function playerRow(p, offline) {
    const isMe = p.username === $('hudName').textContent;
    const open = openRow === p.username;
    const badges = (p.role === 'admin' ? '<i class="abadge adm">ADM</i>' : '') + (p.combat ? '<i class="abadge cb">⚔</i>' : '') + (p.muted ? '<i class="abadge mu">🔇</i>' : '') + (p.banned ? '<i class="abadge bn">BANIDO</i>' : '') + (offline && !p.banned ? '<i class="abadge off">offline</i>' : '');
    const btn = (a, label, cls = '') => '<button class="ab ' + cls + '" data-a="' + a + '" data-u="' + esc(p.username) + '">' + label + '</button>';
    let acts = '';
    if (!isMe) {
      if (!offline) acts += btn('goto', '➡ Ir até') + btn('bring', '⬅ Trazer') + btn('heal', '💖 Curar');
      if (p.role !== 'admin') {
        acts += p.muted ? btn('unmute', '🔊 Liberar chat') : btn('mute', '🔇 Silenciar');
        acts += p.banned ? btn('unban', '✅ Desbanir', 'ok') : btn('ban', '🚫 Banir', 'danger');
        if (!offline) acts += btn('kick', '👢 Expulsar', 'danger');
      }
    } else acts = '<span class="ahint">Essa é a sua conta.</span>';
    const f = form && form.username === p.username ? '<div class="aform"><select data-f="dur" class="af">' + DURATIONS.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') + '</select><input data-f="reason" class="af" maxlength="120" placeholder="Motivo (opcional)" /><div class="arow2"><button class="ab danger" data-a="confirm">Confirmar ' + (form.action === 'ban' ? 'ban' : 'silêncio') + '</button><button class="ab" data-a="cancel">Cancelar</button></div></div>' : '';
    const extra = offline ? '<span class="apos">' + (p.pokemons != null ? p.pokemons + ' Pokémon' : '') + (p.banned ? ' · ' + untilTxt(p.banned_until) + (p.ban_reason ? ' · ' + esc(p.ban_reason) : '') : '') + '</span>' : '<span class="apos">tile ' + p.tx + ',' + p.ty + '</span>';
    return '<div class="arow' + (open ? ' open' : '') + '" data-row="' + esc(p.username) + '"><div class="ahead"><b>' + esc(p.username) + '</b>' + badges + extra + '</div><div class="aacts">' + acts + f + '</div></div>';
  }
  function playersHtml() {
    const ql = q.toLowerCase();
    const on = (st?.online || []).filter((p) => !ql || p.username.toLowerCase().includes(ql));
    const off = (users || []).filter((u) => !u.online);
    return '<input id="aq" class="af" placeholder="Buscar jogador (nome)" value="' + esc(q) + '" autocomplete="off" />' +
      '<div class="section-title">Online agora · ' + on.length + '</div>' + (on.map((p) => playerRow(p, false)).join('') || '<p class="empty">Ninguém online com esse nome.</p>') +
      (q ? '<div class="section-title">Outras contas · ' + off.length + '</div>' + (off.map((u) => playerRow(u, true)).join('') || '<p class="empty">Nenhuma outra conta encontrada.</p>') : '');
  }
  function spawnHtml() {
    return '<div class="section-title">Spawnar Pokémon selvagem</div>' + picker('sp') +
      '<div class="arow2"><label class="al">Nível<input id="spLv" class="af" type="number" inputmode="numeric" min="1" max="1000" value="30" /></label><label class="al">Quantidade<input id="spN" class="af" type="number" inputmode="numeric" min="1" max="25" value="1" /></label></div>' +
      '<div class="chips">' + [5, 20, 40, 60, 100].map((n) => '<button data-lv="' + n + '">Lv.' + n + '</button>').join('') + '</div>' +
      '<div class="arow2"><label class="al">Some em<select id="spTtl" class="af"><option value="10">10 min</option><option value="30" selected>30 min</option><option value="60">1 hora</option><option value="240">4 horas</option></select></label>' +
      '<label class="al">Onde<select id="spWhere" class="af"><option value="me">Perto de mim</option><option value="xy">Coordenadas…</option></select></label></div>' +
      '<div class="arow2" id="spXY" hidden><label class="al">x (0-99)<input id="spX" class="af" type="number" inputmode="numeric" value="50" /></label><label class="al">y (0-99)<input id="spY" class="af" type="number" inputmode="numeric" value="50" /></label></div>' +
      '<button class="btn primary" data-a="spawn">Spawnar</button><button class="ab" data-a="clearSpawns">🧹 Limpar spawns do admin</button>' +
      '<div class="section-title">Boss lendário agora</div>' + picker('bs', true) +
      '<button class="btn primary" data-a="boss">⚔ Chamar boss (Lv.100)</button><p class="hintline">Spawns de admin somem sozinhos e, se derrotados, não deixam substituto.</p>';
  }
  function giveHtml() {
    const names = (st?.online || []).map((p) => '<option value="' + esc(p.username) + '">').join('');
    return '<div class="section-title">Destinatário</div><input id="gvU" class="af" list="gvNames" placeholder="Nome do jogador" autocomplete="off" /><datalist id="gvNames">' + names + '</datalist>' +
      '<div class="section-title">Dar Pokémon</div>' + picker('gv') +
      '<label class="al">Nível<input id="gvLv" class="af" type="number" inputmode="numeric" min="1" max="1000" value="30" /></label><button class="btn primary" data-a="givePoke">🎁 Dar Pokémon</button>' +
      '<div class="section-title">Dar item</div><div class="arow2"><label class="al">Item<select id="gvItem" class="af">' + ITEMS.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') + '</select></label><label class="al">Quantidade<input id="gvN" class="af" type="number" inputmode="numeric" min="1" max="999" value="5" /></label></div>' +
      '<button class="btn primary" data-a="giveItem">🎁 Dar item</button><button class="ab" data-a="healGv">💖 Curar equipe do jogador</button><p class="hintline">Itens e cura não podem ser entregues a quem está em combate.</p>';
  }
  function sysHtml() {
    const s = st?.stats;
    const b = s?.boss;
    const stats = s ? '<div class="astats"><div><b>' + s.online + '</b><span>online</span></div><div><b>' + s.wilds + '</b><span>selvagens</span></div><div><b>' + s.adminWilds + '</b><span>spawns admin</span></div><div><b>' + s.memMB + ' MB</b><span>memória</span></div><div><b>' + Math.floor(s.uptimeSec / 3600) + 'h' + String(Math.floor((s.uptimeSec % 3600) / 60)).padStart(2, '0') + '</b><span>no ar</span></div><div><b>' + (b ? esc(SPECIES[b.species_id].name) : '—') + '</b><span>' + (b ? 'boss' + (b.busy ? ' (em raid)' : ' · ' + b.leftMin + ' min') : 'sem boss') + '</span></div></div>' : '';
    const log = (logRows || []).map((l) => '<div class="alog"><span>' + fmtDate(l.created_at) + '</span> <b>' + esc(l.admin_name) + '</b> ' + esc(l.action) + (l.target ? ' → ' + esc(l.target) : '') + '</div>').join('');
    return '<div class="section-title">Servidor</div>' + stats +
      '<div class="section-title">Aviso para todos</div><textarea id="anTxt" class="af" rows="2" maxlength="200" placeholder="Ex.: Manutenção em 5 minutos!"></textarea><button class="btn primary" data-a="announce">📢 Enviar aviso</button>' +
      '<div class="section-title">Teletransporte</div><div class="arow2"><label class="al">x<input id="tpX" class="af" type="number" inputmode="numeric" value="50" /></label><label class="al">y<input id="tpY" class="af" type="number" inputmode="numeric" value="50" /></label></div><button class="ab" data-a="tpxy">➡ Ir para (x, y)</button>' +
      '<div class="section-title">Auditoria (últimas ações)</div>' + (log || '<p class="empty">Sem registros.</p>');
  }

  function eventsHtml() {
    if (!evs) return '<p class="empty">Carregando…</p>';
    const cur = evs.current;
    const now = cur ? '<div class="ev-now"><b>' + esc(cur.icon + ' ' + cur.name) + '</b><span>' + (cur.phase === 'lobby' ? 'Inscrições abertas · abre em ' + Math.max(0, Math.round((cur.startsIn - (Date.now() - evsAt)) / 1000)) + ' s' : cur.phase === 'running' ? 'Em andamento ' + cur.n + '/' + cur.total : 'Encerrando') + ' · ' + cur.players + ' no salão</span><button class="ab danger" data-a="evCancel">⏹ Cancelar evento</button></div>' : '<p class="hintline">Nenhum evento em andamento.</p>';
    const auto = evs.auto;
    const types = evs.types.map((t) => '<div class="ev-type"><div><b>' + esc(t.icon + ' ' + t.name) + '</b><small>' + esc(t.desc) + '</small></div><button class="ab" data-a="evStart" data-t="' + esc(t.id) + '"' + (cur ? ' disabled' : '') + '>▶ Iniciar agora</button></div>').join('');
    const recent = evs.recent.map((r) => '<div class="alog"><span>' + fmtDate(r.at) + '</span> <b>' + esc(r.type) + '</b> · ' + r.players + ' jogador(es) · 🏆 ' + esc(r.winner || '—') + '</div>').join('');
    return '<div class="section-title">Agora</div>' + now +
      '<div class="section-title">Agendamento automático</div><p class="hintline">O quiz roda sozinho de ' + auto.everyMin + ' em ' + auto.everyMin + ' minutos.' + (auto.enabled && auto.nextAt ? ' Próximo: ' + fmtDate(auto.nextAt) + '.' : '') + '</p><button class="ab ' + (auto.enabled ? 'danger' : 'ok') + '" data-a="evAuto">' + (auto.enabled ? '⏸ Desligar automático' : '▶ Ligar automático') + '</button>' +
      '<div class="section-title">Iniciar evento</div><label class="al">Abertura do salão (segundos)<input id="evLobby" class="af" type="number" inputmode="numeric" min="10" max="900" value="' + (evLobbyVal || 60) + '" /></label>' + types +
      '<p class="hintline">Todos recebem o aviso; quem estiver no Salão de Eventos (Cidade, casa da direita) participa.</p>' +
      '<div class="section-title">Últimos eventos</div>' + (recent || '<p class="empty">Nenhum evento ainda.</p>');
  }

  function render() {
    const body = $('adminBody');
    body.innerHTML = tab === 'players' ? playersHtml() : tab === 'spawn' ? spawnHtml() : tab === 'give' ? giveHtml() : tab === 'events' ? eventsHtml() : sysHtml();
    document.querySelectorAll('#admin .atabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'spawn') { bindPicker('sp'); bindPicker('bs', true); $('spWhere').addEventListener('change', () => ($('spXY').hidden = $('spWhere').value !== 'xy')); }
    if (tab === 'give') bindPicker('gv');
    $('aq')?.addEventListener('input', (e) => {
      q = e.target.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => { users = q ? await api('GET', '/users?q=' + encodeURIComponent(q)).catch(() => []) : null; if (tab === 'players') { const pos = $('aq').selectionStart; render(); const i = $('aq'); i.focus(); i.setSelectionRange(pos, pos); } }, 300);
    });
  }
  async function refresh() {
    try {
      st = await api('GET', '/state');
      if (q) users = await api('GET', '/users?q=' + encodeURIComponent(q));
      if (tab === 'sys') logRows = await api('GET', '/log');
      if (tab === 'events') { evs = await api('GET', '/events'); evsAt = Date.now(); }
    } catch (e) { toast('⚠ ' + e.message); return; }
    // Abas de formulário (Spawn/Dar) não são redesenhadas: senão os campos preenchidos (jogador, espécie, nível) se perderiam a cada ação
    if (!fieldFocused() && (tab === 'players' || tab === 'sys' || tab === 'events')) render();
  }

  // ---------------- ações (delegação de eventos) ----------------
  function onClick(e) {
    const lv = e.target.closest('[data-lv]');
    if (lv) { $('spLv').value = lv.dataset.lv; return; }
    const head = e.target.closest('.ahead');
    if (head) { const u = head.parentElement.dataset.row; openRow = openRow === u ? null : u; form = null; render(); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a, u = b.dataset.u;
    switch (a) {
      case 'goto': return act('/teleport', { mode: 'to', username: u }, 'Teletransportado');
      case 'bring': return act('/teleport', { mode: 'bring', username: u }, 'Jogador trazido');
      case 'heal': return act('/heal', { username: u }, 'Equipe curada');
      case 'kick': return act('/kick', { username: u }, 'Jogador expulso');
      case 'unmute': return act('/unmute', { username: u }, 'Chat liberado');
      case 'unban': return act('/unban', { username: u }, 'Conta desbanida');
      case 'mute': case 'ban': form = { action: a, username: u }; openRow = u; return render();
      case 'cancel': form = null; return render();
      case 'confirm': {
        const row = b.closest('.arow');
        const dur = row.querySelector('[data-f=dur]').value, reason = row.querySelector('[data-f=reason]').value;
        const body = { username: form.username, reason, ...(dur === 'perm' ? { permanent: true } : { minutes: +dur }) };
        const path = form.action === 'ban' ? '/ban' : '/mute';
        form = null;
        return act(path, body, form === null && path === '/ban' ? 'Conta banida' : 'Jogador silenciado');
      }
      case 'spawn': {
        const body = { species_id: +$('spS').value, level: num('spLv', 30), count: num('spN', 1), ttl_min: +$('spTtl').value };
        if ($('spWhere').value === 'xy') { body.x = num('spX', 50); body.y = num('spY', 50); }
        return act('/spawn', body, 'Spawn criado');
      }
      case 'clearSpawns': return act('/clear-spawns', {}, 'Spawns removidos');
      case 'boss': return act('/boss', { species_id: $('bsS').value ? +$('bsS').value : null }, 'Boss chamado');
      case 'givePoke': return act('/give-pokemon', { username: $('gvU').value.trim(), species_id: +$('gvS').value, level: num('gvLv', 30) }, 'Pokémon entregue');
      case 'giveItem': return act('/give-item', { username: $('gvU').value.trim(), item: $('gvItem').value, amount: num('gvN', 1) }, 'Item entregue');
      case 'healGv': return act('/heal', { username: $('gvU').value.trim() }, 'Equipe curada');
      case 'announce': return act('/announce', { text: $('anTxt').value }, 'Aviso enviado').then(() => ($('anTxt') && ($('anTxt').value = '')));
      case 'evStart': evLobbyVal = num('evLobby', 60); return act('/events/start', { type: b.dataset.t, lobbySec: evLobbyVal }, 'Evento iniciado');
      case 'evCancel': return act('/events/cancel', {}, 'Evento cancelado');
      case 'evAuto': return act('/events/auto', { enabled: !evs?.auto.enabled }, 'Agendamento atualizado');
      case 'tpxy': return act('/teleport', { mode: 'xy', x: num('tpX', 50), y: num('tpY', 50) }, 'Teletransportado');
    }
  }

  function open(on = !$('admin').classList.contains('open')) {
    $('admin').classList.toggle('open', on);
    $('admin').setAttribute('aria-hidden', !on);
    clearInterval(timer);
    if (!on) return;
    ['drawer', 'bag', 'group'].forEach((id) => $(id).classList.remove('open'));
    refresh();
    timer = setInterval(() => { if ($('admin').classList.contains('open') && (tab === 'players' || tab === 'sys' || tab === 'events')) refresh(); }, 4000);
  }

  function init() {
    $('adminBtn').addEventListener('click', () => open());
    $('closeAdmin').addEventListener('click', () => open(false));
    $('adminBody').addEventListener('click', onClick);
    document.querySelectorAll('#admin .atabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; form = null; if (tab === 'sys') logRows = null; refresh().then(render); render(); }));
    ['partyBtn', 'bagBtn', 'groupBtn'].forEach((id) => $(id).addEventListener('click', () => open(false)));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  }
  init();
  return { open };
})();
