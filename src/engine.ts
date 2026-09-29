import type { Drone, Effect, GameStatus, Level, Particle, Projectile, TerrainRect, Tool } from './types.ts';

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 600;
export const CELL_SIZE = 4;
const STEP = 1 / 60;
const WALK_SPEED = 38;
const GRAVITY = 500;
const MAX_SAFE_FALL = 110;
const SPAWN_INTERVAL = 1.3;
const TOOL_NAMES: Tool[] = ['laser', 'drill', 'missile', 'bridge', 'block', 'boost'];

export class Terrain {
  cellSize: number;
  width: number;
  height: number;
  cells: Uint8Array;
  revision: number;
  constructor(rects: TerrainRect[] = []) {
    this.cellSize = CELL_SIZE;
    this.width = WORLD_WIDTH / CELL_SIZE;
    this.height = WORLD_HEIGHT / CELL_SIZE;
    this.cells = new Uint8Array(this.width * this.height);
    this.revision = 0;
    for (const rect of rects) this.fill(rect.x, rect.y, rect.w, rect.h, rect.type ?? 1, true);
    this.revision = 0;
  }

  get(x: number, y: number) {
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return 0;
    return this.cells[cy * this.width + cx];
  }

  solid(x: number, y: number) { return this.get(x, y) !== 0; }

  fill(x: number, y: number, w: number, h: number, type: number, initializing = false) {
    const left = Math.max(0, Math.floor(x / CELL_SIZE));
    const top = Math.max(0, Math.floor(y / CELL_SIZE));
    const right = Math.min(this.width, Math.ceil((x + w) / CELL_SIZE));
    const bottom = Math.min(this.height, Math.ceil((y + h) / CELL_SIZE));
    let changed = false;
    for (let cy = top; cy < bottom; cy++) for (let cx = left; cx < right; cx++) {
      const index = cy * this.width + cx;
      if (type === 0 && this.cells[index] === 2) continue;
      if (type === 3 && this.cells[index] !== 0) continue;
      if (this.cells[index] !== type) { this.cells[index] = type; changed = true; }
    }
    if (changed && !initializing) this.revision++;
    return changed;
  }

  circle(x: number, y: number, radius: number, mode: number, maxY = Infinity) {
    const left = Math.max(0, Math.floor((x - radius) / CELL_SIZE));
    const right = Math.min(this.width - 1, Math.floor((x + radius) / CELL_SIZE));
    const top = Math.max(0, Math.floor((y - radius) / CELL_SIZE));
    const bottom = Math.min(this.height - 1, Math.floor((y + radius) / CELL_SIZE));
    let changed = false;
    for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) {
      const px = cx * CELL_SIZE + CELL_SIZE / 2;
      const py = cy * CELL_SIZE + CELL_SIZE / 2;
      if (py >= maxY || (px - x) ** 2 + (py - y) ** 2 > radius ** 2) continue;
      const index = cy * this.width + cx;
      if (mode === 0 && this.cells[index] === 1 || mode > 0 && this.cells[index] === 0) {
        this.cells[index] = mode;
        changed = true;
      }
    }
    if (changed) this.revision++;
    return changed;
  }
}

export class Game {
  level: Level;
  // reset() initializes these fields both at construction and on restart.
  terrain!: Terrain;
  drones!: Drone[];
  particles!: Particle[];
  projectiles!: Projectile[];
  effects!: Effect[];
  elapsed!: number;
  spawned!: number;
  saved!: number;
  lost!: number;
  score!: number;
  status!: GameStatus;
  paused!: boolean;
  speed!: number;
  sandbox!: boolean;
  inventory!: Record<Tool, number>;
  _accumulator!: number;
  _spawnClock!: number;
  _nextId!: number;
  constructor(level: Level) { this.level = level; this.reset(); }

  reset() {
    this.terrain = new Terrain(this.level.terrain);
    this.drones = [];
    this.particles = [];
    this.projectiles = [];
    this.effects = [];
    this.elapsed = 0;
    this.spawned = 0;
    this.saved = 0;
    this.lost = 0;
    this.score = 0;
    this.status = 'ready';
    this.paused = false;
    this.speed = 1;
    this.sandbox = false;
    this.inventory = { ...this.level.tools };
    this._accumulator = 0;
    this._spawnClock = 0;
    this._nextId = 1;
    return this;
  }

  get remaining() { return Math.max(0, this.level.timeLimit - this.elapsed); }
  get total() { return this.level.total; }

  start() {
    if (this.status === 'ready') { this.status = 'running'; this._spawn(); }
    return this.status === 'running';
  }

  togglePause() {
    if (this.status === 'running') this.paused = !this.paused;
    return this.paused;
  }

  droneAt(x: number, y: number) {
    let nearest: Drone | null = null;
    let distance = Infinity;
    for (const drone of this.drones) {
      if (!drone.alive) continue;
      const d = Math.hypot(drone.x - x, drone.y - 9 - y);
      if (d < 20 && d < distance) { nearest = drone; distance = d; }
    }
    return nearest;
  }

