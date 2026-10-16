// Rootlight · дрон-компаньон (MECH-06). Только свет, жест и звук: без текста и голоса [РЕШЕНО].
// Состояния: follow (следует) → point (указывает место); эскалация подсказок после бездействия:
// уровень 1 — дрон летит к месту и там светит, уровень 2 — дорожка света от игрока до места.
(function (root) {
  'use strict';
  const { Plant, SIZE_X, SIZE_Z, isSoil } = root.RL || require('./world.js');
  const DRONE = { HINT_IDLE: 30, COMMENT_CD: 90, FOLLOW_D: 3, STUCK_T: 1.0 };   // P_HINT_IDLE, P_COMMENT_CD, P_FOLLOW_D, P_STUCK_T

  class Drone {
    constructor(world, start) {
      this.world = world;
      this.pos = { x: start.x, y: start.y, z: start.z };
      this.state = 'follow'; this.enabled = true;
      this.idle = 0; this.level = 0; this.spot = null; this.path = [];
      this.flash = 0; this.cd = 0; this.t = 0; this.stuck = 0;
      this.seen = new Set(); this.onReact = null;
    }
    // Игрок продвинул игру (посадил): подсказки сбрасываются
    notifyAction() { this.idle = 0; this.level = 0; this.spot = null; this.path = []; this.state = 'follow'; }
    // Реакция светом на событие: каждое событие один раз, между реакциями пауза P_COMMENT_CD
    react(name) {
      if (this.seen.has(name)) return false;
      if (this.cd > 0 && name !== 'first_plant') return false;
      this.seen.add(name); this.cd = DRONE.COMMENT_CD; this.flash = 1;
      if (this.onReact) this.onReact(name);
      return true;
    }
    findSpot(pl) {
      const w = this.world; let best = null, bd = Infinity;
      for (let x = 6; x <= SIZE_X - 6; x += 3) for (let z = 6; z <= SIZE_Z - 6; z += 3) {
        const gy = w.groundY(x, z);
        if (gy < 0 || !isSoil(w.getVoxel(x, gy, z))) continue;
        const o = { x, y: gy + 1, z };
        if (!Plant.canPlant(w, o)) continue;
        if (w.plants.some((p) => Math.hypot(p.o.x - x, p.o.z - z) < 4)) continue;
        const e = w.evaluate(x, o.y, z, null);
        if (!e.ok || e.Weff < 0.35 || e.Leff < 0.45) continue;      // только место, где точно вырастет
        const d = Math.hypot(x - pl.x, z - pl.z);
        if (d < 5) continue;
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    _buildPath(pl) {
      const s = this.spot, dx = s.x - pl.x, dz = s.z - pl.z, n = Math.max(2, Math.ceil(Math.hypot(dx, dz) / 2));
      this.path = [];
      for (let i = 1; i < n; i++) {
        const x = pl.x + dx * i / n, z = pl.z + dz * i / n;
        const gy = this.world.groundY(Math.floor(x), Math.floor(z));
        this.path.push({ x, y: (gy < 0 ? 0 : gy) + 1.3, z });
      }
    }
    _hint(pl, level) {
      if (!this.spot) this.spot = this.findSpot(pl);
      this.level = level;
      if (this.spot) this.state = 'point';
    }
    update(dt, pl) {
      this.t += dt;
      this.cd = Math.max(0, this.cd - dt);
      this.flash = Math.max(0, this.flash - dt * 1.5);
      if (this.enabled) {
        this.idle += dt;
        if (this.level === 0 && this.idle >= DRONE.HINT_IDLE) this._hint(pl, 1);
        else if (this.level === 1 && this.idle >= 2 * DRONE.HINT_IDLE) this._hint(pl, 2);
        if (this.level === 2 && this.spot) this._buildPath(pl);
      } else if (this.level !== 0 || this.spot) {
        this.level = 0; this.spot = null; this.path = []; this.state = 'follow';
      }
      let tx, ty, tz;
      if (this.state === 'point' && this.spot) {
        tx = this.spot.x + 0.5; ty = this.spot.y + 3 + Math.sin(this.t * 3) * 0.3; tz = this.spot.z + 0.5;
      } else {
        const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw), rx = Math.cos(pl.yaw), rz = -Math.sin(pl.yaw);
        tx = pl.x + fx * DRONE.FOLLOW_D * 0.7 + rx * 1.4;
        ty = pl.y + 0.3 + Math.sin(this.t * 2) * 0.15;
        tz = pl.z + fz * DRONE.FOLLOW_D * 0.7 + rz * 1.4;
      }
      const k = Math.min(1, dt * (this.state === 'point' ? 1.5 : 4));
      this.pos.x += (tx - this.pos.x) * k; this.pos.y += (ty - this.pos.y) * k; this.pos.z += (tz - this.pos.z) * k;
      const gy = this.world.groundY(Math.floor(this.pos.x), Math.floor(this.pos.z));
      if (gy >= 0) this.pos.y = Math.max(this.pos.y, gy + 1.5);       // не уходит под землю
      // дрон никогда не блокирует и не застревает: внутри вокселя дольше P_STUCK_T — телепорт к игроку
      if (this.world.getVoxel(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)) !== 0) {
        this.stuck += dt;
        if (this.stuck >= DRONE.STUCK_T) { this.pos.x = pl.x; this.pos.y = pl.y + 1; this.pos.z = pl.z; this.stuck = 0; }
      } else this.stuck = 0;
    }
  }

  const api = { Drone, DRONE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL.Drone = Drone; root.RL.DRONE = DRONE; }
})(typeof window !== 'undefined' ? window : globalThis);
