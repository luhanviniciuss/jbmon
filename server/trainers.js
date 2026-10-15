// Treinadores NPC: espalhados pelos mundos de combate (Rota, Gelo, Vulcão, Caverna do Abismo, Céu Estelar), para
// duelos opcionais. Cada um tem 1 Pokémon (não capturável, como os chefes de cenário), dá EXP e materiais do jeito
// normal, e reaparece depois de um tempo quando derrotado. Encostar nele desafia, igual a um selvagem.
const { WORLDS } = require('../public/map.js');

const TRAINER_WORLDS = ['route', 'ice', 'lava', 'cave', 'sky'];
const COUNT = { route: 5, ice: 4, lava: 4, cave: 4, sky: 4 };
const RESPAWN_MS = 15 * 60000; // 15 min depois de derrotado
const TOUCH_R = 30;
const AVATARS = ['other0', 'other1', 'other2', 'other3', 'other4', 'other5'];

// [nome, [espécies possíveis]] por mundo — reaproveita Pokémon já comuns naquele bioma, com um nível bom (não é boss)
const ROSTERS = {
  route: [['Treinador Caçula', [16, 19, 56]], ['Treinadora Ginasta', [66, 56]], ['Pescador', [118, 120]], ['Montanhista', [74, 95]], ['Garoto Pássaro', [21, 84]]],
  ice: [['Guia da Neve', [86, 87]], ['Caçadora de Gelo', [215, 124]], ['Patrulheiro Glacial', [41, 238]], ['Esquiador', [90, 39]]],
  lava: [['Ferreiro', [74, 95]], ['Bombeiro', [37, 58]], ['Vulcanólogo', [111, 246]], ['Guarda-Costas', [228, 5]]],
  cave: [['Espeleólogo', [41, 95]], ['Fantasma Errante', [92]], ['Caçador de Fósseis', [138, 140]], ['Minerador', [50, 104]]],
  sky: [['Astrônomo', [96, 63]], ['Piloto Estelar', [130, 148]], ['Guardião Cósmico', [227, 212]], ['Vidente', [97, 121]]],
};
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rand(0, arr.length - 1)];

module.exports = function createTrainers({ io, worlds }) {
  const trainers = {}; // mundo -> [{ id, world, tx, ty, x, y, name, species_id, level, avatar, busy, defeatedUntil }]
  let nextId = 1;

  // Local do treinador: só em terra alcançável, longe da clareira de chegada/portal (mesma lógica dos bosses)
  function pickTile(wid) {
    const w = worlds[wid];
    if (!w) return null;
    const near = (tx, ty) => Math.abs(tx - 50) < 8 && Math.abs(ty - 50) < 8;
    for (let i = 0; i < 600; i++) {
      const tx = rand(4, 95), ty = rand(4, 95), t = w.MAP[ty]?.[tx];
      if (!w.reach?.[ty]?.[tx] || (t !== 0 && t !== 4) || near(tx, ty)) continue;
      return [tx, ty];
    }
    return null;
  }

  function spawnOne(wid) {
    const tile = pickTile(wid);
    if (!tile) return null;
    const [tx, ty] = tile;
    const [name, pool] = pick(ROSTERS[wid]);
    const species_id = pick(pool);
    const def = WORLDS[wid];
    const cap = def.wild?.cap || def.bossLevel || 60;
    const min = def.wild?.min || Math.max(5, Math.round(cap * 0.2));
    const level = Math.max(min, Math.round(min + (cap - min) * (0.45 + Math.random() * 0.35)));
    return { id: nextId++, world: wid, tx, ty, x: tx * 32 + 16, y: ty * 32 + 16, name, species_id, level, avatar: pick(AVATARS), busy: false, defeatedUntil: 0 };
  }

  function fill(wid) {
    trainers[wid] ||= [];
    let guard = 0;
    while (trainers[wid].length < (COUNT[wid] || 0) && guard++ < 50) {
      const t = spawnOne(wid);
      if (!t) break;
      trainers[wid].push(t);
    }
  }
  TRAINER_WORLDS.forEach(fill);

  const publicOf = (t) => ({ id: t.id, x: t.x, y: t.y, name: t.name, species_id: t.species_id, level: t.level, avatar: t.avatar });
  const publicList = (wid) => (trainers[wid] || []).filter((t) => !t.busy && Date.now() >= t.defeatedUntil).map(publicOf);
  const emitList = (wid) => io.to('w:' + wid).emit('trainer:list', publicList(wid));

  setInterval(() => {
    const changed = new Set();
    for (const wid of TRAINER_WORLDS) for (const t of trainers[wid] || []) {
      if (t.defeatedUntil && Date.now() >= t.defeatedUntil) { t.defeatedUntil = 0; changed.add(wid); }
    }
    changed.forEach(emitList);
  }, 5000).unref();

  // Treinador mais perto do jogador (se houver um livre, dentro do raio de toque)
  function nearbyFor(me) {
    for (const t of trainers[me.world] || []) {
      if (t.busy || Date.now() < t.defeatedUntil) continue;
      if (Math.hypot(me.x - t.x, me.y - t.y) < TOUCH_R) return t;
    }
    return null;
  }

  function markBusy(t) { t.busy = true; emitList(t.world); }

  // Chamado quando a batalha contra o treinador termina (vitória, derrota ou fuga)
  function onBattleEnd(trainerId, wid, result) {
    const t = (trainers[wid] || []).find((x) => x.id === trainerId);
    if (!t) return;
    t.busy = false;
    if (result === 'win') t.defeatedUntil = Date.now() + RESPAWN_MS; // só "vitória" derrota de vez; fuga deixa ele lá
    emitList(wid);
  }

  return { publicList, nearbyFor, markBusy, onBattleEnd };
};