  assign(droneId: number, tool: Tool) {
    const drone = this.drones.find(d => d.id === droneId && d.alive);
    if (!drone || !TOOL_NAMES.includes(tool)) return false;
    if (tool === 'block' && drone.state === 'block') {
      drone.state = 'walk';
      return true;
    }
    if (tool === 'boost' && drone.boosted) return false;
    if ((this.inventory[tool] ?? 0) <= 0) return false;
    if (drone.state === 'block') drone.state = 'walk';
    this.inventory[tool]--;
    if (tool === 'boost') {
      drone.boosted = true;
      this._effect(drone.x, drone.y - 12, 20, 'boost', 0.45);
      return true;
    }
    if (tool === 'missile') {
      const projectile = { x: drone.x + drone.dir * 12, y: drone.y - 12, vx: drone.dir * 260, vy: 0, life: 2, kind: 'missile', owner: drone.id };
      this.projectiles.push(projectile);
      drone.state = 'missile';
      drone.actionTime = 0.45;
      return true;
    }
    drone.state = tool;
    drone.actionTime = 0;
    drone.actionStartX = drone.x;
    drone.actionStartY = drone.y;
    return true;
  }

  editTerrain(x: number, y: number, mode: string | number, radius = 20) {
    const type = mode === 'erase' || mode === 0 ? 0 : mode === 'steel' || mode === 2 ? 2 : mode === 'build' || mode === 'rock' || mode === 1 ? 1 : mode === 3 ? 3 : null;
    if (type === null) return false;
    const changed = this.terrain.circle(x, y, Math.max(1, radius), type);
    if (changed) this.sandbox = true;
    return changed;
  }

  snapshot() {
    return {
      status: this.status, elapsed: this.elapsed, remaining: this.remaining, spawned: this.spawned,
      saved: this.saved, lost: this.lost, score: this.score, paused: this.paused, speed: this.speed,
      sandbox: this.sandbox, inventory: { ...this.inventory },
      drones: this.drones.map(({ id, x, y, dir, state, boosted, alive }) => ({ id, x, y, dir, state, boosted, alive })),
      terrainRevision: this.terrain.revision,
    };
  }

  update(dt: number) {
    if (this.status !== 'running' || this.paused || !Number.isFinite(dt) || dt <= 0) return;
    this._accumulator += Math.min(dt, 0.25) * (this.speed === 2 ? 2 : 1);
    while (this._accumulator >= STEP && this.status === 'running') {
      this._tick(STEP);
      this._accumulator -= STEP;
    }
  }

  _spawn() {
    if (this.spawned >= this.level.total) return;
    const { x, y, dir } = this.level.spawn;
    this.drones.push({ id: this._nextId++, x, y, dir: dir || 1, state: 'walk', anim: 0, vy: 0, fallDistance: 0, boosted: false, alive: true, actionTime: 0 });
    this.spawned++;
  }

