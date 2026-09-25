// Estado de moderação em memória (bans e silenciamentos ativos), carregado do banco ao iniciar.
// A fonte da verdade é o banco (colunas banned_until / muted_until); aqui fica o cache para conferir rápido em cada mensagem/requisição.
const FOREVER_MS = new Date('9999-12-31T00:00:00Z').getTime();

module.exports = function createModeration(prisma) {
  const bans = new Map(); // uid -> { until (ms), reason }
  const mutes = new Map();
  const get = (map, uid) => {
    const e = map.get(uid);
    if (!e) return null;
    if (e.until <= Date.now()) { map.delete(uid); return null; } // expirou
    return e;
  };

  return {
    FOREVER_MS,
    async load() {
      const now = new Date();
      const rows = await prisma.user.findMany({
        where: { OR: [{ banned_until: { gt: now } }, { muted_until: { gt: now } }] },
        select: { id: true, banned_until: true, ban_reason: true, muted_until: true, mute_reason: true },
      });
      for (const r of rows) {
        if (r.banned_until && r.banned_until > now) bans.set(r.id, { until: r.banned_until.getTime(), reason: r.ban_reason || '' });
        if (r.muted_until && r.muted_until > now) mutes.set(r.id, { until: r.muted_until.getTime(), reason: r.mute_reason || '' });
      }
      return rows.length;
    },
    ban: (uid, until, reason) => bans.set(uid, { until, reason }),
    unban: (uid) => bans.delete(uid),
    mute: (uid, until, reason) => mutes.set(uid, { until, reason }),
    unmute: (uid) => mutes.delete(uid),
    banOf: (uid) => get(bans, uid),
    muteOf: (uid) => get(mutes, uid),
    describe: (e) => (e.until >= FOREVER_MS ? 'permanentemente' : 'até ' + new Date(e.until).toLocaleString('pt-BR')) + (e.reason ? ' (motivo: ' + e.reason + ')' : ''),
  };
};
