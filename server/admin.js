// Painel de administração (API REST /api/admin/*).
// Regras: toda rota exige JWT válido E papel 'admin' lido do BANCO a cada chamada (nada vem do cliente);
// admins não podem ser silenciados/banidos por outros admins; toda ação é registrada na auditoria (AdminLog).
const { SPECIES, WILD_TABLE, WATER_TABLE, MAX_LEVEL, calcStats } = require('../public/species.js');
const { BALLS } = require('../public/items.js');

const FOREVER = new Date('9999-12-31T00:00:00Z');
const MATERIALS = ['apricorns', 'shards'];
const WATER_ONLY = new Set(WATER_TABLE.map(([id]) => id).filter((id) => !WILD_TABLE.some(([w]) => w === id)));

module.exports = function registerAdmin(ctx) {
  const { app, prisma, auth, moderation, world, io, socketByUser, meByUser, isBusy, raidSys, teleportTo, nextFreeSlot, invOf, TILE } = ctx;
  const started = Date.now();
  const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // ---- acesso: JWT + papel admin conferido no banco a cada chamada ----
  const adminOnly = (req, res, next) => auth(req, res, async () => {
    try {
      const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, username: true, role: true } });
      if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores' });
      req.admin = u;
      next();
    } catch (e) {
      res.status(500).json({ error: 'Erro interno' });
    }
  });
  const route = (method, path, handler) => app[method]('/api/admin' + path, adminOnly, async (req, res) => {
    try { await handler(req, res); } catch (e) { console.error('[admin]', path, e); if (!res.headersSent) res.status(500).json({ error: 'Erro interno' }); }
  });
  const audit = (admin, action, target, details) => prisma.adminLog.create({
    data: { admin_id: admin.id, admin_name: admin.username, action, target: target || '', details: details ? JSON.stringify(details).slice(0, 500) : '' },
  }).catch((e) => console.error('[admin] falha ao registrar auditoria:', e.message));

  async function target(req, res, { allowAdmin = false, allowSelf = false } = {}) {
    const u = await prisma.user.findUnique({ where: { username: str(req.body?.username, 16) } });
    if (!u) { res.status(404).json({ error: 'Jogador não encontrado' }); return null; }
    if (!allowSelf && u.id === req.admin.id) { res.status(400).json({ error: 'Você não pode fazer isso consigo mesmo' }); return null; }
    if (!allowAdmin && u.role === 'admin') { res.status(400).json({ error: 'Não dá para aplicar isso a outro administrador' }); return null; }
    return u;
  }
  const untilOf = (b) => (b?.permanent === true ? FOREVER : int(b?.minutes, 1, 525600) ? new Date(Date.now() + b.minutes * 60000) : null);
  const say = (uid, msg) => socketByUser.get(uid)?.emit('notice', { msg });

  // ---------------- leitura ----------------
  route('get', '/state', async (req, res) => {
    const online = [...meByUser.values()].map((m) => ({
      id: m.id, username: m.username, role: m.role || 'player', tx: Math.floor(m.x / TILE), ty: Math.floor(m.y / TILE),
      combat: m.combat || null, muted: !!moderation.muteOf(m.id),
    })).sort((a, b) => a.username.localeCompare(b.username));
    let adminWilds = 0;
    for (const w of world.allWilds()) if (w.admin) adminWilds++;
    res.json({
      online,
      stats: { uptimeSec: Math.round((Date.now() - started) / 1000), online: online.length, wilds: world.allWilds().length, adminWilds, memMB: Math.round(process.memoryUsage().rss / 1048576), boss: raidSys.bossInfo() },
    });
  });

  route('get', '/users', async (req, res) => {
    const q = str(req.query.q, 16);
    const now = new Date();
    const rows = await prisma.user.findMany({
      where: q ? { username: { contains: q } } : {}, take: 30, orderBy: { id: 'asc' },
      select: { id: true, username: true, role: true, created_at: true, banned_until: true, ban_reason: true, muted_until: true, mute_reason: true, _count: { select: { pokemons: true } } },
    });
    res.json(rows.map((u) => ({
      id: u.id, username: u.username, role: u.role, created_at: u.created_at, pokemons: u._count.pokemons, online: meByUser.has(u.id),
      banned: !!(u.banned_until && u.banned_until > now), banned_until: u.banned_until, ban_reason: u.ban_reason,
      muted: !!(u.muted_until && u.muted_until > now), muted_until: u.muted_until, mute_reason: u.mute_reason,
    })));
  });

  route('get', '/log', async (req, res) => {
    res.json(await prisma.adminLog.findMany({ orderBy: { id: 'desc' }, take: 40 }));
  });

  // ---------------- moderação ----------------
  route('post', '/kick', async (req, res) => {
    const u = await target(req, res); if (!u) return;
    const s = socketByUser.get(u.id);
    if (!s) return res.status(409).json({ error: 'Jogador não está online' });
    s.emit('kicked', { reason: str(req.body.reason, 120) });
    setTimeout(() => s.disconnect(true), 200);
    await audit(req.admin, 'kick', u.username, { reason: str(req.body.reason, 120) });
    res.json({ ok: true });
  });

  route('post', '/mute', async (req, res) => {
    const u = await target(req, res); if (!u) return;
    const until = untilOf(req.body);
    if (!until) return res.status(400).json({ error: 'Informe a duração (minutos) ou permanente' });
    const reason = str(req.body.reason, 120);
    await prisma.user.update({ where: { id: u.id }, data: { muted_until: until, mute_reason: reason } });
    moderation.mute(u.id, until.getTime(), reason);
    say(u.id, '🔇 Você foi silenciado no chat ' + moderation.describe(moderation.muteOf(u.id)));
    await audit(req.admin, 'mute', u.username, { until, reason });
    res.json({ ok: true, until });
  });

  route('post', '/unmute', async (req, res) => {
    const u = await target(req, res, { allowAdmin: true }); if (!u) return;
    await prisma.user.update({ where: { id: u.id }, data: { muted_until: null, mute_reason: null } });
    moderation.unmute(u.id);
    say(u.id, '🔊 Você pode falar no chat novamente.');
    await audit(req.admin, 'unmute', u.username);
    res.json({ ok: true });
  });

  route('post', '/ban', async (req, res) => {
    const u = await target(req, res); if (!u) return;
    const until = untilOf(req.body);
    if (!until) return res.status(400).json({ error: 'Informe a duração (minutos) ou permanente' });
    const reason = str(req.body.reason, 120);
    await prisma.user.update({ where: { id: u.id }, data: { banned_until: until, ban_reason: reason } });
    moderation.ban(u.id, until.getTime(), reason);
    const s = socketByUser.get(u.id);
    if (s) { s.emit('banned', { reason, until }); setTimeout(() => s.disconnect(true), 300); }
    await audit(req.admin, 'ban', u.username, { until, reason });
    res.json({ ok: true, until });
  });

  route('post', '/unban', async (req, res) => {
    const u = await target(req, res, { allowAdmin: true }); if (!u) return;
    await prisma.user.update({ where: { id: u.id }, data: { banned_until: null, ban_reason: null } });
    moderation.unban(u.id);
    await audit(req.admin, 'unban', u.username);
    res.json({ ok: true });
  });

  // ---------------- mundo: spawn de Pokémon e boss ----------------
  route('post', '/spawn', async (req, res) => {
    const species_id = int(req.body.species_id, 1, 999);
    const level = int(req.body.level, 1, MAX_LEVEL);
    const count = int(req.body.count ?? 1, 1, 25);
    const ttl = int(req.body.ttl_min ?? 30, 1, 240);
    if (!species_id || !SPECIES[species_id] || !level || !count || !ttl) return res.status(400).json({ error: 'Espécie, nível (1-' + MAX_LEVEL + '), quantidade (1-25) ou duração inválidos' });
    if (SPECIES[species_id].rarity === 'legendary') return res.status(400).json({ error: 'Lendários só aparecem como boss: use "Chamar boss".' }); // nunca como selvagem
    let tx, ty;
    if (req.body.x != null && req.body.y != null) { tx = int(req.body.x, 0, 99); ty = int(req.body.y, 0, 99); if (tx == null || ty == null) return res.status(400).json({ error: 'Coordenadas inválidas (0 a 99)' }); }
    else {
      const me = meByUser.get(req.admin.id);
      if (!me) return res.status(409).json({ error: 'Entre no mundo para spawnar perto de você (ou informe x e y)' });
      tx = Math.floor(me.x / TILE); ty = Math.floor(me.y / TILE);
    }
    const water = req.body.water != null ? !!req.body.water : WATER_ONLY.has(species_id);
    const made = world.spawnAdminWild({ species_id, level, count, tx, ty, water, ttlMs: ttl * 60000 }, meByUser.get(req.admin.id)?.world);
    if (!made.length) return res.status(409).json({ error: 'Não achei espaço livre perto desse ponto' });
    await audit(req.admin, 'spawn', SPECIES[species_id].name, { level, count: made.length, tile: [tx, ty], water });
    res.json({ ok: true, created: made.length, ids: made.map((w) => w.id) });
  });

  route('post', '/clear-spawns', async (req, res) => {
    const n = world.clearAdminWilds();
    await audit(req.admin, 'clear-spawns', '', { removed: n });
    res.json({ ok: true, removed: n });
  });

  // ---------------- eventos (quiz etc.): iniciar agora, cancelar e ligar/desligar o agendamento automático ----------------
  route('get', '/events', async (req, res) => res.json(await ctx.events.summary()));
  route('post', '/events/start', async (req, res) => {
    const type = str(req.body.type, 20);
    const lobby = int(req.body.lobbySec, 10, 900) || 120;
    const r = ctx.events.start(type, { by: req.admin.username, lobbyMs: lobby * 1000 });
    if (r.error) return res.status(409).json({ error: r.error });
    await audit(req.admin, 'evento-iniciar', type, { lobby });
    res.json({ ok: true });
  });
  route('post', '/events/cancel', async (req, res) => {
    const r = ctx.events.cancel();
    if (r.error) return res.status(409).json({ error: r.error });
    await audit(req.admin, 'evento-cancelar', '');
    res.json({ ok: true });
  });
  route('post', '/events/auto', async (req, res) => {
    await ctx.events.setAuto(!!req.body.enabled);
    await audit(req.admin, 'evento-automatico', req.body.enabled ? 'ligado' : 'desligado');
    res.json({ ok: true });
  });

  route('post', '/boss', async (req, res) => {
    const species_id = req.body.species_id == null ? null : int(req.body.species_id, 1, 999);
    if (req.body.species_id != null && (!species_id || !SPECIES[species_id])) return res.status(400).json({ error: 'Espécie inválida' });
    const r = raidSys.adminSpawnBoss(species_id, str(req.body.world, 10));
    if (r.error) return res.status(409).json({ error: r.error });
    await audit(req.admin, 'boss', (species_id ? SPECIES[species_id].name : 'sorteio') + ' · ' + r.world);
    res.json({ ok: true });
  });

  // ---------------- dar Pokémon / itens, curar, teleporte, anúncio ----------------
  route('post', '/give-pokemon', async (req, res) => {
    const u = await target(req, res, { allowAdmin: true, allowSelf: true }); if (!u) return;
    const species_id = int(req.body.species_id, 1, 999);
    const level = int(req.body.level, 1, MAX_LEVEL);
    if (!species_id || !SPECIES[species_id] || !level) return res.status(400).json({ error: 'Espécie ou nível (1-' + MAX_LEVEL + ') inválido' });
    const st = calcStats(species_id, level);
    const slot = await nextFreeSlot(prisma, u.id);
    await prisma.pokemon.create({ data: { user_id: u.id, species_id, level, hp: st.hp, attack: st.attack, defense: st.defense, current_hp: st.hp, slot } });
    say(u.id, `🎁 Você recebeu um ${SPECIES[species_id].name} Lv.${level}${slot ? '' : ' (foi para o box)'}!`);
    ctx.afterGive?.(u.id);
    await audit(req.admin, 'give-pokemon', u.username, { species: SPECIES[species_id].name, level });
    res.json({ ok: true, inTeam: !!slot });
  });

  route('post', '/give-item', async (req, res) => {
    const u = await target(req, res, { allowAdmin: true, allowSelf: true }); if (!u) return;
    const item = str(req.body.item, 20);
    const amount = int(req.body.amount, 1, 999);
    const col = BALLS[item]?.col || (MATERIALS.includes(item) ? item : null);
    if (!col || !amount) return res.status(400).json({ error: 'Item ou quantidade (1-999) inválidos' });
    // durante uma batalha o servidor grava a contagem de bolas do jogador por cima: não dá para entregar agora
    if (isBusy(u.id)) return res.status(409).json({ error: 'O jogador está em combate; tente quando terminar' });
    const updated = await prisma.user.update({ where: { id: u.id }, data: { [col]: { increment: amount } } });
    socketByUser.get(u.id)?.emit('inventory', invOf(updated));
    say(u.id, `🎁 Você recebeu ${amount}× ${BALLS[item]?.name || (item === 'apricorns' ? 'Bolotas' : 'Fragmentos')}!`);
    await audit(req.admin, 'give-item', u.username, { item, amount });
    res.json({ ok: true });
  });

  route('post', '/heal', async (req, res) => {
    const u = await target(req, res, { allowAdmin: true, allowSelf: true }); if (!u) return;
    if (isBusy(u.id)) return res.status(409).json({ error: 'O jogador está em combate; tente quando terminar' });
    const all = await prisma.pokemon.findMany({ where: { user_id: u.id } });
    await prisma.$transaction(all.filter((p) => p.current_hp < p.hp).map((p) => prisma.pokemon.update({ where: { id: p.id }, data: { current_hp: p.hp } })));
    say(u.id, '💖 Sua equipe foi curada por um administrador.');
    await audit(req.admin, 'heal', u.username);
    res.json({ ok: true });
  });

  route('post', '/teleport', async (req, res) => {
    const adminMe = meByUser.get(req.admin.id);
    if (!adminMe) return res.status(409).json({ error: 'Entre no mundo para se teletransportar' });
    if (req.body.mode === 'xy') {
      const tx = int(req.body.x, 0, 99), ty = int(req.body.y, 0, 99);
      if (tx == null || ty == null || !world.isWalkable(tx, ty, adminMe?.world)) return res.status(400).json({ error: 'Ponto inválido ou bloqueado' });
      if (isBusy(req.admin.id)) return res.status(409).json({ error: 'Você está em combate' });
      teleportTo(req.admin.id, tx * TILE + TILE / 2, ty * TILE + TILE / 2);
      await audit(req.admin, 'teleport', 'xy', { tx, ty });
      return res.json({ ok: true });
    }
    const u = await target(req, res, { allowAdmin: true }); if (!u) return;
    const them = meByUser.get(u.id);
    if (!them) return res.status(409).json({ error: 'Jogador não está online' });
    if (req.body.mode === 'bring') {
      if (isBusy(u.id)) return res.status(409).json({ error: 'O jogador está em combate' });
      teleportTo(u.id, adminMe.x, adminMe.y, adminMe.world);
      say(u.id, '✨ Um administrador puxou você até ele.');
    } else {
      if (isBusy(req.admin.id)) return res.status(409).json({ error: 'Você está em combate' });
      teleportTo(req.admin.id, them.x, them.y, them.world);
    }
    await audit(req.admin, req.body.mode === 'bring' ? 'bring' : 'teleport-to', u.username);
    res.json({ ok: true });
  });

  route('post', '/announce', async (req, res) => {
    const text = str(req.body.text, 200);
    if (!text) return res.status(400).json({ error: 'Escreva o aviso' });
    io.emit('notice', { msg: '📢 ' + text, big: true });
    await audit(req.admin, 'announce', '', { text });
    res.json({ ok: true });
  });
};
