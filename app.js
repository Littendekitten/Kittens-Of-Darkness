/* =========================================================
   KITTENS OF DARKNESS
   A horde-survivor game. No libraries, no image files:
   every cat is drawn with the canvas at runtime.
   ========================================================= */
(() => {
'use strict';

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};
const hash = (x, y) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};
const fmtTime = s => {
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

/* ---------- constants ---------- */
const WIN_TIME = 15 * 60;       // seconds to survive
const BASE_SPEED = 150;         // player px/sec
const MAX_ENEMIES = 340;
const GRID = 48;                // spatial hash cell size
const GRID_BUCKETS = 4096;
const BOSS_EVERY = 120;         // seconds
const SWARM_EVERY = 50;         // seconds

/* ---------- DOM ---------- */
const canvas = $('game');
const ctx = canvas.getContext('2d');
const el = {
  hud: $('hud'), hpFill: $('hp-fill'), hpText: $('hp-text'), xpFill: $('xp-fill'),
  level: $('level-text'), time: $('time-text'), kills: $('kill-text'), slots: $('slots'),
  banner: $('banner'), menu: $('menu'), levelup: $('levelup'), levelupTitle: $('levelup-title'),
  choices: $('choices'), pause: $('pause'), gameover: $('gameover'),
  overTitle: $('over-title'), overText: $('over-text'), best: $('best'),
  mute: $('btn-mute'),
};

const setText = (node, v) => {
  if (node._v !== v) { node.textContent = v; node._v = v; }
};

/* ---------- audio (tiny synth, no files) ---------- */
const audio = { ctx: null, muted: false };
try { audio.muted = localStorage.getItem('kod_muted') === '1'; } catch (e) { /* ignore */ }

const SFX = {
  slash: { f: 320, d: 0.09, t: 'sawtooth', v: 0.035, s: -170 },
  shoot: { f: 560, d: 0.07, t: 'triangle', v: 0.035, s: -240 },
  hit:   { f: 170, d: 0.05, t: 'square',   v: 0.02,  s: -70 },
  kill:  { f: 120, d: 0.09, t: 'sawtooth', v: 0.025, s: -70 },
  gem:   { f: 700, d: 0.06, t: 'sine',     v: 0.035, s: 320 },
  hurt:  { f: 130, d: 0.2,  t: 'sawtooth', v: 0.06,  s: -80 },
  boom:  { f: 95,  d: 0.25, t: 'sawtooth', v: 0.06,  s: -55 },
  level: { f: 440, d: 0.3,  t: 'triangle', v: 0.05,  s: 440 },
  hiss:  { f: 950, d: 0.25, t: 'sawtooth', v: 0.025, s: -650 },
  moon:  { f: 1200, d: 0.3, t: 'sine',     v: 0.035, s: -900 },
  pick:  { f: 330, d: 0.18, t: 'square',   v: 0.04,  s: 400 },
  over:  { f: 300, d: 0.9,  t: 'sawtooth', v: 0.06,  s: -250 },
};
const sfxLast = {};

function initAudio() {
  if (audio.ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audio.ctx = new AC();
  } catch (e) { /* audio is optional */ }
}

function sfx(name) {
  if (!audio.ctx || audio.muted) return;
  const now = performance.now();
  if (now - (sfxLast[name] || 0) < 45) return;
  sfxLast[name] = now;
  const d = SFX[name];
  const a = audio.ctx;
  if (a.state === 'suspended') a.resume();
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = d.t;
  o.frequency.setValueAtTime(d.f, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, d.f + d.s), t + d.d);
  g.gain.setValueAtTime(d.v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d.d);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + d.d + 0.02);
}

function toggleMute() {
  audio.muted = !audio.muted;
  el.mute.textContent = audio.muted ? '🔇' : '🔊';
  try { localStorage.setItem('kod_muted', audio.muted ? '1' : '0'); } catch (e) { /* ignore */ }
}

/* ---------- canvas sizing ---------- */
let dpr = 1, VW = 0, VH = 0, viewScale = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  VW = window.innerWidth;
  VH = window.innerHeight;
  canvas.width = Math.floor(VW * dpr);
  canvas.height = Math.floor(VH * dpr);
  viewScale = clamp(Math.min(VW, VH) / 700, 0.75, 1.4);
}
window.addEventListener('resize', resize);
resize();

/* =========================================================
   DATA: weapons, passives, enemies
   ========================================================= */
const WEAPONS = {
  claw: {
    name: 'Claw Swipe', icon: '🐾',
    desc: ['Slashes the nearest zombie kitten.', '+4 damage and a wider arc.', 'Also slashes behind you!',
           '+4 damage and longer reach.', 'Double swipe!'],
  },
  bones: {
    name: 'Fish Bones', icon: '🐟',
    desc: ['Throws a fish skeleton at the nearest enemy.', 'Throw 2 fish bones.', 'Bones pierce 1 more enemy.',
           'Throw 3 fish bones.', 'Throw 4 bones, pierce 1 more.'],
  },
  yarn: {
    name: 'Yarn Orbit', icon: '🧶',
    desc: ['Two yarn balls circle you.', 'Faster and wider orbit.', 'Three yarn balls.',
           'Four yarn balls.', 'Five yarn balls, more damage.'],
  },
  hair: {
    name: 'Hairball Bomb', icon: '🤢',
    desc: ['Hacks up an exploding hairball.', 'Bigger blast, more damage.', 'Two hairballs at once.',
           'An even bigger blast.', 'Three hairballs!'],
  },
  hiss: {
    name: 'Hiss Aura', icon: '😾',
    desc: ['Hisses, hurting and shoving back nearby zombies.', 'Bigger radius.', 'Hisses more often.',
           'More damage and knockback.', 'Maximum hiss.'],
  },
  moon: {
    name: 'Moonbeam', icon: '🌙',
    desc: ['Moonlight smites a random enemy.', 'Two moonbeams.', 'Wider beams, more damage.',
           'Three moonbeams.', 'Four moonbeams, faster.'],
  },
};
const WEAPON_MAX = 5;

const PASSIVES = {
  claws:  { name: 'Sharp Claws',  icon: '🗡️', max: 5, desc: '+15% damage' },
  paws:   { name: 'Quick Paws',   icon: '⚡',  max: 5, desc: '-8% weapon cooldown' },
  catnip: { name: 'Catnip',       icon: '🌿', max: 5, desc: '+10% move speed' },
  fur:    { name: 'Thick Fur',    icon: '🧥', max: 5, desc: '-8% damage taken' },
  tuna:   { name: 'Tuna Can',     icon: '🥫', max: 5, desc: '+40% pickup range' },
  purr:   { name: 'Purring',      icon: '💗', max: 5, desc: 'Regenerate 0.6 HP per second' },
  tail:   { name: 'Tough Tail',   icon: '💪', max: 5, desc: '+25 max HP and heal 25' },
  collar: { name: 'Lucky Collar', icon: '🔔', max: 5, desc: '+12% XP gained' },
  lives:  { name: 'Nine Lives',   icon: '😼', max: 2, desc: 'Come back once with half HP and a shockwave' },
};

