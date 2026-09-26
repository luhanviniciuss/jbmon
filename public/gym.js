// ============================================================================
// GymScene — interior do Ginásio: um salão com PORTAIS para os outros mundos (Cidade, Bioma de Gelo, Vulcão).
// Como o laboratório, é uma sala só do jogador. O servidor manda: confere a porta na entrada e só ele troca de mundo.
// Fluxo: WorldScene (porta do ginásio) → 'gym:enter' → 'gym:entered' → GymScene → tocar num portal → 'gym:travel'
// → servidor troca o mundo → 'world:enter' (o WorldScene fecha esta cena). Saída pela porta de baixo: 'gym:exit'.
// ============================================================================
const GYM_PORTALS = [
  { world: 'town', x: 130, label: 'CIDADE', sub: 'Segura · sem selvagens', color: 0xffd54a },
  { world: 'ice', x: 320, label: 'BIOMA DE GELO', sub: 'Lv. 80–200 · Gelo e Água', color: 0x7fe3ff },
  { world: 'lava', x: 510, label: 'VULCÃO', sub: 'Lv. 300–500 · Fogo e Terra', color: 0xff6a2a },
];
const GYM_PORTAL_Y = 176;

class GymScene extends Phaser.Scene {
  constructor() { super('Gym'); }

  create() {
    this.world = window.worldScene;
    this.socket = this.world.socket;
    this.leaving = false;
    this.traveling = false;
    this.target = null;
    this.portals = [];

    this.cameras.main.setBackgroundColor('#070b16');
    this.fit();
    this.scale.on('resize', this.fit, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fit, this));

    this.drawHall();
    GYM_PORTALS.forEach((p) => this.drawPortal(p));

