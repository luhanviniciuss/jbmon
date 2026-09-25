// UI de batalha (DOM). A lógica é 100% do servidor: aqui só enviamos ações e animamos o log recebido.
// Dois modos: 'wild' (1 contra 1) e 'raid' (grupo contra o boss lendário, por turnos).
const Battle = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`;
  const KINDS = ['poke', 'great', 'ultra', 'master'];
  let socket = null;
  let mode = 'wild';
  let active = false; // overlay aberto
  let locked = true; // aguardando servidor / animando
  let inv = { poke: 0, great: 0, ultra: 0, master: 0 };
  let raid = null; // último estado da raid
  let turnEnds = 0;
  let turnTimer = null;
  let queue = Promise.resolve(); // atualizações da raid chegam em sequência e são animadas uma a uma
  const st = { foeMax: 1, mineId: null, mineSp: null, foeSp: null };

  let team = []; // equipe atual (vinda do servidor a cada turno)
  const pickerOpen = () => !$('ballPicker').hidden;
  const switchOpen = () => !$('switchPicker').hidden;
  const canSwitch = () => team.some((p) => p.hp > 0 && p.id !== st.mineId);

  function setBar(id, hp, max) {
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const bar = $(id);
    bar.style.width = pct + '%';
    bar.dataset.lvl = pct > 50 ? 'high' : pct > 20 ? 'mid' : 'low';
  }

  // Botões de golpe mostram nome, tipo e a efetividade contra o inimigo atual
  function renderMoves() {
    if (st.mineSp == null || st.foeSp == null) return;
    const mt = SPECIES[st.mineSp].types, ft = SPECIES[st.foeSp].types;
    [['attack', 'normal', 'Investida', '1'], ['strong', mt[0], MOVE_NAMES[mt[0]], '2']].forEach(([act, type, name, key]) => {
      const b = document.querySelector(`#bActions [data-act=${act}]`);
      const eff = effectiveness(type, ft);
      const tag = eff === 0 ? '<i class="efx no">✕ Imune</i>' : eff > 1 ? '<i class="efx up">▲ Super</i>' : eff < 1 ? '<i class="efx down">▼ Fraco</i>' : '';
      b.innerHTML = `<span class="mvname">${name}</span><span class="tchip" style="--tc:${TYPES[type].color}">${TYPES[type].label}</span>${tag}<small>${key}</small>`;
      b.style.setProperty('--tc', TYPES[type].color);
    });
  }

  function setFoe(w) {
    st.foeMax = w.maxHp;
    st.foeSp = w.species_id;
    const rar = rarityOf(w.species_id);
    $('foeName').textContent = speciesName(w.species_id);
    $('foeLv').textContent = 'Lv. ' + w.level;
    $('foeRar').innerHTML = `<span class="rar" style="--rc:${rar.color}">${rar.label}</span>${typeChips(w.species_id)}`;
    setBar('foeHp', w.hp, w.maxHp);
    renderMoves();
  }

  function setMine(m, animate = false) {
    if (st.mineId !== m.id || st.mineSp !== m.species_id) {
      const switched = st.mineId !== m.id;
      st.mineId = m.id;
      st.mineSp = m.species_id;
      $('myImg').src = backUrl(m.species_id);
      if (animate && switched) { $('myImg').classList.remove('released'); void $('myImg').offsetWidth; $('myImg').classList.add('released'); }
      renderMoves();
    }
    $('myName').textContent = m.nickname || speciesName(m.species_id);
    $('myLv').textContent = 'Lv. ' + m.level;
    $('myHpTxt').textContent = `${m.hp} / ${m.maxHp}`;
    setBar('myHp', m.hp, m.maxHp);
    $('myXp').style.width = Math.min(100, (m.exp / m.expMax) * 100) + '%';
  }

  const msg = (t) => { $('bMsg').textContent = t; };

  function refreshBalls() {
    setBalls(inv);
    $('bBalls').textContent = invTotal(inv);
    document.querySelectorAll('[data-ball]').forEach((b) => {
      const k = b.dataset.ball;
      b.querySelector('em').textContent = inv[k];
      b.disabled = locked || inv[k] <= 0;
    });
  }

  function lock(v) {
    locked = v;
    document.querySelectorAll('#bActions .act').forEach((b) => (b.disabled = v || (b.dataset.act === 'ballmenu' && invTotal(inv) <= 0) || (b.dataset.act === 'switch' && !canSwitch())));
    $('ballBack').disabled = v;
    refreshBalls();
  }

  // Painéis do rodapé: ações, seletor de Pokébolas e seletor de troca (só um aparece por vez)
  function showPanel(which) {
    $('bActions').hidden = which !== 'actions';
    $('ballPicker').hidden = which !== 'balls';
    $('switchPicker').hidden = which !== 'switch';
  }
  const showPicker = (open) => showPanel(open ? 'balls' : 'actions');

  function openSwitch(forced = false) {
    $('swTitle').textContent = forced ? 'Escolha o próximo Pokémon!' : 'Trocar de Pokémon (gasta o turno)';
    $('swBack').hidden = forced;
    $('swList').innerHTML = team.map((p, i) => {
      const off = p.hp <= 0 || p.id === st.mineId;
      const pct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
      return '<button class="sw-item' + (p.id === st.mineId ? ' active' : '') + '" data-id="' + p.id + '"' + (off ? ' disabled' : '') + '>' +
        '<img src="' + spriteUrl(p.species_id) + '" alt="" />' +
        '<span class="sw-info"><b>' + (p.nickname || speciesName(p.species_id)) + '</b><small>Lv. ' + p.level + ' ' + typeChips(p.species_id) + '</small><i><u style="width:' + pct + '%"></u></i></span>' +
        '<em>' + (p.hp <= 0 ? 'Desmaiou' : p.hp + '/' + p.maxHp) + '</em><kbd>' + (i + 1) + '</kbd></button>';
    }).join('');
    $('swList').querySelectorAll('.sw-item').forEach((b) => b.addEventListener('click', () => act('switch:' + b.dataset.id)));
    showPanel('switch');
  }

  function hit(el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }

  function resetField(m) {
    mode = m;
    active = true;
    st.mineId = st.mineSp = st.foeSp = null;
    const foe = $('foeImg');
    foe.className = 'b-sprite foe-sprite' + (m === 'raid' ? ' boss' : '');
    $('battle').hidden = false;
    $('raidBar').hidden = m !== 'raid';
    $('turnInfo').hidden = true;
    $('ballBack').hidden = false;
    document.querySelector('#bActions [data-act=run]').firstChild.textContent = m === 'raid' ? 'Sair' : 'Fugir';
    document.querySelector('#bActions [data-act=switch]').hidden = false;
    showPicker(false);
    $('bContinue').hidden = true;
    return foe;
  }

  // ---------- Batalha 1 contra 1 ----------
  function start(d) {
    inv = d.balls;
    team = d.team || [];
    const foe = resetField('wild');
    foe.src = spriteUrl(d.wild.species_id);
    setFoe(d.wild);
    setMine(d.mine);
    lock(true);
    const sp = SPECIES[d.wild.species_id];
    msg(`Um ${sp.name} selvagem apareceu!${sp.rarity === 'common' ? '' : ' ✦ ' + rarityOf(d.wild.species_id).label}`);
    setTimeout(() => lock(false), 1300);
  }

  // Anima uma lista de linhas do log. `hpKey` = campo do HP do inimigo; `isMine(e)` decide se o alvo sou eu.
  async function playLog(log, hpKey, mineOf) {
    for (const e of log) {
      if (e.fx === 'ball') {
        const fx = $('ballFx');
        fx.className = 'ball t-' + (e.kind || 'poke');
        void fx.offsetWidth;
        fx.classList.add('throw');
        msg(e.msg);
        await sleep(950);
        $('foeImg').classList.add('in-ball');
        await sleep(600);
        continue;
      }
      msg(e.msg);
      const prevFoe = parseFloat($('foeHp').style.width || 100);
      setBar('foeHp', e[hpKey], st.foeMax);
      if (parseFloat($('foeHp').style.width) < prevFoe - 0.1) hit($('foeImg'));
      const m = mineOf(e);
      if (m) {
        const prevHp = parseFloat($('myHp').style.width || 100);
        const switched = st.mineId !== m.id;
        if (e.fx === 'evolve') { // silhueta brilhando e troca de sprite
          $('myImg').classList.add('evolving');
          await sleep(1300);
          $('myImg').classList.remove('evolving');
          $('myImg').classList.add('evolved');
        }
        setMine(m, switched);
        if (!switched && e.fx !== 'evolve' && parseFloat($('myHp').style.width) < prevHp - 0.1) hit($('myImg'));
      }
      if (e.fx === 'exhaust') $('foeImg').classList.add('exhausted');
      if (e.fx === 'escape') { $('foeImg').classList.remove('in-ball'); $('foeImg').classList.add('released'); }
      await sleep(e.fx === 'caught' || e.fx === 'evolve' || e.fx === 'exhaust' ? 1500 : 1050);
      $('myImg').classList.remove('evolved');
    }
  }

  async function update(d) {
    inv = d.balls;
    refreshBalls();
    await playLog(d.log, 'wildHp', (e) => e.mine);
    team = d.team || team;
    showPicker(false);
    if (d.result) {
      $('bActions').hidden = true;
      $('bContinue').hidden = false;
      $('bContinue').focus();
      $('bContinue')._result = d;
    } else if (d.forceSwitch) { // o Pokémon da vez desmaiou: escolha quem entra (sem gastar o turno)
      lock(false);
      openSwitch(true);
    } else lock(false);
  }

  // ---------- Raid (grupo x boss) ----------
  function renderRaidBar(s) {
    $('raidBar').innerHTML = s.members.map((m) => {
      const pct = Math.max(0, (m.mine.hp / m.mine.maxHp) * 100);
      return `<div class="rm${s.turn && s.turn.uid === m.id ? ' turn' : ''}${m.eliminated || m.left ? ' out' : ''}"><b>${esc(m.username)}${m.id === MY_ID ? ' •' : ''}</b><i><u style="width:${pct}%"></u></i></div>`;
    }).join('');
  }

  function startRaid(d) {
    const s = d.state;
    raid = s;
    inv = s.you.balls;
    team = s.you.team || [];
    const foe = resetField('raid');
    foe.src = spriteUrl(s.boss.species_id);
    setFoe(s.boss);
    setMine(s.you.mine);
    renderRaidBar(s);
    lock(true);
    msg(`${SPECIES[s.boss.species_id].name} lendário bloqueia o caminho!`);
    queue = Promise.resolve();
    clearInterval(turnTimer);
    turnTimer = setInterval(tickTurn, 250);
  }

  function tickTurn() {
    const el = $('turnInfo');
    if (mode !== 'raid' || !raid || !raid.turn) { el.hidden = true; return; }
    const left = Math.max(0, Math.ceil((turnEnds - Date.now()) / 1000));
    const mine = raid.turn.uid === MY_ID;
    const who = raid.members.find((m) => m.id === raid.turn.uid);
    el.hidden = false;
    el.classList.toggle('mine', mine);
    el.textContent = mine && raid.turn.forced ? `Escolha o próximo Pokémon! ${left}s` : mine ? `Sua vez! ${left}s${raid.phase === 'capture' ? ' — lance uma Pokébola!' : ''}` : `Vez de ${who ? who.username : '…'} · ${left}s`;
  }

  // Aplica o estado final da raid: quem age agora e quais botões ficam ativos
  function applyRaid(s) {
    raid = s;
    inv = s.you.balls;
    team = s.you.team || team;
    turnEnds = s.turn ? Date.now() + s.turn.left : 0;
    setMine(s.you.mine);
    setBar('foeHp', s.boss.hp, s.boss.maxHp);
    renderRaidBar(s);
    const myTurn = !!s.turn && s.turn.uid === MY_ID;
    const fight = s.phase === 'fight';
    locked = !myTurn;
    const forced = myTurn && fight && !!s.turn.forced; // o Pokémon da vez desmaiou: escolha obrigatória
    document.querySelectorAll('#bActions .act').forEach((b) => (b.disabled = !myTurn || !fight || forced || b.dataset.act === 'ballmenu' || (b.dataset.act === 'switch' && !canSwitch())));
    const capture = myTurn && !fight; // fase de captura: só Pokébolas (uma rodada por membro)
    $('ballBack').hidden = true;
    if (forced) { locked = false; openSwitch(true); } else showPicker(capture);
    refreshBalls();
    tickTurn();
  }

  async function raidUpdate(d) {
    await playLog(d.log, 'bossHp', (e) => (e.target === MY_ID && e.targetMine ? e.targetMine : null));
    applyRaid(d.state);
  }

  async function raidEnd(d) {
    clearInterval(turnTimer);
    $('turnInfo').hidden = true;
    raid = null;
    setBalls(d.balls);
    if (d.result === 'left') { closeOverlay(); return; }
    const name = speciesName(st.foeSp).replace(/^./, (c) => c.toUpperCase());
    let text = d.result === 'caught' ? (d.you ? `🎉 Você capturou ${name}!` : `${d.winner} capturou ${name}!`)
      : d.result === 'fled' ? `${name} fugiu… ninguém conseguiu capturá-lo.` : 'Vocês foram derrotados e voltaram ao Centro Pokémon.';
    if (d.rewards) text += ` (+${d.rewards.apricorns} Bolotas, +${d.rewards.shards} Fragmentos)`;
    msg(text);
    showPicker(false);
    $('bActions').hidden = true;
    $('bContinue').hidden = false;
    $('bContinue').focus();
    $('bContinue')._result = { raid: true, ...d };
  }

  function closeOverlay() {
    $('battle').hidden = true;
    active = false;
    inBattle = false;
    chatBattle(false);
    mode = 'wild';
  }

  function close() {
    if (!active) return;
    const d = $('bContinue')._result;
    closeOverlay();
    if (d?.raid) {
      if (d.result === 'caught' && d.you) toast(`${speciesName(d.capture.species_id)} lendário foi adicionado à sua coleção!`, true);
      return;
    }
    if (d?.result === 'caught') toast(`${speciesName(d.capture.species_id)} foi adicionado à sua party!`);
    if (d?.result === 'lose') toast('Você desmaiou e voltou ao Centro Pokémon');
    if (d?.drops) toast(`+${d.drops.apricorns} Bolotas${d.drops.shards ? `, +${d.drops.shards} Fragmentos` : ''}`);
  }

  function act(type) {
    if (!active || locked) return;
    if (type === 'ballmenu') return invTotal(inv) > 0 && showPicker(true);
    if (type === 'switch') return canSwitch() && openSwitch(false);
    lock(true);
    showPicker(false);
    socket.emit(mode === 'raid' ? 'raid:action' : 'battle:action', type);
  }

  function init(s) {
    socket = s;
    socket.on('battle:update', update);
    socket.on('raid:update', (d) => { queue = queue.then(() => raidUpdate(d)).catch(console.error); });
    socket.on('raid:end', (d) => { queue = queue.then(() => raidEnd(d)).catch(console.error); });
  }

  document.querySelectorAll('#bActions .act').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  document.querySelectorAll('[data-ball]').forEach((b) => b.addEventListener('click', () => act('ball:' + b.dataset.ball)));
  $('ballBack').addEventListener('click', () => showPicker(false));
  $('swBack').addEventListener('click', () => showPanel('actions'));
  $('bContinue').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (!active || document.activeElement?.tagName === 'INPUT') return;
    if (!$('bContinue').hidden) { if (e.key === 'Enter' || e.key === ' ') close(); return; }
    if (switchOpen()) { // teclas 1-6 escolhem o Pokémon; Esc volta (exceto quando a escolha é obrigatória)
      if ((e.key === 'Escape' || e.key === 'Backspace') && !$('swBack').hidden) showPanel('actions');
      else if (/^[1-6]$/.test(e.key)) { const p = team[e.key - 1]; if (p && p.hp > 0 && p.id !== st.mineId) act('switch:' + p.id); }
      return;
    }
    if (pickerOpen()) {
      if ((e.key === 'Escape' || e.key === 'Backspace') && !$('ballBack').hidden) showPicker(false);
      else if (KINDS[e.key - 1]) act('ball:' + KINDS[e.key - 1]);
      return;
    }
    const map = { 1: 'attack', 2: 'strong', 3: 'ballmenu', 4: 'switch', 5: 'run' };
    if (map[e.key]) act(map[e.key]);
  });

  return { init, start, startRaid };
})();
