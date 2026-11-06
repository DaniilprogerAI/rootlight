// Rootlight · Three.js — логика мира (без Three.js, тестируется в Node).
// Этап 1 GDD: вода и свет (MECH-04), рост по условиям (MECH-01), соседство (MECH-03),
// Dormant, озеленение почвы, вершинный AO. Все числа — параметры P (как P_... в GDD).
(function (root) {
  'use strict';
  const CHUNK = 16, CX = 7, CZ = 7, HEIGHT = 16;
  const SIZE_X = CHUNK * CX, SIZE_Z = CHUNK * CZ;
  const SOIL = 1, WOOD = 2, LEAF = 3, WATER = 4, MOSS = 5, SPROUT = 6, SAND = 7, MUD = 8, ROCK = 9, CRYSTAL = 10,
    GLYPH = 11, LEAF_B = 12, LEAF_C = 13, GLYPH_ON = 14;
  const COLORS = {
    1: [0.42, 0.42, 0.40], 2: [0.45, 0.30, 0.18], 3: [0.25, 0.85, 0.45],
    4: [0.22, 0.50, 0.85], 5: [0.28, 0.50, 0.26], 6: [0.45, 0.55, 0.35],
    7: [0.62, 0.40, 0.26], 8: [0.20, 0.34, 0.36], 9: [0.30, 0.30, 0.33], 10: [0.45, 0.90, 0.95],
    11: [0.55, 0.45, 0.25], 12: [0.95, 0.65, 0.20], 13: [0.40, 0.85, 0.95], 14: [0.50, 1.00, 0.80],
  };
  const GLOW = { 3: 1.0, 4: 0.35, 5: 0.25, 6: 0.5, 10: 1.0, 11: 0.45, 12: 0.9, 13: 1.0, 14: 1.0 };   // доля свечения на вершину
  const P = {
    W_MIN: 0.2, L_MIN: 0.3,              // P_W_MIN, P_L_MIN
    WATER_R: 22,                         // дальность влажности от родника, блоки
    GLOW_R: 5, GLOW_ADD: 0.25, GLOW_CAP: 0.4,   // P_GLOW_R: растения светят ночью
    NEIGHBOR_R: 4, SYM: 0.1, SYM_CAP: 0.3, COMP: 0.15, COMP_CAP: 0.45,   // MECH-03
    REEVAL: 5,                           // P_REEVAL_TIME, с
    PURGE_R: 6, WAVE_TIME: 2.5,          // озеленение вокруг Mature
    MAX_VOX: 40, STAGE_TIME: 1.5, STAGES: 5,
    DAY_LEN: 720,                        // P_DAY_LEN = 12 мин
    // погода (MECH-08, поднята с этапа 3; интервал между штормами в прототипе короче GDD: 900 с)
    STORM_FIRST: 100, STORM_WARN: 20, STORM_DUR: 60, STORM_GAP: 170,
    STORM_W: 0.3, STORM_L: 0.2, CLOUD_SUN: 0.35,
    // инструменты ухода (лейка)
    POUR_R: 3, POUR_BOOST: 0.35, POUR_TIME: 90, POUR_CAP: 0.4, CAN_MAX: 4,
    GLYPH_R: 9,                          // радиус «посева» вокруг знака сюжета
  };
  const BIOMES = [
    { name: 'Серая пустошь',   hum: 0,     soil: 1, leaf: 3 },
    { name: 'Медные дюны',     hum: -0.10, soil: 7, leaf: 12 },
    { name: 'Туманная низина', hum: 0.25,  soil: 8, leaf: 13 },
  ];
  const ANCHORS = [[56, 84], [24, 26], [90, 30]];
  const SPRING_SITES = [[44, 76], [72, 70], [28, 36], [84, 26], [100, 42], [86, 50]];
  const GLYPH_SITES = [
    { x: 56, z: 72, need: { count: 3, forms: 1 }, pattern: ['.XXX.', 'X...X', 'X.X.X', 'X...X', '.XXX.'] },   // круг
    { x: 24, z: 22, need: { count: 3, forms: 2 }, pattern: ['..X..', '.X.X.', 'X.X.X', '.X.X.', '..X..'] },   // ромб
    { x: 94, z: 22, need: { count: 4, forms: 2 }, pattern: ['..X..', '..X..', 'XXXXX', '..X..', '..X..'] },   // крест
  ];
  const VARIANTS = {
    sapling:   { th: 4, thv: 2, rx: 2, ry: 2, name: 'саженец' },
    spreading: { th: 5, thv: 2, rx: 3, ry: 2, name: 'раскидистое' },
    tall:      { th: 7, thv: 2, rx: 2, ry: 2, name: 'высокое' },
  };
  const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const CORNERS = [
    [[1,0,0],[1,0,1],[1,1,1],[1,1,0]],
    [[0,0,0],[0,1,0],[0,1,1],[0,0,1]],
    [[0,1,0],[1,1,0],[1,1,1],[0,1,1]],
    [[0,0,0],[0,0,1],[1,0,1],[1,0,0]],
    [[0,0,1],[0,1,1],[1,1,1],[1,0,1]],
    [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
  ];
  const TANG = [[1, 2], [0, 2], [0, 1]];          // касательные оси для граней по оси 0/1/2
  const SHADE = [0.9, 0.9, 1.0, 0.6, 0.85, 0.85];
  const AO_BRIGHT = [0.5, 0.7, 0.85, 1.0];

  const isSoil = (id) => id === SOIL || id === MOSS || id === SAND || id === MUD;
  const isBaseSoil = (id) => id === SOIL || id === SAND || id === MUD;
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  function hash3(x, y, z, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) & 0x7fffffff;
  }
  function voxelColor(id, x, y, z) {
    const b = COLORS[id];
    const j = 0.88 + 0.24 * ((hash3(x, y, z, 7) % 1000) / 1000);
    return [Math.min(1, b[0] * j), Math.min(1, b[1] * j), Math.min(1, b[2] * j)];
  }
  function valueNoise(seed, x, z, freq) {
    const f = freq || 0.05;
    const fx = x * f, fz = z * f;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const r = (a, b) => (hash3(a, 0, b, seed) % 10000) / 10000;
    const a = r(ix, iz), b = r(ix + 1, iz), c = r(ix, iz + 1), d = r(ix + 1, iz + 1);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sz;
  }

  class VoxelWorld {
    constructor(seed) {
      this.seed = seed === undefined ? 1337 : seed;
      this.chunks = [];
      for (let i = 0; i < CX * CZ; i++) this.chunks.push(new Uint8Array(CHUNK * CHUNK * CHUNK));
      this.dirty = new Set();
      this.springs = [];
      this.plants = [];          // все растения (любое состояние)
      this.waves = [];           // активные волны озеленения
      this.timeOfDay = 0.12;     // 0 рассвет · 0.25 день · 0.5 закат · 0.75 ночь (старт: раннее утро, ~3.5 мин хорошего света)
      this.clock = 0;            // секунды игры (для погоды и полива)
      this.weather = { state: 'clear', cloud: 0, rain: 0, t: 0, next: P.STORM_FIRST, dur: 0, n: 0 };
      this.irrigation = [];      // зоны полива лейкой
      this.glyphs = [];          // знаки сюжета
      this.chapter = 0;          // сколько знаков пробуждено
      this.answered = false;     // мир ответил (все знаки)
      this.spawn = { x: 56, y: 3, z: 84 };
      this.biomeMap = null;
    }

    rawSet(x, y, z, id) {
      this.chunks[(x >> 4) + CX * (z >> 4)][(x & 15) + CHUNK * (y + CHUNK * (z & 15))] = id;
    }

    biomeAt(x, z) {
      if (!this.biomeMap) return 0;
      x = Math.max(0, Math.min(SIZE_X - 1, Math.floor(x))); z = Math.max(0, Math.min(SIZE_Z - 1, Math.floor(z)));
      return this.biomeMap[x + SIZE_X * z];
    }

    generate() {
      const N = SIZE_X * SIZE_Z, seed = this.seed;
      this.biomeMap = new Uint8Array(N);
      for (let x = 0; x < SIZE_X; x++) for (let z = 0; z < SIZE_Z; z++) {
        const wx = x + (valueNoise(seed + 11, x, z, 0.04) - 0.5) * 20, wz = z + (valueNoise(seed + 12, x, z, 0.04) - 0.5) * 20;
        let best = 0, bd = Infinity;
        ANCHORS.forEach((a, i) => { const d = Math.hypot(wx - a[0], wz - a[1]); if (d < bd) { bd = d; best = i; } });
        this.biomeMap[x + SIZE_X * z] = best;
      }
      // высоты: свой рельеф у каждого биома, затем сглаживание (границы становятся пологими)
      let raw = new Float32Array(N);
      for (let x = 0; x < SIZE_X; x++) for (let z = 0; z < SIZE_Z; z++) {
        const i = x + SIZE_X * z, b = this.biomeMap[i];
        raw[i] = b === 0 ? 2 + valueNoise(seed, x, z, 0.05) * 3
               : b === 1 ? 3 + valueNoise(seed + 5, x, z, 0.09) * 5
               : 1 + valueNoise(seed + 7, x, z, 0.06) * 2;
      }
      for (let pass = 0; pass < 2; pass++) {
        const r2 = new Float32Array(N);
        for (let x = 0; x < SIZE_X; x++) for (let z = 0; z < SIZE_Z; z++) {
          let s = 0, c = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= SIZE_X || zz >= SIZE_Z) continue;
            s += raw[xx + SIZE_X * zz]; c++;
          }
          r2[x + SIZE_X * z] = s / c;
        }
        raw = r2;
      }
      const H = new Uint8Array(N);
      for (let i = 0; i < N; i++) H[i] = Math.max(1, Math.min(7, Math.round(raw[i])));
      const reserved = new Set();
      const flatten = (cx, cz, r, rid) => {
        const h = H[cx + SIZE_X * cz];
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= SIZE_X || z >= SIZE_Z) continue;
          H[x + SIZE_X * z] = h; if (rid) reserved.add(x + SIZE_X * z);
        }
        return h;
      };
      // старт и знаки сюжета: ровные площадки
      const sp = this.spawn; flatten(sp.x, sp.z, 3, true);
      this.glyphs = GLYPH_SITES.map((g, k) => {
        const h = flatten(g.x, g.z, 3, true);
        const cells = [];
        g.pattern.forEach((row, rz) => { for (let rx = 0; rx < 5; rx++) if (row[rx] === 'X') cells.push([g.x - 2 + rx, g.z - 2 + rz]); });
        return { id: k, x: g.x, z: g.z, y: h - 1, need: g.need, cells, active: false, order: 0, biome: this.biomeMap[g.x + SIZE_X * g.z] };
      });
      // родники: бассейн ровной воды (в низине побольше)
      const pool = new Set();
      this.springs = SPRING_SITES.map((s, i) => {
        const sx = s[0] + (hash3(i, 1, 0, seed) % 7) - 3, sz = s[1] + (hash3(i, 2, 0, seed) % 7) - 3;
        const b = this.biomeMap[sx + SIZE_X * sz], rr = b === 2 ? 5 : 2;
        const hc = H[sx + SIZE_X * sz];
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dz * dz > rr) continue;
          const k = (sx + dx) + SIZE_X * (sz + dz);
          H[k] = hc; pool.add(k); reserved.add(k);
        }
        return { x: sx, z: sz, y: hc - 1, biome: b };
      });
      // заливка: верхний слой — почва биома
      for (let x = 0; x < SIZE_X; x++) for (let z = 0; z < SIZE_Z; z++) {
        const i = x + SIZE_X * z, h = H[i], soil = BIOMES[this.biomeMap[i]].soil;
        for (let y = 0; y < h; y++) this.rawSet(x, y, z, (y === h - 1 && pool.has(i)) ? WATER : soil);
      }
      // камни (дюны, пустошь) и кристаллы (низина): декор, не растительность
      for (let x = 0; x < SIZE_X; x++) for (let z = 0; z < SIZE_Z; z++) {
        const i = x + SIZE_X * z;
        if (reserved.has(i)) continue;
        const b = this.biomeMap[i], h = H[i], r = hash3(x, 0, z, seed + 31);
        let id = 0, k = 0;
        if (b === 1 && r % 100 < 3) { id = ROCK; k = 1 + (r >> 8) % 3; }
        else if (b === 0 && r % 1000 < 8) { id = ROCK; k = 1; }
        else if (b === 2 && r % 100 < 2) { id = CRYSTAL; k = 2 + (r >> 8) % 2; }
        for (let y = h; y < h + k && y < HEIGHT; y++) this.rawSet(x, y, z, id);
      }
      for (const g of this.glyphs) for (const c of g.cells) this.rawSet(c[0], g.y, c[1], GLYPH);
      sp.y = H[sp.x + SIZE_X * sp.z];       // высота ног на старте
    }

    getVoxel(x, y, z) {
      if (y < 0) return SOIL;
      if (y >= HEIGHT) return 0;
      const cx = x >> 4, cz = z >> 4;
      if (cx < 0 || cx >= CX || cz < 0 || cz >= CZ) return 0;
      return this.chunks[cx + CX * cz][(x & 15) + CHUNK * ((y & 15) + CHUNK * (z & 15))];
    }
    setVoxel(x, y, z, id) {
      const cx = x >> 4, cz = z >> 4;
      if (cx < 0 || cx >= CX || cz < 0 || cz >= CZ || y < 0 || y >= HEIGHT) return;
      const lx = x & 15, lz = z & 15;
      this.chunks[cx + CX * cz][lx + CHUNK * (y + CHUNK * lz)] = id;
      this.dirty.add(cx + CX * cz);
      if (lx === 0 && cx > 0) this.dirty.add(cx - 1 + CX * cz);
      if (lx === 15 && cx < CX - 1) this.dirty.add(cx + 1 + CX * cz);
      if (lz === 0 && cz > 0) this.dirty.add(cx + CX * (cz - 1));
      if (lz === 15 && cz < CZ - 1) this.dirty.add(cx + CX * (cz + 1));
    }
    surfaceY(x, z) {            // первый свободный воксель над самым верхним твёрдым
      for (let y = HEIGHT - 1; y >= 0; y--) if (this.getVoxel(x, y, z) !== 0) return y + 1;
      return 0;
    }
    groundY(x, z) {             // верх земли (почва/мох/вода), игнорируя кроны; -1 если нет
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const v = this.getVoxel(x, y, z);
        if (isSoil(v) || v === WATER) return y;
      }
      return -1;
    }

    // ---- MECH-04: вода и свет ----
    waterAt(x, z) {                 // постоянная влажность: родники + климат биома
      let s = 0;
      for (const sp of this.springs) s = Math.max(s, 1 - Math.hypot(x - sp.x, z - sp.z) / P.WATER_R);
      return Math.max(0, Math.min(1, s + BIOMES[this.biomeAt(x, z)].hum));
    }
    irrigationAt(x, z) {            // полив лейкой: временная добавка к W
      let b = 0;
      for (const zn of this.irrigation) if (this.clock < zn.until && Math.hypot(x - zn.x, z - zn.z) <= zn.r) b += zn.boost;
      return Math.min(P.POUR_CAP, b);
    }
    pour(x, z) {
      const zn = { x, z, r: P.POUR_R, boost: P.POUR_BOOST, until: this.clock + P.POUR_TIME };
      this.irrigation.push(zn);
      return zn;
    }
    sunVector(t) {
      const a = 2 * Math.PI * t;
      let x = Math.cos(a) * 0.9, y = Math.sin(a), z = 0.35;
      const l = Math.hypot(x, y, z);
      return { x: x / l, y: y / l, z: z / l, el: y / l };
    }
    lightAt(x, y, z) {
      const sv = this.sunVector(this.timeOfDay);
      let sun = Math.max(0, Math.min(1, sv.y * 1.2)) * (1 - P.CLOUD_SUN * this.weather.cloud);
      if (sun > 0) {
        for (let s = 1; s <= 12; s++) {
          const px = Math.floor(x + 0.5 + sv.x * s), py = Math.floor(y + 0.5 + sv.y * s), pz = Math.floor(z + 0.5 + sv.z * s);
          if (this.getVoxel(px, py, pz) !== 0) { sun *= 0.3; break; }
        }
      }
      let glow = 0;
      for (const p of this.plants) {
        if (p.state !== 'mature') continue;
        if (Math.hypot(p.o.x - x, p.o.z - z) <= P.GLOW_R) glow += P.GLOW_ADD;
      }
      return Math.min(1, sun + Math.min(P.GLOW_CAP, glow));
    }
    // Соседство и итоговая оценка условий (MECH-01 п.1, MECH-03)
    evaluate(x, y, z, self) {
      const W = Math.min(1, this.waterAt(x, z) + this.irrigationAt(x, z) + P.STORM_W * this.weather.rain);
      let N = 0, tallN = 0;
      for (const p of this.plants) {
        if (p === self || (p.state !== 'mature' && p.state !== 'growing')) continue;
        if (Math.hypot(p.o.x - x, p.o.z - z) > P.NEIGHBOR_R) continue;
        N++;
        if (p.variant === 'tall') tallN++;
      }
      const L = this.lightAt(x, y, z);
      const Weff = Math.min(1, W + Math.min(P.SYM_CAP, P.SYM * N));
      const Leff = Math.max(0, L - Math.min(P.COMP_CAP, P.COMP * tallN) - P.STORM_L * this.weather.rain);
      const ok = Weff >= P.W_MIN && Leff >= P.L_MIN;
      const variant = !ok ? null : (Weff < 0.5 ? 'sapling' : (Leff < 0.6 ? 'spreading' : 'tall'));
      return { W, L, N, tallN, Weff, Leff, ok, variant };
    }

    // Погода (MECH-08): ясно → тучи (предупреждение) → дождь → прояснение. Детерминирована от seed.
    updateWeather(dt) {
      this.clock += dt;
      const wt = this.weather; wt.t += dt;
      if (wt.state === 'clear') {
        if (this.clock >= wt.next) { wt.state = 'warn'; wt.t = 0; }
      } else if (wt.state === 'warn') {
        wt.cloud = Math.min(1, wt.t / P.STORM_WARN);
        if (wt.t >= P.STORM_WARN) { wt.state = 'rain'; wt.t = 0; wt.dur = P.STORM_DUR + (hash3(wt.n, 1, 0, this.seed) % 30); }
      } else if (wt.state === 'rain') {
        wt.cloud = 1; wt.rain = Math.min(1, wt.t / 8);
        if (wt.t >= wt.dur) { wt.state = 'clearing'; wt.t = 0; }
      } else {
        wt.rain = Math.max(0, 1 - wt.t / 15); wt.cloud = Math.max(0, 1 - wt.t / 25);
        if (wt.t >= 25) { wt.state = 'clear'; wt.rain = 0; wt.cloud = 0; wt.n++; wt.next = this.clock + P.STORM_GAP + (hash3(wt.n, 2, 0, this.seed) % 60); }
      }
      if (this.irrigation.length) this.irrigation = this.irrigation.filter((z) => this.clock < z.until);
    }
    forceStorm() { if (this.weather.state === 'clear') this.weather.next = this.clock; }
    weatherName() {
      const s = this.weather.state;
      return s === 'clear' ? 'ясно' : (s === 'warn' ? 'собираются тучи' : (s === 'rain' ? 'дождь' : 'прояснение'));
    }

    // Знаки сюжета: пробуждаются по порядку (один замок за раз), когда рядом выросло достаточно деревьев
    updateGlyphs() {
      const woke = [];
      for (const g of this.glyphs) {
        if (g.active || g.id !== this.chapter) continue;
        const near = this.plants.filter((p) => p.state === 'mature' && !p.bench && Math.hypot(p.o.x - g.x, p.o.z - g.z) <= P.GLYPH_R);
        const forms = new Set(near.map((p) => p.variant));
        if (near.length >= g.need.count && forms.size >= g.need.forms) {
          g.active = true; this.chapter++; g.order = this.chapter;
          for (const c of g.cells) this.setVoxel(c[0], g.y, c[1], GLYPH_ON);
          woke.push(g);
        }
      }
      if (woke.length && this.chapter >= this.glyphs.length) this.answered = true;
      return woke;
    }
    nextGlyph() {                    // следующий по порядку спящий знак (или null, если мир уже ответил)
      return this.glyphs.find((g) => !g.active && g.id === this.chapter) || null;
    }

    // Сканер дрона: оценка клеток вокруг (хорошо / на грани / не вырастет)
    scanGrid(cx, cz, r, step) {
      const out = [];
      for (let x = Math.round(cx - r); x <= cx + r; x += step) for (let z = Math.round(cz - r); z <= cz + r; z += step) {
        if (Math.hypot(x - cx, z - cz) > r || x < 0 || z < 0 || x >= SIZE_X || z >= SIZE_Z) continue;
        const gy = this.groundY(x, z);
        if (gy < 0 || !isSoil(this.getVoxel(x, gy, z))) continue;
        const o = { x, y: gy + 1, z };
        if (!Plant.canPlant(this, o)) continue;
        const e = this.evaluate(x, o.y, z, null);
        out.push({ x, y: o.y, z, rate: !e.ok ? 'bad' : ((e.Weff < 0.35 || e.Leff < 0.45) ? 'marginal' : 'good') });
      }
      return out;
    }

    startWave(x, z) { this.waves.push(new Wave(this, x, z, P.PURGE_R)); }
    updateWaves(dt) {
      for (let i = this.waves.length - 1; i >= 0; i--) if (this.waves[i].update(dt)) this.waves.splice(i, 1);
    }

    raycast(ox, oy, oz, dx, dy, dz, maxDist) {      // Amanatides–Woo
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
      const tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
      const tdz = dz === 0 ? Infinity : Math.abs(1 / dz);
      let tmx = dx === 0 ? Infinity : (x + (sx > 0 ? 1 : 0) - ox) / dx;
      let tmy = dy === 0 ? Infinity : (y + (sy > 0 ? 1 : 0) - oy) / dy;
      let tmz = dz === 0 ? Infinity : (z + (sz > 0 ? 1 : 0) - oz) / dz;
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < 512; i++) {
        if (this.getVoxel(x, y, z) !== 0) return { x, y, z, nx, ny, nz };
        let t;
        if (tmx < tmy && tmx < tmz) { t = tmx; tmx += tdx; x += sx; nx = -sx; ny = 0; nz = 0; }
        else if (tmy < tmz) { t = tmy; tmy += tdy; y += sy; nx = 0; ny = -sy; nz = 0; }
        else { t = tmz; tmz += tdz; z += sz; nx = 0; ny = 0; nz = -sz; }
        if (t > maxDist) break;
      }
      return null;
    }

    processDirty(maxCount, cb) {
      let n = 0;
      for (const k of Array.from(this.dirty)) {
        this.dirty.delete(k);
        cb(k, this.buildChunk(k));
        if (++n >= maxCount) break;
      }
      return n;
    }

    // Face culling + вершинный AO + влажность почвы + атрибут свечения
    buildChunk(index) {
      const cx = index % CX, cz = Math.floor(index / CX);
      const v = this.chunks[index];
      const pos = [], nor = [], col = [], glow = [], idx = [];
      const ox = cx * CHUNK, oz = cz * CHUNK;
      const occ = (x, y, z) => (this.getVoxel(x, y, z) !== 0 ? 1 : 0);
      const ao = [0, 0, 0, 0];
      for (let x = 0; x < CHUNK; x++) for (let y = 0; y < CHUNK; y++) for (let z = 0; z < CHUNK; z++) {
        const id = v[x + CHUNK * (y + CHUNK * z)];
        if (id === 0) continue;
        const wx = ox + x, wy = y, wz = oz + z;
        let moist = 1;
        if (isSoil(id)) moist = 1 - 0.35 * this.waterAt(wx, wz);     // влажная почва темнее (столп 2)
        const g = GLOW[id] || 0;
        for (let f = 0; f < 6; f++) {
          const d = DIRS[f];
          const bx = wx + d[0], by = wy + d[1], bz = wz + d[2];
          if (this.getVoxel(bx, by, bz) !== 0) continue;
          const a = f >> 1, t0 = TANG[a][0], t1 = TANG[a][1];
          const cn = CORNERS[f];
          for (let k = 0; k < 4; k++) {
            const c = cn[k];
            const s1 = c[t0] * 2 - 1, s2 = c[t1] * 2 - 1;
            const e1x = t0 === 0 ? s1 : 0, e1y = t0 === 1 ? s1 : 0, e1z = t0 === 2 ? s1 : 0;
            const e2x = t1 === 0 ? s2 : 0, e2y = t1 === 1 ? s2 : 0, e2z = t1 === 2 ? s2 : 0;
            const a1 = occ(bx + e1x, by + e1y, bz + e1z), a2 = occ(bx + e2x, by + e2y, bz + e2z);
            const ac = occ(bx + e1x + e2x, by + e1y + e2y, bz + e1z + e2z);
            ao[k] = (a1 && a2) ? 0 : 3 - (a1 + a2 + ac);
          }
          const base = pos.length / 3;
          const cs = voxelColor(id, wx, wy, wz), s = SHADE[f] * moist;
          const c0 = [s2l(cs[0]), s2l(cs[1]), s2l(cs[2])];   // палитра в sRGB -> линейное пространство Three.js
          for (let k = 0; k < 4; k++) {
            const q = cn[k], b = AO_BRIGHT[ao[k]] * s;
            pos.push(x + q[0], y + q[1], z + q[2]);
            nor.push(d[0], d[1], d[2]);
            col.push(c0[0] * b, c0[1] * b, c0[2] * b);
            glow.push(g);
          }
          if (ao[0] + ao[2] >= ao[1] + ao[3]) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
          else idx.push(base + 3, base + 2, base + 1, base + 1, base, base + 3);
        }
      }
      return {
        pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(col),
        glow: new Float32Array(glow), idx: new Uint32Array(idx), ox, oz,
      };
    }
  }

  // Волна озеленения: почва вокруг Mature становится живой (мох) от центра к краю
  class Wave {
    constructor(world, x, z, radius) {
      this.world = world; this.t = 0; this.idx = 0; this.cells = [];
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        const d = Math.hypot(dx, dz);
        if (d <= radius) this.cells.push({ x: x + dx, z: z + dz, d });
      }
      this.cells.sort((a, b) => a.d - b.d);
    }
    update(dt) {
      this.t += dt;
      const target = Math.min(this.cells.length, Math.floor(this.cells.length * Math.min(1, this.t / P.WAVE_TIME)));
      let n = 0;
      while (this.idx < target && n < P.MAX_VOX) {
        const c = this.cells[this.idx++];
        const y = this.world.groundY(c.x, c.z);
        if (y >= 0 && isBaseSoil(this.world.getVoxel(c.x, y, c.z))) { this.world.setVoxel(c.x, y, c.z, MOSS); n++; }
      }
      return this.idx >= this.cells.length;
    }
  }

  // Растение: Evaluating → Growing → Mature, либо Dormant (ждёт воды/света)
  class Plant {
    constructor(world, o, opts) {
      this.world = world; this.o = o;
      this.force = !!(opts && opts.force);      // для бенчмарка: игнорировать условия
      this.bench = !!(opts && opts.bench);      // деревья бенчмарка не будят знаки сюжета
      this.state = 'eval'; this.variant = null; this.blueprint = null;
      this.placed = 0; this.budget = 0; this.rate = 0; this.reeval = 0;
      this.top = o.y; this.sprout = false; this.done = false;
      const on = (opts && opts.on) || {};
      this.onStart = on.start || null; this.onStage = on.stage || null;
      this.onDormant = on.dormant || null; this.onMature = on.mature || null;
      this.stage = 0; this.wasDormant = false;
      this.last = null;
      world.plants.push(this);
      this._evaluate();
    }
    get title() { return this.variant ? VARIANTS[this.variant].name : null; }

    static makeBlueprint(seed, o, variant, leaf) {
      const V = VARIANTS[variant];
      const h = hash3(o.x, o.y, o.z, seed);
      const th = V.th + (h % V.thv);
      const bp = [];
      for (let i = 0; i < th; i++) bp.push([0, i, 0, WOOD]);
      for (let dy = -V.ry; dy <= V.ry; dy++) for (let dx = -V.rx; dx <= V.rx; dx++) for (let dz = -V.rx; dz <= V.rx; dz++) {
        if ((dx * dx + dz * dz) / (V.rx * V.rx) + (dy * dy) / (V.ry * V.ry) > 1.25) continue;
        if (dx === 0 && dz === 0 && dy < 0) continue;
        bp.push([dx, th + dy, dz, leaf || LEAF]);
      }
      return { voxels: bp, th, top: o.y + th + V.ry, variant };
    }
    static canPlant(w, o) {
      if (o.x < 4 || o.z < 4 || o.x > SIZE_X - 5 || o.z > SIZE_Z - 5) return false;
      if (o.y > 5 || !isSoil(w.getVoxel(o.x, o.y - 1, o.z))) return false;     // на высоких гребнях не растёт: крона упёрлась бы в потолок мира
      for (let i = 0; i < 10; i++) if (w.getVoxel(o.x, o.y + i, o.z) !== 0) return false;
      return true;
    }

    _evaluate() {
      const w = this.world, o = this.o;
      if (this.force) {
        const names = ['sapling', 'spreading', 'tall'];
        this._start(names[hash3(o.x, o.y, o.z, w.seed + 1) % 3]);
        return;
      }
      const e = w.evaluate(o.x, o.y, o.z, this);
      this.last = e;
      if (e.ok) { this._start(e.variant); return; }
      this.state = 'dormant';
      this.reeval = P.REEVAL;
      if (!this.wasDormant) { this.wasDormant = true; if (this.onDormant) this.onDormant(this); }
      if (!this.sprout) {
        if (w.getVoxel(o.x, o.y, o.z) === 0) w.setVoxel(o.x, o.y, o.z, SPROUT);
        this.sprout = true;
      }
    }
    _start(variant) {
      const bp = Plant.makeBlueprint(this.world.seed, this.o, variant, BIOMES[this.world.biomeAt(this.o.x, this.o.z)].leaf);
      this.variant = variant; this.blueprint = bp.voxels; this.top = bp.top;
      this.rate = bp.voxels.length / (P.STAGES * P.STAGE_TIME);
      this.state = 'growing';
      if (this.onStart) this.onStart(this);
    }
    update(dt) {
      if (this.state === 'dormant') {
        this.reeval -= dt;
        if (this.reeval <= 0) this._evaluate();
        return;
      }
      if (this.state !== 'growing') return;
      this.budget += this.rate * dt;
      let n = Math.min(Math.floor(this.budget), P.MAX_VOX);
      n = Math.min(n, this.blueprint.length - this.placed);
      for (let i = 0; i < n; i++) {
        const e = this.blueprint[this.placed++];
        const x = this.o.x + e[0], y = this.o.y + e[1], z = this.o.z + e[2];
        const cur = this.world.getVoxel(x, y, z);
        if (cur === 0 || cur === SPROUT) this.world.setVoxel(x, y, z, e[3]);
      }
      this.budget -= n;
      const st = Math.min(P.STAGES, Math.floor(this.placed / this.blueprint.length * P.STAGES));
      if (st > this.stage) { this.stage = st; if (this.onStage) this.onStage(this, st); }
      if (this.placed >= this.blueprint.length) {
        this.state = 'mature'; this.done = true;
        this.world.startWave(this.o.x, this.o.z);
        if (this.onMature) this.onMature(this);
      }
    }
  }

  const api = {
    VoxelWorld, Plant, Wave, P, VARIANTS, BIOMES, CHUNK, CX, CZ, HEIGHT, SIZE_X, SIZE_Z,
    SOIL, WOOD, LEAF, WATER, MOSS, SPROUT, SAND, MUD, ROCK, CRYSTAL, GLYPH, LEAF_B, LEAF_C, GLYPH_ON, hash3, voxelColor, isSoil, isBaseSoil,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RL = api;
})(typeof window !== 'undefined' ? window : globalThis);
