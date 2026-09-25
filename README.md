# JBMon — MMORPG Pokémon 2D (Phaser 3 + Socket.io + Prisma/SQLite)

## Estrutura
```
prisma/schema.prisma   Models User e Pokemon (SQLite)
server/index.js        Express + REST (register/login/party) + Socket.io + anti-cheat
public/index.html      Login, HUD, drawer da party
public/style.css       Tema glassmorphism responsivo (desktop e mobile)
public/map.js          Mapa procedural determinístico (compartilhado cliente/servidor)
public/game.js         Phaser 3: movimento, jogadores remotos, minimapa, party, click-to-move
public/battle.js       UI da batalha (animações; a lógica fica no servidor)
public/species.js      Espécies, raridades, evoluções e tabela de encontros (compartilhado)
public/items.js        Pokébolas, materiais e receitas de craft (compartilhado)
server/battle.js       Regras de batalha, tipos, dano, captura, EXP
server/raid.js         Grupos, boss lendário a cada 3 h e raid cooperativa
server/durable.js      Gravações com retry e fila durável
server/backup.js       Backup periódico do banco
```

## Como rodar (sem instalar banco)
```bash
npm install          # instala e gera o Prisma Client
npm run setup        # cria prisma/dev.db com as tabelas
npm run dev          # http://localhost:3000
```
O arquivo `.env` (veja `.env.example`) já vem com `DATABASE_URL="file:./dev.db?connection_limit=1&socket_timeout=15"` (conexão única = sem `database is locked`).
Abra em duas abas, crie duas contas e **clique/toque no mapa** para andar (segure e arraste para seguir o dedo/mouse). WASD/setas continuam funcionando no PC. **P** abre a party e **B** a bolsa (craft).

Para voltar ao PostgreSQL/MySQL: troque `provider` no schema e a `DATABASE_URL`, depois `npm run setup`.

**Publicar online (Render):** veja [DEPLOY.md](DEPLOY.md) e o `render.yaml`. Precisa de plano pago com disco persistente e uma única instância.

## Batalhas e encontros
- **Selvagens no mapa**: ~70 Pokémon vivem na grama alta, visíveis com nome e nível, vagando perto de casa (pontos laranja no minimapa). A batalha começa ao encostar num deles. Quanto mais longe do Centro, mais fortes. Vencer/capturar remove o Pokémon (um novo nasce em 15 s); fugir ou perder o devolve ao mapa, com 4 s de imunidade para você.
- **Pokémon aquáticos**: ~24 vivem na água das margens dos lagos (pontos azuis no minimapa). Você não entra na água, mas se estiver na margem perto deles (~1,5 tile) a batalha começa. Clicar na água leva você até a margem mais próxima.
- **Turnos por servidor**: Investida (Normal, 40) e o golpe do tipo principal do seu Pokémon (70, 85% de precisão, com bônus STAB). Pokébolas e Fugir (70%). Atalhos 1–4 (em Pokébolas, 1–4 escolhem o tipo de bola).
- **Tipos e fraquezas**: 17 tipos (Normal, Fogo, Água, Planta, Elétrico, Gelo, Lutador, Veneno, Terra, Voador, Psíquico, Inseto, Pedra, Fantasma, Dragão, Sombrio, Aço) com dupla tipagem. Super efetivo = dano ×2 (×4 em dupla fraqueza) e **chance de crítico sobe de 6% para 30%**; resistido = dano ×0,5 e crítico só 3%; imune = 0. Os botões de golpe mostram ▲ Super / ▼ Fraco / ✕ Imune contra o inimigo atual. Tabela em `public/species.js` (`CHART`).
- **Evolução**: ao subir de nível o Pokémon pode evoluir (espécie e sprite mudam, stats recalculados). Ex.: Charmander → Charmeleon (Lv.16) → Charizard (Lv.36). Tabela `EVOLUTIONS` em `public/species.js`; Eevee evolui para uma forma aleatória no Lv.30.
- **Raridade** (comum, incomum, raro, épico, lendário): define a chance de aparecer, a cor da etiqueta no mapa, o EXP ganho e os materiais que caem. São **182 espécies** (Gen 1, 2 e 3) com 77 evoluções. Há **21 lendários**: Articuno, Zapdos, Moltres, Raikou, Entei, Suicune, Mewtwo, Mew, Celebi, Regirock, Regice, Registeel, Lugia, Ho-Oh, Latias, Latios, Jirachi, Kyogre, Groudon, Rayquaza e Deoxys. Alguns podem aparecer soltos (só longe do centro, no máximo um de cada por vez); todos podem vir como boss. **Todo lendário é nível 100** (o máximo): é preciso treinar bastante antes de enfrentá-los. Para adicionar mais, basta incluir a espécie em `SPECIES` (e nas tabelas de encontro/boss) em `public/species.js`; os sprites vêm do PokeAPI pelo id.
- **Pokébolas**: Pokébola (×1), Great Ball (×1.5), Ultra Ball (×2) e Master Ball (captura garantida). A chance depende também do HP restante e da espécie.
- **Craft** (Bolsa, tecla B): Pokémon derrotados/capturados soltam Bolotas e Fragmentos (mais raros = mais Fragmentos). Receitas em `public/items.js`: Pokébola x3 = 3 Bolotas; Great = 4 Bolotas + 1 Fragmento; Ultra = 6 + 3; Master = 30 + 12. O craft é bloqueado durante batalhas.
- **EXP e níveis (1 a 100)**: **toda batalha dá EXP**, só que menos que a vitória: vitória 100%, captura 80%, derrota 30% e fuga 12% (estes dois proporcionais ao dano que você causou, e só para quem lutou). Quem lutou recebe o valor cheio e o **resto da equipe recebe 35%** (EXP compartilhado). O valor cresce com o nível e a raridade do inimigo e é maior contra inimigos mais fortes que o seu Pokémon (e menor contra fracos). Curva: `expToNext(nível)` em `public/species.js` (Lv.5 → 102 EXP, Lv.50 → 2.870, Lv.99 → 10.028). Quem desmaiou não é revivido ao subir de nível.
- **Nível dos selvagens**: cresce com a distância do Centro (~5 perto, ~25 no meio, ~50 nos cantos). **Formas evoluídas nunca aparecem abaixo do nível em que a anterior evolui**: Pikachu só a partir do Lv.16 (Pichu evolui no 16), Raichu Lv.32+, Charmeleon 16+, Charizard 36+, Dragonite 55+ etc. (`minLevel` calculado da tabela de evoluções). Adicionei os Pokémon bebê (Pichu, Cleffa, Igglybuff, Smoochum, Elekid, Magby) para isso fazer sentido.
- **Progressão**: capturas entram na party (6 primeiros) ou no box. Se todos desmaiarem, a equipe é curada e você volta ao Centro.
- **Centro Pokémon**: a clareira central cura a equipe e repõe Pokébolas comuns até 10.
- Enquanto está em batalha, o servidor ignora movimentos do jogador.

