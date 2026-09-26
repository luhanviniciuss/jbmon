require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const { MAP_W, TILE, PLAYER_SPEED, CLEAR_MIN, CLEAR_MAX, GYM, LABS, PORTAL, ARRIVE, GYM_EXIT, WORLDS, WORLD_IDS, generateMap } = require('../public/map.js');
const createWorld = require('./world.js');
const { SPECIES, WILD_TABLE, WATER_TABLE, calcStats, minLevel } = require('../public/species.js');
const { BALLS, RECIPES } = require('../public/items.js');
const { pickSpecies, makeWild, resolveTurn, mineView, wildView, teamView } = require('./battle.js');
const createRaidSystem = require('./raid.js');
const createChat = require('./chat.js');
const createModeration = require('./moderation.js');
const createClans = require('./clan.js');
const createPvp = require('./pvp.js');
const { biomeAt } = require('./biome.js');
const createVoip = require('./voip.js');
const registerAdmin = require('./admin.js');
const { retry, durable, flushPending, pendingCount } = require('./durable.js');
const { loadTeam, nextFreeSlot, partyOf } = require('./team.js');
const { startBackups } = require('./backup.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const MAP_PX = MAP_W * TILE;
const MAP = generateMap('route');
const SPAWN = { x: 1600, y: 1600 };

// Anti-cheat: orçamento de distância que recarrega com a velocidade máxima (+25% de tolerância)
const MAX_SPEED = PLAYER_SPEED * 1.25;
const BUDGET_CAP = 48; // px de rajada permitida (jitter de rede)
const MAX_STRIKES = 20;

// Encontros
const STARTERS = [1, 4, 7]; // Bulbasaur, Charmander, Squirtle
const WILD_COUNT = 70;
const WATER_COUNT = 24;
const WATER_TOUCH = 50; // px: Pokémon na água são alcançados da margem
const WILD_WANDER = 3; // tiles de distância máxima do "lar"
const TOUCH_RADIUS = 28; // px: encostar num selvagem inicia a batalha
const RESPAWN_MS = 15000;
const IMMUNE_MS = 4000; // após uma batalha, ninguém te puxa de novo
const ACTIONS = ['attack', 'strong', 'run', ...Object.keys(BALLS).map((k) => 'ball:' + k)];
const LEVEL_BONUS = { common: 0, uncommon: 1, rare: 2, epic: 4, legendary: 0 };
const LAB_HEAL_MS = 15000; // tempo da cura no laboratório
const HEAL_BALLS = 10; // o Centro Pokémon repõe até esta quantidade

const prisma = new PrismaClient();
const moderation = createModeration(prisma);
// Nomes que jogadores comuns não podem registrar (evita se passar por administração no chat)
const RESERVED_NAMES = /^(admin|administrador|administrator|adm|moderador|moderator|mod|gm|staff|system|sistema|root|suporte|support)$/i;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Mundos (Rota, Cidade, Gelo, Lava): cada um com seu mapa e seus Pokémon selvagens ----------
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const inClearing = (tx, ty) => tx >= CLEAR_MIN - 1 && tx <= CLEAR_MAX + 1 && ty >= CLEAR_MIN - 1 && ty <= CLEAR_MAX + 1;
let nextWildId = 1;
const W = {}; // id do mundo -> mundo
for (const wid of WORLD_IDS) W[wid] = createWorld({ io, id: wid, MAP: wid === 'route' ? MAP : generateMap(wid), newId: () => nextWildId++ });
const releaseWild = (w) => W[w.worldId].releaseWild(w);
const defeatWild = (w) => W[w.worldId].defeatWild(w);
const isBlocked = (x, y, world = 'route') => W[world].isBlocked(x, y);
const allWilds = () => WORLD_IDS.flatMap((wid) => [...W[wid].wilds.values()]);

const invOf = (u) => ({ poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs });
const matsOf = (u) => ({ apricorns: u.apricorns, shards: u.shards });
const battlingUsers = new Set(); // ids em batalha (bloqueia o craft)

// Health check (monitoramento/proxy): 200 só se o banco responder
app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, players: players.size, wilds: allWilds().length });
  } catch (e) {
    res.status(503).json({ ok: false });
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- REST ----------
const signToken = (user) => jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const ban = moderation.banOf(req.user.id);
    if (ban) return res.status(403).json({ error: 'Conta banida ' + moderation.describe(ban) });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(username) || password.length < 4) {
    return res.status(400).json({ error: 'Usuário: 3 a 16 letras, números ou _. Senha: mínimo 4 caracteres' });
  }
  try {
    if (RESERVED_NAMES.test(username)) return res.status(400).json({ error: 'Esse nome é reservado. Escolha outro.' });
    const sid = STARTERS[Math.floor(Math.random() * STARTERS.length)];
    const st = calcStats(sid, 5);
    const user = await prisma.user.create({
      data: {
        username,
        password_hash: await bcrypt.hash(password, 10),
        pokemons: { create: { species_id: sid, level: 5, hp: st.hp, attack: st.attack, defense: st.defense, current_hp: st.hp, slot: 1 } },
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
  const ban = moderation.banOf(user.id);
  if (ban) return res.status(403).json({ error: 'Conta banida ' + moderation.describe(ban) });
  res.json({ token: signToken(user), username: user.username, role: user.role });
});

app.get('/api/party', auth, async (req, res) => {
  const [{ party, box }, user] = await Promise.all([partyOf(prisma, req.user.id), prisma.user.findUnique({ where: { id: req.user.id } })]);
  res.json({ party, box, balls: invOf(user) });
});

// Define a equipe: lista ordenada de 1 a 6 ids de Pokémon do jogador; quem não estiver na lista vai para o box.
app.post('/api/party/set', auth, async (req, res) => {
  const ids = req.body?.team;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 6 || ids.some((n) => !Number.isInteger(n)) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'A equipe precisa ter de 1 a 6 Pokémon diferentes' });
  }
  if (battlingUsers.has(req.user.id)) return res.status(409).json({ error: 'Não dá para mudar a equipe durante uma batalha' });
  const owned = await prisma.pokemon.count({ where: { user_id: req.user.id, id: { in: ids } } });
  if (owned !== ids.length) return res.status(400).json({ error: 'Pokémon inválido' });
  await retry(() => prisma.$transaction([
    prisma.pokemon.updateMany({ where: { user_id: req.user.id }, data: { slot: null } }),
    ...ids.map((id, i) => prisma.pokemon.update({ where: { id }, data: { slot: i + 1 } })),
  ]));
  const { party, box } = await partyOf(prisma, req.user.id);
  res.json({ party, box });
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
  const { count } = await retry(() => prisma.user.updateMany({ where: { id: req.user.id, apricorns: { gte: cost.apricorns }, shards: { gte: cost.shards } }, data }));
  if (!count) return res.status(400).json({ error: 'Materiais insuficientes' });
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ balls: invOf(user), mats: matsOf(user) });
});

