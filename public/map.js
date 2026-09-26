// Mapas procedurais determinísticos (idênticos para todos os clientes e para o servidor).
// Cada MUNDO tem 100x100 tiles. Tiles: 0 chão, 1 chão alternativo, 2 líquido (bloqueia), 3 obstáculo (bloqueia), 4 zona de encontros.
// O visual muda por mundo (grama, neve, rocha vulcânica, pavimento), mas os números têm sempre o mesmo papel.
const MAP_W = 100, MAP_H = 100, TILE = 32;
const PLAYER_SPEED = 160; // px/s (compartilhado com o servidor)
const CLEAR_MIN = 46, CLEAR_MAX = 54; // clareira central da Rota = Centro Pokémon (cura)

// Prédios 5x3 tiles: sólidos, exceto a porta (pisar nela entra no interior).
const LAB = { x0: 48, x1: 52, y0: 45, y1: 47, doorX: 50, doorY: 47 };        // Centro Pokémon da Rota
const GYM = { x0: 68, x1: 72, y0: 45, y1: 47, doorX: 70, doorY: 47 };        // Ginásio: hub de portais (20 tiles a leste do Centro Pokémon)
const TOWN_LAB = { x0: 48, x1: 52, y0: 40, y1: 42, doorX: 50, doorY: 42 };   // Centro Pokémon da Cidade
const LABS = { route: LAB, town: TOWN_LAB };
const PORTAL = { tx: 46, ty: 49 };                                            // portal de volta ao ginásio (mundos extras), 4 tiles a oeste da chegada
const ARRIVE = { x: 50.5 * TILE, y: 49.5 * TILE };                            // onde o jogador chega em cada mundo extra

// Mundos. `biome` = cenário das batalhas (null na Rota: depende do local); `wild` = configuração dos encontros.
const WORLDS = {
  route: { id: 'route', name: 'Rota 1', icon: '🌿', spawn: { x: 1600, y: 1600 }, biome: null },
  town: { id: 'town', name: 'Cidade', icon: '🏙', spawn: ARRIVE, biome: 'town', wild: null },
  ice: { id: 'ice', name: 'Bioma de Gelo', icon: '❄', spawn: ARRIVE, biome: 'snow', wild: { land: 60, water: 16, min: 80, base: 80, scale: 1.7, cap: 200 } },
  lava: { id: 'lava', name: 'Vulcão', icon: '🌋', spawn: ARRIVE, biome: 'volcano', wild: { land: 60, water: 0, min: 300, base: 300, scale: 3, cap: 500 } },
};
const WORLD_IDS = Object.keys(WORLDS);
const GYM_EXIT = { x: (GYM.doorX + 0.5) * TILE, y: (GYM.doorY + 1.5) * TILE }; // em frente ao ginásio, na Rota

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const grid = (fn) => {
  const data = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) row.push(fn(x, y));
    data.push(row);
  }
  return data;
};
const isBorder = (x, y) => x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
const stamp = (data, b) => { for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) data[y][x] = x === b.doorX && y === b.doorY ? 0 : 3; };

function genRoute() {
  const data = grid((x, y) => {
    const e = Math.sin(x * 0.15) + Math.cos(y * 0.12) + Math.sin((x + y) * 0.07);
    let t = 0;
    if (e < -1.2) t = 2;
    else if (e < -0.9) t = 1;
    else if (hash(x, y) < 0.08) t = 3;
    else if (Math.sin(x * 0.35 + 1) + Math.cos(y * 0.3 - 2) + Math.sin((x - y) * 0.11) > 0.9) t = 4;
    // Borda do mapa = árvores; clareira segura no centro (spawn)
    if (isBorder(x, y)) t = 3;
    if (Math.abs(x - 50) < 5 && Math.abs(y - 50) < 5) t = 0;
    return t;
  });
  for (let y = GYM.y0 - 1; y <= GYM.y1 + 3; y++) for (let x = GYM.x0 - 1; x <= GYM.x1 + 1; x++) data[y][x] = 0; // terreno limpo ao redor do ginásio
  for (let y = GYM.doorY + 1; y <= GYM.doorY + 3; y++) for (let x = CLEAR_MAX + 1; x < GYM.x0; x++) data[y][x] = 0; // caminho livre de grama alta entre o Centro Pokémon e o ginásio
  stamp(data, LAB);
  stamp(data, GYM);
  return data;
}

