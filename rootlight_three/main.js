// Rootlight · Three.js, этап 1: сцена, предпросмотр посадки, свечение, день/ночь, HUD, бенчмарк.
(function () {
  'use strict';
  const { VoxelWorld, Plant, P, VARIANTS, CX, CZ } = RL;
  const P_REACH = 16, P_REMESH_PER_FRAME = 1;
  const BENCH_DURATION = 25, BENCH_SPAWN_EVERY = 0.4, BENCH_MAX_TREES = 40;

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
  sun.target.position.set(40, 0, 40);
  sun.castShadow = false;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 220 });
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
  const glowUniform = { value: 0.3 };       // сила свечения листвы/мха/воды (ночью выше)
  let shadowsWanted = false;

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 260);
  camera.rotation.order = 'YXZ';
  let yaw = 0, pitch = 0;
  function setView(x, y, z, yawDeg, pitchDeg) {
    camera.position.set(x, y, z);
    yaw = yawDeg * Math.PI / 180; pitch = pitchDeg * Math.PI / 180;
    camera.rotation.set(pitch, yaw, 0);
  }
  setView(40, 14, 72, 0, -20);

  // ---------- материал: один на все чанки; свечение через атрибут glow ----------
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;')
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

  // ---------- гало светящихся растений: один Points = один draw call ----------
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

  // ---------- предпросмотр посадки (призрачный контур формы) ----------
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
  let target = null, targetEval = null;
  function updateTarget() {
    target = null; targetEval = null;
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    const p = camera.position;
    const hit = world.raycast(p.x, p.y, p.z, d.x, d.y, d.z, P_REACH);
    if (hit && hit.ny === 1) {
      const o = { x: hit.x, y: hit.y + 1, z: hit.z };
      if (Plant.canPlant(world, o)) { target = o; targetEval = world.evaluate(o.x, o.y, o.z, null); }
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
    ghost.visible = !close;                 // камера внутри контура: не заслоняем экран дымкой
  }

  // ---------- посадка ----------
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
  const active = [];

  // ---------- управление ----------
  const keys = {};
  let timePaused = false;
  const PHASE_T = [0, 0.25, 0.5, 0.75];
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    sfx.start();                            // браузер разрешает звук только после жеста пользователя
    if (e.repeat) return;
    if (e.code === 'KeyB' && !bench.running) startBench();
    if (e.code === 'KeyH') shadowsWanted = !shadowsWanted;
    if (e.code === 'KeyY') timePaused = !timePaused;
    if (e.code === 'KeyN') drone.enabled = !drone.enabled;
    if (e.code === 'KeyM') sfx.setMuted(!sfx.muted);
    if (e.code === 'KeyT') {
      const nx = PHASE_T.find((v) => v > world.timeOfDay + 0.001);
      world.timeOfDay = nx === undefined ? 0 : nx;
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  const canvas = renderer.domElement;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    sfx.start();
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    if (target && plantAt({ x: target.x, y: target.y, z: target.z })) { drone.notifyAction(); drone.react('first_plant'); }
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
  function move(dt) {
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

  // ---------- сутки ----------
  function applyDaylight() {
    const t = world.timeOfDay, pal = palette(t), sv = world.sunVector(t);
    scene.background.setRGB(pal.sky[0], pal.sky[1], pal.sky[2]);
    scene.fog.color.setRGB(pal.sky[0], pal.sky[1], pal.sky[2]).convertSRGBToLinear();   // туман считается в линейном пространстве
    ambient.color.setRGB(pal.amb[0], pal.amb[1], pal.amb[2]); ambient.intensity = pal.ambI;
    sun.color.setRGB(pal.sun[0], pal.sun[1], pal.sun[2]); sun.intensity = pal.sunI;
    const ly = Math.max(Math.abs(sv.y), 0.15), l = Math.hypot(sv.x, ly, sv.z);
    sun.position.set(40 + sv.x / l * 80, ly / l * 80, 40 + sv.z / l * 80);
    sun.castShadow = shadowsWanted;   // не зависит от времени суток: смена числа теней = перекомпиляция шейдеров
    const night = Math.max(0, Math.min(1, -sv.y * 2));
    glowUniform.value = 0.2 + 0.9 * night;
    haloMat.opacity = 0.25 + 0.55 * night;
  }
  function phaseName(t) {
    let best = 0, bd = 9;
    PHASE_T.forEach((k, i) => { const d = Math.min(Math.abs(t - k), 1 - Math.abs(t - k)); if (d < bd) { bd = d; best = i; } });
    return PHASES[best];
  }

  // ---------- бенчмарк: 25 с, до 40 деревьев (force), фиксированный полдень ----------
  const bench = { running: false, t: 0, spawnT: 0, spawned: 0, frames: [], maxCalls: 0, maxTris: 0, report: '' };
  function startBench() {
    Object.assign(bench, { running: true, t: 0, spawnT: 0, spawned: 0, frames: [], maxCalls: 0, maxTris: 0, report: '' });
    world.timeOfDay = 0.25;
    setView(40, 18, 78, 0, -22);
  }
  function benchStep(dt) {
    bench.t += dt; bench.frames.push(dt);
    bench.maxCalls = Math.max(bench.maxCalls, renderer.info.render.calls);
    bench.maxTris = Math.max(bench.maxTris, renderer.info.render.triangles);
    bench.spawnT -= dt;
    if (bench.spawnT <= 0 && bench.spawned < BENCH_MAX_TREES) {
      bench.spawnT = BENCH_SPAWN_EVERY;
      const x = 8 + (bench.spawned % 8) * 9, z = 8 + Math.floor(bench.spawned / 8) * 9;
      plantAt({ x, y: world.groundY(x, z) + 1, z }, { force: true });
      bench.spawned++;
    }
    if (bench.t >= BENCH_DURATION) {
      bench.running = false;
      const n = bench.frames.length, sorted = bench.frames.slice().sort((a, b) => a - b);
      const avg = n / bench.t, p99 = sorted[Math.floor(0.99 * (n - 1))], worst = sorted[n - 1];
      const slow = bench.frames.filter((f) => f > 0.0334).length;
      const verdict = avg >= 30 ? 'OK (>=30)' : (avg >= 24 ? 'ПРИЕМЛЕМО (>=24)' : 'НИЖЕ БЮДЖЕТА');
      bench.report = `БЕНЧМАРК (этап 1): avg ${avg.toFixed(1)} FPS | p99 кадр ${(p99 * 1000).toFixed(1)} мс | худший ${(worst * 1000).toFixed(1)} мс | draw calls max ${bench.maxCalls} | треуг. max ${bench.maxTris} | деревьев ${bench.spawned} | кадров >33 мс: ${slow} | ${verdict}`;
      console.log(bench.report);
    }
  }

  // ---------- дрон-компаньон (MECH-06): только свет и звук, без текста ----------
  const sfx = new RL.Sfx();
  const drone = new RL.Drone(world, { x: 40, y: 14, z: 72 });
  drone.onReact = () => { if (!bench.running) sfx.droneReact(); };
  const orbPos = new Float32Array(3);
  const orbGeo = new THREE.BufferGeometry();
  orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
  const orbMat = new THREE.PointsMaterial({
    size: 1.4, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(1.0, 0.8, 0.45), opacity: 0.95, sizeAttenuation: true,
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
    size: 0.7, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color(1.0, 0.85, 0.5), opacity: 0.8, sizeAttenuation: true,
  });
  const trail = new THREE.Points(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  function updateDrone(dt) {
    if (bench.running) drone.idle = 0;
    drone.update(dt, { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw });
    orbPos[0] = drone.pos.x; orbPos[1] = drone.pos.y; orbPos[2] = drone.pos.z;
    orbGeo.attributes.position.needsUpdate = true;
    orbMat.size = 1.2 + drone.flash * 2.0 + 0.15 * Math.sin(drone.t * 4);
    let n = 0;
    if (drone.spot && drone.level >= 1) {              // столб света в месте посадки (+ дорожка на ступени 2)
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
    if (!drone.enabled) return 'подсказки выключены (N)';
    if (drone.level === 0) return `следует за тобой · подсказка через ${Math.max(0, Math.ceil(RL.DRONE.HINT_IDLE - drone.idle))} с`;
    if (!drone.spot) return 'ищет место для посадки (сейчас подходящих нет)';
    return drone.level === 1 ? 'показывает, где посадить (свет в точке)' : 'ведёт дорожкой света к месту';
  }

  // ---------- прогрев шейдеров: оба состояния теней компилируются заранее ----------
  let warmMs = 0;
  try {
    const tw = performance.now();
    ghost.visible = true;
    sun.castShadow = true;  renderer.compile(scene, camera);
    sun.castShadow = false; renderer.compile(scene, camera);
    ghost.visible = false;
    warmMs = Math.round(performance.now() - tw);
  } catch (e) { console.warn('прогрев шейдеров не удался', e); }

  // ---------- главный цикл и HUD ----------
  const hud = document.getElementById('hud');
  let hudT = 0, last = performance.now(), firstFrameMs = null, fpsAcc = 0, fpsN = 0, fps = 0;
  function frame(now) {
    const rawDt = (now - last) / 1000; last = now;
    const dt = Math.min(rawDt, 0.25);
    move(dt);
    if (!timePaused && !bench.running) world.timeOfDay = (world.timeOfDay + dt / P.DAY_LEN) % 1;
    applyDaylight();
    sfx.setListener(camera.position.x, camera.position.z, yaw);
    sfx.setAmbient(Math.max(0, Math.min(1, -world.sunVector(world.timeOfDay).y * 2)));
    for (let i = active.length - 1; i >= 0; i--) { active[i].update(dt); if (active[i].state === 'mature') active.splice(i, 1); }
    world.updateWaves(dt);
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
      let txt = `FPS ${Math.round(fps)}  |  кадр ${(1000 / Math.max(fps, 1)).toFixed(1)} мс\n` +
        `Draw calls ${r.calls}  |  треугольников ${r.triangles}\n` +
        `GPU: ${gpu}\n` +
        `Генерация мира ${genMs} мс | прогрев шейдеров ${warmMs} мс | тени ${shadowsWanted ? 'вкл' : 'выкл'} | ${canvas.width}x${canvas.height} | до первого кадра ${firstFrameMs} мс\n` +
        `Время суток: ${phaseName(world.timeOfDay)} (${world.timeOfDay.toFixed(2)})${timePaused ? ' · пауза' : ''}\n` +
        `Растёт ${growing} · ждёт воды/света ${dormant} · выросло ${mature}\n` +
        `Дрон: ${droneText()} · звук ${sfx.muted ? 'выкл' : (sfx.ctx ? 'вкл' : 'включится после клика')}\n`;
      if (targetEval) {
        const e = targetEval;
        txt += `Курсор: вода ${e.Weff.toFixed(2)} · свет ${e.Leff.toFixed(2)} · соседей ${e.N} → ` +
          (e.ok ? `форма «${VARIANTS[e.variant].name}»` : (e.Weff < P.W_MIN ? 'не хватает воды (будет ждать)' : 'не хватает света (будет ждать)')) + '\n';
      }
      if (bench.running) txt += `БЕНЧМАРК идёт: ${Math.round(bench.t)} / ${BENCH_DURATION} с\n`;
      else if (bench.report) txt += bench.report + '\n';
      txt += '\nЛКМ посадка · WASD/Space/Ctrl полёт · Shift быстрее · T след. время суток · Y пауза времени · N подсказки дрона · M звук · B бенчмарк · H тени · Esc мышь';
      hud.textContent = txt;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
