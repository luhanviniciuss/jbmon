const $ = (id) => document.getElementById(id);
let token = null;
let mode = 'login';
let inBattle = false;
const setBalls = (n) => { $('balls').textContent = n; };

const GEN1 = 'bulbasaur ivysaur venusaur charmander charmeleon charizard squirtle wartortle blastoise caterpie metapod butterfree weedle kakuna beedrill pidgey pidgeotto pidgeot rattata raticate spearow fearow ekans arbok pikachu raichu sandshrew sandslash nidoran-f nidorina nidoqueen nidoran-m nidorino nidoking clefairy clefable vulpix ninetales jigglypuff wigglytuff zubat golbat oddish gloom vileplume paras parasect venonat venomoth diglett dugtrio meowth persian psyduck golduck mankey primeape growlithe arcanine poliwag poliwhirl poliwrath abra kadabra alakazam machop machoke machamp bellsprout weepinbell victreebel tentacool tentacruel geodude graveler golem ponyta rapidash slowpoke slowbro magnemite magneton farfetchd doduo dodrio seel dewgong grimer muk shellder cloyster gastly haunter gengar onix drowzee hypno krabby kingler voltorb electrode exeggcute exeggutor cubone marowak hitmonlee hitmonchan lickitung koffing weezing rhyhorn rhydon chansey tangela kangaskhan horsea seadra goldeen seaking staryu starmie mr-mime scyther jynx electabuzz magmar pinsir tauros magikarp gyarados lapras ditto eevee vaporeon jolteon flareon porygon omanyte omastar kabuto kabutops aerodactyl snorlax articuno zapdos moltres dratini dragonair dragonite mewtwo mew'.split(' ');
const speciesName = (id) => GEN1[id - 1] || `#${id}`;
const spriteUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

// ---------- Utilidades de UI ----------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
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

const monCard = (p, i) => `<div class="mon${p.current_hp <= 0 ? ' fainted' : ''}" style="animation-delay:${i * 60}ms">
  <div class="art"><img src="${spriteUrl(p.species_id)}" alt="" onerror="this.style.opacity=.2" /></div>
  <div><div class="top"><span class="name">${p.nickname || speciesName(p.species_id)}</span><span class="lv">Lv. ${p.level}</span></div>
  ${statRow('hp', 'HP', p.current_hp, p.hp, p.current_hp + '/' + p.hp)}${statRow('atk', 'ATK', p.attack, 60)}${statRow('def', 'DEF', p.defense, 60)}${statRow('xp', 'EXP', p.current_exp, p.level * 20)}</div></div>`;

async function openParty(open = !$('drawer').classList.contains('open')) {
  const drawer = $('drawer');
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', !open);
  if (!open) return;
  $('partyList').innerHTML = '<p class="empty">Carregando…</p>';
  try {
    const res = await fetch('/api/party', { headers: { Authorization: `Bearer ${token}` } });
    const { party, box, balls } = await res.json();
    setBalls(balls);
    $('partyList').innerHTML = (party.length ? party.map(monCard).join('') : '<p class="empty">Nenhum Pokémon ainda.</p>')
      + (box.length ? `<div class="section-title">Box · ${box.length}</div>${box.map(monCard).join('')}` : '');
    requestAnimationFrame(() => $('partyList').querySelectorAll('.bar i').forEach((i) => (i.style.width = i.style.getPropertyValue('--w'))));
  } catch {
    $('partyList').innerHTML = '<p class="empty">Erro ao carregar a party.</p>';
  }
}
$('partyBtn').addEventListener('click', () => openParty());
$('closeParty').addEventListener('click', () => openParty(false));
window.addEventListener('keydown', (e) => {
  if (!token || inBattle || document.activeElement.tagName === 'INPUT') return;
  if (e.key.toLowerCase() === 'p') openParty();
  if (e.key === 'Escape') openParty(false);
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

// ---------- Phaser ----------
class WorldScene extends Phaser.Scene {
  constructor() { super('World'); this.others = new Map(); this.wilds = new Map(); this.monWait = {}; this.lastSent = 0; }

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
    Battle.init(this.socket);
    // Pokémon selvagens (o servidor manda e controla; aqui só desenhamos)
    this.socket.on('wild:list', (list) => { this.wilds.forEach((w) => this.destroyWild(w)); this.wilds.clear(); list.forEach((w) => this.addWild(w)); });
    this.socket.on('wild:add', (w) => this.addWild(w));
    this.socket.on('wild:remove', (id) => { const w = this.wilds.get(id); if (w) { this.destroyWild(w); this.wilds.delete(id); } });
    this.socket.on('wild:update', (arr) => arr.forEach(({ id, x, y }) => { const w = this.wilds.get(id); if (w) this.tweens.add({ targets: w.img, x, y, duration: 900 }); }));
    this.socket.on('battle:start', (d) => {
      inBattle = true;
      this.player?.setVelocity(0, 0);
      this.cameras.main.flash(350, 255, 255, 255);
      this.cameras.main.shake(300, 0.006);
      openParty(false);
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
    const label = this.add.text(d.x, d.y - 34, `${name} Lv.${d.level}`, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#b3261ecc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(19);
    const w = { img, shadow, label };
    this.wilds.set(d.id, w);
    this.ensureMon(d.species_id, (key) => { if (img.active) img.setTexture(key).setDisplaySize(60, 60); });
  }

  destroyWild(w) { w.img.destroy(); w.shadow.destroy(); w.label.destroy(); }

  drawMinimap() {
    const S = 150, k = S / MAP_W, c = this.miniCtx;
    c.drawImage(this.mini, 0, 0, S, S);
    const dot = (px, py, col, r) => { c.fillStyle = col; c.beginPath(); c.arc((px / TILE) * k, (py / TILE) * k, r, 0, Math.PI * 2); c.fill(); };
    this.wilds.forEach((w) => dot(w.img.x, w.img.y, '#ffb02e', 1.8));
    this.others.forEach((o) => dot(o.sprite.x, o.sprite.y, '#4da3ff', 2.5));
    c.lineWidth = 1.5; c.strokeStyle = '#fff'; dot(this.player.x, this.player.y, '#ff4d5e', 3.2); c.stroke();
  }

  update(time, delta) {
    if (!this.player) return;
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
