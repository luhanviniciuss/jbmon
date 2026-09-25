// UI de batalha (DOM). A lógica é 100% do servidor: aqui só enviamos ações e animamos o log recebido.
const Battle = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`;
  const KINDS = ['poke', 'great', 'ultra', 'master'];
  let socket = null;
  let active = false; // overlay aberto
  let locked = true; // aguardando servidor / animando
  let inv = { poke: 0, great: 0, ultra: 0, master: 0 };
  const st = { foeMax: 1, mineId: null, mineSp: null };

  const pickerOpen = () => !$('ballPicker').hidden;

  function setBar(id, hp, max) {
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const bar = $(id);
    bar.style.width = pct + '%';
    bar.dataset.lvl = pct > 50 ? 'high' : pct > 20 ? 'mid' : 'low';
  }

  function setFoe(w) {
    st.foeMax = w.maxHp;
    const rar = rarityOf(w.species_id);
    $('foeName').textContent = speciesName(w.species_id);
    $('foeLv').textContent = 'Lv. ' + w.level;
    $('foeRar').textContent = rar.label;
    $('foeRar').style.setProperty('--rc', rar.color);
    setBar('foeHp', w.hp, w.maxHp);
  }

  function setMine(m, animate = false) {
    if (st.mineId !== m.id || st.mineSp !== m.species_id) {
      const switched = st.mineId !== m.id;
      st.mineId = m.id;
      st.mineSp = m.species_id;
      $('myImg').src = backUrl(m.species_id);
      if (animate && switched) { $('myImg').classList.remove('released'); void $('myImg').offsetWidth; $('myImg').classList.add('released'); }
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
    document.querySelectorAll('#bActions .act').forEach((b) => (b.disabled = v || (b.dataset.act === 'ballmenu' && invTotal(inv) <= 0)));
    $('ballBack').disabled = v;
    refreshBalls();
  }

  function showPicker(open) {
    $('ballPicker').hidden = !open;
    $('bActions').hidden = open;
  }

  function hit(el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }

  function start(d) {
    active = true;
    st.mineId = st.mineSp = null;
    inv = d.balls;
    const foe = $('foeImg');
    foe.classList.remove('in-ball', 'hit', 'released');
    foe.src = spriteUrl(d.wild.species_id);
    $('battle').hidden = false;
    setFoe(d.wild);
    setMine(d.mine);
    showPicker(false);
    $('bContinue').hidden = true;
    lock(true);
    const sp = SPECIES[d.wild.species_id];
    msg(`Um ${sp.name} selvagem apareceu!${sp.rarity === 'common' ? '' : ' ✦ ' + rarityOf(d.wild.species_id).label}`);
    setTimeout(() => lock(false), 1300);
  }

  async function update(d) {
    inv = d.balls;
    refreshBalls();
    for (const e of d.log) {
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
      setBar('foeHp', e.wildHp, st.foeMax);
      if (parseFloat($('foeHp').style.width) < prevFoe - 0.1) hit($('foeImg'));
      const prevHp = parseFloat($('myHp').style.width || 100);
      const switched = st.mineId !== e.mine.id;
      if (e.fx === 'evolve') { // silhueta brilhando e troca de sprite
        $('myImg').classList.add('evolving');
        await sleep(1300);
        $('myImg').classList.remove('evolving');
        $('myImg').classList.add('evolved');
      }
      setMine(e.mine, switched);
      if (!switched && e.fx !== 'evolve' && parseFloat($('myHp').style.width) < prevHp - 0.1) hit($('myImg'));
      if (e.fx === 'escape') { $('foeImg').classList.remove('in-ball'); $('foeImg').classList.add('released'); }
      await sleep(e.fx === 'caught' || e.fx === 'evolve' ? 1500 : 1050);
      $('myImg').classList.remove('evolved');
    }
    showPicker(false);
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
    if (d?.drops) toast(`+${d.drops.apricorns} Bolotas${d.drops.shards ? `, +${d.drops.shards} Fragmentos` : ''}`);
  }

  function act(type) {
    if (!active || locked) return;
    if (type === 'ballmenu') return invTotal(inv) > 0 && showPicker(true);
    lock(true);
    showPicker(false);
    socket.emit('battle:action', type);
  }

  function init(s) {
    socket = s;
    socket.on('battle:update', update);
  }

  document.querySelectorAll('#bActions .act').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  document.querySelectorAll('[data-ball]').forEach((b) => b.addEventListener('click', () => act('ball:' + b.dataset.ball)));
  $('ballBack').addEventListener('click', () => showPicker(false));
  $('bContinue').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (!$('bContinue').hidden) { if (e.key === 'Enter' || e.key === ' ') close(); return; }
    if (pickerOpen()) {
      if (e.key === 'Escape' || e.key === 'Backspace') showPicker(false);
      else if (KINDS[e.key - 1]) act('ball:' + KINDS[e.key - 1]);
      return;
    }
    const map = { 1: 'attack', 2: 'strong', 3: 'ballmenu', 4: 'run' };
    if (map[e.key]) act(map[e.key]);
  });

  return { init, start };
})();
