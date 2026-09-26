// ============================================================================
// LabScene — interior do Centro Pokémon: Laboratório de Cura Especial.
// Sala instanciada (só o jogador vê). A cena é só interface e movimento local; quem manda em tudo que
// importa é o SERVIDOR: ele confere que você está dentro, roda o temporizador de 15 s e só então grava a cura.
// Fluxo: WorldScene (tile da porta) → 'lab:enter' → 'lab:entered' → LabScene → 'lab:heal' → 'lab:healing' →
// (15 s) → 'lab:healed'.  Saída: porta inferior → 'lab:exit' → 'lab:exited' (WorldScene fecha esta cena).
// ============================================================================
const LAB_W = 640, LAB_H = 480;
const LAB_MACHINE = { x: 120, y: 150, w: 400, h: 170 }; // colisão da máquina
const LAB_DOOR = { x0: 288, x1: 352, y: 446 }; // faixa da saída, na parede de baixo
const LAB_SPEED = 160;

class LabScene extends Phaser.Scene {
  constructor() { super('Lab'); }

  create() {
    this.world = window.worldScene;
    this.socket = this.world.socket;
    this.healing = false;
    this.waiting = false;
    this.leaving = false;
    this.target = null;
    this.pendingHeal = false;
    this.tubes = [];

    this.cameras.main.setBackgroundColor('#070b16');
    this.fit();
    this.scale.on('resize', this.fit, this);

    this.drawRoom();
    this.drawMachine();
    this.drawUi();

    // avatar do jogador (mesma textura do mapa)
    this.player = this.add.sprite(320, 410, 'player').setDepth(10);
    this.shadow = this.add.image(320, 422, 'shadow').setDepth(9);
    this.nameTag = this.add.text(320, 384, tagged($('hudName').textContent, MY_CLAN), { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(20);

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,E');
    this.input.on('pointerdown', (p, over) => {
      if (over && over.length) return;
      if (this.healing || this.waiting || this.leaving) return;
      this.pendingHeal = false;
      this.target = { x: Phaser.Math.Clamp(p.worldX, 24, LAB_W - 24), y: Phaser.Math.Clamp(p.worldY, 132, LAB_H - 6) };
      const ring = this.add.circle(p.worldX, p.worldY, 8, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.9).setDepth(5);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    });

    // respostas do servidor
    this.onHealing = ({ ms }) => this.startHealing(ms);
    this.onHealed = (d) => this.finishHealing(d);
    this.socket.on('lab:healing', this.onHealing);
    this.socket.on('lab:healed', this.onHealed);
    this.events.once('shutdown', () => {
      this.socket.off('lab:healing', this.onHealing);
      this.socket.off('lab:healed', this.onHealed);
      this.scale.off('resize', this.fit, this);
    });

    this.loadTeam();
    this.cameras.main.fadeIn(350, 0, 0, 0);
  }

  // Câmera: a sala 640x480 sempre inteira e centralizada (celular ou desktop)
  fit() {
    const cam = this.cameras.main;
    const z = Math.min(cam.width / LAB_W, cam.height / LAB_H, 1.7);
    cam.setZoom(z);
    cam.centerOn(LAB_W / 2, LAB_H / 2);
  }

  // ---------------------------------------------------------------- cenário
  drawRoom() {
    const g = this.add.graphics().setDepth(0);
    // piso em grade
    g.fillStyle(0x1a2335).fillRect(0, 112, LAB_W, LAB_H - 112);
    for (let y = 112; y < LAB_H; y += 32) for (let x = 0; x < LAB_W; x += 32) {
      g.fillStyle((x / 32 + y / 32) % 2 ? 0x1f2a40 : 0x1b2538).fillRect(x, y, 32, 32);
    }
    g.lineStyle(1, 0x34466a, 0.9);
    for (let x = 0; x <= LAB_W; x += 32) g.lineBetween(x, 112, x, LAB_H);
    for (let y = 112; y <= LAB_H; y += 32) g.lineBetween(0, y, LAB_W, y);
    g.fillStyle(0x2f7fa0, 0.08).fillRect(80, 330, 480, 90); // reflexo de luz

    // parede de fundo (painéis metálicos)
    g.fillStyle(0x39445f).fillRect(0, 0, LAB_W, 112);
    for (let x = 0; x < LAB_W; x += 64) {
      g.fillStyle(0x465575).fillRect(x + 2, 4, 60, 100);
      g.fillStyle(0x536389).fillRect(x + 2, 4, 60, 6);
      g.fillStyle(0x2c3550).fillRect(x + 2, 98, 60, 6);
      g.fillStyle(0x8b97b8);
      [[x + 8, 12], [x + 56, 12], [x + 8, 92], [x + 56, 92]].forEach(([rx, ry]) => g.fillCircle(rx, ry, 2));
    }
    // faixa de alerta
    for (let x = 0; x < LAB_W; x += 24) {
      g.fillStyle(0xf2c230).fillRect(x, 104, 12, 8);
      g.fillStyle(0x15181f).fillRect(x + 12, 104, 12, 8);
    }
    // tubulações
    g.fillStyle(0x6b7a9c).fillRect(0, 22, LAB_W, 10);
    g.fillStyle(0x93a3c8).fillRect(0, 22, LAB_W, 3);
    g.fillStyle(0x2f8f9a).fillRect(0, 46, LAB_W, 8);
    g.fillStyle(0x59c7d1).fillRect(0, 46, LAB_W, 2);
    for (let x = 60; x < LAB_W; x += 120) {
      g.fillStyle(0x3b4664).fillRect(x, 19, 10, 16);
      g.fillStyle(0x1f6b74).fillRect(x + 40, 43, 8, 14);
    }
    [40, 600].forEach((x) => { g.fillStyle(0x6b7a9c).fillRect(x, 0, 12, 104); g.fillStyle(0x93a3c8).fillRect(x, 0, 3, 104); });
    g.lineStyle(3, 0xd96a4a).strokeCircle(46, 76, 9).lineBetween(38, 76, 54, 76).lineBetween(46, 68, 46, 84); // válvula
    // monitores na parede
    [[110, 62], [530, 62]].forEach(([mx, my]) => {
      g.fillStyle(0x0b1020).fillRoundedRect(mx - 34, my - 20, 68, 40, 4);
      g.fillStyle(0x0f3a2a).fillRect(mx - 30, my - 16, 60, 32);
      g.lineStyle(1, 0x3ddc97, 0.9);
      for (let i = 0; i < 4; i++) g.lineBetween(mx - 26, my - 10 + i * 8, mx - 26 + 20 + ((i * 17) % 30), my - 10 + i * 8);
    });
    // paredes laterais e inferior
    g.fillStyle(0x39445f).fillRect(0, 112, 14, LAB_H - 112).fillRect(LAB_W - 14, 112, 14, LAB_H - 112);
    g.fillStyle(0x536389).fillRect(14, 112, 3, LAB_H - 112).fillRect(LAB_W - 17, 112, 3, LAB_H - 112);
    g.fillStyle(0x39445f).fillRect(0, 456, LAB_DOOR.x0, 24).fillRect(LAB_DOOR.x1, 456, LAB_W - LAB_DOOR.x1, 24);
    g.fillStyle(0x536389).fillRect(0, 456, LAB_DOOR.x0, 3).fillRect(LAB_DOOR.x1, 456, LAB_W - LAB_DOOR.x1, 3);
    // porta de saída (brilho verde) + placa
    g.fillStyle(0x263048).fillRect(LAB_DOOR.x0 - 8, 448, LAB_DOOR.x1 - LAB_DOOR.x0 + 16, 32);
    g.fillStyle(0x2ecc71, 0.85).fillRect(LAB_DOOR.x0, 458, LAB_DOOR.x1 - LAB_DOOR.x0, 22);
    g.fillStyle(0x0b1020).fillRect(316, 458, 8, 22);
    const exitTxt = this.add.text(320, 440, '▼ SAÍDA', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#b9ffd8', backgroundColor: '#0b1020cc', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(2);
    this.tweens.add({ targets: exitTxt, alpha: 0.45, yoyo: true, repeat: -1, duration: 900 });
  }

  drawMachine() {
    const M = LAB_MACHINE;
    const g = this.add.graphics().setDepth(2);
    g.fillStyle(0x000000, 0.35).fillEllipse(M.x + M.w / 2, M.y + M.h + 6, M.w + 20, 22);
    g.fillStyle(0x2a3550).fillRoundedRect(M.x, M.y, M.w, M.h, 14);
    g.lineStyle(3, 0x5a6a99).strokeRoundedRect(M.x, M.y, M.w, M.h, 14);
    g.fillStyle(0x1a2236).fillRoundedRect(M.x + 10, M.y + 6, M.w - 20, 22, 6);
    g.fillStyle(0x1a2236).fillRoundedRect(M.x + 10, M.y + 146, M.w - 20, 18, 6);
    this.add.text(320, M.y + 17, 'INCUBADORA POKÉMON', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#9fe8ff' }).setOrigin(0.5).setDepth(3);
    // botões do painel inferior
    [0xe74c3c, 0xf2c230, 0x2ecc71].forEach((c, i) => g.fillStyle(c, 0.9).fillCircle(150 + i * 18, M.y + 155, 5));
    g.fillStyle(0x0a2a1c).fillRoundedRect(270, M.y + 149, 100, 12, 3);
    g.fillStyle(0x3ddc97, 0.9);
    for (let i = 0; i < 7; i++) g.fillRect(276 + i * 13, M.y + 153, 8, 4);

    for (let i = 0; i < 6; i++) {
      const cx = 320 + (i - 2.5) * 62;
      const tube = { cx, led: this.add.circle(cx, M.y + 17, 4, 0x33405f).setDepth(3) };
      g.fillStyle(0x0c1a2c).fillRoundedRect(cx - 24, 184, 48, 100, 10);          // interior escuro
      tube.fluid = this.add.rectangle(cx, 282, 44, 96, 0x33ff99, 0.5).setOrigin(0.5, 1).setScale(1, 0.001).setDepth(3);
      tube.glow = this.add.rectangle(cx, 234, 54, 110, 0x39ff9c, 0).setDepth(2);
      g.fillStyle(0x9fe8ff, 0.12).fillRoundedRect(cx - 24, 184, 48, 100, 10);    // vidro
      g.lineStyle(2, 0x9fe8ff, 0.7).strokeRoundedRect(cx - 24, 184, 48, 100, 10);
      g.fillStyle(0xffffff, 0.22).fillRect(cx - 17, 192, 4, 82);                  // brilho
      g.fillStyle(0x66739a).fillRect(cx - 28, 178, 56, 8).fillRect(cx - 28, 284, 56, 8); // tampas
      this.tubes.push(tube);
    }
    // sensor de proximidade / fila de ícones dos Pokémon é criado em loadTeam()
  }

  drawUi() {
    const M = LAB_MACHINE;
    // barra de progresso (acima da máquina; só aparece durante a cura)
    this.barBg = this.add.graphics().setDepth(6).setVisible(false);
    this.bar = this.add.graphics().setDepth(7).setVisible(false);
    this.barTxt = this.add.text(320, 121, '', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#e8fff3' }).setOrigin(0.5).setDepth(8).setVisible(false);

    // botão CURAR EQUIPE (toque/clique) — também vale a tecla E perto da máquina
    this.btn = this.add.container(320, 346).setDepth(6);
    const bg = this.add.graphics();
    bg.fillStyle(0x1fb872).fillRoundedRect(-110, -19, 220, 38, 12).lineStyle(2, 0x9dffd2).strokeRoundedRect(-110, -19, 220, 38, 12);
    this.btnTxt = this.add.text(0, 0, '🩹 CURAR EQUIPE  [E]', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#04240f' }).setOrigin(0.5);
    this.btn.add([bg, this.btnTxt]);
    this.btn.setSize(220, 38).setInteractive({ useHandCursor: true });
    this.btn.on('pointerdown', () => this.tryHeal());
    this.tweens.add({ targets: this.btn, scale: 1.04, yoyo: true, repeat: -1, duration: 900 });

    // clicar na própria máquina também interage
    const hit = this.add.zone(M.x + M.w / 2, M.y + M.h / 2, M.w, M.h).setInteractive({ useHandCursor: true }).setDepth(4);
    hit.on('pointerdown', () => this.tryHeal());

    this.msg = this.add.text(320, 300, '', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0f3a2acc', padding: { x: 10, y: 5 } }).setOrigin(0.5).setDepth(30).setVisible(false);
  }

  // Ícones dos Pokémon da equipe dentro dos tubos (vermelhos = machucados)
  async loadTeam() {
    try {
      const r = await fetch('/api/party', { headers: { Authorization: `Bearer ${token}` } });
      const { party } = await r.json();
      this.party = party;
      party.slice(0, 6).forEach((p, i) => {
        const tube = this.tubes[i];
        this.world.ensureMon(p.species_id, (key) => {
          if (!this.scene.isActive() || !tube) return;
          tube.icon = this.add.image(tube.cx, 244, key).setScale(0.62).setDepth(4).setAlpha(0.92);
          if (p.current_hp < p.hp) tube.icon.setTint(0xff8f8f);
          tube.hurt = p.current_hp < p.hp;
        });
      });
    } catch { /* sem ícones: a máquina continua funcionando */ }
  }

  // ---------------------------------------------------------------- cura
  near() {
    const M = LAB_MACHINE;
    const dx = Math.max(M.x - this.player.x, 0, this.player.x - (M.x + M.w));
    const dy = Math.max(M.y - this.player.y, 0, this.player.y - (M.y + M.h));
    return Math.hypot(dx, dy) <= 95;
  }

  tryHeal() {
    if (this.healing || this.waiting || this.leaving) return;
    if (!this.near()) { // anda até a frente da máquina e cura ao chegar
      this.target = { x: Phaser.Math.Clamp(this.player.x, 150, 490), y: 392 };
      this.pendingHeal = true;
      return;
    }
    this.waiting = true;
    this.target = null;
    this.socket.emit('lab:heal');
    this.time.delayedCall(2500, () => { if (!this.healing) this.waiting = false; }); // sem resposta: destrava
  }

  startHealing(ms) {
    this.waiting = false;
    this.healing = true;
    this.target = null;
    this.healStart = this.time.now;
    this.healMs = ms;
    this.barBg.setVisible(true); this.bar.setVisible(true); this.barTxt.setVisible(true);
    this.btn.setVisible(false);
    this.tubes.forEach((t, i) => {
      t.led.setFillStyle(0x3dff9c);
      t.fluidTween = this.tweens.add({ targets: t.fluid, scaleY: 1, duration: ms, ease: 'Sine.easeInOut' });
      t.glowTween = this.tweens.add({ targets: t.glow, alpha: { from: 0.05, to: 0.28 }, yoyo: true, repeat: -1, duration: 700, delay: i * 90 });
      if (t.icon) t.iconTween = this.tweens.add({ targets: t.icon, y: 240, yoyo: true, repeat: -1, duration: 900, delay: i * 120 });
    });
    this.bubbles = this.time.addEvent({ delay: 180, loop: true, callback: () => {
      const t = Phaser.Utils.Array.GetRandom(this.tubes);
      const b = this.add.circle(t.cx + Phaser.Math.Between(-14, 14), 276, Phaser.Math.Between(2, 4), 0xc9ffe6, 0.8).setDepth(5);
      this.tweens.add({ targets: b, y: 196, alpha: 0, duration: 1200, onComplete: () => b.destroy() });
    } });
    // vigia: se o servidor não confirmar a cura, libera o jogador em vez de deixá-lo preso
    this.watchdog = this.time.delayedCall(ms + 6000, () => { if (this.healing) { this.stopFx(); toast('A cura não foi confirmada. Tente de novo.'); } });
  }

  stopFx() {
    this.healing = false;
    this.waiting = false;
    this.bubbles?.remove();
    this.watchdog?.remove();
    this.barBg.setVisible(false); this.bar.setVisible(false); this.barTxt.setVisible(false);
    this.btn.setVisible(true);
    this.tubes.forEach((t) => {
      t.fluidTween?.stop(); t.glowTween?.stop(); t.iconTween?.stop();
      t.fluid.setScale(1, 0.001); t.glow.setAlpha(0); t.led.setFillStyle(0x33405f);
      if (t.icon) t.icon.setY(244);
    });
  }

  finishHealing(d) {
    if (d?.balls) setBalls(d.balls);
    if (d?.already) { this.waiting = false; this.flash('Sua equipe já está saudável!'); return; }
    this.stopFx();
    this.cameras.main.flash(500, 190, 255, 220);
    this.tubes.forEach((t) => { if (t.icon) { t.icon.clearTint(); t.hurt = false; this.tweens.add({ targets: t.icon, scale: 0.75, yoyo: true, duration: 250 }); } });
    this.flash('✚ Pokémon curados!');
    toast('Pokémon curados! Equipe com a vida cheia.', true);
  }

  flash(text) {
    this.msg.setText(text).setVisible(true).setAlpha(1);
    this.tweens.add({ targets: this.msg, alpha: 0, delay: 1800, duration: 500, onComplete: () => this.msg.setVisible(false) });
  }

  // ---------------------------------------------------------------- saída
  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.target = null;
    this.socket.emit('lab:exit'); // o WorldScene fecha esta cena ao receber 'lab:exited'
  }

  // ---------------------------------------------------------------- loop
  update(time, delta) {
    if (!this.player || this.leaving) return;
    const k = this.keys, typing = document.activeElement?.tagName === 'INPUT';
    if (this.healing || this.waiting) {
      this.target = null;
    } else {
      let vx = typing ? 0 : (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      let vy = typing ? 0 : (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      if (vx || vy) { this.target = null; this.pendingHeal = false; }
      else if (this.target) {
        const dx = this.target.x - this.player.x, dy = this.target.y - this.player.y, d = Math.hypot(dx, dy);
        if (d < 2) { this.target = null; if (this.pendingHeal) { this.pendingHeal = false; this.tryHeal(); } }
        else { const f = Math.min(1, d / ((delta / 1000) * LAB_SPEED)); vx = (dx / d) * f; vy = (dy / d) * f; }
      }
      const len = Math.hypot(vx, vy);
      if (len > 1) { vx /= len; vy /= len; }
      this.moveBy(vx * LAB_SPEED * (delta / 1000), vy * LAB_SPEED * (delta / 1000));
    }
    if (!typing && Phaser.Input.Keyboard.JustDown(k.E) && this.near()) this.tryHeal();

    const p = this.player;
    this.shadow.setPosition(p.x, p.y + 12);
    this.nameTag.setPosition(p.x, p.y - 26);
    p.setDepth(10 + p.y / 1000);

    if (this.healing) {
      const left = Math.max(0, this.healMs - (time - this.healStart));
      const pct = 1 - left / this.healMs;
      this.barBg.clear().fillStyle(0x0b1020, 0.9).fillRoundedRect(180, 128, 280, 16, 8).lineStyle(2, 0x9fe8ff, 0.8).strokeRoundedRect(180, 128, 280, 16, 8);
      this.bar.clear().fillStyle(0x3dff9c).fillRoundedRect(183, 131, Math.max(2, 274 * pct), 10, 5);
      this.barTxt.setText('Curando… ' + Math.ceil(left / 1000) + 's').setY(119);
    }
    this.btnTxt.setText(this.near() ? '🩹 CURAR EQUIPE  [E]' : '🩹 IR ATÉ A MÁQUINA');

    // porta de saída
    if (p.y >= LAB_DOOR.y && p.x > LAB_DOOR.x0 && p.x < LAB_DOOR.x1) this.leave();
  }

  // Move com colisão simples (paredes e máquina), eixo por eixo para deslizar nas quinas
  moveBy(dx, dy) {
    const p = this.player, M = LAB_MACHINE;
    const inDoorX = p.x > LAB_DOOR.x0 + 8 && p.x < LAB_DOOR.x1 - 8;
    const okAt = (x, y) => {
      const maxY = inDoorX ? LAB_H - 2 : 442;
      if (x < 24 || x > LAB_W - 24 || y < 134 || y > maxY) return false;
      const ins = x > M.x - 10 && x < M.x + M.w + 10 && y > M.y - 4 && y < M.y + M.h + 14; // corpo do avatar
      return !ins;
    };
    if (okAt(p.x + dx, p.y)) p.x += dx;
    if (okAt(p.x, p.y + dy)) p.y += dy;
  }
}
