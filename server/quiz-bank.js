// Banco de perguntas do Quiz Pokémon. Perguntas GERADAS a partir dos dados do jogo (tipos, evoluções, números da Pokédex,
// tabela de tipos) + perguntas fixas sobre o jogo e curiosidades. Cada quiz sorteia perguntas diferentes e embaralha as
// alternativas. A resposta certa fica só no servidor até a revelação.
const { SPECIES, TYPES, CHART, EVOLUTIONS } = require('../public/species.js');

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const ids = Object.keys(SPECIES).map(Number);
const nm = (id) => SPECIES[id].name;
const typeLabel = (types) => types.map((t) => TYPES[t].label).join(' / ');
const key = (types) => [...types].sort().join('/');

// Monta { options (embaralhadas), answer (índice) } com a certa + distratores distintos
function build(correct, distractors) {
  const seen = new Set([correct]);
  const ds = [];
  for (const d of shuffle(distractors)) { if (!seen.has(d)) { seen.add(d); ds.push(d); } if (ds.length === 3) break; }
  if (ds.length < 3) return null;
  const options = shuffle([correct, ...ds]);
  return { options, answer: options.indexOf(correct) };
}
const q = (text, correct, distractors) => { const b = build(correct, distractors); return b ? { text, ...b } : null; };

const singleEvo = ids.filter((id) => EVOLUTIONS[id] && !Array.isArray(EVOLUTIONS[id][1]) && SPECIES[EVOLUTIONS[id][1]]);
const legends = ids.filter((id) => SPECIES[id].rarity === 'legendary');
const nonLegends = ids.filter((id) => SPECIES[id].rarity !== 'legendary');
const typeKeys = Object.keys(TYPES);
const immune = []; // [atacante, defensor] com dano 0
const superOf = {}; // defensor -> atacantes super efetivos
for (const atk of Object.keys(CHART)) for (const def of Object.keys(CHART[atk])) {
  if (CHART[atk][def] === 0) immune.push([atk, def]);
  if (CHART[atk][def] === 2) (superOf[def] ||= []).push(atk);
}

const GENERATORS = [
  // Tipo de um Pokémon
  () => { const id = pick(ids), s = SPECIES[id]; return q(`Qual é o tipo de ${s.name}?`, typeLabel(s.types), ids.map((x) => typeLabel(SPECIES[x].types)).filter((t) => t !== typeLabel(s.types))); },
  // Qual destes é do tipo X
  () => {
    const t = pick(typeKeys);
    const yes = ids.filter((id) => SPECIES[id].types.includes(t)), no = ids.filter((id) => !SPECIES[id].types.includes(t));
    if (!yes.length) return null;
    return q(`Qual destes Pokémon é do tipo ${TYPES[t].label}?`, nm(pick(yes)), no.map(nm));
  },
  // Tipo super efetivo contra
  () => { const def = pick(Object.keys(superOf)); const good = superOf[def]; return q(`Qual destes tipos causa dano super efetivo em Pokémon do tipo ${TYPES[def].label}?`, TYPES[pick(good)].label, typeKeys.filter((t) => !good.includes(t)).map((t) => TYPES[t].label)); },
  // Imunidade
  () => { const [atk, def] = pick(immune); return q(`Qual tipo é totalmente imune a golpes do tipo ${TYPES[atk].label}?`, TYPES[def].label, typeKeys.filter((t) => t !== def && CHART[atk]?.[t] !== 0).map((t) => TYPES[t].label)); },
  // Evolução
  () => { const id = pick(singleEvo); return q(`Em qual Pokémon ${nm(id)} evolui?`, nm(EVOLUTIONS[id][1]), ids.filter((x) => x !== EVOLUTIONS[id][1] && x !== id).map(nm)); },
  () => { const id = pick(singleEvo); const to = EVOLUTIONS[id][1]; return q(`Qual Pokémon evolui para ${nm(to)}?`, nm(id), ids.filter((x) => x !== id && x !== to).map(nm)); },
  // Número na Pokédex
  () => { const id = pick(ids.filter((x) => x <= 386)); return q(`Qual Pokémon é o número #${id} da Pokédex nacional?`, nm(id), ids.filter((x) => x !== id).map(nm)); },
  // Lendário
  () => q('Qual destes Pokémon é lendário?', nm(pick(legends)), nonLegends.map(nm)),
  () => q('Qual destes Pokémon NÃO é lendário?', nm(pick(nonLegends)), legends.map(nm)),
];

