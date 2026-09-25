const $ = (id) => document.getElementById(id);
let token = null;
let mode = 'login';
let inBattle = false;
let MY_ID = null;
let GROUP = null; // { id, leader, members:[{id, username}] }
let BOSS = null; // { species_id, x, y, until }
let BOSS_NEXT = null; // timestamp local do próximo boss
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeChips = (id) => SPECIES[id].types.map((t) => '<span class="tchip" style="--tc:' + TYPES[t].color + '">' + TYPES[t].label + '</span>').join('');
let INV = { poke: 0, great: 0, ultra: 0, master: 0 };
const invTotal = (i) => Object.values(i).reduce((a, b) => a + b, 0);
const rarityOf = (id) => RARITY[SPECIES[id]?.rarity] || RARITY.common;
const setBalls = (inv) => {
  INV = typeof inv === 'number' ? { ...INV, poke: inv } : inv;
  $('balls').textContent = invTotal(INV);
  $('balls').parentElement.title = Object.entries(INV).map(([k, n]) => BALLS[k].name + ': ' + n).join(' · ');
};

const speciesName = (id) => SPECIES[id]?.name || `#${id}`;
const spriteUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

// ---------- Utilidades de UI ----------
function toast(msg, big) {
  const el = document.createElement('div');
  el.className = 'toast' + (big ? ' big' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), big ? 6300 : 3300);
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  mode = t.dataset.mode;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelector('.tabs').dataset.mode = mode;
  $('submitBtn').textContent = mode === 'login' ? 'Entrar no mundo' : 'Criar e jogar';
  $('pass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('err').textContent = '';
}));

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('err').textContent = '';
  $('submitBtn').disabled = true;
  try {
    const res = await fetch(`/api/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('user').value.trim(), password: $('pass').value }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Erro');
    token = body.token;
    $('hudName').textContent = body.username;
    $('avatar').textContent = body.username[0];
    $('login').hidden = true;
    $('hud').hidden = false;
    initChat();
    startGame();
  } catch (err) {
    $('err').textContent = err.message === 'Failed to fetch' ? 'Servidor indisponível' : err.message;
  } finally {
    $('submitBtn').disabled = false;
  }
});

// ---------- Party ----------
const statRow = (cls, label, val, max, txt = val) =>
  `<div class="stat ${cls}"><span>${label}</span><div class="bar"><i style="--w:${Math.min(100, (val / max) * 100)}%"></i></div><b>${txt}</b></div>`;

const monCard = (p, i) => `<div class="mon${p.current_hp <= 0 ? ' fainted' : ''}" style="animation-delay:${i * 60}ms;--rc:${rarityOf(p.species_id).color}">
  <div class="art"><img src="${spriteUrl(p.species_id)}" alt="" onerror="this.style.opacity=.2" /></div>
  <div><div class="top"><span class="name">${p.nickname || speciesName(p.species_id)}</span><span class="lv">Lv. ${p.level}</span></div>
  <div class="tags"><span class="rar" style="--rc:${rarityOf(p.species_id).color}">${rarityOf(p.species_id).label}</span>${typeChips(p.species_id)}</div>
  ${statRow('hp', 'HP', p.current_hp, p.hp, p.current_hp + '/' + p.hp)}${statRow('atk', 'ATK', p.attack, 60)}${statRow('def', 'DEF', p.defense, 60)}${statRow('xp', 'EXP', p.current_exp, expToNext(p.level), p.current_exp + '/' + expToNext(p.level))}</div></div>`;

// ---------- Equipe (até 6) e Box ----------
let PARTY = { party: [], box: [] };
let swapId = null; // Pokémon do box escolhido para entrar quando a equipe está cheia

async function saveTeam(ids) {
  try {
    const r = await fetch('/api/party/set', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ team: ids }) });
    const body = await r.json();
    if (!r.ok) return toast(body.error || 'Não foi possível mudar a equipe');
    PARTY = body;
  } catch { toast('Erro de conexão'); }
  swapId = null;
  renderParty();
}

function renderParty() {
  const { party, box } = PARTY;
  const ids = party.map((p) => p.id);
  const withControls = (p, i, controls, slot) => monCard(p, i).replace(/<\/div>$/, (slot ? '<span class="slotnum">#' + slot + '</span>' : '') + '<div class="mon-actions">' + controls + '</div></div>');
  const btn = (act, id, label, cls = '', dis = false) => '<button data-act="' + act + '" data-id="' + id + '" class="' + cls + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>';
  const teamHtml = party.map((p, i) => withControls(p, i,
    swapId ? btn('replace', p.id, 'Substituir este', 'warn')
      : btn('up', p.id, '▲', '', i === 0) + btn('down', p.id, '▼', '', i === party.length - 1) + btn('box', p.id, 'Enviar ao box', '', party.length <= 1),
    i + 1)).join('');
  const boxHtml = box.map((p, i) => withControls(p, i, btn('add', p.id, party.length < 6 ? 'Colocar na equipe' : 'Trocar com alguém…', 'primary', swapId === p.id))).join('');
  $('partyList').innerHTML =
    '<p class="party-hint">O 1º Pokémon da equipe entra primeiro em batalha. Use ▲▼ para reordenar. Só mudam fora de batalha.</p>' +
    (swapId ? '<div class="swap-banner"><span>Escolha quem sai da equipe</span><button class="btn small ghost" id="swapCancel">Cancelar</button></div>' : '') +
    '<div class="section-title">Equipe · ' + party.length + '/6</div>' + (teamHtml || '<p class="empty">Equipe vazia.</p>') +
    '<div class="section-title">Box · ' + box.length + '</div>' + (boxHtml || '<p class="empty">Nenhum Pokémon no box (os capturados com a equipe cheia vêm para cá).</p>');
  $('partyList').querySelectorAll('.mon-actions button').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.id), i = ids.indexOf(id);
    if (b.dataset.act === 'up' && i > 0) { const a = ids.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; saveTeam(a); }
    else if (b.dataset.act === 'down' && i < ids.length - 1) { const a = ids.slice(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; saveTeam(a); }
    else if (b.dataset.act === 'box') saveTeam(ids.filter((x) => x !== id));
    else if (b.dataset.act === 'add') { if (ids.length < 6) saveTeam([...ids, id]); else { swapId = id; renderParty(); } }
    else if (b.dataset.act === 'replace') saveTeam(ids.map((x) => (x === id ? swapId : x)));
  }));
  $('swapCancel')?.addEventListener('click', () => { swapId = null; renderParty(); });
  requestAnimationFrame(() => $('partyList').querySelectorAll('.bar i').forEach((i) => (i.style.width = i.style.getPropertyValue('--w'))));
}

async function openParty(open = !$('drawer').classList.contains('open')) {
  if (open) { $('bag').classList.remove('open'); $('group').classList.remove('open'); }
  const drawer = $('drawer');
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', !open);
  if (!open) return;
  $('partyList').innerHTML = '<p class="empty">Carregando…</p>';
  try {
    const res = await fetch('/api/party', { headers: { Authorization: `Bearer ${token}` } });
    const { party, box, balls } = await res.json();
    setBalls(balls);
    PARTY = { party, box };
    swapId = null;
    renderParty();
  } catch {
    $('partyList').innerHTML = '<p class="empty">Erro ao carregar a party.</p>';
  }
}
$('partyBtn').addEventListener('click', () => openParty());

// ---------- Bolsa e craft ----------
async function renderBag() {
  const res = await fetch('/api/inventory', { headers: { Authorization: 'Bearer ' + token } });
  const { balls, mats } = await res.json();
  setBalls(balls);
  const ballIcon = (k) => '<span class="ball sm t-' + k + '"></span>';
  const chip = (n, label, ok) => '<span class="cost' + (ok ? '' : ' short') + '">' + n + ' ' + label + '</span>';
  const matsHtml = Object.entries(MATERIALS).map(([k, m]) => '<div class="mat" title="' + m.hint + '"><b>' + mats[k] + '</b><span>' + m.name + '</span></div>').join('');
  const ballsHtml = Object.entries(BALLS).map(([k, b]) =>
    '<div class="item">' + ballIcon(k) + '<div><b>' + b.name + '</b><small>' + (b.guaranteed ? 'captura garantida' : 'captura ×' + b.mult) + '</small></div>' +
    '<span class="rar" style="--rc:' + RARITY[b.rarity].color + '">' + RARITY[b.rarity].label + '</span><em>' + balls[k] + '</em></div>').join('');
  const recipesHtml = RECIPES.map((r) => {
    const can = Object.entries(r.cost).every(([k, n]) => mats[k] >= n);
    const gives = Object.entries(r.gives).map(([k, n]) => n + '× ' + BALLS[k].name).join(', ');
    const cost = Object.entries(r.cost).map(([k, n]) => chip(n, MATERIALS[k].name, mats[k] >= n)).join('');
    return '<div class="recipe"><div>' + ballIcon(Object.keys(r.gives)[0]) + '<b>' + gives + '</b><div class="costs">' + cost + '</div></div>' +
      '<button class="btn small" data-craft="' + r.id + '"' + (can ? '' : ' disabled') + '>Criar</button></div>';
  }).join('');
  $('bagBody').innerHTML = '<div class="section-title">Materiais</div><div class="mats">' + matsHtml + '</div>' +
    '<div class="section-title">Pokébolas</div>' + ballsHtml +
    '<div class="section-title">Criar (craft)</div>' + recipesHtml +
    '<p class="hintline">Derrote ou capture Pokémon selvagens para coletar materiais. Quanto mais raro o Pokémon, mais Fragmentos.</p>';
  $('bagBody').querySelectorAll('[data-craft]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await fetch('/api/craft', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ recipe: b.dataset.craft }) });
    const body = await r.json();
    toast(r.ok ? 'Item criado!' : body.error || 'Erro ao criar');
    renderBag();
  }));
}
async function openBag(open = !$('bag').classList.contains('open')) {
  const el = $('bag');
  el.classList.toggle('open', open);
  el.setAttribute('aria-hidden', !open);
  if (!open) return;
  $('drawer').classList.remove('open');
  $('group').classList.remove('open');
  $('bagBody').innerHTML = '<p class="empty">Carregando…</p>';
  try { await renderBag(); } catch { $('bagBody').innerHTML = '<p class="empty">Erro ao carregar a bolsa.</p>'; }
}
$('bagBtn').addEventListener('click', () => openBag());

// ---------- Grupo ----------
function setGroupLabel() {
  $('groupBtn').querySelector('.lbl').textContent = GROUP ? 'Grupo ' + GROUP.members.length + '/4' : 'Grupo';
  const tab = document.querySelector('.ctab[data-ch=group]');
  if (tab) { tab.hidden = !GROUP; if (!GROUP && chat.tab === 'group') setChatTab('global'); }
}

function renderGroup() {
  const leader = !GROUP || GROUP.leader === MY_ID;
  const members = GROUP
    ? GROUP.members.map((m) => '<div class="item gm"><span class="avatar sm">' + esc(m.username[0]) + '</span><div><b>' + esc(m.username) + (m.id === GROUP.leader ? ' 👑' : '') + (m.id === MY_ID ? ' (você)' : '') + '</b></div></div>').join('')
    : '<p class="empty">Você não está em um grupo.</p>';
  $('groupBody').innerHTML =
    '<div class="section-title">Seu grupo' + (GROUP ? ' (' + GROUP.members.length + '/4)' : '') + '</div>' + members +
    (GROUP ? '<button class="btn small danger" id="leaveGroup">Sair do grupo</button>' : '') +
    (leader ? '<div class="section-title">Convidar jogador</div><div class="invite-form"><input id="invName" placeholder="Nome do jogador" maxlength="16" /><button class="btn small" id="invSend">Convidar</button></div>' +
      '<div class="section-title">Online agora</div><div id="onlineList" class="chips"><span class="hintline">Carregando…</span></div>' : '') +
    '<p class="hintline">Lendários aparecem a cada 3 horas e são todos Lv.100: treine bastante antes. Para enfrentá-los, formem um grupo de 2 a 4 jogadores e encostem no boss juntos. Cada membro age na sua vez; depois que ele ficar exausto, cada um tem uma rodada para lançar uma Pokébola.</p>';
  $('leaveGroup')?.addEventListener('click', () => window.worldScene?.socket.emit('group:leave'));
  const send = (name) => name && window.worldScene?.socket.emit('group:invite', name);
  $('invSend')?.addEventListener('click', () => { send($('invName').value.trim()); $('invName').value = ''; });
  $('invName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('invSend').click(); });
  if (leader) window.worldScene?.socket.emit('online:list');
  window.__sendInvite = send;
  setGroupLabel();
}
function openGroup(open = !$('group').classList.contains('open')) {
  $('group').classList.toggle('open', open);
  $('group').setAttribute('aria-hidden', !open);
  if (!open) return;
  $('drawer').classList.remove('open');
  $('bag').classList.remove('open');
  renderGroup();
}
$('groupBtn').addEventListener('click', () => openGroup());
$('closeGroup').addEventListener('click', () => openGroup(false));
let inviteTimer = null;
$('invYes').addEventListener('click', () => { window.worldScene?.socket.emit('group:accept'); $('invite').hidden = true; });
$('invNo').addEventListener('click', () => { window.worldScene?.socket.emit('group:decline'); $('invite').hidden = true; });

// ---------- Boss (chip do HUD) ----------
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ':' + String(s % 60).padStart(2, '0');
};
setInterval(() => {
  const chip = $('bossChip');
  if (!BOSS && BOSS_NEXT === null) return;
  chip.hidden = false;
  chip.classList.toggle('live', !!BOSS);
  chip.textContent = BOSS ? '⚔ ' + SPECIES[BOSS.species_id].name + ' · ' + fmtTime(BOSS.until - Date.now()) : '⏳ Próximo lendário: ' + fmtTime(BOSS_NEXT - Date.now());
}, 500);
$('bossChip').addEventListener('click', () => { if (BOSS) window.worldScene?.walkToWorld(BOSS.x, BOSS.y); });
$('closeBag').addEventListener('click', () => openBag(false));
$('closeParty').addEventListener('click', () => openParty(false));
window.addEventListener('keydown', (e) => {
  if (!token || inBattle || document.activeElement.tagName === 'INPUT') return;
  if (e.key === 'Enter') { e.preventDefault(); openChat(true, true); return; }
  if (e.key.toLowerCase() === 'p') openParty();
  if (e.key.toLowerCase() === 'b') openBag();
  if (e.key.toLowerCase() === 'g') openGroup();
  if (e.key === 'Escape') { openParty(false); openBag(false); openGroup(false); }
});

// ---------- Minimapa ----------
const TILE_COLORS = ['#4caf50', '#e6d38a', '#2f6fd6', '#1b5e20', '#2e8b3d'];
function buildMinimap(mapData) {
  const off = document.createElement('canvas');
  off.width = MAP_W; off.height = MAP_H;
  const c = off.getContext('2d');
  mapData.forEach((row, y) => row.forEach((t, x) => { c.fillStyle = TILE_COLORS[t]; c.fillRect(x, y, 1, 1); }));
  return off;
}

// ---------- Chat ----------
const chat = { tab: 'global', msgs: { global: [], group: [] }, unread: { global: 0, group: 0 } };
const mobileMQ = matchMedia('(max-width: 640px)');
const hueOf = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const isChatVisible = () => { const c = $('chat'); return c.classList.contains('open') && !c.classList.contains('min') && !c.classList.contains('gone'); };

function chatLine(m) {
  const el = document.createElement('div');
  el.className = 'cm' + (m.ch === 'group' ? ' g' : m.ch === 'w' ? ' w' : '') + (m.fromId === MY_ID ? ' me' : '');
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = new Date(m.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  el.append(t);
  if (m.ch === 'group') { const g = document.createElement('span'); g.className = 'tag'; g.textContent = '[Grupo]'; el.append(g); }
  const who = document.createElement('b');
  who.textContent = m.ch === 'w' ? (m.fromId === MY_ID ? 'para ' + m.to : m.from + ' sussurra') : m.from;
  who.style.color = 'hsl(' + hueOf(m.from) + ', 75%, 72%)';
  if (m.fromId !== MY_ID) who.addEventListener('click', () => { $('chatInput').value = '/w ' + m.from + ' '; $('chatInput').focus(); });
  el.append(who, document.createTextNode(m.text)); // textContent: nunca interpreta HTML
  return el;
}
function renderChat() {
  const log = $('chatLog');
  log.replaceChildren(...chat.msgs[chat.tab].map(chatLine));
  log.scrollTop = log.scrollHeight;
}
function updateChatBadges() {
  const n = chat.unread.global + chat.unread.group;
  $('chatBadge').hidden = n === 0;
  $('chatBadge').textContent = n > 9 ? '9+' : n;
  document.querySelector('.ctab[data-ch=global] .udot').hidden = !chat.unread.global || chat.tab === 'global';
  document.querySelector('.ctab[data-ch=group] .udot').hidden = !chat.unread.group || chat.tab === 'group';
}
function addChat(m) {
  const ch = m.ch === 'group' ? 'group' : 'global'; // sussurros aparecem na aba Global
  const list = chat.msgs[ch];
  list.push(m);
  if (list.length > 120) list.shift();
  const log = $('chatLog');
  if (ch === chat.tab) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.append(chatLine(m));
    while (log.childElementCount > 120) log.firstElementChild.remove();
    if (nearBottom || m.fromId === MY_ID) log.scrollTop = log.scrollHeight;
  }
  if (m.fromId !== MY_ID && !(isChatVisible() && ch === chat.tab)) { chat.unread[ch]++; updateChatBadges(); }
  if (m.ch !== 'w') window.worldScene?.showBubble(m);
}
function setChatTab(tab) {
  chat.tab = tab;
  chat.unread[tab] = 0;
  document.querySelectorAll('.ctab').forEach((b) => b.classList.toggle('active', b.dataset.ch === tab));
  updateChatBadges();
  renderChat();
}
function openChat(open = true, focus = false) {
  const c = $('chat');
  if (c.classList.contains('gone')) return;
  if (open) {
    c.classList.add('open');
    c.classList.remove('min');
    chat.unread[chat.tab] = 0;
    updateChatBadges();
    const log = $('chatLog');
    log.scrollTop = log.scrollHeight;
    if (focus) $('chatInput').focus();
  } else {
    $('chatInput').blur();
    if (mobileMQ.matches) c.classList.remove('open'); else c.classList.add('min');
  }
}
// Durante batalhas o chat some (a tela de batalha ocupa tudo) e volta ao terminar
function chatBattle(on) {
  $('chat').classList.toggle('gone', on);
  if (on) $('chatInput').blur();
}
function initChat() {
  $('chat').hidden = false;
  const layout = () => { const c = $('chat'); if (mobileMQ.matches) { c.classList.remove('open', 'min'); } else c.classList.add('open'); };
  layout();
  mobileMQ.addEventListener('change', layout);
  $('chatBtn').addEventListener('click', () => (isChatVisible() ? openChat(false) : openChat(true, true)));
  $('chatMin').addEventListener('click', () => openChat(false));
  $('chatClose').addEventListener('click', () => openChat(false));
  document.querySelectorAll('.ctab').forEach((b) => b.addEventListener('click', () => setChatTab(b.dataset.ch)));
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Escape') openChat(false); });
  // Digitar no chat não pode mover o personagem (WASD/setas ficam desligados no Phaser enquanto o campo está ativo)
  $('chatInput').addEventListener('focus', () => { const k = window.worldScene?.input.keyboard; if (k) { k.enabled = false; k.resetKeys(); } });
  $('chatInput').addEventListener('blur', () => { const k = window.worldScene?.input.keyboard; if (k) k.enabled = true; });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('chatInput').value.trim();
    if (!raw) return;
    const w = raw.match(/^\/(?:w|msg|t)\s+(\S+)\s+([\s\S]+)$/i);
    const payload = w ? { ch: 'w', to: w[1], text: w[2] } : /^\/g\s+/i.test(raw) ? { ch: 'group', text: raw.replace(/^\/g\s+/i, '') } : { ch: chat.tab, text: raw };
    window.worldScene?.socket.emit('chat:send', payload);
    $('chatInput').value = '';
  });
  setGroupLabel();
  renderChat();
}

// ---------- Phaser ----------
class WorldScene extends Phaser.Scene {
  constructor() { super('World'); this.others = new Map(); this.wilds = new Map(); this.bubbles = new Map(); this.monWait = {}; this.lastSent = 0; }

  create() {
    this.makeTextures();
    this.mapData = generateMap();
    this.mini = buildMinimap(this.mapData);
    this.miniCtx = $('minimap').getContext('2d');

    const map = this.make.tilemap({ data: this.mapData, tileWidth: TILE, tileHeight: TILE });
    const tileset = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    this.layer = map.createLayer(0, tileset, 0, 0);
    this.layer.setCollision([2, 3]);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    const cw = (CLEAR_MAX - CLEAR_MIN + 1) * TILE;
    this.add.rectangle(CLEAR_MIN * TILE + cw / 2, CLEAR_MIN * TILE + cw / 2, cw, cw, 0xffffff, 0.14).setStrokeStyle(3, 0xffffff, 0.55).setDepth(1);
    this.add.text(CLEAR_MIN * TILE + cw / 2, CLEAR_MIN * TILE + 14, '✚ CENTRO POKÉMON', { fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', fontStyle: 'bold', color: '#fff', backgroundColor: '#e53950cc', padding: { x: 8, y: 3 } }).setOrigin(0.5).setDepth(2);

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT');
    this.path = null;
    this.lastTarget = '';
    // Clique/toque: anda até o ponto (arrastar mantém seguindo o dedo/mouse)
    this.input.on('pointerdown', (p) => this.setTarget(p, false));
    this.input.on('pointermove', (p) => { if (p.isDown) this.setTarget(p, true); });
    this.input.keyboard.removeCapture('W,A,S,D');

    this.socket = io({ auth: { token } });
    this.socket.on('connect_error', (err) => showOffline('Conexão recusada', err.message));
    this.socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') showOffline('Desconectado', 'Sua conta foi aberta em outro lugar ou a sessão foi encerrada.');
      else $('offline').hidden = false;
    });
    this.socket.on('connect', () => { $('offline').hidden = true; });
    this.socket.on('online', (n) => { $('online').textContent = n; });
    this.socket.on('players:init', ({ self, others, balls }) => {
      MY_ID = self.id;
      setBalls(balls);
      this.others.forEach((o) => { o.sprite.destroy(); o.label.destroy(); o.shadow.destroy(); });
      this.others.clear();
      if (this.player) this.player.setPosition(self.x, self.y); else this.spawnSelf(self);
      others.forEach((p) => this.addOther(p));
    });
    this.socket.on('player:joined', (p) => { this.addOther(p); toast(`${p.username} entrou no mundo`); });
    this.socket.on('player:moved', (p) => {
      const o = this.others.get(p.id);
      if (o) this.tweens.add({ targets: o.sprite, x: p.x, y: p.y, duration: 60 });
    });
    this.socket.on('player:left', (id) => {
      const o = this.others.get(id);
      if (!o) return;
      toast(`${o.name} saiu`);
      o.sprite.destroy(); o.label.destroy(); o.shadow.destroy();
      this.others.delete(id);
    });
    window.worldScene = this;
    this.socket.on('chat:history', (list) => { chat.msgs.global = list.slice(); if (chat.tab === 'global') renderChat(); });
    this.socket.on('chat:msg', addChat);
    this.socket.on('chat:error', (m) => toast(m));
    Battle.init(this.socket);
    this.socket.on('notice', ({ msg, big }) => toast(msg, big));
    this.socket.on('boss:state', ({ boss, nextIn }) => { BOSS_NEXT = nextIn != null ? Date.now() + nextIn : null; this.setBoss(boss); });
    this.socket.on('group:update', (gr) => { GROUP = gr; setGroupLabel(); if ($('group').classList.contains('open')) renderGroup(); });
    this.socket.on('group:invited', ({ from }) => {
      $('inviteTxt').textContent = from + ' convidou você para um grupo';
      $('invite').hidden = false;
      clearTimeout(inviteTimer);
      inviteTimer = setTimeout(() => ($('invite').hidden = true), 60000);
    });
    this.socket.on('online:list', (names) => {
      const box = $('onlineList');
      if (box) box.innerHTML = names.length ? names.map((n) => '<button data-n="' + esc(n) + '">' + esc(n) + '</button>').join('') : '<span class="hintline">Ninguém disponível agora.</span>';
      box?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => window.__sendInvite(b.dataset.n)));
    });
    this.socket.on('raid:start', (d) => {
      inBattle = true;
      chatBattle(true);
      this.player?.setVelocity(0, 0);
      this.cameras.main.flash(500, 255, 215, 0);
      this.cameras.main.shake(400, 0.008);
      openParty(false); openBag(false); openGroup(false);
      Battle.startRaid(d);
    });
    // Pokémon selvagens (o servidor manda e controla; aqui só desenhamos)
    this.socket.on('wild:list', (list) => { this.wilds.forEach((w) => this.destroyWild(w)); this.wilds.clear(); list.forEach((w) => this.addWild(w)); });
    this.socket.on('wild:add', (w) => this.addWild(w));
    this.socket.on('wild:remove', (id) => { const w = this.wilds.get(id); if (w) { this.destroyWild(w); this.wilds.delete(id); } });
    this.socket.on('wild:update', (arr) => arr.forEach(({ id, x, y }) => { const w = this.wilds.get(id); if (w) this.tweens.add({ targets: w.img, x, y, duration: 900 }); }));
    this.socket.on('battle:start', (d) => {
      inBattle = true;
      chatBattle(true);
      this.player?.setVelocity(0, 0);
      this.cameras.main.flash(350, 255, 255, 255);
      this.cameras.main.shake(300, 0.006);
      openParty(false); openBag(false); openGroup(false);
      setTimeout(() => Battle.start(d), 450);
    });
    this.socket.on('party:healed', ({ balls }) => { setBalls(balls); toast('Centro Pokémon: equipe curada e Pokébolas repostas'); });
    // Servidor rejeitou o movimento (velocidade/colisão): volta para a posição autoritativa
    this.socket.on('player:correct', ({ x, y }) => { if (this.player) { this.player.setPosition(x, y); this.player.setVelocity(0, 0); } });
  }

  makeTextures() {
    const tex = this.textures.createCanvas('tiles', TILE * 5, TILE);
    const c = tex.getContext();
    const grass = (i) => { c.fillStyle = '#4caf50'; c.fillRect(i * TILE, 0, TILE, TILE); c.fillStyle = '#57bb5b'; for (let k = 0; k < 6; k++) c.fillRect(i * TILE + ((k * 11) % 28), (k * 7) % 28, 3, 3); };
    grass(0);
    c.fillStyle = '#e6d38a'; c.fillRect(TILE, 0, TILE, TILE); c.fillStyle = '#d6c274'; for (let k = 0; k < 5; k++) c.fillRect(TILE + ((k * 9) % 28), (k * 13) % 28, 2, 2);
    c.fillStyle = '#2f6fd6'; c.fillRect(2 * TILE, 0, TILE, TILE); c.fillStyle = '#5b95e8'; c.fillRect(2 * TILE + 4, 8, 10, 2); c.fillRect(2 * TILE + 16, 22, 10, 2);
    grass(3);
    c.fillStyle = '#5d4037'; c.fillRect(3 * TILE + 13, 20, 6, 12);
    c.fillStyle = '#1b5e20'; c.beginPath(); c.arc(3 * TILE + 16, 14, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2e7d32'; c.beginPath(); c.arc(3 * TILE + 12, 11, 7, 0, Math.PI * 2); c.fill();
    // tile 4: grama alta
    c.fillStyle = '#3a9645'; c.fillRect(4 * TILE, 0, TILE, TILE);
    c.strokeStyle = '#1f6e2c'; c.lineWidth = 2;
    for (const [px, py] of [[5, 12], [16, 8], [26, 14], [10, 24], [22, 27]]) { c.beginPath(); c.moveTo(4 * TILE + px - 3, py + 6); c.lineTo(4 * TILE + px, py - 4); c.lineTo(4 * TILE + px + 3, py + 6); c.stroke(); }
    tex.refresh();

    const avatar = (key, body) => {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(body).fillRoundedRect(7, 12, 18, 18, 6);
      g.fillStyle(0xffd9b0).fillCircle(16, 10, 7);
      g.fillStyle(0x1b1f33).fillRect(9, 3, 14, 5).fillRect(8, 7, 16, 2);
      g.fillStyle(0x1b1f33).fillRect(13, 10, 2, 3).fillRect(18, 10, 2, 3);
      g.generateTexture(key, 32, 32);
    };
    avatar('player', 0xe53950);
    avatar('other', 0x3d8bff);
    const wd = this.make.graphics({ x: 0, y: 0, add: false });
    wd.fillStyle(0xffb02e).fillCircle(10, 10, 9).lineStyle(2, 0xffffff).strokeCircle(10, 10, 9);
    wd.generateTexture('wilddot', 20, 20);
    const s = this.make.graphics({ x: 0, y: 0, add: false });
    s.fillStyle(0x000000, 0.35).fillEllipse(16, 8, 22, 9);
    s.generateTexture('shadow', 32, 16);
  }

  label(text) {
    return this.add.text(0, 0, text, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020cc', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(20);
  }

  spawnSelf({ x, y, username }) {
    this.myShadow = this.add.image(x, y, 'shadow').setDepth(8);
    this.player = this.physics.add.sprite(x, y, 'player').setDepth(10);
    this.player.body.setSize(18, 18).setOffset(7, 12);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.layer);
    this.myLabel = this.label(username);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.fadeIn(600);
  }

  addOther(p) {
    if (this.others.has(p.id)) return;
    const shadow = this.add.image(p.x, p.y + 12, 'shadow').setDepth(8);
    const sprite = this.add.sprite(p.x, p.y, 'other').setDepth(9);
    this.others.set(p.id, { sprite, shadow, name: p.username, label: this.label(p.username) });
  }

  // ----- Click-to-move: BFS nos tiles + suavização por linha de visão -----
  walkable(tx, ty) {
    const t = this.mapData[ty]?.[tx];
    return t !== undefined && t !== 2 && t !== 3;
  }

  clearAt(px, py) { // corpo do jogador (18px) sem tocar em tiles bloqueados
    return [[-9, -9], [9, -9], [-9, 9], [9, 9]].every(([dx, dy]) => this.walkable(Math.floor((px + dx) / TILE), Math.floor((py + dy) / TILE)));
  }

  lineClear(a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
    for (let i = 1; i <= n; i++) if (!this.clearAt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) return false;
    return true;
  }

  findPath(tx, ty) {
    const sx = Math.floor(this.player.x / TILE), sy = Math.floor(this.player.y / TILE);
    const prev = new Int32Array(MAP_W * MAP_H).fill(-2);
    const start = sy * MAP_W + sx;
    prev[start] = -1;
    const queue = [start];
    let best = start, bestD = Math.hypot(sx - tx, sy - ty);
    for (let h = 0; h < queue.length; h++) {
      const cur = queue[h], cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
      const d = Math.hypot(cx - tx, cy - ty);
      if (d < bestD) { best = cur; bestD = d; }
      if (cx === tx && cy === ty) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, ni = ny * MAP_W + nx;
        if (!this.walkable(nx, ny) || prev[ni] !== -2) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    const pts = [];
    for (let c = best; c !== -1; c = prev[c]) pts.unshift({ x: (c % MAP_W) * TILE + TILE / 2, y: ((c / MAP_W) | 0) * TILE + TILE / 2 });
    pts[0] = { x: this.player.x, y: this.player.y };
    const out = [];
    for (let i = 0; i < pts.length - 1;) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  setTarget(pointer, dragging) {
    if (inBattle || !this.player) return;
    const tx = Math.floor(pointer.worldX / TILE), ty = Math.floor(pointer.worldY / TILE);
    const key = tx + ',' + ty;
    if (dragging && key === this.lastTarget) return;
    this.lastTarget = key;
    this.path = this.findPath(tx, ty);
    this.stuck = { t: 0, x: this.player.x, y: this.player.y };
    if (!dragging) {
      const ring = this.add.circle(pointer.worldX, pointer.worldY, 10, 0xffffff, 0.2).setStrokeStyle(3, 0xffffff, 0.9).setDepth(5);
      this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 550, onComplete: () => ring.destroy() });
    }
  }

  ensureMon(id, cb) {
    const key = 'mon' + id;
    if (this.textures.exists(key)) return cb(key);
    const waiting = (this.monWait[key] ||= []);
    waiting.push(cb);
    if (waiting.length > 1) return;
    this.load.image(key, spriteUrl(id));
    this.load.once('filecomplete-image-' + key, () => { this.monWait[key].forEach((f) => f(key)); delete this.monWait[key]; });
    this.load.start();
  }

  addWild(d) {
    if (this.wilds.has(d.id)) return;
    const name = (typeof SPECIES !== 'undefined' && SPECIES[d.species_id]?.name) || '#' + d.species_id;
    const shadow = this.add.image(d.x, d.y + 14, 'shadow').setDepth(6).setScale(1.2);
    const img = this.add.image(d.x, d.y, 'wilddot').setDepth(7);
    const rar = rarityOf(d.species_id);
    const tier = SPECIES[d.species_id]?.rarity;
    const star = tier === 'epic' || tier === 'legendary' ? '✦ ' : '';
    const label = this.add.text(d.x, d.y - 34, `${star}${name} Lv.${d.level}`, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: rar.color + 'e6', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(19);
    const w = { img, shadow, label, water: d.water };
    if (d.water) { // aquáticos balançam na água, com brilho azul
      shadow.setTint(0x9fd8ff).setScale(1.6);
      this.tweens.add({ targets: img, angle: 6, yoyo: true, repeat: -1, duration: 900 + Math.random() * 500, ease: 'Sine.easeInOut' });
    }
    if (tier !== 'common') shadow.setTint(Phaser.Display.Color.HexStringToColor(rar.color).color);
    if (tier === 'epic' || tier === 'legendary') this.tweens.add({ targets: img, alpha: 0.7, yoyo: true, repeat: -1, duration: 700 });
    this.wilds.set(d.id, w);
    this.ensureMon(d.species_id, (key) => { if (img.active) img.setTexture(key).setDisplaySize(60, 60); });
  }

  setBoss(b) {
    if (this.bossObj) { const o = this.bossObj; this.tweens.killTweensOf(o.aura); this.tweens.killTweensOf(o.img); Object.values(o).forEach((x) => x.destroy()); this.bossObj = null; }
    BOSS = b ? { species_id: b.species_id, x: b.x, y: b.y, until: Date.now() + b.left } : null;
    if (!b) return;
    const aura = this.add.circle(b.x, b.y + 6, 54, 0xf0b400, 0.25).setDepth(6);
    this.tweens.add({ targets: aura, scale: 1.4, alpha: 0.05, yoyo: true, repeat: -1, duration: 900 });
    const shadow = this.add.image(b.x, b.y + 34, 'shadow').setDepth(6).setScale(2.4);
    const img = this.add.image(b.x, b.y, 'wilddot').setDepth(8);
    const label = this.add.text(b.x, b.y - 78, '☠ BOSS · ' + SPECIES[b.species_id].name, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#2b1d00', backgroundColor: '#f0b400', padding: { x: 8, y: 3 } }).setOrigin(0.5).setDepth(20);
    this.ensureMon(b.species_id, (key) => { if (img.active) img.setTexture(key).setDisplaySize(120, 120); });
    this.tweens.add({ targets: img, y: b.y - 6, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.easeInOut' });
    this.bossObj = { aura, shadow, img, label };
  }

  walkToWorld(x, y) { this.setTarget({ worldX: x, worldY: y }, false); }

  destroyWild(w) { this.tweens.killTweensOf(w.img); w.img.destroy(); w.shadow.destroy(); w.label.destroy(); }

  // Balão de fala sobre o jogador que mandou a mensagem (global ou de grupo), some em ~5 s
  showBubble(m) {
    const target = m.fromId === MY_ID ? this.player : this.others.get(m.fromId)?.sprite;
    if (!target) return;
    this.bubbles.get(m.fromId)?.obj.destroy();
    const txt = m.text.length > 60 ? m.text.slice(0, 57) + '…' : m.text;
    const obj = this.add.text(target.x, target.y - 46, txt, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', color: '#0b1020', backgroundColor: '#ffffffee', padding: { x: 8, y: 5 }, wordWrap: { width: 170 }, align: 'center' }).setOrigin(0.5, 1).setDepth(40);
    this.bubbles.set(m.fromId, { obj, target, until: this.time.now + 5500 });
  }

  drawMinimap() {
    const S = 150, k = S / MAP_W, c = this.miniCtx;
    c.drawImage(this.mini, 0, 0, S, S);
    const dot = (px, py, col, r) => { c.fillStyle = col; c.beginPath(); c.arc((px / TILE) * k, (py / TILE) * k, r, 0, Math.PI * 2); c.fill(); };
    if (BOSS) { c.lineWidth = 1.5; c.strokeStyle = '#fff'; dot(BOSS.x, BOSS.y, '#f0b400', 4.2); c.stroke(); }
    this.wilds.forEach((w) => dot(w.img.x, w.img.y, w.water ? '#5ec8ff' : '#ffb02e', 1.8));
    this.others.forEach((o) => dot(o.sprite.x, o.sprite.y, '#4da3ff', 2.5));
    c.lineWidth = 1.5; c.strokeStyle = '#fff'; dot(this.player.x, this.player.y, '#ff4d5e', 3.2); c.stroke();
  }

  update(time, delta) {
    if (!this.player) return;
    this.bubbles.forEach((b, id) => { // balões acompanham quem falou
      if (!b.target.active || this.time.now > b.until) { b.obj.destroy(); this.bubbles.delete(id); } else b.obj.setPosition(b.target.x, b.target.y - 46);
    });
    const k = this.keys;
    let vx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let vy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (inBattle) { vx = 0; vy = 0; this.path = null; }
    else if (vx || vy) this.path = null; // teclado cancela o clique
    else if (this.path?.length) {
      const t = this.path[0], dx = t.x - this.player.x, dy = t.y - this.player.y, d = Math.hypot(dx, dy);
      if (d < 1.5) this.path.shift();
      else {
        const frac = Math.min(1, d / ((delta / 1000) * PLAYER_SPEED)); // não ultrapassa o destino
        vx = (dx / d) * frac; vy = (dy / d) * frac;
      }
      // Travou em algo? cancela
      this.stuck.t += delta;
      if (this.stuck.t > 500) {
        if (Math.hypot(this.player.x - this.stuck.x, this.player.y - this.stuck.y) < 3) this.path = null;
        this.stuck = { t: 0, x: this.player.x, y: this.player.y };
      }
    }
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    this.player.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);

    const p = this.player;
    this.myLabel.setPosition(p.x, p.y - 26);
    this.myShadow.setPosition(p.x, p.y + 12);
    this.wilds.forEach((w) => { w.shadow.setPosition(w.img.x, w.img.y + 14); w.label.setPosition(w.img.x, w.img.y - 34); });
    this.others.forEach((o) => { o.label.setPosition(o.sprite.x, o.sprite.y - 26); o.shadow.setPosition(o.sprite.x, o.sprite.y + 12); });
    $('coords').textContent = `${Math.floor(p.x / TILE)}, ${Math.floor(p.y / TILE)}`;
    this.drawMinimap();

    const moving = Math.hypot(vx, vy) > 0.05;
    if (!inBattle && (moving || this.moving) && time - this.lastSent > 40) {
      this.lastSent = time;
      this.moving = moving;
      const dir = Math.abs(vy) > Math.abs(vx) ? (vy > 0 ? 'down' : 'up') : vx < 0 ? 'left' : 'right';
      this.socket.emit('player:move', { x: Math.round(p.x), y: Math.round(p.y), dir });
    }
  }
}

function showOffline(title, msg) {
  $('offTitle').textContent = title;
  $('offMsg').textContent = msg;
  $('offline').hidden = false;
}

function startGame() {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
    pixelArt: true,
    backgroundColor: '#0b1020',
    physics: { default: 'arcade' },
    loader: { crossOrigin: 'anonymous' },
    scale: { mode: Phaser.Scale.RESIZE },
    scene: WorldScene,
  });
}
