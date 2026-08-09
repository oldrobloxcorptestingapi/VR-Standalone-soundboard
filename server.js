const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const figlet = require('figlet');
const { imageSize: sizeOf } = require('image-size');
const app = express();
app.use(express.json());
const PORT = 3000;

// ---------------------------------------------------------------------------
// Route config - add new sound routes here.
// filePath is the path ON THE PHONE (used with `adb shell`), not on this PC.
// ---------------------------------------------------------------------------
const ROUTES = {
  // copy paste these lines to make new sounds also last one does not need an "," only the second to last one
  "left-grip":      { name: "left-grip",      filePath: "/sdcard/Download/Bonk.mp3",      mimeType: "audio/wav" },
  "slot2":      { name: "slot2",      filePath: "/sdcard/Download/NAME HERE.mp3", mimeType: "audio/wav" }
};

// Per-route state, tracks whether a route is currently "active" (already played
// and not yet reset), so we know when to auto keyevent-4 + replay.
const routeState = {}; // { [routeName]: { playing: bool } }
let lastPlayedRoute = null; // most recent route that was played (for /trigger-adb)

// Error codes
const ERR = {
  DEVICE_COUNT: { code: 'X9743', message: 'No device or too many devices connected' },
  BAD_PATH:     { code: 'F404',  message: 'Sound path invalid' },
  NEEDS_RESET:  { code: 'R683',  message: 'Sound needs to be reset' }
};

// ---------------------------------------------------------------------------
// In-memory log buffer, exposed over HTTP via GET /logs so the Quest overlay
// app can poll and display it. Keeps only the most recent MAX_LOG_ENTRIES.
// ---------------------------------------------------------------------------
const MAX_LOG_ENTRIES = 500;
const LOG_BUFFER = [];
let logIdCounter = 0;

function pushLog(level, message) {
  logIdCounter++;
  const entry = {
    id: logIdCounter,
    time: new Date().toLocaleTimeString(),
    level, // 'info' | 'error'
    message
  };
  LOG_BUFFER.push(entry);
  if (LOG_BUFFER.length > MAX_LOG_ENTRIES) {
    LOG_BUFFER.shift();
  }
  return entry;
}

function sendError(res, routeName, err) {
  const message = `[Source Engine]: Error ${err.code} - ${err.message} (route: ${routeName})`;
  console.error(chalk.red(message));
  pushLog('error', message);
  res.status(500).type('text/plain').send(message);
}

function sendSuccess(res, routeName) {
  const message = `[Source Engine]: Sound ${routeName} has been played successfully`;
  console.log(chalk.green(message));
  pushLog('info', message);
  res.status(200).type('text/plain').send(message);
}