const ETYPES = {
  shambler: { hp: 14, speed: 42, r: 12, dmg: 8,  xp: 1, kb: 1.0, rate: 6,
    colors: [
      { fur: '#7f9b72', dark: '#566b4d', ear: '#b7727d' },
      { fur: '#8a8f75', dark: '#5f634f', ear: '#b7727d' },
      { fur: '#6f8f86', dark: '#4b655e', ear: '#b7727d' },
    ] },
  runner:   { hp: 8,  speed: 84, r: 10, dmg: 6,  xp: 1, kb: 1.3, rate: 14,
    colors: [
      { fur: '#5fa29a', dark: '#3b6e68', ear: '#c97a8c' },
      { fur: '#7cb08a', dark: '#4d7a5a', ear: '#c97a8c' },
    ] },
  ghoul:    { hp: 34, speed: 56, r: 14, dmg: 11, xp: 2, kb: 0.8, rate: 8,
    colors: [
      { fur: '#8a7aa5', dark: '#5d5075', ear: '#d08aa0' },
      { fur: '#9a86a0', dark: '#6a5870', ear: '#d08aa0' },
    ] },
  brute:    { hp: 90, speed: 32, r: 21, dmg: 18, xp: 6, kb: 0.45, rate: 5,
    colors: [
      { fur: '#6a8f5a', dark: '#44603a', ear: '#a86675' },
      { fur: '#7a8a52', dark: '#505c33', ear: '#a86675' },
    ] },
  boss:     { hp: 600, speed: 48, r: 38, dmg: 24, xp: 80, kb: 0.08, rate: 5,
    colors: [{ fur: '#9b7fb8', dark: '#6a4f86', ear: '#e08aa8' }] },
};
const BOSS_NAMES = ['Zombie King Whiskers', 'Duchess Decay', 'Lord Furball the Undying',
                    'Tom of the Tombs', 'Madame Mewlifer', 'The Great Catacomb Cat'];

/* =========================================================
   GAME STATE
   ========================================================= */
let state = 'menu';       // menu | playing | levelup | paused | gameover
let G = null;             // current game
let S = null;             // current stats (derived from passives)
let animT = 0;            // purely visual clock, always ticking
let bannerTimer = 0;
let overAt = 0;

const gridHead = new Int32Array(GRID_BUCKETS);
const gridNext = new Int32Array(MAX_ENEMIES + 120);
const cellKey = (cx, cy) => (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & (GRID_BUCKETS - 1);

const cam = { x: 0, y: 0 };

function newGame() {
  G = {
    t: 0, kills: 0, pending: 0, shake: 0, hurtFlash: 0,
    spawnAcc: 0, nextBoss: BOSS_EVERY, nextSwarm: 40, bossCount: 0, bossName: '',
    p: { x: 0, y: 0, r: 14, hp: 100, maxHp: 100, face: 1, iframes: 0, level: 1,
         xp: 0, xpNext: 8, revives: 0, moving: false },
    weapons: {}, passives: {}, options: [], lockUntil: 0,
    enemies: [], shots: [], gems: [], pickups: [], fx: [], parts: [], texts: [], timers: [],
  };
  S = { might: 1, cooldown: 1, speed: 1, armor: 0, magnet: 70, regen: 0, xp: 1 };
  cam.x = 0; cam.y = 0;
  addWeapon('claw');
  recalcStats();
  refreshSlots();
}

/* A calm scene behind the main menu */
function menuScene() {
  newGame();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rand(-0.2, 0.2);
    const d = rand(120, 230);
    const type = ['shambler', 'runner', 'ghoul', 'brute'][i % 4];
    const e = makeEnemy(type, Math.cos(a) * d, Math.sin(a) * d);
    e.face = Math.cos(a) > 0 ? -1 : 1;
    G.enemies.push(e);
  }
  G.p.face = 1;
}

function addWeapon(id) {
  G.weapons[id] = { lv: 1, cd: 0.3, ang: 0, pos: [] };
}

function recalcStats() {
  const l = G.passives;
  S.might = 1 + 0.15 * (l.claws || 0);
  S.cooldown = Math.max(0.4, 1 - 0.08 * (l.paws || 0));
  S.speed = 1 + 0.10 * (l.catnip || 0);
  S.armor = 0.08 * (l.fur || 0);
  S.magnet = 70 * (1 + 0.4 * (l.tuna || 0));
  S.regen = 0.6 * (l.purr || 0);
  S.xp = 1 + 0.12 * (l.collar || 0);
}

/* =========================================================
   INPUT
   ========================================================= */
const keys = {};
const joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
let mvx = 0, mvy = 0;

canvas.addEventListener('pointerdown', e => {
  initAudio();
  if (state !== 'playing') return;
  joy.active = true; joy.id = e.pointerId;
  joy.ox = e.clientX; joy.oy = e.clientY;
  joy.dx = joy.dy = joy.x = joy.y = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
canvas.addEventListener('pointermove', e => {
  if (!joy.active || e.pointerId !== joy.id) return;
  const R = 55;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const m = Math.hypot(dx, dy);
  if (m > R) {                       // floating stick: origin follows the finger
    joy.ox += (dx / m) * (m - R);
    joy.oy += (dy / m) * (m - R);
    dx = e.clientX - joy.ox; dy = e.clientY - joy.oy;
  }
  joy.dx = dx; joy.dy = dy;
  const mag = Math.min(1, Math.hypot(dx, dy) / R);
  if (mag < 0.15) { joy.x = joy.y = 0; }
  else { const a = Math.atan2(dy, dx); joy.x = Math.cos(a) * mag; joy.y = Math.sin(a) * mag; }
});
const endPointer = e => {
  if (e.pointerId !== joy.id) return;
  joy.active = false; joy.x = joy.y = 0;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

window.addEventListener('keydown', e => {
  initAudio();
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMute();

  if (state === 'playing') {
    if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  } else if (state === 'paused') {
    if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Enter') resumeGame();
  } else if (state === 'levelup') {
    const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    const n2 = ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
    if (n >= 0) pickChoice(n);
    else if (n2 >= 0) pickChoice(n2);
  } else if (state === 'menu') {
    if (e.code === 'Enter' || e.code === 'Space') startGame();
  } else if (state === 'gameover') {
    if ((e.code === 'Enter' || e.code === 'Space') && performance.now() - overAt > 800) startGame();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (state === 'playing') pauseGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});

function readInput() {
  let x = 0, y = 0;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y -= 1;
  if (keys.KeyS || keys.ArrowDown) y += 1;
  if (x || y) {
    const m = Math.hypot(x, y);
    x /= m; y /= m;
  } else if (joy.active) {
    x = joy.x; y = joy.y;
  }
  mvx = x; mvy = y;
}

/* Buttons */
$('btn-start').addEventListener('click', () => { initAudio(); startGame(); });
$('btn-again').addEventListener('click', startGame);
$('btn-menu').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-quit').addEventListener('click', toMenu);
$('btn-pause').addEventListener('click', () => { if (state === 'playing') pauseGame(); });
el.mute.addEventListener('click', toggleMute);
el.mute.textContent = audio.muted ? '🔇' : '🔊';

/* =========================================================
   STATE TRANSITIONS
   ========================================================= */
function show(node, on) { node.classList.toggle('hidden', !on); }

function loadBest() {
  try { return JSON.parse(localStorage.getItem('kod_best') || 'null'); } catch (e) { return null; }
}
function saveBest(b) {
  try { localStorage.setItem('kod_best', JSON.stringify(b)); } catch (e) { /* ignore */ }
}
function showBestText() {
  const b = loadBest();
  el.best.textContent = b
    ? 'Best night: ' + fmtTime(b.time) + ' survived, ' + b.kills + ' zombie kittens defeated'
    : 'No nights survived yet.';
}

function toMenu() {
  state = 'menu';
  menuScene();
  show(el.hud, false); show(el.pause, false); show(el.gameover, false); show(el.levelup, false);
  show(el.menu, true);
  el.banner.classList.remove('show');
  showBestText();
}

function startGame() {
  newGame();
  state = 'playing';
  show(el.menu, false); show(el.gameover, false); show(el.pause, false); show(el.levelup, false);
  show(el.hud, true);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  show(el.pause, true);
}
function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  show(el.pause, false);
}

function endGame(win) {
  state = 'gameover';
  overAt = performance.now();
  sfx(win ? 'level' : 'over');
  const prev = loadBest();
  let record = false;
  if (!prev || G.t > prev.time) { saveBest({ time: Math.floor(G.t), kills: G.kills }); record = true; }
  el.overTitle.textContent = win ? 'Dawn breaks!' : 'You died';
  el.overTitle.style.color = win ? '#8fd16a' : '#d93b5a';
  el.overText.innerHTML =
    (win ? 'The sun rises and the zombie kittens crumble to dust.<br>' : '') +
    'Survived <b>' + fmtTime(G.t) + '</b><br>' +
    'Zombie kittens defeated <b>' + G.kills + '</b><br>' +
    'Reached level <b>' + G.p.level + '</b>' +
    (record ? '<br><b style="color:#ff9d3c">New best night!</b>' : '');
  show(el.hud, false);
  show(el.gameover, true);
  el.banner.classList.remove('show');
}

function banner(text, ms) {
  el.banner.textContent = text;
  el.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.banner.classList.remove('show'), ms || 2500);
}

/* =========================================================
   LEVEL UP
   ========================================================= */
function buildOptions() {
  const pool = [];
  for (const id in WEAPONS) {
    const lv = G.weapons[id] ? G.weapons[id].lv : 0;
    if (lv < WEAPON_MAX) pool.push({ kind: 'weapon', id, from: lv });
  }
  for (const id in PASSIVES) {
    const lv = G.passives[id] || 0;
    if (lv < PASSIVES[id].max) pool.push({ kind: 'passive', id, from: lv });
  }
  for (let i = pool.length - 1; i > 0; i--) {         // shuffle
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const opts = pool.slice(0, 3);
  while (opts.length < 3) opts.push({ kind: 'heal' });
  return opts.map(o => {
    if (o.kind === 'weapon') {
      const w = WEAPONS[o.id];
      return { ...o, icon: w.icon, name: w.name, desc: w.desc[o.from],
               tag: o.from === 0 ? 'NEW WEAPON' : 'Level ' + o.from + ' → ' + (o.from + 1) };
    }
    if (o.kind === 'passive') {
      const p = PASSIVES[o.id];
      return { ...o, icon: p.icon, name: p.name, desc: p.desc,
               tag: o.from === 0 ? 'NEW PASSIVE' : 'Level ' + o.from + ' → ' + (o.from + 1) };
    }
    return { kind: 'heal', icon: '🐟', name: 'Fish Snack', desc: 'Heal 40% of your max HP.', tag: 'Snack' };
  });
}

function openLevelUp(isChest) {
  state = 'levelup';
  G.options = buildOptions();
  G.lockUntil = performance.now() + 350;
  el.levelupTitle.textContent = isChest ? 'Treasure!' : 'Level up!';
  el.choices.innerHTML = '';
  G.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = 'card ' + o.kind;
    b.innerHTML =
      '<span class="key">' + (i + 1) + '</span>' +
      '<span class="icon">' + o.icon + '</span>' +
      '<span class="cname">' + o.name + '</span>' +
      '<span class="clevel">' + o.tag + '</span>' +
      '<span class="cdesc">' + o.desc + '</span>';
    b.addEventListener('click', () => pickChoice(i));
    el.choices.appendChild(b);
  });
  show(el.levelup, true);
  sfx('level');
}

function pickChoice(i) {
  if (state !== 'levelup' || performance.now() < G.lockUntil) return;
  const o = G.options[i];
  if (!o) return;
  const p = G.p;
  if (o.kind === 'weapon') {
    if (G.weapons[o.id]) G.weapons[o.id].lv++;
    else addWeapon(o.id);
  } else if (o.kind === 'passive') {
    G.passives[o.id] = (G.passives[o.id] || 0) + 1;
    if (o.id === 'tail') { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); }
    if (o.id === 'lives') p.revives++;
    recalcStats();
  } else {
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4);
  }
  sfx('pick');
  refreshSlots();
  G.pending--;
  if (G.pending > 0) {
    openLevelUp(false);
  } else {
    state = 'playing';
    show(el.levelup, false);
  }
}

