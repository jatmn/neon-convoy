import './style.css';
import { Game } from './engine.js';
import { LEVELS } from './levels.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';

const icons = {
  logo: '<path d="m4 15 8-10 8 10-8 5z"/><path d="m4 10 8 5 8-5M12 15v5"/>',
  laser: '<path d="m4 18 5-5 3 3-5 5zM11 13l7-7M16 4l4 4M17 12h4M12 3v4"/>',
  drill: '<path d="M8 3h8v5H8zM9 8v4l6 2-6 3 3 4 3-4v-5M6 5h12"/>',
  missile: '<path d="M14 4c3-2 6-2 6-2s0 3-2 6l-7 7-5-5zM7 9l-4 1-1 5 5-1m5 0-1 7 5-1 1-5M5 17l-3 4 4-2"/><circle cx="15" cy="7" r="1"/>',
  bridge: '<path d="M3 19h5v-5h5V9h5V4h3M3 22V19M8 22v-8m5 8V9m5 13V4"/>',
  block: '<path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5zM8 12h8"/>',
  boost: '<path d="M8 15V6l4-4 4 4v9zM8 9l-4 4v5l4-3m8-6 4 4v5l-4-3M10 18v4m4-4v4"/>',
  play: '<path d="m8 5 11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>', sound: '<path d="m3 9 5 0 5-4v14l-5-4H3zM17 8a7 7 0 0 1 0 8m3-11a11 11 0 0 1 0 14"/>',
  muted: '<path d="m3 9 5 0 5-4v14l-5-4H3zM17 9l5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5m0 2v1"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', gear: '<path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 3 4-1 4-2 1-4 2-3-2-4-4-1-2-3z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.gear}</svg>`;
const toolInfo = [
  { id:'laser', name:'Laser', label:'Cut a path', desc:'Cuts a horizontal tunnel through rock ahead. Steel stops the beam.', key:'1' },
  { id:'drill', name:'Drill', label:'Go underground', desc:'Drills straight down through rock. Reassign another tool to stop digging.', key:'2' },
  { id:'missile', name:'Missile', label:'Clear the way', desc:'Fires an explosive projectile ahead to blast a crater. Steel survives.', key:'3' },
  { id:'bridge', name:'Bridge', label:'Close the gap', desc:'Builds a rising staircase in the direction of travel. Start before the edge.', key:'4' },
  { id:'block', name:'Blocker', label:'Redirect traffic', desc:'Stops a drone and turns others around. Select Blocker again to release it for free.', key:'5' },
  { id:'boost', name:'Jets', label:'Land safely', desc:'Equips permanent landing jets to survive long falls. Assign to each drone that needs them.', key:'6' },
];
const $ = (s) => document.querySelector(s);
let progress = {};
let muted = false;
try { progress = JSON.parse(localStorage.getItem('neon-convoy-progress') || '{}'); muted = localStorage.getItem('neon-convoy-muted') === 'true'; } catch { /* Storage is optional. */ }
if (!progress || typeof progress !== 'object' || Array.isArray(progress)) progress = {};
let levelIndex = 0;
let game = new Game(LEVELS[0]);
let selectedTool = 'laser';
let hover = null;
let editing = false;
let brushMode = 'erase';
let brushSize = 24;
let drawing = false;
let lastStatus = 'ready';
let lastTick = performance.now();
let modalWasRunning = false;
let toastTimer;
const audio = new AudioEngine();
audio.setMuted(muted);

$('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="Neon Convoy home"><span class="brand-symbol">${icon('logo')}</span><span>NEON<span class="brand-light">CONVOY</span><small>AUTONOMOUS MINDS. HUMAN INSTINCT.</small></span></a>
    <nav class="top-actions" aria-label="Game options"><span class="system-status"><i></i> SYSTEM ONLINE</span><button class="icon-button" id="sound" aria-label="Mute music" title="Toggle music (M)">${icon('sound')}</button><button class="icon-button" id="help" aria-label="How to play" title="How to play">${icon('help')}</button><button class="icon-button" id="settings" aria-label="Settings" title="Settings">${icon('gear')}</button></nav>
  </header>
  <main class="layout">
    <aside class="campaign">
      <div class="section-eyebrow">THE CAMPAIGN <span>01 — 10</span></div>
      <h2>A way home.</h2><p class="campaign-intro">Ten sectors. One mission.<br>Leave no drone behind.</p>
      <div class="campaign-progress"><span id="campaign-complete">0 / 10 sectors cleared</span><span id="campaign-percent">0%</span><div class="progress-track"><i id="campaign-fill"></i></div></div>
      <nav id="levels" aria-label="Campaign levels"></nav>
      <div class="sidebar-note"><span class="little-cross">+</span><p>Small drones.<br><strong>Big possibilities.</strong></p><span class="mini-drone">▰<br>◉ ◉</span></div>
      <button class="text-button" id="credits">Field notes & credits ${icon('arrow')}</button>
    </aside>
    <section class="mission" aria-label="Mission control">
      <div class="mission-heading"><div><div class="section-eyebrow"><span class="live-dot"></span> OPERATION: HOMECOMING <span class="sector-label" id="sector-label">SECTOR 01</span></div><h1 id="level-name"></h1><p id="level-subtitle"></p></div><div class="difficulty" id="difficulty"></div></div>
      <div class="telemetry" aria-label="Mission statistics"><div class="stat"><span>RESCUED</span><strong><b id="saved">00</b><em id="rescue-total">/ 10</em></strong><small id="target">TARGET 8</small></div><div class="stat"><span>IN THE FIELD</span><strong id="active">00</strong><small id="waiting">10 AWAITING DEPLOYMENT</small></div><div class="stat"><span>TIME REMAINING</span><strong id="timer">03:00</strong><small>MAKE EVERY SECOND COUNT</small></div><div class="stat"><span>MISSION SCORE</span><strong id="score">00000</strong><small id="best">PERSONAL BEST —</small></div></div>
      <div class="battlefield-shell">
        <div class="field-top"><span><i></i> <b id="feed-status">AWAITING DEPLOYMENT</b></span><span id="field-coordinates">SECTOR 01 / LIVE FEED</span></div>
        <canvas id="game" width="1200" height="600" tabindex="0" aria-label="Drone rescue battlefield. Select a tool, then click or tap a drone to assign it."></canvas>
        <div class="start-banner" id="start-banner"><div><span class="eyebrow">YOUR CONVOY IS READY</span><strong>Every drone counts.</strong><p id="briefing"></p></div><button class="primary-button" id="deploy">${icon('play')} Deploy convoy</button></div>
        <div id="pause-label" class="pause-label" hidden>SIMULATION PAUSED <small>Plan your next move. Tools can still be assigned.</small></div>
        <div id="toast" class="toast" role="status" hidden></div>
        <div class="field-bottom"><span><i class="legend-dot mint"></i> DEPLOYMENT <i class="legend-dot coral"></i> EXTRACTION</span><span>SELECT A TOOL · ASSIGN TO A DRONE</span></div>
      </div>
      <div class="transport"><div class="transport-left"><button id="pause" class="transport-button" aria-label="Play" title="Play / pause (Space)">${icon('play')}<span>Play</span></button><button id="speed" class="transport-button" aria-label="Toggle double speed" title="Toggle speed (F)"><b>»</b><span>1×</span></button><span class="divider"></span><button id="restart" class="transport-button" aria-label="Restart level" title="Restart level (R)">${icon('reset')}<span>Restart</span></button></div><div class="transport-right"><button id="hint" class="text-button">Need a hint?</button><button id="sandbox" class="transport-button" aria-pressed="false">${icon('edit')}<span>Terrain lab</span></button></div></div>
      <div id="editor" class="editor" hidden><strong>TERRAIN LAB</strong><span>Practice freely. Edited runs do not set records.</span><button data-brush="erase" aria-pressed="true">Erase</button><button data-brush="build" aria-pressed="false">Build</button><label>Brush <input id="brush-size" type="range" min="8" max="48" value="24" aria-label="Terrain brush size" /></label><button id="finish-edit">Done editing</button></div>
      <div class="tool-heading"><h2>Give them a purpose.</h2><span>SELECT <kbd>1</kbd>–<kbd>6</kbd> · CLICK A DRONE TO ASSIGN</span></div>
      <div class="tools" id="tools">${toolInfo.map(t => `<button class="tool" data-tool="${t.id}" aria-label="${t.name}: ${t.desc}" aria-pressed="${t.id === selectedTool}"><span class="tool-key">${t.key}</span><span class="tool-count" id="count-${t.id}">0</span><span class="tool-icon">${icon(t.id)}</span><strong>${t.name}</strong><small>${t.label}</small></button>`).join('')}</div>
      <div class="tool-tip"><span class="tip-mark">↳</span><p id="tool-description"></p><span class="selected-label">SELECTED TOOL</span></div>
      <footer class="mission-footer"><span>BUILT TO WANDER. WIRED TO SURVIVE.</span><span><i></i> LOCAL SAVE ENABLED <b>NC / 1.0</b></span></footer>
    </section>
  </main>
  <dialog id="modal"><button id="modal-close" class="icon-button modal-close" aria-label="Close dialog">${icon('close')}</button><div id="modal-content"></div></dialog>
`;
const canvas = $('#game');
const renderer = new Renderer(canvas);
function difficultyLabel(level) { return ['FOUNDATIONS','TRAINING','TACTICAL','ADVANCED','EXPERT'][Number(level.difficulty)-1] || level.difficulty || 'TACTICAL'; }
function pad(v, n = 2) { return String(Math.max(0, Math.floor(v || 0))).padStart(n,'0'); }
function clock(v) { return `${pad(Math.floor(Math.max(0,v) / 60))}:${pad(Math.max(0,v) % 60)}`; }
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3300); }
function save() { try { localStorage.setItem('neon-convoy-progress',JSON.stringify(progress)); } catch { /* Private browsing may disable persistence. */ } }
function drawLevels() {
  const completed = LEVELS.filter(l => progress[l.id]?.completed).length;
  $('#campaign-complete').textContent = `${completed} / 10 sectors cleared`;
  $('#campaign-percent').textContent = `${completed * 10}%`;
  $('#campaign-fill').style.width = `${completed * 10}%`;
  $('#levels').innerHTML = LEVELS.map((l,i) => `<button class="level-card ${i === levelIndex ? 'current' : ''} ${progress[l.id]?.completed ? 'completed' : ''}" data-level="${i}" ${i === levelIndex ? 'aria-current="step"' : ''}><span class="level-number">${pad(i+1)}</span><span class="level-card-title"><strong>${l.name}</strong><small>${difficultyLabel(l)}</small></span><span class="level-status">${progress[l.id]?.completed ? '✓' : i === levelIndex ? '↗' : '·'}</span></button>`).join('');
  document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => loadLevel(Number(b.dataset.level))));
}
function loadLevel(index) {
  if ($('#modal').open) $('#modal').close();
  modalWasRunning = false;
  levelIndex = index;
  game = new Game(LEVELS[index]);
  lastStatus = 'ready';
  editing = false;
  hover = null;
  drawing = false;
  $('#editor').hidden = true;
  $('#sandbox').setAttribute('aria-pressed','false');
  $('#toast').hidden = true;
  audio.setLevel(index);
  audio.setPaused(true);
  const level = game.level;
  $('#level-name').textContent = level.name;
  $('#level-subtitle').textContent = level.subtitle || 'Find the route. Give the order. Bring them home.';
  $('#sector-label').textContent = `SECTOR ${pad(index+1)}`;
  $('#field-coordinates').textContent = `SECTOR ${pad(index+1)} / LIVE FEED`;
  $('#difficulty').innerHTML = `<span>${difficultyLabel(level)}</span><div>${Array.from({length:5},(_,i) => `<i class="${i < Number(level.difficulty || 1) ? 'on' : ''}"></i>`).join('')}</div>`;
  $('#briefing').textContent = level.briefing;
  selectedTool = toolInfo.find(t => game.inventory[t.id] > 0)?.id || 'laser';
  drawLevels(); updateTools(); updateHUD();
}
function updateTools() {
  for (const t of toolInfo) {
    const b = $(`[data-tool="${t.id}"]`);
    b.setAttribute('aria-pressed',String(selectedTool === t.id));
    b.classList.toggle('depleted',!game.inventory[t.id]);
    $(`#count-${t.id}`).textContent = game.inventory[t.id] ?? 0;
  }
  const tool = toolInfo.find(t => t.id === selectedTool);
  $('#tool-description').textContent = `${tool.name} — ${tool.desc}`;
}
function selectTool(id) { selectedTool = id; updateTools(); if(editing) finishEdit(); }
function updateHUD() {
  $('#saved').textContent = pad(game.saved);
  $('#rescue-total').textContent = `/ ${game.level.total}`;
  $('#target').textContent = `TARGET ${game.level.required} TO RESCUE`;
  $('#active').textContent = pad(game.drones.filter(d => !['saved','dead','lost'].includes(d.state)).length);
  $('#waiting').textContent = `${Math.max(0,game.level.total-game.spawned)} AWAITING · ${game.lost} LOST`;
  $('#timer').textContent = clock(game.remaining);
  $('#timer').classList.toggle('urgent',game.remaining < 30);
  $('#score').textContent = pad(game.score,5);
  $('#best').textContent = game.sandbox ? 'TERRAIN LAB · UNRANKED' : `PERSONAL BEST ${progress[game.level.id]?.score ? pad(progress[game.level.id].score,5) : '—'}`;
  $('#start-banner').hidden = game.status !== 'ready' || editing;
  $('#pause-label').hidden = !game.paused || game.status !== 'running' || editing;
  const running = game.status === 'running' && !game.paused;
  $('#pause').innerHTML = `${icon(running ? 'pause' : 'play')}<span>${running ? 'Pause' : 'Play'}</span>`;
  $('#pause').setAttribute('aria-label',running ? 'Pause' : 'Play');
  $('#feed-status').textContent = editing ? 'TERRAIN LAB / EDITING' : game.status === 'ready' ? 'AWAITING DEPLOYMENT' : game.status === 'won' ? 'CONVOY EXTRACTED' : game.status === 'lost' ? 'SIGNAL LOST' : game.paused ? 'SIMULATION PAUSED' : 'CONVOY IN TRANSIT';
  $('#speed span').textContent = `${game.speed || 1}×`;
}
async function playPause() {
  if (editing) finishEdit();
  if (game.status === 'won' || game.status === 'lost') loadLevel(levelIndex);
  if (game.status === 'ready') { game.start(); await audio.unlock(); }
  else game.togglePause();
  audio.setPaused(game.paused || game.status !== 'running');
  updateHUD();
}
function openModal(html, pause = true) {
  modalWasRunning = pause && game.status === 'running' && !game.paused;
  if (modalWasRunning) { game.togglePause(); audio.setPaused(true); }
  $('#modal-content').innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
  updateHUD();
}
function closeModal() { $('#modal').close(); }
$('#modal').addEventListener('close', () => { if (modalWasRunning && game.status === 'running' && game.paused) { game.togglePause(); audio.setPaused(false); } modalWasRunning = false; });
$('#modal-close').onclick = closeModal;
function showResult() {
  const won = game.status === 'won';
  if (won && !game.sandbox) {
    const old = progress[game.level.id] || {};
    progress[game.level.id] = { completed:true, score:Math.max(old.score || 0,game.score), saved:Math.max(old.saved || 0,game.saved) };
    save(); drawLevels();
  }
  audio.setPaused(true);
  audio.playEffect(won ? 'win' : 'lose');
  openModal(`<div class="result-emblem">${won ? '✦' : '↻'}</div><div class="section-eyebrow">${won ? 'SECTOR SECURED' : 'TRANSMISSION ENDED'}${game.sandbox ? ' · TERRAIN LAB' : ''}</div><h2>${won ? levelIndex===9?'They made it home.':'Convoy extracted.' : 'A new route awaits.'}</h2><p>${won ? 'Good instincts, commander. Your drones are safe.' : 'Try a different assignment or pause to plan your route.'}</p><div class="result-stats"><div><strong>${game.saved}/${game.level.total}</strong><span>RESCUED</span></div><div><strong>${pad(game.score,5)}</strong><span>SCORE</span></div><div><strong>${clock(game.remaining)}</strong><span>REMAINING</span></div></div><div class="modal-actions"><button class="secondary-button" id="result-retry">Retry sector</button><button class="primary-button" id="result-next">${won ? levelIndex<9?'Next sector':'Back to sector 01' : 'Try again'} ${icon('arrow')}</button></div>`,false);
  $('#result-retry').onclick = () => loadLevel(levelIndex);
  $('#result-next').onclick = () => loadLevel(won ? (levelIndex+1)%LEVELS.length : levelIndex);
}
function toggleMusic() { muted = !muted; audio.setMuted(muted); if(!muted && game.status==='running' && !game.paused) audio.unlock(); try { localStorage.setItem('neon-convoy-muted',String(muted)); } catch {} updateSound(); }
function updateSound() { $('#sound').innerHTML = icon(muted ? 'muted' : 'sound'); $('#sound').setAttribute('aria-label',muted ? 'Unmute music' : 'Mute music'); }
function finishEdit() { editing=false; drawing=false; $('#editor').hidden=true; $('#sandbox').setAttribute('aria-pressed','false'); }
$('#deploy').onclick = playPause;
$('#pause').onclick = playPause;
$('#speed').onclick = () => { game.speed = game.speed === 2 ? 1 : 2; updateHUD(); };
$('#restart').onclick = () => loadLevel(levelIndex);
$('#sound').onclick = toggleMusic;
$('#hint').onclick = () => openModal(`<div class="section-eyebrow">TACTICAL INTELLIGENCE</div><h2>A little guidance.</h2><p>${game.level.hint}</p><p class="muted-copy">Pause with Space to assign tools precisely. Restart any time with R.</p><button class="primary-button" id="hint-close">Back to the convoy</button>`) || ($('#hint-close').onclick = closeModal);
$('#help').onclick = () => openModal(`<div class="section-eyebrow">COMMANDER'S FIELD GUIDE</div><h2>Autonomous. Not invincible.</h2><p>Your drones drive forward, turn at walls, and roll off edges. Guide enough of them into the coral extraction gate before time runs out.</p><ol class="instructions"><li><strong>Deploy your convoy.</strong> Drones roll out one by one. Watch the terrain before giving orders.</li><li><strong>Select a tool. Click a drone.</strong> Each assignment uses one charge. Laser and drill reshape rock; bridges build a route.</li><li><strong>Pause and plan.</strong> Space pauses; you can still assign tools. Blockers redirect traffic; jets protect against long falls.</li><li><strong>Bring them home.</strong> Meet the rescue target. More rescues, spare tools, and remaining time improve your score.</li></ol><div class="shortcuts"><span><kbd>1–6</kbd> Select tool</span><span><kbd>Space</kbd> Pause</span><span><kbd>F</kbd> 2× speed</span><span><kbd>R</kbd> Restart</span><span><kbd>M</kbd> Music</span></div><p class="muted-copy">Violet rock is destructible. Striped steel is permanent. Orange hazards are fatal. Terrain lab lets you paint and erase terrain in an unranked practice run.</p>`);
$('#settings').onclick = () => { openModal(`<div class="section-eyebrow">CONTROL ROOM</div><h2>Set the atmosphere.</h2><p>Each sector has its own original, looping synthwave sequence.</p><label class="volume-label">Music volume <input id="volume" type="range" min="0" max="1" step="0.05" value="${audio.volume ?? 0.4}" /></label><button class="secondary-button" id="settings-sound">${muted ? 'Enable music' : 'Mute music'}</button><p class="muted-copy">Progress saves automatically in this browser. All ten sectors are available from the campaign list.</p>`); $('#volume').oninput = e => audio.setVolume(Number(e.target.value)); $('#settings-sound').onclick = () => { toggleMusic(); $('#settings-sound').textContent = muted ? 'Enable music' : 'Mute music'; }; };
$('#credits').onclick = () => openModal(`<div class="section-eyebrow">FIELD NOTES / 001</div><h2>Inspired by a classic.<br>Built for a new convoy.</h2><p>Neon Convoy is an original browser puzzle game inspired by the autonomous crowds, limited skill assignments, and terrain puzzles of Lemmings (1991). The drones, levels, art, and synthesized music here are original.</p><p>Research references: <a href="https://en.wikipedia.org/wiki/Lemmings_(video_game)" target="_blank" rel="noreferrer">Wikipedia: Lemmings</a> and <a href="https://www.youtube.com/watch?v=RnPXf3r5IKc" target="_blank" rel="noreferrer">1991 gameplay, levels 1–60</a>.</p><p class="muted-copy">Not affiliated with the owners of Lemmings. Made with Canvas 2D, Web Audio, and a little human instinct.</p>`);
$('#sandbox').onclick = () => { if (editing) { finishEdit(); return; } if(['won','lost'].includes(game.status)) loadLevel(levelIndex); editing = true; if(game.status==='running' && !game.paused) game.togglePause(); audio.setPaused(true); $('#editor').hidden=false; $('#sandbox').setAttribute('aria-pressed','true'); notify('Paint directly on the battlefield. Press Play when your route is ready.'); updateHUD(); };
$('#finish-edit').onclick = finishEdit;
document.querySelectorAll('[data-brush]').forEach(b => b.onclick = () => { brushMode = b.dataset.brush; document.querySelectorAll('[data-brush]').forEach(x=>x.setAttribute('aria-pressed',String(x===b))); });
$('#brush-size').oninput = e => brushSize=Number(e.target.value);
document.querySelectorAll('[data-tool]').forEach(b => b.onclick=()=>selectTool(b.dataset.tool));
function worldPoint(e) { const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)/r.width*1200,y:(e.clientY-r.top)/r.height*600}; }
function paint(p) { game.editTerrain(p.x,p.y,brushMode,brushSize); updateHUD(); }
canvas.addEventListener('pointermove',e=>{hover=worldPoint(e); if(editing && drawing) paint(hover);});
canvas.addEventListener('pointerleave',()=>hover=null);
canvas.addEventListener('pointerdown',e=>{
  if(e.button && e.pointerType==='mouse') return;
  e.preventDefault(); canvas.focus(); hover=worldPoint(e);
  if(editing) { drawing=true; canvas.setPointerCapture(e.pointerId); paint(hover); return; }
  if(game.status!=='running') { notify('Deploy the convoy to begin assigning tools.'); return; }
  const drone=game.droneAt(hover.x,hover.y);
  if(!drone) { notify('Click a drone to assign the selected tool.'); return; }
  if(game.assign(drone.id,selectedTool)) { audio.playEffect(selectedTool); notify(`${toolInfo.find(t=>t.id===selectedTool).name} assigned to drone ${pad(drone.id)}.`); updateTools(); }
  else notify('Assignment unavailable. Check your charges or choose another drone.');
});
canvas.addEventListener('pointerup',()=>drawing=false);
canvas.addEventListener('pointercancel',()=>drawing=false);
document.addEventListener('keydown',e=>{
  if($('#modal').open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if(e.repeat) return;
  if(e.code==='Space') { e.preventDefault(); playPause(); }
  else if(/^[1-6]$/.test(e.key)) selectTool(toolInfo[Number(e.key)-1].id);
  else if(e.key.toLowerCase()==='r') loadLevel(levelIndex);
  else if(e.key.toLowerCase()==='m') toggleMusic();
  else if(e.key.toLowerCase()==='f') $('#speed').click();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden && game.status==='running' && !game.paused) {game.togglePause(); audio.setPaused(true);}});
function frame(now) {
  const dt=Math.min((now-lastTick)/1000,0.05); lastTick=now;
  game.update(dt);
  renderer.render(game,{selectedTool,hover,editing,brushMode,brushSize});
  updateHUD();
  if(game.status!==lastStatus) { if(['won','lost'].includes(game.status)) showResult(); lastStatus=game.status; }
  requestAnimationFrame(frame);
}
loadLevel(0); updateSound(); requestAnimationFrame(frame);
// Read-only access to the running simulation helps browser integration diagnostics.
if (import.meta.env.DEV) window.__NEON_CONVOY__ = { get game(){return game;}, get audio(){return audio;}, loadLevel, selectTool };
