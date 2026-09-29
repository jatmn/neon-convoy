import type { Game, Terrain } from './engine.ts';
import type { Drone, Point, Rect, Tool } from './types.ts';

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface RenderOptions {
  selectedTool?: Tool; hover?: Point | null; selectedDrone?: Drone | number;
  editing?: boolean; brushMode?: string; brushSize?: number;
}

function context2D(canvas: Surface): Context2D {
  const ctx = canvas.getContext('2d') as Context2D | null;
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  return ctx;
}

const W = 1200;
const H = 600;
const TAU = Math.PI * 2;
const COLORS = {
  cyan: '#5ff8ef',
  coral: '#ff766e',
  gold: '#ffd08d',
  violet: '#b586ff',
  ink: '#100e28',
};

function canvasFor(width: number, height: number) {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function hash(x: number, y: number, seed = 0) {
  let n = Math.imul(x + seed * 17, 374761393) + Math.imul(y + 31, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function glowLine(ctx: Context2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 2, blur = 12) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Draws the game world at its logical 1200 × 600 resolution. */
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  background: Surface | null;
  terrainImage: Surface | null;
  terrainStamp: number | null;
  terrainSource: Terrain | null;
  sheet: ReturnType<Renderer['makeSpriteSheet']>;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.background = null;
    this.terrainImage = null;
    this.terrainStamp = null;
    this.terrainSource = null;
    this.sheet = this.makeSpriteSheet();
  }

  resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  makeBackground() {
    const canvas = canvasFor(W, H);
    const ctx = context2D(canvas);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#080b24');
    sky.addColorStop(0.46, '#242044');
    sky.addColorStop(0.78, '#522b58');
    sky.addColorStop(1, '#17142f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Fine stars are fixed in world space, so animation never flickers.
    for (let i = 0; i < 135; i++) {
      const x = hash(i, 5) * W;
      const y = hash(i, 19) * 300;
      const size = i % 13 === 0 ? 2 : 1;
      ctx.fillStyle = `rgba(190,220,255,${0.16 + hash(i, 7) * 0.42})`;
      ctx.fillRect(x, y, size, size);
    }

    // Sunset disc, with horizontal cuts and a bloom behind the skyline.
    const halo = ctx.createRadialGradient(872, 216, 12, 872, 216, 255);
    halo.addColorStop(0, 'rgba(255,151,136,.30)');
    halo.addColorStop(.48, 'rgba(255,99,153,.13)');
    halo.addColorStop(1, 'rgba(255,99,153,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(590, -50, 570, 530);
    ctx.save();
    ctx.beginPath(); ctx.arc(872, 225, 115, 0, TAU); ctx.clip();
    const sun = ctx.createLinearGradient(0, 110, 0, 345);
    sun.addColorStop(0, '#ffe3a1');
    sun.addColorStop(.48, '#ff9b89');
    sun.addColorStop(1, '#e85f9c');
    ctx.fillStyle = sun;
    ctx.fillRect(750, 108, 244, 240);
    ctx.fillStyle = '#332348';
    for (let i = 0; i < 9; i++) {
      const y = 230 + i * i * 1.68;
      ctx.fillRect(748, y, 250, 2 + i * .8);
    }
    ctx.restore();

    // Layered angular ridges frame the industrial silhouette.
    ctx.fillStyle = '#332447';
    ctx.beginPath(); ctx.moveTo(0, 365);
    for (let x = 0; x <= W; x += 80) ctx.lineTo(x, 318 + hash(x, 1) * 98);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = '#1b1938';
    ctx.beginPath(); ctx.moveTo(0, 420);
    for (let x = 0; x <= W; x += 56) ctx.lineTo(x, 354 + hash(x, 2) * 88);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

    ctx.fillStyle = '#13172e';
    for (let i = 0; i < 72; i++) {
      const x = i * 19;
      const bh = 28 + hash(i, 44) * 74;
      const top = 395 - bh;
      ctx.fillRect(x, top, 11 + hash(i, 8) * 14, bh + 105);
      if (i % 6 === 0) {
        ctx.fillRect(x + 5, top - 24, 2, 25);
        ctx.fillRect(x, top + 8, 30, 2);
      }
      ctx.fillStyle = 'rgba(255,116,161,.22)';
      if (i % 3 === 0) ctx.fillRect(x + 4, top + 12, 2, 3);
      ctx.fillStyle = '#13172e';
    }
    ctx.strokeStyle = 'rgba(244,74,182,.20)';
    ctx.lineWidth = 1;
    const vanishX = 605;
    const horizonY = 393;
    for (let i = -9; i <= 9; i++) {
      ctx.beginPath(); ctx.moveTo(vanishX + i * 24, horizonY); ctx.lineTo(vanishX + i * 190, H); ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const y = horizonY + t * t * 230;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const haze = ctx.createLinearGradient(0, 350, 0, H);
    haze.addColorStop(0, 'rgba(16,13,38,0)');
    haze.addColorStop(1, 'rgba(11,11,30,.45)');
    ctx.fillStyle = haze; ctx.fillRect(0, 350, W, 250);
    this.background = canvas;
  }

  terrainKey(terrain: Terrain) {
    if (Number.isFinite(terrain.revision)) return terrain.revision;
    // Older engines can mutate the same Uint8Array without a revision.
    let value = 2166136261;
    for (let i = 0; i < terrain.cells.length; i++) {
      value = Math.imul(value ^ terrain.cells[i], 16777619);
    }
    return value >>> 0;
  }

  makeTerrain(terrain: Terrain) {
    const { cells, width, height, cellSize: size } = terrain;
    const canvas = canvasFor(width * size, height * size);
    const ctx = context2D(canvas);
    const image = ctx.createImageData(canvas.width, canvas.height);
    const pixels = image.data;
    const stride = canvas.width;
    const rock = [50, 41, 75], steel = [50, 67, 91], built = [53, 81, 100];
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        const type = cells[cy * width + cx];
        if (!type) continue;
        const base = type === 1 ? rock : type === 2 ? steel : built;
        const top = cy === 0 || !cells[(cy - 1) * width + cx];
        const left = cx === 0 || !cells[cy * width + cx - 1];
        const texture = Math.floor(hash(cx, cy, type) * 19) - 9;
        for (let py = 0; py < size; py++) {
          for (let px = 0; px < size; px++) {
            let r = base[0] + texture, g = base[1] + texture, b = base[2] + texture;
            if (type === 1) {
              if ((cx * 3 + cy * 7 + px + py) % 13 === 0) { r += 19; g += 12; b += 21; }
              if (top && py === 0) { r = 85; g = 170; b = 195; }
              if (left && px === 0) { r += 13; g += 12; b += 21; }
            } else if (type === 2) {
              if (top && py < 2) { r = 82; g = 213; b = 226; }
              else if ((cx + cy) % 4 === 0 && px === py) { r = 99; g = 124; b = 151; }
              else if (px === 0) { r = 35; g = 51; b = 75; }
            } else {
              if (top && py < 2) { r = 95; g = 247; b = 225; }
              else if ((cx + cy) % 3 === 0 && px === size - 1) { r = 122; g = 177; b = 187; }
            }
            const at = ((cy * size + py) * stride + cx * size + px) * 4;
            pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(image, 0, 0);
    this.terrainImage = canvas;
    this.terrainStamp = this.terrainKey(terrain);
    this.terrainSource = terrain;
  }

  makeSpriteSheet() {
    const states = ['walk', 'fall', 'laser', 'drill', 'bridge', 'block', 'missile', 'exit', 'dead'];
    const frames = 4;
    const sw = 24, sh = 28;
    const sheet = canvasFor(sw * frames, sh * states.length);
    const c = context2D(sheet);
    c.imageSmoothingEnabled = false;
    const pixel = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
    states.forEach((state, row) => {
      for (let frame = 0; frame < frames; frame++) {
        c.save(); c.translate(frame * sw, row * sh);
        const moving = state === 'walk' || state === 'fall' || state === 'exit';
        const bob = moving ? frame % 2 : 0;
        // Antenna, chassis, armor plates and a bright forward sensor form a strong silhouette.
        pixel(10, 1 + bob, 2, 5, '#657698');
        pixel(9, 0 + bob, 4, 2, frame % 2 ? '#ff8e8b' : '#7ff9ea');
        pixel(5, 8 + bob, 15, 12, '#09172c');
        pixel(4, 11 + bob, 17, 9, '#65becb');
        pixel(5, 10 + bob, 14, 7, '#d7d8d8');
        pixel(6, 11 + bob, 12, 5, '#8999b1');
        pixel(6, 8 + bob, 3, 2, '#ff8e87');
        pixel(14, 11 + bob, 5, 3, '#133245');
        pixel(16, 12 + bob, 3, 2, '#7afaf0');
        pixel(7, 18 + bob, 12, 2, '#385c75');
        pixel(3, 19 + bob, 18, 5, '#142035');
        pixel(5, 20 + bob, 14, 3, '#51667c');
        const tread = frame % 2;
        for (const wheel of [6, 12, 18]) {
          pixel(wheel - 2, 21 + bob, 4, 4, '#12172e');
          pixel(wheel - 1, 22 + bob, 2, 2, tread ? '#8f9fb2' : '#59d6d9');
        }
        if (state === 'laser') {
          pixel(19, 13, 5, 3, '#2b6378'); pixel(22, 14, 2, 1, '#9bfefa');
        } else if (state === 'drill') {
          pixel(19, 16, 3, 3, '#6d718e');
          pixel(22, 16 + frame % 2, 2, 2, '#ffb887');
        } else if (state === 'bridge') {
          pixel(18, 16, 5, 3, '#54d9d7'); pixel(21, 18, 3, 2, '#b9fbeb');
        } else if (state === 'missile') {
          pixel(6, 5, 11, 3, '#ff8d88'); pixel(17, 6, 3, 1, '#ffe7ab');
        } else if (state === 'block') {
          pixel(2, 9, 3, 11, '#6af5e6'); pixel(20, 9, 3, 11, '#6af5e6');
        } else if (state === 'dead') {
          pixel(16, 12, 3, 2, '#ff6c7e');
        }
        c.restore();
      }
    });
    return { image: sheet, states, sw, sh, frames };
  }

  drawPortal(ctx: Context2D, x: number, y: number, time: number, type: 'spawn' | 'exit') {
    const spawn = type === 'spawn';
    const color = spawn ? COLORS.cyan : COLORS.coral;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = color; ctx.shadowBlur = 22;
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, -19, 17, 25, 0, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = spawn ? 'rgba(95,248,239,.5)' : 'rgba(255,118,110,.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.ellipse(0, -19, 22 + i * 5, 30 + i * 4, 0, -Math.PI * .38, Math.PI * .38); ctx.stroke();
    }
    const grad = ctx.createRadialGradient(0, -19, 1, 0, -19, 20);
    grad.addColorStop(0, spawn ? 'rgba(95,248,239,.47)' : 'rgba(255,118,110,.46)');
    grad.addColorStop(1, 'rgba(12,17,42,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(0, -19, 20, 28, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    const pulse = Math.sin(time * 3) * 2;
    ctx.fillRect(-12, -52 + pulse, 24, 2);
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(spawn ? 'DROP' : 'EXIT', 0, -59 + pulse);
    ctx.fillStyle = '#09172a'; ctx.fillRect(-21, 1, 42, 8);
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) ctx.fillRect(-17 + i * 8, 3, 4, 3);
    ctx.restore();
  }

  drawHazards(ctx: Context2D, hazards: Rect[], time: number) {
    for (const hazard of hazards || []) {
      const { x, y, w, h } = hazard;
      const pulse = .65 + .35 * Math.sin(time * 5 + x);
      ctx.fillStyle = `rgba(255,81,109,${.09 + pulse * .12})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = `rgba(255,100,111,${.45 + pulse * .4})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(255,160,123,.6)'; ctx.lineWidth = 2;
      for (let dx = -h; dx < w + h; dx += 17) {
        ctx.beginPath(); ctx.moveTo(x + dx, y + h); ctx.lineTo(x + dx + h, y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawDrone(ctx: Context2D, drone: Drone, time: number, selected: boolean) {
    if (drone.alive === false && drone.state !== 'dead') return;
    const { sw, sh, states, frames, image } = this.sheet;
    let state = drone.state || 'walk';
    if (!states.includes(state)) state = 'walk';
    const row = states.indexOf(state);
    const frame = Math.floor((drone.anim ?? time) * 8) % frames;
    const x = drone.x, y = drone.y;
    ctx.save();
    if (selected) {
      ctx.strokeStyle = 'rgba(111,255,241,.85)'; ctx.lineWidth = 1.5;
      ctx.shadowColor = COLORS.cyan; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(x, y - 14, 19, 20, 0, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = COLORS.cyan; ctx.fillRect(x - 2, y - 43, 4, 4);
    }
    ctx.fillStyle = 'rgba(7,8,25,.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 16, 3.5, 0, 0, TAU); ctx.fill();
    if (drone.boosted) {
      ctx.shadowColor = COLORS.gold; ctx.shadowBlur = 14;
      ctx.strokeStyle = 'rgba(255,208,141,.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y - 15, 15, 17, 0, 0, TAU); ctx.stroke();
    }
    ctx.translate(Math.round(x), Math.round(y));
    if (drone.dir < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, frame * sw, row * sh, sw, sh, -15, -36, 30, 35);
    const phase = Math.sin(time * 24 + drone.id);
    if (state === 'laser') {
      const length = 26 + phase * 5;
      ctx.strokeStyle = '#a5fffb'; ctx.shadowColor = COLORS.cyan; ctx.shadowBlur = 15;
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(11, -15); ctx.lineTo(11 + length, -15); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    } else if (state === 'drill') {
      ctx.fillStyle = '#ffbd91'; ctx.shadowColor = COLORS.coral; ctx.shadowBlur = 10;
      for (let i = 0; i < 3; i++) {
        const px = 15 + i * 5;
        ctx.fillRect(px, -13 + Math.sin(time * 28 + i) * 4, 2, 2);
      }
    } else if (state === 'bridge') {
      glowLine(ctx, 10, -8, 33, -1 + phase * 2, COLORS.cyan, 2, 8);
    } else if (state === 'missile') {
      ctx.fillStyle = '#ffca8c'; ctx.shadowColor = COLORS.coral; ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.arc(11, -23, 3 + Math.abs(phase), 0, TAU); ctx.fill();
    } else if (state === 'block') {
      ctx.strokeStyle = 'rgba(95,248,239,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -14, 20 + phase, -Math.PI * .75, Math.PI * .75); ctx.stroke();
    }
    ctx.restore();
  }

  drawEffects(ctx: Context2D, game: Game, time: number) {
    for (const projectile of game.projectiles || []) {
      const { x, y, vx = 0, vy = 0, kind } = projectile;
      const color = kind === 'missile' ? COLORS.coral : COLORS.cyan;
      glowLine(ctx, x - vx * .03, y - vy * .03, x, y, color, 3, 14);
      ctx.fillStyle = '#fff1db'; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
      if (kind === 'missile') {
        ctx.fillStyle = '#ff9b72';
        ctx.beginPath(); ctx.moveTo(x - vx * .035, y - vy * .035);
        ctx.lineTo(x - vx * .07 + 2, y - vy * .07 + 2);
        ctx.lineTo(x - vx * .07 - 2, y - vy * .07 - 2); ctx.fill();
      }
    }
    for (const effect of game.effects || []) {
      const life = Math.max(0, effect.life / (effect.maxLife || 1));
      const radius = (effect.radius || 16) * (1.25 - life * .35);
      const color = effect.kind === 'exit' ? COLORS.cyan : COLORS.coral;
      ctx.save(); ctx.globalAlpha = life;
      ctx.strokeStyle = color; ctx.lineWidth = 2 + life * 2;
      ctx.shadowColor = color; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, radius, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fff0cc'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, radius * .7, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    for (const particle of game.particles || []) {
      const opacity = Math.max(0, Math.min(1, particle.life / (particle.maxLife || 1)));
      ctx.globalAlpha = opacity;
      ctx.fillStyle = particle.color || COLORS.gold;
      ctx.fillRect(particle.x, particle.y, particle.size || 2, particle.size || 2);
    }
    ctx.globalAlpha = 1;
    // Sparse atmosphere, deterministic positions with time based drift.
    ctx.fillStyle = 'rgba(128,245,245,.22)';
    for (let i = 0; i < 22; i++) {
      const x = (hash(i, 77) * W + time * (3 + i % 4)) % W;
      const y = (hash(i, 45) * H + Math.sin(time + i) * 10) % H;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  drawHover(ctx: Context2D, hover: Point, tool: string | undefined, editing: boolean, time: number, brushSize = 24) {
    if (!hover || !Number.isFinite(hover.x) || !Number.isFinite(hover.y)) return;
    const x = Math.round(hover.x / 4) * 4;
    const y = Math.round(hover.y / 4) * 4;
    const color = tool === 'missile' || tool === 'drill' ? COLORS.coral : COLORS.cyan;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    const radius = editing ? brushSize : 19;
    ctx.beginPath();
    ctx.arc(x, y, radius + Math.sin(time * 4) * 1.5, 0, TAU);
    ctx.stroke();
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const dx = Math.cos(a), dy = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(x + dx * (radius + 5), y + dy * (radius + 5));
      ctx.lineTo(x + dx * (radius + 11), y + dy * (radius + 11)); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = color; ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left'; ctx.fillText((tool || 'SELECT').toUpperCase(), x + 23, y - 20);
    ctx.restore();
  }

  render(game: Game, { selectedTool, hover = null, selectedDrone, editing = false, brushMode, brushSize = 24 }: RenderOptions = {}) {
    const ctx = this.ctx;
    if (!ctx || !game) return;
    if (!this.background) this.makeBackground();
    const terrain = game.terrain;
    if (terrain) {
      const stamp = this.terrainKey(terrain);
      if (this.terrainSource !== terrain || this.terrainStamp !== stamp) this.makeTerrain(terrain);
    }
    ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.height / H, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (this.background) ctx.drawImage(this.background, 0, 0);
    const time = typeof performance !== 'undefined' ? performance.now() / 1000 : game.elapsed || 0;
    if (this.terrainImage) ctx.drawImage(this.terrainImage, 0, 0);
    this.drawHazards(ctx, game.level?.hazards, time);
    if (game.level?.spawn) this.drawPortal(ctx, game.level.spawn.x, game.level.spawn.y, time, 'spawn');
    if (game.level?.exit) this.drawPortal(ctx, game.level.exit.x, game.level.exit.y, time, 'exit');
    const hoveredDrone = !editing && hover && game.droneAt?.(hover.x, hover.y);
    for (const drone of game.drones || []) {
      this.drawDrone(ctx, drone, time, selectedDrone === drone || selectedDrone === drone.id || hoveredDrone === drone);
    }
    this.drawEffects(ctx, game, time);
    if (hover) this.drawHover(ctx, hover, editing ? brushMode : selectedTool, editing, time, brushSize);
    // A restrained scanline pass binds the crisp foreground to the retro display.
    ctx.fillStyle = 'rgba(7,9,30,.035)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  }
}

export default Renderer;
