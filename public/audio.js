// Áudio do jogo: música e efeitos por síntese (Web Audio API, sem arquivo nenhum pra baixar) + os gritos de cada
// Pokémon (PokeAPI cries, do mesmo jeito que os sprites já vêm do PokeAPI: public/game.js usa spriteUrl de lá).
// Tudo silencioso até o primeiro toque/tecla do jogador (os navegadores bloqueiam áudio sem gesto do usuário).
const Snd = (() => {
  const KEY = 'jbmon.audio';
  let cfg = { musicOn: true, sfxOn: true, musicVol: 0.45, sfxVol: 0.7 };
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

  let ctx = null, musicGain = null, sfxGain = null;
  function ensure() {
    if (ctx) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    musicGain = ctx.createGain(); musicGain.gain.value = cfg.musicOn ? cfg.musicVol : 0; musicGain.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = cfg.sfxOn ? cfg.sfxVol : 0; sfxGain.connect(ctx.destination);
    return ctx;
  }
  let pendingTrack; // música pedida enquanto o áudio ainda estava bloqueado
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().then(() => { if (pendingTrack !== undefined) { const t = pendingTrack; pendingTrack = undefined; music(t); } }).catch(() => {});
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  // Clique de UI: um único ouvinte cobre botões, chips, abas e opções em todo o jogo
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .fab, .chip, .act, .ab, .qz-opt, .sw-item, .tab, .close, .atabs button');
    if (el && !el.disabled) sfx('click');
  }, true);

  // ---------------------------------------------------------------- síntese
  function tone(t, freq, dur, { type = 'square', vol = 0.16, slideTo, decay, dest } = {}) {
    if (!ctx) return;
    const d = decay ?? dur;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(dest || sfxGain);
    o.start(t); o.stop(t + d + 0.05);
  }
  function noiseBurst(t, dur, vol = 0.16, dest) {
    if (!ctx) return;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const n = ctx.createBufferSource(); n.buffer = buf;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(g); g.connect(dest || sfxGain);
    n.start(t); n.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- efeitos sonoros
  const SFX = {
    click: (t) => tone(t, 720, 0.045, { vol: 0.09, decay: 0.05 }),
    open: (t) => { tone(t, 420, 0.09, { type: 'triangle', vol: 0.15 }); tone(t + 0.05, 640, 0.1, { type: 'triangle', vol: 0.13 }); },
    close: (t) => { tone(t, 540, 0.08, { type: 'triangle', vol: 0.13 }); tone(t + 0.04, 360, 0.1, { type: 'triangle', vol: 0.11 }); },
    notice: (t) => { tone(t, 880, 0.1, { type: 'sine', vol: 0.15 }); tone(t + 0.09, 1180, 0.15, { type: 'sine', vol: 0.13 }); },
    chat: (t) => tone(t, 1046, 0.06, { type: 'sine', vol: 0.11 }),
    hit: (t) => { noiseBurst(t, 0.06, 0.12); tone(t, 170, 0.08, { vol: 0.11, slideTo: 60 }); },
    hitSuper: (t) => { noiseBurst(t, 0.09, 0.18); tone(t, 280, 0.14, { type: 'sawtooth', vol: 0.17, slideTo: 90 }); },
    hitWeak: (t) => tone(t, 320, 0.06, { type: 'sine', vol: 0.09 }),
    hitImmune: (t) => tone(t, 520, 0.05, { type: 'sine', vol: 0.08 }),
    crit: (t) => { tone(t, 1250, 0.08, { vol: 0.15 }); tone(t + 0.06, 1568, 0.08, { vol: 0.13 }); },
    faint: (t) => [440, 370, 300, 220].forEach((f, i) => tone(t + i * 0.1, f, 0.16, { type: 'triangle', vol: 0.15 })),
    ballThrow: (t) => tone(t, 480, 0.16, { type: 'sine', vol: 0.15, slideTo: 880 }),
    ballShake: (t) => tone(t, 260, 0.06, { vol: 0.09 }),
    ballCatch: (t) => [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, f, 0.18, { type: 'triangle', vol: 0.17 })),
    ballEscape: (t) => tone(t, 300, 0.18, { type: 'sawtooth', vol: 0.13, slideTo: 110 }),
    levelUp: (t) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(t + i * 0.07, f, 0.13, { vol: 0.14 })),
    evolve: (t) => { for (let i = 0; i < 10; i++) tone(t + i * 0.06, 300 + i * 60, 0.09, { type: 'sine', vol: 0.09 }); tone(t + 0.68, 1046, 0.4, { type: 'triangle', vol: 0.19 }); },
    exhaust: (t) => [700, 560, 420].forEach((f, i) => tone(t + i * 0.09, f, 0.15, { type: 'sawtooth', vol: 0.15 })),
    win: (t) => [523, 523, 523, 659, 784, 784, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.13, f, 0.2, { vol: 0.15 })),
    defeat: (t) => [392, 349, 311, 262].forEach((f, i) => tone(t + i * 0.18, f, 0.28, { type: 'sawtooth', vol: 0.14 })),
    correct: (t) => { tone(t, 784, 0.09, { type: 'sine', vol: 0.15 }); tone(t + 0.08, 1047, 0.14, { type: 'sine', vol: 0.15 }); },
    wrong: (t) => tone(t, 300, 0.17, { type: 'sawtooth', vol: 0.13, slideTo: 140 }),
    tick: (t) => tone(t, 1500, 0.03, { vol: 0.05 }),
    boss: (t) => [220, 220, 165, 220].forEach((f, i) => tone(t + i * 0.16, f, 0.2, { type: 'sawtooth', vol: 0.19 })),
    error: (t) => tone(t, 200, 0.18, { type: 'sawtooth', vol: 0.13 }),
  };
  function sfx(name) {
    if (!cfg.sfxOn || !ensure() || ctx.state === 'suspended') return;
    try { (SFX[name] || SFX.click)(ctx.currentTime); } catch {}
  }

  // ---------------------------------------------------------------- gritos (PokeAPI cries — mesma fonte dos sprites)
  const cryCache = new Map();
  function cry(id) {
    if (!cfg.sfxOn || !id) return;
    let a = cryCache.get(id);
    if (!a) { a = new Audio(`https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`); a.preload = 'auto'; cryCache.set(id, a); }
    a.volume = cfg.sfxVol;
    try { a.currentTime = 0; } catch {}
    a.play().catch(() => {});
  }

  // ---------------------------------------------------------------- música (pequenas melodias em loop)
  const TRACKS = {
    route: { bpm: 132, wave: 'square', bassWave: 'triangle', vol: 0.075, bassVol: 0.06,
      melody: [[523, 1], [659, 1], [784, 1], [659, 1], [523, 1], [659, 1], [784, 2], [988, 1], [880, 1], [784, 1], [659, 1], [523, 2]],
      bass: [[262, 2], [330, 2], [392, 2], [330, 2], [262, 2], [330, 2]] },
    town: { bpm: 104, wave: 'triangle', bassWave: 'sine', vol: 0.08, bassVol: 0.055,
      melody: [[659, 1.5], [784, 0.5], [880, 1], [784, 1], [659, 1.5], [587, 0.5], [523, 2], [0, 1], [659, 1.5], [880, 0.5], [988, 1], [880, 1]],
      bass: [[330, 2], [294, 2], [262, 2], [294, 2]] },
    ice: { bpm: 88, wave: 'sine', bassWave: 'sine', vol: 0.075, bassVol: 0.05,
      melody: [[880, 2], [988, 1], [1046, 1], [988, 2], [880, 1], [784, 1], [880, 3], [0, 1]],
      bass: [[440, 4], [392, 4]] },
    lava: { bpm: 118, wave: 'sawtooth', bassWave: 'square', vol: 0.06, bassVol: 0.07,
      melody: [[311, 1], [370, 0.5], [311, 0.5], [277, 1], [311, 1], [370, 1], [415, 1], [370, 1], [311, 2]],
      bass: [[155, 1], [0, 0.5], [155, 0.5], [174, 1], [155, 1], [0, 0.5], [155, 0.5]] },
    battle: { bpm: 150, wave: 'square', bassWave: 'triangle', vol: 0.08, bassVol: 0.07,
      melody: [[659, 0.5], [659, 0.5], [784, 0.5], [880, 0.5], [784, 0.5], [659, 0.5], [988, 0.5], [880, 0.5], [740, 1], [0, 0.5], [659, 0.5], [740, 1]],
      bass: [[220, 1], [220, 1], [196, 1], [174, 1]] },
    pvp: { bpm: 156, wave: 'sawtooth', bassWave: 'square', vol: 0.075, bassVol: 0.07,
      melody: [[587, 0.5], [698, 0.5], [880, 0.5], [698, 0.5], [622, 0.5], [740, 0.5], [932, 0.5], [740, 0.5], [554, 1], [0, 0.5], [587, 0.5]],
      bass: [[196, 1], [174, 1], [155, 1], [174, 1]] },
    boss: { bpm: 100, wave: 'sawtooth', bassWave: 'square', vol: 0.09, bassVol: 0.09,
      melody: [[220, 1], [233, 1], [220, 1], [0, 0.5], [174, 0.5], [220, 2], [261, 1], [233, 1], [220, 2]],
      bass: [[110, 2], [116, 2], [98, 2], [110, 2]] },
    quiz: { bpm: 140, wave: 'triangle', bassWave: 'sine', vol: 0.08, bassVol: 0.055,
      melody: [[784, 0.5], [880, 0.5], [988, 0.5], [1047, 0.5], [988, 0.5], [880, 0.5], [784, 1], [0, 0.5], [880, 0.5], [988, 1]],
      bass: [[392, 2], [330, 2]] },
  };
  let curName = null, gen = 0;
  function scheduleLoop(def, myGen) {
    if (myGen !== gen || !ctx) return;
    const t0 = ctx.currentTime + 0.05, beat = 60 / def.bpm;
    let t = t0;
    def.melody.forEach(([freq, beats]) => { const dur = beats * beat; if (freq) tone(t, freq, dur * 0.92, { type: def.wave, vol: def.vol, dest: musicGain }); t += dur; });
    if (def.bass) { let tb = t0; def.bass.forEach(([freq, beats]) => { const dur = beats * beat; if (freq) tone(tb, freq, dur * 0.95, { type: def.bassWave, vol: def.bassVol, dest: musicGain }); tb += dur; }); }
    const loopMs = (t - t0) * 1000;
    setTimeout(() => scheduleLoop(def, myGen), Math.max(80, loopMs - 60));
  }
  function music(name) {
    if (name === curName) return;
    curName = name;
    if (!ensure() || ctx.state === 'suspended') { pendingTrack = name; return; }
    gen++;
    if (name && TRACKS[name]) scheduleLoop(TRACKS[name], gen);
  }

  // ---------------------------------------------------------------- preferências (usadas por Settings)
  function setMusicOn(on) {
    cfg.musicOn = !!on; save();
    if (!ensure()) return;
    if (on) { musicGain.gain.linearRampToValueAtTime(cfg.musicVol, ctx.currentTime + 0.25); const n = curName; curName = null; music(n); }
    else musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
  }
  function setSfxOn(on) { cfg.sfxOn = !!on; save(); if (ensure()) sfxGain.gain.linearRampToValueAtTime(on ? cfg.sfxVol : 0, ctx.currentTime + 0.15); }
  function setMusicVol(v) { cfg.musicVol = v; save(); if (ensure() && cfg.musicOn) musicGain.gain.value = v; }
  function setSfxVol(v) { cfg.sfxVol = v; save(); if (ensure() && cfg.sfxOn) sfxGain.gain.value = v; }

  return { sfx, cry, music, setMusicOn, setSfxOn, setMusicVol, setSfxVol, prefs: () => ({ ...cfg }) };
})();
