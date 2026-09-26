// Clãs: criar, convidar, cargos (líder > oficial > membro), sair/expulsar, ranking e alvos de guerra.
// Regras de permissão sempre conferidas AQUI no servidor, lendo o cargo do banco (o cliente só pede).
const MAX_MEMBERS = 30;
const RESERVED = /admin|moderador|staff|sistema|system|root|suporte/i;
const RANK = { member: 1, officer: 2, leader: 3 };

module.exports = function createClans(ctx) {
  const { app, prisma, auth, io, socketByUser, meByUser } = ctx;
  const invites = new Map(); // uid convidado -> { clanId, from, exp }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const routes = (method, path, fn) => app[method]('/api/clan' + path, auth, async (req, res) => {
    try { await fn(req, res); } catch (e) { console.error('[clan]', path, e); if (!res.headersSent) res.status(500).json({ error: 'Erro interno' }); }
  });
  const me = (uid) => prisma.user.findUnique({ where: { id: uid }, select: { id: true, username: true, clan_id: true, clan_role: true } });
  const fail = (res, code, error) => res.status(code).json({ error });
  const onlineOfClan = (clanId) => [...meByUser.values()].filter((m) => m.clan?.id === clanId).map((m) => m.id);
  const tell = (uid, msg) => socketByUser.get(uid)?.emit('notice', { msg });

  // Atualiza o que os outros jogadores veem (tag ao lado do nome) e o painel do próprio clã
  async function sync(uid) {
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { clan_id: true, clan_role: true, clan: { select: { id: true, tag: true, name: true } } } });
    const m = meByUser.get(uid);
    if (m) {
      m.clan = u?.clan ? { ...u.clan, role: u.clan_role } : null;
      io.emit('player:clan', { id: uid, clan: m.clan ? { tag: m.clan.tag, name: m.clan.name } : null });
    }
    socketByUser.get(uid)?.emit('clan:update');
  }
  const refreshClan = (clanId) => onlineOfClan(clanId).forEach((id) => socketByUser.get(id)?.emit('clan:update'));

  // ---------------- consulta ----------------
  routes('get', '/me', async (req, res) => {
    const u = await me(req.user.id);
    if (!u.clan_id) return res.json({ clan: null, invite: invites.get(u.id) && invites.get(u.id).exp > Date.now() ? { from: invites.get(u.id).from } : null });
    const clan = await prisma.clan.findUnique({ where: { id: u.clan_id }, include: { members: { select: { id: true, username: true, clan_role: true, pvp_rating: true }, orderBy: { id: 'asc' } } } });
    const members = clan.members.map((m) => ({ id: m.id, username: m.username, role: m.clan_role, rating: m.pvp_rating, online: meByUser.has(m.id) }))
      .sort((a, b) => RANK[b.role] - RANK[a.role] || Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
    res.json({ clan: { id: clan.id, name: clan.name, tag: clan.tag, points: clan.points, wins: clan.wins, losses: clan.losses, created_at: clan.created_at }, role: u.clan_role, members, max: MAX_MEMBERS });
  });

  routes('get', '/top', async (req, res) => {
    const rows = await prisma.clan.findMany({ orderBy: [{ points: 'desc' }, { wins: 'desc' }], take: 20, include: { _count: { select: { members: true } } } });
    res.json(rows.map((c, i) => ({ pos: i + 1, id: c.id, name: c.name, tag: c.tag, points: c.points, wins: c.wins, losses: c.losses, members: c._count.members })));
  });

  // Clãs de outros que têm um oficial/líder online (candidatos a guerra)
  routes('get', '/war-targets', async (req, res) => {
    const mine = meByUser.get(req.user.id)?.clan;
    const map = new Map();
    for (const m of meByUser.values()) {
      if (!m.clan || m.clan.id === mine?.id || RANK[m.clan.role] < RANK.officer) continue;
      const e = map.get(m.clan.id) || { id: m.clan.id, name: m.clan.name, tag: m.clan.tag, leaders: [] };
      e.leaders.push(m.username);
      map.set(m.clan.id, e);
    }
    res.json([...map.values()]);
  });

  // ---------------- criar / convidar ----------------
  routes('post', '/create', async (req, res) => {
    const u = await me(req.user.id);
    if (u.clan_id) return fail(res, 409, 'Você já está em um clã. Saia dele antes de criar outro.');
    const name = str(req.body?.name, 16);
    const tag = str(req.body?.tag, 4).toUpperCase();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return fail(res, 400, 'Nome do clã: 3 a 16 letras, números ou _');
    if (!/^[A-Z0-9]{2,4}$/.test(tag)) return fail(res, 400, 'Tag do clã: 2 a 4 letras ou números');
    if (RESERVED.test(name) || RESERVED.test(tag)) return fail(res, 400, 'Esse nome/tag é reservado');
    try {
      const clan = await prisma.clan.create({ data: { name, name_key: name.toLowerCase(), tag } });
      await prisma.user.update({ where: { id: u.id }, data: { clan_id: clan.id, clan_role: 'leader' } });
      await sync(u.id);
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 'P2002') return fail(res, 409, 'Já existe um clã com esse nome ou tag');
      throw e;
    }
  });

  routes('post', '/invite', async (req, res) => {
    const u = await me(req.user.id);
    if (!u.clan_id || RANK[u.clan_role] < RANK.officer) return fail(res, 403, 'Só líder e oficiais convidam');
    const target = [...meByUser.values()].find((m) => m.username.toLowerCase() === str(req.body?.username, 16).toLowerCase());
    if (!target) return fail(res, 404, 'Jogador não encontrado (ele precisa estar online)');
    if (target.clan) return fail(res, 409, target.username + ' já está em um clã');
    const count = await prisma.user.count({ where: { clan_id: u.clan_id } });
    if (count >= MAX_MEMBERS) return fail(res, 409, 'O clã está cheio (' + MAX_MEMBERS + ' membros)');
    const clan = await prisma.clan.findUnique({ where: { id: u.clan_id } });
    invites.set(target.id, { clanId: clan.id, from: u.username, tag: clan.tag, name: clan.name, exp: Date.now() + 60000 });
    socketByUser.get(target.id)?.emit('clan:invited', { from: u.username, name: clan.name, tag: clan.tag });
    res.json({ ok: true });
  });

  routes('post', '/respond', async (req, res) => {
    const inv = invites.get(req.user.id);
    invites.delete(req.user.id);
    if (!req.body?.accept) return res.json({ ok: true });
    if (!inv || inv.exp < Date.now()) return fail(res, 410, 'Convite expirado');
    const u = await me(req.user.id);
    if (u.clan_id) return fail(res, 409, 'Você já está em um clã');
    const count = await prisma.user.count({ where: { clan_id: inv.clanId } });
    if (count >= MAX_MEMBERS) return fail(res, 409, 'O clã está cheio');
    await prisma.user.update({ where: { id: u.id }, data: { clan_id: inv.clanId, clan_role: 'member' } });
    await sync(u.id);
    onlineOfClan(inv.clanId).forEach((id) => id !== u.id && tell(id, `🏰 ${u.username} entrou no clã!`));
    refreshClan(inv.clanId);
    res.json({ ok: true });
  });

  // ---------------- sair / expulsar / cargos ----------------
  async function leaveOrRemove(uid, clanId, res) {
    await prisma.user.update({ where: { id: uid }, data: { clan_id: null, clan_role: 'member' } });
    await sync(uid);
    refreshClan(clanId);
    const left = await prisma.user.count({ where: { clan_id: clanId } });
    if (!left) await prisma.clan.delete({ where: { id: clanId } }).catch(() => {}); // clã vazio é apagado
    res.json({ ok: true });
  }

  routes('post', '/leave', async (req, res) => {
    const u = await me(req.user.id);
    if (!u.clan_id) return fail(res, 409, 'Você não está em um clã');
    const count = await prisma.user.count({ where: { clan_id: u.clan_id } });
    if (u.clan_role === 'leader' && count > 1) return fail(res, 409, 'Passe a liderança a outro membro ou dissolva o clã antes de sair');
    await leaveOrRemove(u.id, u.clan_id, res);
  });

  async function targetMember(req, res, u) {
    const t = await prisma.user.findUnique({ where: { username: str(req.body?.username, 16) }, select: { id: true, username: true, clan_id: true, clan_role: true } });
    if (!t || t.clan_id !== u.clan_id) { fail(res, 404, 'Esse jogador não é do seu clã'); return null; }
    if (t.id === u.id) { fail(res, 400, 'Você não pode fazer isso consigo mesmo'); return null; }
    return t;
  }

  routes('post', '/kick', async (req, res) => {
    const u = await me(req.user.id);
    if (!u.clan_id || RANK[u.clan_role] < RANK.officer) return fail(res, 403, 'Sem permissão');
    const t = await targetMember(req, res, u); if (!t) return;
    if (RANK[t.clan_role] >= RANK[u.clan_role]) return fail(res, 403, 'Você só expulsa quem tem cargo menor que o seu');
    tell(t.id, '🏰 Você foi expulso do clã.');
    await leaveOrRemove(t.id, u.clan_id, res);
  });

  routes('post', '/role', async (req, res) => {
    const u = await me(req.user.id);
    if (u.clan_role !== 'leader') return fail(res, 403, 'Só o líder muda cargos');
    const role = req.body?.role === 'officer' ? 'officer' : req.body?.role === 'member' ? 'member' : null;
    if (!role) return fail(res, 400, 'Cargo inválido');
    const t = await targetMember(req, res, u); if (!t) return;
    await prisma.user.update({ where: { id: t.id }, data: { clan_role: role } });
    await sync(t.id);
    tell(t.id, role === 'officer' ? '🏰 Você foi promovido a oficial!' : '🏰 Você voltou a ser membro do clã.');
    refreshClan(u.clan_id);
    res.json({ ok: true });
  });

  routes('post', '/transfer', async (req, res) => {
    const u = await me(req.user.id);
    if (u.clan_role !== 'leader') return fail(res, 403, 'Só o líder passa a liderança');
    const t = await targetMember(req, res, u); if (!t) return;
    await prisma.$transaction([
      prisma.user.update({ where: { id: t.id }, data: { clan_role: 'leader' } }),
      prisma.user.update({ where: { id: u.id }, data: { clan_role: 'officer' } }),
    ]);
    await Promise.all([sync(t.id), sync(u.id)]);
    tell(t.id, '🏰 Você agora é o líder do clã!');
    refreshClan(u.clan_id);
    res.json({ ok: true });
  });

  routes('post', '/disband', async (req, res) => {
    const u = await me(req.user.id);
    if (u.clan_role !== 'leader') return fail(res, 403, 'Só o líder dissolve o clã');
    const ids = (await prisma.user.findMany({ where: { clan_id: u.clan_id }, select: { id: true } })).map((x) => x.id);
    await prisma.clan.delete({ where: { id: u.clan_id } }); // membros ficam sem clã (onDelete: SetNull)
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { clan_role: 'member' } });
    for (const id of ids) { await sync(id); tell(id, '🏰 O clã foi dissolvido.'); }
    res.json({ ok: true });
  });

  return { clanMembersOnline: onlineOfClan, sync, refreshClan };
};
