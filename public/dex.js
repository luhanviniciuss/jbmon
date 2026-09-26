// Pokédex: "Vistos" (encontrados, ainda não capturados: silhueta e nome cinza) e "Capturados" (sprite colorido, tipos,
// descrição, status e evolução). Os dados vêm de GET /api/pokedex; o servidor registra tudo sozinho.
const Dex = (() => {
  let data = null; // { entries:[{species_id, caught}], best:{id: maiorNivel}, total }
  let tab = 'caught';
  let query = '';

  const FLAVOR = {
    normal: 'Um Pokémon comum, mas cheio de energia.', fire: 'Domina as chamas e adora lugares quentes.', water: 'Vive perto da água e nada com facilidade.',
    grass: 'Absorve a luz do sol e cresce onde há verde.', electric: 'Acumula eletricidade no corpo e solta faíscas quando se irrita.', ice: 'Suporta o frio extremo e congela o ambiente ao redor.',
    fighting: 'Treina o corpo o tempo todo e adora um bom desafio.', poison: 'Solta toxinas perigosas para se defender.', ground: 'Cava túneis e vive perto da terra.',
    flying: 'Voa alto e enxerga tudo lá de cima.', psychic: 'Tem poderes mentais fora do comum.', bug: 'Pequeno, mas incrivelmente esperto.',
    rock: 'Duro como pedra, quase impossível de derrubar.', ghost: 'Aparece do nada e some no ar.', dragon: 'Uma criatura rara e poderosa, envolta em lendas.',
    dark: 'Age nas sombras e é muito esperto.', steel: 'O corpo de metal resiste a quase tudo.',
  };
  const RAR_TXT = { common: 'É muito comum de se encontrar.', uncommon: 'Aparece com alguma frequência.', rare: 'É raro: nem todo treinador chega a vê-lo.', epic: 'É épico: poucos treinadores capturam um.', legendary: 'É uma lenda: só aparece como boss, e todo lendário tem um Poder Lendário.' };
  const HOUSE = (t) => t.map((x) => TYPES[x].label).join(' / ');

  function habitat(id) {
    const ins = (t) => t.some(([i]) => i === id);
    const out = [];
    if (ins(WILD_TABLE)) out.push('🌿 Grama alta da Rota 1');
    if (ins(WATER_TABLE)) out.push('💧 Lagos da Rota 1');
    if (ins(WORLD_TABLES.ice.land) || ins(WORLD_TABLES.ice.water)) out.push('❄ Bioma de Gelo');
    if (ins(WORLD_TABLES.lava.land)) out.push('🌋 Vulcão');
    if (ins(BOSS_TABLE)) out.push('👑 Boss lendário (raid a cada 3 h)');
    if (!out.length) {
      const pre = Object.keys(EVOLUTIONS).find((k) => { const t = EVOLUTIONS[k][1]; return Array.isArray(t) ? t.includes(id) : t === Number(id); });
      out.push(pre ? '🧬 Só aparece evoluindo ' + speciesName(Number(pre)) : '—');
    }
    return out;
  }

  function evoText(id) {
    const e = EVOLUTIONS[id];
    const pre = Object.keys(EVOLUTIONS).find((k) => { const t = EVOLUTIONS[k][1]; return Array.isArray(t) ? t.includes(id) : t === Number(id); });
    const parts = [];
    if (pre) parts.push('Evolui de <b>' + esc(speciesName(Number(pre))) + '</b> (Lv. ' + EVOLUTIONS[pre][0] + ')');
    if (e) parts.push('Evolui para <b>' + (Array.isArray(e[1]) ? e[1].map((x) => esc(speciesName(x))).join(' ou ') : esc(speciesName(e[1]))) + '</b> no Lv. ' + e[0]);
    return parts.length ? parts.join('<br>') : 'Não evolui.';
  }

  const num = (id) => '#' + String(id).padStart(3, '0');
  const isOpen = () => $('dex').classList.contains('open');

  function open(on = !isOpen()) {
    $('dex').classList.toggle('open', on);
    $('dex').setAttribute('aria-hidden', !on);
    if (!on) return;
    ['drawer', 'bag', 'group', 'arena', 'settings', 'story', 'admin'].forEach((id) => $(id)?.classList.remove('open'));
    $('dexDetail').hidden = true;
    render(true);
  }

  async function load() {
    const r = await fetch('/api/pokedex', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Erro ao carregar a Pokédex');
    data = await r.json();
  }

  async function render(reload = false) {
    const body = $('dexBody');
    if (reload || !data) {
      body.innerHTML = '<p class="empty">Carregando…</p>';
      try { await load(); } catch (e) { body.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; return; }
    }
    const caught = data.entries.filter((e) => e.caught).map((e) => e.species_id);
    const seenOnly = data.entries.filter((e) => !e.caught).map((e) => e.species_id);
    const seenTotal = caught.length + seenOnly.length;
    const ids = (tab === 'caught' ? caught : seenOnly).filter((id) => !query || speciesName(id).toLowerCase().includes(query)).sort((a, b) => a - b);
    const pct = Math.round((caught.length / data.total) * 100);
    body.innerHTML =
      '<div class="dexstat"><div><b>' + seenTotal + '</b><span>Vistos</span></div><div><b>' + caught.length + '</b><span>Capturados</span></div><div><b>' + data.total + '</b><span>Total</span></div></div>' +
      '<div class="dexbar" title="' + pct + '% completo"><i style="width:' + pct + '%"></i></div>' +
      '<nav class="atabs dextabs"><button data-t="caught" class="' + (tab === 'caught' ? 'active' : '') + '">Capturados (' + caught.length + ')</button><button data-t="seen" class="' + (tab === 'seen' ? 'active' : '') + '">Vistos (' + seenOnly.length + ')</button></nav>' +
      '<input id="dexSearch" class="dexsearch" placeholder="Buscar por nome…" value="' + esc(query) + '" autocomplete="off" />' +
      (ids.length
        ? '<div class="dexgrid">' + ids.map((id) => '<button class="dexcard ' + (tab === 'caught' ? 'caught' : 'seen') + '" data-id="' + id + '"><img loading="lazy" src="' + spriteUrl(id) + '" alt="" /><small>' + num(id) + '</small><b>' + esc(speciesName(id)) + '</b></button>').join('') + '</div>'
        : '<p class="empty">' + (query ? 'Nenhum resultado.' : tab === 'caught' ? 'Você ainda não capturou nenhum Pokémon registrado. Vá caçar!' : 'Nada por aqui: todo Pokémon que você viu já foi capturado, ou ainda não viu nenhum novo.') + '</p>') +
      '<p class="hintline">Todo Pokémon que você <b>encontra</b> em batalha vira "visto"; ao <b>capturar</b> (ou evoluir/ganhar) ele vira "capturado" e revela os detalhes.</p>';
    body.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
    body.querySelectorAll('.dexcard').forEach((b) => b.addEventListener('click', () => detail(Number(b.dataset.id))));
    const s = $('dexSearch');
    s.addEventListener('input', () => { query = s.value.trim().toLowerCase(); const pos = s.selectionStart; render().then(() => { const n = $('dexSearch'); n.focus(); n.setSelectionRange(pos, pos); }); });
  }

  function detail(id) {
    const sp = SPECIES[id];
    const caught = data.entries.find((e) => e.species_id === id)?.caught;
    const box = $('dexDetail');
    box.hidden = false;
    if (!caught) {
      box.innerHTML = '<button class="btn small ghost" id="dexBack">← Voltar</button><div class="dexhero seen"><img src="' + spriteUrl(id) + '" alt="" /></div><h3 class="graytxt">' + esc(sp.name) + ' <small>' + num(id) + '</small></h3><p class="hintline">Você já viu este Pokémon, mas ainda não o capturou. <b>Capture-o</b> para revelar tipos, descrição e status.</p><div class="dexinfo"><b>Onde encontrar</b><br>' + habitat(id).map(esc).join('<br>') + '</div>';
    } else {
      const rar = RARITY[sp.rarity];
      const best = data.best[id];
      const bar = (label, v, max) => '<div class="stat"><span>' + label + '</span><div class="bar"><i style="width:' + Math.min(100, (v / max) * 100) + '%"></i></div><b>' + v + '</b></div>';
      box.innerHTML =
        '<button class="btn small ghost" id="dexBack">← Voltar</button>' +
        '<div class="dexhero" style="--rc:' + rar.color + '"><img src="' + spriteUrl(id) + '" alt="" /></div>' +
        '<h3>' + esc(sp.name) + ' <small>' + num(id) + '</small></h3>' +
        '<div class="dexchips">' + typeChips(id) + '<span class="rar" style="--rc:' + rar.color + '">' + rar.label + '</span></div>' +
        '<p class="dexdesc">' + esc(FLAVOR[sp.types[0]]) + ' Pokémon do tipo ' + esc(HOUSE(sp.types)) + '. ' + esc(RAR_TXT[sp.rarity]) + '</p>' +
        '<div class="dexinfo"><b>Status base</b>' + bar('HP', sp.hp, 160) + bar('Ataque', sp.atk, 160) + bar('Defesa', sp.def, 200) + '<small>Facilidade de captura: ' + Math.round(sp.catch * 100) + '%' + (best ? ' · Seu maior nível: <b>Lv. ' + best + '</b>' : '') + '</small></div>' +
        '<div class="dexinfo"><b>Evolução</b><br>' + evoText(id) + '</div>' +
        '<div class="dexinfo"><b>Onde encontrar</b><br>' + habitat(id).map(esc).join('<br>') + '</div>';
    }
    $('dexBack').addEventListener('click', () => { box.hidden = true; });
  }

  function init(socket) {
    socket.on('dex:new', ({ species_id, kind }) => {
      if (data) { const e = data.entries.find((x) => x.species_id === species_id); if (e) e.caught = e.caught || kind === 'caught'; else data.entries.push({ species_id, seen: true, caught: kind === 'caught' }); }
      toast((kind === 'caught' ? '📖 Pokédex: capturado — ' : '📖 Pokédex: visto — ') + speciesName(species_id));
      if (isOpen()) render();
    });
  }

  $('dexBtn').addEventListener('click', () => open());
  $('closeDex').addEventListener('click', () => open(false));
  window.addEventListener('keydown', (e) => {
    if (isTyping() || !token || inBattle) return;
    if (e.key.toLowerCase() === 'o') open();
    if (e.key === 'Escape' && isOpen()) open(false);
  });
  ['drawer', 'bag', 'group', 'arena', 'settings', 'admin'].forEach((id) => { const el = $(id); if (el) new MutationObserver(() => { if (el.classList.contains('open')) $('dex').classList.remove('open'); }).observe(el, { attributes: true, attributeFilter: ['class'] }); });

  return { init, open };
})();
