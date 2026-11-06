// Rootlight · Three.js: сцена, ходьба, инструменты ухода, погода, три биома, знаки сюжета и эхо-видения.
(function () {
  'use strict';
  const { VoxelWorld, Plant, P, VARIANTS, BIOMES, CX, CZ, SIZE_X, SIZE_Z, PHYS } = RL;
  const REACH_FLY = 16, REACH_WALK = 9, P_REMESH_PER_FRAME = 1;
  const BENCH_DURATION = 25, BENCH_SPAWN_EVERY = 0.4, BENCH_MAX_TREES = 40;
  const LIGHTNING = true;                  // мягкая вспышка молнии (false — выключить)
  const TOOL_NAMES = ['Семя', 'Лейка', 'Сканер'];

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  let gpu = 'неизвестно';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) {}

  // ---------- освещение и палитра суток ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.9, 0.5, 0.3);
  scene.fog = new THREE.FogExp2(0xe68050, 0.012);
  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  const CX0 = SIZE_X / 2, CZ0 = SIZE_Z / 2;
  sun.target.position.set(CX0, 0, CZ0);
  sun.castShadow = false;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 320 });
  scene.add(ambient, sun, sun.target);

  // t: 0 рассвет · 0.25 день · 0.5 закат · 0.75 ночь
  const KEYS = [
    { t: 0.00, sky: [0.95, 0.62, 0.48], amb: [0.50, 0.45, 0.55], ambI: 0.80, sun: [1.0, 0.70, 0.50], sunI: 0.9 },
    { t: 0.25, sky: [0.60, 0.78, 0.93], amb: [0.62, 0.66, 0.72], ambI: 0.90, sun: [1.0, 0.95, 0.85], sunI: 1.3 },
    { t: 0.50, sky: [0.88, 0.45, 0.28], amb: [0.55, 0.45, 0.55], ambI: 0.85, sun: [1.0, 0.55, 0.30], sunI: 1.0 },
    { t: 0.75, sky: [0.04, 0.06, 0.14], amb: [0.20, 0.25, 0.45], ambI: 0.70, sun: [0.45, 0.55, 0.95], sunI: 0.25 },
    { t: 1.00, sky: [0.95, 0.62, 0.48], amb: [0.50, 0.45, 0.55], ambI: 0.80, sun: [1.0, 0.70, 0.50], sunI: 0.9 },
  ];
  const PHASES = ['рассвет', 'день', 'закат', 'ночь'];
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  function palette(t) {
    let i = 0;
    while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1], k = (t - a.t) / (b.t - a.t);
    return { sky: mix(a.sky, b.sky, k), amb: mix(a.amb, b.amb, k), ambI: a.ambI + (b.ambI - a.ambI) * k,
             sun: mix(a.sun, b.sun, k), sunI: a.sunI + (b.sunI - a.sunI) * k };
  }
  const glowUniform = { value: 0.3 };       // свечение листвы/мха/воды/знаков (ночью выше)
  const wetUniform = { value: 0 };          // мокрый мир во время дождя
  let shadowsWanted = false;

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 260);
  camera.rotation.order = 'YXZ';
  let yaw = 0, pitch = 0;
  function setView(x, y, z, yawDeg, pitchDeg) {
    camera.position.set(x, y, z);
    yaw = yawDeg * Math.PI / 180; pitch = pitchDeg * Math.PI / 180;
    camera.rotation.set(pitch, yaw, 0);
  }

  // ---------- материал: один на все чанки; свечение и «мокрота» через вставки в шейдер ----------
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowUniform;
    shader.uniforms.uWet = wetUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;\nuniform float uWet;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.25 * uWet;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;');
  };

  const world = new VoxelWorld(1337);
  const meshes = new Array(CX * CZ).fill(null);
  function applyChunk(i, a) {
    if (meshes[i]) { meshes[i].geometry.dispose(); scene.remove(meshes[i]); meshes[i] = null; }
    if (a.idx.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
    g.setAttribute('glow', new THREE.BufferAttribute(a.glow, 1));
    g.setIndex(new THREE.BufferAttribute(a.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.position.set(a.ox, 0, a.oz);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    meshes[i] = m;
  }
  const tGen0 = performance.now();
  world.generate();
  for (let i = 0; i < CX * CZ; i++) applyChunk(i, world.buildChunk(i));
  const genMs = Math.round(performance.now() - tGen0);

  // ---------- персонаж: ходьба (по умолчанию) или полёт (F) ----------
  const walker = new RL.Walker(world, { x: world.spawn.x + 0.5, y: world.spawn.y, z: world.spawn.z + 0.5 });
  walker.onGround = true;
  let flying = false;
  setView(walker.x, walker.y + PHYS.EYE, walker.z, 0, -8);

  // ---------- гало светящихся растений и знаков: один Points = один draw call ----------
  function radialTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = radialTexture();
  const HALO_MAX = 256;
  const haloPos = new Float32Array(HALO_MAX * 3);
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setDrawRange(0, 0);
  const haloMat = new THREE.PointsMaterial({
    size: 9, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(0.35, 1.0, 0.6), opacity: 0.3, sizeAttenuation: true,
  });
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.frustumCulled = false;
  scene.add(halos);
  let haloN = 0;
  function addHalo(p) {
    if (haloN >= HALO_MAX) return;
    haloPos[haloN * 3] = p.o.x + 0.5; haloPos[haloN * 3 + 1] = p.top - 1.5; haloPos[haloN * 3 + 2] = p.o.z + 0.5;
    haloN++;
    haloGeo.attributes.position.needsUpdate = true;
    haloGeo.setDrawRange(0, haloN);
  }

  // ---------- предпросмотр посадки ----------
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.35, depthWrite: false, fog: false });
  const ghost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
  ghost.visible = false; ghost.frustumCulled = false;
  scene.add(ghost);
  let ghostKey = '';
  const GCOL = { good: 0x2ecc71, marginal: 0xf1c40f, wait: 0x8e9aa6 };
  function buildGhost(voxels) {
    const pos = [], idx = [];
    const D = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const C = [
      [[1,0,0],[1,0,1],[1,1,1],[1,1,0]], [[0,0,0],[0,1,0],[0,1,1],[0,0,1]],
      [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], [[0,0,0],[0,0,1],[1,0,1],[1,0,0]],
      [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
    ];
    const set = new Set(voxels.map((v) => v[0] + ',' + v[1] + ',' + v[2]));
    for (const v of voxels) for (let f = 0; f < 6; f++) {
      if (set.has((v[0] + D[f][0]) + ',' + (v[1] + D[f][1]) + ',' + (v[2] + D[f][2]))) continue;
      const b = pos.length / 3;
      for (const q of C[f]) pos.push(v[0] + q[0], v[1] + q[1], v[2] + q[2]);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }
  let tool = 0, canWater = P.CAN_MAX, scanCd = 0;
  let target = null, targetEval = null;
  const reach = () => (flying ? REACH_FLY : REACH_WALK);
  function updateTarget() {
    target = null; targetEval = null;
    if (tool === 0) {
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      const p = camera.position;
      const hit = world.raycast(p.x, p.y, p.z, d.x, d.y, d.z, reach());
      if (hit && hit.ny === 1) {
        const o = { x: hit.x, y: hit.y + 1, z: hit.z };
        if (Plant.canPlant(world, o)) { target = o; targetEval = world.evaluate(o.x, o.y, o.z, null); }
      }
    }
    if (!target) { ghost.visible = false; return; }
    const e = targetEval, variant = e.ok ? e.variant : 'sapling';
    const key = target.x + ',' + target.y + ',' + target.z + ',' + variant;
    if (key !== ghostKey) {
      ghostKey = key;
      ghost.geometry.dispose();
      ghost.geometry = buildGhost(Plant.makeBlueprint(world.seed, target, variant).voxels);
      ghost.position.set(target.x, target.y, target.z);
    }
    const marginal = e.ok && (e.Weff < 0.35 || e.Leff < 0.45);
    ghostMat.color.setHex(!e.ok ? GCOL.wait : (marginal ? GCOL.marginal : GCOL.good)).convertSRGBToLinear();
    ghostMat.opacity = e.ok ? 0.5 : 0.3;
    const close = Math.hypot(camera.position.x - target.x, camera.position.y - target.y, camera.position.z - target.z) < 3.5;
    ghost.visible = !close;
  }

  // ---------- посадка ----------
  const active = [];
  function plantAt(o, opts) {
    if (!Plant.canPlant(world, o)) return false;
    const quiet = () => bench.running;      // в бенчмарке звук и реакции дрона выключены
    const pl = new Plant(world, o, Object.assign({}, opts, { on: {
      start: (p) => { if (!quiet()) drone.react('variant:' + p.variant); },
      stage: (p, st) => { if (!quiet()) sfx.grow(st, p.variant, p.o); },
      dormant: (p) => { if (!quiet()) sfx.dormant(p.o); },
      mature: (p) => { addHalo(p); if (!quiet()) { sfx.mature(p.variant, p.o); drone.react('first_mature'); } },
    } }));
    active.push(pl);
    return true;
  }

  // ---------- сканер: оценка клеток вокруг цветными огоньками (один Points) ----------
  const SCAN_MAX = 220;
  const scanPos = new Float32Array(SCAN_MAX * 3), scanCol = new Float32Array(SCAN_MAX * 3);
  const scanGeo = new THREE.BufferGeometry();
  scanGeo.setAttribute('position', new THREE.BufferAttribute(scanPos, 3));
  scanGeo.setAttribute('color', new THREE.BufferAttribute(scanCol, 3));
  scanGeo.setDrawRange(0, 0);
  const scanMat = new THREE.PointsMaterial({
    size: 0.9, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    opacity: 0.9, sizeAttenuation: true,
  });
  const scanPts = new THREE.Points(scanGeo, scanMat);
  scanPts.frustumCulled = false;
  scene.add(scanPts);
  let scanT = 0;
  const SCAN_COL = { good: [0.2, 1.0, 0.4], marginal: [1.0, 0.85, 0.2], bad: [0.8, 0.2, 0.2] };
  function showScan() {
    const cells = world.scanGrid(camera.position.x, camera.position.z, 14, 2).slice(0, SCAN_MAX);
    cells.forEach((c, i) => {
      scanPos[i * 3] = c.x + 0.5; scanPos[i * 3 + 1] = c.y + 0.2; scanPos[i * 3 + 2] = c.z + 0.5;
      const col = SCAN_COL[c.rate]; scanCol[i * 3] = col[0]; scanCol[i * 3 + 1] = col[1]; scanCol[i * 3 + 2] = col[2];
    });
    scanGeo.setDrawRange(0, cells.length);
    scanGeo.attributes.position.needsUpdate = true; scanGeo.attributes.color.needsUpdate = true;
    scanT = 8; scanCd = 3;
    sfx.scan(); drone.flash = Math.max(drone.flash, 0.8);
  }

  // ---------- полив: тёмные пятна на земле (merged-меш) ----------
  const wetMat = new THREE.MeshBasicMaterial({ color: 0x12304f, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const wetMesh = new THREE.Mesh(new THREE.BufferGeometry(), wetMat);
  wetMesh.frustumCulled = false; wetMesh.visible = false;
  scene.add(wetMesh);
  let wetCount = -1;
  function rebuildWet() {
    const seen = new Set(), pos = [], idx = [];
    for (const z of world.irrigation) {
      for (let dx = -z.r; dx <= z.r; dx++) for (let dz = -z.r; dz <= z.r; dz++) {
        if (Math.hypot(dx, dz) > z.r) continue;
        const x = Math.round(z.x) + dx, zz = Math.round(z.z) + dz, k = x + ',' + zz;
        if (seen.has(k)) continue; seen.add(k);
        const gy = world.groundY(x, zz); if (gy < 0) continue;
        const y = gy + 1.03, b = pos.length / 3;
        pos.push(x, y, zz, x + 1, y, zz, x + 1, y, zz + 1, x, y, zz + 1);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
    }
    wetMesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    wetMesh.geometry = g;
    wetMesh.visible = pos.length > 0;
    wetCount = world.irrigation.length;
  }

  // ---------- дождь (≤240 капель) и вспышка молнии ----------
  const RAIN_N = 240;
  const rainPos = new Float32Array(RAIN_N * 6), dropX = new Float32Array(RAIN_N), dropY = new Float32Array(RAIN_N), dropZ = new Float32Array(RAIN_N);
  const resetDrop = (i, initial) => { dropX[i] = (Math.random() - 0.5) * 44; dropZ[i] = (Math.random() - 0.5) * 44; dropY[i] = initial ? Math.random() * 30 - 8 : 20 + Math.random() * 4; };
  for (let i = 0; i < RAIN_N; i++) resetDrop(i, true);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xaec8e8, transparent: true, opacity: 0.4 });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false; rainLines.visible = false;
  scene.add(rainLines);
  let flash = 0, lightningCd = 12, lastRainSent = -1;
  function updateRain(dt) {
    const r = world.weather.rain;
    rainLines.visible = r > 0.02;
    if (rainLines.visible) {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < RAIN_N; i++) {
        dropY[i] -= 28 * dt;
        if (dropY[i] < -8) resetDrop(i, false);
        const x = cx + dropX[i], y = cy + dropY[i], z = cz + dropZ[i];
        rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
        rainPos[i * 6 + 3] = x + 0.04; rainPos[i * 6 + 4] = y + 0.9; rainPos[i * 6 + 5] = z;
      }
      rainGeo.attributes.position.needsUpdate = true;
      rainMat.opacity = 0.12 + 0.35 * r;
    }
    if (Math.abs(r - lastRainSent) > 0.03) { lastRainSent = r; sfx.setRain(r); }
    lightningCd -= dt;
    if (LIGHTNING && r > 0.7 && lightningCd <= 0 && Math.random() < dt * 0.05) {
      flash = 1; lightningCd = 25; sfx.thunder(1.0 + Math.random() * 1.5);
    }
    flash = Math.max(0, flash - dt * 2.5);
  }

  // ---------- сюжет: эхо-видения над пробуждёнными знаками ----------
  const visions = [];
  const timers = [];
  const after = (s, fn) => timers.push({ t: s, fn });
  function visionTree() {
    const v = []; for (let y = 0; y < 12; y++) v.push([0, y, 0]);
    for (let dx = -5; dx <= 5; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++)
      if ((dx * dx + dz * dz) / 25 + (dy * dy) / 9 <= 1.1) v.push([dx, 11 + dy, dz]);
    return v;
  }
  function visionRig() {
    const v = [];
    for (const sx of [-3, 3]) for (const sz of [-3, 3]) for (let y = 0; y < 9; y++) v.push([sx, y, sz]);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) v.push([x, 9, z]);
    for (let y = 0; y < 9; y++) v.push([0, y, 0]);
    for (let y = 10; y < 13; y++) v.push([0, y, 0]);
    return v;
  }
  function visionGardener() {
    const v = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 2, 0], [1, 2, 0], [0, 3, 0], [1, 3, 0], [-1, 3, 0], [2, 3, 0],
               [0, 4, 0], [1, 4, 0], [0, 5, 0], [1, 5, 0]];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      if (dx * dx + dy * dy + dz * dz <= 1) v.push([4 + dx, 4 + dy, dz]);      // дрон рядом
    return v;
  }
  const VISION = [
    { build: visionTree, color: 0x7fe6ff },      // 1: мир был живым (Мировое Древо)
    { build: visionRig, color: 0xff8c40 },       // 2: кто-то брал свет (ржавая буровая)
    { build: visionGardener, color: 0xffe6a0 },  // 3: дрон здесь уже бывал
  ];
  function spawnVision(order, g) {
    const def = VISION[Math.min(order, 3) - 1];
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).convertSRGBToLinear(), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(buildGhost(def.build()), mat);
    mesh.position.set(g.x + 0.5, g.y + 1, g.z + 0.5);
    mesh.scale.y = 0.01; mesh.frustumCulled = false;
    scene.add(mesh);
    visions.push({ mesh, mat, t: 0 });
  }
  function updateVisions(dt) {
    for (let i = visions.length - 1; i >= 0; i--) {
      const v = visions[i]; v.t += dt;
      const rise = Math.min(1, v.t / 3.5);
      v.mesh.scale.y = Math.max(0.01, 1 - Math.pow(1 - rise, 3));
      const fade = v.t > 8 ? Math.max(0, 1 - (v.t - 8) / 3) : 1;
      v.mat.opacity = 0.55 * fade * Math.min(1, v.t / 1.0) * (0.85 + 0.15 * Math.sin(v.t * 9));
      if (v.t > 11) { scene.remove(v.mesh); v.mesh.geometry.dispose(); v.mat.dispose(); visions.splice(i, 1); }
    }
  }
  // финал: три луча света из знаков в небо и ответ мира
  const BEAM_PER = 40;
  const beamPos = new Float32Array(BEAM_PER * 3 * 3);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
  beamGeo.setDrawRange(0, 0);
  const beamMat = new THREE.PointsMaterial({
    size: 1.4, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(0.6, 1.0, 0.85), opacity: 0.8, sizeAttenuation: true,
  });
  const beams = new THREE.Points(beamGeo, beamMat);
  beams.frustumCulled = false;
  scene.add(beams);
  let answerShown = false, skyFlash = 0;
  function finale() {
    answerShown = true;
    let n = 0;
    for (const g of world.glyphs) for (let i = 0; i < BEAM_PER; i++) { beamPos[n * 3] = g.x + 0.5; beamPos[n * 3 + 1] = g.y + 1 + i * 1.5; beamPos[n * 3 + 2] = g.z + 0.5; n++; }
    beamGeo.attributes.position.needsUpdate = true; beamGeo.setDrawRange(0, n);
    skyFlash = 1; sfx.answer(); drone.react('answer', true);
    world.forceStorm();                       // мир отвечает дождём
  }
  function wakeGlyphs() {
    for (const g of world.updateGlyphs()) {
      sfx.echo(g.order); drone.react('echo' + g.order, true); spawnVision(g.order, g);
      addHalo({ o: { x: g.x, z: g.z }, top: g.y + 3 });
      if (!world.answered) after(6, () => {
        const ng = world.nextGlyph();
        if (ng) drone.pointAt({ x: ng.x, y: ng.y + 1, z: ng.z }, 7);
      });
    }
    if (world.answered && !answerShown) { answerShown = true; after(7, () => { answerShown = false; finale(); }); }
  }

  // ---------- дрон-компаньон (MECH-06): только свет и звук, без текста ----------
  const sfx = new RL.Sfx();
  const drone = new RL.Drone(world, { x: world.spawn.x + 2, y: world.spawn.y + 3, z: world.spawn.z });
  drone.onReact = () => { if (!bench.running) sfx.droneReact(); };
  const orbPos = new Float32Array(3);
  const orbGeo = new THREE.BufferGeometry();
  orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
  const orbMat = new THREE.PointsMaterial({
    size: 0.6, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(0.95, 0.55, 0.2), opacity: 0.9, sizeAttenuation: true,
  });
  const orb = new THREE.Points(orbGeo, orbMat);
  orb.frustumCulled = false;
  scene.add(orb);
  const TRAIL_MAX = 80;
  const trailPos = new Float32Array(TRAIL_MAX * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.PointsMaterial({
    size: 0.5, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(0.95, 0.6, 0.25), opacity: 0.8, sizeAttenuation: true,
  });
  const trail = new THREE.Points(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  function updateDrone(dt) {
    if (bench.running) drone.idle = 0;
    drone.update(dt, { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw });
    orbPos[0] = drone.pos.x; orbPos[1] = drone.pos.y; orbPos[2] = drone.pos.z;
    orbGeo.attributes.position.needsUpdate = true;
    orbMat.size = 0.55 + drone.flash * 1.2 + 0.06 * Math.sin(drone.t * 4);
    let n = 0;
    if (drone.spot && (drone.level >= 1 || drone.story)) {     // столб света над местом посадки / знаком
      for (let i = 0; i < 7; i++) {
        trailPos[n * 3] = drone.spot.x + 0.5; trailPos[n * 3 + 1] = drone.spot.y + 0.3 + i * 0.7; trailPos[n * 3 + 2] = drone.spot.z + 0.5; n++;
      }
      if (drone.level >= 2) for (const p of drone.path) {
        if (n >= TRAIL_MAX) break;
        trailPos[n * 3] = p.x; trailPos[n * 3 + 1] = p.y; trailPos[n * 3 + 2] = p.z; n++;
      }
    }
    trailGeo.setDrawRange(0, n);
    trailGeo.attributes.position.needsUpdate = true;
    trailMat.opacity = 0.55 + 0.35 * Math.sin(drone.t * 3);
  }
  function droneText() {
    if (drone.story) return 'показывает знак (свет над ним)';
    if (!drone.enabled) return 'подсказки выключены (N)';
    if (drone.level === 0) return `следует за тобой · подсказка через ${Math.max(0, Math.ceil(RL.DRONE.HINT_IDLE - drone.idle))} с`;
    if (!drone.spot) return 'ищет место для посадки (сейчас подходящих нет)';
    return drone.level === 1 ? 'показывает, где посадить (свет в точке)' : 'ведёт дорожкой света к месту';
  }

  // ---------- управление ----------
  const keys = {};
  let timePaused = false;
  const PHASE_T = [0, 0.25, 0.5, 0.75];
  function setFlying(f) {
    flying = f;
    if (!f) {                                   // приземляемся там, где была камера
      walker.x = camera.position.x; walker.z = camera.position.z; walker.y = camera.position.y - PHYS.EYE; walker.vy = 0; walker.onGround = false;
      for (let i = 0; i < 20 && walker.collides(walker.x, walker.y, walker.z); i++) walker.y += 1;
    }
  }
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    sfx.start();                                // браузер разрешает звук только после жеста пользователя
    if (e.repeat) return;
    if (e.code === 'KeyB' && !bench.running) startBench();
    if (e.code === 'KeyH') shadowsWanted = !shadowsWanted;
    if (e.code === 'KeyY') timePaused = !timePaused;
    if (e.code === 'KeyN') drone.enabled = !drone.enabled;
    if (e.code === 'KeyM') sfx.setMuted(!sfx.muted);
    if (e.code === 'KeyF' && !bench.running) setFlying(!flying);
    if (e.code === 'KeyR') world.forceStorm();                  // тест: вызвать дождь
    if (e.code === 'Digit1') tool = 0;
    if (e.code === 'Digit2') tool = 1;
    if (e.code === 'Digit3') tool = 2;
    if (e.code === 'KeyT') {
      const nx = PHASE_T.find((v) => v > world.timeOfDay + 0.001);
      world.timeOfDay = nx === undefined ? 0 : nx;
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('wheel', (e) => { tool = (tool + (e.deltaY > 0 ? 1 : 2)) % TOOL_NAMES.length; });
  const canvas = renderer.domElement;
  function useTool() {
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    const p = camera.position;
    if (tool === 0) {
      if (target && plantAt({ x: target.x, y: target.y, z: target.z })) { drone.notifyAction(); drone.react('first_plant'); }
    } else if (tool === 1) {
      const hit = world.raycast(p.x, p.y, p.z, d.x, d.y, d.z, reach());
      if (!hit) return;
      if (world.getVoxel(hit.x, hit.y, hit.z) === RL.WATER) { canWater = P.CAN_MAX; sfx.fill(); return; }   // набрать воды в роднике
      if (canWater <= 0) return;
      world.pour(hit.x, hit.z); canWater--; sfx.pour(); drone.notifyAction();
      for (const pl of world.plants) if (pl.state === 'dormant' && Math.hypot(pl.o.x - hit.x, pl.o.z - hit.z) <= P.POUR_R + 1) pl.reeval = 0;
      rebuildWet();
    } else if (scanCd <= 0) showScan();
  }
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    sfx.start();
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    useTool();
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.002;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.002));
    camera.rotation.set(pitch, yaw, 0);
  });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });
  function flyMove(dt) {
    let f = 0, s = 0, u = 0;
    if (keys.KeyW) f += 1; if (keys.KeyS) f -= 1;
    if (keys.KeyD) s += 1; if (keys.KeyA) s -= 1;
    if (keys.Space) u += 1; if (keys.ControlLeft || keys.ControlRight || keys.KeyC) u -= 1;
    const v = 9 * ((keys.ShiftLeft || keys.ShiftRight) ? 2.5 : 1) * dt;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.position.x += (fx * cp * f + rx * s) * v;
    camera.position.y += (sp * f + u) * v;
    camera.position.z += (fz * cp * f + rz * s) * v;
  }
  function walkMove(dt) {
    let f = 0, s = 0;
    if (keys.KeyW) f += 1; if (keys.KeyS) f -= 1;
    if (keys.KeyD) s += 1; if (keys.KeyA) s -= 1;
    walker.update(dt, { f, s, yaw, jump: !!keys.Space, sprint: !!(keys.ShiftLeft || keys.ShiftRight) });
    const e = walker.eye();
    camera.position.set(e.x, e.y, e.z);
  }

  // ---------- сутки и погода ----------
  function applyDaylight(dt) {
    const t = world.timeOfDay, pal = palette(t), sv = world.sunVector(t);
    const cloud = world.weather.cloud, rain = world.weather.rain;
    const lum = 0.3 * pal.sky[0] + 0.59 * pal.sky[1] + 0.11 * pal.sky[2];
    const k = 0.65 * cloud;                                      // тучи гасят и обесцвечивают небо
    const sky = pal.sky.map((c) => c + ((lum * 0.8 + 0.04) - c) * k);
    scene.background.setRGB(sky[0] + skyFlash * 0.25 + flash * 0.25, sky[1] + skyFlash * 0.3 + flash * 0.25, sky[2] + skyFlash * 0.3 + flash * 0.3);
    scene.fog.color.setRGB(sky[0], sky[1], sky[2]).convertSRGBToLinear();
    scene.fog.density = 0.012 + 0.014 * cloud + 0.010 * rain;
    ambient.color.setRGB(pal.amb[0], pal.amb[1], pal.amb[2]);
    ambient.intensity = pal.ambI * (1 - 0.15 * cloud) + flash * 0.9 + skyFlash * 0.5;
    sun.color.setRGB(pal.sun[0], pal.sun[1], pal.sun[2]);
    sun.intensity = pal.sunI * (1 - 0.55 * cloud);
    const ly = Math.max(Math.abs(sv.y), 0.15), l = Math.hypot(sv.x, ly, sv.z);
    sun.position.set(CX0 + sv.x / l * 100, ly / l * 100, CZ0 + sv.z / l * 100);
    sun.castShadow = shadowsWanted;    // не зависит от времени суток: смена числа теней = перекомпиляция шейдеров
    const night = Math.max(0, Math.min(1, -sv.y * 2));
    glowUniform.value = 0.2 + 0.9 * night + 0.25 * cloud;
    haloMat.opacity = 0.25 + 0.55 * night;
    wetUniform.value += (rain - wetUniform.value) * Math.min(1, dt * 0.3);
    skyFlash = Math.max(0, skyFlash - dt * 0.25);
    beamMat.opacity = 0.5 + 0.3 * Math.sin(world.clock * 2);
  }
  function phaseName(t) {
    let best = 0, bd = 9;
    PHASE_T.forEach((k, i) => { const d = Math.min(Math.abs(t - k), 1 - Math.abs(t - k)); if (d < bd) { bd = d; best = i; } });
    return PHASES[best];
  }

  // ---------- бенчмарк: 25 с, до 40 деревьев (force), полдень, ясно, полёт ----------
  const bench = { running: false, t: 0, spawnT: 0, spawned: 0, frames: [], maxCalls: 0, maxTris: 0, report: '', wasFlying: false };
  function startBench() {
    Object.assign(bench, { running: true, t: 0, spawnT: 0, spawned: 0, frames: [], maxCalls: 0, maxTris: 0, report: '', wasFlying: flying });
    flying = true;
    const wt = world.weather; wt.state = 'clear'; wt.cloud = 0; wt.rain = 0; wt.next = world.clock + 300;
    world.timeOfDay = 0.25;
    setView(40, 18, 78, 0, -22);
  }
  function nearestPlantable(x, z) {
    for (let r = 0; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const gy = world.groundY(x + dx, z + dz); if (gy < 0) continue;
      const o = { x: x + dx, y: gy + 1, z: z + dz };
      if (Plant.canPlant(world, o)) return o;
    }
    return null;
  }
  function benchStep(dt) {
    bench.t += dt; bench.frames.push(dt);
    bench.maxCalls = Math.max(bench.maxCalls, renderer.info.render.calls);
    bench.maxTris = Math.max(bench.maxTris, renderer.info.render.triangles);
    bench.spawnT -= dt;
    if (bench.spawnT <= 0 && bench.spawned < BENCH_MAX_TREES) {
      bench.spawnT = BENCH_SPAWN_EVERY;
      const o = nearestPlantable(8 + (bench.spawned % 8) * 9, 8 + Math.floor(bench.spawned / 8) * 9);
      if (o) plantAt(o, { force: true, bench: true });
      bench.spawned++;
    }
    if (bench.t >= BENCH_DURATION) {
      bench.running = false;
      if (!bench.wasFlying) setFlying(false); else flying = true;
      const n = bench.frames.length, sorted = bench.frames.slice().sort((a, b) => a - b);
      const avg = n / bench.t, p99 = sorted[Math.floor(0.99 * (n - 1))], worst = sorted[n - 1];
      const slow = bench.frames.filter((f) => f > 0.0334).length;
      const verdict = avg >= 30 ? 'OK (>=30)' : (avg >= 24 ? 'ПРИЕМЛЕМО (>=24)' : 'НИЖЕ БЮДЖЕТА');
      bench.report = `БЕНЧМАРК (этап 2): avg ${avg.toFixed(1)} FPS | p99 кадр ${(p99 * 1000).toFixed(1)} мс | худший ${(worst * 1000).toFixed(1)} мс | draw calls max ${bench.maxCalls} | треуг. max ${bench.maxTris} | деревьев ${bench.spawned} | кадров >33 мс: ${slow} | ${verdict}`;
      console.log(bench.report);
    }
  }

  // ---------- прогрев шейдеров: оба состояния теней компилируются заранее ----------
  let warmMs = 0;
  try {
    const tw = performance.now();
    sun.castShadow = true;  renderer.compile(scene, camera);
    sun.castShadow = false; renderer.compile(scene, camera);
    warmMs = Math.round(performance.now() - tw);
  } catch (e) { console.warn('прогрев шейдеров не удался', e); }

  // ---------- сюжет: старт — дрон показывает первый знак ----------
  after(3, () => {
    const g = world.nextGlyph();
    if (g) drone.pointAt({ x: g.x, y: g.y + 1, z: g.z }, 8);
  });

  // ---------- главный цикл и HUD ----------
  const hud = document.getElementById('hud');
  let hudT = 0, last = performance.now(), firstFrameMs = null, fpsAcc = 0, fpsN = 0, fps = 0, glyphT = 1;
  const COMPASS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const compass = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
  function frame(now) {
    const rawDt = (now - last) / 1000; last = now;
    const dt = Math.min(rawDt, 0.25);
    if (!bench.running) world.updateWeather(dt);
    if (flying || bench.running) flyMove(dt); else walkMove(dt);
    if (!timePaused && !bench.running) world.timeOfDay = (world.timeOfDay + dt / P.DAY_LEN) % 1;
    applyDaylight(dt);
    sfx.setListener(camera.position.x, camera.position.z, yaw);
    sfx.setAmbient(Math.max(0, Math.min(1, -world.sunVector(world.timeOfDay).y * 2)));
    updateRain(dt);
    for (let i = active.length - 1; i >= 0; i--) { active[i].update(dt); if (active[i].state === 'mature') active.splice(i, 1); }
    world.updateWaves(dt);
    glyphT -= dt;
    if (glyphT <= 0) { glyphT = 1; if (!bench.running) wakeGlyphs(); if (world.irrigation.length !== wetCount) rebuildWet(); }
    for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const fn = timers[i].fn; timers.splice(i, 1); fn(); } }
    updateVisions(dt);
    scanCd = Math.max(0, scanCd - dt);
    if (scanT > 0) { scanT -= dt; scanMat.opacity = Math.min(1, scanT / 2) * 0.9; if (scanT <= 0) scanGeo.setDrawRange(0, 0); }
    updateDrone(dt);
    world.processDirty(P_REMESH_PER_FRAME, applyChunk);
    if (!bench.running) updateTarget(); else ghost.visible = false;
    renderer.render(scene, camera);
    if (firstFrameMs === null) firstFrameMs = Math.round(performance.now());
    if (bench.running) benchStep(rawDt);

    fpsAcc += rawDt; fpsN++; hudT -= rawDt;
    if (hudT <= 0) {
      fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; hudT = 0.25;
      const r = renderer.info.render;
      let growing = 0, dormant = 0, mature = 0;
      for (const p of world.plants) { if (p.state === 'growing') growing++; else if (p.state === 'dormant') dormant++; else if (p.state === 'mature') mature++; }
      const toolLine = TOOL_NAMES.map((n, i) => (i === tool ? '[' : ' ') + (i + 1) + ' ' + n + (i === 1 ? ` ${canWater}/${P.CAN_MAX}` : '') + (i === tool ? ']' : ' ')).join(' ');
      let txt = `FPS ${Math.round(fps)}  |  кадр ${(1000 / Math.max(fps, 1)).toFixed(1)} мс\n` +
        `Draw calls ${r.calls}  |  треугольников ${r.triangles}\n` +
        `GPU: ${gpu}\n` +
        `Генерация мира ${genMs} мс | прогрев шейдеров ${warmMs} мс | тени ${shadowsWanted ? 'вкл' : 'выкл'} | ${canvas.width}x${canvas.height} | до первого кадра ${firstFrameMs} мс\n` +
        `Биом: ${BIOMES[world.biomeAt(camera.position.x, camera.position.z)].name} · погода: ${world.weatherName()} · ${phaseName(world.timeOfDay)} (${world.timeOfDay.toFixed(2)})${timePaused ? ' · пауза' : ''} · ${flying ? 'полёт' : 'ходьба'}\n` +
        `Растёт ${growing} · ждёт воды/света ${dormant} · выросло ${mature}\n` +
        `Инструмент: ${toolLine}\n` +
        `Дрон: ${droneText()} · звук ${sfx.muted ? 'выкл' : (sfx.ctx ? 'вкл' : 'включится после клика')}\n`;
      const ng = world.nextGlyph();
      txt += `Эхо: ${'◉'.repeat(world.chapter)}${'○'.repeat(world.glyphs.length - world.chapter)} (${world.chapter}/${world.glyphs.length})`;
      if (world.answered) txt += ' · МИР ОТВЕТИЛ';
      else if (ng) {
        const near = world.plants.filter((p) => p.state === 'mature' && !p.bench && Math.hypot(p.o.x - ng.x, p.o.z - ng.z) <= P.GLYPH_R);
        const forms = new Set(near.map((p) => p.variant)).size;
        txt += ` · следующий знак: ${Math.round(Math.hypot(ng.x - camera.position.x, ng.z - camera.position.z))} бл. на ${compass(ng.x - camera.position.x, ng.z - camera.position.z)}` +
          ` (нужно ${ng.need.count} дерева рядом, форм ≥${ng.need.forms}; сейчас ${near.length}/${forms})`;
      }
      txt += '\n';
      if (targetEval) {
        const e = targetEval;
        txt += `Курсор: вода ${e.Weff.toFixed(2)} · свет ${e.Leff.toFixed(2)} · соседей ${e.N} → ` +
          (e.ok ? `форма «${VARIANTS[e.variant].name}»` : (e.Weff < P.W_MIN ? 'не хватает воды (будет ждать)' : 'не хватает света (будет ждать)')) + '\n';
      }
      if (bench.running) txt += `БЕНЧМАРК идёт: ${Math.round(bench.t)} / ${BENCH_DURATION} с\n`;
      else if (bench.report) txt += bench.report + '\n';
      txt += '\nWASD ходьба · Space прыжок · Shift бег · F полёт · 1/2/3 или колесо: инструмент · ЛКМ использовать · T время · Y пауза · R дождь · N дрон · M звук · B бенчмарк · H тени · Esc мышь';
      hud.textContent = txt;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.RL_DEBUG = { world, drone, sfx, walker };      // для отладки из консоли и автотестов
})();
