// UI de batalha (DOM). A lógica é 100% do servidor: aqui só enviamos ações e animamos o log recebido.
const Battle = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`;
  let socket = null;
  let active = false; // overlay aberto
  let locked = true; // aguardando servidor / animando
  const st = { foeMax: 1, mineId: null };

  function setBar(id, hp, max) {
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const bar = $(id);
    bar.style.width = pct + '%';
    bar.dataset.lvl = pct > 50 ? 'high' : pct > 20 ? 'mid' : 'low';
  }

  function setFoe(w) {
    st.foeMax = w.maxHp;
    $('foeName').textContent = speciesName(w.species_id);
    $('foeLv').textContent = 'Lv. ' + w.level;
    setBar('foeHp', w.hp, w.maxHp);
  }

  function setMine(m, animate = false) {
    if (st.mineId !== m.id) {
      st.mineId = m.id;
      $('myImg').src = backUrl(m.species_id);
      if (animate) { $('myImg').classList.remove('released'); void $('myImg').offsetWidth; $('myImg').classList.add('released'); }
    }
    $('myName').textContent = m.nickname || speciesName(m.species_id);
    $('myLv').textContent = 'Lv. ' + m.level;
    $('myHpTxt').textContent = `${m.hp} / ${m.maxHp}`;
    setBar('myHp', m.hp, m.maxHp);
    $('myXp').style.width = Math.min(100, (m.exp / m.expMax) * 100) + '%';
  }

  const msg = (t) => { $('bMsg').textContent = t; };
  const setBallCount = (n) => { $('bBalls').textContent = n; setBalls(n); };
  const lock = (v) => { locked = v; document.querySelectorAll('.act').forEach((b) => (b.disabled = v || (b.dataset.act === 'ball' && +$('bBalls').textContent <= 0))); };

  function hit(el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }

  function start(d) {
    active = true;
    st.mineId = null;
    const foe = $('foeImg');
    foe.classList.remove('in-ball', 'hit', 'released');
    foe.src = spriteUrl(d.wild.species_id);
    $('battle').hidden = false;
    setFoe(d.wild);
    setMine(d.mine);
    setBallCount(d.balls);
    $('bActions').hidden = false;
    $('bContinue').hidden = true;
    lock(true);
    msg(`Um ${speciesName(d.wild.species_id).replace(/^./, (ch) => ch.toUpperCase())} selvagem apareceu!`);
    setTimeout(() => lock(false), 1300);
  }

  async function update(d) {
    setBallCount(d.balls);
    let wildHp = null;
    for (const e of d.log) {
      if (e.fx === 'ball') {
        const fx = $('ballFx');
        fx.classList.remove('throw'); void fx.offsetWidth; fx.classList.add('throw');
        msg(e.msg);
        await sleep(950);
        $('foeImg').classList.add('in-ball');
        await sleep(600);
        setBallCount(d.balls);
        continue;
      }
      msg(e.msg);
      const prevFoe = wildHp ?? parseFloat($('foeHp').style.width || 100);
      setBar('foeHp', e.wildHp, st.foeMax);
      if (parseFloat($('foeHp').style.width) < prevFoe - 0.1) hit($('foeImg'));
      const prevHp = parseFloat($('myHp').style.width || 100);
      const switched = st.mineId !== e.mine.id;
      setMine(e.mine, switched);
      if (!switched && parseFloat($('myHp').style.width) < prevHp - 0.1) hit($('myImg'));
      if (e.fx === 'escape') { $('foeImg').classList.remove('in-ball'); $('foeImg').classList.add('released'); }
      await sleep(e.fx === 'caught' ? 1400 : 1050);
    }
    if (d.result) {
      $('bActions').hidden = true;
      $('bContinue').hidden = false;
      $('bContinue').focus();
      $('bContinue')._result = d;
    } else lock(false);
  }

  function close() {
    if (!active) return;
    const d = $('bContinue')._result;
    $('battle').hidden = true;
    active = false;
    inBattle = false;
    if (d?.result === 'caught') toast(`${speciesName(d.capture.species_id)} foi adicionado à sua party!`);
    if (d?.result === 'lose') toast('Você desmaiou e voltou ao Centro Pokémon');
  }

  function act(type) {
    if (!active || locked) return;
    lock(true);
    socket.emit('battle:action', type);
  }

  function init(s) {
    socket = s;
    socket.on('battle:update', update);
  }

  document.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  $('bContinue').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    const map = { 1: 'attack', 2: 'strong', 3: 'ball', 4: 'run' };
    if (map[e.key]) act(map[e.key]);
    if ((e.key === 'Enter' || e.key === ' ') && !$('bContinue').hidden) close();
  });

  return { init, start };
})();
