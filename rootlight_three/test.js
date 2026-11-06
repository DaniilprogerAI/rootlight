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
    if (gy >= 0 && R.isSoil(w.getVoxel(x, gy, z)) && R.Plant.canPlant(w, { x, y: gy + 1, z }) && pred(w.waterAt(x, z), x, z)) return { x, y: gy + 1, z };
  }
  return null;
}

// --- мир, родники, вода ---
const w = mk();
check('6 родников (2 пустошь, 1 дюны, 3 низина)', w.springs.length === 6);
check('есть воксели воды', count(w, WATER) >= 6 * 5, count(w, WATER));
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
check('есть ствол и листва', count(w, WOOD) >= 7 && (count(w, LEAF) + count(w, R.LEAF_B) + count(w, R.LEAF_C)) >= 30);
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
  const ps = new Plant(ws, c); run(ws, ps);
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
{
  const wq = mk(); wq.timeOfDay = 0.25;
  const dq = new Drone(wq, { x: 56, y: 12, z: 84 }); const pl = { x: 56, y: 12, z: 84, yaw: 0 };
  const g = wq.glyphs[0]; const got = [];
  dq.onReact = (n) => got.push(n);
  dq.react('first_plant'); dq.react('echo1', true);
  check('сюжетная реакция не глушится паузой P_COMMENT_CD', got.join() === 'first_plant,echo1', got.join());
  dq.pointAt({ x: g.x, y: g.y + 1, z: g.z }, 6);
  for (let i = 0; i < 60; i++) dq.update(1 / 60, pl);
  check('дрон указывает на знак (состояние point, подсказки простоя приостановлены)', dq.state === 'point' && dq.story && dq.spot.x === g.x && dq.idle === 0);
  for (let i = 0; i < 60 * 8; i++) dq.update(1 / 60, pl);
  check('после указания дрон возвращается к игроку', dq.state === 'follow' && dq.spot === null && !dq.story);
  check('и снова следует рядом', Math.hypot(dq.pos.x - pl.x, dq.pos.z - pl.z) < 5);
}

// =====================  биомы, погода, полив, сюжет, сканер  =====================
{
  const wb = mk();
  const cnt = [0, 0, 0], hsum = [0, 0, 0], hmax = [0, 0, 0];
  for (let x = 0; x < R.SIZE_X; x++) for (let z = 0; z < R.SIZE_Z; z++) {
    const b = wb.biomeAt(x, z); cnt[b]++;
    const gy = wb.groundY(x, z); hsum[b] += gy; hmax[b] = Math.max(hmax[b], gy);
  }
  check('три биома, каждый занимает заметную часть мира', cnt.every((c) => c > 2500), cnt.join());
  check('рельеф различается: низина ниже пустоши, дюны выше', hsum[2] / cnt[2] < hsum[0] / cnt[0] && hsum[1] / cnt[1] > hsum[0] / cnt[0], [0, 1, 2].map((b) => (hsum[b] / cnt[b]).toFixed(2)).join());
  const topIds = [R.SOIL, R.SAND, R.MUD];
  let soilOk = true;
  for (let b = 0; b < 3 && soilOk; b++) { let found = false; for (let x = 0; x < R.SIZE_X && !found; x++) for (let z = 0; z < R.SIZE_Z && !found; z++) if (wb.biomeAt(x, z) === b) { const v = wb.getVoxel(x, wb.groundY(x, z), z); if (v === topIds[b]) found = true; } soilOk = found; }
  check('почва своя у каждого биома (серая, медная, бирюзовая)', soilOk);
  check('старт в пустоши на ровной площадке', wb.biomeAt(wb.spawn.x, wb.spawn.z) === 0 && R.isSoil(wb.getVoxel(wb.spawn.x, wb.spawn.y - 1, wb.spawn.z)) && wb.getVoxel(wb.spawn.x, wb.spawn.y, wb.spawn.z) === 0);
  check('по знаку в каждом биоме', wb.glyphs.length === 3 && new Set(wb.glyphs.map((g) => g.biome)).size === 3);
  let dryB = 0, totB = 0, minC = 9;
  for (let x = 0; x < R.SIZE_X; x++) for (let z = 0; z < R.SIZE_Z; z++) { const b = wb.biomeAt(x, z), W = wb.waterAt(x, z); if (b === 1) { totB++; if (W < 0.2) dryB++; } if (b === 2) minC = Math.min(minC, W); }
  check('дюны сухие (большинство клеток ниже P_W_MIN), низина влажная всюду', dryB / totB > 0.5 && minC >= 0.2, `${(dryB / totB).toFixed(2)} ${minC}`);
  const wl = mk(); wl.timeOfDay = 0.25;
  let bcell = null;
  for (let x = 0; x < R.SIZE_X && !bcell; x++) for (let z = 0; z < R.SIZE_Z && !bcell; z++) { if (wl.biomeAt(x, z) !== 1) continue; const gy = wl.groundY(x, z); const o = { x, y: gy + 1, z }; if (gy >= 0 && Plant.canPlant(wl, o)) bcell = o; }
  const pb = new Plant(wl, bcell, { force: true }); run(wl, pb);
  check('листва зависит от биома (в дюнах медно-золотая)', count(wl, R.LEAF_B) > 20 && count(wl, R.LEAF_C) === 0, count(wl, R.LEAF_B));
  check('на высоких гребнях посадка запрещена (потолок мира)', !Plant.canPlant(wl, { x: bcell.x, y: 6, z: bcell.z }));
}

