// Rootlight · персонаж на ногах: гравитация, прыжок, коллизии с вокселями, автоподъём на 1 блок.
// Копать и ломать нельзя (анти-столп 1): персонаж только ходит, прыгает и ухаживает.
(function (root) {
  'use strict';
  const W = root.RL || require('./world.js');
  const { SIZE_X, SIZE_Z, SPROUT } = W;
  const PHYS = { RADIUS: 0.3, HEIGHT: 1.7, EYE: 1.55, SPEED: 4.5, SPRINT: 1.7, GRAVITY: 24, JUMP: 8, STEP: 1.0, FALL_MAX: 30 };

  class Walker {
    constructor(world, pos) {
      this.world = world; this.x = pos.x; this.y = pos.y; this.z = pos.z;
      this.vy = 0; this.onGround = false;
    }
    _solid(id) { return id !== 0 && id !== SPROUT; }          // росток не мешает идти
    collides(x, y, z) {
      const r = PHYS.RADIUS, w = this.world;
      const x0 = Math.floor(x - r), x1 = Math.floor(x + r), z0 = Math.floor(z - r), z1 = Math.floor(z + r);
      const y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + PHYS.HEIGHT - 1e-4);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (let k = z0; k <= z1; k++) {
        if (this._solid(w.getVoxel(i, j, k))) return true;
      }
      return false;
    }
    _moveAxis(dx, dz) {
      const nx = this.x + dx, nz = this.z + dz;
      if (!this.collides(nx, this.y, nz)) { this.x = nx; this.z = nz; return; }
      if (this.onGround) {                                      // автоподъём на ступеньку в 1 блок
        const up = this.y + PHYS.STEP;
        if (!this.collides(this.x, up, this.z) && !this.collides(nx, up, nz)) { this.y = up; this.x = nx; this.z = nz; this.vy = 0; }
      }
    }
    _step(dt, vx, vz, jump) {
      if (vx) this._moveAxis(vx * dt, 0);
      if (vz) this._moveAxis(0, vz * dt);
      if (jump && this.onGround) { this.vy = PHYS.JUMP; this.onGround = false; }
      this.vy = Math.max(-PHYS.FALL_MAX, this.vy - PHYS.GRAVITY * dt);
      const ny = this.y + this.vy * dt;
      if (this.collides(this.x, ny, this.z)) {
        if (this.vy < 0) { this.y = Math.floor(ny) + 1; this.onGround = true; }
        this.vy = 0;
      } else { this.y = ny; this.onGround = false; }
      if (this.vy === 0 && !this.onGround && this.collides(this.x, this.y - 0.02, this.z)) this.onGround = true;
      this.x = Math.max(PHYS.RADIUS, Math.min(SIZE_X - PHYS.RADIUS, this.x));
      this.z = Math.max(PHYS.RADIUS, Math.min(SIZE_Z - PHYS.RADIUS, this.z));
    }
    // input: { f, s, jump, sprint, yaw }
    update(dt, input) {
      const f = input.f || 0, s = input.s || 0;
      const fx = -Math.sin(input.yaw), fz = -Math.cos(input.yaw), rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
      let vx = fx * f + rx * s, vz = fz * f + rz * s;
      const l = Math.hypot(vx, vz);
      const sp = PHYS.SPEED * (input.sprint ? PHYS.SPRINT : 1);
      if (l > 0) { vx = vx / l * sp; vz = vz / l * sp; }
      const n = Math.max(1, Math.min(8, Math.ceil(dt / 0.0167))), h = dt / n;
      for (let i = 0; i < n; i++) this._step(h, vx, vz, input.jump);
    }
    eye() { return { x: this.x, y: this.y + PHYS.EYE, z: this.z }; }
  }

  const api = { Walker, PHYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL.Walker = Walker; root.RL.PHYS = PHYS; }
})(typeof window !== 'undefined' ? window : globalThis);
