// Bioma do local da batalha, deduzido dos tiles ao redor (raio 4) no mapa procedural.
// Tiles: 0 grama, 1 areia, 2 água, 3 árvore, 4 grama alta.
const R = 4;

function biomeAt(MAP, TILE, px, py, { water = false, town = false } = {}) {
  if (town) return 'town'; // clareira do Centro Pokémon
  if (water) return 'lake';
  const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
  const c = [0, 0, 0, 0, 0];
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    const t = MAP[y]?.[x];
    if (t !== undefined) c[t]++;
  }
  if (c[2] >= 10) return 'lake'; // muita água por perto: à beira do lago
  if (c[1] >= 14) return 'beach';
  if (c[3] >= 10) return 'forest';
  if (c[4] >= 28) return 'meadow';
  return 'field';
}

module.exports = { biomeAt };
