// Modo História: capítulos, missões, chefes, bloqueios e dicas (compartilhado servidor/cliente).
// O servidor guarda só o PROGRESSO de cada jogador (tabela player_progress); as definições ficam aqui.
//
// Cada missão (step) tem um `kind`:
//   talk    - falar com o Professor Carvalho (dentro da casa dele, na Cidade)
//   starter - escolher o Pokémon inicial com o Professor
//   capture - capturar `need` Pokémon selvagens
//   world   - entrar em um mundo (pelo portal do ginásio)
//   defeat  - derrotar `need` Pokémon selvagens de um mundo
//   reach   - chegar a uma coordenada (tile tx,ty, raio em tiles) de um mundo
//   chief   - derrotar o chefe do mundo (treinador de cenário)
const STARTERS = [1, 4, 7]; // Bulbasaur, Charmander, Squirtle

const CHIEFS = {
  ice: { id: 'ice', world: 'ice', name: 'Chefe Gélido', species: 131, level: 90, tx: 50, ty: 10, hpMult: 1.5 },   // Lapras
  lava: { id: 'lava', world: 'lava', name: 'Líder Vulcânico', species: 59, level: 320, tx: 50, ty: 10, hpMult: 1.5 }, // Arcanine
};

const STORY = [
  {
    id: 1, title: 'O Despertar na Rota 1', icon: '🌱',
    brief: 'Todo grande treinador começa em algum lugar. Fale com o Professor Carvalho, escolha seu companheiro e capture seu primeiro Pokémon selvagem.',
    reward: { pokeballs: 10, apricorns: 5 },
    steps: [
      { kind: 'talk', text: 'Fale com o Professor Carvalho', hint: 'Vá ao Ginásio (a leste do Centro Pokémon, na Rota), entre no portal da Cidade e visite a casa da esquerda.', target: { world: 'town', tx: 33, ty: 52 } },
      { kind: 'starter', text: 'Escolha seu Pokémon inicial', hint: 'Converse com o Professor de novo e escolha entre Bulbasaur, Charmander e Squirtle.', target: { world: 'town', tx: 33, ty: 52 } },
      { kind: 'capture', need: 1, text: 'Capture seu primeiro Pokémon selvagem', hint: 'Encoste num Pokémon na grama alta da Rota 1, enfraqueça-o e lance uma Pokébola.', target: { world: 'route', tx: 50, ty: 58 } },
    ],
  },
  {
    id: 2, title: 'A Trilha Congelada', icon: '❄',
    brief: 'O Bioma de Gelo guarda Pokémon muito mais fortes (Lv. 80 a 200). Derrote o Chefe Gélido, no extremo norte, para provar que você está pronto.',
    reward: { greatballs: 5, apricorns: 20, shards: 5 },
    steps: [
      { kind: 'world', world: 'ice', text: 'Entre no Bioma de Gelo', hint: 'No Ginásio, entre pelo portal azul do Bioma de Gelo.' },
      { kind: 'defeat', world: 'ice', need: 5, text: 'Derrote 5 Pokémon selvagens do Gelo', hint: 'Enfrente os Pokémon na neve funda. Leve Pokémon de Fogo, Lutador ou Elétrico!' },
      { kind: 'chief', chief: 'ice', text: 'Derrote o Chefe Gélido', hint: 'Ele espera no extremo norte do Bioma de Gelo. Não dá para capturar o Pokémon dele.', target: { world: 'ice', tx: 50, ty: 10 } },
    ],
  },
  {
    id: 3, title: 'O Desafio Vulcânico', icon: '🌋',
    brief: 'No topo do Vulcão vive o líder mais temido da região (Pokémon Lv. 300 a 500 rondam por lá). Chegue ao cume e enfrente-o.',
    reward: { greatballs: 10, apricorns: 30, shards: 15 },
    steps: [
      { kind: 'world', world: 'lava', text: 'Entre no Vulcão', hint: 'No Ginásio, entre pelo portal vermelho do Vulcão.' },
      { kind: 'reach', world: 'lava', tx: 50, ty: 16, radius: 4, text: 'Chegue ao topo do Vulcão', hint: 'Suba sempre para o norte, desviando dos rios de lava.', target: { world: 'lava', tx: 50, ty: 16 } },
      { kind: 'chief', chief: 'lava', text: 'Derrote o Líder Vulcânico', hint: 'Ele espera no cume. Não dá para capturar o Pokémon dele.', target: { world: 'lava', tx: 50, ty: 10 } },
    ],
  },
];

// Mundos bloqueados até concluir N capítulos (administradores ignoram)
const GATES = {
  ice: { chapters: 1, msg: 'O Bioma de Gelo está bloqueado: conclua o Capítulo 1 (fale com o Professor Carvalho, na Cidade).' },
  lava: { chapters: 2, msg: 'O Vulcão está bloqueado: conclua o Capítulo 2 (derrote o Chefe Gélido no Bioma de Gelo).' },
};

// Dicas para quem chega (podem ser puladas e revistas no ⚙ ou com o Professor)
const TIPS = [
  { icon: '👆', title: 'Como andar', text: 'Toque ou clique no mapa para andar até lá. No computador você também pode usar WASD ou as setas.' },
  { icon: '🌿', title: 'Pokémon selvagens', text: 'Encoste num Pokémon selvagem para batalhar. Quanto mais longe do Centro Pokémon, mais fortes eles são.' },
  { icon: '🎯', title: 'Capturar', text: 'Enfraqueça o Pokémon e lance uma Pokébola. Quanto menos vida ele tiver, maior a chance. Você ganha EXP mesmo perdendo ou fugindo.' },
  { icon: '👥', title: 'Sua equipe', text: 'Em Party (P) você monta uma equipe de até 6. O primeiro anda ao seu lado e entra primeiro na batalha. Dá para trocar de Pokémon no meio da luta.' },
  { icon: '🩹', title: 'Curar', text: 'Não existe cura automática: entre no Centro Pokémon (o prédio vermelho no meio do mapa) e use a máquina do laboratório. Leva 15 segundos.' },
  { icon: '🎒', title: 'Bolsa e craft', text: 'Na Bolsa (B) você transforma Bolotas e Fragmentos, que caem dos Pokémon derrotados, em Pokébolas e Great Balls.' },
  { icon: '🌀', title: 'Ginásio e mundos', text: 'O Ginásio, a leste do Centro, tem portais para a Cidade, o Bioma de Gelo e o Vulcão. Cada mundo tem Pokémon bem mais fortes: treine antes!' },
  { icon: '🐉', title: 'Lendários e grupos', text: 'Lendários só aparecem como boss, de tempos em tempos. Forme um grupo (G) de 2 a 4: a raid só começa com o grupo inteiro perto do boss.' },
  { icon: '⚔', title: 'Arena e clãs', text: 'Na Arena (K) você entra na fila de PvP, cria ou entra num clã e vê os rankings. Para desafiar alguém específico, toque nele no mapa.' },
  { icon: '💬', title: 'Chat e voz', text: 'O chat tem canais global, de grupo e de clã. Nas configurações (⚙) dá para ligar a voz do grupo.' },
  { icon: '📖', title: 'Pokédex e missões', text: 'A Pokédex registra tudo que você vê e captura. O Diário de Missões guia sua jornada. Volte ao Professor Carvalho sempre que precisar!' },
];

const storyData = { STARTERS, CHIEFS, STORY, GATES, TIPS };
if (typeof module !== 'undefined') module.exports = storyData;
