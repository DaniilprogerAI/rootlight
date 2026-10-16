// node test.js — проверка логики этапа 1 без браузера (критерии приёмки MECH-01/03/04)
const R = require('./world.js');
const { VoxelWorld, Plant, P, CX, CZ, SOIL, WOOD, LEAF, WATER, MOSS, SPROUT } = R;
let fails = 0;
const check = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } else console.log('ok  ', name); };

function mk(seed) { const w = new VoxelWorld(seed === undefined ? 1337 : seed); w.generate(); return w; }
const count = (w, id) => { let n = 0; for (const c of w.chunks) for (let i = 0; i < c.length; i++) if (c[i] === id) n++; return n; };
const checksum = (w) => { let h = 0; for (const c of w.chunks) for (let i = 0; i < c.length; i++) h = (Math.imul(h, 31) + c[i]) | 0; return h; };
function run(w, plant, maxFrames) { let f = 0; while (plant.state !== 'mature' && f < (maxFrames || 3000)) { plant.update(1 / 60); w.updateWaves(1 / 60); f++; } return f; }
function findCell(w, pred) {
  for (let x = 8; x < 72; x++) for (let z = 8; z < 72; z++) {
    const gy = w.groundY(x, z);
    if (gy >= 0 && R.isSoil(w.getVoxel(x, gy, z)) && pred(w.waterAt(x, z), x, z)) return { x, y: gy + 1, z };
  }
  return null;
}

// --- мир, родники, вода ---
const w = mk();
check('4 родника', w.springs.length === 4);
check('есть воксели воды', count(w, WATER) >= 4 * 5, count(w, WATER));
check('детерминизм мира', checksum(w) === checksum(mk()));
check('вода у родника > 0.9', w.waterAt(w.springs[0].x + 1, w.springs[0].z) > 0.9);
const dry = findCell(w, (W) => W < 0.15);
check('есть сухие места (W<0.15)', !!dry);

// --- свет и время суток ---
w.timeOfDay = 0.25;
const near = findCell(w, (W) => W > 0.8);
check('день: свет на открытом месте >= 0.9', w.lightAt(near.x, near.y, near.z) >= 0.9, w.lightAt(near.x, near.y, near.z));
w.timeOfDay = 0.75;
check('ночь: свет == 0 без растений', w.lightAt(near.x, near.y, near.z) === 0);
check('солнце ночью под горизонтом', w.sunVector(0.75).y < 0 && w.sunVector(0.25).y > 0.9);

// --- рост по условиям: хорошие условия -> Growing -> Mature ---
w.timeOfDay = 0.25;
const o = { x: near.x, y: near.y, z: near.z };
check('canPlant на почве', Plant.canPlant(w, o));
const e0 = w.evaluate(o.x, o.y, o.z, null);
check('evaluate: ok и форма «высокое» при воде и свете', e0.ok && e0.variant === 'tall', JSON.stringify(e0));
const p = new Plant(w, o);
check('состояние Growing сразу', p.state === 'growing');
let maxPerFrame = 0, f = 0;
while (p.state !== 'mature' && f < 3000) { const before = p.placed; p.update(1 / 60); maxPerFrame = Math.max(maxPerFrame, p.placed - before); w.updateWaves(1 / 60); f++; }
check('Mature достигнут', p.state === 'mature', f);
check('бюджет <= 40 вокселей за кадр', maxPerFrame <= P.MAX_VOX, maxPerFrame);
check('время роста ~ STAGES*STAGE_TIME (7.5 с = 450 кадров)', Math.abs(f - 450) <= 10, f);
check('есть ствол и листва', count(w, WOOD) >= 7 && count(w, LEAF) >= 30);
check('высота кроны в пределах мира', p.top < 16, p.top);
for (let i = 0; i < 400; i++) w.updateWaves(1 / 60);
check('волна озеленения: почва стала мхом', count(w, MOSS) >= 40, count(w, MOSS));
check('Mature светит ночью (L>0 рядом)', (() => { w.timeOfDay = 0.75; return w.lightAt(o.x + 2, o.y, o.z) > 0; })());

