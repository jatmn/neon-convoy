import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Terrain, WORLD_WIDTH, WORLD_HEIGHT, CELL_SIZE } from '../src/engine.js';
import { LEVELS } from '../src/levels.js';

function playSolution(level) {
  const game = new Game(level);
  game.start();
  const assigned = new Set();
  for (let frame = 0; frame < level.timeLimit * 60 + 60 && game.status === 'running'; frame++) {
    for (const drone of game.drones) {
      if (!drone.alive) continue;
      if (level.solution.boostAll && !drone.boosted) {
        assert.equal(game.assign(drone.id, 'boost'), true, `${level.name}: boost assignment`);
      }
      for (const tool of ['laser', 'drill', 'bridge', 'missile', 'block']) {
        const at = level.solution[`${tool}At`];
        if (at !== undefined && !assigned.has(tool) && drone.x >= at && drone.dir > 0) {
          assert.equal(game.assign(drone.id, tool), true, `${level.name}: ${tool} assignment`);
          assigned.add(tool);
        }
      }
    }
    game.update(1 / 60);
  }
  return { game, assigned };
}

test('ten progressively equipped levels have valid goals and deterministic solutions', () => {
  assert.equal(LEVELS.length, 10);
  assert.deepEqual(LEVELS.map(level => level.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(LEVELS.map(level => level.total), [8, 9, 10, 10, 10, 11, 12, 13, 14, 16]);
  assert.deepEqual(LEVELS.map(level => level.required), [6, 8, 9, 9, 9, 10, 11, 12, 13, 14]);
  for (const level of LEVELS) {
    assert.ok(level.required > 0 && level.required <= level.total, level.name);
    assert.ok(level.spawn.x >= 0 && level.spawn.x < WORLD_WIDTH, level.name);
    assert.ok(level.exit.y >= 0 && level.exit.y < WORLD_HEIGHT, level.name);
    const { game, assigned } = playSolution(level);
    assert.equal(game.status, 'won', `${level.name}: ${JSON.stringify(game.snapshot())}`);
    assert.equal(game.saved, level.total - (level.id === 5 ? 1 : 0), `${level.name}: rescue every available drone`);
    assert.equal(game.lost, 0, level.name);
    assert.ok(game.score > 0, level.name);
    assert.ok(game.elapsed < level.timeLimit, level.name);
    for (const tool of assigned) assert.equal(game.inventory[tool], level.tools[tool] - 1, `${level.name}: spent ${tool}`);
    if (level.solution.boostAll) assert.equal(game.inventory.boost, 0, `${level.name}: boost all`);
  }
});

test('terrain edits use 4-pixel cells, retain steel, and report revisions', () => {
  const terrain = new Terrain([{ x: 0, y: 0, w: 8, h: 8, type: 1 }, { x: 8, y: 0, w: 8, h: 8, type: 2 }]);
  assert.equal(terrain.width, 300);
  assert.equal(terrain.height, 150);
  assert.equal(terrain.cellSize, CELL_SIZE);
  assert.equal(terrain.cells.length, 45000);
  assert.equal(terrain.get(3, 3), 1);
  assert.equal(terrain.get(9, 3), 2);
  assert.equal(terrain.fill(0, 0, 16, 8, 0), true);
  assert.equal(terrain.get(3, 3), 0);
  assert.equal(terrain.get(9, 3), 2, 'destruction must preserve steel');
  assert.equal(terrain.revision, 1);
  assert.equal(terrain.fill(0, 0, 8, 8, 3), true);
  assert.equal(terrain.get(3, 3), 3);
  assert.equal(terrain.revision, 2);
});

test('bridge, drill, laser, and missile leave shared routes for later drones', () => {
  const bridge = playSolution(LEVELS[1]).game;
  assert.equal(bridge.terrain.get(530, 502), 3, 'bridge spans the gap');
  assert.equal(bridge.terrain.get(530, 492), 3, 'bridge rises above the launch road');
  const drill = playSolution(LEVELS[2]).game;
  assert.equal(drill.terrain.get(330, 508), 0, 'drill opens the upper shelf');
  assert.equal(drill.terrain.get(330, 564), 1, 'lower landing remains intact');
  const laser = playSolution(LEVELS[0]).game;
  assert.equal(laser.terrain.get(455, 484), 0, 'laser cuts the wall');
  const missile = playSolution(LEVELS[3]).game;
  assert.equal(missile.terrain.get(460, 480), 0, 'missile clears the gate');
  assert.equal(missile.terrain.get(460, 504), 1, 'blast preserves the roadway');
  const iron = playSolution(LEVELS[7]).game;
  assert.equal(iron.terrain.get(680, 480), 2, 'steel stays in place');
  assert.equal(iron.terrain.get(860, 548), 0, 'lower laser gate is cut');
  const circuit = playSolution(LEVELS[8]).game;
  assert.equal(circuit.terrain.get(690, 502), 3, 'lower road gap is bridged');
});

test('sandbox brush changes terrain and excludes the run from scoring', () => {
  const game = new Game(LEVELS[0]);
  const original = game.terrain.get(450, 480);
  assert.equal(original, 1);
  assert.equal(game.editTerrain(450, 480, 'erase', 18), true);
  assert.equal(game.terrain.get(450, 480), 0);
  assert.equal(game.sandbox, true);
  assert.ok(game.terrain.revision > 0);
  assert.equal(game.editTerrain(450, 480, 'build', 8), true);
  assert.equal(game.terrain.get(450, 480), 1);
  assert.equal(game.editTerrain(450, 480, 'unknown'), false);
  game.start();
  let assigned = false;
  for (let frame = 0; frame < 3600 && game.status === 'running'; frame++) {
    if (!assigned && game.drones[0].x >= 350) {
      assigned = game.assign(game.drones[0].id, 'laser');
    }
    game.update(1 / 60);
  }
  assert.equal(game.status, 'won');
  assert.equal(game.score, 0);
});

test('pause freezes time but still permits assignment; reset restores counters and terrain', () => {
  const game = new Game(LEVELS[0]);
  assert.equal(game.status, 'ready');
  game.start();
  const drone = game.drones[0];
  assert.equal(game.droneAt(drone.x, drone.y - 9)?.id, drone.id);
  assert.equal(game.togglePause(), true);
  game.update(8);
  assert.equal(game.elapsed, 0);
  assert.equal(game.assign(drone.id, 'laser'), true);
  assert.equal(game.inventory.laser, 0);
  assert.equal(game.assign(drone.id, 'laser'), false);
  game.togglePause();
  game.update(1 / 60);
  assert.ok(game.elapsed > 0);
  game.reset();
  assert.equal(game.status, 'ready');
  assert.equal(game.elapsed, 0);
  assert.equal(game.spawned, 0);
  assert.equal(game.inventory.laser, 1);
  assert.equal(game.terrain.get(450, 480), 1);
});

test('steel survives laser and missile damage', () => {
  const level = {
    ...LEVELS[0], total: 1, required: 1, spawn: { x: 350, y: 500, dir: 1 },
    terrain: [{ x: 0, y: 500, w: 1200, h: 100, type: 1 }, { x: 400, y: 450, w: 32, h: 50, type: 2 }],
    tools: { laser: 1, drill: 0, missile: 1, bridge: 0, block: 0, boost: 0 },
  };
  const game = new Game(level);
  game.start();
  game.assign(1, 'laser');
  for (let i = 0; i < 90; i++) game.update(1 / 60);
  assert.equal(game.terrain.get(404, 480), 2);
  assert.ok(game.drones[0].x < 400, 'laser drone must not pass through steel');
  assert.equal(game.drones[0].dir, -1);
  assert.equal(game.assign(1, 'missile'), true);
  for (let i = 0; i < 240; i++) game.update(1 / 60);
  assert.equal(game.terrain.get(404, 480), 2);
});

test('unprotected fall loses a drone while boost saves it', () => {
  const level = { ...LEVELS[5], total: 1, required: 1, tools: { ...LEVELS[5].tools, boost: 1 } };
  const plain = new Game(level); plain.start();
  for (let i = 0; i < 1200 && plain.status === 'running'; i++) plain.update(1 / 60);
  assert.equal(plain.status, 'lost');
  assert.equal(plain.lost, 1);
  const boosted = new Game(level); boosted.start();
  assert.equal(boosted.assign(1, 'boost'), true);
  for (let i = 0; i < 2400 && boosted.status === 'running'; i++) boosted.update(1 / 60);
  assert.equal(boosted.status, 'won');
  assert.equal(boosted.lost, 0);
});

test('time limit ends a run that cannot reach its exit', () => {
  const level = { ...LEVELS[0], total: 1, required: 1, timeLimit: 2, tools: { ...LEVELS[0].tools, laser: 0 } };
  const game = new Game(level); game.start();
  for (let i = 0; i < 180; i++) game.update(1 / 60);
  assert.equal(game.status, 'lost');
  assert.equal(game.remaining, 0);
  assert.equal(game.score, 0);
});

test('meeting the quota keeps play open so remaining drones can add to the score', () => {
  const level = { ...LEVELS[0], total: 2, required: 1, timeLimit: 10, exit: { x: 70, y: 500 }, terrain: [{ x: 0, y: 500, w: 1200, h: 100, type: 1 }] };
  const game = new Game(level); game.start();
  game.update(1 / 60);
  assert.equal(game.saved, 1);
  assert.equal(game.status, 'running');
  assert.equal(game.score, 100);
  for (let i = 0; i < 120 && game.status === 'running'; i++) game.update(1 / 60);
  assert.equal(game.saved, 2);
  assert.equal(game.status, 'won');
  assert.ok(game.score >= 200);
});

test('blocker can be released without spending another block', () => {
  const game = new Game(LEVELS[4]); game.start();
  assert.equal(game.assign(1, 'block'), true);
  assert.equal(game.drones[0].state, 'block');
  assert.equal(game.assign(1, 'block'), true);
  assert.equal(game.drones[0].state, 'walk');
  assert.equal(game.inventory.block, 0);
});