function refreshSlots() {
  let html = '';
  for (const id in G.weapons) {
    html += '<span class="slot weapon" title="' + WEAPONS[id].name + '">' + WEAPONS[id].icon +
            '<b>' + G.weapons[id].lv + '</b></span>';
  }
  for (const id in G.passives) {
    html += '<span class="slot" title="' + PASSIVES[id].name + '">' + PASSIVES[id].icon +
            '<b>' + G.passives[id] + '</b></span>';
  }
  el.slots.innerHTML = html;
}

function addXp(v) {
  const p = G.p;
  p.xp += v * S.xp;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.round(6 + p.level * p.level * 1.2 + p.level * 2);
    G.pending++;
  }
}

/* =========================================================
   ENEMIES
   ========================================================= */
function makeEnemy(type, x, y) {
  const T = ETYPES[type];
  const hpMul = 1 + G.t / 110;
  const boss = type === 'boss';
  const hp = boss ? T.hp * (1 + G.bossCount * 0.9) + G.t * 2 : T.hp * hpMul;
  return {
    type, x, y, r: T.r, hp, maxHp: hp,
    speed: T.speed * (1 + Math.min(0.4, G.t / 900)) * rand(0.9, 1.1),
    dmg: T.dmg * (1 + G.t / 400), xp: T.xp, kb: T.kb, rate: T.rate,
    kx: 0, ky: 0, flash: 0, yarnCd: 0, t: rand(0, 10), face: 1,
    pal: T.colors[(Math.random() * T.colors.length) | 0],
    boss, dead: false,
  };
}

function ringPos() {
  const R = Math.hypot(VW, VH) / viewScale / 2 + 50;
  const a = Math.random() * TAU;
  return { x: G.p.x + Math.cos(a) * R, y: G.p.y + Math.sin(a) * R, R };
}

function pickType(t) {
  const r = Math.random();
  if (t < 30) return 'shambler';
  if (t < 90) return r < 0.7 ? 'shambler' : 'runner';
  if (t < 180) return r < 0.5 ? 'shambler' : r < 0.8 ? 'runner' : 'ghoul';
  return r < 0.35 ? 'shambler' : r < 0.6 ? 'runner' : r < 0.85 ? 'ghoul' : 'brute';
}

function updateSpawns(dt) {
  G.spawnAcc += (1.3 + G.t * 0.028) * dt;
  while (G.spawnAcc >= 1) {
    G.spawnAcc -= 1;
    if (G.enemies.length >= MAX_ENEMIES) continue;
    const pos = ringPos();
    G.enemies.push(makeEnemy(pickType(G.t), pos.x, pos.y));
  }
  if (G.t >= G.nextSwarm) {
    G.nextSwarm += SWARM_EVERY;
    const pos = ringPos();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      G.enemies.push(makeEnemy('runner', G.p.x + Math.cos(a) * pos.R, G.p.y + Math.sin(a) * pos.R));
    }
    banner('A swarm surrounds you!', 2200);
  }
  if (G.t >= G.nextBoss) {
    G.nextBoss += BOSS_EVERY;
    const pos = ringPos();
    const b = makeEnemy('boss', pos.x, pos.y);
    G.bossName = BOSS_NAMES[G.bossCount % BOSS_NAMES.length];
    G.bossCount++;
    G.enemies.push(b);
    banner(G.bossName + ' rises!', 3000);
  }
}