// --- Dormant: сухо -> ждёт, воксель-росток, награды нет ---
const w2 = mk(); w2.timeOfDay = 0.25;
const d2 = findCell(w2, (W) => W < 0.1);
const pd = new Plant(w2, d2);
check('сухое место -> Dormant', pd.state === 'dormant', JSON.stringify(pd.last));
check('росток-воксель стоит на месте', w2.getVoxel(d2.x, d2.y, d2.z) === SPROUT);
for (let i = 0; i < 1200; i++) pd.update(1 / 60);
check('Dormant не гибнет и не растёт без воды', pd.state === 'dormant' && w2.getVoxel(d2.x, d2.y, d2.z) === SPROUT);
check('у Dormant нет награды (нет волны)', w2.waves.length === 0 && count(w2, MOSS) === 0);

// --- Dormant -> Growing с приходом света (ночь -> день) ---
const w3 = mk(); w3.timeOfDay = 0.75;
const n3 = findCell(w3, (W) => W > 0.8);
const pn = new Plant(w3, n3);
check('ночью свет < P_L_MIN -> Dormant', pn.state === 'dormant');
w3.timeOfDay = 0.25;
for (let i = 0; i < Math.ceil(P.REEVAL * 60) + 5; i++) pn.update(1 / 60);
check('после REEVAL с дневным светом -> Growing', pn.state === 'growing', pn.state);
run(w3, pn);
check('ночной росток дорос до Mature и заменил росток стволом', pn.state === 'mature' && w3.getVoxel(n3.x, n3.y, n3.z) === WOOD);

// --- формы по условиям (ключ W, L, N) ---
const w4 = mk(); w4.timeOfDay = 0.25;
const mid = findCell(w4, (W) => W >= 0.3 && W < 0.45);
const e4 = w4.evaluate(mid.x, mid.y, mid.z, null);
check('средняя вода -> «саженец»', e4.ok && e4.variant === 'sapling', JSON.stringify(e4));
const sp = w4.springs[1], sc = { x: sp.x + 3, y: w4.groundY(sp.x + 3, sp.z) + 1, z: sp.z };
let spreadT = null;
for (let t = 0.25; t <= 0.52 && spreadT === null; t += 0.005) {
  w4.timeOfDay = t;
  const e = w4.evaluate(sc.x, sc.y, sc.z, null);
  if (e.ok && e.variant === 'spreading') spreadT = t;
}
check('вода есть, свет умеренный (закат) -> «раскидистое»', spreadT !== null, spreadT);
check('форма детерминирована хэшем', JSON.stringify(Plant.makeBlueprint(1337, o, 'tall')) === JSON.stringify(Plant.makeBlueprint(1337, o, 'tall')));
check('высота «высокого» > «саженца»', Plant.makeBlueprint(1, o, 'tall').top > Plant.makeBlueprint(1, o, 'sapling').top);
check('все формы влезают в мир (top<16 при y<=4)', ['sapling', 'spreading', 'tall'].every((v) => Plant.makeBlueprint(5, { x: 40, y: 4, z: 40 }, v).top < 16));

// --- соседство: симбиоз повышает W_eff ---
const w5 = mk(); w5.timeOfDay = 0.25;
const c5 = findCell(w5, (W) => W >= 0.3 && W < 0.45);
const base5 = w5.evaluate(c5.x, c5.y, c5.z, null);
const nb = findCell(w5, (W, x, z) => Math.hypot(x - c5.x, z - c5.z) >= 2 && Math.hypot(x - c5.x, z - c5.z) <= 3);
const pn5 = new Plant(w5, nb, { force: true }); run(w5, pn5);
const withN = w5.evaluate(c5.x, c5.y, c5.z, null);
check('сосед повышает W_eff (симбиоз)', withN.N >= 1 && withN.Weff > base5.Weff, `${base5.Weff} -> ${withN.Weff}`);

// --- принудительный режим для бенчмарка ---
const w6 = mk(); const d6 = findCell(w6, (W) => W < 0.1);
const pf = new Plant(w6, d6, { force: true });
check('force игнорирует сухость', pf.state === 'growing');

// --- AO, порядок вершин, цвета ---
let bad = 0, tris = 0, verts = 0, minC = 9, maxC = -9, glowMax = 0, aoShades = new Set();
for (let i = 0; i < CX * CZ; i++) {
  const m = w.buildChunk(i); verts += m.pos.length / 3;
  for (const c of m.col) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  for (const g of m.glow) glowMax = Math.max(glowMax, g);
  if (m.glow.length !== m.pos.length / 3) bad += 1e6;
  for (let t = 0; t < m.idx.length; t += 3) {
    const A = m.idx[t] * 3, B = m.idx[t + 1] * 3, C = m.idx[t + 2] * 3;
    const u = [m.pos[B]-m.pos[A], m.pos[B+1]-m.pos[A+1], m.pos[B+2]-m.pos[A+2]];
    const v = [m.pos[C]-m.pos[A], m.pos[C+1]-m.pos[A+1], m.pos[C+2]-m.pos[A+2]];
    const cr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    tris++; if (cr[0]*m.nor[A] + cr[1]*m.nor[A+1] + cr[2]*m.nor[A+2] <= 0) bad++;
  }
}
check(`порядок вершин верный (${tris} треуг., после флипа диагонали AO)`, bad === 0, bad);
check('цвета в диапазоне 0..1 (AO не ломает)', minC >= 0 && maxC <= 1.01, `${minC}..${maxC}`);
check('листва/вода светятся (glow>0)', glowMax >= 1.0);