  _tick(dt: number) {
    this.elapsed += dt;
    this._spawnClock += dt;
    while (this._spawnClock >= SPAWN_INTERVAL && this.spawned < this.level.total) {
      this._spawnClock -= SPAWN_INTERVAL;
      this._spawn();
    }
    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * dt;
      projectile.life -= dt;
      if (this.terrain.solid(projectile.x, projectile.y) || projectile.life <= 0 || projectile.x < 0 || projectile.x >= WORLD_WIDTH) {
        this._explode(projectile.x, projectile.y, 58);
        projectile.life = -1;
      }
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
    for (const drone of this.drones) if (drone.alive) this._updateDrone(drone, dt);
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter(e => e.life > 0);
    for (const particle of this.particles) {
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vy += 110 * dt; particle.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.score = this.sandbox ? 0 : Math.max(0, this.saved * 100 - this.lost * 25);
    const convoyResolved = this.spawned === this.level.total && this.drones.every(d => !d.alive || d.state === 'block');
    if (this.saved >= this.level.required && (convoyResolved || this.remaining <= 0)) {
      this.status = 'won';
      const spareTools = TOOL_NAMES.reduce((sum, tool) => sum + (this.inventory[tool] ?? 0), 0);
      this.score = this.sandbox ? 0 : Math.max(0, Math.round(this.saved * 100 + this.remaining * 5 + spareTools * 12 - this.lost * 25));
    } else if (this.remaining <= 0 || this.lost > this.level.total - this.level.required || convoyResolved) {
      this.status = 'lost';
      this.score = 0;
    }
  }

  _updateDrone(d: Drone, dt: number) {
    d.anim += dt;
    if (d.state === 'block') return;
    if (d.state === 'missile') {
      d.actionTime -= dt;
      if (d.actionTime <= 0) d.state = 'walk';
      return;
    }
    if (d.state === 'laser') {
      d.actionTime += dt;
      this.terrain.fill(d.x + d.dir * 7 - (d.dir < 0 ? 24 : 0), d.y - 22, 24, 22, 0);
      if (d.actionTime > 4.5) d.state = 'walk';
    }
    if (d.state === 'drill') {
      d.actionTime += dt;
      this.terrain.fill(d.actionStartX! - 44, d.actionStartY! + 1, 88, 36, 0);
      if (d.y - d.actionStartY! > 36 || d.actionTime > 2.4) d.state = 'walk';
    }
    if (d.state === 'bridge') {
      d.actionTime += dt;
      const front = d.x + d.dir * 18;
      const distance = Math.abs(d.x - d.actionStartX!);
      const treadTop = d.actionStartY! - Math.min(20, Math.floor(distance / 30) * 4);
      this.terrain.fill(front - 8, treadTop, 20, d.actionStartY! + 5 - treadTop, 3);
      if (Math.abs(d.x - d.actionStartX!) > 180) d.state = 'walk';
    }

    if (d.state === 'drill') {
      this._vertical(d, dt);
    } else {
      const blocking = this.drones.find(other => other !== d && other.alive && other.state === 'block' && Math.abs(other.y - d.y) < 22 && (other.x - d.x) * d.dir > 0 && Math.abs(other.x - d.x) < 14);
      if (blocking) d.dir *= -1;
      else if (d.state !== 'fall' && this.terrain.get(d.x + d.dir * 9, d.y - 2) === 3) {
        const ahead = d.x + d.dir * 9;
        for (let rise = 4; rise <= 24; rise += 4) {
          if (!this.terrain.solid(ahead, d.y - rise - 1) && this.terrain.solid(ahead, d.y - rise + 2)) {
            d.y -= rise;
            break;
          }
        }
      }
      const obstacle = this.terrain.get(d.x + d.dir * 9, d.y - 10);
      if (obstacle && (d.state !== 'laser' || obstacle === 2)) d.dir *= -1;
      d.x += d.dir * WALK_SPEED * dt;
      this._vertical(d, dt);
    }
    if (!d.alive) return;
    const exit = this.level.exit;
    if (Math.abs(d.x - exit.x) < 20 && Math.abs(d.y - exit.y) < 24) {
      d.alive = false; d.state = 'saved'; this.saved++;
      this._effect(d.x, d.y - 10, 26, 'exit', 0.6);
      return;
    }
    if (this.level.hazards.some(h => d.x + 5 > h.x && d.x - 5 < h.x + h.w && d.y > h.y && d.y - 16 < h.y + h.h)) this._kill(d);
    if (d.x < 0 || d.x >= WORLD_WIDTH || d.y > WORLD_HEIGHT + 10) this._kill(d);
  }

  _vertical(d: Drone, dt: number) {
    const floor = this.terrain.solid(d.x - 4, d.y + 2) || this.terrain.solid(d.x + 4, d.y + 2);
    if (!floor) {
      d.vy = Math.min(d.vy + GRAVITY * dt, 260);
      const nextY = d.y + d.vy * dt;
      let landing = null;
      for (let y = Math.floor(d.y + 1); y <= Math.ceil(nextY + 2); y++) {
        if (this.terrain.solid(d.x - 4, y) || this.terrain.solid(d.x + 4, y)) { landing = Math.floor(y / CELL_SIZE) * CELL_SIZE; break; }
      }
      if (landing !== null) {
        d.fallDistance += landing - d.y;
        d.y = landing;
        if (d.fallDistance > MAX_SAFE_FALL && !d.boosted) this._kill(d);
        d.vy = 0; d.fallDistance = 0;
        if (d.state === 'fall') d.state = 'walk';
      } else {
        d.fallDistance += nextY - d.y;
        d.y = nextY;
        if (d.state === 'walk') d.state = 'fall';
      }
    } else { d.vy = 0; d.fallDistance = 0; if (d.state === 'fall') d.state = 'walk'; }
  }

  _kill(d: Drone) {
    if (!d.alive) return;
    d.alive = false; d.state = 'dead'; this.lost++;
    this._effect(d.x, d.y - 10, 20, 'death', 0.45);
  }

  _explode(x: number, y: number, radius: number) {
    // Keep the road beneath the impact intact; the projectile tunnels the wall.
    this.terrain.circle(x, y, radius, 0, y + 12);
    this._effect(x, y, radius, 'blast', 0.55);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI * 2 / 16;
      this.particles.push({ x, y, vx: Math.cos(angle) * 65, vy: Math.sin(angle) * 65, life: 0.5, maxLife: 0.5, color: '#ffae49', size: 3 });
    }
  }

  _effect(x: number, y: number, radius: number, kind: string, life: number) { this.effects.push({ x, y, radius, kind, life, maxLife: life }); }
}

export default Game;
