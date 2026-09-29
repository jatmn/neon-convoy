import type { Level, TerrainRect } from './types.ts';

// Coordinates are world pixels in a 1200 × 600 arena. Drone y is its feet.
const ground = (x = 0, w = 1200, y = 500, h = 100, type = 1) => ({ x, y, w, h, type });
const rock = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, type: 1 });
const steel = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, type: 2 });

const define = (id: number, name: string, subtitle: string, briefing: string, hint: string, difficulty: number, timeLimit: number, total: number, required: number, spawn: Level['spawn'], exit: Level['exit'], terrain: TerrainRect[], hazards: Level['hazards'], tools: Level['tools'], solution: Level['solution']): Level => ({
  id, name, subtitle, briefing, hint, difficulty, timeLimit, total, required, spawn, exit, terrain, hazards, tools, solution,
});

export const LEVELS = [
  define(1, 'First Light', 'Cut a path', 'A rock wall blocks the convoy. Give one drone a laser to carve a tunnel for everyone.', 'Select LASER, then click the lead drone before the wall.', 1, 75, 8, 6,
    { x: 70, y: 500, dir: 1 }, { x: 1110, y: 500 }, [ground(), rock(430, 452, 64, 48)], [],
    { laser: 1, drill: 0, missile: 0, bridge: 0, block: 0, boost: 0 }, { laserAt: 350 }),
  define(2, 'Skybridge', 'Mind the gap', 'The road ends over a live conduit. A bridge drone can build a crossing.', 'Select BRIDGE, then click a drone before the gap begins.', 1, 80, 9, 8,
    { x: 70, y: 500, dir: 1 }, { x: 1110, y: 500 }, [ground(0, 480), ground(590, 610)], [{ x: 492, y: 550, w: 85, h: 50 }],
    { laser: 0, drill: 0, missile: 0, bridge: 1, block: 0, boost: 0 }, { bridgeAt: 450 }),
  define(3, 'Undercurrent', 'Find the lower lane', 'The exit sits beneath a rock shelf. Drill a shaft and let the convoy drop onto the lower road.', 'Select DRILL, then click a drone near the middle of the upper shelf.', 2, 85, 10, 9,
    { x: 70, y: 500, dir: 1 }, { x: 1110, y: 560 }, [ground(0, 1200, 500, 24), ground(0, 1200, 560, 40)], [],
    { laser: 0, drill: 1, missile: 0, bridge: 0, block: 0, boost: 0 }, { drillAt: 330 }),
  define(4, 'Fire in the Hole', 'One shot', 'A thick rock plug seals the route. Launch a missile into it.', 'Select MISSILE, then click a drone while the wall is still ahead.', 2, 85, 10, 9,
    { x: 70, y: 500, dir: 1 }, { x: 1110, y: 500 }, [ground(), rock(450, 454, 42, 46)], [],
    { laser: 0, drill: 0, missile: 1, bridge: 0, block: 0, boost: 0 }, { missileAt: 330 }),
  define(5, 'Turnabout', 'Hold the line', 'The exit is behind the launch pad. Park a blocker ahead to turn the following drones around.', 'Select BLOCKER, then click the lead drone just right of the launch pad.', 2, 50, 10, 9,
    { x: 570, y: 500, dir: 1 }, { x: 100, y: 500 }, [ground(), steel(1130, 440, 24, 60)], [],
    { laser: 0, drill: 0, missile: 0, bridge: 0, block: 1, boost: 0 }, { blockAt: 650 }),
  define(6, 'Freefall', 'Light the jets', 'A high ledge overlooks the exit road. Boost each drone before it reaches the drop.', 'Select JETS, then click each new drone before the ledge ends.', 2, 90, 11, 10,
    { x: 70, y: 300, dir: 1 }, { x: 1110, y: 500 }, [ground(0, 420, 300, 30), ground()], [],
    { laser: 0, drill: 0, missile: 0, bridge: 0, block: 0, boost: 11 }, { boostAll: true }),
  define(7, 'Crossed Signals', 'Cut, then build', 'A rock wall guards a broken road. Open the wall and build the missing span.', 'Select LASER for the wall, then BRIDGE before the gap.', 3, 100, 12, 11,
    { x: 70, y: 500, dir: 1 }, { x: 1110, y: 500 }, [ground(0, 680), ground(790, 410), rock(370, 452, 58, 48)], [{ x: 690, y: 552, w: 90, h: 48 }],
    { laser: 1, drill: 0, missile: 0, bridge: 1, block: 0, boost: 0 }, { laserAt: 300, bridgeAt: 650 }),
  define(8, 'The Iron Vein', 'Steel does not yield', 'A steel pillar blocks the upper lane. Drill below it, then cut the rock gate on the lower road.', 'Select DRILL for the upper shelf, then LASER for the lower gate.', 3, 105, 13, 12,
    { x: 70, y: 500, dir: 1 }, { x: 1110, y: 560 }, [ground(0, 1200, 500, 24), ground(0, 1200, 560, 40), steel(680, 440, 28, 60), rock(840, 524, 56, 36)], [],
    { laser: 1, drill: 1, missile: 0, bridge: 0, block: 0, boost: 0 }, { drillAt: 350, laserAt: 760 }),
  define(9, 'Deep Circuit', 'Descend together', 'The lower road is far below and broken in two. Boost every drone, drill through the upper deck, then bridge the gap.', 'Select JETS for each drone; select DRILL for the first, then BRIDGE near the lower gap.', 4, 115, 14, 13,
    { x: 70, y: 300, dir: 1 }, { x: 1110, y: 500 }, [ground(0, 1200, 300, 28), ground(0, 650), ground(750, 450)], [{ x: 665, y: 550, w: 70, h: 50 }],
    { laser: 0, drill: 1, missile: 0, bridge: 1, block: 0, boost: 14 }, { boostAll: true, drillAt: 320, bridgeAt: 620 }),
  define(10, 'Neon Convoy', 'Bring them home', 'Three obstacles guard the last route: a rock wall, a broken span, and a sealed gate.', 'Select LASER for the wall, BRIDGE for the gap, then MISSILE for the final gate.', 5, 125, 16, 14,
    { x: 70, y: 500, dir: 1 }, { x: 1120, y: 500 }, [ground(0, 560), ground(660, 540), rock(320, 452, 58, 48), rock(840, 452, 42, 48)], [{ x: 570, y: 555, w: 75, h: 45 }],
    { laser: 1, drill: 0, missile: 1, bridge: 1, block: 0, boost: 0 }, { laserAt: 260, bridgeAt: 530, missileAt: 790 }),
];

export default LEVELS;