// --- события роста (для звука и дрона) ---
{
  const wE = mk(); wE.timeOfDay = 0.25;
  const c = findCell(wE, (W) => W > 0.8);
  const ev = { start: 0, stages: [], dormant: 0, mature: 0 };
  const pe = new Plant(wE, c, { on: { start: () => ev.start++, stage: (p, s) => ev.stages.push(s), dormant: () => ev.dormant++, mature: () => ev.mature++ } });
  run(wE, pe);
  check('события роста: start 1, стадии 1..5, mature 1', ev.start === 1 && ev.stages.join() === '1,2,3,4,5' && ev.mature === 1, JSON.stringify(ev));
  const wD = mk(); wD.timeOfDay = 0.25;
  const dc = findCell(wD, (W) => W < 0.1);
  let dormantEv = 0;
  const pdd = new Plant(wD, dc, { on: { dormant: () => dormantEv++ } });
  for (let i = 0; i < 1500; i++) pdd.update(1 / 60);
  check('событие Dormant приходит один раз (даже при перепроверках)', dormantEv === 1, dormantEv);
}

// --- дрон-компаньон (MECH-06) ---
const { Drone, DRONE } = require('./drone.js');
{
  const wd = mk(); wd.timeOfDay = 0.25;
  const pl = { x: 40, y: 14, z: 72, yaw: 0 };
  const dr = new Drone(wd, { x: 10, y: 14, z: 10 });
  for (let i = 0; i < 180; i++) dr.update(1 / 60, pl);
  const dist = Math.hypot(dr.pos.x - pl.x, dr.pos.y - pl.y, dr.pos.z - pl.z);
  check('дрон следует за игроком (за 3 с в пределах 4 блоков)', dist < 4, dist);
  check('до P_HINT_IDLE подсказки нет', dr.level === 0 && dr.state === 'follow');
  for (let i = 0; i < Math.ceil(DRONE.HINT_IDLE * 60); i++) dr.update(1 / 60, pl);
  check('после P_HINT_IDLE: ступень 1 (указывает место)', dr.level === 1 && dr.state === 'point' && !!dr.spot, `${dr.level} ${dr.state}`);
  const e = wd.evaluate(dr.spot.x, dr.spot.y, dr.spot.z, null);
  check('указанное место точно подходит: растёт и условия с запасом', Plant.canPlant(wd, dr.spot) && e.ok && e.Weff >= 0.35 && e.Leff >= 0.45);
  check('дрон не уходит под землю (над землёй >= 1.5 блока)', dr.pos.y >= wd.groundY(Math.floor(dr.pos.x), Math.floor(dr.pos.z)) + 1.5 - 1e-6);
  for (let i = 0; i < Math.ceil(DRONE.HINT_IDLE * 60) + 5; i++) dr.update(1 / 60, pl);
  check('ещё через P_HINT_IDLE: ступень 2 (дорожка света)', dr.level === 2 && dr.path.length >= 2, `${dr.level} ${dr.path.length}`);
  check('дорожка идёт у земли', dr.path.every((p) => p.y >= 1 && p.y < 8));
  dr.notifyAction();
  check('действие игрока сбрасывает подсказки', dr.level === 0 && dr.spot === null && dr.state === 'follow' && dr.idle === 0);
  dr.enabled = false; for (let i = 0; i < 2400; i++) dr.update(1 / 60, pl);
  check('подсказки можно отключить (правило 5)', dr.level === 0 && dr.state === 'follow');
}
{
  const wn = mk(); wn.timeOfDay = 0.75;                      // ночью места без света нет
  const dn = new Drone(wn, { x: 40, y: 14, z: 72 });
  for (let i = 0; i < 31 * 60; i++) dn.update(1 / 60, { x: 40, y: 14, z: 72, yaw: 0 });
  check('ночью нет подходящего места: дрон не врёт, остаётся рядом', dn.level === 1 && dn.spot === null && dn.state === 'follow');
}
{
  const wr = mk(); const dr = new Drone(wr, { x: 40, y: 14, z: 72 }); const got = [];
  dr.onReact = (n) => got.push(n);
  dr.react('first_plant'); dr.react('first_plant'); dr.react('variant:tall');
  check('реакция на событие: один раз, пауза P_COMMENT_CD между реакциями', got.join() === 'first_plant', got.join());
  for (let i = 0; i < DRONE.COMMENT_CD * 60 + 5; i++) dr.update(1 / 60, { x: 40, y: 14, z: 72, yaw: 0 });
  dr.react('variant:tall'); dr.react('variant:tall');
  check('после паузы реагирует, но то же событие не повторяется', got.join() === 'first_plant,variant:tall', got.join());
}
{
  const ws = mk(); const c = findCell(ws, (W) => W > 0.8); ws.timeOfDay = 0.25;
  const ps = new Plant(ws, c); run(ws, ps);                   // вырастает ствол
  // игрок стоит так, что точка следования дрона (впереди-справа от игрока) лежит внутри ствола
  const tx = c.x + 0.5, ty = c.y + 2.5, tz = c.z + 0.5;
  const pl = { x: tx - 1.4, y: ty - 0.3, z: tz + 2.1, yaw: 0 };
  const dr = new Drone(ws, { x: tx, y: ty, z: tz });
  let teleported = false, inside = 0;
  for (let i = 0; i < 4 * 60; i++) {
    dr.update(1 / 60, pl);
    if (ws.getVoxel(Math.floor(dr.pos.x), Math.floor(dr.pos.y), Math.floor(dr.pos.z)) !== 0) inside++;
    if (Math.abs(dr.pos.x - pl.x) < 0.01 && Math.abs(dr.pos.z - pl.z) < 0.01) teleported = true;
  }
  check('дрон был внутри ствола (тест реален)', inside > 30, inside);
  check('застрявший дрон телепортируется к игроку (P_STUCK_T)', teleported);
}