// --- погода (MECH-08, прототип) ---
{
  const ww = mk(); ww.timeOfDay = 0.25;
  const cell = findCell(ww, (W) => W < 0.1);
  const base = ww.evaluate(cell.x, cell.y, cell.z, null);
  const seq = []; let last = ww.weather.state; let maxRain = 0, rainStart = -1, rainEnd = -1;
  for (let i = 0; i < 60 * 400; i++) {
    ww.updateWeather(1 / 60);
    if (ww.weather.state !== last) { last = ww.weather.state; seq.push(last + '@' + Math.round(ww.clock)); if (last === 'rain') rainStart = ww.clock; if (last === 'clearing') rainEnd = ww.clock; }
    if (ww.weather.rain > maxRain) maxRain = ww.weather.rain;
    if (ww.weather.state === 'rain' && ww.weather.rain >= 1 && ww._rainEv === undefined) { ww._rainEv = ww.evaluate(cell.x, cell.y, cell.z, null); }
  }
  check('цикл погоды: ясно → тучи → дождь → прояснение → ясно', /warn.*rain.*clearing.*clear/.test(seq.join(' ')), seq.join(' '));
  check('первый шторм не раньше STORM_FIRST и тучи предупреждают за STORM_WARN', seq[0].startsWith('warn@') && Math.abs(parseInt(seq[0].split('@')[1]) - P.STORM_FIRST) <= 1 && Math.abs(rainStart - (P.STORM_FIRST + P.STORM_WARN)) <= 1, seq.join(' '));
  check('дождь достигает полной силы', maxRain === 1);
  const re = ww._rainEv;
  check('в дождь вода выше на P_STORM_W, свет ниже (тучи + P_STORM_L)', Math.abs(re.W - base.W - P.STORM_W) < 1e-6 && re.L < base.L, `${base.W}->${re.W}, ${base.L}->${re.L}`);
  const ww2 = mk(); const seq2 = []; let l2 = ww2.weather.state;
  for (let i = 0; i < 60 * 400; i++) { ww2.updateWeather(1 / 60); if (ww2.weather.state !== l2) { l2 = ww2.weather.state; seq2.push(l2 + '@' + Math.round(ww2.clock)); } }
  check('погода детерминирована от seed мира', seq.join() === seq2.join());
  check('следующий шторм не раньше STORM_GAP после предыдущего', (() => { const warn = seq.filter((s) => s.startsWith('warn')).map((s) => parseInt(s.split('@')[1])); return warn.length < 2 || warn[1] - rainEnd >= P.STORM_GAP - 1; })(), seq.join(' '));
  const w7 = mk(); w7.timeOfDay = 0.25;
  const dry = findCell(w7, (W) => W < 0.1);
  const pdry = new Plant(w7, dry);
  check('до дождя сухой росток ждёт', pdry.state === 'dormant');
  w7.forceStorm();
  let woke = -1;
  for (let i = 0; i < 60 * 80 && woke < 0; i++) { w7.updateWeather(1 / 60); pdry.update(1 / 60); if (pdry.state === 'growing') woke = w7.clock; }
  check('во время дождя росток просыпается и растёт (вода +P_STORM_W)', woke > 0, woke);
  const w8 = mk(); w8.forceStorm(); w8.updateWeather(1 / 60);
  check('forceStorm запускает тучи сразу', w8.weather.state === 'warn');
}