// ---------- Socket.io ----------
const players = new Map(); // socket.id -> { id, username, x, y, dir }
const clamp = (v) => Math.max(0, Math.min(MAP_PX, Number(v) || 0));

async function savePosition(p, force = false) {
  if (!force && p.sx === p.x && p.sy === p.y) return; // só grava se mudou desde a última vez
  const { x, y } = p;
  try {
    await retry(() => prisma.user.update({ where: { id: p.id }, data: { x, y, world: p.world } }));
    p.sx = x;
    p.sy = y;
  } catch (e) {
    console.error('Falha ao salvar posição', e.message);
  }
}

const socketByUser = new Map(); // uid -> socket
// Avisa todos os jogadores quando alguém entra/sai de combate (aparece acima do nome dele)
function markCombat(uid, kind) {
  const me = meByUser.get(uid);
  const next = kind || null;
  if (!me || me.combat === next) return;
  me.combat = next;
  io.emit('player:combat', { id: uid, combat: next });
}
const meByUser = new Map(); // uid -> { id, username, x, y }
// Troca o jogador de mundo: sai da sala do mundo antigo, entra na do novo e recebe jogadores e selvagens de lá.
function changeWorld(uid, worldId, x, y) {
  const me = meByUser.get(uid);
  const sock = socketByUser.get(uid);
  if (!me || !sock || !W[worldId]) return false;
  if (me.world === worldId) return teleportTo(uid, x, y);
  sock.to('w:' + me.world).emit('player:left', me.id, true);
  sock.leave('w:' + me.world);
  me.world = worldId;
  me.x = x;
  me.y = y;
  me.hidden = false;
  me.inside = null;
  sock.join('w:' + worldId);
  sock.to('w:' + worldId).emit('player:joined', me, true);
  sock.emit('world:enter', { world: worldId, x, y, others: [...players.values()].filter((p) => p.world === worldId && p.id !== me.id), wilds: W[worldId].publicList() });
  savePosition(me, true);
  return true;
}
function teleportTo(uid, x, y, worldId) {
  const me = meByUser.get(uid);
  if (!me) return false;
  if (worldId && worldId !== me.world) return changeWorld(uid, worldId, x, y);
  me.x = x;
  me.y = y;
  const sock = socketByUser.get(uid);
  sock?.emit('player:correct', { x, y });
  sock?.to('w:' + me.world).emit('player:moved', { id: me.id, x, y, dir: me.dir });
  savePosition(me, true);
  return true;
}
const teleportHome = (uid) => teleportTo(uid, SPAWN.x, SPAWN.y, 'route');
const raidSys = createRaidSystem({
  io, prisma, MAP, socketByUser, meByUser, teleportHome,
  clearing: inClearing,
  isBusy: (uid) => battlingUsers.has(uid) || !!meByUser.get(uid)?.hidden,
  setBusy: (uid, v) => { v ? battlingUsers.add(uid) : battlingUsers.delete(uid); markCombat(uid, v ? 'raid' : null); }, // usado pela raid
});