function updateEnemies(dt) {
  const E = G.enemies, p = G.p, n = E.length;
  gridHead.fill(-1);
  for (let i = 0; i < n; i++) {
    const e = E[i];
    const k = cellKey(Math.floor(e.x / GRID), Math.floor(e.y / GRID));
    gridNext[i] = gridHead[k];
    gridHead[k] = i;
  }
  const ringR = Math.hypot(VW, VH) / viewScale / 2 + 50;
  const decay = Math.exp(-6 * dt);

  for (let i = 0; i < n; i++) {
    const e = E[i];
    e.t += dt;
    e.flash -= dt;
    e.yarnCd -= dt;

    // soft separation so the horde looks like a horde, not one blob
    const cx = Math.floor(e.x / GRID), cy = Math.floor(e.y / GRID);
    let sx = 0, sy = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        let j = gridHead[cellKey(cx + ox, cy + oy)];
        while (j !== -1) {
          if (j !== i) {
            const o = E[j];
            const dx = e.x - o.x, dy = e.y - o.y;
            const md = (e.r + o.r) * 0.75;
            const d2 = dx * dx + dy * dy;
            if (d2 < md * md && d2 > 0.0001) {
              const d = Math.sqrt(d2);
              const push = (md - d) / md;
              sx += (dx / d) * push;
              sy += (dy / d) * push;
            }
          }
          j = gridNext[j];
        }
      }
    }

    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.x += ((dx / d) * e.speed + e.kx + sx * 70) * dt;
    e.y += ((dy / d) * e.speed + e.ky + sy * 70) * dt;
    e.kx *= decay; e.ky *= decay;
    e.face = dx > 0 ? 1 : -1;

    if (d > ringR + 350) {            // fell far behind: bring it back around
      const pos = ringPos();
      e.x = pos.x; e.y = pos.y;
    }
    if (d < e.r + p.r * 0.7 && p.iframes <= 0) hurtPlayer(e.dmg);
  }
}

function damageEnemy(e, dmg, kx, ky, force) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 0.09;
  e.kx += kx * force * e.kb;
  e.ky += ky * force * e.kb;
  if (G.texts.length < 45) {
    G.texts.push({ x: e.x + rand(-6, 6), y: e.y - e.r - 4, txt: Math.round(dmg), t: 0, col: '#fff3c4' });
  }
  sfx('hit');
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  G.kills++;
  burst(e.x, e.y, e.pal.fur, e.boss ? 40 : 7);
  dropGem(e.x, e.y, e.xp);
  sfx('kill');
  if (e.boss) {
    G.pickups.push({ type: 'chest', x: e.x, y: e.y });
    G.shake = 14;
    G.bossName = '';
  } else {
    const r = Math.random();
    if (r < 0.012) G.pickups.push({ type: 'fish', x: e.x, y: e.y });
    else if (r < 0.017) G.pickups.push({ type: 'magnet', x: e.x, y: e.y });
  }
}

function hurtPlayer(d) {
  const p = G.p;
  const dmg = Math.max(1, Math.round(d * (1 - S.armor)));
  p.hp -= dmg;
  p.iframes = 0.6;
  G.shake = Math.max(G.shake, 6);
  G.hurtFlash = 0.35;
  G.texts.push({ x: p.x, y: p.y - 24, txt: '-' + dmg, t: 0, col: '#ff6b86' });
  sfx('hurt');
  if (p.hp <= 0) {
    if (p.revives > 0) {
      p.revives--;
      p.hp = p.maxHp * 0.5;
      p.iframes = 2;
      shockwave(260, 60);
      banner('Nine Lives!', 1500);
    } else {
      p.hp = 0;
      endGame(false);
    }
  }
}

/* big burst that shoves and hurts everything near the player */
function shockwave(radius, dmg) {
  const p = G.p;
  G.fx.push({ type: 'ring', x: p.x, y: p.y, rad: radius, t: 0, life: 0.5, col: '255,230,160' });
  sfx('boom');
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < radius + e.r) damageEnemy(e, dmg, dx / d, dy / d, 500);
  }
}

function compactEnemies() {
  const E = G.enemies;
  let w = 0;
  for (let i = 0; i < E.length; i++) if (!E[i].dead) E[w++] = E[i];
  E.length = w;
}

/* =========================================================
   TARGETING HELPERS
   ========================================================= */
function nearestEnemy(range) {
  const p = G.p;
  let best = null, bd = range * range;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}

function nearestN(n, range) {
  const p = G.p;
  const list = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < range * range) list.push({ e, d2 });
  }
  list.sort((a, b) => a.d2 - b.d2);
  return list.slice(0, n).map(o => o.e);
}

function randomEnemies(n, range) {
  const p = G.p;
  const list = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    if (dx * dx + dy * dy < range * range) list.push(e);
  }
  const out = [];
  while (out.length < n && list.length) {
    out.push(list.splice((Math.random() * list.length) | 0, 1)[0]);
  }
  return out;
}

/* =========================================================
   WEAPONS
   ========================================================= */
function slash(ang, lv) {
  const p = G.p;
  const range = 72 + 9 * (lv - 1);
  const arc = 1.7 + 0.12 * lv;
  const dmg = (12 + 4 * (lv - 1)) * S.might;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > range + e.r) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), ang)) < arc / 2 + e.r / Math.max(d, 1)) {
      damageEnemy(e, dmg, cx, cy, 150);
    }
  }
  G.fx.push({ type: 'slash', x: p.x, y: p.y, ang, range, arc, t: 0, life: 0.22 });
  sfx('slash');
}

const WEAPON_UPDATE = {
  claw(w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const t = nearestEnemy(230);
    if (!t) { w.cd = 0.1; return; }
    const lv = w.lv, p = G.p;
    w.cd = (1.0 - 0.07 * (lv - 1)) * S.cooldown;
    const ang = Math.atan2(t.y - p.y, t.x - p.x);
    slash(ang, lv);
    if (lv >= 3) slash(ang + Math.PI, lv);
    if (lv >= 5) G.timers.push({ t: 0.18, fn: () => slash(ang, lv) });
  },

  bones(w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const lv = w.lv, p = G.p;
    const count = [1, 2, 2, 3, 4][lv - 1];
    const targets = nearestN(count, 480);
    if (!targets.length) { w.cd = 0.1; return; }
    w.cd = (1.3 - 0.1 * (lv - 1)) * S.cooldown;
    const pierce = 1 + (lv >= 3 ? 1 : 0) + (lv >= 5 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const t = targets[i % targets.length];
      let ang = Math.atan2(t.y - p.y, t.x - p.x);
      if (i >= targets.length) ang += rand(-0.25, 0.25);
      G.shots.push({
        type: 'bone', x: p.x, y: p.y, vx: Math.cos(ang) * 430, vy: Math.sin(ang) * 430,
        ang, dmg: (9 + 3 * (lv - 1)) * S.might, pierce, life: 1.5, hit: [],
      });
    }
    sfx('shoot');
  },

  yarn(w, dt) {
    const lv = w.lv, p = G.p;
    const n = [2, 2, 3, 4, 5][lv - 1];
    const rad = 62 + 7 * lv;
    const dmg = (7 + 2 * (lv - 1)) * S.might;
    w.ang += (2.4 + 0.25 * lv) * dt;
    w.pos.length = n;
    for (let k = 0; k < n; k++) {
      const a = w.ang + (k / n) * TAU;
      const bx = p.x + Math.cos(a) * rad, by = p.y + Math.sin(a) * rad;
      w.pos[k] = { x: bx, y: by };
      for (const e of G.enemies) {
        if (e.dead || e.yarnCd > 0) continue;
        const dx = e.x - bx, dy = e.y - by;
        if (dx * dx + dy * dy < (e.r + 10) * (e.r + 10)) {
          e.yarnCd = 0.35;
          const d = Math.hypot(dx, dy) || 1;
          damageEnemy(e, dmg, dx / d, dy / d, 120);
        }
      }
    }
  },

  hair(w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const lv = w.lv, p = G.p;
    const count = [1, 1, 2, 2, 3][lv - 1];
    const targets = randomEnemies(count, 380);
    if (!targets.length) { w.cd = 0.1; return; }
    w.cd = (2.6 - 0.2 * (lv - 1)) * S.cooldown;
    for (const t of targets) {
      G.shots.push({
        type: 'ball', sx: p.x, sy: p.y, x: p.x, y: p.y, tx: t.x, ty: t.y,
        t: 0, dur: 0.7, dmg: (28 + 9 * (lv - 1)) * S.might, rad: 60 + 9 * lv,
      });
    }
    sfx('shoot');
  },

  hiss(w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const lv = w.lv, p = G.p;
    const rad = 90 + 14 * lv;
    let any = false;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy < (rad + e.r) * (rad + e.r)) { any = true; break; }
    }
    if (!any) { w.cd = 0.1; return; }
    w.cd = (2.2 - 0.18 * (lv - 1)) * S.cooldown;
    const dmg = (8 + 3 * lv) * S.might;
    const kb = 260 + (lv >= 4 ? 120 : 0);
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < rad + e.r) damageEnemy(e, dmg, dx / d, dy / d, kb);
    }
    G.fx.push({ type: 'ring', x: p.x, y: p.y, rad, t: 0, life: 0.4, col: '217,59,90' });
    sfx('hiss');
  },

  moon(w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const lv = w.lv;
    const count = [1, 2, 2, 3, 4][lv - 1];
    const targets = randomEnemies(count, 420);
    if (!targets.length) { w.cd = 0.1; return; }
    w.cd = (2.5 - 0.25 * (lv - 1)) * S.cooldown;
    for (const t of targets) {
      G.shots.push({
        type: 'moon', x: t.x, y: t.y, t: 0, warn: 0.35, struck: false,
        dmg: (34 + 11 * (lv - 1)) * S.might, rad: 38 + 5 * lv + (lv >= 3 ? 8 : 0),
      });
    }
  },
};