// Clareira central (raio 6) de cada mundo extra: chegada do jogador e portal de volta
const arrivalZone = (x, y) => Math.abs(x - 50) < 6 && Math.abs(y - 50) < 6;

function genIce() {
  return grid((x, y) => {
    const e = Math.sin(x * 0.11 + 2) + Math.cos(y * 0.13 - 1) + Math.sin((x + y) * 0.05 + 1);
    let t = 0;
    if (e < -1.15) t = 2;                                   // lago congelado (bloqueia; Pokémon aquáticos)
    else if (e < -0.85) t = 1;                              // gelo liso
    else if (hash(x + 91, y + 17) < 0.09) t = 3;            // blocos de gelo
    else if (Math.sin(x * 0.3 + 2) + Math.cos(y * 0.27) + Math.sin((x - y) * 0.1) > 0.6) t = 4; // neve funda (encontros)
    if (isBorder(x, y)) t = 3;
    if (arrivalZone(x, y)) t = 0;
    return t;
  });
}

function genLava() {
  return grid((x, y) => {
    const river = Math.abs(Math.sin(x * 0.08 + Math.cos(y * 0.06) * 2.2));
    let t = 0;
    if (river < 0.1) t = 2;                                 // rio de lava (bloqueia)
    else if (river < 0.2) t = 1;                            // cinzas nas margens
    else if (hash(x + 33, y + 71) < 0.1) t = 3;             // rochas
    else if (Math.sin(x * 0.33) + Math.cos(y * 0.29 + 1) + Math.sin((x + y) * 0.09) > 0.7) t = 4; // chão quente (encontros)
    if (isBorder(x, y)) t = 3;
    if (arrivalZone(x, y)) t = 0;
    return t;
  });
}

// Casas da cidade (x, y, largura, altura em tiles): sólidas no mapa; o cliente desenha uma casa em cada uma
const TOWN_HOUSES = [31, 39, 56, 64].flatMap((x) => [{ x, y: 31, w: 6, h: 4 }, { x, y: 65, w: 6, h: 4 }]).concat([{ x: 31, y: 47, w: 5, h: 5 }, { x: 64, y: 47, w: 5, h: 5 }]);

function genTown() {
  const data = grid((x, y) => (x <= 28 || x >= 71 || y <= 28 || y >= 71 ? 3 : 0)); // cidade de 42x42 tiles cercada de muros/árvores
  const block = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data[y][x] = 3; };
  TOWN_HOUSES.forEach((h) => block(h.x, h.y, h.w, h.h));
  for (let y = 44; y <= 56; y++) for (let x = 44; x <= 56; x++) data[y][x] = 1;   // praça central
  for (let y = 53; y <= 54; y++) for (let x = 48; x <= 52; x++) data[y][x] = 2;   // fonte da praça
  stamp(data, TOWN_LAB);
  return data;
}

function generateMap(world = 'route') {
  return world === 'ice' ? genIce() : world === 'lava' ? genLava() : world === 'town' ? genTown() : genRoute();
}

if (typeof module !== "undefined") module.exports = { MAP_W, MAP_H, TILE, PLAYER_SPEED, CLEAR_MIN, CLEAR_MAX, LAB, GYM, TOWN_LAB, LABS, TOWN_HOUSES, PORTAL, ARRIVE, GYM_EXIT, WORLDS, WORLD_IDS, generateMap };
