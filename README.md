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
server/chat.js         Chat global, de grupo e sussurros
server/clan.js         Clãs: criar, convidar, cargos, ranking (/api/clan/*)
public/lab.js           Cena do laboratório de cura (LabScene)
server/voip.js         Sinalização da voz do grupo (WebRTC)
public/settings.js     Configurações e VoIP do grupo
server/pvp.js          PvP solo, de grupo e guerra de clãs; rating (/api/pvp/*)
public/arena.js        Arena: clã, desafios, ranking e tela da batalha PvP
server/admin.js        API do painel de administração (/api/admin/*)
server/moderation.js   Bans e silenciamentos ativos (cache do banco)
public/admin.js        Interface do painel admin (só para contas admin)
scripts/make-admin.js  Concede/retira o papel de administrador
server/durable.js      Gravações com retry e fila durável
server/backup.js       Backup periódico do banco
deploy/                Arquivos para VPS (systemd e Caddy); veja DEPLOY.md
scripts/export.js      Exporta contas e Pokémon para JSON (npm run export)
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

**Publicar online (VPS):** veja [DEPLOY.md](DEPLOY.md) (systemd + Caddy com HTTPS automático).

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
- **Nível dos selvagens**: cresce com a distância do Centro (~5 perto, ~30 a 40 no meio do mapa e **até o 60** nos cantos; os selvagens comuns nunca passam do 60 e os lendários são sempre 100). Cada Pokémon derrotado ou capturado renasce ~15 s depois em outro ponto do mapa, seguindo a mesma regra, então o mapa mantém sempre ~94 selvagens, com cerca de 1 em cada 4 acima do nível 45. **Formas evoluídas nunca aparecem abaixo do nível em que a anterior evolui**: Pikachu só a partir do Lv.16 (Pichu evolui no 16), Raichu Lv.32+, Charmeleon 16+, Charizard 36+, Dragonite 55+ etc. (`minLevel` calculado da tabela de evoluções). Adicionei os Pokémon bebê (Pichu, Cleffa, Igglybuff, Smoochum, Elekid, Magby) para isso fazer sentido.
- **Equipe e Box** (tecla P): você **escolhe quais Pokémon formam a equipe de até 6** entre todos os que capturou. Use ▲▼ para reordenar (o 1º entra primeiro em batalha), "Enviar ao box" para tirar alguém e "Colocar na equipe" / "Trocar com alguém…" para trazer um do box. Só dá para mudar fora de batalha e a equipe fica salva no banco (coluna `slot` de cada Pokémon: 1 a 6, ou vazio = box). Capturas entram na equipe se houver vaga, senão vão para o box. Contas antigas ganham a equipe automaticamente (os 6 primeiros capturados).
- **Trocar de Pokémon na batalha** (botão "⇄ Trocar" ou tecla 4, depois 1–6): a troca voluntária **gasta o turno** (o selvagem ataca quem entra). Se o seu Pokémon desmaiar e restar mais de um, **você escolhe quem entra, sem gastar turno**; se restar só um, ele entra sozinho. Quem entra em campo também recebe o EXP cheio da batalha. Vale também na **raid** contra o lendário (a troca voluntária gasta o seu turno e o boss revida em quem entrou; depois de um desmaio você escolhe sem gastar o turno).
- **Progressão**: se todos os da equipe desmaiarem, ela é curada e você volta ao Centro.
- **Centro Pokémon**: a clareira central cura a equipe e repõe Pokébolas comuns até 10.
- Enquanto está em batalha, o servidor ignora movimentos do jogador.
- **Indicador de combate**: quando um jogador encosta num selvagem ou entra numa raid, aparece uma etiqueta vermelha piscando (**⚔ EM COMBATE** / **⚔ EM RAID**) acima do nome dele para todos os outros; ela some quando a luta termina. Quem entra no mundo durante a luta já vê a etiqueta, e no minimapa o ponto dele fica vermelho. O estado vem do servidor (evento player:combat).

## Grupo e Boss lendário (a cada 3 horas)
- **Boss**: a cada 3 h aparece um lendário (sorteado entre os 21, com os mais poderosos como Rayquaza, Kyogre, Groudon e Deoxys bem mais raros; tabela `BOSS_TABLE`) num ponto do mapa, com aura dourada, estrela no minimapa e aviso para todos. O chip do HUD mostra o tempo restante (clique para ir até ele) ou quanto falta para o próximo. Ele espera 30 min por desafiantes. O primeiro aparece 2 min depois de ligar o servidor; a hora do último boss fica no banco, então o intervalo de 3 h continua valendo mesmo depois de reiniciar (para testar, use `BOSS_INTERVAL_MIN` pequeno).
- **Grupo (tecla G)**: o líder convida jogadores online pelo nome (2 a 4 membros). Só grupos de 2+ conseguem iniciar a luta: todos os membros precisam estar perto do boss (~20 tiles) e um deles encostar nele.
- **Fase 1, a luta**: cada membro age na sua vez (25 s por turno) com o Pokémon ativo; o boss revida em quem atacou. O boss é sempre **Lv.100** (avisa se a média do grupo for baixa) e a vida é multiplicada. Se todos forem eliminados, o boss vence e o grupo volta curado ao Centro.
- **Fase 2, a captura**: ao chegar em 15% de HP o boss fica **exausto** e ainda tem vida. Todos ganham muito EXP (a equipe inteira, com evolução) e materiais, e **cada membro tem UMA rodada para lançar uma Pokébola** (bônus de captura ×3 no boss exausto; a Master Ball é garantida). Quem capturar leva o lendário; se ninguém conseguir, ele foge.
- **Testar sem esperar 3 h**: variáveis de ambiente `BOSS_FIRST_DELAY_MIN`, `BOSS_INTERVAL_MIN` e `BOSS_LIFETIME_MIN` (ex.: `BOSS_FIRST_DELAY_MIN=0.1 npm run dev`). A lógica está em `server/raid.js`.

## Chat
- **Canais**: **Global** (todos os jogadores online), **Grupo** (só os membros do seu grupo; a aba aparece quando você está em um) e **sussurro** privado com `/w nome mensagem`. Atalho `/g mensagem` fala com o grupo. Clique no nome de alguém para sussurrar para ele.
- **Como usar**: no PC o painel fica ao lado do minimapa (recolhe com ▾; **Enter** foca o campo). No celular ele é uma gaveta que abre pelo botão 💬 (com contador de mensagens não lidas). Digitar no chat **não move** o personagem. Durante batalhas o chat se esconde e volta ao terminar.
- **Balões de fala**: a mensagem global/de grupo aparece sobre a cabeça de quem falou por ~5 s.
- **Proteções** (`server/chat.js`): até 200 caracteres, caracteres de controle removidos, limite de 5 mensagens seguidas (depois 1 a cada 1,5 s), remetente sempre definido pelo servidor. O histórico do global (últimas 60) fica só na memória e não vai para o banco. O cliente exibe tudo como texto puro (nunca HTML).
- **Nome de usuário**: agora só aceita letras, números e `_` (3 a 16), porque o nome aparece em muitos pontos da interface. Contas antigas continuam funcionando.

## Interface responsiva (mobile-first)
- **Celular** (até 640 px): HUD compacto no topo; Party, Bolsa, Grupo e Chat viram **botões flutuantes de 52 px** no canto inferior direito (alcance do polegar); equipe, bolsa e grupo abrem como gaveta inferior; alvos de toque ≥ 44 px; campos com fonte de 16 px (o iPhone não dá zoom ao digitar); respeita a área segura (notch) e o teclado virtual não cobre o chat (`interactive-widget=resizes-content`).
- **Desktop**: botões em pílulas no topo direito com os atalhos (P, B, G, Enter) e chat fixo.
- Toda tela nova deve ser pensada primeiro para ~375 px e testada nos dois tamanhos.

## Painel de administração
- **Quem é admin**: só contas com papel `admin` no **banco**, concedido por quem tem acesso ao servidor: `npm run make-admin -- nome_da_conta` (`--revoke` para retirar). O papel é conferido no banco a **cada ação**; o cliente não decide nada, e um jogador comum que adultere a tela recebe 403. No VPS: `cd /opt/jbmon && sudo -u jbmon npm run make-admin -- admin`.
- **Onde**: botão 🛡 **Admin** (só aparece para admins), gaveta no celular e painel lateral no PC. Abas:
  - **Jogadores**: online agora e busca de qualquer conta; por jogador: **Ir até**, **Trazer**, **Curar**, **Silenciar** / liberar chat, **Banir** / desbanir e **Expulsar**. Silêncio e ban aceitam duração (5 min a 30 dias ou permanente) e motivo.
  - **Spawn**: cria Pokémon selvagens de **qualquer espécie e nível (1 a 100)**, de 1 a 25, perto de você ou em coordenadas; somem sozinhos (10 min a 4 h) e não deixam substituto se derrotados. Também **chama o boss lendário agora** (sorteio ou espécie escolhida) e limpa os spawns de admin.
  - **Dar**: entrega um Pokémon (nível 1-100) ou itens (bolas, Bolotas, Fragmentos) a um jogador, e cura a equipe dele. Itens e cura são recusados se o jogador estiver em combate (senão o servidor sobrescreveria).
  - **Sistema**: jogadores online, selvagens, memória, tempo no ar, boss atual; **aviso para todos**, teletransporte por coordenadas e a **auditoria** (últimas ações).
- **Punições**: o ban impede login, uso da API e conexão do socket (mesmo com token antigo), expulsa o jogador na hora e **sobrevive a reinícios** (colunas `banned_until` / `muted_until`). Silenciados não conseguem falar em nenhum canal e recebem o motivo. Admins não podem ser banidos/silenciados por outros admins nem por si mesmos.
- **Auditoria**: toda ação fica na tabela `AdminLog` (quem, o quê, alvo e detalhes).
- **Selo ADM** no chat e nomes reservados (`admin`, `moderador`, `gm`, `sistema`…) que jogadores comuns não conseguem registrar.

## Efeitos de golpe e cenários de batalha
- **Efeitos por tipo** (`public/fx.js`, motor de partículas em canvas): cada um dos 17 tipos tem o seu roteiro — Fogo (bola de chamas e explosão), Água (jato e respingo com ondas), Elétrico (raios ramificados e clarão), Planta (folhas em espiral), Gelo (estilhaços e cristal), Lutador (socos com ondas de choque), Veneno (bolhas e poça), Terra (fissuras, pedras e poeira com tremor forte), Voador (cortes de vento e penas), Psíquico (anéis e espiral), Inseto (enxame), Pedra (chuva de pedras), Fantasma (fogos-fátuos), Dragão (chamas em hélice) , Sombrio (fumaça e garras) , Aço (corte em X e faíscas) e Normal (impacto). Golpes **críticos** ficam maiores, com mais partículas e clarão; o atacante avança (golpes físicos) e aparece o **dano flutuante** (dourado = super efetivo, cinza = pouco efetivo).
- Vale para batalha selvagem, **raid** e **PvP** (no PvP o lado do atacante é ajustado para cada jogador). O servidor só manda o tipo do golpe no log; o efeito é só decoração e respeita "reduzir movimento" do sistema.
- **Cenário por bioma**: o servidor deduz o bioma pelos tiles ao redor de onde a luta acontece (`server/biome.js`) e o cliente troca o cenário: **Campo**, **Grama alta** (flores), **Floresta** (pinheiros e raios de luz), **Praia** (mar com ondas e areia), **Lago** (montanhas e água brilhando; também para Pokémon aquáticos), **Praça do Centro Pokémon** (prédios e piso; PvP na clareira) e **Arena lendária** (vulcão e relâmpagos, nas raids). O nome do bioma aparece ao começar a batalha.

## Personagem
- O avatar é uma sprite sheet gerada em código (`drawAvatar` em `public/game.js`): boné com pompom, cabelo, rosto, jaqueta, braços, cinto, calça e tênis, em **4 direções** (frente, costas, esquerda, direita) com **animação de caminhada** (passos alternados, braços balançando e leve balanço do corpo). Você é vermelho; os outros jogadores ganham uma cor de jaqueta (6 opções) escolhida pelo nome, e o avatar também anda no laboratório.

## Laboratório de cura (Centro Pokémon)
- No meio do mapa há um **prédio** (Centro Pokémon, sólido) com a porta no tile central de baixo. Pisar na porta leva ao **laboratório** (cena `LabScene`, `public/lab.js`): sala metálica com piso em grade, tubulações e a **Máquina de Incubação** com 6 tubos de vidro (os Pokémon da equipe aparecem dentro; vermelhos = machucados). A porta verde de baixo devolve você ao mapa, em frente ao prédio.
- **Cura**: toque no botão **CURAR EQUIPE** (ou na máquina, ou tecla **E** perto dela; longe, o avatar anda até lá). Dura **15 s**: os tubos enchem de líquido verde e brilham, o avatar fica parado e uma barra de progresso aparece acima da máquina. Ao terminar, **todos os Pokémon** voltam ao HP máximo, as Pokébolas são repostas até 10 e aparece "Pokémon curados!". Se a equipe já está saudável, o servidor avisa na hora e não gasta os 15 s.
- **Autoridade do servidor**: o servidor confere que você está na porta para entrar, roda o temporizador de 15 s e só então grava a cura (sair antes cancela; desconectar também). Dentro do laboratório você fica oculto no mapa para os outros e não pode ser desafiado nem entrar em raid.
- **A cura automática da clareira foi removida**: agora curar é pelo laboratório. Perder uma batalha selvagem continua curando e levando ao spawn.

## Clãs e PvP
- **Onde**: botão ⚔ **Arena** (atalho K), com as abas **Desafiar**, **Clã** e **Ranking**. Funciona no celular (gaveta) e no PC.
- **Tocar em um jogador** no mapa abre um menu: desafiar 1x1, desafiar grupo (líder), guerra de clãs (líder/oficial), convidar para o grupo ou para o clã, e sussurrar.
- **Minimapa**: os membros do seu grupo aparecem em **verde** com contorno branco (os demais jogadores em azul, em combate em vermelho).
- **Clã**: qualquer jogador cria um (nome 3-16, tag 2-4 letras/números, únicos) e vira **líder**; até **30 membros**; cargos **líder > oficial > membro**. Líder e oficiais convidam (o convidado aceita em até 60 s) e expulsam quem tem cargo menor; só o líder promove/rebaixa, passa a liderança e dissolve. O líder não pode sair sem passar a liderança; clã vazio é apagado. Todas as permissões são conferidas no servidor a cada ação. A **tag** aparece ao lado do nome no mapa e no chat, e há um canal **Clã** no chat (`/c mensagem`).
- **PvP seguro**: todos lutam no **Lv.50** com **cópias** de até 3 Pokémon da equipe (do slot 1 ao 3). Ninguém perde HP, EXP ou Pokémon; só o ranking é gravado. Turnos simultâneos de 30 s (golpe, golpe forte ou troca; quem fica ausente 3 turnos desiste; desconectar = desistir do duelo). Usa a mesma tabela de tipos/críticos da batalha selvagem.
- **Modos**: **Solo 1x1**; **Grupo** (líder do grupo desafia o líder de outro grupo do mesmo tamanho, 2 a 4: o jogador N de um lado enfrenta o N do outro, em paralelo); **Guerra de clãs** (líder/oficial de um clã contra líder/oficial de outro, com um grupo só de membros do clã ou 1x1). Vence o lado com mais duelos ganhos (desempate: mais HP restante).
- **Ranking**: rating estilo Elo (começa em 1000, mínimo 100) em toda luta; guerra de clãs também dá **+30 pontos** ao clã vencedor e **-10** ao perdedor (nunca abaixo de 0). Aba Ranking mostra os 20 melhores jogadores e clãs. **Anti-farm**: as mesmas duas pontas lutando mais de 4 vezes por hora não rendem mais pontos.
- **Persistência**: rating, vitórias/derrotas e pontos do clã gravados numa transação (`durable`); clãs em `Clan`, vínculo em `User.clan_id`/`clan_role`.

## Configurações e voz do grupo
- **Configurações**: toque no seu nome/avatar no topo do HUD (⚙) para abrir a gaveta de configurações (guardadas no aparelho).
- **Voz do grupo (VoIP)**: liga/desliga por um interruptor. Só vale com você em um grupo de 2+ jogadores e com a voz ligada; só ouvem você os membros do seu grupo que também ligaram. Há **silenciar microfone** (também pelo botão 🎙/🔇 que aparece no topo enquanto a voz está ativa), **volume dos colegas** e um anel verde no avatar de quem está falando (painel do grupo e configurações).
- **Como funciona**: WebRTC ponto a ponto (malha, até 4 jogadores): o áudio **não passa pelo servidor**. O servidor (`server/voip.js`) só repassa a sinalização entre membros do mesmo grupo com a voz ligada (confere o grupo a cada mensagem, limita tamanho e taxa). O microfone só é aberto enquanto você está numa chamada e é solto ao sair do grupo ou desligar. Usa STUN público do Google.
- **Requisitos**: navegador com permissão de microfone e **HTTPS** em produção (`localhost` também vale). Sem servidor TURN, redes muito restritivas podem não conectar (a maioria conecta direto).

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