function updateWeapons(dt) {
  for (const id in G.weapons) WEAPON_UPDATE[id](G.weapons[id], dt);
}

function explode(x, y, rad, dmg) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - x, dy = e.y - y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < rad + e.r) damageEnemy(e, dmg, dx / d, dy / d, 220);
  }
  G.fx.push({ type: 'boom', x, y, rad, t: 0, life: 0.35 });
  burst(x, y, '#9a8a55', 12);
  G.shake = Math.max(G.shake, 3);
  sfx('boom');
}

function updateShots(dt) {
  const shots = G.shots;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    let remove = false;

    if (s.type === 'bone') {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      for (const e of G.enemies) {
        if (e.dead || s.hit.indexOf(e) !== -1) continue;
        const dx = e.x - s.x, dy = e.y - s.y;
        if (dx * dx + dy * dy < (e.r + 7) * (e.r + 7)) {
          s.hit.push(e);
          damageEnemy(e, s.dmg, Math.cos(s.ang), Math.sin(s.ang), 130);
          if (--s.pierce <= 0) { remove = true; break; }
        }
      }
      if (s.life <= 0) remove = true;
    } else if (s.type === 'ball') {
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      s.x = s.sx + (s.tx - s.sx) * k;
      s.y = s.sy + (s.ty - s.sy) * k;
      if (s.t >= s.dur) { explode(s.tx, s.ty, s.rad, s.dmg); remove = true; }
    } else if (s.type === 'moon') {
      s.t += dt;
      if (!s.struck && s.t >= s.warn) {
        s.struck = true;
        for (const e of G.enemies) {
          if (e.dead) continue;
          const dx = e.x - s.x, dy = e.y - s.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < s.rad + e.r) damageEnemy(e, s.dmg, dx / d, dy / d, 90);
        }
        burst(s.x, s.y, '#bfe6ff', 10);
        sfx('moon');
      }
      if (s.t >= s.warn + 0.3) remove = true;
    }

    if (remove) { shots[i] = shots[shots.length - 1]; shots.pop(); }
  }
}

/* =========================================================
   GEMS, PICKUPS, PARTICLES
   ========================================================= */
function dropGem(x, y, v) {
  if (G.gems.length > 300) {          // merge instead of piling up forever
    G.gems[(Math.random() * G.gems.length) | 0].v += v;
    return;
  }
  G.gems.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), v, pull: false, sp: 0 });
}

function updateGems(dt) {
  const p = G.p;
  const mag2 = S.magnet * S.magnet;
  for (let i = G.gems.length - 1; i >= 0; i--) {
    const g = G.gems[i];
    const dx = p.x - g.x, dy = p.y - g.y;
    const d2 = dx * dx + dy * dy;
    if (!g.pull && d2 < mag2) g.pull = true;
    if (g.pull) {
      g.sp = Math.min(700, g.sp + 1400 * dt);
      const d = Math.sqrt(d2) || 1;
      g.x += (dx / d) * g.sp * dt;
      g.y += (dy / d) * g.sp * dt;
    }
    if (d2 < (p.r + 8) * (p.r + 8)) {
      addXp(g.v);
      sfx('gem');
      G.gems[i] = G.gems[G.gems.length - 1];
      G.gems.pop();
    }
  }

  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const k = G.pickups[i];
    const dx = p.x - k.x, dy = p.y - k.y;
    if (dx * dx + dy * dy < (p.r + 14) * (p.r + 14)) {
      if (k.type === 'fish') {
        p.hp = Math.min(p.maxHp, p.hp + 25);
        G.texts.push({ x: p.x, y: p.y - 26, txt: '+25', t: 0, col: '#8fd16a' });
        sfx('pick');
      } else if (k.type === 'magnet') {
        for (const g of G.gems) g.pull = true;
        sfx('pick');
      } else if (k.type === 'chest') {
        G.pending++;
        G.chestOpen = true;
      }
      G.pickups[i] = G.pickups[G.pickups.length - 1];
      G.pickups.pop();
    }
  }
}

function burst(x, y, col, n) {
  if (G.parts.length > 220) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(40, 190);
    G.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), max: 0.6, col, size: rand(2, 4.5) });
  }
}

function updateFx(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i];
    f.t += dt;
    if (f.t >= f.life) { G.fx[i] = G.fx[G.fx.length - 1]; G.fx.pop(); }
  }
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i];
    q.life -= dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 0.92; q.vy *= 0.92;
    if (q.life <= 0) { G.parts[i] = G.parts[G.parts.length - 1]; G.parts.pop(); }
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.t += dt;
    t.y -= 30 * dt;
    if (t.t > 0.6) { G.texts[i] = G.texts[G.texts.length - 1]; G.texts.pop(); }
  }
  for (let i = G.timers.length - 1; i >= 0; i--) {
    const tm = G.timers[i];
    tm.t -= dt;
    if (tm.t <= 0) { G.timers.splice(i, 1); tm.fn(); }
  }
}

/* =========================================================
   MAIN UPDATE
   ========================================================= */
function update(dt) {
  const p = G.p;
  G.t += dt;
  if (G.t >= WIN_TIME) { endGame(true); return; }

  readInput();
  const sp = BASE_SPEED * S.speed;
  p.x += mvx * sp * dt;
  p.y += mvy * sp * dt;
  p.moving = mvx !== 0 || mvy !== 0;
  if (mvx > 0.1) p.face = 1; else if (mvx < -0.1) p.face = -1;
  p.iframes = Math.max(0, p.iframes - dt);
  if (S.regen > 0) p.hp = Math.min(p.maxHp, p.hp + S.regen * dt);
  G.hurtFlash = Math.max(0, G.hurtFlash - dt);
  G.shake = Math.max(0, G.shake - dt * 30);

  updateSpawns(dt);
  updateWeapons(dt);
  updateShots(dt);
  updateFx(dt);
  compactEnemies();
  updateEnemies(dt);
  if (state !== 'playing') return;      // player may have died
  updateGems(dt);

  cam.x += (p.x - cam.x) * Math.min(1, dt * 8);
  cam.y += (p.y - cam.y) * Math.min(1, dt * 8);

  if (G.pending > 0 && state === 'playing') {
    const chest = G.chestOpen;
    G.chestOpen = false;
    openLevelUp(chest);
  }
  updateHud();
}

function updateHud() {
  const p = G.p;
  el.hpFill.style.width = clamp(p.hp / p.maxHp, 0, 1) * 100 + '%';
  setText(el.hpText, Math.ceil(p.hp) + ' / ' + p.maxHp);
  el.xpFill.style.width = clamp(p.xp / p.xpNext, 0, 1) * 100 + '%';
  setText(el.level, 'LV ' + p.level);
  setText(el.time, fmtTime(G.t));
  setText(el.kills, '💀 ' + G.kills);
}

