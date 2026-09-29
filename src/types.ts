export type Tool = 'laser' | 'drill' | 'missile' | 'bridge' | 'block' | 'boost';
export type GameStatus = 'ready' | 'running' | 'won' | 'lost';
export interface Point { x: number; y: number }
export interface Rect extends Point { w: number; h: number }
export interface TerrainRect extends Rect { type?: number }
export interface Level {
  id: number; name: string; subtitle: string; briefing: string; hint: string;
  difficulty: number; timeLimit: number; total: number; required: number;
  spawn: Point & { dir: number }; exit: Point;
  terrain: TerrainRect[]; hazards: Rect[]; tools: Record<Tool, number>;
  solution: Partial<Record<`${Exclude<Tool, 'boost'>}At`, number>> & { boostAll?: boolean };
}
export interface Drone extends Point {
  id: number; dir: number; state: Exclude<Tool, 'boost'> | 'walk' | 'fall' | 'saved' | 'dead';
  anim: number; vy: number; fallDistance: number; boosted: boolean; alive: boolean;
  actionTime: number; actionStartX?: number; actionStartY?: number;
}
export interface Particle extends Point { vx: number; vy: number; life: number; maxLife: number; color: string; size: number }
export interface Projectile extends Point { vx: number; vy: number; life: number; kind: string; owner: number }
export interface Effect extends Point { radius: number; kind: string; life: number; maxLife: number }