// --- лейка (полив) ---
{
  const wi = mk(); wi.timeOfDay = 0.25;
  const dry = findCell(wi, (W) => W < 0.1);
  const e0 = wi.evaluate(dry.x, dry.y, dry.z, null);
  const pp = new Plant(wi, dry);
  check('до полива сухой росток ждёт', pp.state === 'dormant' && !e0.ok);
  wi.pour(dry.x, dry.z);
  const e1 = wi.evaluate(dry.x, dry.y, dry.z, null);
  check('полив даёт +P_POUR_BOOST к воде', Math.abs(e1.W - e0.W - P.POUR_BOOST) < 1e-6, `${e0.W} -> ${e1.W}`);
  check('полив не действует за пределами радиуса', wi.irrigationAt(dry.x + P.POUR_R + 2, dry.z) === 0);
  wi.pour(dry.x, dry.z); wi.pour(dry.x, dry.z);
  check('несколько поливов в одном месте ограничены P_POUR_CAP', wi.irrigationAt(dry.x, dry.z) <= P.POUR_CAP + 1e-9);
  for (let i = 0; i < Math.ceil(P.REEVAL * 60) + 5; i++) pp.update(1 / 60);
  check('политый росток просыпается на перепроверке', pp.state === 'growing' || pp.state === 'mature', pp.state);
  for (let i = 0; i < 60 * (P.POUR_TIME + 5); i++) wi.updateWeather(1 / 60);
  check('влага от полива высыхает через P_POUR_TIME', wi.irrigationAt(dry.x, dry.z) === 0 && wi.irrigation.length === 0);
}

// --- сюжет: знаки и главы (по порядку: один замок за раз) ---
{
  const wg = mk(); wg.timeOfDay = 0.25;
  const fake = (g, n, forms) => { for (let i = 0; i < n; i++) wg.plants.push({ state: 'mature', variant: forms[i % forms.length], o: { x: g.x + (i % 3), z: g.z + 4 } }); };
  const [g0, g1, g2] = wg.glyphs;
  check('знаки спят: воксел знака — GLYPH, глава 0', wg.getVoxel(g0.cells[0][0], g0.y, g0.cells[0][1]) === R.GLYPH && wg.chapter === 0);
  check('следующий знак по порядку', wg.nextGlyph() === g0);
  fake(g1, 4, ['tall', 'sapling']);
  check('второй знак не просыпается раньше первого', wg.updateGlyphs().length === 0 && wg.chapter === 0 && !g1.active);
  wg.plants.length = 0;
  fake(g0, 2, ['tall']);
  check('2 дерева у знака 1 — рано', wg.updateGlyphs().length === 0 && wg.chapter === 0);
  fake(g0, 1, ['tall']);
  const w1 = wg.updateGlyphs();
  check('3 дерева рядом пробуждают знак: глава 1', w1.length === 1 && w1[0] === g0 && wg.chapter === 1 && g0.order === 1);
  check('после первого знака дрон показывает второй', wg.nextGlyph() === g1);
  check('пробуждённый знак меняет вокселы на GLYPH_ON', g0.cells.every((c) => wg.getVoxel(c[0], g0.y, c[1]) === R.GLYPH_ON));
  fake(g1, 3, ['tall']);
  check('знак 2 требует две разные формы (одной мало)', wg.updateGlyphs().length === 0 && wg.chapter === 1);
  fake(g1, 1, ['sapling']);
  check('с двумя формами знак 2 пробуждается: глава 2', wg.updateGlyphs().length === 1 && wg.chapter === 2 && !wg.answered);
  fake(g2, 4, ['tall', 'sapling']);
  check('третий знак: глава 3, мир отвечает', wg.updateGlyphs().length === 1 && wg.chapter === 3 && wg.answered);
  check('больше нет спящих знаков', wg.nextGlyph() === null);
}
{
  const wbn = mk(); const g = wbn.glyphs[0];
  for (let i = 0; i < 5; i++) wbn.plants.push({ state: 'mature', variant: 'tall', bench: true, o: { x: g.x + (i % 3), z: g.z + 4 } });
  check('бенч-деревья рядом со знаком его не будят', wbn.updateGlyphs().length === 0 && wbn.chapter === 0);
}