/* =========================================================
   RENDERING
   ========================================================= */
const PAL_HERO = {
  fur: '#f2994a', dark: '#b8661f', ear: '#ffb3b3', paw: '#fff4e0', muzzle: '#fff4e0',
  eye: '#6ef0ff', stripes: true, scarf: true, zombie: false,
};

function drawCat(x, y, r, pal, t, face, flash, rate) {
  const f = flash > 0;
  const fur = f ? '#ffffff' : pal.fur;
  const dark = f ? '#e8e8e8' : pal.dark;
  const ear = f ? '#ffffff' : pal.ear;
  ctx.save();
  ctx.translate(x, y);

  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.98, r * 0.95, r * 0.3, 0, 0, TAU);
  ctx.fill();

  ctx.translate(0, Math.sin(t * rate) * r * 0.06);
  ctx.scale(face, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // tail
  const w = Math.sin(t * 5) * r * 0.3;
  ctx.strokeStyle = fur;
  ctx.lineWidth = r * 0.3;
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, r * 0.4);
  ctx.bezierCurveTo(-r * 1.3, r * 0.4, -r * 1.45, -r * 0.4 + w, -r * 1.05, -r * 0.95 + w);
  ctx.stroke();

  // paws
  const st = Math.sin(t * rate) * r * 0.14;
  ctx.fillStyle = f ? '#fff' : (pal.paw || fur);
  ctx.beginPath(); ctx.ellipse(-r * 0.4, r * 0.88 + st * 0.4, r * 0.28, r * 0.18, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(r * 0.45, r * 0.88 - st * 0.4, r * 0.28, r * 0.18, 0, 0, TAU); ctx.fill();

  // body
  ctx.fillStyle = fur;
  ctx.beginPath(); ctx.ellipse(0, r * 0.3, r * 0.85, r * 0.66, 0, 0, TAU); ctx.fill();

  if (pal.stripes && !f) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = r * 0.11;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      ctx.moveTo(-r * 0.6 + k * r * 0.3, -r * 0.05);
      ctx.lineTo(-r * 0.55 + k * r * 0.3, r * 0.25);
    }
    ctx.stroke();
  }
  if (pal.zombie && !f) {              // exposed wound with rib bones
    ctx.fillStyle = '#8f2f3c';
    ctx.beginPath(); ctx.ellipse(-r * 0.2, r * 0.35, r * 0.34, r * 0.24, 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#efe6cf';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.28); ctx.lineTo(-r * 0.02, r * 0.4);
    ctx.moveTo(-r * 0.4, r * 0.42); ctx.lineTo(-r * 0.04, r * 0.3);
    ctx.stroke();
  }

  // head geometry
  const hx = r * 0.12, hy = -r * 0.3, hr = r * 0.78;

  // ears (zombies have one torn ear)
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.85, hy - hr * 0.2);
  ctx.lineTo(hx - hr * 0.7, hy - hr * 1.3);
  ctx.lineTo(hx - hr * 0.1, hy - hr * 0.85);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx + hr * 0.85, hy - hr * 0.2);
  if (pal.zombie) {
    ctx.lineTo(hx + hr * 0.75, hy - hr * 0.95);
    ctx.lineTo(hx + hr * 0.55, hy - hr * 0.8);
    ctx.lineTo(hx + hr * 0.4, hy - hr * 1.0);
  } else {
    ctx.lineTo(hx + hr * 0.7, hy - hr * 1.3);
  }
  ctx.lineTo(hx + hr * 0.1, hy - hr * 0.85);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ear;
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.62, hy - hr * 0.4);
  ctx.lineTo(hx - hr * 0.62, hy - hr * 1.0);
  ctx.lineTo(hx - hr * 0.25, hy - hr * 0.75);
  ctx.closePath(); ctx.fill();

  // head
  ctx.fillStyle = fur;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
  if (pal.muzzle) {
    ctx.fillStyle = f ? '#fff' : pal.muzzle;
    ctx.beginPath(); ctx.ellipse(hx + hr * 0.1, hy + hr * 0.42, hr * 0.5, hr * 0.36, 0, 0, TAU); ctx.fill();
  }

  // eyes
  const ex1 = hx - hr * 0.34, ex2 = hx + hr * 0.4, ey = hy - hr * 0.05, er = hr * 0.22;
  if (pal.zombie) {
    // one glowing eye, one stitched "X" eye
    ctx.fillStyle = '#ffe65c';
    ctx.beginPath(); ctx.arc(ex2, ey, er, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a2a00';
    ctx.fillRect(ex2 - er * 0.12, ey - er * 0.8, er * 0.24, er * 1.6);
    ctx.strokeStyle = '#1a0f14';
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(ex1 - er * 0.8, ey - er * 0.8); ctx.lineTo(ex1 + er * 0.8, ey + er * 0.8);
    ctx.moveTo(ex1 + er * 0.8, ey - er * 0.8); ctx.lineTo(ex1 - er * 0.8, ey + er * 0.8);
    ctx.stroke();
  } else {
    ctx.fillStyle = pal.eye;
    ctx.beginPath(); ctx.arc(ex1, ey, er, 0, TAU); ctx.arc(ex2, ey, er, 0, TAU); ctx.fill();
    ctx.fillStyle = '#10202a';
    ctx.beginPath();
    ctx.ellipse(ex1 + er * 0.1, ey, er * 0.28, er * 0.8, 0, 0, TAU);
    ctx.ellipse(ex2 + er * 0.1, ey, er * 0.28, er * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex1 - er * 0.35, ey - er * 0.4, er * 0.22, 0, TAU);
    ctx.arc(ex2 - er * 0.35, ey - er * 0.4, er * 0.22, 0, TAU);
    ctx.fill();
  }

  // nose + mouth
  const nx = hx + hr * 0.08, ny = hy + hr * 0.28;
  ctx.fillStyle = pal.zombie ? '#7a3a48' : '#ff8fa3';
  ctx.beginPath();
  ctx.moveTo(nx - hr * 0.1, ny); ctx.lineTo(nx + hr * 0.1, ny); ctx.lineTo(nx, ny + hr * 0.1);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#1a0f14';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  if (pal.zombie) {
    ctx.moveTo(nx - hr * 0.35, ny + hr * 0.22);
    ctx.lineTo(nx - hr * 0.18, ny + hr * 0.14);
    ctx.lineTo(nx, ny + hr * 0.24);
    ctx.lineTo(nx + hr * 0.18, ny + hr * 0.14);
    ctx.lineTo(nx + hr * 0.35, ny + hr * 0.22);
    ctx.stroke();
    ctx.fillStyle = '#f4f1e0';              // little fangs
    ctx.beginPath();
    ctx.moveTo(nx - hr * 0.2, ny + hr * 0.15); ctx.lineTo(nx - hr * 0.12, ny + hr * 0.15); ctx.lineTo(nx - hr * 0.16, ny + hr * 0.32);
    ctx.moveTo(nx + hr * 0.12, ny + hr * 0.15); ctx.lineTo(nx + hr * 0.2, ny + hr * 0.15); ctx.lineTo(nx + hr * 0.16, ny + hr * 0.32);
    ctx.fill();
  } else {
    ctx.moveTo(nx, ny + hr * 0.1);
    ctx.quadraticCurveTo(nx - hr * 0.1, ny + hr * 0.3, nx - hr * 0.22, ny + hr * 0.2);
    ctx.moveTo(nx, ny + hr * 0.1);
    ctx.quadraticCurveTo(nx + hr * 0.1, ny + hr * 0.3, nx + hr * 0.22, ny + hr * 0.2);
    ctx.stroke();
  }

  // stitches across the zombie's forehead
  if (pal.zombie && !f) {
    ctx.strokeStyle = '#1a0f14';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(hx - hr * 0.6, hy - hr * 0.55); ctx.lineTo(hx - hr * 0.1, hy - hr * 0.35);
    for (let k = 0; k < 3; k++) {
      const sx = hx - hr * 0.5 + k * hr * 0.17, sy = hy - hr * 0.5 + k * hr * 0.075;
      ctx.moveTo(sx, sy - hr * 0.1); ctx.lineTo(sx + hr * 0.03, sy + hr * 0.1);
    }
    ctx.stroke();
  }

  // whiskers
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    for (let k = -1; k <= 1; k++) {
      ctx.moveTo(nx + s * hr * 0.3, ny + hr * 0.1 + k * hr * 0.06);
      ctx.lineTo(nx + s * hr * 0.95, ny + hr * 0.02 + k * hr * 0.2);
    }
  }
  ctx.stroke();

  // hero scarf
  if (pal.scarf) {
    ctx.strokeStyle = '#d93b5a';
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.arc(hx - r * 0.02, hy + hr * 0.1, hr * 0.92, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#d93b5a';
    const fl = Math.sin(t * 8) * r * 0.1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, r * 0.3);
    ctx.lineTo(-r * 1.0, r * 0.45 + fl);
    ctx.lineTo(-r * 0.95, r * 0.7 + fl);
    ctx.lineTo(-r * 0.35, r * 0.45);
    ctx.closePath(); ctx.fill();
  }

  // boss crown
  if (pal.crown) {
    ctx.fillStyle = '#ffd24a';
    ctx.strokeStyle = '#8a5a00';
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath();
    const cy = hy - hr * 0.88, cw = hr * 0.55;
    ctx.moveTo(hx - cw, cy);
    ctx.lineTo(hx - cw, cy - hr * 0.5);
    ctx.lineTo(hx - cw * 0.5, cy - hr * 0.22);
    ctx.lineTo(hx, cy - hr * 0.6);
    ctx.lineTo(hx + cw * 0.5, cy - hr * 0.22);
    ctx.lineTo(hx + cw, cy - hr * 0.5);
    ctx.lineTo(hx + cw, cy);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

const BOSS_PAL = Object.assign({ zombie: true, crown: true }, ETYPES.boss.colors[0]);
const zombiePals = new Map();
function palFor(e) {
  if (e.boss) return BOSS_PAL;
  let p = zombiePals.get(e.pal);
  if (!p) { p = Object.assign({ zombie: true }, e.pal); zombiePals.set(e.pal, p); }
  return p;
}

/* ----- ground: tiles, gravestones, bones ----- */
const TILE = 96;
const TILE_COLORS = ['#150f22', '#171124', '#130d1f', '#181226'];
function drawGround(left, top, vw, vh) {
  const x0 = Math.floor(left / TILE) - 1, x1 = Math.floor((left + vw) / TILE) + 1;
  const y0 = Math.floor(top / TILE) - 1, y1 = Math.floor((top + vh) / TILE) + 1;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const h = hash(ix, iy);
      ctx.fillStyle = TILE_COLORS[h & 3];
      ctx.fillRect(ix * TILE, iy * TILE, TILE + 1, TILE + 1);
      const ox = ix * TILE + ((h >>> 4) % 60) + 18;
      const oy = iy * TILE + ((h >>> 10) % 60) + 18;
      const kind = (h >>> 16) % 14;
      if (kind === 0) {                       // gravestone
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(ox, oy + 16, 17, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2d2744';
        ctx.beginPath();
        ctx.moveTo(ox - 13, oy + 16); ctx.lineTo(ox - 13, oy - 4);
        ctx.arc(ox, oy - 4, 13, Math.PI, 0);
        ctx.lineTo(ox + 13, oy + 16);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#4a4268';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ox - 11, oy - 5); ctx.arc(ox, oy - 4, 11, Math.PI, Math.PI * 1.45); ctx.stroke();
        ctx.strokeStyle = '#1c1830';       // little cat-face engraving
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ox - 6, oy - 4); ctx.lineTo(ox - 6, oy - 10); ctx.lineTo(ox - 2, oy - 6);
        ctx.lineTo(ox + 2, oy - 6); ctx.lineTo(ox + 6, oy - 10); ctx.lineTo(ox + 6, oy - 4);
        ctx.stroke();
      } else if (kind === 1 || kind === 2) {  // grass tufts
        ctx.strokeStyle = '#243a2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = -1; k <= 1; k++) { ctx.moveTo(ox + k * 4, oy + 6); ctx.lineTo(ox + k * 7, oy - 4); }
        ctx.stroke();
      } else if (kind === 3) {                // scattered fish bone
        ctx.strokeStyle = '#4b4560';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy);
        for (let k = -1; k <= 1; k++) { ctx.moveTo(ox + k * 4, oy - 5); ctx.lineTo(ox + k * 4, oy + 5); }
        ctx.stroke();
      } else if (kind === 4) {                // faint paw print
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.ellipse(ox, oy + 3, 6, 5, 0, 0, TAU); ctx.fill();
        for (let k = -1; k <= 2; k++) {
          ctx.beginPath(); ctx.arc(ox - 7.5 + k * 5, oy - 5 - (k === 0 || k === 1 ? 3 : 0), 2.4, 0, TAU); ctx.fill();
        }
      }
    }
  }
}

