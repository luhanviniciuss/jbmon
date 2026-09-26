// Mapa procedural determinístico (idêntico para todos os clientes).
// Tiles: 0 grama, 1 areia, 2 água (bloqueia), 3 árvore (bloqueia), 4 grama alta (encontros)
const MAP_W = 100, MAP_H = 100, TILE = 32;
const PLAYER_SPEED = 160; // px/s (compartilhado com o servidor)
const CLEAR_MIN = 46, CLEAR_MAX = 54; // clareira central = Centro Pokémon (cura)
// Prédio do Centro Pokémon na clareira: tiles sólidos, exceto a porta (pisar nela leva ao laboratório)
const LAB = { x0: 48, x1: 52, y0: 45, y1: 47, doorX: 50, doorY: 47 };

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function generateMap() {
  const data = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      const e = Math.sin(x * 0.15) + Math.cos(y * 0.12) + Math.sin((x + y) * 0.07);
      let t = 0;
      if (e < -1.2) t = 2;
      else if (e < -0.9) t = 1;
      else if (hash(x, y) < 0.08) t = 3;
      else if (Math.sin(x * 0.35 + 1) + Math.cos(y * 0.3 - 2) + Math.sin((x - y) * 0.11) > 0.9) t = 4;
      // Borda do mapa = árvores; clareira segura no centro (spawn)
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) t = 3;
      if (Math.abs(x - 50) < 5 && Math.abs(y - 50) < 5) t = 0;
      row.push(t);
    }
    data.push(row);
  }
  for (let y = LAB.y0; y <= LAB.y1; y++) for (let x = LAB.x0; x <= LAB.x1; x++) data[y][x] = x === LAB.doorX && y === LAB.doorY ? 0 : 3;
  return data;
}

if (typeof module !== "undefined") module.exports = { MAP_W, MAP_H, TILE, PLAYER_SPEED, CLEAR_MIN, CLEAR_MAX, LAB, generateMap };