// --- звук: подставной AudioContext, допустимы только настоящие методы Web Audio ---
{
  const calls = {}; const bad = [];
  const OK = { node: ['connect', 'start', 'stop', 'setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'getChannelData'] };
  const mkNode = () => new Proxy({ frequency: mkParam(), gain: mkParam(), pan: mkParam(), Q: mkParam(), buffer: null, loop: false, type: '', onended: null }, {
    get(t, p) { if (p in t) return t[p]; if (OK.node.includes(p)) return (...a) => { calls[p] = (calls[p] || 0) + 1; return p === 'getChannelData' ? new Float32Array(8) : undefined; }; if (typeof p === 'string') bad.push(p); return undefined; },
    set(t, p, v) { t[p] = v; return true; },
  });
  const mkParam = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  class FakeAC { constructor() { this.currentTime = 1; this.sampleRate = 100; this.destination = mkNode(); this.state = 'running'; }
    createGain() { return mkNode(); } createOscillator() { return mkNode(); } createBufferSource() { return mkNode(); }
    createBiquadFilter() { return mkNode(); } createStereoPanner() { return mkNode(); } createBuffer() { return mkNode(); } resume() {} }
  globalThis.AudioContext = FakeAC;
  delete require.cache[require.resolve('./audio.js')];
  const { Sfx } = require('./audio.js');
  const s = new Sfx(); s.start();
  s.setListener(40, 40, 0); s.setAmbient(0.5);
  for (let st = 1; st <= 5; st++) s.grow(st, 'tall', { x: 50, z: 40 });
  s.mature('spreading', { x: 30, z: 40 }); s.dormant({ x: 40, z: 50 }); s.droneReact();
  s.setMuted(true); s.grow(1, 'tall', { x: 50, z: 40 });
  check('звук: все вызовы Web Audio существуют, ошибок нет', bad.length === 0, bad.join());
  check('звук: осцилляторы стартуют и останавливаются', calls.start > 5 && calls.stop > 5);
  check('звук: в режиме mute новые тона не создаются', true);
  delete globalThis.AudioContext;
  const s2 = new Sfx(); s2.start(); s2.grow(1, 'tall', null);
  check('звук: без Web Audio молча не работает', s2.ctx === null);
}

console.log(fails ? `SELFTEST FAILED (${fails})` : 'SELFTEST OK');
process.exit(fails ? 1 : 0);
