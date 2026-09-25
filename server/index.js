require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const { MAP_W, TILE, PLAYER_SPEED, CLEAR_MIN, CLEAR_MAX, generateMap } = require('../public/map.js');
const { SPECIES, calcStats } = require('../public/species.js');
const { BALLS, RECIPES } = require('../public/items.js');
const { pickSpecies, makeWild, resolveTurn, mineView, wildView } = require('./battle.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const MAP_PX = MAP_W * TILE;
const MAP = generateMap();
const SPAWN = { x: 1600, y: 1600 };

// Anti-cheat: orçamento de distância que recarrega com a velocidade máxima (+25% de tolerância)
const MAX_SPEED = PLAYER_SPEED * 1.25;
const BUDGET_CAP = 48; // px de rajada permitida (jitter de rede)
const MAX_STRIKES = 20;
const isBlocked = (x, y) => {
  const t = MAP[Math.floor(y / TILE)]?.[Math.floor(x / TILE)];
  return t === undefined || t === 2 || t === 3;
};

// Encontros
const STARTERS = [1, 4, 7]; // Bulbasaur, Charmander, Squirtle
const WILD_COUNT = 70;
const WILD_WANDER = 3; // tiles de distância máxima do "lar"
const TOUCH_RADIUS = 28; // px: encostar num selvagem inicia a batalha
const RESPAWN_MS = 15000;
const IMMUNE_MS = 4000; // após uma batalha, ninguém te puxa de novo
const ACTIONS = ['attack', 'strong', 'run', ...Object.keys(BALLS).map((k) => 'ball:' + k)];
const LEVEL_BONUS = { common: 0, uncommon: 1, rare: 2, epic: 4, legendary: 0 };
const HEAL_BALLS = 10; // o Centro Pokémon repõe até esta quantidade

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Pokémon selvagens no mapa (autoritativo) ----------
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const inClearing = (tx, ty) => tx >= CLEAR_MIN - 1 && tx <= CLEAR_MAX + 1 && ty >= CLEAR_MIN - 1 && ty <= CLEAR_MAX + 1;
const grassTiles = [];
MAP.forEach((row, y) => row.forEach((t, x) => { if (t === 4 && !inClearing(x, y)) grassTiles.push([x, y]); }));
const wilds = new Map(); // id -> { id, species_id, level, tx, ty, homeX, homeY, x, y, busy }
let nextWildId = 1;
const wildLevelAt = (tx, ty) => Math.max(2, Math.min(40, 2 + Math.floor(Math.hypot(tx - 50, ty - 50) / 9) + rand(-1, 2))); // mais forte longe do centro
const wildPublic = (w) => ({ id: w.id, species_id: w.species_id, level: w.level, x: w.x, y: w.y });

function spawnWild() {
  let id = pickSpecies();
  // No máximo um de cada lendário vivo no mapa
  for (let i = 0; i < 10 && SPECIES[id].rarity === 'legendary' && [...wilds.values()].some((w) => w.species_id === id); i++) id = pickSpecies();
  const rarity = SPECIES[id].rarity;
  let tile;
  for (let i = 0; i < 300; i++) {
    tile = grassTiles[rand(0, grassTiles.length - 1)];
    const d = Math.hypot(tile[0] - 50, tile[1] - 50);
    if (rarity === 'legendary' ? d >= 40 : Math.random() < 0.4 || d < 30) break; // lendários só longe do centro
  }
  const [tx, ty] = tile;
  const level = rarity === 'legendary' ? 40 + rand(0, 5) : Math.min(50, wildLevelAt(tx, ty) + LEVEL_BONUS[rarity]);
  const w = { id: nextWildId++, species_id: id, level, tx, ty, homeX: tx, homeY: ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, busy: false };
  wilds.set(w.id, w);
  return w;
}
if (grassTiles.length) for (let i = 0; i < WILD_COUNT; i++) spawnWild();
console.log(`${wilds.size} Pokémon selvagens (${grassTiles.length} tiles de grama alta)`);

const releaseWild = (w) => { w.busy = false; io.emit('wild:add', wildPublic(w)); }; // fugiu/perdeu: volta ao mapa
const defeatWild = (w) => { // venceu/capturou: some e um novo nasce depois
  wilds.delete(w.id);
  setTimeout(() => { if (grassTiles.length) io.emit('wild:add', wildPublic(spawnWild())); }, RESPAWN_MS);
};

setInterval(() => { // vagueiam perto de casa
  const moved = [];
  for (const w of wilds.values()) {
    if (w.busy || Math.random() > 0.35) continue;
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rand(0, 3)];
    const nx = w.tx + dx, ny = w.ty + dy, t = MAP[ny]?.[nx];
    if (t === undefined || t === 2 || t === 3 || inClearing(nx, ny) || Math.abs(nx - w.homeX) > WILD_WANDER || Math.abs(ny - w.homeY) > WILD_WANDER) continue;
    Object.assign(w, { tx: nx, ty: ny, x: nx * TILE + TILE / 2, y: ny * TILE + TILE / 2 });
    moved.push({ id: w.id, x: w.x, y: w.y });
  }
  if (moved.length) io.emit('wild:update', moved);
}, 1000);