// Perguntas fixas: sobre o jogo e curiosidades (todas conferidas)
const STATIC = [
  ['Quantos Pokémon cabem na sua equipe?', '6', ['3', '4', '8', '10']],
  ['Quanto tempo leva a cura na máquina do Centro Pokémon?', '15 segundos', ['5 segundos', '1 minuto', '30 segundos', '10 segundos']],
  ['De quanto em quanto tempo aparece um boss lendário no mapa?', '3 horas', ['1 hora', '30 minutos', '12 horas', '24 horas']],
  ['Qual é o nível máximo de um Pokémon neste jogo?', '1000', ['100', '500', '255', '99']],
  ['Quantos jogadores cabem em um grupo?', '4', ['2', '3', '6', '10']],
  ['Onde ficam os portais para o Bioma de Gelo e o Vulcão?', 'No Ginásio', ['No Centro Pokémon', 'Na casa do Professor', 'No Salão de Eventos', 'Na praça da Cidade']],
  ['Qual Pokébola tem captura garantida?', 'Master Ball', ['Great Ball', 'Ultra Ball', 'Pokébola', 'Premier Ball']],
  ['Qual é o nível máximo dos Pokémon selvagens da Rota 1?', '60', ['20', '100', '45', '200']],
  ['Em que mundo mora o Chefe Gélido?', 'Bioma de Gelo', ['Vulcão', 'Rota 1', 'Cidade', 'Salão de Eventos']],
  ['Como se chama o golpe extra que todo Pokémon lendário tem?', 'Poder Lendário', ['Golpe Forte', 'Ataque Rápido', 'Investida', 'Super Golpe']],
  ['Qual profissional guia o Modo História na Cidade?', 'Professor Carvalho', ['Enfermeira Joy', 'Líder Brock', 'Professor Elm', 'Oficial Jenny']],
  ['No PvP deste jogo, em que nível todos lutam?', 'Nível 50', ['Nível 5', 'Nível 100', 'No nível real', 'Nível 1000']],
  ['O que o Pokémon do chefe de cenário NÃO permite?', 'Ser capturado', ['Ser derrotado', 'Ser visto na Pokédex', 'Ser enfrentado', 'Dar EXP']],
  () => ['Qual destes é um Pokémon inicial de Kanto?', pick(['Bulbasaur', 'Charmander', 'Squirtle']), ['Chikorita', 'Torchic', 'Pikachu', 'Eevee']],
  ['Qual dos pássaros lendários de Kanto é do tipo Fogo?', 'Moltres', ['Articuno', 'Zapdos', 'Lugia', 'Ho-Oh']],
  ['Qual Pokémon lendário foi criado em laboratório a partir do Mew?', 'Mewtwo', ['Mew', 'Deoxys', 'Celebi', 'Jirachi']],
  ['Qual destes Pokémon é conhecido como o Pokémon rato elétrico?', 'Pikachu', ['Raichu', 'Rattata', 'Jolteon', 'Magnemite']],
  ['O Magikarp evolui para qual Pokémon?', 'Gyarados', ['Lapras', 'Milotic', 'Seaking', 'Starmie']],
  ['Qual tipo resiste a golpes de Água e é fraco contra Fogo?', 'Planta', ['Fogo', 'Elétrico', 'Terra', 'Lutador']],
];

function makeQuiz(n = 10) {
  const out = [], seen = new Set();
  const add = (x) => { if (x && !seen.has(x.text)) { seen.add(x.text); out.push(x); return true; } return false; };
  const fromStatic = (e) => { const s = typeof e === 'function' ? e() : e; return q(s[0], s[1], s[2]); };
  // garante 2 perguntas sobre o jogo/curiosidades
  for (const e of shuffle(STATIC).slice(0, 2)) add(fromStatic(e));
  let guard = 0;
  while (out.length < n && guard++ < 400) {
    if (Math.random() < 0.18) add(fromStatic(pick(STATIC)));
    else add(pick(GENERATORS)());
  }
  return shuffle(out).slice(0, n);
}

module.exports = { makeQuiz };