    this.player = this.add.sprite(320, 410, 'player', 'down0').setDepth(10);
    this.dir = 'down';
    this.shadow = this.add.image(320, 422, 'shadow').setDepth(9);
    this.nameTag = this.add.text(320, 384, tagged($('hudName').textContent, MY_CLAN), { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(20);

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT', false); // false = não captura (o chat continua digitando)
    this.input.on('pointerdown', (p, over) => {
      if (this.leaving || this.traveling) return;
      if (over && over.length) return;
      this.target = { x: Phaser.Math.Clamp(p.worldX, 24, 616), y: Phaser.Math.Clamp(p.worldY, 132, 474) };
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
  drawHall() {
    const g = this.add.graphics().setDepth(0);
    // piso de lajotas de pedra
    for (let y = 112; y < 480; y += 48) for (let x = 0; x < 640; x += 64) g.fillStyle(((x / 64) + (y / 48)) % 2 ? 0x2a3145 : 0x252c3f).fillRect(x, y, 64, 48);
    g.lineStyle(1, 0x3a4463, 0.9);
    for (let x = 0; x <= 640; x += 64) g.lineBetween(x, 112, x, 480);
    for (let y = 112; y <= 480; y += 48) g.lineBetween(0, y, 640, y);
    // tapete vermelho da porta até o salão
    g.fillStyle(0x8f1f34).fillRect(292, 230, 56, 250);
    g.fillStyle(0xd8b04a).fillRect(292, 230, 3, 250).fillRect(345, 230, 3, 250);
    // emblema central (arena de desafios)
    g.lineStyle(4, 0xd8b04a, 0.9).strokeCircle(320, 310, 78);
    g.lineStyle(2, 0xd8b04a, 0.6).strokeCircle(320, 310, 62);
    g.fillStyle(0xd8b04a, 0.9).fillTriangle(330, 262, 304, 316, 322, 316).fillTriangle(310, 358, 336, 304, 318, 304); // raio
    // parede de fundo: blocos de pedra
    g.fillStyle(0x323b57).fillRect(0, 0, 640, 112);
    for (let y = 0; y < 112; y += 28) for (let x = (y / 28) % 2 ? 0 : -32; x < 640; x += 64) {
      g.fillStyle(0x3b4566).fillRect(x + 2, y + 2, 60, 24);
      g.fillStyle(0x475380).fillRect(x + 2, y + 2, 60, 3);
    }
    g.fillStyle(0x1c2236).fillRect(0, 104, 640, 8);
    // paredes laterais e de baixo (com o vão da porta)
    g.fillStyle(0x323b57).fillRect(0, 112, 14, 368).fillRect(626, 112, 14, 368);
    g.fillStyle(0x475380).fillRect(14, 112, 3, 368).fillRect(623, 112, 3, 368);
    g.fillStyle(0x323b57).fillRect(0, 456, 288, 24).fillRect(352, 456, 288, 24);
    g.fillStyle(0x263048).fillRect(280, 448, 80, 32);
    g.fillStyle(0x2ecc71, 0.85).fillRect(288, 458, 64, 22);
    g.fillStyle(0x0b1020).fillRect(316, 458, 8, 22);
    const exit = this.add.text(320, 440, '▼ SAÍDA', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#b9ffd8', backgroundColor: '#0b1020cc', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(2);
    this.tweens.add({ targets: exit, alpha: 0.45, yoyo: true, repeat: -1, duration: 900 });
    // pilares e tochas
    [[60, 250], [580, 250], [60, 380], [580, 380]].forEach(([x, y]) => {
      g.fillStyle(0x4a5478).fillRect(x - 12, y - 34, 24, 68).fillStyle(0x5c6892).fillRect(x - 12, y - 34, 6, 68).fillStyle(0x2c3550).fillRect(x - 16, y + 30, 32, 8).fillRect(x - 16, y - 40, 32, 8);
      const fire = this.add.circle(x, y - 46, 7, 0xffa53a, 0.9).setDepth(3);
      this.tweens.add({ targets: fire, scale: 1.5, alpha: 0.5, yoyo: true, repeat: -1, duration: 260 + Math.random() * 200 });
      this.add.circle(x, y - 46, 16, 0xff7a28, 0.12).setDepth(2);
    });
    this.add.text(320, 62, 'GINÁSIO', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#ffe9a8', stroke: '#1c2236', strokeThickness: 5 }).setOrigin(0.5).setDepth(3);
    this.add.text(320, 88, 'Escolha um portal', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', color: '#c8cff0' }).setOrigin(0.5).setDepth(3);
  }

  drawPortal(p) {
    const cx = p.x, cy = GYM_PORTAL_Y;
    const glow = this.add.circle(cx, cy, 58, p.color, 0.16).setDepth(1);
    this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.06, yoyo: true, repeat: -1, duration: 1100 });
    const g = this.add.graphics().setDepth(2);
    g.fillStyle(0x0b1020).fillCircle(cx, cy, 40);
    g.lineStyle(6, p.color, 1).strokeCircle(cx, cy, 42);
    g.lineStyle(2, 0xffffff, 0.7).strokeCircle(cx, cy, 46);
    const spin = this.add.container(cx, cy).setDepth(3); // o giro é em torno do centro do portal
    const sg = this.add.graphics();
    for (let i = 0; i < 3; i++) sg.lineStyle(4, p.color, 0.85 - i * 0.2).beginPath().arc(0, 0, 30 - i * 9, i, i + 3.2).strokePath();
    spin.add(sg);
    this.tweens.add({ targets: spin, angle: 360, duration: 3200, repeat: -1 });
    this.add.text(cx, cy - 66, p.label, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020cc', padding: { x: 7, y: 2 } }).setOrigin(0.5).setDepth(4);
    this.add.text(cx, cy + 62, p.sub, { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '10px', color: '#dfe6ff', backgroundColor: '#0b102099', padding: { x: 5, y: 1 } }).setOrigin(0.5).setDepth(4);
    this.portals.push({ ...p, y: cy });
  }

  // ---------------------------------------------------------------- saída e viagem
  leave() {
    if (this.leaving || this.traveling) return;
    this.leaving = true;
    this.target = null;
    this.socket.emit('gym:exit'); // o WorldScene fecha esta cena ao receber 'gym:exited'
  }

  travel(p) {
    if (this.traveling || this.leaving) return;
    this.traveling = true;
    this.target = null;
    this.cameras.main.flash(500, 255, 255, 255);
    this.socket.emit('gym:travel', p.world); // o servidor troca o mundo; o WorldScene fecha esta cena em 'world:enter'
    this.time.delayedCall(4000, () => { if (this.scene.isActive()) { this.traveling = false; } }); // sem resposta: destrava
  }

  // ---------------------------------------------------------------- loop
  update(time, delta) {
    if (!this.player || this.leaving || this.traveling) return;
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
    for (const pt of this.portals) if (Math.hypot(p.x - pt.x, p.y - pt.y) < 34) return this.travel(pt);
    if (p.y >= LAB_DOOR.y && p.x > LAB_DOOR.x0 && p.x < LAB_DOOR.x1) this.leave();
  }

  moveBy(dx, dy) {
    const p = this.player;
    const inDoorX = p.x > LAB_DOOR.x0 + 8 && p.x < LAB_DOOR.x1 - 8;
    const okAt = (x, y) => x >= 24 && x <= 616 && y >= 134 && y <= (inDoorX ? 478 : 442);
    const bx = p.x, by = p.y;
    if (okAt(p.x + dx, p.y)) p.x += dx;
    if (okAt(p.x, p.y + dy)) p.y += dy;
    const mx = p.x - bx, my = p.y - by, moved = Math.hypot(mx, my) > 0.05;
    if (moved) this.dir = dirOf(mx, my);
    p.setFrame(avatarFrame(this.dir, moved, this.time.now));
  }
}