const invOf = (u) => ({ poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });
const matsOf = (u) => ({ apricorns: u.apricorns, shards: u.shards });
const battlingUsers = new Set(); // ids em batalha (bloqueia o craft)

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- REST ----------
const signToken = (user) => jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || username.length > 16 || password.length < 4) {
    return res.status(400).json({ error: 'Usuário (3-16) e senha (mín. 4) obrigatórios' });
  }
  try {
    const sid = STARTERS[Math.floor(Math.random() * STARTERS.length)];
    const st = calcStats(sid, 5);
    const user = await prisma.user.create({
      data: {
        username,
        password_hash: await bcrypt.hash(password, 10),
        pokemons: { create: { species_id: sid, level: 5, hp: st.hp, attack: st.attack, defense: st.defense, current_hp: st.hp } },
      },
    });
    res.json({ token: signToken(user), username: user.username });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Usuário já existe' });
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { username: String(username || '') } });
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  res.json({ token: signToken(user), username: user.username });
});

app.get('/api/party', auth, async (req, res) => {
  const [pokemons, user] = await Promise.all([
    prisma.pokemon.findMany({ where: { user_id: req.user.id }, orderBy: { id: 'asc' } }),
    prisma.user.findUnique({ where: { id: req.user.id } }),
  ]);
  res.json({ party: pokemons.slice(0, 6), box: pokemons.slice(6), balls: invOf(user) });
});

app.get('/api/inventory', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ balls: invOf(user), mats: matsOf(user) });
});

app.post('/api/craft', auth, async (req, res) => {
  const recipe = RECIPES.find((r) => r.id === req.body?.recipe);
  if (!recipe) return res.status(400).json({ error: 'Receita inválida' });
  if (battlingUsers.has(req.user.id)) return res.status(409).json({ error: 'Termine a batalha antes de criar itens' });
  const cost = { apricorns: recipe.cost.apricorns || 0, shards: recipe.cost.shards || 0 };
  const data = { apricorns: { decrement: cost.apricorns }, shards: { decrement: cost.shards } };
  for (const [kind, n] of Object.entries(recipe.gives)) data[BALLS[kind].col] = { increment: n };
  // updateMany com condição = débito atômico (sem corrida entre dois cliques)
  const { count } = await prisma.user.updateMany({ where: { id: req.user.id, apricorns: { gte: cost.apricorns }, shards: { gte: cost.shards } }, data });
  if (!count) return res.status(400).json({ error: 'Materiais insuficientes' });
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ balls: invOf(user), mats: matsOf(user) });
});

// ---------- Socket.io ----------
const players = new Map(); // socket.id -> { id, username, x, y, dir }
const clamp = (v) => Math.max(0, Math.min(MAP_PX, Number(v) || 0));

