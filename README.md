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
server/battle.js       Regras de batalha, dano, captura, EXP
```

## Como rodar (sem instalar banco)
```bash
npm install          # instala e gera o Prisma Client
npm run setup        # cria prisma/dev.db com as tabelas
npm run dev          # http://localhost:3000
```
O arquivo `.env` (veja `.env.example`) já vem com `DATABASE_URL="file:./dev.db"`.
Abra em duas abas, crie duas contas e **clique/toque no mapa** para andar (segure e arraste para seguir o dedo/mouse). WASD/setas continuam funcionando no PC. **P** abre a party e **B** a bolsa (craft).

Para voltar ao PostgreSQL/MySQL: troque `provider` no schema e a `DATABASE_URL`, depois `npm run setup`.

## Batalhas e encontros
- **Selvagens no mapa**: ~70 Pokémon vivem na grama alta, visíveis com nome e nível, vagando perto de casa (pontos laranja no minimapa). A batalha começa ao encostar num deles. Quanto mais longe do Centro, mais fortes. Vencer/capturar remove o Pokémon (um novo nasce em 15 s); fugir ou perder o devolve ao mapa, com 4 s de imunidade para você.
- **Turnos por servidor**: Investida (100%), Golpe Forte (70 de poder, 80% de precisão), Pokébolas e Fugir (70%). Atalhos 1–4 (em Pokébolas, 1–4 escolhem o tipo de bola).
- **Evolução**: ao subir de nível o Pokémon pode evoluir (espécie e sprite mudam, stats recalculados). Ex.: Charmander → Charmeleon (Lv.16) → Charizard (Lv.36). Tabela `EVOLUTIONS` em `public/species.js`; Eevee evolui para uma forma aleatória no Lv.30.
- **Raridade** (comum, incomum, raro, épico, lendário): define a chance de aparecer, a cor da etiqueta no mapa, o EXP ganho e os materiais que caem. Lendários (Articuno, Zapdos, Moltres, Mewtwo, Mew) só surgem longe do centro, no máximo um de cada por vez, em nível 40+.
- **Pokébolas**: Pokébola (×1), Great Ball (×1.5), Ultra Ball (×2) e Master Ball (captura garantida). A chance depende também do HP restante e da espécie.
- **Craft** (Bolsa, tecla B): Pokémon derrotados/capturados soltam Bolotas e Fragmentos (mais raros = mais Fragmentos). Receitas em `public/items.js`: Pokébola x3 = 3 Bolotas; Great = 4 Bolotas + 1 Fragmento; Ultra = 6 + 3; Master = 30 + 12. O craft é bloqueado durante batalhas.
- **Progressão**: EXP ao vencer; capturas entram na party (6 primeiros) ou no box. Se todos desmaiarem, a equipe é curada e você volta ao Centro.
- **Centro Pokémon**: a clareira central cura a equipe e repõe Pokébolas comuns até 10.
- Enquanto está em batalha, o servidor ignora movimentos do jogador.

## Como funciona
- **Auth**: `POST /api/register|login` devolve um JWT, usado no handshake do Socket.io e na API (`GET /api/party`).
- **Tempo real**: `player:move` do cliente → servidor valida → `player:moved` para os demais. Também `players:init`, `player:joined`, `player:left`, `online`.
- **Anti-cheat (servidor autoritativo)**: cada movimento consome um orçamento de distância que recarrega a 200 px/s (160 + 25% de tolerância; rajada máx. 48 px) e é rejeitado se o destino for água/árvore/fora do mapa. Movimento inválido gera `player:correct` (o cliente volta à posição real); 20 infrações desconectam o jogador.
- **Persistência**: posição salva ao desconectar e a cada 15 s.
