// PCC — Proxmox Command Center backend
// Example .env:
//   PORT=3000
//   JWT_SECRET=change-this-to-a-random-64-char-string
//   DB_PATH=/opt/pcc/data/pcc.db
//   ADMIN_PASSWORD=changeme

'use strict';

require('dotenv').config({ path: '/opt/pcc/.env' });

const express  = require('express');
const Database = require('better-sqlite3');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const https    = require('https');
const http     = require('http');
const path     = require('path');
const url      = require('url');
const net      = require('net');

const PORT       = parseInt(process.env.PORT || '3000');
const JWT_SECRET = process.env.JWT_SECRET;
const DB_PATH    = process.env.DB_PATH || '/opt/pcc/data/pcc.db';

if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set in /opt/pcc/.env'); process.exit(1); }

// ── DATABASE ──────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    last_login    INTEGER
  );

  CREATE TABLE IF NOT EXISTS clusters (
    id         TEXT PRIMARY KEY,
    name       TEXT    NOT NULL,
    host       TEXT    NOT NULL,
    auth_type  TEXT    NOT NULL DEFAULT 'token',
    auth_value TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS shared_state (
    key        TEXT PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_by TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL DEFAULT (unixepoch()),
    username   TEXT    NOT NULL,
    method     TEXT    NOT NULL,
    path       TEXT    NOT NULL,
    cluster_id TEXT,
    status     INTEGER,
    detail     TEXT
  );
`);

// Seed default admin on first run
if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
  const pw   = process.env.ADMIN_PASSWORD || 'changeme';
  const hash = bcrypt.hashSync(pw, 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)').run('admin', hash, 'admin');
  console.log('Created default admin user — change your password on first login.');
}

// ── HELPERS ───────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

const auditInsert = db.prepare(
  'INSERT INTO audit_log (username, method, path, cluster_id, status, detail) VALUES (?,?,?,?,?,?)'
);
function audit(username, method, p, clusterId, status, detail) {
  try {
    auditInsert.run(username, method, p, clusterId || null, status || 0,
      detail ? JSON.stringify(detail) : null);
  } catch { /* non-fatal */ }
}

function sanitiseBody(body) {
  if (!body || typeof body !== 'object') return null;
  const s = { ...body };
  for (const k of ['password', 'passwd', 'secret', 'token', 'auth_value']) {
    if (s[k]) s[k] = '***';
  }
  return s;
}

// ── APP ───────────────────────────────────────────────────

const app = express();

// Body parsers applied only to non-proxy routes so the proxy can stream raw bodies
const parseJson = express.json();
const parseForm = express.urlencoded({ extended: true });
function bodyParser(req, res, next) { parseJson(req, res, () => parseForm(req, res, next)); }

// ── AUTH ──────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

app.post('/api/auth/login', bodyParser, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });

  db.prepare('UPDATE users SET last_login = unixepoch() WHERE id = ?').run(user.id);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  audit(username, 'POST', '/api/auth/login', null, 200, null);
  res.json({ token, username: user.username, role: user.role });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.post('/api/auth/change-password', authMiddleware, bodyParser, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both currentPassword and newPassword required' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.user.id);
  audit(req.user.username, 'POST', '/api/auth/change-password', null, 200, null);
  res.json({ ok: true });
});

// ── USERS (admin) ─────────────────────────────────────────

app.get('/api/users', authMiddleware, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id, username, role, created_at, last_login FROM users ORDER BY id').all());
});

app.post('/api/users', authMiddleware, adminOnly, bodyParser, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)')
      .run(username, bcrypt.hashSync(password, 10), ['admin', 'user'].includes(role) ? role : 'user');
    audit(req.user.username, 'POST', '/api/users', null, 200, { username, role });
    res.status(201).json({ id: r.lastInsertRowid, username, role: role || 'user' });
  } catch {
    res.status(409).json({ error: 'Username already exists' });
  }
});

app.put('/api/users/:id', authMiddleware, adminOnly, bodyParser, (req, res) => {
  const { role, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (role && ['admin', 'user'].includes(role))
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), req.params.id);
  }
  audit(req.user.username, 'PUT', '/api/users/' + req.params.id, null, 200, { role });
  res.json({ ok: true });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, (req, res) => {
  if (String(req.params.id) === String(req.user.id))
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'User not found' });
  audit(req.user.username, 'DELETE', '/api/users/' + req.params.id, null, 200, null);
  res.json({ ok: true });
});

// ── CLUSTERS ──────────────────────────────────────────────

app.get('/api/clusters', authMiddleware, (req, res) => {
  // auth_value intentionally omitted from list (sensitive)
  res.json(db.prepare(
    'SELECT id, name, host, auth_type, sort_order, created_at FROM clusters ORDER BY sort_order, name'
  ).all());
});

app.post('/api/clusters', authMiddleware, adminOnly, bodyParser, (req, res) => {
  const { name, host, auth_type, auth_value, sort_order } = req.body || {};
  if (!name || !host || !auth_value)
    return res.status(400).json({ error: 'name, host and auth_value are required' });
  const id = 'cluster-' + Date.now();
  db.prepare('INSERT INTO clusters (id, name, host, auth_type, auth_value, sort_order) VALUES (?,?,?,?,?,?)')
    .run(id, name.trim(), host.trim().replace(/\/$/, ''), auth_type || 'token', auth_value.trim(), parseInt(sort_order) || 0);
  audit(req.user.username, 'POST', '/api/clusters', id, 200, { name, host });
  res.status(201).json({ id, name, host, auth_type: auth_type || 'token' });
});

app.put('/api/clusters/:id', authMiddleware, adminOnly, bodyParser, (req, res) => {
  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id);
  if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
  const { name, host, auth_type, auth_value, sort_order } = req.body || {};
  db.prepare(`UPDATE clusters SET
    name       = COALESCE(?, name),
    host       = COALESCE(?, host),
    auth_type  = COALESCE(?, auth_type),
    auth_value = COALESCE(?, auth_value),
    sort_order = COALESCE(?, sort_order)
    WHERE id = ?`
  ).run(name || null, host || null, auth_type || null, auth_value || null,
    sort_order != null ? parseInt(sort_order) : null, req.params.id);
  audit(req.user.username, 'PUT', '/api/clusters/' + req.params.id, req.params.id, 200, { name, host });
  res.json({ ok: true });
});

app.delete('/api/clusters/:id', authMiddleware, adminOnly, (req, res) => {
  const r = db.prepare('DELETE FROM clusters WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Cluster not found' });
  audit(req.user.username, 'DELETE', '/api/clusters/' + req.params.id, req.params.id, 200, null);
  res.json({ ok: true });
});

// ── SHARED STATE ──────────────────────────────────────────

app.get('/api/shared/:key', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT value FROM shared_state WHERE key = ?').get(req.params.key);
  res.json({ value: row ? row.value : null });
});

app.put('/api/shared/:key', authMiddleware, bodyParser, (req, res) => {
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value required' });
  db.prepare('INSERT OR REPLACE INTO shared_state (key, value, updated_at, updated_by) VALUES (?,?,unixepoch(),?)')
    .run(req.params.key, value, req.user.username);
  res.json({ ok: true });
});

// ── AUDIT LOG ─────────────────────────────────────────────

app.get('/api/audit', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit));
});

// ── PROXY TO PROXMOX ──────────────────────────────────────
// Streams raw request body — handles both form data and large ISO uploads.
// Auth headers are injected server-side; the browser only needs a PCC JWT.

app.all('/proxy/:clusterId/*', authMiddleware, (req, res) => {
  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.clusterId);
  if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

  let targetUrl;
  try { targetUrl = new URL(cluster.host); } catch {
    return res.status(500).json({ error: 'Cluster has an invalid host URL' });
  }

  const targetPath = '/' + (req.params[0] || '');
  const search     = req._parsedUrl?.search || '';
  const isHttps    = targetUrl.protocol === 'https:';
  const transport  = isHttps ? https : http;

  // Forward safe headers, replace auth
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const kl = k.toLowerCase();
    if (['host', 'authorization', 'cookie'].includes(kl)) continue;
    headers[k] = v;
  }
  if (cluster.auth_type === 'token') {
    headers['Authorization'] = cluster.auth_value;
  }

  // Audit write operations (best-effort, body not yet consumed)
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    audit(req.user.username, req.method, targetPath, cluster.id, 0, null);
  }

  const options = {
    hostname: targetUrl.hostname,
    port:     parseInt(targetUrl.port) || (isHttps ? 443 : 80),
    path:     targetPath + search,
    method:   req.method,
    headers,
    rejectUnauthorized: false,  // PVE uses self-signed certs on LAN/WireGuard
  };

  const proxyReq = transport.request(options, proxyRes => {
    const outHeaders = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (k.toLowerCase() !== 'transfer-encoding') outHeaders[k] = v;
    }
    res.writeHead(proxyRes.statusCode, outHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error: 'Cannot reach cluster: ' + err.message });
  });

  req.pipe(proxyReq);  // stream body directly — works for both form data and file uploads
});

// ── STATIC + SPA ─────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── SERVER + WEBSOCKET VNC PROXY ──────────────────────────
// Proxies VNC WebSocket connections from console.html to each cluster.
// URL: /vnc-ws/:clusterId/:node/:ep/:vmid?port=N&vncticket=T&token=JWT

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = new url.URL(req.url, 'http://localhost');
  const match = parsedUrl.pathname.match(/^\/vnc-ws\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) { socket.destroy(); return; }

  const [, clusterId, node, ep, vmid] = match;
  const port      = parsedUrl.searchParams.get('port');
  const ticket    = parsedUrl.searchParams.get('vncticket');
  const pccToken  = parsedUrl.searchParams.get('token');

  // Verify PCC JWT
  try { jwt.verify(pccToken, JWT_SECRET); } catch { socket.destroy(); return; }

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(clusterId);
  if (!cluster || !port || !ticket) { socket.destroy(); return; }

  // Build target WebSocket URL on the PVE host
  let targetUrl;
  try { targetUrl = new url.URL(cluster.host); } catch { socket.destroy(); return; }

  const isHttps  = targetUrl.protocol === 'https:';
  const tPort    = parseInt(targetUrl.port) || (isHttps ? 443 : 80);
  const tHost    = targetUrl.hostname;
  const wsPath   = `/api2/json/nodes/${node}/${ep}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;

  // Build the HTTP Upgrade request to send to PVE
  const reqHeaders = [
    `GET ${wsPath} HTTP/1.1`,
    `Host: ${tHost}:${tPort}`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || 'dGhlIHNhbXBsZSBub25jZQ=='}`,
    `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
    `Authorization: ${cluster.auth_value}`,
    '',
    ''
  ].join('\r\n');

  // Open TCP (or TLS) connection to PVE
  let tSocket;
  if (isHttps) {
    const tls = require('tls');
    tSocket = tls.connect({ host: tHost, port: tPort, rejectUnauthorized: false }, () => {
      tSocket.write(reqHeaders);
    });
  } else {
    tSocket = net.createConnection({ host: tHost, port: tPort }, () => {
      tSocket.write(reqHeaders);
    });
  }

  let handshakeDone = false;
  let buf = Buffer.alloc(0);

  tSocket.on('data', chunk => {
    if (handshakeDone) {
      socket.write(chunk);
      return;
    }
    buf = Buffer.concat([buf, chunk]);
    const sep = buf.indexOf('\r\n\r\n');
    if (sep === -1) return;
    // Consume the HTTP 101 response headers, then pipe raw
    handshakeDone = true;
    const statusLine = buf.slice(0, buf.indexOf('\r\n')).toString();
    if (!statusLine.includes('101')) {
      socket.destroy();
      tSocket.destroy();
      return;
    }
    // Send 101 upgrade response back to browser
    const upgradeResp = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${require('crypto').createHash('sha1')
        .update((req.headers['sec-websocket-key'] || '') + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')}`,
      '',
      ''
    ].join('\r\n');
    socket.write(upgradeResp);
    // Pipe any remaining data after the header boundary
    const rest = buf.slice(sep + 4);
    if (rest.length) socket.write(rest);
  });

  // Bidirectional pipe after handshake
  socket.on('data', chunk => { if (tSocket.writable) tSocket.write(chunk); });
  tSocket.on('end', () => socket.destroy());
  socket.on('end', () => tSocket.destroy());
  tSocket.on('error', () => socket.destroy());
  socket.on('error', () => tSocket.destroy());
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`PCC backend running on http://127.0.0.1:${PORT}`)
);

