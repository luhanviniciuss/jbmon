# Publicar o JBMon num VPS (Ubuntu 22.04 / 24.04)

O jogo é **um único processo Node** (o mundo fica na memória) que grava os jogadores num arquivo **SQLite** em disco.
Isso combina bem com um VPS: 1 vCPU e 1 GB de RAM bastam para algumas dezenas de jogadores.
O guia usa **systemd** (mantém o jogo ligado e reinicia se cair) e **Caddy** (HTTPS automático, já com WebSocket).

> Os comandos abaixo são o caminho padrão, mas eu não tenho como testá-los no seu VPS. Vá copiando um bloco por vez e
> confira a saída antes de seguir.

## 0. Antes de tudo
- Um domínio (ou subdomínio, ex.: `jogo.seudominio.com`) com um registro **A** apontando para o IP do VPS.
  Sem domínio dá para jogar por `http://IP:3000`, mas as senhas viajariam sem HTTPS: não recomendado.
- Acesso SSH ao VPS. Prefira **chave SSH** e desative login por senha do root.

## 1. Sistema, firewall e Node 22
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw unattended-upgrades

# Firewall: só SSH, HTTP e HTTPS (a porta 3000 fica fechada; quem acessa é o Caddy)
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable

# Node 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # deve mostrar v22.x
```

## 2. Usuário do serviço, código e banco
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin jbmon
sudo mkdir -p /opt/jbmon /var/lib/jbmon
sudo chown jbmon:jbmon /opt/jbmon /var/lib/jbmon

# Código (se o repositório for privado, use um token/deploy key do GitHub)
sudo -u jbmon git clone https://github.com/luhanviniciuss/jbmon.git /opt/jbmon
cd /opt/jbmon && sudo -u jbmon npm install
```

Crie o `.env` de produção (o banco fica **fora** da pasta do código, em `/var/lib/jbmon`):
```bash
sudo -u jbmon tee /opt/jbmon/.env > /dev/null <<EOF
DATABASE_URL="file:/var/lib/jbmon/jbmon.db?connection_limit=1&socket_timeout=15"
JWT_SECRET="$(openssl rand -hex 32)"
PORT=3000
EOF
sudo chmod 600 /opt/jbmon/.env
```
> Guarde o `JWT_SECRET`: trocá-lo desloga todo mundo (as contas continuam).

## 3. Serviço systemd
```bash
sudo cp /opt/jbmon/deploy/jbmon.service /etc/systemd/system/jbmon.service
sudo systemctl daemon-reload
sudo systemctl enable --now jbmon
sudo systemctl status jbmon --no-pager
journalctl -u jbmon -n 30 --no-pager   # procure: "SQLite: journal_mode=wal", "Servidor em", "Backup do banco"
curl -s localhost:3000/healthz          # {"ok":true,...}
```
Na primeira subida o `npm start` cria as tabelas no banco (`prisma db push`).

## 4. HTTPS com Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp /opt/jbmon/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # troque jogo.seudominio.com pelo seu domínio
sudo systemctl reload caddy
```
Abra `https://seu-dominio` e jogue. O certificado é emitido e renovado sozinho.

## 5. Atualizar o jogo
```bash
cd /opt/jbmon
sudo -u jbmon git pull
sudo -u jbmon npm install
sudo systemctl restart jbmon
```
Ao reiniciar, o servidor recebe `SIGTERM` e **salva tudo** antes de sair. Os jogadores reconectam sozinhos (o mundo em memória,
como o boss ativo, recomeça; a agenda de 3 h em 3 h do boss é guardada no banco e continua).

## 6. Backups (não pule esta parte)
- O jogo já faz um **backup do banco a cada hora** em `/var/lib/jbmon/backups/` (mantém os 48 mais recentes).
- Isso protege contra corrupção, **não contra perder o VPS**. Copie para fora do servidor com frequência, por exemplo
  uma vez por dia, com o cron do **seu computador** (ou outro servidor):
  ```bash
  rsync -az usuario@IP:/var/lib/jbmon/backups/ ~/backups-jbmon/
  ```
  e ative os **snapshots/backups automáticos do provedor** do VPS (a maioria cobra pouco por isso).
- Backup em JSON, independente do formato do banco (as senhas continuam em hash):
  ```bash
  cd /opt/jbmon && sudo -u jbmon npm run --silent export > /tmp/jbmon.json
  ```
- **Restaurar** um backup:
  ```bash
  sudo systemctl stop jbmon
  sudo -u jbmon cp /var/lib/jbmon/backups/backup-AAAA-MM-DD-HH-MM.db /var/lib/jbmon/jbmon.db
  sudo rm -f /var/lib/jbmon/jbmon.db-wal /var/lib/jbmon/jbmon.db-shm
  sudo systemctl start jbmon
  ```

## 7. Levar seu banco local (contas atuais) para o VPS
No seu computador, com o servidor local **parado**, copie `prisma/dev.db` e envie:
```bash
scp prisma/dev.db usuario@IP:/tmp/jbmon.db
```
No VPS: `sudo systemctl stop jbmon && sudo cp /tmp/jbmon.db /var/lib/jbmon/jbmon.db && sudo chown jbmon:jbmon /var/lib/jbmon/jbmon.db && sudo systemctl start jbmon`.
(Pule esta etapa para começar com o mundo limpo.)

## Manutenção do dia a dia
| Preciso de… | Comando |
|---|---|
| Ver os logs ao vivo | `journalctl -u jbmon -f` |
| Reiniciar | `sudo systemctl restart jbmon` |
| Saber se está saudável | `curl -s localhost:3000/healthz` |
| Espaço em disco | `df -h /var/lib/jbmon` |
| Testar o boss sem esperar 3 h | edite `/opt/jbmon/.env`, adicione `BOSS_FIRST_DELAY_MIN=1` e `BOSS_INTERVAL_MIN=1`, reinicie; depois remova as duas linhas |

## Limites e cuidados
- **Uma instância só**: o SQLite e o mundo em memória não funcionam com vários processos. Para crescer, o caminho é um VPS maior
  (mais CPU/RAM), não mais cópias.
- Mantenha o sistema atualizado (`unattended-upgrades` já cuida das correções de segurança) e não rode o jogo como root.
- Os sprites vêm do GitHub (PokeAPI) e o Phaser da jsDelivr; os jogadores precisam de internet normal.
- Se um dia o deploy trouxer uma mudança de banco que apagaria dados, o `prisma db push` recusa e o serviço não sobe:
  seus dados ficam intactos (veja `journalctl -u jbmon`).