// ---------------------------------------------------------------------------
// Logs page HTML
// Self-contained, dark-themed viewer served at /logs/view. Polls /logs/json
// every second and renders new entries. No external dependencies.
// ---------------------------------------------------------------------------
const LOGS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>VR ADB Server — Logs</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #161a22;
    --panel-2: #1c2230;
    --border: #2a3142;
    --text: #e6e9ef;
    --muted: #8a93a6;
    --accent: #4ea1ff;
    --info: #4ea1ff;
    --error: #ff5d6c;
    --warn: #ffb454;
    --ok: #4ade80;
    --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 14px;
    line-height: 1.5;
  }
  header {
    position: sticky; top: 0; z-index: 5;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 12px 18px;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  }
  header h1 {
    margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.2px;
    color: var(--text);
  }
  header h1 .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--ok); margin-right: 8px; vertical-align: middle;
    box-shadow: 0 0 0 0 rgba(74,222,128,0.6);
  }
  header h1 .dot.off { background: var(--muted); box-shadow: none; }
  .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chip {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .chip:hover { color: var(--text); }
  .chip.active { color: var(--text); border-color: var(--accent); background: rgba(78,161,255,0.12); }
  .search {
    flex: 1; min-width: 160px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-family: var(--font);
    outline: none;
  }
  .search:focus { border-color: var(--accent); }
  .spacer { flex: 1; }
  .btn {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover { border-color: var(--accent); }
  .stats {
    display: flex; gap: 14px; padding: 8px 18px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    font-size: 12px; color: var(--muted);
  }
  .stats span b { color: var(--text); font-weight: 600; }
  main {
    padding: 0;
  }
  .log-list {
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .entry {
    display: grid;
    grid-template-columns: 88px 70px 1fr;
    gap: 12px;
    padding: 6px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    align-items: baseline;
  }
  .entry:hover { background: rgba(255,255,255,0.02); }
  .entry .id { color: var(--muted); }
  .entry .time { color: var(--muted); }
  .entry .lvl {
    font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  .entry .lvl.info { color: var(--info); }
  .entry .lvl.error { color: var(--error); }
  .entry .lvl.warn { color: var(--warn); }
  .entry .msg { color: var(--text); white-space: pre-wrap; word-break: break-word; }
  .empty {
    text-align: center; color: var(--muted); padding: 60px 20px;
    font-family: var(--font);
  }
  footer {
    padding: 10px 18px; color: var(--muted); font-size: 11px;
    border-top: 1px solid var(--border); background: var(--panel);
    text-align: center;
  }
</style>
</head>
<body>
  <header>
    <h1><span id="statusDot" class="dot"></span>VR ADB Server — Live Logs</h1>
    <div class="filters" id="filters">
      <span class="chip active" data-level="all">All</span>
      <span class="chip active" data-level="info">Info</span>
      <span class="chip active" data-level="error">Error</span>
      <span class="chip active" data-level="warn">Warn</span>
    </div>
    <input id="search" class="search" type="text" placeholder="Filter by message…" />
    <span class="spacer"></span>
    <button id="autoscroll" class="btn">Auto-scroll: ON</button>
    <button id="clear" class="btn">Clear view</button>
  </header>
  <div class="stats">
    <span>Total buffered: <b id="totalCount">0</b></span>
    <span>Shown: <b id="shownCount">0</b></span>
    <span>Last update: <b id="lastUpdate">—</b></span>
    <span>Status: <b id="conn">connecting…</b></span>
  </div>
  <main>
    <div id="logList" class="log-list">
      <div class="empty">Waiting for logs…</div>
    </div>
  </main>
  <footer>Polling <code>/logs/json</code> every 1s · buffer holds up to 500 entries</footer>

<script>
(function () {
  const logList = document.getElementById('logList');
  const totalCountEl = document.getElementById('totalCount');
  const shownCountEl = document.getElementById('shownCount');
  const lastUpdateEl = document.getElementById('lastUpdate');
  const connEl = document.getElementById('conn');
  const statusDot = document.getElementById('statusDot');
  const searchEl = document.getElementById('search');
  const filtersEl = document.getElementById('filters');
  const autoscrollBtn = document.getElementById('autoscroll');
  const clearBtn = document.getElementById('clear');

  let lastId = 0;
  const seenIds = new Set();
  const entries = [];
  let autoscroll = true;
  const activeLevels = new Set(['info', 'error', 'warn']);
  let searchTerm = '';

  function setStatus(ok) {
    statusDot.classList.toggle('off', !ok);
    connEl.textContent = ok ? 'connected' : 'disconnected';
  }

  function applyFilter(list) {
    const t = searchTerm.toLowerCase();
    return list.filter(e => {
      if (!activeLevels.has(e.level)) return false;
      if (t && !e.message.toLowerCase().includes(t)) return false;
      return true;
    });
  }

  function render() {
    const filtered = applyFilter(entries);
    totalCountEl.textContent = entries.length;
    shownCountEl.textContent = filtered.length;

    if (filtered.length === 0) {
      logList.innerHTML = '<div class="empty">No log entries match the current filter.</div>';
      return;
    }
    // Render only the last 200 to keep DOM small
    const slice = filtered.slice(-200);
    const html = slice.map(e => {
      const lvl = (e.level || 'info').toLowerCase();
      const safeMsg = String(e.message).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      return '<div class="entry">' +
        '<span class="id">#' + e.id + '</span>' +
        '<span class="time">' + e.time + '</span>' +
        '<span class="lvl ' + lvl + '">' + lvl + '</span>' +
        '<span class="msg">' + safeMsg + '</span>' +
        '</div>';
    }).join('');
    logList.innerHTML = html;
    if (autoscroll) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    }
  }

  async function poll() {
    try {
      const res = await fetch('/logs/json?since=' + lastId, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setStatus(true);
      let added = 0;
      for (const e of data) {
        if (!seenIds.has(e.id)) {
          seenIds.add(e.id);
          entries.push(e);
          if (e.id > lastId) lastId = e.id;
          added++;
        }
      }
      if (added > 0) {
        lastUpdateEl.textContent = new Date().toLocaleTimeString();
        render();
      } else {
        lastUpdateEl.textContent = new Date().toLocaleTimeString();
      }
    } catch (err) {
      setStatus(false);
      connEl.textContent = 'error: ' + err.message;
    }
  }

  filtersEl.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const lvl = chip.dataset.level;
    const allOn = activeLevels.has('info') && activeLevels.has('error') && activeLevels.has('warn');
    if (lvl === 'all') {
      if (allOn) {
        activeLevels.clear();
      } else {
        activeLevels.add('info'); activeLevels.add('error'); activeLevels.add('warn');
      }
    } else {
      if (activeLevels.has(lvl)) activeLevels.delete(lvl); else activeLevels.add(lvl);
    }
    // If none active, fall back to all so the user doesn't see a blank screen
    if (activeLevels.size === 0) {
      activeLevels.add('info'); activeLevels.add('error'); activeLevels.add('warn');
    }
    const nowAllOn = activeLevels.has('info') && activeLevels.has('error') && activeLevels.has('warn');
    [...filtersEl.querySelectorAll('.chip')].forEach(c => {
      const k = c.dataset.level;
      c.classList.toggle('active', k === 'all' ? nowAllOn : activeLevels.has(k));
    });
    render();
  });

  searchEl.addEventListener('input', () => {
    searchTerm = searchEl.value;
    render();
  });

  autoscrollBtn.addEventListener('click', () => {
    autoscroll = !autoscroll;
    autoscrollBtn.textContent = 'Auto-scroll: ' + (autoscroll ? 'ON' : 'OFF');
  });

  clearBtn.addEventListener('click', () => {
    entries.length = 0;
    seenIds.clear();
    lastId = 0;
    render();
  });

  poll();
  setInterval(poll, 1000);
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// ADB helpers
// ---------------------------------------------------------------------------

// Returns a Promise<number> of authorized, connected devices.
function getConnectedDeviceCount() {
  return new Promise((resolve) => {
    exec('adb devices', (error, stdout) => {
      if (error) return resolve(0);
      const lines = stdout.split('\n').slice(1); // drop "List of devices attached"
      const count = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && trimmed.endsWith('\tdevice');
      }).length;
      resolve(count);
    });
  });
}

// Validates the sound path looks sane and actually exists on the phone.
function validateSoundPath(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !/\.(mp3|wav)$/i.test(filePath)) {
      return resolve(false);
    }
    exec(`adb shell "[ -f '${filePath}' ] && echo EXISTS || echo MISSING"`, (error, stdout) => {
      if (error) return resolve(false);
      resolve(stdout.trim() === 'EXISTS');
    });
  });
}