// --- сканер дрона ---
{
  const wsn = mk(); wsn.timeOfDay = 0.25;
  const sp = wsn.spawn;
  const grid = wsn.scanGrid(sp.x, sp.z, 14, 2);
  const kinds = new Set(grid.map((g) => g.rate));
  check('сканер: сетка в пределах бюджета частиц (<= 200 точек)', grid.length > 40 && grid.length <= 200, grid.length);
  check('сканер различает хорошее, на грани и негодное', kinds.has('good') && kinds.has('marginal') && kinds.has('bad'), [...kinds].join());
  check('сканер не отмечает воду и камни', grid.every((g) => R.isSoil(wsn.getVoxel(g.x, g.y - 1, g.z))));
  wsn.timeOfDay = 0.75;
  check('ночью сканер не обещает рост без света', wsn.scanGrid(sp.x, sp.z, 14, 2).every((g) => g.rate !== 'good'));
}

// --- ходьба: гравитация, коллизии, прыжок, ступеньки ---
const { Walker, PHYS } = require('./physics.js');
{
  const wp = mk(); const sp = wp.spawn;
  const wk = new Walker(wp, { x: sp.x + 0.5, y: sp.y + 6, z: sp.z + 0.5 });
  for (let i = 0; i < 120; i++) wk.update(1 / 60, { yaw: 0 });
  check('падает и приземляется на землю старта', wk.onGround && Math.abs(wk.y - sp.y) < 1e-6, `${wk.y} vs ${sp.y}`);
  const z0 = wk.z; for (let i = 0; i < 60; i++) wk.update(1 / 60, { f: 1, yaw: 0 });
  check('идёт вперёд со скоростью ~P_SPEED (север = -Z)', Math.abs((z0 - wk.z) - PHYS.SPEED) < 0.6, z0 - wk.z);
  const z1 = wk.z; for (let i = 0; i < 60; i++) wk.update(1 / 60, { f: 1, sprint: true, yaw: 0 });
  check('бег быстрее ходьбы', (z1 - wk.z) > PHYS.SPEED * 1.4, z1 - wk.z);
  const big = new Walker(wp, { x: sp.x + 0.5, y: sp.y + 10, z: sp.z + 0.5 }); big.update(0.25, { yaw: 0 }); big.update(0.25, { yaw: 0 }); big.update(0.25, { yaw: 0 });
  check('большой dt не проваливает сквозь землю', big.y >= sp.y - 1e-6, big.y);
}
{
  const ws2 = mk(); const sp = ws2.spawn; const x = sp.x, z = sp.z, gy = sp.y;
  const wkr = () => new Walker(ws2, { x: x + 0.5, y: gy, z: z + 0.5 });
  ws2.setVoxel(x, gy, z - 2, R.SOIL);
  let a = wkr(); a.onGround = true; let maxY = a.y;
  for (let i = 0; i < 120; i++) { a.update(1 / 60, { f: 1, yaw: 0 }); maxY = Math.max(maxY, a.y); }
  check('взбирается на ступень в 1 блок без прыжка и идёт дальше', maxY >= gy + 1 - 1e-6 && a.z < z - 2, `maxY=${maxY} z=${a.z}`);
  ws2.setVoxel(x, gy, z - 2, 0);
  for (let dx = -2; dx <= 2; dx++) { ws2.setVoxel(x + dx, gy, z - 3, R.ROCK); ws2.setVoxel(x + dx, gy + 1, z - 3, R.ROCK); }
  let b = wkr(); b.onGround = true;
  for (let i = 0; i < 180; i++) b.update(1 / 60, { f: 1, jump: true, yaw: 0 });
  check('стена в 2 блока: ни шаг, ни прыжок не помогают', b.z > z - 3 + 0.3 && b.y < gy + 1.5, `z=${b.z} y=${b.y}`);
  for (let dx = -2; dx <= 2; dx++) ws2.setVoxel(x + dx, gy + 1, z - 3, 0);
  let c = wkr(); c.onGround = true;
  for (let i = 0; i < 180; i++) c.update(1 / 60, { f: 1, yaw: 0 });
  check('стена в 1 блок преодолевается', c.z < z - 3, `z=${c.z}`);
  ws2.setVoxel(x + 6, gy, z, R.SPROUT);
  let d = new Walker(ws2, { x: x + 4.5, y: gy, z: z + 0.5 }); d.onGround = true;
  for (let i = 0; i < 60; i++) d.update(1 / 60, { s: 1, yaw: 0 });
  check('росток не блокирует путь', d.x > x + 6.5, d.x);
  let e = new Walker(ws2, { x: 1, y: gy, z: 1 }); e.onGround = true;
  for (let i = 0; i < 300; i++) e.update(1 / 60, { f: 1, s: -1, yaw: 0 });
  check('не выходит за границу мира', e.x >= PHYS.RADIUS - 1e-9 && e.z >= PHYS.RADIUS - 1e-9, `${e.x} ${e.z}`);
}
{
  const wt = mk(); wt.timeOfDay = 0.25; const c = findCell(wt, (W) => W > 0.8);
  const pt = new Plant(wt, c); run(wt, pt);
  const wk = new Walker(wt, { x: c.x + 0.5, y: c.y, z: c.z + 4.5 }); wk.onGround = true;
  let inside = 0;
  for (let i = 0; i < 300; i++) { wk.update(1 / 60, { f: 1, yaw: 0, jump: i % 90 === 0 }); if (wk.collides(wk.x, wk.y, wk.z)) inside++; }
  check('идёт к стволу и упирается, не входя внутрь', inside === 0 && Math.hypot(wk.x - (c.x + 0.5), wk.z - (c.z + 0.5)) >= 0.6, `inside=${inside}`);
  const wr = mk(); const spn = wr.spawn; const k = new Walker(wr, { x: spn.x + 0.5, y: spn.y, z: spn.z + 0.5 });
  let bad = 0, seed = 7;
  for (let i = 0; i < 4000; i++) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; k.update(1 / 60, { f: (seed & 3) - 1, s: ((seed >> 2) & 3) - 1, yaw: (seed >> 4) % 628 / 100, jump: (seed >> 9) % 40 === 0, sprint: true }); if (k.collides(k.x, k.y, k.z)) bad++; }
  check('4000 шагов случайной ходьбы: ни разу не внутри вокселей', bad === 0, bad);
}

