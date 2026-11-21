import type { GameStatus, Level, Point, Tool } from './types.ts';
import './style.css';
import { Game } from './engine.ts';
import { LEVELS } from './levels.ts';
import { Renderer } from './renderer.ts';
import { AudioEngine } from './audio.ts';

const toolInfo: { id: Tool; name: string; label: string; desc: string; key: string }[] = [
  {
    id: 'laser',
    name: 'Laser',
    label: 'Cut a path',
    desc: 'Cuts a horizontal tunnel through rock ahead. Steel stops the beam.',
    key: '1',
  },
  {
    id: 'drill',
    name: 'Drill',
    label: 'Go underground',
    desc: 'Drills straight down through rock. Reassign another tool to stop digging.',
    key: '2',
  },
  {
    id: 'missile',
    name: 'Missile',
    label: 'Clear the way',
    desc: 'Fires an explosive projectile ahead to blast a crater. Steel survives.',
    key: '3',
  },
  {
    id: 'bridge',
    name: 'Bridge',
    label: 'Close the gap',
    desc: 'Builds a rising staircase in the direction of travel. Start before the edge.',
    key: '4',
  },
  {
    id: 'block',
    name: 'Blocker',
    label: 'Redirect traffic',
    desc: 'Stops a drone and turns others around. Select Blocker again to release it for free.',
    key: '5',
  },
  {
    id: 'boost',
    name: 'Jets',
    label: 'Land safely',
    desc: 'Equips permanent landing jets to survive long falls. Assign to each drone that needs them.',
    key: '6',
  },
];
function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
function cloneTemplate(selector: string): DocumentFragment {
  return document.importNode($<HTMLTemplateElement>(selector).content, true);
}
let progress: Record<number, { completed?: boolean; score?: number; saved?: number }> = {};
let muted = false;
try {
  progress = JSON.parse(localStorage.getItem('neon-convoy-progress') || '{}');
  muted = localStorage.getItem('neon-convoy-muted') === 'true';
} catch {
  /* Storage is optional. */
}
if (!progress || typeof progress !== 'object' || Array.isArray(progress)) progress = {};
let levelIndex = 0;
let game = new Game(LEVELS[0]);
let selectedTool: Tool = 'laser';
let hover: Point | null = null;
let editing = false;
let brushMode = 'erase';
let brushSize = 24;
let drawing = false;
let lastStatus: GameStatus = 'ready';
let lastTick = performance.now();
let modalWasRunning = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const audio = new AudioEngine();
audio.setMuted(muted);

const canvas = $<HTMLCanvasElement>('#game');
const renderer = new Renderer(canvas);
const pauseButton = $('#pause');
const pauseIcon = $<SVGUseElement>('use', pauseButton);
const pauseText = $('span', pauseButton);
for (const tool of toolInfo) {
  const button = $('.tool', cloneTemplate('#tool-template'));
  button.dataset.tool = tool.id;
  button.setAttribute('aria-label', `${tool.name}: ${tool.desc}`);
  $('.tool-key', button).textContent = tool.key;
  $('.tool-count', button).id = `count-${tool.id}`;
  $<SVGUseElement>('use', button).setAttribute('href', `#icon-${tool.id}`);
  $('strong', button).textContent = tool.name;
  $('small', button).textContent = tool.label;
  button.onclick = () => selectTool(tool.id);
  $('#tools').append(button);
}