// ── Backend schedule runner ───────────────────────────────
// Checks pve-schedules every 60s and executes due jobs via the
// cluster proxy — runs 24/7 regardless of browser state.

function schedNextRun(s) {
  const now  = new Date();
  const [h, m] = (s.time || '00:00').split(':').map(Number);
  if (s.schedType === 'daily') {
    const next = new Date(now); next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (s.schedType === 'weekly') {
    const days = s.days?.length ? s.days : [1];
    for (let i = 0; i < 8; i++) {
      const next = new Date(now); next.setDate(next.getDate() + i); next.setHours(h, m, 0, 0);
      if (days.includes(next.getDay()) && next > now) return next.getTime();
    }
  }
  if (s.schedType === 'hourly') {
    const min = parseInt(s.minute || 0);
    const next = new Date(now); next.setMinutes(min, 0, 0);
    if (next <= now) next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  return null;
}

async function runScheduledAction(s, cluster) {
  const targetUrl = new url.URL(cluster.host);
  const isHttps   = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const ep        = (s.vmType === 'lxc' || s.vmType === 'ct') ? 'lxc' : 'qemu';
  const { node, vmid, action } = s;

  const apiPost = (path, body) => new Promise((resolve, reject) => {
    const bodyStr = Object.entries(body).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const opts = {
      hostname: targetUrl.hostname, port: parseInt(targetUrl.port) || (isHttps ? 443 : 80),
      path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': cluster.auth_value, 'Content-Length': Buffer.byteLength(bodyStr) },
      rejectUnauthorized: false,
    };
    const req = transport.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
    });
    req.on('error', reject);
    req.write(bodyStr); req.end();
  });

  switch (action) {
    case 'start':    await apiPost(`/api2/json/nodes/${node}/${ep}/${vmid}/status/start`, {}); break;
    case 'stop':     await apiPost(`/api2/json/nodes/${node}/${ep}/${vmid}/status/stop`, {}); break;
    case 'shutdown': await apiPost(`/api2/json/nodes/${node}/${ep}/${vmid}/status/shutdown`, {}); break;
    case 'reboot':   await apiPost(`/api2/json/nodes/${node}/${ep}/${vmid}/status/reboot`, {}); break;
    case 'backup': {
      const o = s.options || {};
      await apiPost(`/api2/json/nodes/${node}/vzdump`, { vmid, compress: o.compress || 'zstd', mode: 'snapshot', ...(o.storage?{storage:o.storage}:{}) });
      break;
    }
    case 'snapshot': {
      const o = s.options || {};
      const snapname = (o.snapname || 'auto{date}').replace(/\{date\}/g, new Date().toISOString().slice(0,10).replace(/-/g,''));
      await apiPost(`/api2/json/nodes/${node}/${ep}/${vmid}/snapshot`, { snapname, description: o.description || 'Scheduled snapshot' });
      break;
    }
  }
}

