// Chefe de Mundo (luta cooperativa em tempo real): overlay de combate. O servidor guarda a vida do boss e o dano de cada um;
// aqui só desenhamos o estado (a cada 0,5 s) e mandamos as ações (com tempo de recarga por golpe).
const WBoss = (() => {
  let active = false;
  let last = null; // último estado recebido
  const ready = { attack: 0, strong: 0, power: 0, switch: 0 }; // quando cada ação volta a ficar disponível (relógio local)
  const CD = { attack: 1200, strong: 3000, power: 8000, switch: 1500 };
  const now = () => Date.now();
  const socket = () => window.worldScene?.socket;
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const lvl = (pct) => (pct > 50 ? '' : pct > 20 ? 'mid' : 'low');
  const ITEM = { masterballs: 'Master Ball', ultraballs: 'Ultra Ball', apricorns: 'Bolotas', shards: 'Fragmentos' };

  function open(d) {
    active = true;
    inBattle = true;
    last = null;
    Object.keys(ready).forEach((k) => (ready[k] = 0));
    openParty(false); openBag(false); openGroup(false); Arena.open(false); $('settings').classList.remove('open');
    $('wbTitle').textContent = '🐉 ' + d.title + ' · Lv.' + d.level;
    $('wbFoe').src = spriteUrl(d.species_id);
    $('wbEnd').hidden = true;
    $('wbSwitch').hidden = true;
    $('wbActs').hidden = false;
    $('wbLog').textContent = 'Ataque juntos! Quem causar mais dano leva as Master Balls.';
    $('wb').hidden = false;
    Snd.music('boss');
    setTimeout(() => Snd.cry(d.species_id), 300);
  }
  function close() {
    active = false;
    inBattle = false;
    $('wb').hidden = true;
    Snd.music(window.worldMusic());
  }

  function render() {
    const s = last;
    if (!s || !active) return;
    const pct = Math.max(0, (s.hp / s.maxHp) * 100);
    $('wbHp').style.width = pct + '%';
    $('wbHp').dataset.lvl = lvl(pct);
    $('wbHpTxt').textContent = s.hp.toLocaleString('pt-BR') + ' / ' + s.maxHp.toLocaleString('pt-BR') + ' · ' + s.players + ' lutando';
    $('wbClock').textContent = '⏳ ' + mmss(s.left - (now() - s.at));
    $('wbTop').innerHTML = s.top.map((r, i) => '<li' + (r.name === $('hudName').textContent ? ' class="me"' : '') + '><span>' + (i + 1) + '</span><b>' + esc(r.name) + (r.out ? ' 💤' : '') + '</b><em>' + r.dmg.toLocaleString('pt-BR') + '</em></li>').join('');
    const y = s.you, m = y.mine, mp = Math.max(0, (m.hp / m.maxHp) * 100);
    if ($('wbMyImg').dataset.sp !== String(m.species_id)) { $('wbMyImg').dataset.sp = m.species_id; $('wbMyImg').src = backSprite(m.species_id); }
    $('wbMyName').textContent = (m.nickname || SPECIES[m.species_id].name) + ' Lv.' + m.level;
    $('wbMyHp').style.width = mp + '%';
    $('wbMyHp').dataset.lvl = lvl(mp);
    $('wbMyHpTxt').textContent = m.hp + ' / ' + m.maxHp + (y.eliminated ? ' · sem Pokémon em condições de lutar' : '');
    $('wbMyDmg').textContent = y.dmg.toLocaleString('pt-BR');
    $('wbLog').innerHTML = s.log.slice(-3).map(esc).join('<br>') || '';
    document.querySelector('#wbActs [data-act=power]').hidden = !m.pw;
    if ($('wbSwitch').hidden === false) renderSwitch();
  }
  const backSprite = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`;

  // recarga dos botões (roda mais rápido que o estado do servidor)
  function cooldowns() {
    if (!active || !last) return;
    const y = last.you, t = now();
    document.querySelectorAll('#wbActs .act').forEach((b) => {
      const k = b.dataset.act;
      if (k === 'leave') return;
      const wait = Math.max(0, ready[k] - t);
      b.disabled = y.eliminated || wait > 0 || (k === 'switch' && !y.team.some((p) => p.hp > 0 && p.id !== y.mine.id));
      if (!b.dataset.label) b.dataset.label = b.textContent;
      b.textContent = wait > 0 && !y.eliminated ? b.dataset.label + ' · ' + (wait / 1000).toFixed(1) + 's' : b.dataset.label;
    });
  }
  setInterval(cooldowns, 100);

  function renderSwitch() {
    const y = last.you;
    $('wbSwList').innerHTML = y.team.map((p) => {
      const off = p.hp <= 0 || p.id === y.mine.id, pc = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
      return '<button class="sw-item' + (p.id === y.mine.id ? ' active' : '') + '" data-id="' + p.id + '"' + (off ? ' disabled' : '') + '><img src="' + spriteUrl(p.species_id) + '" alt="" /><span class="sw-info"><b>' + esc(p.nickname || SPECIES[p.species_id].name) + '</b><small>Lv. ' + p.level + '</small><i><u style="width:' + pc + '%"></u></i></span><em>' + (p.hp <= 0 ? 'Desmaiou' : p.hp + '/' + p.maxHp) + '</em></button>';
    }).join('');
  }

  function float(text, cls) {
    const el = document.createElement('span');
    el.className = 'wb-float ' + (cls || '');
    el.textContent = text;
    el.style.left = 30 + Math.random() * 40 + '%';
    $('wbFloat').appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
  const pulse = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  function showEnd(e) {
    Snd.sfx(e.result === 'won' ? 'win' : e.result === 'fled' ? 'defeat' : 'click');
    let html;
    if (e.result === 'won') {
      const y = e.you;
      html = '<div class="wb-endic">🏆</div><h3>' + esc(e.title) + ' foi derrotado!</h3>';
      if (y && y.prize) {
        html += '<p>Você ficou em <b>' + y.rank + 'º</b> de ' + y.of + ' · ' + y.dmg.toLocaleString('pt-BR') + ' de dano</p><div class="qz-prize">🎁 ' + esc(Object.entries(y.prize).map(([k, n]) => n + '× ' + (ITEM[k] || k)).join(' · ')) + '</div>';
        if (y.exp) html += '<p>' + esc(y.exp.name) + ' ganhou ' + y.exp.amount + ' EXP' + (y.exp.toLevel ? ' e subiu para o nível ' + y.exp.toLevel : '') + '</p>';
      } else html += '<p>Você não causou dano, então não recebeu prêmio. Da próxima vez, ataque!</p>';
      html += '<ol class="qz-top">' + e.top.slice(0, 8).map((r, i) => '<li' + (r.name === $('hudName').textContent ? ' class="me"' : '') + '><span>' + (i + 1) + '</span><b>' + esc(r.name) + (r.master ? ' 🔮' : '') + '</b><em>' + r.dmg.toLocaleString('pt-BR') + '</em></li>').join('') + '</ol><p class="wb-note">🔮 = ganhou Master Ball</p>';
    } else html = '<div class="wb-endic">' + (e.result === 'fled' ? '💨' : '🚫') + '</div><h3>' + esc(e.title) + (e.result === 'fled' ? ' fugiu…' : ' foi cancelado') + '</h3><p>' + (e.result === 'fled' ? 'O tempo acabou antes de derrotarem o chefe.' : 'Um administrador encerrou o evento.') + '</p>';
    $('wbEnd').innerHTML = html + '<button class="btn primary" id="wbEndOk">Continuar</button>';
    $('wbEnd').hidden = false;
    $('wbActs').hidden = true;
    $('wbSwitch').hidden = true;
    $('wbEndOk').addEventListener('click', close);
  }

  function bindSocket(sock) {
    sock.on('wboss:joined', open);
    sock.on('wboss:state', (s) => { if (!active) return; const prev = last; last = { ...s, at: now() }; Object.keys(ready).forEach((k) => { ready[k] = Math.max(ready[k], now() + s.you.cds[k]); if (s.you.cds[k] === 0 && ready[k] > now() + 60) ready[k] = now(); }); if (prev && s.you.mine.id === prev.you.mine.id && s.you.mine.hp < prev.you.mine.hp) pulse($('wb'), 'hurt'); render(); });
    sock.on('wboss:hit', (h) => { if (!active) return; if (h.miss) return float('Errou!', 'miss'); Snd.sfx(h.eff === 0 ? 'hitImmune' : h.eff > 1 ? 'hitSuper' : h.eff < 1 ? 'hitWeak' : 'hit'); if (h.crit) Snd.sfx('crit'); float('-' + h.dmg.toLocaleString('pt-BR') + (h.crit ? '!' : ''), (h.crit ? 'crit ' : '') + (h.eff > 1 ? 'eff' : h.eff < 1 ? 'weak' : '')); pulse($('wbFoe'), 'hit'); });
    sock.on('wboss:hurt', (h) => { if (!active) return; Snd.sfx('hit'); pulse($('wbMyImg'), 'hit'); });
    sock.on('wboss:left', close);
    sock.on('wboss:end', (e) => { if (active) showEnd(e); });
  }
  const wait = setInterval(() => { const s = socket(); if (!s) return; clearInterval(wait); bindSocket(s); }, 300);

  $('wbActs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !last) return;
    const k = b.dataset.act;
    if (k === 'leave') { if (confirm('Sair da luta? Você perde a recompensa dessa rodada.')) socket()?.emit('wboss:leave'); return; }
    if (k === 'switch') { $('wbSwitch').hidden = false; $('wbActs').hidden = true; renderSwitch(); return; }
    if (ready[k] > now()) return;
    ready[k] = now() + CD[k];
    socket()?.emit('wboss:act', k);
    cooldowns();
  });
  $('wbSwList').addEventListener('click', (e) => {
    const b = e.target.closest('.sw-item');
    if (!b || b.disabled) return;
    ready.switch = now() + CD.switch;
    socket()?.emit('wboss:act', 'switch:' + b.dataset.id);
    $('wbSwitch').hidden = true; $('wbActs').hidden = false;
  });
  $('wbSwBack').addEventListener('click', () => { $('wbSwitch').hidden = true; $('wbActs').hidden = false; });
  return { isOpen: () => active };
})();