async function savePosition(p) {
  try {
    await prisma.user.update({ where: { id: p.id }, data: { x: p.x, y: p.y } });
  } catch (e) {
    console.error('Falha ao salvar posição', e.message);
  }
}

io.use(async (socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return next(new Error('Usuário não encontrado'));
    socket.data.user = user;
    next();
  } catch {
    next(new Error('Não autenticado'));
  }
});

io.on('connection', (socket) => {
  const u = socket.data.user;

  // Evita sessão duplicada da mesma conta
  for (const [sid, p] of players) if (p.id === u.id) io.sockets.sockets.get(sid)?.disconnect(true);

  const me = { id: u.id, username: u.username, x: u.x, y: u.y, dir: 'down' };
  players.set(socket.id, me);

  socket.emit('players:init', {
    self: me,
    balls: invOf(u),
    mats: matsOf(u),
    others: [...players.entries()].filter(([sid]) => sid !== socket.id).map(([, p]) => p),
  });
  socket.emit('wild:list', [...wilds.values()].filter((w) => !w.busy).map(wildPublic));
  socket.broadcast.emit('player:joined', me);
  io.emit('online', players.size);

  // ----- Batalha (estado autoritativo no servidor) -----
  let battle = null; // { team, mine, wild, world, inv }
  const setBusy = (v) => (v ? battlingUsers.add(u.id) : battlingUsers.delete(u.id));
  let starting = false;
  let acting = false;
  let lastTile = '';
  let immuneUntil = 0;
  let lastHeal = 0;

  const persist = (b, drops) =>
    prisma.$transaction([
      ...b.team.map((p) =>
        prisma.pokemon.update({
          where: { id: p.id },
          data: { species_id: p.species_id, level: p.level, hp: p.hp, attack: p.attack, defense: p.defense, current_exp: p.current_exp, current_hp: p.current_hp },
        })
      ),
      prisma.user.update({
        where: { id: u.id },
        data: {
          pokeballs: b.inv.poke, greatballs: b.inv.great, ultraballs: b.inv.ultra, masterballs: b.inv.master,
          ...(drops ? { apricorns: { increment: drops.apricorns }, shards: { increment: drops.shards } } : {}),
        },
      }),
    ]);

  async function startBattle(w) {
    starting = true;
    setBusy(true);
    w.busy = true;
    io.emit('wild:remove', w.id);
    try {
      const team = await prisma.pokemon.findMany({ where: { user_id: u.id }, orderBy: { id: 'asc' }, take: 6 });
      const mine = team.find((p) => p.current_hp > 0);
      const fresh = await prisma.user.findUnique({ where: { id: u.id } });
      if (!mine || socket.disconnected) return releaseWild(w);
      battle = { team, mine, world: w, wild: makeWild(w.species_id, w.level), inv: invOf(fresh) };
      socket.emit('battle:start', { wild: wildView(battle.wild), mine: mineView(mine), balls: battle.inv });
    } catch (err) {
      console.error('Falha ao iniciar batalha', err.message);
      releaseWild(w);
    } finally {
      starting = false;
      if (!battle) setBusy(false);
    }
  }

  async function healParty() {
    if (battle || starting) return;
    try {
      const [all, usr] = await Promise.all([
        prisma.pokemon.findMany({ where: { user_id: u.id } }),
        prisma.user.findUnique({ where: { id: u.id } }),
      ]);
      const hurt = all.filter((p) => p.current_hp < p.hp);
      if (!hurt.length && usr.pokeballs >= HEAL_BALLS) return;
      const pokeballs = Math.max(usr.pokeballs, HEAL_BALLS);
      await prisma.$transaction([
        ...hurt.map((p) => prisma.pokemon.update({ where: { id: p.id }, data: { current_hp: p.hp } })),
        prisma.user.update({ where: { id: u.id }, data: { pokeballs } }),
      ]);
      socket.emit('party:healed', { balls: invOf({ ...usr, pokeballs }) });
    } catch (e) {
      console.error('Falha ao curar', e.message);
    }
  }

  socket.on('battle:action', async (type) => {
    if (!battle || acting || !ACTIONS.includes(type)) return;
    acting = true;
    try {
      const b = battle;
      const r = resolveTurn(b, type);
      if (r.result === 'lose') {
        b.team.forEach((p) => (p.current_hp = p.hp)); // desmaiou: cura e volta ao Centro
        me.x = SPAWN.x;
        me.y = SPAWN.y;
      }
      if (r.capture) await prisma.pokemon.create({ data: { user_id: u.id, ...r.capture } });
      await persist(b, r.drops);
      if (r.result === 'lose') await savePosition(me);

      socket.emit('battle:update', { log: r.log, result: r.result, balls: b.inv, drops: r.drops || null, capture: r.capture ? { species_id: r.capture.species_id } : null });
      if (r.result) {
        if (r.result === 'win' || r.result === 'caught') defeatWild(b.world);
        else releaseWild(b.world);
        immuneUntil = Date.now() + IMMUNE_MS;
        battle = null;
        setBusy(false);
        lastTile = '';
        if (r.result === 'lose') {
          socket.emit('player:correct', { x: me.x, y: me.y });
          socket.broadcast.emit('player:moved', { id: me.id, x: me.x, y: me.y, dir: me.dir });
        }
      }
    } catch (e) {
      console.error('Falha no turno', e.message);
    } finally {
      acting = false;
    }
  });

  // ----- Movimento (com validação de velocidade) -----
  let last = 0;
  let budget = BUDGET_CAP;
  let strikes = 0;
  socket.on('player:move', ({ x, y, dir } = {}) => {
    const now = Date.now();
    if (now - last < 30) return; // rate limit ~33 msg/s
    budget = Math.min(BUDGET_CAP, budget + ((now - last) / 1000) * MAX_SPEED);
    last = now;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (battle || starting) return socket.emit('player:correct', { x: me.x, y: me.y }); // parado em batalha

    const dist = Math.hypot(x - me.x, y - me.y);
    if (dist > budget || isBlocked(x, y)) {
      // Movimento impossível: ignora e devolve a posição autoritativa ao cliente
      if (++strikes >= MAX_STRIKES) return socket.disconnect(true);
      return socket.emit('player:correct', { x: me.x, y: me.y });
    }
    budget -= dist;
    strikes = Math.max(0, strikes - 0.05);
    me.x = clamp(x);
    me.y = clamp(y);
    me.dir = dir || me.dir;
    socket.broadcast.emit('player:moved', { id: me.id, x: me.x, y: me.y, dir: me.dir });

    const tx = Math.floor(me.x / TILE);
    const ty = Math.floor(me.y / TILE);
    const key = `${tx},${ty}`;
    if (now >= immuneUntil && !battle && !starting) {
      for (const w of wilds.values()) {
        if (!w.busy && Math.hypot(me.x - w.x, me.y - w.y) < TOUCH_RADIUS) { startBattle(w); return; }
      }
    }
    if (key === lastTile) return;
    lastTile = key;
    if (tx >= CLEAR_MIN && tx <= CLEAR_MAX && ty >= CLEAR_MIN && ty <= CLEAR_MAX && now - lastHeal > 4000) {
      lastHeal = now;
      healParty();
    }
  });

  socket.on('disconnect', async () => {
    if (battle) releaseWild(battle.world);
    setBusy(false);
    players.delete(socket.id);
    io.emit('player:left', me.id);
    io.emit('online', players.size);
    await savePosition(me);
  });
});

// Persistência periódica (crash safety)
setInterval(() => players.forEach(savePosition), 15000);

async function main() {
  await prisma.$connect();
  console.log('Banco conectado');
  server.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error('Falha ao iniciar:', e.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await Promise.all([...players.values()].map(savePosition));
  process.exit(0);
});
