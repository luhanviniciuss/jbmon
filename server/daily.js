// Login diário: quem entra no jogo todo dia pode resgatar uma recompensa. Sequência de 7 dias que sobe a
// cada dia seguido e zera se faltar um dia (ficar mais de 24h sem resgatar). Não depende de nenhum evento do
// Salão — é só entrar e clicar em "Resgatar". Na época de Natal, todo dia ganha um bônus extra de Bolotas.
const { isXmasActive } = require('./season.js');

const REWARDS = [
  { icon: '🔴', label: '5 Pokébolas', prize: { pokeballs: 5 } },
  { icon: '🌰', label: '15 Bolotas', prize: { apricorns: 15 } },
  { icon: '🟡', label: '2 Great Balls', prize: { greatballs: 2 } },
  { icon: '💎', label: '10 Fragmentos', prize: { shards: 10 } },
  { icon: '🔵', label: '2 Ultra Balls', prize: { ultraballs: 2 } },
  { icon: '🎁', label: '30 Bolotas + 10 Fragmentos', prize: { apricorns: 30, shards: 10 } },
  { icon: '🟣', label: '1 Master Ball + bônus', prize: { masterballs: 1, apricorns: 20, shards: 10 } },
];
const XMAS_BONUS = { apricorns: 5 }; // extra em todo dia, enquanto a época de Natal estiver ativa

const dateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((dateOnly(b) - dateOnly(a)) / 86400000);

module.exports = function createDaily({ prisma, durable }) {
  // A partir do último resgate, diz se hoje já foi resgatado e qual seria a próxima sequência.
  function computeNext(user) {
    if (!user.last_login) return { claimed: false, nextStreak: 1 };
    const diff = daysBetween(new Date(user.last_login), new Date());
    if (diff <= 0) return { claimed: true, nextStreak: user.login_streak || 1 }; // já resgatou hoje
    if (diff === 1) return { claimed: false, nextStreak: (user.login_streak || 0) + 1 }; // veio ontem: sequência continua
    return { claimed: false, nextStreak: 1 }; // faltou 1+ dia: sequência zera
  }

  function rewardFor(streak) {
    const day = ((streak - 1) % 7) + 1;
    const base = REWARDS[day - 1];
    const prize = { ...base.prize };
    if (isXmasActive()) for (const [k, n] of Object.entries(XMAS_BONUS)) prize[k] = (prize[k] || 0) + n;
    return { day, icon: base.icon, label: base.label, prize };
  }

  function stateOf(user) {
    const { claimed, nextStreak } = computeNext(user);
    const reward = rewardFor(nextStreak);
    return {
      claimed,
      streak: claimed ? user.login_streak || 0 : nextStreak,
      day: reward.day,
      prize: reward.prize,
      xmas: isXmasActive(),
      days: REWARDS.map((r, i) => ({ day: i + 1, icon: r.icon, label: r.label })),
    };
  }

  async function claim(uid) {
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return null;
    const { claimed, nextStreak } = computeNext(user);
    if (claimed) return null;
    const reward = rewardFor(nextStreak);
    const data = { last_login: new Date(), login_streak: nextStreak };
    for (const [k, n] of Object.entries(reward.prize)) data[k] = { increment: n };
    const u = await durable('login-diario', () => prisma.user.update({ where: { id: uid }, data }));
    if (!u) return null;
    return {
      day: reward.day, streak: nextStreak, icon: reward.icon, label: reward.label, prize: reward.prize,
      balls: { poke: u.pokeballs, great: u.greatballs, ultra: u.ultraballs, master: u.masterballs },
    };
  }

  function bind(socket, uid, user) {
    socket.emit('daily:state', stateOf(user));
    socket.on('daily:claim', async () => {
      const r = await claim(uid);
      if (!r) { socket.emit('daily:claimed', { error: 'Você já resgatou o login diário hoje. Volte amanhã!' }); return; }
      socket.emit('daily:claimed', r);
      socket.emit('inventory', r.balls);
      socket.emit('notice', { msg: `🎁 Login diário: dia ${r.day}/7 resgatado! Sequência de ${r.streak} dia${r.streak === 1 ? '' : 's'}.`, big: true });
    });
  }

  return { bind, stateOf };
};