registerAdmin({
  app, prisma, auth, moderation, io, socketByUser, meByUser, raidSys, teleportTo, nextFreeSlot, invOf, TILE,
  isBusy: (uid) => battlingUsers.has(uid),
  world: {
    allWilds,
    spawnAdminWild: (opts, wid) => W[W[wid] ? wid : 'route'].spawnAdminWild(opts),
    clearAdminWilds: () => WORLD_IDS.reduce((n, wid) => n + W[wid].clearAdminWilds(), 0),
    isWalkable: (tx, ty, wid) => W[W[wid] ? wid : 'route'].isWalkable(tx, ty),
  },
});

const clans = createClans({ app, prisma, auth, io, socketByUser, meByUser });
const pvp = createPvp({
  biomeOf: (uid) => { const m = meByUser.get(uid); if (!m) return 'field'; return WORLDS[m.world]?.biome || biomeAt(MAP, TILE, m.x, m.y, { town: inClearing(Math.floor(m.x / TILE), Math.floor(m.y / TILE)) }); },
  app, prisma, auth, io, socketByUser, meByUser, loadTeam, durable, markCombat,
  groupInfo: raidSys.groupInfo, clanSync: clans.refreshClan,
  isBusy: (uid) => battlingUsers.has(uid) || raidSys.inRaid(uid) || !!meByUser.get(uid)?.hidden,
  setBusy: (uid, v) => (v ? battlingUsers.add(uid) : battlingUsers.delete(uid)),
});
const voip = createVoip({ socketByUser, groupInfo: raidSys.groupInfo });
const chat = createChat({ io, socketByUser, meByUser, groupMembers: raidSys.groupMembers, clanMembers: clans.clanMembersOnline, moderation });

io.use(async (socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return next(new Error('Usuário não encontrado'));
    const ban = moderation.banOf(user.id);
    if (ban) return next(new Error('Conta banida ' + moderation.describe(ban)));
    socket.data.user = user;
    socket.data.clan = user.clan_id ? await prisma.clan.findUnique({ where: { id: user.clan_id }, select: { id: true, tag: true, name: true } }) : null;
    next();
  } catch {
    next(new Error('Não autenticado'));
  }
});

