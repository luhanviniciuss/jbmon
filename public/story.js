// Modo História (cliente): Diário de Missões, marcador da missão atual (com bússola), diálogo com o Professor Carvalho,
// dicas para quem chega (podem ser puladas e revistas) e o aviso de capítulo concluído.
// O servidor guarda o progresso e decide tudo; aqui só mostramos o estado e enviamos pedidos.
let STORY_STATE = null; // { chapter, step, count, tips }

const Story = (() => {
  let socket = null;
  let dlg = null; // { mode: 'prof' | 'modal', lines, i, choices }
  let tipsIdx = 0;
  let tipsReplay = false;
  let tipsShownOnce = false;

  const chapterDef = () => (STORY_STATE ? STORY[STORY_STATE.chapter - 1] || null : null);
  const stepDef = () => chapterDef()?.steps[STORY_STATE.step] || null;
  const finished = () => !!STORY_STATE && STORY_STATE.chapter > STORY.length;
  const REWARD_NAMES = { pokeballs: 'Pokébolas', greatballs: 'Great Balls', apricorns: 'Bolotas', shards: 'Fragmentos' };
  const rewardText = (r) => Object.entries(r || {}).map(([k, n]) => n + ' ' + REWARD_NAMES[k]).join(', ');
  const isOpen = () => $('story').classList.contains('open');

  // Destino da missão atual para a bússola: no mesmo mundo, o ponto da missão; em outro mundo, o caminho até lá
  // (Rota -> porta do ginásio; mundos extras -> portal de volta)
  function targetOf(step) {
    if (!step) return null;
    let t = step.target || null;
    if (!t && (step.kind === 'world' || step.kind === 'defeat') && WORLD_ID !== step.world) t = { world: step.world };
    if (!t) return null;
    if (t.world === WORLD_ID && t.tx != null) return t;
    if (t.world === WORLD_ID) return null;
    if (WORLD_ID === 'route') return { world: 'route', tx: GYM.doorX, ty: GYM.doorY, via: 'Ginásio' };
    return { world: WORLD_ID, tx: PORTAL.tx, ty: PORTAL.ty, via: 'Portal' };
  }
  const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  function compass(step) {
    const t = targetOf(step);
    const p = window.worldScene?.player;
    if (!t || !p) return '';
    const dx = (t.tx + 0.5) * TILE - p.x, dy = (t.ty + 0.5) * TILE - p.y, tiles = Math.round(Math.hypot(dx, dy) / TILE);
    const via = t.via ? ' · ' + t.via : '';
    if (tiles <= 2) return ' 📍' + via;
    const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    return ' ' + ARROWS[Math.round(ang / (Math.PI / 4)) % 8] + ' ' + tiles + via;
  }

  // ---------------------------------------------------------------- marcador no HUD
  function updateChip() {
    const c = $('questChip');
    if (!STORY_STATE) { c.hidden = true; return; }
    c.hidden = false;
    const step = stepDef();
    if (!step) { c.textContent = '📜 Diário'; return; }
    const prog = step.need > 1 ? ' (' + STORY_STATE.count + '/' + step.need + ')' : '';
    c.textContent = '📜 ' + step.text + prog + compass(step);
    c.title = 'Cap. ' + STORY_STATE.chapter + ' · ' + chapterDef().title;
  }
  setInterval(updateChip, 700);

  // ---------------------------------------------------------------- Diário
  function renderDiary() {
    if (!isOpen() || !STORY_STATE) return;
    const st = STORY_STATE, cur = chapterDef(), step = stepDef();
    const chapters = STORY.map((ch, i) => {
      const n = i + 1, done = st.chapter > n, now = st.chapter === n;
      const gate = Object.entries(GATES).find(([, g]) => g.chapters === n - 1 && n > 1);
      return '<div class="item chap ' + (done ? 'done' : now ? 'now' : 'lock') + '"><span class="chi">' + (done ? '✔' : now ? '▶' : '🔒') + '</span><div><b>Cap. ' + n + ' · ' + esc(ch.title) + '</b><small>' + (done ? 'Concluído' : now ? 'Em andamento' : 'Conclua o capítulo anterior' + (gate ? ' para liberar ' + esc(WORLDS[gate[0]].name) : '')) + '</small></div><em>' + ch.icon + '</em></div>';
    }).join('');
    let now = '';
    if (cur) {
      now = '<div class="section-title">Capítulo ' + cur.id + ' · ' + esc(cur.title) + '</div><p class="hintline">' + esc(cur.brief) + '</p>' +
        cur.steps.map((s, i) => {
          const done = i < st.step, active = i === st.step;
          const prog = active && s.need > 1 ? '<div class="sbar"><i style="width:' + Math.min(100, (st.count / s.need) * 100) + '%"></i></div><small>' + st.count + ' / ' + s.need + '</small>' : '';
          return '<div class="stepq ' + (done ? 'done' : active ? 'active' : '') + '"><span>' + (done ? '✔' : active ? '▶' : '○') + '</span><div><b>' + esc(s.text) + '</b>' + (active ? '<small>' + esc(s.hint) + '</small>' + prog + '<small class="cmp">' + esc(compass(s).trim()) + '</small>' : '') + '</div></div>';
        }).join('') +
        '<div class="rewardq">🎁 Recompensa do capítulo: <b>' + esc(rewardText(cur.reward)) + '</b></div>';
    } else {
      now = '<div class="section-title">Campanha</div><div class="rewardq">🏆 Você concluiu todos os capítulos disponíveis! Novos capítulos em breve.</div>';
    }
    $('storyBody').innerHTML = now + '<div class="section-title">Capítulos</div>' + chapters +
      '<div class="section-title">Ajuda</div><button class="btn small" id="stTips">📘 Rever as dicas do jogo</button><p class="hintline">O Professor Carvalho fica na casa da esquerda da <b>Cidade</b>. Chegue lá pelo Ginásio (leste do Centro Pokémon, na Rota).</p>';
    $('stTips').addEventListener('click', () => { open(false); showTips(true); });
  }
  function open(on = !isOpen()) {
    $('story').classList.toggle('open', on);
    $('story').setAttribute('aria-hidden', !on);
    if (!on) return;
    ['drawer', 'bag', 'group', 'arena', 'settings', 'dex', 'admin'].forEach((id) => $(id)?.classList.remove('open'));
    renderDiary();
  }

  // ---------------------------------------------------------------- diálogo (Professor e avisos)
  function showDlg(d) {
    dlg = { ...d, i: 0 };
    $('dialog').hidden = false;
    drawDlg();
  }
  function closeDlg() { dlg = null; $('dialog').hidden = true; }
  function drawDlg() {
    if (!dlg) return;
    $('dlgFace').textContent = dlg.face || '🧑‍🔬';
    $('dlgName').textContent = dlg.name || 'Professor Carvalho';
    $('dlgText').textContent = dlg.lines[dlg.i];
    const last = dlg.i >= dlg.lines.length - 1;
    const box = $('dlgChoices');
    if (!last) { box.innerHTML = '<button class="btn small" id="dlgNext">Próximo ▶</button>'; $('dlgNext').addEventListener('click', () => { dlg.i++; drawDlg(); }); return; }
    box.innerHTML = dlg.choices.map((c, k) => '<button class="btn small ' + (c.cls || '') + '" data-k="' + k + '">' + (c.img ? '<img src="' + spriteUrl(c.img) + '" alt="" />' : '') + esc(c.label) + '</button>').join('');
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => act(dlg.choices[Number(b.dataset.k)].act)));
  }

  // O que o Professor diz, conforme o progresso
  function profScript() {
    const st = STORY_STATE, step = stepDef(), cur = chapterDef();
    const common = [{ label: '📘 Ver dicas', act: 'tips', cls: 'ghost' }, { label: '📜 Abrir diário', act: 'diary', cls: 'ghost' }, { label: 'Até logo', act: 'close', cls: 'ghost' }];
    if (!st) return { lines: ['…'], choices: common };
    if (step?.kind === 'talk') return {
      lines: ['Ora, ora! Então você é o novo treinador! Eu sou o Professor Carvalho.', 'O mundo de JBMon é enorme: rotas de grama alta, cidades, o gelo eterno e um vulcão cheio de perigos.', 'Vou guiar sua jornada. Cada capítulo tem missões e recompensas. Vamos começar?'],
      choices: [{ label: 'Vamos! ▶', act: 'talk' }, { label: '📘 Ver dicas', act: 'tips', cls: 'ghost' }],
    };
    if (step?.kind === 'starter') return {
      lines: ['Todo treinador precisa de um companheiro de confiança.', 'Escolha o seu Pokémon inicial. Ele será seu parceiro nas primeiras batalhas!'],
      choices: STARTERS.map((id) => ({ label: speciesName(id), img: id, act: 'starter:' + id })),
    };
    if (step) return { lines: [cur.brief, 'Sua missão agora: ' + step.text + '. ' + step.hint], choices: common };
    return { lines: ['Você concluiu todos os capítulos disponíveis. Estou muito orgulhoso!', 'Novas aventuras chegarão em breve. Enquanto isso, continue treinando e capturando!'], choices: common };
  }
  function talk() { showDlg({ mode: 'prof', ...profScript() }); }

  function act(a) {
    if (a === 'close') return closeDlg();
    if (a === 'tips') { closeDlg(); return showTips(true); }
    if (a === 'diary') { closeDlg(); return open(true); }
    if (a === 'talk') { socket.emit('story:talk'); return closeDlg(); } // o estado novo reabre o diálogo com a próxima etapa
    if (a.startsWith('starter:')) { socket.emit('story:starter', Number(a.slice(8))); return closeDlg(); }
    if (a === 'ok') return closeDlg();
  }

  // ---------------------------------------------------------------- dicas
  function drawTips() {
    const t = TIPS[tipsIdx];
    $('tipsIcon').textContent = t.icon;
    $('tipsTitle').textContent = t.title;
    $('tipsText').textContent = t.text;
    $('tipsCount').textContent = (tipsIdx + 1) + ' / ' + TIPS.length;
    $('tipsDots').innerHTML = TIPS.map((_, i) => '<i class="' + (i === tipsIdx ? 'on' : '') + '"></i>').join('');
    $('tipsPrev').disabled = tipsIdx === 0;
    $('tipsNext').textContent = tipsIdx === TIPS.length - 1 ? 'Concluir ✔' : 'Próxima ▶';
  }
  function showTips(replay = false) {
    tipsReplay = replay;
    tipsIdx = 0;
    $('tips').hidden = false;
    drawTips();
  }
  function endTips(mode) {
    $('tips').hidden = true;
    if (!tipsReplay || STORY_STATE?.tips === 0) socket.emit('story:tips', mode); // 1ª vez: grava "vistas" ou "puladas"
    if (mode === 'skip') toast('Dicas puladas. Você pode revê-las no Diário ou em ⚙.');
  }
  $('tipsPrev').addEventListener('click', () => { if (tipsIdx > 0) { tipsIdx--; drawTips(); } });
  $('tipsNext').addEventListener('click', () => { if (tipsIdx >= TIPS.length - 1) endTips('done'); else { tipsIdx++; drawTips(); } });
  $('tipsSkip').addEventListener('click', () => endTips('skip'));

  // ---------------------------------------------------------------- eventos do servidor
  function onState(st) {
    const prev = STORY_STATE;
    STORY_STATE = st;
    updateChip();
    renderDiary();
    // Dicas na primeira vez que o jogador chega (só se ainda não viu nem pulou)
    if (st.tips === 0 && !tipsShownOnce) {
      tipsShownOnce = true;
      setTimeout(() => { if (!inBattle && $('tips').hidden) showTips(false); }, 1600);
    }
    // Se o diálogo com o Professor está aberto (ou acabou de agir), mostra a etapa nova
    if (prev && (prev.chapter !== st.chapter || prev.step !== st.step) && window.worldScene?.interior === 'Prof' && !dlg) talk();
  }
  function onComplete({ chapter, title, reward, last }) {
    const nxt = STORY[chapter]; // capítulo seguinte (índice = número do concluído)
    const gate = Object.entries(GATES).find(([, g]) => g.chapters === chapter);
    showDlg({
      mode: 'modal', face: '🏆', name: 'Capítulo concluído!',
      lines: ['🎉 Capítulo ' + chapter + ' · ' + title + ' concluído!', '🎁 Recompensa: ' + rewardText(reward) + '.', last ? 'Você terminou todos os capítulos disponíveis. Novos virão em breve!' : (gate ? '🔓 ' + WORLDS[gate[0]].name + ' liberado no Ginásio! ' : '') + 'Próximo: Capítulo ' + nxt.id + ' · ' + nxt.title + '.'],
      choices: [{ label: 'Continuar', act: 'ok' }],
    });
  }

  function init(s) {
    socket = s;
    s.on('story:state', onState);
    s.on('story:complete', onComplete);
  }

  $('questChip').addEventListener('click', () => open());
  $('closeStory').addEventListener('click', () => open(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (isOpen()) open(false); else if (!$('tips').hidden) endTips('skip'); } });
  ['drawer', 'bag', 'group', 'arena', 'settings', 'admin'].forEach((id) => { const el = $(id); if (el) new MutationObserver(() => { if (el.classList.contains('open')) $('story').classList.remove('open'); }).observe(el, { attributes: true, attributeFilter: ['class'] }); });

  return { init, talk, showTips, open, state: () => STORY_STATE };
})();
