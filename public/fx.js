// Efeitos visuais dos golpes (um por tipo de Pokémon) em um canvas sobre o campo de batalha.
// Motor de partículas 2D: cada tipo tem um "roteiro" (projétil, explosão, raios, cortes, anéis…).
// Só decora: o dano e o resultado já vêm prontos do servidor.
const Fx = (() => {
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const r = (a, b) => () => rnd(a, b);
  const pk = (arr) => () => pick(arr);
  const val = (v) => (typeof v === 'function' ? v() : v);

  const YEL = [255, 230, 90], ORG = [255, 150, 40], RED = [255, 80, 40], WHT = [255, 255, 255];
  const BLU = [80, 160, 255], CYA = [140, 230, 255], GRN = [110, 220, 90], PUR = [170, 80, 220];
  const PNK = [255, 110, 180], BRN = [150, 110, 60], GRY = [190, 190, 200];

  function P(o) {
    return Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, life: 500, age: 0, s0: 6, s1: 0, c: WHT, a0: 1, a1: 0, shape: 'circle', rot: 0, vr: 0, add: true, lw: 3, hard: false }, o);
  }

  function drawP(ctx, p) {
    if (p.age < 0) return; // age negativo = ainda não começou (atraso)
    const k = p.age / p.life;
    if (k >= 1) return;
    const s = lerp(p.s0, p.s1, k), a = lerp(p.a0, p.a1, k);
    if (s <= 0 || a <= 0.005) return;
    const col = `rgb(${p.c[0] | 0},${p.c[1] | 0},${p.c[2] | 0})`;
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    switch (p.shape) {
      case 'ring': ctx.lineWidth = p.lw; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke(); break;
      case 'leaf': ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, TAU); ctx.fill(); break;
      case 'puddle': ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.32, 0, 0, TAU); ctx.fill(); break;
      case 'shard': ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.6, s * 0.3); ctx.lineTo(-s * 0.3, 0); ctx.lineTo(-s * 0.6, -s * 0.3); ctx.closePath(); ctx.fill(); break;
      case 'rock': ctx.fillStyle = col; ctx.fillRect(-s / 2, -s / 2, s, s * 0.8); break;
      case 'line': ctx.lineWidth = p.lw; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke(); break;
      case 'crescent': ctx.lineWidth = p.lw; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, s, -1.1, 1.1); ctx.stroke(); break;
      case 'star': {
        ctx.fillStyle = col; ctx.beginPath();
        for (let i = 0; i < 8; i++) { const rr = i % 2 ? s * 0.28 : s; const an = (i * Math.PI) / 4; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
        ctx.closePath(); ctx.fill(); break;
      }
      default: { // círculo: brilhante e macio (ou sólido com hard)
        if (p.hard) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill(); break; }
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
        g.addColorStop(0, col); g.addColorStop(1, `rgba(${p.c[0] | 0},${p.c[1] | 0},${p.c[2] | 0},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- roteiros por tipo
  // frame(S) roda a cada quadro. S.T = progresso 0..1, S.a = atacante, S.b = alvo, S.n = 1 (1.5 em crítico).
  const EFFECTS = {
    normal: {
      dur: 600, hit: 0.3,
      frame(S) {
        if (S.T < 0.3) { const p = S.pos(S.T / 0.3); S.glow(p.x, p.y, 15 * S.n, WHT, 0.6); }
        S.once('i', S.T >= 0.3, () => {
          S.hit(); S.shake(4); S.flash(WHT, 0.25);
          S.burst(S.b.x, S.b.y, 16 * S.n, { speed: r(120, 330), life: r(250, 450), s0: r(3, 6), s1: 0, c: pk([WHT, [255, 240, 200]]), shape: 'line', align: true, drag: 2.5 });
          S.add(P({ x: S.b.x, y: S.b.y, life: 350, s0: 10, s1: 54 * S.n, a0: 0.9, shape: 'ring', lw: 5 }));
          S.add(P({ x: S.b.x, y: S.b.y, life: 260, s0: 40 * S.n, s1: 0, shape: 'star', rot: rnd(0, TAU) }));
        });
      },
    },
    fire: {
      dur: 1000, hit: 0.5,
      frame(S) {
        if (S.T < 0.5) {
          const p = S.pos(S.T / 0.5); S.glow(p.x, p.y, 24 * S.n, [255, 170, 60], 0.9);
          for (let i = 0; i < 3; i++) S.add(P({ x: p.x + rnd(-7, 7), y: p.y + rnd(-7, 7), vx: rnd(-30, 30), vy: rnd(-70, -10), life: rnd(350, 600), s0: rnd(12, 20) * S.n, s1: 2, c: pick([YEL, ORG, RED]), a0: 0.85 }));
        }
        S.once('b', S.T >= 0.5, () => {
          S.hit(); S.shake(6); S.flash([255, 120, 40], 0.3);
          S.burst(S.b.x, S.b.y, 44 * S.n, { speed: r(60, 300), drag: 1.8, life: r(450, 800), s0: r(10, 22), s1: 1, c: pk([YEL, ORG, RED]), a0: 0.9, ay: -60 });
          S.add(P({ x: S.b.x, y: S.b.y, life: 520, s0: 20, s1: 90 * S.n, a0: 0.7, c: ORG }));
        });
      },
    },
    water: {
      dur: 1000, hit: 0.48,
      frame(S) {
        if (S.T < 0.48) {
          const p = S.pos(S.T / 0.48); S.glow(p.x, p.y, 20 * S.n, [70, 150, 255], 0.8);
          for (let i = 0; i < 2; i++) S.add(P({ x: p.x + rnd(-8, 8), y: p.y + rnd(-8, 8), vy: rnd(-20, 40), life: rnd(300, 500), s0: rnd(5, 10) * S.n, s1: 1, c: pick([BLU, CYA, WHT]), a0: 0.9, add: false }));
        }
        S.once('b', S.T >= 0.48, () => {
          S.hit(); S.shake(5);
          S.burst(S.b.x, S.b.y, 36 * S.n, { arc: [-2.6, -0.5], speed: r(120, 330), ay: 520, life: r(500, 800), s0: r(4, 9), s1: 2, c: pk([BLU, CYA, WHT]), a0: 0.95, add: false });
          for (let i = 0; i < 3; i++) S.add(P({ x: S.b.x, y: S.b.y + 14, age: -i * 130, life: 550, s0: 10, s1: 70 * S.n, a0: 0.9, shape: 'ring', lw: 4, c: CYA, add: false }));
        });
      },
    },
    electric: {
      dur: 850, hit: 0.2,
      frame(S) {
        if (S.T < 0.12) S.burst(S.a.x, S.a.y, 2, { speed: r(60, 160), life: r(150, 300), s0: r(4, 8), c: pk([YEL, WHT]), shape: 'star' });
        S.once('b', S.T >= 0.2, () => { S.hit(); S.shake(5); S.flash(YEL, 0.35); });
        if (S.T > 0.12 && S.T < 0.7) {
          S.bolt(S.a.x, S.a.y, S.b.x, S.b.y, 9, 22, YEL, 6 * S.n);
          for (let i = 0; i < 2; i++) S.bolt(S.b.x + rnd(-40, 40), S.b.y - 110, S.b.x + rnd(-20, 20), S.b.y + rnd(0, 20), 6, 16, WHT, 2.5);
          if (Math.random() < 0.5) S.burst(S.b.x + rnd(-30, 30), S.b.y + rnd(-30, 30), 2, { speed: r(80, 220), life: r(120, 260), s0: r(4, 9), c: pk([YEL, WHT]), shape: 'star' });
        }
      },
    },
    grass: {
      dur: 1000, hit: 0.5,
      frame(S) {
        if (S.T < 0.4) for (let i = 0; i < 3; i++) {
          S.add(P({ x: S.a.x + rnd(-10, 10), y: S.a.y + rnd(-10, 10), vx: (S.b.x - S.a.x) / 0.5 + rnd(-50, 50), vy: (S.b.y - S.a.y) / 0.5 + rnd(-50, 50), life: 500, s0: rnd(8, 14) * S.n, s1: rnd(6, 10), c: pick([GRN, [60, 170, 60], [170, 230, 90]]), a0: 1, a1: 0.9, rot: rnd(0, TAU), vr: rnd(-9, 9), shape: 'leaf', add: false }));
        }
        S.once('b', S.T >= 0.5, () => {
          S.hit(); S.shake(4);
          S.burst(S.b.x, S.b.y, 30 * S.n, { speed: r(80, 260), drag: 1.5, ay: 200, life: r(500, 800), s0: r(7, 12), s1: 4, c: pk([GRN, [60, 170, 60], [170, 230, 90]]), shape: 'leaf', add: false, vr: r(-9, 9), rot: r(0, TAU), a0: 1 });
          S.burst(S.b.x, S.b.y, 12, { speed: r(60, 160), life: r(300, 500), s0: r(4, 8), c: [190, 255, 150], shape: 'star' });
        });
      },
    },
    ice: {
      dur: 950, hit: 0.4,
      frame(S) {
        S.once('shoot', true, () => {
          const ang = Math.atan2(S.b.y - S.a.y, S.b.x - S.a.x), d = Math.hypot(S.b.x - S.a.x, S.b.y - S.a.y);
          for (let i = 0; i < 5 * S.n; i++) { const an = ang + rnd(-0.16, 0.16), sp = d / 0.4 + rnd(-40, 40); S.add(P({ x: S.a.x, y: S.a.y + rnd(-8, 8), vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 400, s0: rnd(12, 20), s1: 12, c: pick([CYA, WHT, [170, 220, 255]]), shape: 'shard', rot: an, a0: 1, a1: 0.8 })); }
        });
        S.once('b', S.T >= 0.4, () => {
          S.hit(); S.shake(4); S.flash(CYA, 0.4);
          S.add(P({ x: S.b.x, y: S.b.y, life: 520, s0: 62 * S.n, s1: 0, c: CYA, shape: 'star', rot: rnd(0, TAU) }));
          S.add(P({ x: S.b.x, y: S.b.y, life: 480, s0: 10, s1: 70 * S.n, shape: 'ring', lw: 4, c: CYA }));
          S.burst(S.b.x, S.b.y, 34 * S.n, { speed: r(40, 190), drag: 1.2, ay: 40, life: r(600, 950), s0: r(3, 7), c: pk([WHT, CYA]) });
          S.burst(S.b.x, S.b.y, 14, { speed: r(120, 300), life: r(400, 600), s0: r(9, 15), c: pk([CYA, WHT]), shape: 'shard', align: true, drag: 1.4 });
        });
      },
    },
    fighting: {
      dur: 800, hit: 0.22,
      frame(S) {
        if (S.T < 0.22) { const p = S.pos(S.T / 0.22); S.glow(p.x, p.y, 22 * S.n, ORG, 0.85); }
        [0.22, 0.42, 0.62].forEach((th, i) => S.once('h' + i, S.T >= th, () => {
          S.shake(i === 2 ? 9 : 4);
          const x = S.b.x + rnd(-22, 22), y = S.b.y + rnd(-22, 22);
          S.add(P({ x, y, life: 320, s0: 8, s1: 50 * S.n * (i === 2 ? 1.4 : 1), shape: 'ring', lw: 6, c: pick([ORG, RED, YEL]) }));
          S.add(P({ x, y, life: 250, s0: 36 * S.n, s1: 0, shape: 'star', c: pick([YEL, WHT]), rot: rnd(0, TAU) }));
          S.burst(x, y, 10 * S.n, { speed: r(140, 330), life: r(200, 380), s0: r(4, 8), shape: 'line', align: true, c: pk([YEL, ORG, WHT]), drag: 3 });
          if (i === 2) S.flash(ORG, 0.35);
        }));
      },
    },
    poison: {
      dur: 1000, hit: 0.5,
      frame(S) {
        if (S.T < 0.5) {
          const p = S.pos(S.T / 0.5); S.glow(p.x, p.y, 18 * S.n, PUR, 0.7);
          for (let i = 0; i < 2; i++) S.add(P({ x: p.x + rnd(-8, 8), y: p.y + rnd(-8, 8), vy: rnd(-10, 30), life: rnd(350, 550), s0: rnd(6, 12) * S.n, s1: 2, c: pick([PUR, [190, 90, 230], [120, 200, 80]]), a0: 0.9, add: false }));
        }
        S.once('b', S.T >= 0.5, () => {
          S.hit(); S.shake(4);
          S.burst(S.b.x, S.b.y, 34 * S.n, { arc: [-3.0, -0.15], speed: r(80, 270), ay: 480, life: r(500, 850), s0: r(5, 11), s1: 2, c: pk([PUR, [120, 200, 80], [190, 90, 230]]), a0: 0.95, add: false });
          S.add(P({ x: S.b.x, y: S.b.y + 34, life: 800, s0: 10, s1: 64 * S.n, a0: 0.6, shape: 'puddle', c: PUR, add: false }));
        });
      },
    },
    ground: {
      dur: 1100, hit: 0.28,
      frame(S) {
        S.once('q', S.T >= 0.28, () => {
          S.hit(); S.shake(11);
          S.burst(S.b.x, S.b.y + 20, 22 * S.n, { arc: [-2.4, -0.7], speed: r(240, 500), ay: 950, life: r(600, 950), s0: r(7, 14), s1: 5, c: pk([BRN, [110, 80, 50], GRY]), shape: 'rock', vr: r(-8, 8), rot: r(0, TAU), a0: 1, a1: 0.3, add: false });
          S.burst(S.b.x, S.b.y + 24, 12, { speed: r(40, 140), life: r(500, 850), s0: r(16, 26), s1: 56, c: [200, 170, 120], a0: 0.5, add: false, ay: -30 });
        });
        if (S.T > 0.28 && S.T < 0.95) { // fissuras no chão irradiando do alvo
          const u = clamp01((S.T - 0.28) / 0.35), fade = 1 - clamp01((S.T - 0.7) / 0.25);
          const c = S.ctx; c.save(); c.globalAlpha = 0.85 * fade; c.strokeStyle = '#3a2412'; c.lineWidth = 3; c.lineCap = 'round';
          for (let k = 0; k < 7; k++) {
            const an = (k / 7) * TAU + 0.3; c.beginPath(); let x = S.b.x, y = S.b.y + 26;
            c.moveTo(x, y);
            for (let sgm = 1; sgm <= 5; sgm++) { const len = 16 * sgm * u * S.n; c.lineTo(S.b.x + Math.cos(an + Math.sin(sgm * 5 + k) * 0.25) * len * 1.5, S.b.y + 26 + Math.sin(an + Math.sin(sgm * 5 + k) * 0.25) * len * 0.55); }
            c.stroke();
          }
          c.restore();
        }
      },
    },
    flying: {
      dur: 900, hit: 0.28,
      frame(S) {
        if (S.T < 0.35) {
          const ang = Math.atan2(S.b.y - S.a.y, S.b.x - S.a.x);
          for (let i = 0; i < 2; i++) { const p = S.pos(rnd(0, 1)); S.add(P({ x: p.x, y: p.y + rnd(-16, 16), vx: (S.b.x - S.a.x) * 2.2, vy: (S.b.y - S.a.y) * 2.2, life: 220, s0: rnd(14, 28), s1: 8, shape: 'line', rot: ang, lw: 2, a0: 0.8 })); }
        }
        [0.28, 0.5].forEach((th, i) => S.once('s' + i, S.T >= th, () => {
          if (!i) S.hit();
          S.shake(3);
          const rot = i ? 0.7 : -0.7 + rnd(-0.1, 0.1);
          S.add(P({ x: S.b.x, y: S.b.y, rot, s0: 26, s1: 74 * S.n, life: 340, shape: 'crescent', lw: 8, c: WHT }));
          S.add(P({ x: S.b.x, y: S.b.y, rot, s0: 30, s1: 84 * S.n, life: 380, shape: 'crescent', lw: 3, c: CYA }));
        }));
        S.once('f', S.T >= 0.3, () => S.burst(S.b.x, S.b.y, 12, { speed: r(40, 170), drag: 1, ay: 70, life: r(700, 1000), s0: r(6, 9), c: WHT, shape: 'leaf', add: false, vr: r(-6, 6), rot: r(0, TAU), a0: 0.95 }));
      },
    },
    psychic: {
      dur: 1100, hit: 0.35,
      frame(S) {
        S.once('w', true, () => { for (let i = 0; i < 4; i++) S.add(P({ x: S.b.x, y: S.b.y, age: -i * 160, life: 620, s0: 14, s1: 84 * S.n, a0: 0.9, shape: 'ring', lw: 4, c: i % 2 ? PUR : PNK })); });
        if (S.T < 0.3) S.glow(S.a.x, S.a.y, 26, PNK, 0.6);
        const an = S.t / 110, rad = lerp(96, 12, S.T);
        S.add(P({ x: S.b.x + Math.cos(an) * rad, y: S.b.y + Math.sin(an) * rad * 0.8, life: 240, s0: 9, s1: 2, c: PNK, a0: 0.9 }));
        S.add(P({ x: S.b.x - Math.cos(an) * rad, y: S.b.y - Math.sin(an) * rad * 0.8, life: 240, s0: 9, s1: 2, c: PUR, a0: 0.9 }));
        S.once('h', S.T >= 0.35, () => { S.hit(); S.shake(3); S.flash([255, 120, 200], 0.3); });
      },
    },
    bug: {
      dur: 900, hit: 0.45,
      frame(S) {
        if (S.T < 0.55) for (let i = 0; i < 3; i++) {
          const base = S.pos(Math.min(1, (S.T / 0.45) * rnd(0.85, 1)));
          S.add(P({ x: base.x + rnd(-28, 28), y: base.y + rnd(-28, 28), life: rnd(130, 240), s0: rnd(2, 4) * S.n, s1: 1, c: pick([[210, 230, 60], [160, 200, 40], WHT]), a0: 1, add: false, hard: true }));
        }
        S.once('h', S.T >= 0.45, () => {
          S.hit(); S.shake(3);
          S.burst(S.b.x, S.b.y, 14 * S.n, { speed: r(100, 270), life: r(200, 360), s0: r(5, 8), shape: 'line', align: true, c: pk([[210, 230, 60], WHT]), drag: 3 });
          S.add(P({ x: S.b.x, y: S.b.y, life: 260, s0: 30, s1: 0, shape: 'star', c: [200, 230, 80], rot: rnd(0, TAU) }));
        });
      },
    },
    rock: {
      dur: 1000, hit: 0.38,
      frame(S) {
        const N = Math.round(6 * S.n);
        S.once('drop', true, () => {
          for (let i = 0; i < N; i++) {
            const x = S.b.x + rnd(-52, 52), y0 = S.b.y - 280 - rnd(0, 110), ty = S.b.y + rnd(-12, 12);
            S.add(P({ x, y: y0, age: -i * 70, vy: (ty - y0) / 0.38, life: 380, s0: rnd(11, 18), s1: rnd(11, 18), c: pick([GRY, BRN, [120, 120, 130]]), shape: 'rock', vr: rnd(-6, 6), rot: rnd(0, TAU), a0: 1, a1: 1, add: false }));
            S.rocks = (S.rocks || []).concat([{ x, y: ty, at: i * 70 + 380 }]);
          }
        });
        (S.rocks || []).forEach((k, i) => S.once('l' + i, S.t >= k.at, () => {
          if (i === 0) S.hit();
          S.shake(4);
          S.burst(k.x, k.y, 6, { arc: [-2.8, -0.3], speed: r(80, 220), ay: 700, life: r(300, 500), s0: r(4, 8), c: pk([GRY, BRN]), shape: 'rock', add: false, a0: 1, a1: 0.3, vr: r(-8, 8) });
          S.burst(k.x, k.y + 6, 2, { speed: r(20, 60), life: r(400, 650), s0: r(14, 22), s1: 40, c: [200, 180, 140], a0: 0.45, add: false });
        }));
      },
    },
    ghost: {
      dur: 1100, hit: 0.5,
      frame(S) {
        if (S.T < 0.5) {
          const u = S.T / 0.5, p = S.pos(u), d = Math.hypot(S.b.x - S.a.x, S.b.y - S.a.y) || 1, nx = -(S.b.y - S.a.y) / d, ny = (S.b.x - S.a.x) / d, off = Math.sin(u * 9) * 24;
          [1, -1].forEach((sg) => S.add(P({ x: p.x + nx * off * sg, y: p.y + ny * off * sg, vy: rnd(-30, 0), life: rnd(350, 600), s0: rnd(12, 20) * S.n, s1: 4, c: pick([PUR, [120, 60, 180], [210, 150, 255]]), a0: 0.75 })));
        }
        S.once('b', S.T >= 0.5, () => {
          S.hit(); S.shake(4);
          S.burst(S.b.x, S.b.y, 30 * S.n, { speed: r(40, 180), drag: 1.5, ay: -40, life: r(600, 900), s0: r(10, 20), s1: 3, c: pk([PUR, [120, 60, 180], [210, 150, 255]]), a0: 0.8 });
          S.add(P({ x: S.b.x, y: S.b.y, life: 650, s0: 30, s1: 96 * S.n, c: [50, 20, 90], a0: 0.65, add: false }));
          [-13, 13].forEach((dx) => S.add(P({ x: S.b.x + dx, y: S.b.y - 8, life: 650, s0: 5, s1: 5, c: [255, 80, 120], a0: 1, hard: true })));
        });
      },
    },
    dragon: {
      dur: 1100, hit: 0.5,
      frame(S) {
        if (S.T < 0.5) {
          const u = S.T / 0.5, p = S.pos(u), d = Math.hypot(S.b.x - S.a.x, S.b.y - S.a.y) || 1, nx = -(S.b.y - S.a.y) / d, ny = (S.b.x - S.a.x) / d, off = Math.sin(u * 14) * 22;
          S.glow(p.x, p.y, 22 * S.n, [130, 120, 255], 0.8);
          [1, -1].forEach((sg) => S.add(P({ x: p.x + nx * off * sg, y: p.y + ny * off * sg, life: rnd(300, 500), s0: rnd(9, 15) * S.n, s1: 1, c: sg > 0 ? [90, 150, 255] : [170, 90, 255], a0: 0.9 })));
        }
        S.once('b', S.T >= 0.5, () => {
          S.hit(); S.shake(8); S.flash([120, 90, 255], 0.4);
          S.burst(S.b.x, S.b.y, 50 * S.n, { speed: r(80, 340), drag: 1.6, life: r(500, 900), s0: r(9, 20), s1: 1, c: pk([[90, 150, 255], [170, 90, 255], WHT]) });
          for (let i = 0; i < 2; i++) S.add(P({ x: S.b.x, y: S.b.y, age: -i * 140, life: 560, s0: 12, s1: 84 * S.n, shape: 'ring', lw: 5, c: i ? [170, 90, 255] : [90, 150, 255] }));
        });
      },
    },
    dark: {
      dur: 950, hit: 0.4,
      frame(S) {
        if (S.T < 0.4) { const an = S.t / 80; S.add(P({ x: S.b.x + Math.cos(an) * rnd(30, 60), y: S.b.y + Math.sin(an) * rnd(30, 60) * 0.8, life: rnd(300, 500), s0: rnd(14, 24), s1: 6, c: pick([[60, 30, 90], [30, 20, 50], [110, 40, 120]]), a0: 0.7, add: false })); }
        [0, 1, 2].forEach((i) => S.once('c' + i, S.T >= 0.4 + i * 0.07, () => {
          if (!i) S.hit();
          S.shake(4);
          const ox = (i - 1) * 20, oy = (i - 1) * 8;
          S.add(P({ x: S.b.x + ox, y: S.b.y + oy, rot: -0.9, life: 340, s0: 64 * S.n, s1: 70 * S.n, lw: 10, shape: 'line', c: [255, 60, 90], a0: 0.85 }));
          S.add(P({ x: S.b.x + ox, y: S.b.y + oy, rot: -0.9, life: 300, s0: 62 * S.n, s1: 68 * S.n, lw: 4, shape: 'line', c: WHT }));
        }));
        S.once('e', S.T >= 0.55, () => S.burst(S.b.x, S.b.y, 16, { speed: r(60, 190), drag: 1.5, life: r(400, 700), s0: r(10, 18), s1: 3, c: pk([[60, 30, 90], [110, 40, 120]]), a0: 0.8, add: false }));
      },
    },
    steel: {
      dur: 800, hit: 0.25,
      frame(S) {
        if (S.T < 0.25) { const p = S.pos(S.T / 0.25); S.glow(p.x, p.y, 18 * S.n, [210, 220, 255], 0.8); }
        S.once('x', S.T >= 0.25, () => {
          S.hit(); S.shake(5); S.flash([220, 230, 255], 0.35);
          [-0.8, 0.8].forEach((rot) => S.add(P({ x: S.b.x, y: S.b.y, rot, life: 280, s0: 74 * S.n, s1: 74 * S.n, lw: 8, shape: 'line', c: [225, 232, 255] })));
          S.add(P({ x: S.b.x, y: S.b.y, life: 280, s0: 46 * S.n, s1: 0, shape: 'star', c: WHT, rot: rnd(0, TAU) }));
          S.add(P({ x: S.b.x, y: S.b.y, life: 400, s0: 10, s1: 64 * S.n, shape: 'ring', lw: 4, c: [200, 210, 240] }));
          S.burst(S.b.x, S.b.y, 20 * S.n, { speed: r(160, 390), life: r(250, 450), s0: r(5, 9), shape: 'line', align: true, c: pk([YEL, WHT, [255, 190, 90]]), drag: 2.5 });
        });
      },
    },
  };

  // ---------------------------------------------------------------- motor
  function shake(host, amp) {
    const k = [{ transform: 'translate(0,0)' }];
    for (let i = 0; i < 6; i++) { const f = 1 - i / 6; k.push({ transform: `translate(${rnd(-amp, amp) * f}px,${rnd(-amp, amp) * f}px)` }); }
    k.push({ transform: 'translate(0,0)' });
    host.animate(k, { duration: 280, easing: 'linear' });
  }

  function play(canvas, type, fromEl, toEl, opts = {}) {
    return new Promise((resolve) => {
      if (!canvas || !fromEl || !toEl || matchMedia('(prefers-reduced-motion: reduce)').matches) { opts.onHit?.(); return resolve(); }
      const E = EFFECTS[type] || EFFECTS.normal;
      const host = canvas.parentElement, hr = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(hr.width * dpr);
      canvas.height = Math.round(hr.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ctr = (el) => { const b = el.getBoundingClientRect(); return { x: b.left - hr.left + b.width / 2, y: b.top - hr.top + b.height / 2 }; };
      const a = ctr(fromEl), b = ctr(toEl);
      const n = opts.crit ? 1.5 : 1;
      const parts = [], flags = {};
      let flash = null, hitDone = false, t0 = 0, last = 0, done = false;
      const S = {
        ctx, a, b, n, T: 0, t: 0, dur: E.dur,
        add: (p) => parts.push(p),
        pos: (u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) }),
        once: (k, cond, fn) => { if (cond && !flags[k]) { flags[k] = 1; fn(); } },
        hit: () => { if (!hitDone) { hitDone = true; opts.onHit?.(); } },
        shake: (amp) => shake(host, amp * (opts.crit ? 1.4 : 1)),
        flash: (c, al) => { flash = { c, a: al * (opts.crit ? 1.3 : 1) }; },
        burst: (x, y, cnt, o) => {
          for (let i = 0; i < cnt; i++) {
            const ang = o.arc ? rnd(o.arc[0], o.arc[1]) : rnd(0, TAU), sp = val(o.speed) ?? 150, q = {};
            for (const key in o) if (key !== 'arc' && key !== 'speed' && key !== 'align') q[key] = val(o[key]);
            parts.push(P({ ...q, x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: o.align ? ang : q.rot ?? 0 }));
          }
        },
        glow: (x, y, s, c, al = 0.8) => { drawP(ctx, P({ x, y, s0: s, s1: s, c, a0: al, a1: al })); },
        bolt: (x0, y0, x1, y1, seg, jit, c, w) => {
          const pts = [[x0, y0]];
          for (let i = 1; i < seg; i++) { const u = i / seg; pts.push([lerp(x0, x1, u) + rnd(-jit, jit), lerp(y0, y1, u) + rnd(-jit, jit)]); }
          pts.push([x1, y1]);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          [[w * 2.6, 0.25, c], [w, 0.95, WHT]].forEach(([lw, al, col]) => {
            ctx.globalAlpha = al; ctx.lineWidth = lw; ctx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
            ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
          });
          ctx.restore();
        },
      };
      const finish = () => { if (done) return; done = true; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); resolve(); };
      const step = (now) => {
        if (done) return;
        if (!t0) { t0 = now; last = now; }
        const dt = Math.min(50, now - last); last = now;
        S.t = now - t0;
        S.T = clamp01(S.t / E.dur);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, hr.width, hr.height);
        if (S.t < E.dur) E.frame(S);
        if (!hitDone && S.T >= (E.hit ?? 0.5)) S.hit(); // garante o gancho de impacto
        const s = dt / 1000;
        for (const p of parts) {
          p.age += dt;
          if (p.age < 0) continue;
          p.vx += p.ax * s; p.vy += p.ay * s;
          if (p.drag) { const f = Math.max(0, 1 - p.drag * s); p.vx *= f; p.vy *= f; }
          p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
        }
        for (const p of parts) drawP(ctx, p);
        for (let i = parts.length - 1; i >= 0; i--) if (parts[i].age >= parts[i].life) parts.splice(i, 1);
        if (flash) {
          flash.a *= 0.86;
          if (flash.a < 0.01) flash = null;
          else { ctx.globalAlpha = flash.a; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgb(${flash.c[0]},${flash.c[1]},${flash.c[2]})`; ctx.fillRect(0, 0, hr.width, hr.height); }
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        if (S.t < E.dur || parts.some((p) => p.age < p.life) || flash) requestAnimationFrame(step); else finish();
      };
      requestAnimationFrame(step);
      setTimeout(finish, E.dur + 2000); // rede de segurança
    });
  }

  // ---------------------------------------------------------------- golpe completo: avanço, efeito, dano flutuante
  const PHYSICAL = new Set(['normal', 'fighting', 'bug', 'steel', 'dark', 'flying', 'ground', 'rock']);

  function lunge(el, toEl, dist) {
    const a = el.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), d = Math.hypot(dx, dy) || 1;
    const x = (dx / d) * dist, y = (dy / d) * dist;
    el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${x}px,${y}px)`, offset: 0.35 }, { transform: 'translate(0,0)' }], { duration: 360, easing: 'ease-out' });
  }

  function pop(host, targetEl, text, cls) {
    const hr = host.getBoundingClientRect(), b = targetEl.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'dmgpop ' + cls;
    el.textContent = text;
    el.style.left = b.left - hr.left + b.width / 2 + rnd(-14, 14) + 'px';
    el.style.top = b.top - hr.top + b.height * 0.25 + 'px';
    host.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // canvas, {type}, elemento atacante, elemento alvo, {crit, dmg, eff, lunge}
  async function attack(canvas, atk, fromEl, toEl, o = {}) {
    if (!fromEl || !toEl) return;
    if (o.lunge !== false) lunge(fromEl, toEl, PHYSICAL.has(atk.type) ? 46 : 10);
    await play(canvas, atk.type, fromEl, toEl, {
      crit: o.crit,
      onHit: () => {
        if (!o.dmg) return;
        pop(canvas.parentElement, toEl, '-' + o.dmg, o.crit ? 'crit' : o.eff > 1 ? 'super' : o.eff < 1 ? 'weak' : '');
      },
    });
  }

  const BIOME_NAMES = { field: 'Campo', meadow: 'Grama alta', forest: 'Floresta', beach: 'Praia', lake: 'Lago', town: 'Praça do Centro Pokémon', legend: 'Arena lendária', snow: 'Neve', volcano: 'Vulcão' };

  return { play, attack, BIOME_NAMES, TYPES_WITH_FX: Object.keys(EFFECTS) };
})();
