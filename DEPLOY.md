# Publicar o JBMon no Render

O jogo guarda o mundo (Pokémon selvagens, boss, grupos, raids) na memória de **um** processo e grava os jogadores
num arquivo SQLite. Por isso no Render ele precisa de:

- **Web Service com plano pago** (o gratuito dorme após 15 min sem tráfego e apaga o disco a cada reinício);
- **Disco persistente** montado em `/var/data` (é onde ficam o banco e os backups);
- **Uma única instância** (não use "scale"; o SQLite e o mundo em memória não funcionam com várias).

Confira os preços atuais na página de Pricing do Render (web service do menor plano pago + disco de 1 GB).

## Caminho A: Blueprint (recomendado, tudo configurado pelo `render.yaml`)

1. Envie o código para o GitHub (`git push`).
2. No Render: **New → Blueprint**, escolha o repositório `luhanviniciuss/jbmon` e o branch `main`.
3. Ele lê o `render.yaml`: cria o projeto **pokemon** / ambiente **Production**, o serviço **jbmon**, o disco de 1 GB e as
   variáveis (`DATABASE_URL`, `NODE_VERSION` e um `JWT_SECRET` aleatório gerado pelo Render).
4. Clique em **Apply** e espere o deploy. A URL será algo como `https://jbmon.onrender.com`.

Se você já criou o projeto **pokemon** na tela que abriu, tudo bem: o Blueprint usa esse nome. Se ele criar um projeto duplicado,
apague o vazio depois.

## Caminho B: manual (se preferir clicar)

No projeto **pokemon → Production**: **New → Web Service** → conecte o repositório e preencha:

| Campo | Valor |
|---|---|
| Language / Runtime | Node |
| Branch | `main` |
| Region | Virginia (US East) ou Ohio, as mais próximas do Brasil |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | o menor plano **pago** (precisa para o disco) |
| Health Check Path | `/healthz` |

Em **Advanced**:
- **Add Disk**: Name `jbmon-data`, Mount Path `/var/data`, Size `1 GB`.
- **Environment Variables**:
  - `NODE_VERSION` = `22`
  - `DATABASE_URL` = `file:/var/data/jbmon.db?connection_limit=1&socket_timeout=15`
  - `JWT_SECRET` = um texto longo e aleatório (ex.: 40+ caracteres). Não reutilize o do `.env` local.

## O que acontece no deploy

- `npm install` instala tudo e gera o Prisma Client.
- `npm start` roda `prisma db push` (cria/atualiza as tabelas **no disco**, por isso é feito ao iniciar e não no build,
  já que o disco não existe durante o build) e liga o servidor.
- O servidor ativa SQLite em modo WAL com `synchronous=FULL`, salva a posição a cada 5 s e grava cada turno numa transação.
- Quando o Render reinicia ou faz deploy, ele manda `SIGTERM`: o jogo salva tudo antes de sair.
- Backups automáticos (na inicialização e a cada hora) ficam em `/var/data/backups/` (48 mais recentes).
- Como há disco, o Render **para a instância antiga antes de ligar a nova**: no deploy o jogo fica fora do ar por alguns segundos
  (e o mundo em memória, como o boss ativo, reinicia). Os jogadores e seus Pokémon não se perdem.

## Depois de publicar

1. Abra a URL, crie uma conta e jogue. Abra em outra aba com outra conta para testar o multiplayer.
2. Os logs aparecem na aba **Logs** do serviço. Procure por `SQLite: journal_mode=wal` e `Backup do banco`.
3. **Baixar o banco / backups**: aba **Shell** do serviço (ou SSH): `ls /var/data /var/data/backups`.
   Copie um backup para fora com `scp`/SSH regularmente; o disco protege contra reinício, mas não contra apagar o serviço.
4. **Restaurar** um backup: pare o serviço, copie o arquivo `backup-….db` por cima de `/var/data/jbmon.db` e ligue de novo.

## Testar o boss sem esperar 3 h

No serviço, **Environment**, adicione `BOSS_FIRST_DELAY_MIN=1` (primeiro boss 1 min após ligar) e, se quiser,
`BOSS_LIFETIME_MIN=120`. Depois remova para voltar ao normal (a cada 3 h).

## Domínio próprio e HTTPS

O HTTPS já vem pronto em `*.onrender.com` (necessário para o WebSocket). Para um domínio próprio: **Settings → Custom Domains**.

## Limites e cuidados

- Uma instância só. Serve bem para dezenas de jogadores; para mais, seria preciso mover o mundo para um armazenamento
  compartilhado (Redis/Postgres), o que é uma mudança grande.
- Mudar o `JWT_SECRET` desloga todo mundo (as contas continuam).
- `prisma db push` recusa mudanças que apagariam dados: se um dia isso acontecer no deploy, o serviço não sobe e os dados ficam intactos.
- Os sprites vêm do GitHub (PokeAPI) e o Phaser da jsDelivr; os jogadores precisam de internet normal.