async function backendScheduleTick() {
  const row = db.prepare("SELECT value FROM shared_state WHERE key = 'pve-schedules'").get();
  if (!row) return;
  let schedules;
  try { schedules = JSON.parse(row.value); } catch { return; }
  if (!Array.isArray(schedules)) return;

  const now = Date.now();
  let changed = false;

  for (const s of schedules) {
    if (!s.enabled || !s.nextRun || now < s.nextRun) continue;
    const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(s.connId || (db.prepare('SELECT id FROM clusters ORDER BY sort_order LIMIT 1').get()?.id));
    if (!cluster) { s.nextRun = schedNextRun(s); changed = true; continue; }
    try {
      await runScheduledAction(s, cluster);
      console.log(`Schedule executed: ${s.action} on ${s.vmType}/${s.vmid} (${s.name})`);
    } catch(e) {
      console.error(`Schedule failed: ${s.name} — ${e.message}`);
    }
    s.lastRun = now;
    s.nextRun = schedNextRun(s);
    changed = true;
  }

  if (changed) {
    db.prepare("INSERT OR REPLACE INTO shared_state (key, value, updated_at, updated_by) VALUES ('pve-schedules', ?, unixepoch(), 'scheduler')")
      .run(JSON.stringify(schedules));
  }
}

setInterval(() => { backendScheduleTick().catch(e => console.error('Schedule tick error:', e)); }, 60000);
backendScheduleTick().catch(() => {}); // run once on startup
