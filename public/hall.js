// ============================================================================
// HallScene — interior do Salão de Eventos (Cidade, casa da direita): palco com telão, cortinas e fileiras de poltronas.
// Sala só do jogador. O quiz em si roda no overlay DOM (events.js); o telão do palco espelha o estado do evento.
// Fluxo: WorldScene (porta da casa) → 'events:enter' → 'events:entered' → HallScene → 'events:exit' → 'events:exited'.
// ============================================================================
class HallScene extends Phaser.Scene {
  constructor() { super('Hall'); }

  create() {
    this.world = window.worldScene;
    this.socket = this.world.socket;
    this.leaving = false;
    this.target = null;

    this.cameras.main.setBackgroundColor('#0a0714');
    this.fit();
    this.scale.on('resize', this.fit, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fit, this));

    this.drawRoom();

    this.player = this.add.sprite(320, 410, 'player', 'down0').setDepth(10);
    this.dir = 'down';
    this.shadow = this.add.image(320, 422, 'shadow').setDepth(9);
    this.nameTag = this.add.text(320, 384, tagged($('hudName').textContent, MY_CLAN), { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(20);

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT', false); // false = não captura (o chat continua digitando)
    this.input.on('pointerdown', (p, over) => {
      if (this.leaving || (over && over.length)) return;
      this.target = { x: Phaser.Math.Clamp(p.worldX, 24, 616), y: Phaser.Math.Clamp(p.worldY, 216, 474) };
      const ring = this.add.circle(p.worldX, p.worldY, 8, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.9).setDepth(5);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    });
    this.cameras.main.fadeIn(350, 0, 0, 0);
  }

  fit() {
    const cam = this.cameras.main;
    cam.setZoom(Math.min(cam.width / 640, cam.height / 480, 1.7));
    cam.centerOn(320, 240);
  }

  // ---------------------------------------------------------------- cenário
  drawRoom() {
    const g = this.add.graphics().setDepth(0);
    // piso escuro com carpete vermelho central
    g.fillStyle(0x2a2140).fillRect(0, 112, 640, 368);
    for (let y = 112; y < 480; y += 32) for (let x = 0; x < 640; x += 32) if (((x + y) / 32) % 2) g.fillStyle(0x30264a).fillRect(x, y, 32, 32);
    g.fillStyle(0x9c1f3a).fillRect(248, 200, 144, 280).lineStyle(3, 0xf0c453).strokeRect(252, 204, 136, 272);
    // parede de fundo e palco
    g.fillStyle(0x1b1530).fillRect(0, 0, 640, 112);
    g.fillStyle(0x4a2f66).fillRect(0, 100, 640, 12);
    g.fillStyle(0x6b4a2b).fillRect(96, 84, 448, 56).lineStyle(3, 0x3f2a16).strokeRect(96, 84, 448, 56);
    g.fillStyle(0x7a5634).fillRect(96, 84, 448, 8);
    // telão
    g.fillStyle(0x0b1020).fillRoundedRect(150, 8, 340, 72, 8).lineStyle(3, 0xf0c453).strokeRoundedRect(150, 8, 340, 72, 8);
    this.screenGlow = this.add.rectangle(320, 44, 328, 60, 0x2d6cdf, 0.35).setDepth(1);
    this.tweens.add({ targets: this.screenGlow, alpha: 0.15, yoyo: true, repeat: -1, duration: 1200 });
    this.screenTitle = this.add.text(320, 28, '', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '17px', fontStyle: 'bold', color: '#fff', align: 'center', wordWrap: { width: 310 } }).setOrigin(0.5).setDepth(2);
    this.screenSub = this.add.text(320, 58, '', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', color: '#c8d4ff', align: 'center', wordWrap: { width: 310 } }).setOrigin(0.5).setDepth(2);
    // cortinas
    [[0, 1], [552, -1]].forEach(([x]) => {
      g.fillStyle(0x8e1c3a).fillRect(x, 0, 88, 112);
      for (let i = 0; i < 88; i += 14) g.fillStyle(0x6e1430).fillRect(x + i, 0, 5, 112);
    });
    // refletores
    [[130, 0xffe27a], [510, 0x9fd8ff]].forEach(([x, c]) => { const l = this.add.triangle(x, 150, 0, -60, -46, 60, 46, 60, c, 0.12).setDepth(1); this.tweens.add({ targets: l, alpha: 0.03, yoyo: true, repeat: -1, duration: 1500 + x }); });
    // poltronas
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
      if (c >= 3 && c <= 4) continue; // corredor central
      const x = 48 + c * 70 + (c > 4 ? 8 : 0), y = 250 + r * 46;
      g.fillStyle(0x000000, 0.25).fillEllipse(x + 12, y + 30, 32, 8);
      g.fillStyle(0x3a2a68).fillRoundedRect(x, y, 26, 24, 5).fillStyle(0x4d3a8a).fillRoundedRect(x + 2, y - 8, 22, 12, 4);
    }
    // paredes laterais e de baixo (com o vão da porta)
    g.fillStyle(0x4a2f66).fillRect(0, 112, 14, 368).fillRect(626, 112, 14, 368).fillRect(0, 456, 288, 24).fillRect(352, 456, 288, 24);
    g.fillStyle(0x263048).fillRect(280, 448, 80, 32).fillStyle(0x2ecc71, 0.85).fillRect(288, 458, 64, 22).fillStyle(0x0b1020).fillRect(316, 458, 8, 22);
    const exit = this.add.text(320, 440, '▼ SAÍDA', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#b9ffd8', backgroundColor: '#0b1020cc', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(2);
    this.tweens.add({ targets: exit, alpha: 0.45, yoyo: true, repeat: -1, duration: 900 });
    // confete decorativo
    for (let i = 0; i < 22; i++) {
      const c = this.add.rectangle(Phaser.Math.Between(20, 620), Phaser.Math.Between(120, 440), 5, 3, [0xff5d7a, 0xffd54a, 0x5dd6ff, 0x7dff9a][i % 4], 0.5).setDepth(1).setAngle(Phaser.Math.Between(0, 180));
      this.tweens.add({ targets: c, y: c.y + 14, angle: c.angle + 90, yoyo: true, repeat: -1, duration: 1400 + i * 60 });
    }
  }

  // ---------------------------------------------------------------- saída
  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.target = null;
    this.socket.emit('events:exit'); // o WorldScene fecha esta cena ao receber 'events:exited'
  }

