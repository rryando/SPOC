const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== Configuration ==========

const PORT = process.env.SPOC_DASHBOARD_PORT || 7777;
const HOST = process.env.SPOC_DASHBOARD_HOST || '127.0.0.1';
const URL_HOST = process.env.SPOC_DASHBOARD_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const OWNER_PID = process.env.SPOC_DASHBOARD_OWNER_PID ? Number(process.env.SPOC_DASHBOARD_OWNER_PID) : null;

// Safe identifier pattern: alphanumeric + dash only (no path separators, dots, etc.)
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

function getSpocDataDir() {
  const envDir = process.env.SPOC_DATA_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), '.spoc');
}

/**
 * Validates a user-supplied slug or plan ID to prevent path traversal.
 * Returns the sanitized value or null if invalid.
 */
function validateId(value) {
  if (!value || typeof value !== 'string') return null;
  if (!SAFE_ID_PATTERN.test(value)) return null;
  if (value.length > 128) return null;
  return value;
}

/**
 * Resolves a path and verifies it's within the SPOC data directory.
 * Returns null if the resolved path escapes the safe root.
 */
function safePath(dataDir, ...segments) {
  const resolved = path.resolve(dataDir, ...segments);
  const normalizedRoot = path.resolve(dataDir) + path.sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(dataDir)) {
    return null;
  }
  return resolved;
}

// ========== Activity Tracking ==========

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
let lastActivity = Date.now();

function touchActivity() {
  lastActivity = Date.now();
}

// ========== SSE Clients ==========

const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  }
}

// ========== File Watching ==========

let debounceTimer = null;
let watcher = null;
let watcherRetryCount = 0;
const MAX_WATCHER_RETRIES = 5;

function startWatching() {
  const dataDir = getSpocDataDir();
  if (!fs.existsSync(dataDir)) return;

  try {
    watcher = fs.watch(dataDir, { recursive: true }, (_eventType, _filename) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        broadcastSSE({ type: 'update' });
      }, 200);
    });
    watcher.on('error', (err) => {
      console.error(JSON.stringify({ type: 'watcher-error', message: err.message }));
      watcher.close();
      watcher = null;
      if (watcherRetryCount < MAX_WATCHER_RETRIES) {
        watcherRetryCount++;
        const delay = Math.min(1000 * Math.pow(2, watcherRetryCount), 30000);
        setTimeout(startWatching, delay);
      } else {
        console.error(JSON.stringify({ type: 'watcher-failed', message: 'max retries reached, file watching disabled' }));
      }
    });
    watcherRetryCount = 0; // reset on successful start
  } catch (e) {
    console.error(JSON.stringify({ type: 'watcher-start-failed', message: e.message }));
  }
}

// ========== API Handlers ==========

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function handleApiProjects(_req, res) {
  const dataDir = getSpocDataDir();
  const meta = readJsonFile(path.join(dataDir, 'meta.json'));
  if (!meta || !meta.projects) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('[]');
    return;
  }
  const projects = meta.projects.map(p => ({
    slug: p.id || p.slug,
    name: p.name,
    status: p.status
  }));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(projects));
}

function handleApiPlans(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const slug = validateId(parsed.searchParams.get('slug'));
  if (!slug) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'valid slug parameter required (alphanumeric and dashes only)' }));
    return;
  }
  const dataDir = getSpocDataDir();
  const indexPath = safePath(dataDir, 'projects', slug, 'plans', 'index.json');
  if (!indexPath) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'invalid path' }));
    return;
  }
  const index = readJsonFile(indexPath);
  if (!index || !index.plans) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('[]');
    return;
  }
  const plans = index.plans.map(p => ({
    id: p.id, title: p.title, status: p.status,
    summary: p.summary, keywords: p.keywords,
    updatedAt: p.updatedAt, createdAt: p.createdAt
  }));
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(plans));
}

function handleApiPlan(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const slug = validateId(parsed.searchParams.get('slug'));
  const planId = validateId(parsed.searchParams.get('id'));
  if (!slug || !planId) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'valid slug and id parameters required (alphanumeric and dashes only)' }));
    return;
  }
  const dataDir = getSpocDataDir();
  const indexPath = safePath(dataDir, 'projects', slug, 'plans', 'index.json');
  if (!indexPath) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'invalid path' }));
    return;
  }
  const index = readJsonFile(indexPath);
  if (!index || !index.plans) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'plan not found' }));
    return;
  }
  const planMeta = index.plans.find(p => p.id === planId);
  if (!planMeta) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'plan not found' }));
    return;
  }
  let body = '';
  const bodyPath = safePath(dataDir, 'projects', slug, 'plans', planId + '.md');
  if (bodyPath) {
    try { body = fs.readFileSync(bodyPath, 'utf-8'); } catch (e) {}
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ meta: planMeta, body }));
}

function handleApiTasks(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const slug = validateId(parsed.searchParams.get('slug'));
  if (!slug) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'valid slug parameter required (alphanumeric and dashes only)' }));
    return;
  }
  const dataDir = getSpocDataDir();
  const tasksPath = safePath(dataDir, 'projects', slug, 'tasks.md');
  let content = '';
  if (tasksPath) {
    try { content = fs.readFileSync(tasksPath, 'utf-8'); } catch (e) {}
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ content }));
}

function handleEvents(_req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': connected\n\n');
  sseClients.add(res);

  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (e) { clearInterval(keepalive); sseClients.delete(res); }
  }, 30000);

  res.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
}

// ========== HTTP Request Handler ==========

function handleRequest(req, res) {
  touchActivity();

  try {
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname;

    if (req.method === 'GET' && pathname === '/') {
      const indexPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(fs.readFileSync(indexPath, 'utf-8'));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('<html><body><h1>SPOC Dashboard</h1><p>index.html not found</p></body></html>');
      }
    } else if (req.method === 'GET' && pathname === '/api/projects') {
      handleApiProjects(req, res);
    } else if (req.method === 'GET' && pathname === '/api/plans') {
      handleApiPlans(req, res);
    } else if (req.method === 'GET' && pathname === '/api/plan') {
      handleApiPlan(req, res);
    } else if (req.method === 'GET' && pathname === '/api/tasks') {
      handleApiTasks(req, res);
    } else if (req.method === 'GET' && pathname === '/events') {
      handleEvents(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ========== Server Startup ==========

function startServer() {
  const dataDir = getSpocDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const server = http.createServer(handleRequest);

  startWatching();

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(dataDir, '.dashboard-info');
    try { fs.unlinkSync(infoFile); } catch (e) {}
    if (watcher) watcher.close();
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(lifecycleCheck);
    server.close(() => process.exit(0));
  }

  function ownerAlive() {
    if (!OWNER_PID) return true;
    try { process.kill(OWNER_PID, 0); return true; } catch (e) { return false; }
  }

  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, 60 * 1000);
  lifecycleCheck.unref();

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(PORT, HOST, () => {
    const info = {
      type: 'server-started',
      port: Number(PORT),
      url: 'http://' + URL_HOST + ':' + PORT,
      pid: process.pid,
      startedAt: new Date().toISOString()
    };
    console.log(JSON.stringify(info));
    fs.writeFileSync(path.join(dataDir, '.dashboard-info'), JSON.stringify({
      url: info.url, port: info.port, pid: info.pid, startedAt: info.startedAt
    }));
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
