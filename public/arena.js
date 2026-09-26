// Arena: clãs, desafios PvP (solo / grupo / guerra de clãs), ranking e a tela da batalha PvP.
// Toda a lógica é do servidor; aqui só exibimos e enviamos escolhas.
const Arena = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`;
  const ROLE = { leader: '👑 Líder', officer: '⭐ Oficial', member: 'Membro' };
  const MODE_INFO = {
    solo: ['🥊 Solo 1x1', 'Um duelo entre dois jogadores.'],
    group: ['👥 Grupo', 'Seu grupo contra outro grupo do mesmo tamanho. Só o líder desafia.'],
    clan: ['🏰 Guerra de clãs', 'Líder/oficial de um clã contra líder/oficial de outro (com grupo de membros do clã, ou 1x1). Vale pontos para o clã.'],
  };
  let socket = null;
  let tab = 'fight';
  let mode = 'solo';
  let CLAN = null; // resposta de /api/clan/me
  let pending = null; // desafio recebido
  let pTimer = null;
  let m = null; // partida atual (último estado)
  let locked = true;
  let queue = Promise.resolve();
  let deadlineTimer = null;

  const api = async (path, body) => {
    const r = await fetch('/api' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Erro');
    return j;
  };
  const say = (e) => toast(e.message || 'Erro');

  // ---------------------------------------------------------------- painel
  const isOpen = () => $('arena').classList.contains('open');
  function open(on = !isOpen()) {
    $('arena').classList.toggle('open', on);
    $('arena').setAttribute('aria-hidden', !on);
    if (!on) return;
    ['drawer', 'bag', 'group', 'settings'].forEach((id) => $(id).classList.remove('open'));
    render();
  }
  function setTab(t) {
    tab = t;
    document.querySelectorAll('#arenaTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  async function render() {
    const body = $('arenaBody');
    if (tab === 'fight') return renderFight(body);
    if (tab === 'clan') return renderClan(body);
    return renderRank(body);
  }

  // ---- Desafiar
  async function renderFight(body) {
    body.innerHTML =
      '<div class="modes">' + Object.entries(MODE_INFO).map(([k, [t]]) => '<button data-mode="' + k + '" class="' + (k === mode ? 'active' : '') + '">' + t + '</button>').join('') + '</div>' +
      '<p class="hintline">' + MODE_INFO[mode][1] + ' Todos lutam no <b>Lv.50</b> com até 3 Pokémon da sua equipe: <b>ninguém perde nada</b>. Vale ranking.</p>' +
      '<div class="section-title">Jogadores online</div><div id="arenaOnline" class="plist"><p class="empty">Carregando…</p></div>';
    body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; renderFight(body); }));
    let list = [];
    try { list = await api('/pvp/online'); } catch (e) { return say(e); }
    if (tab !== 'fight') return;
    const box = $('arenaOnline');
    if (!box) return;
    box.innerHTML = list.length ? list.map((p) =>
      '<div class="item pl"><span class="avatar sm">' + esc(p.username[0]) + '</span><div><b>' + (p.tag ? '<span class="ctag">[' + esc(p.tag) + ']</span> ' : '') + esc(p.username) + '</b>' +
      '<small>' + (p.busy ? 'Ocupado' : p.group ? 'Em grupo (' + p.group + ')' : 'Livre') + ' · ⭐ ' + p.rating + '</small></div>' +
      '<button class="btn small" data-t="' + esc(p.username) + '"' + (p.busy ? ' disabled' : '') + '>Desafiar</button></div>').join('') : '<p class="empty">Ninguém mais online agora.</p>';
    box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => socket.emit('pvp:challenge', { mode, target: b.dataset.t })));
  }

  // ---- Clã
  async function renderClan(body) {
    try { CLAN = await api('/clan/me'); } catch (e) { return say(e); }
    if (tab !== 'clan') return;
    if (!CLAN.clan) {
      body.innerHTML =
        (CLAN.invite ? '<div class="item"><span>🏰</span><div><b>' + esc(CLAN.invite.from) + '</b> convidou você para um clã</div><button class="btn small" id="clYes">Aceitar</button></div>' : '') +
        '<div class="section-title">Criar clã</div>' +
        '<div class="invite-form"><input id="clName" placeholder="Nome (3-16)" maxlength="16" /><input id="clTag" placeholder="TAG" maxlength="4" style="max-width:84px;text-transform:uppercase" /></div>' +
        '<button class="btn small" id="clCreate">Criar clã</button>' +
        '<p class="hintline">Um clã tem até 30 membros, cargos (líder, oficiais), chat próprio, tag ao lado do nome e disputa guerras de clãs por pontos no ranking.</p>';
      $('clYes')?.addEventListener('click', async () => { try { await api('/clan/respond', { accept: true }); } catch (e) { say(e); } render(); });
      $('clCreate').addEventListener('click', async () => {
        try { await api('/clan/create', { name: $('clName').value.trim(), tag: $('clTag').value.trim() }); toast('Clã criado!'); } catch (e) { say(e); }
        render();
      });
      return;
    }
    const { clan, role, members } = CLAN;
    const lead = role === 'leader', off = role !== 'member';
    body.innerHTML =
      '<div class="clanhead"><b>[' + esc(clan.tag) + '] ' + esc(clan.name) + '</b><span>' + ROLE[role] + '</span></div>' +
      '<div class="mats"><div class="mat"><b>' + clan.points + '</b><span>Pontos</span></div><div class="mat"><b>' + clan.wins + ' / ' + clan.losses + '</b><span>Vitórias / Derrotas</span></div></div>' +
      '<div class="section-title">Membros (' + members.length + '/' + CLAN.max + ')</div>' +
      members.map((mb) =>
        '<div class="item cm-row"><span class="dot ' + (mb.online ? 'on' : '') + '"></span><div><b>' + esc(mb.username) + '</b><small>' + ROLE[mb.role] + ' · ⭐ ' + mb.rating + '</small></div><span class="mact">' +
        (mb.username !== nameNow() && off && mb.role !== 'leader' && (lead || mb.role === 'member') ? '<button data-a="kick" data-u="' + esc(mb.username) + '" title="Expulsar">🚫</button>' : '') +
        (lead && mb.role === 'member' ? '<button data-a="officer" data-u="' + esc(mb.username) + '" title="Promover a oficial">⭐</button>' : '') +
        (lead && mb.role === 'officer' ? '<button data-a="member" data-u="' + esc(mb.username) + '" title="Rebaixar">⬇</button>' : '') +
        (lead && mb.username !== nameNow() ? '<button data-a="transfer" data-u="' + esc(mb.username) + '" title="Passar a liderança">👑</button>' : '') +
        '</span></div>').join('') +
      (off ? '<div class="section-title">Convidar jogador</div><div class="invite-form"><input id="clInv" placeholder="Nome do jogador (online)" maxlength="16" /><button class="btn small" id="clInvBtn">Convidar</button></div>' : '') +
      '<div class="clanfoot"><button class="btn small ghost" id="clLeave">Sair do clã</button>' + (lead ? '<button class="btn small danger" id="clDisband">Dissolver</button>' : '') + '</div>' +
      '<p class="hintline">Chat do clã: aba <b>Clã</b> no chat ou <b>/c mensagem</b>. Guerra de clãs: aba Desafiar → Guerra de clãs (líder/oficial).</p>';
    body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a, u = b.dataset.u;
      if (a === 'kick' && !confirm('Expulsar ' + u + ' do clã?')) return;
      if (a === 'transfer' && !confirm('Passar a liderança para ' + u + '? Você vira oficial.')) return;
      try { await (a === 'kick' ? api('/clan/kick', { username: u }) : a === 'transfer' ? api('/clan/transfer', { username: u }) : api('/clan/role', { username: u, role: a })); } catch (e) { say(e); }
      render();
    }));
    $('clInvBtn')?.addEventListener('click', async () => { try { await api('/clan/invite', { username: $('clInv').value.trim() }); toast('Convite enviado'); $('clInv').value = ''; } catch (e) { say(e); } });
    $('clLeave').addEventListener('click', async () => { if (!confirm('Sair do clã?')) return; try { await api('/clan/leave', {}); } catch (e) { say(e); } render(); });
    $('clDisband')?.addEventListener('click', async () => { if (!confirm('Dissolver o clã para todos os membros? Não dá para desfazer.')) return; try { await api('/clan/disband', {}); } catch (e) { say(e); } render(); });
  }
  const nameNow = () => $('hudName').textContent;

  // ---- Ranking
  async function renderRank(body) {
    let p, c;
    try { [p, c] = await Promise.all([api('/pvp/top'), api('/clan/top')]); } catch (e) { return say(e); }
    if (tab !== 'rank') return;
    body.innerHTML =
      '<div class="mats"><div class="mat"><b>' + p.me.pvp_rating + '</b><span>Seu rating</span></div><div class="mat"><b>' + p.me.pvp_wins + ' / ' + p.me.pvp_losses + '</b><span>Vitórias / Derrotas</span></div></div>' +
      '<div class="section-title">Melhores jogadores</div>' +
      (p.top.length ? p.top.map((r) => '<div class="item rk"><b>' + r.pos + '</b><div><b>' + (r.tag ? '<span class="ctag">[' + esc(r.tag) + ']</span> ' : '') + esc(r.username) + '</b><small>' + r.wins + 'V · ' + r.losses + 'D</small></div><em>' + r.rating + '</em></div>').join('') : '<p class="empty">Ninguém lutou ainda.</p>') +
      '<div class="section-title">Melhores clãs</div>' +
      (c.length ? c.map((r) => '<div class="item rk"><b>' + r.pos + '</b><div><b><span class="ctag">[' + esc(r.tag) + ']</span> ' + esc(r.name) + '</b><small>' + r.members + ' membros · ' + r.wins + 'V · ' + r.losses + 'D</small></div><em>' + r.points + '</em></div>').join('') : '<p class="empty">Nenhum clã ainda.</p>');
  }

  // ---------------------------------------------------------------- desafio recebido
  function showChallenge(c) {
    pending = c;
    const [title] = MODE_INFO[c.mode];
    $('pvpInvTxt').textContent = c.from + ' desafiou você — ' + title + (c.size > 1 ? ' (' + c.size + 'x' + c.size + ')' : '') + (c.clan ? ' · clã ' + c.clan : '');
    $('pvpInvite').hidden = false;
    clearTimeout(pTimer);
    pTimer = setTimeout(hideChallenge, c.ms || 30000);
  }
  function hideChallenge() { pending = null; $('pvpInvite').hidden = true; clearTimeout(pTimer); }

  // ---------------------------------------------------------------- batalha PvP
  const setBar = (id, hp, max) => {
    const pct = Math.max(0, Math.min(100, (hp / max) * 100)), bar = $(id);
    bar.style.width = pct + '%';
    bar.dataset.lvl = pct > 50 ? 'high' : pct > 20 ? 'mid' : 'low';
  };
  const hit = (el) => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); };
  const msg = (t) => { $('pvMsg').textContent = t; };

  function paint(s, animate) {
    const me = s.you.team[s.you.idx], foe = s.foe.team[s.foe.idx];
    const switchedMe = $('pvMy').dataset.sp !== String(me.species_id) + ':' + s.you.idx;
    const switchedFoe = $('pvFoe').dataset.sp !== String(foe.species_id) + ':' + s.foe.idx;
    if (switchedMe) { $('pvMy').src = backUrl(me.species_id); $('pvMy').dataset.sp = me.species_id + ':' + s.you.idx; if (animate) { $('pvMy').classList.remove('released'); void $('pvMy').offsetWidth; $('pvMy').classList.add('released'); } }
    if (switchedFoe) { $('pvFoe').src = spriteUrl(foe.species_id); $('pvFoe').dataset.sp = foe.species_id + ':' + s.foe.idx; if (animate) { $('pvFoe').classList.remove('released'); void $('pvFoe').offsetWidth; $('pvFoe').classList.add('released'); } }
    $('pvMyName').textContent = (me.nickname || speciesName(me.species_id));
    $('pvMyLv').textContent = 'Lv. ' + me.level;
    $('pvMyHpTxt').textContent = me.hp + ' / ' + me.maxHp;
    $('pvFoeName').textContent = s.foe.name + ' · ' + (foe.nickname || speciesName(foe.species_id));
    $('pvFoeLv').textContent = 'Lv. ' + foe.level;
    $('pvFoeTypes').innerHTML = typeChips(foe.species_id);
    $('pvMyTypes').innerHTML = typeChips(me.species_id);
    $('pvMyPips').innerHTML = s.you.team.map((t) => '<i class="' + (t.hp <= 0 ? 'ko' : '') + '"></i>').join('');
    $('pvFoePips').innerHTML = s.foe.team.map((t) => '<i class="' + (t.hp <= 0 ? 'ko' : '') + '"></i>').join('');
    setBar('pvMyHp', me.hp, me.maxHp);
    setBar('pvFoeHp', foe.hp, foe.maxHp);
    // botões de golpe com tipo e efetividade
    const mt = SPECIES[me.species_id].types, ft = SPECIES[foe.species_id].types;
    [['attack', 'normal', 'Investida', '1'], ['strong', mt[0], MOVE_NAMES[mt[0]], '2']].forEach(([act, type, name, key]) => {
      const b = document.querySelector('#pvActions [data-act=' + act + ']');
      const eff = effectiveness(type, ft);
      const tag = eff === 0 ? '<i class="efx no">✕ Imune</i>' : eff > 1 ? '<i class="efx up">▲ Super</i>' : eff < 1 ? '<i class="efx down">▼ Fraco</i>' : '';
      b.innerHTML = '<span class="mvname">' + name + '</span><span class="tchip" style="--tc:' + TYPES[type].color + '">' + TYPES[type].label + '</span>' + tag + '<small>' + key + '</small>';
      b.style.setProperty('--tc', TYPES[type].color);
    });
    // resumo dos outros duelos (grupo/guerra)
    const sum = $('pvDuels');
    sum.hidden = s.duels.length < 2;
    sum.innerHTML = s.duels.map((d, i) => '<span class="' + (i === s.duel ? 'me ' : '') + (d.winner === null ? '' : 'done') + '">' + esc(d.a) + ' × ' + esc(d.b) + (d.winner === null ? '' : ' ✔') + '</span>').join('');
  }

  function openSwitch(forced) {
    const s = m;
    $('pvSwTitle').textContent = forced ? 'Escolha o próximo Pokémon!' : 'Trocar de Pokémon (gasta o turno)';
    $('pvSwBack').hidden = forced;
    $('pvSwList').innerHTML = s.you.team.map((p, i) => {
      const off = p.hp <= 0 || i === s.you.idx;
      const pct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
      return '<button class="sw-item' + (i === s.you.idx ? ' active' : '') + '" data-i="' + i + '"' + (off ? ' disabled' : '') + '><img src="' + spriteUrl(p.species_id) + '" alt="" />' +
        '<span class="sw-info"><b>' + esc(p.nickname || speciesName(p.species_id)) + '</b><small>Lv. ' + p.level + ' ' + typeChips(p.species_id) + '</small><i><u style="width:' + pct + '%"></u></i></span>' +
        '<em>' + (p.hp <= 0 ? 'Desmaiou' : p.hp + '/' + p.maxHp) + '</em><kbd>' + (i + 1) + '</kbd></button>';
    }).join('');
    $('pvSwList').querySelectorAll('.sw-item').forEach((b) => b.addEventListener('click', () => act('switch:' + b.dataset.i)));
    $('pvActions').hidden = true;
    $('pvSwitch').hidden = false;
  }
  const showActions = () => { $('pvSwitch').hidden = true; $('pvActions').hidden = false; };

  function lock(v) {
    locked = v;
    document.querySelectorAll('#pvActions .act').forEach((b) => (b.disabled = v || (b.dataset.act === 'switch' && !m?.you.team.some((p, i) => p.hp > 0 && i !== m.you.idx))));
  }

  function act(a) {
    if (!m || locked || m.over) return;
    if (a === 'switch') return openSwitch(false);
    if (a === 'forfeit') { if (!confirm('Desistir deste duelo?')) return; socket.emit('pvp:forfeit'); return; }
    lock(true);
    showActions();
    msg('Aguardando o adversário…');
    socket.emit('pvp:action', { match: m.match, action: a });
  }

  function tick() {
    clearInterval(deadlineTimer);
    deadlineTimer = setInterval(() => {
      const el = $('pvTimer');
      if (!m || m.over || !m.deadline) { el.textContent = ''; return; }
      el.textContent = '⏱ ' + Math.max(0, Math.ceil((m.deadline - Date.now()) / 1000)) + 's';
    }, 250);
  }

  async function onState(s) {
    const first = !m || m.match !== s.match;
    if (first) {
      inBattle = true;
      chatBattle(true);
      window.worldScene?.player?.setVelocity(0, 0);
      ['drawer', 'bag', 'group', 'arena'].forEach((id) => $(id).classList.remove('open'));
      $('pvpBattle').hidden = false;
      $('pvpBattle').dataset.biome = s.biome || 'field';
      $('pvContinue').hidden = true;
      $('pvMy').dataset.sp = ''; $('pvFoe').dataset.sp = '';
      $('pvLabel').textContent = s.mode === 'clan' ? '🏰 Guerra de clãs' : s.mode === 'group' ? '👥 PvP de grupo' : '🥊 PvP solo';
      $('pvResult').hidden = true;
      m = null;
      tick();
    }
    const prev = m;
    m = s;
    queue = queue.then(() => run(s, prev, first)).catch(console.error);
  }

  async function run(s, prev, first) {
    if (m.match !== s.match) return;
    paint(s, !first);
    if (first) { lock(true); showActions(); }
    for (const e of s.log) {
      msg(e.msg);
      if (e.atk && !first) {
        const mineAtt = e.atk.by === 'me';
        await Fx.attack($('pvFx'), e.atk, $(mineAtt ? 'pvMy' : 'pvFoe'), $(mineAtt ? 'pvFoe' : 'pvMy'), { crit: /crítico/.test(e.msg), dmg: +(/\(-(\d+)\)/.exec(e.msg)?.[1] || 0), eff: e.eff });
      }
      if (/usou|errou/.test(e.msg) && !first) { // sacode quem levou o golpe
        const meNamed = e.msg.includes('de ' + s.you.name + ' usou');
        if (e.eff !== undefined && e.eff !== null) hit($(meNamed ? 'pvFoe' : 'pvMy'));
      }
      await sleep(e.fx === 'switch' ? 700 : e.atk ? 600 : 950);
    }
    if (s.over) {
      lock(true);
      $('pvActions').hidden = true; $('pvSwitch').hidden = true;
      msg(s.won === 'you' ? '🏆 Você venceu o duelo!' : 'Você perdeu o duelo.');
      if (s.duels.some((d) => d.winner === null)) msg((s.won === 'you' ? '🏆 Duelo vencido!' : 'Duelo perdido.') + ' Aguardando os outros duelos…');
      return;
    }
    if (s.you.forced) { lock(false); openSwitch(true); msg('Seu Pokémon desmaiou! Escolha o próximo.'); }
    else if (s.you.chose) { lock(true); msg('Aguardando o adversário…'); }
    else { lock(false); showActions(); if (!s.log.length || first) msg('Sua vez! Escolha uma ação.'); }
  }

  function onEnd(e) {
    queue = queue.then(async () => {
      await sleep(600);
      const box = $('pvResult');
      const title = e.result === 'win' ? '🏆 Vitória!' : e.result === 'lose' ? 'Derrota' : 'Empate';
      box.className = 'pvres ' + e.result;
      box.innerHTML = '<h3>' + title + '</h3><p>Placar de duelos: ' + e.wins[0] + ' x ' + e.wins[1] + '</p>' +
        (e.farm ? '<p class="hintline">Você lutou muitas vezes contra os mesmos adversários na última hora: esta luta não valeu pontos.</p>'
          : '<p>Rating: <b>' + (e.delta >= 0 ? '+' : '') + e.delta + '</b> (agora ' + e.rating + ')</p>') +
        (e.clanPoints ? '<p>🏰 Pontos do clã: <b>' + (e.clanPoints > 0 ? '+' : '') + e.clanPoints + '</b></p>' : '');
      box.hidden = false;
      $('pvActions').hidden = true; $('pvSwitch').hidden = true;
      $('pvContinue').hidden = false;
      $('pvContinue').focus();
    }).catch(console.error);
  }

  function closeBattle() {
    clearInterval(deadlineTimer);
    $('pvpBattle').hidden = true;
    m = null;
    inBattle = false;
    chatBattle(false);
    if (isOpen()) render();
  }

  // ---------------------------------------------------------------- menu ao tocar em outro jogador
  const RANKS = { member: 1, officer: 2, leader: 3 };
  function closeMenu() { $('playerMenu').hidden = true; }
  function playerMenu(id, cx, cy) {
    if (inBattle) return;
    const o = window.worldScene?.others.get(id);
    if (!o) return;
    const name = o.name;
    const isLeader = GROUP && GROUP.leader === MY_ID;
    const mate = GROUP?.members.some((mb) => mb.id === id);
    const acts = [
      ['solo', '🥊 Desafiar 1x1'],
      ...(isLeader && !mate ? [['group', '👥 Desafiar grupo']] : []),
      ...(MY_CLAN && o.clan && RANKS[MY_CLAN.role] >= 2 ? [['clan', '🏰 Guerra de clãs']] : []),
      ...(!mate && (!GROUP || isLeader) ? [['invite', '➕ Convidar para o grupo']] : []),
      ...(MY_CLAN && RANKS[MY_CLAN.role] >= 2 && !o.clan ? [['clanInvite', '🏰 Convidar para o clã']] : []),
      ['whisper', '💬 Sussurrar'],
    ];
    const box = $('playerMenu');
    box.innerHTML = '<div class="pm-name">' + (o.clan ? '<span class="ctag">[' + esc(o.clan.tag) + ']</span> ' : '') + esc(name) + (mate ? ' <small>(do seu grupo)</small>' : '') + '</div>' +
      acts.map(([k, t]) => '<button data-k="' + k + '">' + t + '</button>').join('') + '<button data-k="x" class="ghost">Fechar</button>';
    box.hidden = false;
    // posiciona junto ao toque, sem sair da tela
    const w = box.offsetWidth, hh = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2)) + 'px';
    box.style.top = Math.max(8, Math.min(innerHeight - hh - 8, cy + 14)) + 'px';
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.k;
      closeMenu();
      if (k === 'solo' || k === 'group' || k === 'clan') socket.emit('pvp:challenge', { mode: k, target: name });
      else if (k === 'invite') socket.emit('group:invite', name);
      else if (k === 'clanInvite') { try { await api('/clan/invite', { username: name }); toast('Convite de clã enviado'); } catch (e) { say(e); } }
      else if (k === 'whisper') { openChat(true, true); $('chatInput').value = '/w ' + name + ' '; }
    }));
  }

  // ---------------------------------------------------------------- inicialização
  function init(s) {
    socket = s;
    s.on('pvp:challenged', showChallenge);
    s.on('pvp:challenge-gone', hideChallenge);
    s.on('pvp:state', onState);
    s.on('pvp:end', onEnd);
    s.on('clan:update', () => { api('/clan/me').then((r) => { if (MY_CLAN && r.clan) MY_CLAN.role = r.role; }).catch(() => {}); if (isOpen() && tab === 'clan') render(); });
    s.on('clan:invited', ({ from, name, tag }) => {
      $('inviteTxt').textContent = from + ' convidou você para o clã [' + tag + '] ' + name;
      $('invYes').onclick = async () => { $('invite').hidden = true; try { await api('/clan/respond', { accept: true }); toast('Você entrou no clã!'); } catch (e) { say(e); } $('invYes').onclick = null; };
      $('invNo').onclick = async () => { $('invite').hidden = true; try { await api('/clan/respond', { accept: false }); } catch {} $('invNo').onclick = null; };
      $('invite').hidden = false;
      setTimeout(() => ($('invite').hidden = true), 60000);
    });
  }

  $('arenaBtn').addEventListener('click', () => open());
  $('closeArena').addEventListener('click', () => open(false));
  document.querySelectorAll('#arenaTabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('pvpYes').addEventListener('click', () => { if (pending) socket.emit('pvp:respond', { id: pending.id, accept: true }); hideChallenge(); });
  $('pvpNo').addEventListener('click', () => { if (pending) socket.emit('pvp:respond', { id: pending.id, accept: false }); hideChallenge(); });
  document.querySelectorAll('#pvActions .act').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  $('pvSwBack').addEventListener('click', showActions);
  $('pvContinue').addEventListener('click', closeBattle);
  window.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (!$('pvpBattle').hidden) {
      if (!$('pvContinue').hidden) { if (e.key === 'Enter' || e.key === ' ') closeBattle(); return; }
      if (!$('pvSwitch').hidden) { if (/^[1-3]$/.test(e.key) && m?.you.team[e.key - 1]) act('switch:' + (e.key - 1)); return; }
      const map = { 1: 'attack', 2: 'strong', 3: 'switch' };
      if (map[e.key]) act(map[e.key]);
      return;
    }
    if (!token || inBattle) return;
    if (e.key.toLowerCase() === 'k') open();
    if (e.key === 'Escape') open(false);
  });

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  return { init, open, playerMenu, closeMenu };
})();