function runAdbCommand(command) {
  return new Promise((resolve, reject) => {
    exec(`adb ${command}`, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core playback logic
// ---------------------------------------------------------------------------
async function playSound(routeName, res) {
  const route = ROUTES[routeName];
  if (!route) return sendError(res, routeName, ERR.BAD_PATH);

  if (!routeState[routeName]) routeState[routeName] = { playing: false };
  const state = routeState[routeName];

  // 1. Device check
  const deviceCount = await getConnectedDeviceCount();
  if (deviceCount !== 1) {
    return sendError(res, routeName, ERR.DEVICE_COUNT);
  }

  // 2. Path check
  const pathOk = await validateSoundPath(route.filePath);
  if (!pathOk) {
    return sendError(res, routeName, ERR.BAD_PATH);
  }

  // 3. If this route is already "active" (played previously and not reset),
  //    auto-reset: keyevent 4, wait 200ms, then replay.
  if (state.playing) {
    try {
      await runAdbCommand('shell input keyevent 4');
    } catch (e) {
      return sendError(res, routeName, ERR.NEEDS_RESET);
    }
    await sleep(200);
  }

  // 4. Play the sound
  try {
    await runAdbCommand(
      `shell am start -a android.intent.action.VIEW -d "file://${route.filePath}" -t "${route.mimeType}"`
    );
  } catch (e) {
    return sendError(res, routeName, ERR.NEEDS_RESET);
  }

  state.playing = true;
  lastPlayedRoute = routeName;
  sendSuccess(res, routeName);
}

// ---------------------------------------------------------------------------
// Boot screen
// ---------------------------------------------------------------------------
function getImageInfo(filename) {
  const filePath = path.join(__dirname, filename);
  const exists = fs.existsSync(filePath);
  console.log(`Checking ${filename}: exists=${exists}, path=${filePath}`);

  if (!exists) return null;

  try {
    const dimensions = sizeOf(fs.readFileSync(filePath));
    const stats = fs.statSync(filePath);
    return {
      width: dimensions.width,
      height: dimensions.height,
      sizeKB: (stats.size / 1024).toFixed(1)
    };
  } catch (e) {
    console.log(`Error reading ${filename}:`, e.message);
    return null;
  }
}

async function printBootScreen() {
  process.stdout.write('\x1Bc');

  const terminalImage = (await import('terminal-image')).default;

  console.log(
    chalk.cyanBright(
      figlet.textSync('VR ADB SERVER', { font: 'Standard' })
    )
  );

  console.log(chalk.gray('-'.repeat(60)));

  const logoPath = path.join(__dirname, 'logo.png');
  const bannerPath = path.join(__dirname, 'banner.png');

  if (fs.existsSync(bannerPath)) {
    console.log(await terminalImage.file(bannerPath, { width: 60 }));
  } else {
    console.log(chalk.yellow('  banner.png not found'));
  }

  if (fs.existsSync(logoPath)) {
    console.log(await terminalImage.file(logoPath, { width: 20 }));
  } else {
    console.log(chalk.yellow('  logo.png not found'));
  }

  console.log(chalk.gray('-'.repeat(60)));
  console.log(chalk.white('  Status  ') + chalk.greenBright('* ONLINE'));
  console.log(chalk.white('  Port    ') + chalk.cyan(PORT));
  console.log(chalk.white('  Time    ') + chalk.cyan(new Date().toLocaleString()));
  console.log(chalk.gray('-'.repeat(60)) + '\n');
}

// ---------------------------------------------------------------------------
// Legacy raw ADB trigger (kept for manual use / debugging)
// ---------------------------------------------------------------------------
function runAdb(command, res) {
  exec(`adb ${command}`, (error, stdout, stderr) => {
    if (error) {
      const message = `[Source Engine]: ADB error - ${error.message}`;
      console.error(chalk.red(message));
      pushLog('error', message);
      return res.status(500).send(message);
    }
    const message = `[Source Engine]: ADB output - ${stdout || 'OK'}`;
    console.log(chalk.green(message));
    pushLog('info', message);
    res.status(200).send(stdout || 'OK');
  });
}

app.get('/trigger-adb', async (req, res) => {
  try {
    await runAdbCommand('shell input keyevent 4');
    if (lastPlayedRoute && ROUTES[lastPlayedRoute]) {
      routeState[lastPlayedRoute] = { playing: false };
      const message = `[Source Engine]: ADB keyevent 4 sent; route ${lastPlayedRoute} reset`;
      console.log(chalk.green(message));
      pushLog('info', message);
      res.status(200).type('text/plain').send(message);
    } else {
      const message = `[Source Engine]: ADB keyevent 4 sent (no route to reset)`;
      console.log(chalk.green(message));
      pushLog('info', message);
      res.status(200).type('text/plain').send(message);
    }
  } catch (e) {
    const message = `[Source Engine]: ADB error - ${e.message}`;
    console.error(chalk.red(message));
    pushLog('error', message);
    res.status(500).type('text/plain').send(message);
  }
});

// Reset a route's "active" state manually without playing (e.g. for cleanup).
app.get('/reset/:route', async (req, res) => {
  const routeName = req.params.route;
  if (!ROUTES[routeName]) return sendError(res, routeName, ERR.BAD_PATH);
  try {
    await runAdbCommand('shell input keyevent 4');
    routeState[routeName] = { playing: false };
    const message = `[Source Engine]: Route ${routeName} has been reset`;
    pushLog('info', message);
    res.status(200).type('text/plain').send(message);
  } catch (e) {
    sendError(res, routeName, ERR.NEEDS_RESET);
  }
});

// ---------------------------------------------------------------------------
// GET /logs?since=<id>  -> returns log entries newer than <id> as JSON.
// The overlay app polls this repeatedly, passing the last id it saw so it
// only receives new lines each time. since=0 (or omitted) returns everything
// currently buffered (up to MAX_LOG_ENTRIES).
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /logs?since=<id>  -> returns log entries newer than <id> as JSON.
// The overlay app polls this repeatedly, passing the last id it saw so it
// only receives new lines each time. since=0 (or omitted) returns everything
// currently buffered (up to MAX_LOG_ENTRIES).
// ---------------------------------------------------------------------------
app.get('/logs', (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  const entries = LOG_BUFFER.filter(entry => entry.id > since);
  res.status(200).json(entries);
});

// Pretty web UI for browsing the log buffer in a browser. Polls /logs/json
// and renders entries live, with filtering, auto-scroll, and a level colour
// key. Open http://<this-pc>:3000/logs/view in a browser.
app.get('/logs/view', (req, res) => {
  res.type('html').send(LOGS_PAGE_HTML);
});

app.get('/logs/json', (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  const entries = LOG_BUFFER.filter(entry => entry.id > since);
  res.status(200).json(entries);
});

// ---------------------------------------------------------------------------
// GET or POST /add-log  -> manually push a log entry, for testing the HUD
// without triggering a real ADB sound. Query params (GET, easy for curl):
//   /add-log?message=Hello&level=info
// Or JSON body (POST): { "message": "Hello", "level": "info" }
// ---------------------------------------------------------------------------
function addLogHandler(req, res) {
  const source = req.method === 'GET' ? req.query : (req.body || {});
  const message = typeof source.message === 'string' ? source.message.trim() : '';
  const level = typeof source.level === 'string' && source.level.trim() !== ''
    ? source.level.trim()
    : 'info';

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const entry = pushLog(level, message);
  res.status(200).json(entry);
}

app.get('/add-log', addLogHandler);
app.post('/add-log', addLogHandler);

// Health check, handy for confirming the Quest can reach this PC at all.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', logCount: LOG_BUFFER.length, nextId: logIdCounter + 1 });
});

// Generic route endpoint, e.g. /play/left-grip
app.get('/play/:route', (req, res) => {
  playSound(req.params.route, res);
});

// ---------------------------------------------------------------------------
// Soundboard routes
// ---------------------------------------------------------------------------

// Copy Paste to make new route only change /example_change and playsound('example_change', res);
app.get('/left-grip', (req, res) => { playSound('left-grip', res); });
app.get('/slot2', (req, res) => { playSound('slot2', res); });

app.listen(PORT, '0.0.0.0', async () => {
  await printBootScreen();
});