  // ---------------------------------------------------------------- loop
  update(time, delta) {
    if (!this.player || this.leaving) return;
    const k = this.keys, typing = document.activeElement?.tagName === 'INPUT';
    let vx = typing ? 0 : (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let vy = typing ? 0 : (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (vx || vy) this.target = null;
    else if (this.target) {
      const dx = this.target.x - this.player.x, dy = this.target.y - this.player.y, d = Math.hypot(dx, dy);
      if (d < 2) this.target = null;
      else { const f = Math.min(1, d / ((delta / 1000) * LAB_SPEED)); vx = (dx / d) * f; vy = (dy / d) * f; }
    }
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    this.moveBy(vx * LAB_SPEED * (delta / 1000), vy * LAB_SPEED * (delta / 1000));

    const p = this.player;
    this.shadow.setPosition(p.x, p.y + 12);
    this.nameTag.setPosition(p.x, p.y - 26);
    p.setDepth(10 + p.y / 1000);
    if (!this.nextScr || time > this.nextScr) {
      this.nextScr = time + 250;
      const s = window.Events?.screen() || { title: '🎉 Salão de Eventos', sub: 'Aguardando o próximo evento' };
      this.screenTitle.setText(s.title);
      this.screenSub.setText(s.sub);
    }
    if (p.y >= LAB_DOOR.y && p.x > LAB_DOOR.x0 && p.x < LAB_DOOR.x1) this.leave();
  }

  moveBy(dx, dy) {
    const p = this.player;
    const inDoorX = p.x > LAB_DOOR.x0 + 8 && p.x < LAB_DOOR.x1 - 8;
    const okAt = (x, y) => x >= 24 && x <= 616 && y >= 216 && y <= (inDoorX ? 478 : 442);
    const bx = p.x, by = p.y;
    if (okAt(p.x + dx, p.y)) p.x += dx;
    if (okAt(p.x, p.y + dy)) p.y += dy;
    const mx = p.x - bx, my = p.y - by, moved = Math.hypot(mx, my) > 0.05;
    if (moved) this.dir = dirOf(mx, my);
    p.setFrame(avatarFrame(this.dir, moved, this.time.now));
  }
}
