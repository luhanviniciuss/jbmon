// Um MUNDO do jogo (Rota, Cidade, Gelo, Lava): mapa, Pokémon selvagens e o que acontece com eles.
// Cada mundo é uma "sala" do Socket.io (`w:<id>`): só quem está nele vê seus jogadores e selvagens.
const { SPECIES, WILD_TABLE, WATER_TABLE, WORLD_TABLES, minLevel } = require('../public/species.js');
const { TILE, CLEAR_MIN, CLEAR_MAX, WORLDS } = require('../public/map.js');
const { pickSpecies } = require('./battle.js');

const RESPAWN_MS = 15000;
const WILD_WANDER = 3; // tiles de distância máxima do "lar"
const LEVEL_BONUS = { common: 0, uncommon: 1, rare: 2, epic: 4, legendary: 0 };
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

module.exports = function createWorld({ io, id, MAP, newId }) {
  const def = WORLDS[id];
  const room = 'w:' + id;
  const wilds = new Map(); // id -> { id, worldId, species_id, level, tx, ty, homeX, homeY, x, y, busy }
  const isRoute = id === 'route';
  // Na Rota, a clareira do Centro Pokémon não tem encontros; nos outros mundos, a área de chegada (raio 6) também não
  const noEncounter = (tx, ty) => (isRoute
    ? tx >= CLEAR_MIN - 1 && tx <= CLEAR_MAX + 1 && ty >= CLEAR_MIN - 1 && ty <= CLEAR_MAX + 1
    : Math.abs(tx - 50) < 7 && Math.abs(ty - 50) < 7);

  const cfg = def.wild || (isRoute ? { land: 70, water: 24, min: 2, base: 1, scale: 0.9, cap: 60 } : null);
  const tables = isRoute ? { land: WILD_TABLE, water: WATER_TABLE } : WORLD_TABLES[id] || { land: [], water: [] };

  // Só nasce Pokémon onde o jogador consegue chegar: rios de lava, lagos e árvores podem isolar pedaços do mapa, e um selvagem
  // preso do outro lado seria impossível de alcançar. Busca em largura a partir do ponto de chegada do mundo.
  const start = isRoute ? [50, 50] : [50, 49];
  const reach = MAP.map((row) => row.map(() => false));
  {
    const q = [start];
    reach[start[1]][start[0]] = true;
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, t = MAP[ny]?.[nx];
        if (t === undefined || t === 2 || t === 3 || reach[ny][nx]) continue;
        reach[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
  }
  const grass = [];
  const shore = []; // tiles de água encostados em terra ALCANÇÁVEL: onde os Pokémon aquáticos vivem
  MAP.forEach((row, y) => row.forEach((t, x) => {
    if (t === 4 && !noEncounter(x, y) && reach[y][x]) grass.push([x, y]);
    if (t !== 2) return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const n = MAP[y + dy]?.[x + dx];
      if ((n === 0 || n === 1 || n === 4) && reach[y + dy][x + dx]) { shore.push([x, y]); return; }
    }
  }));

  // Nível: Rota ~5 perto do centro e até 60 nos cantos; mundos extras começam bem mais alto (veja WORLDS)
  const levelAt = (tx, ty) => Math.max(cfg.min, Math.round(cfg.base + Math.hypot(tx - 50, ty - 50) * cfg.scale) + rand(-2, 3));
  const publicOf = (w) => ({ id: w.id, species_id: w.species_id, level: w.level, x: w.x, y: w.y, water: !!w.water });
  const isBlocked = (x, y) => { const t = MAP[Math.floor(y / TILE)]?.[Math.floor(x / TILE)]; return t === undefined || t === 2 || t === 3; };
  const isWalkable = (tx, ty) => { const t = MAP[ty]?.[tx]; return t !== undefined && t !== 2 && t !== 3; };

  function spawnWild(water = false) {
    // Lendário NUNCA nasce selvagem: só como boss (raid). Mesmo que entre numa tabela por engano, aqui é filtrado.
    const table = (water ? tables.water : tables.land).filter(([sid]) => SPECIES[sid].rarity !== 'legendary');
    const pool = water ? shore : grass;
    if (!cfg || !table.length || !pool.length) return null;
    let sid = pickSpecies(table);
    const rarity = SPECIES[sid].rarity;
    let tile;
    for (let i = 0; i < 300; i++) {
      tile = pool[rand(0, pool.length - 1)];
      const d = Math.hypot(tile[0] - 50, tile[1] - 50);
      if (Math.random() < 0.6 || d < 30) break;
    }
    const [tx, ty] = tile;
    let level = Math.min(cfg.cap, levelAt(tx, ty) + LEVEL_BONUS[rarity]);
    // Formas evoluídas nunca aparecem abaixo do nível em que a pré-evolução evolui (Pikachu >= 16, Raichu >= 32...)
    if (level < minLevel(sid)) level = minLevel(sid) + rand(0, 3);
    const w = { id: newId(), worldId: id, species_id: sid, level, water, tx, ty, homeX: tx, homeY: ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, busy: false };
    wilds.set(w.id, w);
    return w;
  }
  if (cfg) {
    if (grass.length) for (let i = 0; i < cfg.land; i++) spawnWild();
    if (shore.length) for (let i = 0; i < cfg.water; i++) spawnWild(true);
  }
  console.log(`Mundo "${def.name}": ${wilds.size} Pokémon selvagens (${grass.length} tiles de encontro)`);

  // Spawn manual (painel admin): coloca `count` Pokémon da espécie/nível pedidos ao redor do ponto (tx, ty)
  function spawnAdminWild({ species_id, level, count, tx, ty, water, ttlMs }) {
    const made = [];
    const taken = new Set();
    const spot = () => {
      for (let r = 0; r <= 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = tx + dx, y = ty + dy, t = MAP[y]?.[x];
            if (t === undefined || taken.has(x + ',' + y)) continue;
            if (water ? t === 2 : t !== 2 && t !== 3) return [x, y];
          }
        }
        if (r === 12) return null;
      }
      return null;
    };
    for (let i = 0; i < count; i++) {
      const p = spot();
      if (!p) break;
      taken.add(p[0] + ',' + p[1]);
      const w = { id: newId(), worldId: id, species_id, level, water, tx: p[0], ty: p[1], homeX: p[0], homeY: p[1], x: p[0] * TILE + TILE / 2, y: p[1] * TILE + TILE / 2, busy: false, admin: true, expiresAt: Date.now() + ttlMs };
      wilds.set(w.id, w);
      io.to(room).emit('wild:add', publicOf(w));
      made.push(w);
    }
    return made;
  }
  function clearAdminWilds() {
    let n = 0;
    for (const w of [...wilds.values()]) if (w.admin && !w.busy) { wilds.delete(w.id); io.to(room).emit('wild:remove', w.id); n++; }
    return n;
  }

  const releaseWild = (w) => { w.busy = false; io.to(room).emit('wild:add', publicOf(w)); }; // fugiu/perdeu: volta ao mapa
  const defeatWild = (w) => { // venceu/capturou: some e um novo nasce depois (os spawnados por admin não têm substituto)
    wilds.delete(w.id);
    if (w.admin) return;
    setTimeout(() => { const nw = spawnWild(!!w.water); if (nw) io.to(room).emit('wild:add', publicOf(nw)); }, RESPAWN_MS);
  };

  setInterval(() => { // vagueiam perto de casa
    const moved = [];
    for (const w of wilds.values()) {
      if (w.expiresAt && Date.now() > w.expiresAt && !w.busy) { wilds.delete(w.id); io.to(room).emit('wild:remove', w.id); continue; } // spawn de admin expirou
      if (w.busy || Math.random() > 0.35) continue;
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rand(0, 3)];
      const nx = w.tx + dx, ny = w.ty + dy, t = MAP[ny]?.[nx];
      if (w.water ? t !== 2 : t === undefined || t === 2 || t === 3 || noEncounter(nx, ny)) continue; // aquáticos ficam na água
      if (Math.abs(nx - w.homeX) > WILD_WANDER || Math.abs(ny - w.homeY) > WILD_WANDER) continue;
      Object.assign(w, { tx: nx, ty: ny, x: nx * TILE + TILE / 2, y: ny * TILE + TILE / 2 });
      moved.push({ id: w.id, x: w.x, y: w.y });
    }
    if (moved.length) io.to(room).emit('wild:update', moved);
  }, 1000);

  return {
    id, room, def, MAP, wilds, isBlocked, isWalkable, spawnAdminWild, clearAdminWilds, releaseWild, defeatWild,
    publicOf, publicList: () => [...wilds.values()].filter((w) => !w.busy).map(publicOf),
  };
};