function difficultyLabel(level: Level) {
  return (
    ['FOUNDATIONS', 'TRAINING', 'TACTICAL', 'ADVANCED', 'EXPERT'][Number(level.difficulty) - 1] ||
    level.difficulty ||
    'TACTICAL'
  );
}
function pad(v: number, n = 2) {
  return String(Math.max(0, Math.floor(v || 0))).padStart(n, '0');
}
function clock(v: number) {
  return `${pad(Math.floor(Math.max(0, v) / 60))}:${pad(Math.max(0, v) % 60)}`;
}
function notify(message: string) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 3300);
}
function save() {
  try {
    localStorage.setItem('neon-convoy-progress', JSON.stringify(progress));
  } catch {
    /* Private browsing may disable persistence. */
  }
}
function drawLevels() {
  const completed = LEVELS.filter((l) => progress[l.id]?.completed).length;
  $('#campaign-complete').textContent = `${completed} / 10 sectors cleared`;
  $('#campaign-percent').textContent = `${completed * 10}%`;
  $('#campaign-fill').style.width = `${completed * 10}%`;
  const cards = LEVELS.map((level, index) => {
    const card = $('.level-card', cloneTemplate('#level-card-template'));
    const current = index === levelIndex;
    const cleared = Boolean(progress[level.id]?.completed);
    card.dataset.level = String(index);
    card.classList.toggle('current', current);
    card.classList.toggle('completed', cleared);
    if (current) card.setAttribute('aria-current', 'step');
    $('.level-number', card).textContent = pad(index + 1);
    $('strong', card).textContent = level.name;
    $('small', card).textContent = String(difficultyLabel(level));
    $('.level-status', card).textContent = cleared ? '✓' : current ? '↗' : '·';
    card.addEventListener('click', () => loadLevel(index));
    return card;
  });
  $('#levels').replaceChildren(...cards);
}
function loadLevel(index: number) {
  if ($<HTMLDialogElement>('#modal').open) $<HTMLDialogElement>('#modal').close();
  modalWasRunning = false;
  levelIndex = index;
  game = new Game(LEVELS[index]);
  lastStatus = 'ready';
  editing = false;
  hover = null;
  drawing = false;
  $('#editor').hidden = true;
  $('#sandbox').setAttribute('aria-pressed', 'false');
  $('#toast').hidden = true;
  audio.setLevel(index);
  audio.setPaused(true);
  const level = game.level;
  $('#level-name').textContent = level.name;
  $('#level-subtitle').textContent = level.subtitle || 'Find the route. Give the order. Bring them home.';
  $('#sector-label').textContent = `SECTOR ${pad(index + 1)}`;
  $('#field-coordinates').textContent = `SECTOR ${pad(index + 1)} / LIVE FEED`;
  $('#difficulty span').textContent = String(difficultyLabel(level));
  document.querySelectorAll('#difficulty i').forEach((bar, i) => {
    bar.classList.toggle('on', i < Number(level.difficulty || 1));
  });
  $('#briefing').textContent = level.briefing;
  selectedTool = toolInfo.find((t) => game.inventory[t.id] > 0)?.id || 'laser';
  drawLevels();
  updateTools();
  updateHUD();
}
function updateTools() {
  for (const t of toolInfo) {
    const b = $(`[data-tool="${t.id}"]`);
    b.setAttribute('aria-pressed', String(selectedTool === t.id));
    b.classList.toggle('depleted', !game.inventory[t.id]);
    $(`#count-${t.id}`).textContent = String(game.inventory[t.id] ?? 0);
  }
  const tool = toolInfo.find((t) => t.id === selectedTool);
  $('#tool-description').textContent = `${tool!.name} — ${tool!.desc}`;
}
function selectTool(id: Tool) {
  selectedTool = id;
  updateTools();
  if (editing) finishEdit();
}
function updateHUD() {
  $('#saved').textContent = pad(game.saved);
  $('#rescue-total').textContent = `/ ${game.level.total}`;
  $('#target').textContent = `TARGET ${game.level.required} TO RESCUE`;
  $('#active').textContent = pad(
    game.drones.filter((d) => !['saved', 'dead', 'lost'].includes(d.state)).length,
  );
  $('#waiting').textContent = `${Math.max(0, game.level.total - game.spawned)} AWAITING · ${game.lost} LOST`;
  $('#timer').textContent = clock(game.remaining);
  $('#timer').classList.toggle('urgent', game.remaining < 30);
  $('#score').textContent = pad(game.score, 5);
  $('#best').textContent = game.sandbox
    ? 'TERRAIN LAB · UNRANKED'
    : `PERSONAL BEST ${progress[game.level.id]?.score ? pad(progress[game.level.id].score ?? 0, 5) : '—'}`;
  $('#start-banner').hidden = game.status !== 'ready' || editing;
  $('#pause-label').hidden = !game.paused || game.status !== 'running' || editing;
  const running = game.status === 'running' && !game.paused;
  const pauseLabel = running ? 'Pause' : 'Play';
  if (pauseButton.getAttribute('aria-label') !== pauseLabel) {
    pauseIcon.setAttribute('href', running ? '#icon-pause' : '#icon-play');
    pauseText.textContent = pauseLabel;
    pauseButton.setAttribute('aria-label', pauseLabel);
  }
  $('#feed-status').textContent = editing
    ? 'TERRAIN LAB / EDITING'
    : game.status === 'ready'
      ? 'AWAITING DEPLOYMENT'
      : game.status === 'won'
        ? 'CONVOY EXTRACTED'
        : game.status === 'lost'
          ? 'SIGNAL LOST'
          : game.paused
            ? 'SIMULATION PAUSED'
            : 'CONVOY IN TRANSIT';
  $('#speed span').textContent = `${game.speed || 1}×`;
}
async function playPause() {
  if (editing) finishEdit();
  if (game.status === 'won' || game.status === 'lost') loadLevel(levelIndex);
  if (game.status === 'ready') {
    game.start();
    await audio.unlock();
  } else game.togglePause();
  audio.setPaused(game.paused || game.status !== 'running');
  updateHUD();
}
function openModal(content: DocumentFragment, pause = true) {
  modalWasRunning = pause && game.status === 'running' && !game.paused;
  if (modalWasRunning) {
    game.togglePause();
    audio.setPaused(true);
  }
  $('#modal-content').replaceChildren(content);
  if (!$<HTMLDialogElement>('#modal').open) $<HTMLDialogElement>('#modal').showModal();
  updateHUD();
}
function closeModal() {
  $<HTMLDialogElement>('#modal').close();
}
$<HTMLDialogElement>('#modal').addEventListener('close', () => {
  if (modalWasRunning && game.status === 'running' && game.paused) {
    game.togglePause();
    audio.setPaused(false);
  }
  modalWasRunning = false;
});
$('#modal-close').onclick = closeModal;
function showResult() {
  const won = game.status === 'won';
  if (won && !game.sandbox) {
    const old = progress[game.level.id] || {};
    progress[game.level.id] = {
      completed: true,
      score: Math.max(old.score || 0, game.score),
      saved: Math.max(old.saved || 0, game.saved),
    };
    save();
    drawLevels();
  }
  audio.setPaused(true);
  audio.playEffect(won ? 'win' : 'lose');
  const content = cloneTemplate('#result-template');
  const finalSector = levelIndex === LEVELS.length - 1;
  $('.result-emblem', content).textContent = won ? '✦' : '↻';
  $('.section-eyebrow', content).textContent =
    `${won ? 'SECTOR SECURED' : 'TRANSMISSION ENDED'}${game.sandbox ? ' · TERRAIN LAB' : ''}`;
  $('h2', content).textContent = won
    ? finalSector
      ? 'They made it home.'
      : 'Convoy extracted.'
    : 'A new route awaits.';
  $('p', content).textContent = won
    ? 'Good instincts, commander. Your drones are safe.'
    : 'Try a different assignment or pause to plan your route.';
  $('#result-saved', content).textContent = `${game.saved}/${game.level.total}`;
  $('#result-score', content).textContent = pad(game.score, 5);
  $('#result-time', content).textContent = clock(game.remaining);
  $('#result-next span', content).textContent = won
    ? finalSector
      ? 'Back to sector 01'
      : 'Next sector'
    : 'Try again';
  $('#result-retry', content).onclick = () => loadLevel(levelIndex);
  $('#result-next', content).onclick = () => loadLevel(won ? (levelIndex + 1) % LEVELS.length : levelIndex);
  openModal(content, false);
}
function toggleMusic() {
  muted = !muted;
  audio.setMuted(muted);
  if (!muted && game.status === 'running' && !game.paused) void audio.unlock();
  try {
    localStorage.setItem('neon-convoy-muted', String(muted));
  } catch {
    /* Private browsing may disable persistence. */
  }
  updateSound();
}
function updateSound() {
  $<SVGUseElement>('#sound use').setAttribute('href', muted ? '#icon-muted' : '#icon-sound');
  $('#sound').setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
}
function finishEdit() {
  editing = false;
  drawing = false;
  $('#editor').hidden = true;
  $('#sandbox').setAttribute('aria-pressed', 'false');
}
$('#deploy').onclick = playPause;
pauseButton.onclick = playPause;
$('#speed').onclick = () => {
  game.speed = game.speed === 2 ? 1 : 2;
  updateHUD();
};
$('#restart').onclick = () => loadLevel(levelIndex);
$('#sound').onclick = toggleMusic;
$('#hint').onclick = () => {
  const content = cloneTemplate('#hint-template');
  $('#hint-text', content).textContent = game.level.hint;
  $('#hint-close', content).onclick = closeModal;
  openModal(content);
};
$('#help').onclick = () => openModal(cloneTemplate('#help-template'));
$('#settings').onclick = () => {
  const content = cloneTemplate('#settings-template');
  const volume = $<HTMLInputElement>('#volume', content);
  const sound = $('#settings-sound', content);
  volume.value = String(audio.volume ?? 0.4);
  volume.oninput = () => audio.setVolume(Number(volume.value));
  sound.textContent = muted ? 'Enable music' : 'Mute music';
  sound.onclick = () => {
    toggleMusic();
    sound.textContent = muted ? 'Enable music' : 'Mute music';
  };
  openModal(content);
};
$('#credits').onclick = () => openModal(cloneTemplate('#credits-template'));
$('#sandbox').onclick = () => {
  if (editing) {
    finishEdit();
    return;
  }
  if (['won', 'lost'].includes(game.status)) loadLevel(levelIndex);
  editing = true;
  if (game.status === 'running' && !game.paused) game.togglePause();
  audio.setPaused(true);
  $('#editor').hidden = false;
  $('#sandbox').setAttribute('aria-pressed', 'true');
  notify('Paint directly on the battlefield. Press Play when your route is ready.');
  updateHUD();
};
$('#finish-edit').onclick = finishEdit;
document.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach(
  (b) =>
    (b.onclick = () => {
      brushMode = b.dataset.brush || 'erase';
      document
        .querySelectorAll<HTMLButtonElement>('[data-brush]')
        .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }),
);
$('#brush-size').oninput = (e) => (brushSize = Number((e.target as HTMLInputElement).value));
function worldPoint(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 1200, y: ((e.clientY - r.top) / r.height) * 600 };
}
function paint(p: Point) {
  game.editTerrain(p.x, p.y, brushMode, brushSize);
  updateHUD();
}
canvas.addEventListener('pointermove', (e) => {
  hover = worldPoint(e);
  if (editing && drawing) paint(hover);
});
canvas.addEventListener('pointerleave', () => (hover = null));
canvas.addEventListener('pointerdown', (e) => {
  if (e.button && e.pointerType === 'mouse') return;
  e.preventDefault();
  canvas.focus();
  hover = worldPoint(e);
  if (editing) {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    paint(hover);
    return;
  }
  if (game.status !== 'running') {
    notify('Deploy the convoy to begin assigning tools.');
    return;
  }
  const drone = game.droneAt(hover.x, hover.y);
  if (!drone) {
    notify('Click a drone to assign the selected tool.');
    return;
  }
  if (game.assign(drone.id, selectedTool)) {
    audio.playEffect(selectedTool);
    notify(`${toolInfo.find((t) => t.id === selectedTool)!.name} assigned to drone ${pad(drone.id)}.`);
    updateTools();
  } else notify('Assignment unavailable. Check your charges or choose another drone.');
});
canvas.addEventListener('pointerup', () => (drawing = false));
canvas.addEventListener('pointercancel', () => (drawing = false));
document.addEventListener('keydown', (e) => {
  if (
    $<HTMLDialogElement>('#modal').open ||
    /INPUT|TEXTAREA|SELECT/.test(e.target instanceof Element ? e.target.tagName : '')
  )
    return;
  if (e.repeat) return;
  if (e.code === 'Space') {
    e.preventDefault();
    void playPause();
  } else if (/^[1-6]$/.test(e.key)) selectTool(toolInfo[Number(e.key) - 1].id);
  else if (e.key.toLowerCase() === 'r') loadLevel(levelIndex);
  else if (e.key.toLowerCase() === 'm') toggleMusic();
  else if (e.key.toLowerCase() === 'f') $('#speed').click();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.status === 'running' && !game.paused) {
    game.togglePause();
    audio.setPaused(true);
  }
});
function frame(now: number) {
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;
  game.update(dt);
  renderer.render(game, { selectedTool, hover, editing, brushMode, brushSize });
  updateHUD();
  if (game.status !== lastStatus) {
    if (['won', 'lost'].includes(game.status)) showResult();
    lastStatus = game.status;
  }
  requestAnimationFrame(frame);
}
loadLevel(0);
updateSound();
requestAnimationFrame(frame);
// Read-only access to the running simulation helps browser integration diagnostics.
if (import.meta.env.DEV)
  window.__NEON_CONVOY__ = {
    get game() {
      return game;
    },
    get audio() {
      return audio;
    },
    loadLevel,
    selectTool,
  };