io.on('connection', (socket) => {
  const u = socket.data.user;

  // Evita sessão duplicada da mesma conta
  for (const [sid, p] of players) if (p.id === u.id) io.sockets.sockets.get(sid)?.disconnect(true);

  const me = { id: u.id, username: u.username, x: u.x, y: u.y, dir: 'down', combat: null, hidden: false, inside: null, world: WORLDS[u.world] ? u.world : 'route', role: u.role, clan: socket.data.clan ? { ...socket.data.clan, role: u.clan_role } : null };
  if (W[me.world].isBlocked(me.x, me.y)) { const sp = WORLDS[me.world].spawn; me.x = sp.x; me.y = sp.y; }
  players.set(socket.id, me);
  socketByUser.set(u.id, socket);
  meByUser.set(u.id, me);
  socket.join('w:' + me.world);
  raidSys.bind(socket, u.id);
  chat.bind(socket, u.id);
  pvp.bind(socket, u.id);
  voip.bind(socket, u.id);

  socket.emit('players:init', {
    self: me,
    balls: invOf(u),
    mats: matsOf(u),
    others: [...players.entries()].filter(([sid, p]) => sid !== socket.id && p.world === me.world).map(([, p]) => p),
  });
  socket.emit('wild:list', W[me.world].publicList());
  socket.to('w:' + me.world).emit('player:joined', me);
  io.emit('online', players.size);

  // ----- Batalha (estado autoritativo no servidor) -----
  let battle = null; // { team, mine, wild, world, inv }
  const setBusy = (v) => (v ? battlingUsers.add(u.id) : battlingUsers.delete(u.id));
  let starting = false;
  let acting = false;
  let lastTile = '';
  let immuneUntil = 0;

  const persist = async (b, drops, capture) => {
    const slot = capture ? await nextFreeSlot(prisma, u.id) : null; // vaga na equipe ou box
    return prisma.$transaction([
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
      ...(capture ? [prisma.pokemon.create({ data: { user_id: u.id, ...capture, slot } })] : []),
    ]);
  };

  async function startBattle(w) {
    starting = true;
    setBusy(true);
    markCombat(u.id, 'wild');
    w.busy = true;
    io.to('w:' + w.worldId).emit('wild:remove', w.id);
    try {
      const team = await loadTeam(prisma, u.id);
      const mine = team.find((p) => p.current_hp > 0);
      const fresh = await prisma.user.findUnique({ where: { id: u.id } });
      if (!mine || socket.disconnected) return releaseWild(w);
      battle = { team, mine, world: w, wild: makeWild(w.species_id, w.level), inv: invOf(fresh) };
      socket.emit('battle:start', { biome: WORLDS[w.worldId].biome || biomeAt(MAP, TILE, w.x, w.y, { water: !!w.water }), wild: wildView(battle.wild), mine: mineView(mine), balls: battle.inv, team: team.map(mineView) });
    } catch (err) {
      console.error('Falha ao iniciar batalha', err.message);
      releaseWild(w);
    } finally {
      starting = false;
      if (!battle) { setBusy(false); markCombat(u.id, null); }
    }
  }

  // ----- Interiores: laboratório do Centro Pokémon (cura de 15 s) e ginásio (portais para os outros mundos).
  // O servidor manda: confere a porta, roda o temporizador e só então grava a cura. Dentro de um interior o jogador some do mapa.
  const doorOf = (b) => ({ x: (b.doorX + 0.5) * TILE, y: (b.doorY + 0.5) * TILE });
  const exitOf = (b) => ({ x: (b.doorX + 0.5) * TILE, y: (b.doorY + 1.5) * TILE }); // logo abaixo da porta
  let labTimer = null;
  let labBusy = false;

  async function healNow() {
    const [all, usr] = await Promise.all([
      prisma.pokemon.findMany({ where: { user_id: u.id } }),
      prisma.user.findUnique({ where: { id: u.id } }),
    ]);
    const hurt = all.filter((p) => p.current_hp < p.hp);
    const pokeballs = Math.max(usr.pokeballs, HEAL_BALLS);
    await durable('cura', () => prisma.$transaction([
      ...hurt.map((p) => prisma.pokemon.update({ where: { id: p.id }, data: { current_hp: p.hp } })),
      prisma.user.update({ where: { id: u.id }, data: { pokeballs } }),
    ]));
    return { healed: hurt.length, balls: invOf({ ...usr, pokeballs }) };
  }

  function enterInterior(kind, b) {
    if (me.hidden || battle || starting || raidSys.inRaid(u.id) || pvp.inMatch(u.id)) return false;
    const d = doorOf(b);
    if (Math.hypot(me.x - d.x, me.y - d.y) > TILE * 1.3) return false; // precisa estar na porta
    const ex = exitOf(b);
    me.hidden = true;
    me.inside = kind;
    me.x = ex.x; // ao sair (ou reconectar) aparece na frente da porta, nunca dentro do prédio
    me.y = ex.y;
    socket.to('w:' + me.world).emit('player:hide', { id: me.id, hidden: true });
    savePosition(me, true);
    return true;
  }

  function leaveInterior(kind, ev) {
    if (!me.hidden || me.inside !== kind) return;
    if (labTimer) socket.emit('notice', { msg: 'Cura cancelada: você saiu do laboratório.' });
    clearTimeout(labTimer);
    labTimer = null;
    const ex = exitOf(kind === 'lab' ? LABS[me.world] : GYM);
    me.hidden = false;
    me.inside = null;
    immuneUntil = Date.now() + IMMUNE_MS;
    socket.to('w:' + me.world).emit('player:hide', { id: me.id, hidden: false });
    teleportTo(u.id, ex.x, ex.y);
    socket.emit(ev);
  }

  socket.on('lab:enter', () => { const b = LABS[me.world]; if (b && enterInterior('lab', b)) socket.emit('lab:entered'); });
  socket.on('lab:exit', () => leaveInterior('lab', 'lab:exited'));
  socket.on('gym:enter', () => { if (me.world === 'route' && enterInterior('gym', GYM)) socket.emit('gym:entered'); });
  socket.on('gym:exit', () => leaveInterior('gym', 'gym:exited'));
  socket.on('gym:travel', (dest) => { // portal do ginásio -> outro mundo
    if (me.inside !== 'gym' || !['town', 'ice', 'lava'].includes(dest)) return;
    immuneUntil = Date.now() + IMMUNE_MS;
    socket.emit('gym:left');
    changeWorld(u.id, dest, ARRIVE.x, ARRIVE.y);
  });

  socket.on('lab:heal', async () => {
    if (!me.hidden || me.inside !== 'lab' || labTimer || labBusy) return;
    labBusy = true;
    try {
      const team = await loadTeam(prisma, u.id);
      if (!team.length) return socket.emit('notice', { msg: 'Você não tem Pokémon na equipe.' });
      const [all, usr] = await Promise.all([prisma.pokemon.findMany({ where: { user_id: u.id } }), prisma.user.findUnique({ where: { id: u.id } })]);
      if (!all.some((p) => p.current_hp < p.hp) && usr.pokeballs >= HEAL_BALLS) return socket.emit('lab:healed', { already: true, balls: invOf(usr) });
      socket.emit('lab:healing', { ms: LAB_HEAL_MS });
      labTimer = setTimeout(async () => {
        labTimer = null;
        if (!me.hidden || me.inside !== 'lab' || socket.disconnected) return; // saiu no meio: cura cancelada
        try { socket.emit('lab:healed', await healNow()); } catch (e) { console.error('Falha ao curar', e.message); socket.emit('notice', { msg: 'Falha ao curar. Tente de novo.' }); }
      }, LAB_HEAL_MS);
    } catch (e) {
      console.error('Falha ao iniciar cura', e.message);
    } finally {
      labBusy = false;
    }
  });

  socket.on('battle:action', async (type) => {
    if (!battle || acting || !(ACTIONS.includes(type) || /^switch:\d+$/.test(type))) return;
    acting = true;
    try {
      const b = battle;
      const r = resolveTurn(b, type);
      if (r.result === 'lose') {
        b.team.forEach((p) => (p.current_hp = p.hp)); // desmaiou: cura e volta ao Centro
        if (me.world === 'route') { me.x = SPAWN.x; me.y = SPAWN.y; }
      }
      // Tudo do turno (HP/EXP/evolução, bolas gastas, materiais e o Pokémon capturado) numa transação só,
      // gravada ANTES de avisar o jogador do resultado.
      await durable('batalha', () => persist(b, r.drops, r.capture));
      if (r.result === 'lose') await savePosition(me, true);

      socket.emit('battle:update', { log: r.log, result: r.result, team: teamView(b), forceSwitch: !!b.forceSwitch, balls: b.inv, drops: r.drops || null, capture: r.capture ? { species_id: r.capture.species_id } : null });
      if (r.result) {
        if (r.result === 'win' || r.result === 'caught') defeatWild(b.world);
        else releaseWild(b.world);
        immuneUntil = Date.now() + IMMUNE_MS;
        battle = null;
        setBusy(false);
        markCombat(u.id, null);
        lastTile = '';
        if (r.result === 'lose') {
          if (me.world !== 'route') changeWorld(u.id, 'route', SPAWN.x, SPAWN.y); // derrota nos mundos extras: volta ao Centro da Rota
          else {
            socket.emit('player:correct', { x: me.x, y: me.y });
            socket.to('w:' + me.world).emit('player:moved', { id: me.id, x: me.x, y: me.y, dir: me.dir });
          }
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
    if (!Number.isFinite(x) || !Number.isFinite(y) || me.hidden) return;
    if (battle || starting || raidSys.inRaid(u.id) || pvp.inMatch(u.id)) return socket.emit('player:correct', { x: me.x, y: me.y }); // parado em batalha

    const dist = Math.hypot(x - me.x, y - me.y);
    if (dist > budget || W[me.world].isBlocked(x, y)) {
      // Movimento impossível: ignora e devolve a posição autoritativa ao cliente
      if (++strikes >= MAX_STRIKES) return socket.disconnect(true);
      return socket.emit('player:correct', { x: me.x, y: me.y });
    }
    budget -= dist;
    strikes = Math.max(0, strikes - 0.05);
    me.x = clamp(x);
    me.y = clamp(y);
    me.dir = dir || me.dir;
    socket.to('w:' + me.world).emit('player:moved', { id: me.id, x: me.x, y: me.y, dir: me.dir });

    const tx = Math.floor(me.x / TILE);
    const ty = Math.floor(me.y / TILE);
    const key = `${tx},${ty}`;
    if (me.world !== 'route' && tx === PORTAL.tx && ty === PORTAL.ty) { // portal de volta: leva para a frente do ginásio, na Rota
      immuneUntil = now + IMMUNE_MS;
      changeWorld(u.id, 'route', GYM_EXIT.x, GYM_EXIT.y);
      return;
    }
    raidSys.onMove(u.id);
    if (now >= immuneUntil && !battle && !starting && !raidSys.inRaid(u.id)) {
      for (const w of W[me.world].wilds.values()) {
        if (!w.busy && Math.hypot(me.x - w.x, me.y - w.y) < (w.water ? WATER_TOUCH : TOUCH_RADIUS)) { startBattle(w); return; }
      }
    }
  });

  socket.on('disconnect', async () => {
    clearTimeout(labTimer);
    voip.onDisconnect(u.id); // antes do grupo desfazer, para avisar os pares
    raidSys.onDisconnect(u.id);
    pvp.onDisconnect(u.id);
    if (battle) releaseWild(battle.world);
    if (socketByUser.get(u.id) === socket) { socketByUser.delete(u.id); meByUser.delete(u.id); }
    setBusy(false);
    players.delete(socket.id);
    io.to('w:' + me.world).emit('player:left', me.id);
    io.emit('online', players.size);
    await savePosition(me, true);
  });
});

// Persistência periódica (crash safety)
setInterval(() => players.forEach((p) => savePosition(p)), 5000);

// SQLite: WAL + synchronous=FULL = cada commit vai para o disco, mesmo se o processo/PC cair.
async function tuneDatabase() {
  try {
    const [j] = await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await prisma.$queryRawUnsafe('PRAGMA synchronous=FULL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout=10000');
    console.log(`SQLite: journal_mode=${j?.journal_mode}, synchronous=FULL`);
  } catch (e) {
    console.error('Não foi possível ajustar o SQLite:', e.message);
  }
}

async function main() {
  await prisma.$connect();
  console.log('Banco conectado');
  await tuneDatabase();
  console.log('Moderação: ' + (await moderation.load()) + ' punição(ões) ativa(s) carregada(s)');
  startBackups(prisma);
  server.listen(PORT, '0.0.0.0', () => console.log(`Servidor em http://localhost:${PORT}`));
}
main().catch((e) => {
  console.error('Falha ao iniciar:', e.message);
  process.exit(1);
});

// Desligamento seguro: grava posições, esvazia a fila de gravações pendentes e fecha o banco.
let closing = false;
async function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`${sig}: salvando tudo antes de sair…`);
  try {
    await Promise.all([...players.values()].map((p) => savePosition(p, true)));
    await flushPending();
    if (pendingCount()) console.error(`Atenção: ${pendingCount()} gravação(ões) pendente(s) não puderam ser salvas`);
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await prisma.$disconnect();
  } catch (e) {
    console.error('Erro ao desligar:', e.message);
  }
  process.exit(0);
}
['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((sig) => process.on(sig, () => shutdown(sig)));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