## Grupo e Boss lendário (a cada 3 horas)
- **Boss**: a cada 3 h aparece um lendário (sorteado entre os 21, com os mais poderosos como Rayquaza, Kyogre, Groudon e Deoxys bem mais raros; tabela `BOSS_TABLE`) num ponto do mapa, com aura dourada, estrela no minimapa e aviso para todos. O chip do HUD mostra o tempo restante (clique para ir até ele) ou quanto falta para o próximo. Ele espera 30 min por desafiantes. O primeiro aparece 2 min depois de ligar o servidor.
- **Grupo (tecla G)**: o líder convida jogadores online pelo nome (2 a 4 membros). Só grupos de 2+ conseguem iniciar a luta: todos os membros precisam estar perto do boss (~20 tiles) e um deles encostar nele.
- **Fase 1, a luta**: cada membro age na sua vez (25 s por turno) com o Pokémon ativo; o boss revida em quem atacou. O boss é sempre **Lv.100** (avisa se a média do grupo for baixa) e a vida é multiplicada. Se todos forem eliminados, o boss vence e o grupo volta curado ao Centro.
- **Fase 2, a captura**: ao chegar em 15% de HP o boss fica **exausto** e ainda tem vida. Todos ganham muito EXP (a equipe inteira, com evolução) e materiais, e **cada membro tem UMA rodada para lançar uma Pokébola** (bônus de captura ×3 no boss exausto; a Master Ball é garantida). Quem capturar leva o lendário; se ninguém conseguir, ele foge.
- **Testar sem esperar 3 h**: variáveis de ambiente `BOSS_FIRST_DELAY_MIN`, `BOSS_INTERVAL_MIN` e `BOSS_LIFETIME_MIN` (ex.: `BOSS_FIRST_DELAY_MIN=0.1 npm run dev`). A lógica está em `server/raid.js`.

## Como funciona
- **Auth**: `POST /api/register|login` devolve um JWT, usado no handshake do Socket.io e na API (`GET /api/party`).
- **Tempo real**: `player:move` do cliente → servidor valida → `player:moved` para os demais. Também `players:init`, `player:joined`, `player:left`, `online`.
- **Anti-cheat (servidor autoritativo)**: cada movimento consome um orçamento de distância que recarrega a 200 px/s (160 + 25% de tolerância; rajada máx. 48 px) e é rejeitado se o destino for água/árvore/fora do mapa. Movimento inválido gera `player:correct` (o cliente volta à posição real); 20 infrações desconectam o jogador.

## Persistência (o jogador não perde progresso)
- **Transação única por turno**: HP/EXP/evolução, Pokébolas gastas, materiais e o Pokémon capturado são gravados **juntos** (tudo ou nada) e **antes** de o jogador ser avisado do resultado.
- **Raid**: HP e bolas são gravados a cada ação; EXP, evolução e materiais são gravados assim que o boss fica exausto; a captura do lendário entra na mesma transação do fim da raid.
- **Craft e cura** são operações atômicas (débito condicional no banco, sem corrida entre dois cliques).
- **Falhas transitórias**: toda gravação tem nova tentativa; se ainda falhar, vai para uma fila em memória que é reenviada até funcionar (`server/durable.js`). Materiais/captura nunca são creditados duas vezes.
- **SQLite endurecido**: modo WAL + `synchronous=FULL` (cada commit vai ao disco mesmo se o processo ou o PC cair) e conexão única, sem `database is locked`.
- **Posição** salva a cada 5 s (só se mudou), ao desconectar e no desligamento. `SIGINT/SIGTERM` salvam tudo antes de sair.
- **Backups** automáticos do banco ao iniciar e a cada hora em `prisma/backups/` (mantém os 48 mais recentes; fora do git).
- Testado derrubando o servidor à força logo após uma captura e no instante em que o boss ficou exausto: nada foi perdido.
