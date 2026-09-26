// ============================================================================
// ProfScene — interior da casa do Professor Carvalho (Cidade): o Modo História começa aqui.
// Sala só do jogador. Toque no Professor (ou nas Pokébolas da mesa) para conversar: missões, escolha do inicial e dicas.
// Fluxo: WorldScene (porta da casa) → 'prof:enter' → 'prof:entered' → ProfScene → 'prof:exit' → 'prof:exited'.
// ============================================================================
const PROF_DESK = { x: 236, y: 150, w: 168, h: 50 };
const PROF_NPC = { x: 320, y: 212 };

class ProfScene extends Phaser.Scene {
  constructor() { super('Prof'); }

  create() {
    this.world = window.worldScene;
    this.socket = this.world.socket;
    this.leaving = false;
    this.target = null;
    this.pendingTalk = false;

    this.cameras.main.setBackgroundColor('#070b16');
    this.fit();
    this.scale.on('resize', this.fit, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fit, this));

    this.drawRoom();
    this.drawProf();

    this.player = this.add.sprite(320, 410, 'player', 'down0').setDepth(10);
    this.dir = 'down';
    this.shadow = this.add.image(320, 422, 'shadow').setDepth(9);
    this.nameTag = this.add.text(320, 384, tagged($('hudName').textContent, MY_CLAN), { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(20);

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,E', false); // false = não captura (o chat continua digitando)
    this.input.on('pointerdown', (p, over) => {
      if (this.leaving || (over && over.length)) return;
      this.pendingTalk = false;
      this.target = { x: Phaser.Math.Clamp(p.worldX, 24, 616), y: Phaser.Math.Clamp(p.worldY, 132, 474) };
      const ring = this.add.circle(p.worldX, p.worldY, 8, 0xffffff, 0.2).setStrokeStyle(2, 0xffffff, 0.9).setDepth(5);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    });
    this.cameras.main.fadeIn(350, 0, 0, 0);
    // A 1ª vez que o jogador entra e ainda não falou com o Professor: ele já puxa conversa
    this.time.delayedCall(700, () => { if (STORY_STATE && STORY_STATE.chapter === 1 && STORY_STATE.step <= 1) this.talkNow(); });
  }

  fit() {
    const cam = this.cameras.main;
    cam.setZoom(Math.min(cam.width / 640, cam.height / 480, 1.7));
    cam.centerOn(320, 240);
  }

  // ---------------------------------------------------------------- cenário
  drawRoom() {
    const g = this.add.graphics().setDepth(0);
    // piso de tábuas de madeira
    for (let y = 112; y < 480; y += 24) for (let x = 0; x < 640; x += 96) { const off = ((y - 112) / 24) % 2 ? 48 : 0; g.fillStyle(((x + off) / 96 + (y - 112) / 24) % 2 ? 0x74512f : 0x6a4a2b).fillRect(x - off, y, 96, 24); g.lineStyle(1, 0x3f2a16, 0.7).strokeRect(x - off, y, 96, 24); }
    // tapete
    g.fillStyle(0x2f6b8a).fillRoundedRect(200, 250, 240, 150, 14).lineStyle(4, 0xd8b04a).strokeRoundedRect(206, 256, 228, 138, 10);
    g.lineStyle(2, 0xffffff, 0.35).strokeCircle(320, 325, 40);
    // parede de fundo
    g.fillStyle(0xe9dfc8).fillRect(0, 0, 640, 112);
    for (let x = 0; x < 640; x += 32) g.fillStyle(x % 64 ? 0xe2d7bd : 0xede4cf).fillRect(x, 0, 32, 104);
    g.fillStyle(0x8a6238).fillRect(0, 100, 640, 12);
    // janela
    g.fillStyle(0x8a6238).fillRect(276, 20, 88, 62).fillStyle(0x9fd8ff).fillRect(282, 26, 76, 50).fillStyle(0xffffff, 0.5).fillRect(286, 30, 10, 42).fillStyle(0x8a6238).fillRect(318, 26, 4, 50).fillRect(282, 49, 76, 4);
    // estantes de livros
    [[28, 30], [470, 30]].forEach(([sx, sy]) => {
      g.fillStyle(0x6a4a2b).fillRect(sx, sy, 142, 72);
      g.fillStyle(0x4a3018).fillRect(sx + 4, sy + 4, 134, 30).fillRect(sx + 4, sy + 38, 134, 30);
      [sy + 6, sy + 40].forEach((by, r) => { let x = sx + 6; for (let i = 0; i < 12; i++) { const w = 7 + ((i * 5 + r * 3) % 5), h = 20 + ((i * 7) % 9); g.fillStyle([0xe53950, 0x3d8bff, 0xffb02e, 0x3ddc97, 0xb07cff, 0xf4f6ff][(i + r * 2) % 6]).fillRect(x, by + 26 - h, w, h); x += w + 2; } });
    });
    // paredes laterais e de baixo (com o vão da porta)
    g.fillStyle(0x8a6238).fillRect(0, 112, 14, 368).fillRect(626, 112, 14, 368).fillRect(0, 456, 288, 24).fillRect(352, 456, 288, 24);
    g.fillStyle(0x263048).fillRect(280, 448, 80, 32).fillStyle(0x2ecc71, 0.85).fillRect(288, 458, 64, 22).fillStyle(0x0b1020).fillRect(316, 458, 8, 22);
    const exit = this.add.text(320, 440, '▼ SAÍDA', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#b9ffd8', backgroundColor: '#0b1020cc', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(2);
    this.tweens.add({ targets: exit, alpha: 0.45, yoyo: true, repeat: -1, duration: 900 });
    // mesa do Professor (computador e papéis)
    const D = PROF_DESK;
    g.fillStyle(0x000000, 0.3).fillEllipse(D.x + D.w / 2, D.y + D.h + 6, D.w + 16, 14);
    g.fillStyle(0x7a5634).fillRoundedRect(D.x, D.y, D.w, D.h, 8).lineStyle(3, 0x4a3018).strokeRoundedRect(D.x, D.y, D.w, D.h, 8);
    g.fillStyle(0x1c2236).fillRect(D.x + 14, D.y + 6, 44, 30).fillStyle(0x3ddc97, 0.9).fillRect(D.x + 18, D.y + 10, 36, 22).fillStyle(0xf4f6ff).fillRect(D.x + 100, D.y + 10, 30, 22).fillStyle(0x99a5c9).fillRect(D.x + 104, D.y + 14, 22, 2).fillRect(D.x + 104, D.y + 20, 22, 2);
    // globo e planta
    g.fillStyle(0x3b4664).fillRect(62, 170, 6, 40).fillStyle(0x2f7fb8).fillCircle(65, 160, 20).fillStyle(0x3ddc97).fillEllipse(58, 156, 14, 10).fillEllipse(72, 166, 12, 8);
    g.fillStyle(0x8a4b2b).fillRect(566, 190, 26, 22).fillStyle(0x2f9e57).fillCircle(579, 176, 16).fillCircle(568, 186, 11).fillCircle(590, 184, 11);
    // mesa dos iniciais
    g.fillStyle(0x000000, 0.28).fillEllipse(540, 322, 130, 14);
    g.fillStyle(0x7a5634).fillRoundedRect(478, 262, 124, 54, 8).lineStyle(3, 0x4a3018).strokeRoundedRect(478, 262, 124, 54, 8);
    this.starterBalls = [[506, 0x78c850, 'Bulbasaur'], [540, 0xf08030, 'Charmander'], [574, 0x6890f0, 'Squirtle']].map(([x, c, n]) => {
      const glow = this.add.circle(x, 282, 17, c, 0.0).setDepth(2);
      const ball = this.add.graphics().setDepth(3);
      ball.fillStyle(0xe53950).fillCircle(x, 282, 11).fillStyle(0xf4f6ff).fillRect(x - 11, 282, 22, 11).fillStyle(0x1b1f33).fillRect(x - 11, 281, 22, 3).fillStyle(c).fillCircle(x, 282, 4);
      return { glow, x };
    });
    this.add.text(540, 250, 'Iniciais', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#fff', backgroundColor: '#0b1020aa', padding: { x: 5, y: 1 } }).setOrigin(0.5).setDepth(4);
  }

  drawProf() {
    this.profSprite = this.add.sprite(PROF_NPC.x, PROF_NPC.y, 'prof', 'down0').setDepth(9).setScale(1.25);
    this.add.image(PROF_NPC.x, PROF_NPC.y + 16, 'shadow').setDepth(8).setScale(1.3);
    this.add.text(PROF_NPC.x, PROF_NPC.y - 38, 'Prof. Carvalho', { fontFamily: 'Segoe UI, system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#3b4664cc', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(20);
    this.bang = this.add.text(PROF_NPC.x, PROF_NPC.y - 60, '❗', { fontSize: '20px' }).setOrigin(0.5).setDepth(21);
    this.tweens.add({ targets: this.bang, y: PROF_NPC.y - 68, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
    // clique/toque no Professor ou na mesa dos iniciais: anda até perto e conversa
    [this.add.zone(PROF_NPC.x, PROF_NPC.y, 70, 80), this.add.zone(540, 288, 130, 60)].forEach((z) => {
      z.setInteractive({ useHandCursor: true }).setDepth(30);
      z.on('pointerdown', () => this.goTalk());
    });
  }

  // ---------------------------------------------------------------- conversa
  near() { return Math.hypot(this.player.x - PROF_NPC.x, this.player.y - PROF_NPC.y) < 96; }
  goTalk() {
    if (this.leaving) return;
    if (this.near()) return this.talkNow();
    this.target = { x: PROF_NPC.x, y: PROF_NPC.y + 76 };
    this.pendingTalk = true;
  }
  talkNow() {
    this.target = null;
    this.pendingTalk = false;
    Story.talk();
  }

  // ---------------------------------------------------------------- saída
  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.target = null;
    this.socket.emit('prof:exit'); // o WorldScene fecha esta cena ao receber 'prof:exited'
  }

  // ---------------------------------------------------------------- loop
  update(time, delta) {
    if (!this.player || this.leaving) return;
    const k = this.keys, typing = document.activeElement?.tagName === 'INPUT';
    const talking = !$('dialog').hidden || !$('tips').hidden; // durante o diálogo o avatar fica parado
    let vx = typing || talking ? 0 : (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let vy = typing || talking ? 0 : (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (vx || vy) { this.target = null; this.pendingTalk = false; }
    else if (this.target && !talking) {
      const dx = this.target.x - this.player.x, dy = this.target.y - this.player.y, d = Math.hypot(dx, dy);
      if (d < 2) { this.target = null; if (this.pendingTalk) this.talkNow(); }
      else { const f = Math.min(1, d / ((delta / 1000) * LAB_SPEED)); vx = (dx / d) * f; vy = (dy / d) * f; }
    }
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    this.moveBy(vx * LAB_SPEED * (delta / 1000), vy * LAB_SPEED * (delta / 1000));
    if (!typing && Phaser.Input.Keyboard.JustDown(k.E) && this.near() && !talking) this.talkNow();

    const p = this.player;
    this.shadow.setPosition(p.x, p.y + 12);
    this.nameTag.setPosition(p.x, p.y - 26);
    p.setDepth(10 + p.y / 1000);
    this.profSprite.setFrame(avatarFrame('down', false, time));
    // o "!" do Professor só aparece quando há algo a fazer com ele; as Pokébolas brilham na hora de escolher o inicial
    const step = STORY_STATE && STORY[STORY_STATE.chapter - 1]?.steps[STORY_STATE.step];
    this.bang.setVisible(!!step && (step.kind === 'talk' || step.kind === 'starter'));
    this.starterBalls.forEach((b, i) => b.glow.setAlpha(step?.kind === 'starter' ? 0.25 + 0.2 * Math.sin(time / 260 + i) : 0));
    if (p.y >= LAB_DOOR.y && p.x > LAB_DOOR.x0 && p.x < LAB_DOOR.x1) this.leave();
  }

  moveBy(dx, dy) {
    const p = this.player, D = PROF_DESK;
    const inDoorX = p.x > LAB_DOOR.x0 + 8 && p.x < LAB_DOOR.x1 - 8;
    const okAt = (x, y) => {
      if (x < 24 || x > 616 || y < 134 || y > (inDoorX ? 478 : 442)) return false;
      if (x > D.x - 10 && x < D.x + D.w + 10 && y > D.y - 6 && y < D.y + D.h + 16) return false; // mesa
      if (Math.hypot(x - PROF_NPC.x, y - PROF_NPC.y) < 26) return false; // o Professor
      return !(x > 470 && x < 610 && y > 258 && y < 326); // mesa dos iniciais
    };
    const bx = p.x, by = p.y;
    if (okAt(p.x + dx, p.y)) p.x += dx;
    if (okAt(p.x, p.y + dy)) p.y += dy;
    const mx = p.x - bx, my = p.y - by, moved = Math.hypot(mx, my) > 0.05;
    if (moved) this.dir = dirOf(mx, my);
    p.setFrame(avatarFrame(this.dir, moved, this.time.now));
  }
}