function inView(x, y, m, left, top, vw, vh) {
  return x > left - m && x < left + vw + m && y > top - m && y < top + vh + m;
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0814';
  ctx.fillRect(0, 0, W, H);
  if (!G) return;

  const s = viewScale * dpr;
  const vw = W / s, vh = H / s;
  const shx = G.shake > 0 ? rand(-G.shake, G.shake) * 0.5 : 0;
  const shy = G.shake > 0 ? rand(-G.shake, G.shake) * 0.5 : 0;
  const left = cam.x - vw / 2 + shx, top = cam.y - vh / 2 + shy;
  ctx.setTransform(s, 0, 0, s, -left * s, -top * s);

  drawGround(left, top, vw, vh);

  // gems
  for (const g of G.gems) {
    if (!inView(g.x, g.y, 20, left, top, vw, vh)) continue;
    const big = g.v >= 20 ? 2 : g.v >= 5 ? 1 : 0;
    const sz = 4.5 + big * 2.5 + Math.sin(animT * 6 + g.x) * 0.6;
    ctx.fillStyle = big === 2 ? '#ffd85e' : big === 1 ? '#7dff9b' : '#6ee7ff';
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - sz * 1.3); ctx.lineTo(g.x + sz, g.y);
    ctx.lineTo(g.x, g.y + sz * 1.3); ctx.lineTo(g.x - sz, g.y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(g.x - 1, g.y - sz * 0.8, 2, sz * 0.7);
  }

  // pickups
  for (const k of G.pickups) {
    const bob = Math.sin(animT * 4 + k.x) * 2;
    if (k.type === 'fish') {
      ctx.fillStyle = '#ff9d3c';
      ctx.beginPath(); ctx.ellipse(k.x, k.y + bob, 11, 6, 0, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(k.x + 9, k.y + bob); ctx.lineTo(k.x + 18, k.y - 6 + bob); ctx.lineTo(k.x + 18, k.y + 6 + bob);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#10202a'; ctx.fillRect(k.x - 7, k.y - 2 + bob, 2.5, 2.5);
    } else if (k.type === 'magnet') {
      ctx.strokeStyle = '#d93b5a'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(k.x, k.y + bob, 9, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = '#efe6cf';
      ctx.fillRect(k.x - 12, k.y - 4 + bob, 6, 5); ctx.fillRect(k.x + 6, k.y - 4 + bob, 6, 5);
    } else {
      const pulse = 1 + Math.sin(animT * 6) * 0.06;
      ctx.save(); ctx.translate(k.x, k.y + bob); ctx.scale(pulse, pulse);
      ctx.fillStyle = 'rgba(255,210,74,0.2)';
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a4a1e'; ctx.fillRect(-16, -10, 32, 22);
      ctx.fillStyle = '#9a6228'; ctx.fillRect(-16, -10, 32, 8);
      ctx.fillStyle = '#ffd24a'; ctx.fillRect(-3, -10, 6, 22); ctx.fillRect(-16, -2, 32, 3);
      ctx.restore();
    }
  }

  // ground effects (rings, booms, moon warnings)
  for (const f of G.fx) {
    const k = f.t / f.life;
    if (f.type === 'ring') {
      ctx.strokeStyle = 'rgba(' + f.col + ',' + (1 - k) * 0.9 + ')';
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.rad * (0.2 + 0.8 * k), 0, TAU); ctx.stroke();
    } else if (f.type === 'boom') {
      ctx.fillStyle = 'rgba(190,170,90,' + (1 - k) * 0.45 + ')';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.rad * (0.4 + 0.6 * k), 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,170,' + (1 - k) + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  for (const sh of G.shots) {
    if (sh.type !== 'moon') continue;
    if (!sh.struck) {
      const k = sh.t / sh.warn;
      ctx.strokeStyle = 'rgba(190,230,255,' + (0.35 + 0.4 * k) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.rad * (1.1 - 0.2 * k), 0, TAU); ctx.stroke();
    } else {
      const k = (sh.t - sh.warn) / 0.3;
      const bw = sh.rad * (1 - k * 0.6);
      const grad = ctx.createLinearGradient(0, sh.y - 500, 0, sh.y);
      grad.addColorStop(0, 'rgba(190,230,255,0)');
      grad.addColorStop(1, 'rgba(220,240,255,' + (1 - k) * 0.9 + ')');
      ctx.fillStyle = grad;
      ctx.fillRect(sh.x - bw, sh.y - 500, bw * 2, 500);
      ctx.fillStyle = 'rgba(220,240,255,' + (1 - k) * 0.5 + ')';
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.rad, 0, TAU); ctx.fill();
    }
  }

  // enemies, back to front
  const E = G.enemies;
  E.sort((a, b) => a.y - b.y);
  let boss = null;
  for (const e of E) {
    if (e.boss) boss = e;
    if (!inView(e.x, e.y, 60, left, top, vw, vh)) continue;
    if (e.boss) {
      const aura = ctx.createRadialGradient(e.x, e.y, 10, e.x, e.y, 100);
      aura.addColorStop(0, 'rgba(180,120,255,0.35)');
      aura.addColorStop(1, 'rgba(180,120,255,0)');
      ctx.fillStyle = aura;
      ctx.fillRect(e.x - 100, e.y - 100, 200, 200);
    }
    drawCat(e.x, e.y, e.r, palFor(e), e.t, e.face, e.flash, e.rate);
    if (e.boss) {
      const bw = 90;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(e.x - bw / 2, e.y - e.r * 2.3, bw, 8);
      ctx.fillStyle = '#d93b5a'; ctx.fillRect(e.x - bw / 2, e.y - e.r * 2.3, bw * clamp(e.hp / e.maxHp, 0, 1), 8);
    }
  }

  // player (with a soft lantern glow)
  const p = G.p;
  const glow = ctx.createRadialGradient(p.x, p.y, 8, p.x, p.y, 230);
  glow.addColorStop(0, 'rgba(255,200,120,0.2)');
  glow.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(p.x - 230, p.y - 230, 460, 460);
  if (p.iframes > 0 && Math.floor(animT * 20) % 2 === 0) ctx.globalAlpha = 0.45;
  drawCat(p.x, p.y, p.r, PAL_HERO, animT, p.face, 0, p.moving ? 14 : 4);
  ctx.globalAlpha = 1;

  // yarn balls
  const yarn = G.weapons.yarn;
  if (yarn) {
    for (const b of yarn.pos) {
      if (!b) continue;
      ctx.fillStyle = '#ff7fb0';
      ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#c24a7e'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7, animT * 3, animT * 3 + 3);
      ctx.moveTo(b.x - 9, b.y + 2); ctx.quadraticCurveTo(b.x, b.y - 8, b.x + 9, b.y + 1);
      ctx.stroke();
    }
  }

  // projectiles
  for (const sh of G.shots) {
    if (sh.type === 'bone') {
      ctx.save();
      ctx.translate(sh.x, sh.y); ctx.rotate(sh.ang);
      ctx.strokeStyle = '#efe6cf'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-9, 0); ctx.lineTo(8, 0);
      for (let k = -1; k <= 1; k++) { ctx.moveTo(k * 3.5, -5); ctx.lineTo(k * 3.5, 5); }
      ctx.stroke();
      ctx.fillStyle = '#efe6cf';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(13, -4); ctx.lineTo(13, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (sh.type === 'ball') {
      const k = sh.t / sh.dur;
      const arc = Math.sin(k * Math.PI) * 60;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 9, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8c7a4f';
      ctx.beginPath(); ctx.arc(sh.x, sh.y - arc, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5d4f2e'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sh.x - 7, sh.y - arc - 2); ctx.lineTo(sh.x - 1, sh.y - arc + 4);
      ctx.moveTo(sh.x + 2, sh.y - arc - 6); ctx.lineTo(sh.x + 8, sh.y - arc);
      ctx.stroke();
    }
  }

  // slashes
  for (const f of G.fx) {
    if (f.type !== 'slash') continue;
    const k = f.t / f.life;
    ctx.lineCap = 'round';
    for (let m = 0; m < 3; m++) {
      const rr = f.range * (0.62 + m * 0.19) * (0.85 + 0.15 * k);
      ctx.strokeStyle = 'rgba(255,248,225,' + (1 - k) * (0.95 - m * 0.2) + ')';
      ctx.lineWidth = (9 - m * 2) * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr, f.ang - f.arc / 2 + k * 0.3, f.ang + f.arc / 2 + k * 0.3);
      ctx.stroke();
    }
  }

  // particles
  for (const q of G.parts) {
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
    ctx.fillStyle = q.col;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;

  // floating numbers
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  for (const t of G.texts) {
    ctx.globalAlpha = clamp(1 - t.t / 0.6, 0, 1);
    ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    ctx.strokeText(t.txt, t.x, t.y);
    ctx.fillStyle = t.col;
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  /* ----- screen space overlays ----- */
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // the dark: heavy vignette around the lantern
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.22, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(5,3,12,0)');
  vg.addColorStop(1, 'rgba(5,3,12,0.78)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  if (G.hurtFlash > 0) {
    ctx.fillStyle = 'rgba(217,59,90,' + G.hurtFlash * 0.45 + ')';
    ctx.fillRect(0, 0, W, H);
  }

  // arrow toward an off-screen boss
  if (boss && state !== 'menu') {
    const bx = (boss.x - cam.x) * s + W / 2, by = (boss.y - cam.y) * s + H / 2;
    const m = 36 * dpr;
    if (bx < 0 || bx > W || by < 0 || by > H) {
      const dx = bx - W / 2, dy = by - H / 2;
      const k = Math.min((W / 2 - m) / Math.abs(dx || 1), (H / 2 - m) / Math.abs(dy || 1));
      const ax = W / 2 + dx * k, ay = H / 2 + dy * k;
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#d93b5a';
      ctx.beginPath();
      ctx.moveTo(16 * dpr, 0); ctx.lineTo(-10 * dpr, -11 * dpr); ctx.lineTo(-10 * dpr, 11 * dpr);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // touch / drag joystick
  if (joy.active && state === 'playing') {
    ctx.strokeStyle = 'rgba(239,230,207,0.35)';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.arc(joy.ox * dpr, joy.oy * dpr, 55 * dpr, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,157,60,0.5)';
    ctx.beginPath(); ctx.arc((joy.ox + joy.dx) * dpr, (joy.oy + joy.dy) * dpr, 22 * dpr, 0, TAU); ctx.fill();
  }
}

/* =========================================================
   LOOP
   ========================================================= */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  animT += dt;
  if (state === 'playing') update(dt);
  render();
  requestAnimationFrame(frame);
}

toMenu();
requestAnimationFrame(frame);

})();