// --- звук: подставной AudioContext, допустимы только настоящие методы Web Audio ---
{
  const calls = {}; const bad = [];
  const OK = ['connect', 'start', 'stop', 'setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'getChannelData'];
  const mkParam = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const mkNode = () => new Proxy({ frequency: mkParam(), gain: mkParam(), pan: mkParam(), Q: mkParam(), buffer: null, loop: false, type: '', onended: null }, {
    get(t, p) { if (p in t) return t[p]; if (OK.includes(p)) return (...a) => { calls[p] = (calls[p] || 0) + 1; return p === 'getChannelData' ? new Float32Array(8) : undefined; }; if (typeof p === 'string') bad.push(p); return undefined; },
    set(t, p, v) { t[p] = v; return true; },
  });
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
  s.setRain(1); s.thunder(1); s.pour(); s.fill(); s.scan(); s.echo(1); s.echo(2); s.echo(3); s.answer();
  s.setMuted(true); s.grow(1, 'tall', { x: 50, z: 40 }); s.thunder(0); s.pour();
  check('звук: все вызовы Web Audio существуют, ошибок нет', bad.length === 0, bad.join());
  check('звук: осцилляторы стартуют и останавливаются', calls.start > 5 && calls.stop > 5);
  delete globalThis.AudioContext;
  const s2 = new Sfx(); s2.start(); s2.grow(1, 'tall', null);
  check('звук: без Web Audio молча не работает', s2.ctx === null);
}

console.log(fails ? `SELFTEST FAILED (${fails})` : 'SELFTEST OK');
process.exit(fails ? 1 : 0);
