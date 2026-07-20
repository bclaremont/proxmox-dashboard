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
const crypto   = require('crypto');

const PORT       = parseInt(process.env.PORT || '3000');
const JWT_SECRET = process.env.JWT_SECRET;
const DB_PATH    = process.env.DB_PATH || '/opt/pcc/data/pcc.db';

if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set in /opt/pcc/.env'); process.exit(1); }
if (JWT_SECRET.length < 32) { console.error('FATAL: JWT_SECRET must be at least 32 characters'); process.exit(1); }

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

  CREATE TABLE IF NOT EXISTS login_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL DEFAULT (unixepoch()),
    ip         TEXT    NOT NULL,
    username   TEXT    NOT NULL,
    success    INTEGER NOT NULL DEFAULT 0,
    ua         TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS node_config_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL DEFAULT (unixepoch()),
    cluster_id TEXT    NOT NULL,
    node       TEXT    NOT NULL,
    dns        TEXT,
    timezone   TEXT,
    hosts      TEXT,
    network    TEXT,
    status     TEXT,
    storage    TEXT
  );
`);

// Add columns to existing DBs that pre-date the expanded schema
try { db.exec('ALTER TABLE node_config_snapshots ADD COLUMN status TEXT'); } catch {}
try { db.exec('ALTER TABLE node_config_snapshots ADD COLUMN storage TEXT'); } catch {}

// Seed default admin on first run
if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
  const pw   = process.env.ADMIN_PASSWORD || 'changeme';
  const hash = bcrypt.hashSync(pw, 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)').run('admin', hash, 'admin');
  console.log('Created default admin user — change your password on first login.');
}

// ── ENCRYPTION AT REST ────────────────────────────────────
// Cluster auth_value (Proxmox API tokens) are encrypted in the DB
// using AES-256-GCM with a key derived from JWT_SECRET.
// Stored format: enc:<iv_hex>:<authtag_hex>:<ciphertext_hex>
// Legacy plaintext values are detected by absence of 'enc:' prefix
// and migrated automatically on first startup after this change.

function _encKey() {
  return crypto.createHash('sha256').update(JWT_SECRET).digest();
}

function encryptValue(plaintext) {
  const key     = _encKey();
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptValue(stored) {
  if (!stored || !stored.startsWith('enc:')) return stored; // legacy plaintext passthrough
  const parts = stored.split(':');
  if (parts.length < 4) return stored;
  const [, ivHex, tagHex, ...dataParts] = parts;
  const key     = _encKey();
  const iv      = Buffer.from(ivHex, 'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const data    = Buffer.from(dataParts.join(':'), 'hex'); // rejoin in case data had colons
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

// Migrate any existing plaintext auth_values to encrypted on startup
(function migrateSecrets() {
  const clusters = db.prepare('SELECT id, auth_value FROM clusters').all();
  const upd = db.prepare('UPDATE clusters SET auth_value = ? WHERE id = ?');
  let n = 0;
  for (const c of clusters) {
    if (c.auth_value && !c.auth_value.startsWith('enc:')) {
      upd.run(encryptValue(c.auth_value), c.id);
      n++;
    }
  }
  if (n > 0) console.log(`Encrypted ${n} cluster secret(s) at rest.`);
})();

// ── JWT REVOCATION ────────────────────────────────────────
// In-memory blacklist keyed by JTI (unique token ID).
// Tokens are added on logout; pruned hourly when their expiry passes.
// Survives only for the life of the process — acceptable because
// tokens expire in 4h anyway, and a restart is a natural session boundary.

const _revokedTokens = new Map(); // jti → expiresAt (ms)

setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of _revokedTokens) {
    if (now > exp) _revokedTokens.delete(jti);
  }
}, 60 * 60 * 1000); // prune hourly

// ── CIDR / IP HELPERS ────────────────────────────────────

function _clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const raw = fwd ? fwd.split(',')[0].trim() : (req.socket?.remoteAddress || '');
  return raw.replace(/^::ffff:/i, '');
}

function _ipToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function _ipInCidr(ip, cidr) {
  ip = ip.replace(/^::ffff:/i, '');
  if (!cidr.includes('/')) cidr += '/32';
  const [range, bits] = cidr.split('/');
  const pfx = parseInt(bits);
  if (isNaN(pfx) || pfx < 0 || pfx > 32) return false;
  try {
    const mask = pfx === 0 ? 0 : (~0 << (32 - pfx)) >>> 0;
    return (_ipToInt(ip) & mask) === (_ipToInt(range) & mask);
  } catch { return false; }
}

function getSetting(key, defaultVal = null) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : defaultVal;
  } catch { return defaultVal; }
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, JSON.stringify(value));
}

// ── HELPERS ───────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.jti && _revokedTokens.has(payload.jti))
      return res.status(401).json({ error: 'Session ended — please log in again' });
    req.user = payload;
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

// Block SSRF: cluster hosts must use http/https and must not point at loopback,
// link-local, or unspecified addresses. Admins configure these, but defence-in-depth
// prevents a compromised admin account from using PCC as a pivot to internal services.
const _SSRF_DENY = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^0::/,
  /^169\.254\./,           // link-local
  /^::ffff:/i,             // IPv4-mapped
];
function validateClusterHost(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'Invalid URL'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'Host must use http or https';
  const h = u.hostname;
  if (_SSRF_DENY.some(re => re.test(h))) return `Host '${h}' is not allowed`;
  return null; // ok
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
app.disable('x-powered-by'); // don't reveal Express in response headers

// ── SECURITY HEADERS ──────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  // Strict CSP only on API/proxy routes (JSON responses).
  // The SPA HTML uses inline <script> and <style> tags, so default-src 'none'
  // must not be set on the document response — it would block the entire UI.
  if (req.path.startsWith('/api/') || req.path.startsWith('/proxy/') || req.path.startsWith('/vnc-ws/')) {
    res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  next();
});

// Body parsers applied only to non-proxy routes so the proxy can stream raw bodies
const parseJson = express.json();
const parseForm = express.urlencoded({ extended: true });
function bodyParser(req, res, next) { parseJson(req, res, () => parseForm(req, res, next)); }

// ── IP ALLOWLIST ──────────────────────────────────────────
// Runs before all routes. Empty list = allow all.
// 127.0.0.1 / ::1 always allowed so local access can never be locked out.
app.use((req, res, next) => {
  const allowlist = getSetting('ip_allowlist', []);
  if (!allowlist.length) return next();
  const ip = _clientIp(req);
  if (ip === '127.0.0.1' || ip === '::1' || ip === '') return next();
  if (allowlist.some(cidr => _ipInCidr(ip, cidr))) return next();
  return res.status(403).json({ error: `Access denied — ${ip} is not in the IP allowlist` });
});

// ── LOGIN RATE LIMITER ────────────────────────────────────
// In-memory per-IP counter. Allows 10 attempts per 15-minute window.
// No external dependency — resets on server restart (acceptable for our threat model).

const _loginAttempts  = new Map(); // ip      → { count, resetAt }
const _accountLockout = new Map(); // username → lockedUntil (ms)
const LOGIN_MAX       = 10;
const LOGIN_WINDOW    = 15 * 60 * 1000; // 15 minutes per IP
const LOCKOUT_THRESH  = 10;             // consecutive failures before account lock
const LOCKOUT_WINDOW  = 30 * 60 * 1000; // lock duration: 30 minutes

function loginRateLimit(req, res, next) {
  const ip  = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = _loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW };
    _loginAttempts.set(ip, entry);
  }

  entry.count++;

  if (entry.count > LOGIN_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', retryAfter);
    // Log the block
    audit('__ratelimit__', 'POST', '/api/auth/login', null, 429, { ip, attempts: entry.count });
    return res.status(429).json({ error: `Too many login attempts — try again in ${Math.ceil(retryAfter / 60)} minute(s)` });
  }

  next();
}

// Clean up stale entries every 30 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of _loginAttempts) {
    if (now > e.resetAt) _loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

// ── AUTH ──────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

const loginLogInsert = db.prepare(
  'INSERT INTO login_log (ip, username, success, ua) VALUES (?,?,?,?)'
);
function logLogin(ip, username, success, req) {
  try { loginLogInsert.run(ip, username || '__unknown__', success ? 1 : 0, (req.headers['user-agent']||'').slice(0,120)); } catch {}
}

app.post('/api/auth/login', loginRateLimit, bodyParser, (req, res) => {
  const { username, password } = req.body || {};
  const ip  = _clientIp(req) || 'unknown';
  const now = Date.now();

  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  // Check account lockout (per-username, complements IP rate limit)
  const lockedUntil = _accountLockout.get(username);
  if (lockedUntil && now < lockedUntil) {
    const retryMins = Math.ceil((lockedUntil - now) / 60000);
    audit(username, 'POST', '/api/auth/login', null, 423, { ip, reason: 'account locked', retryMins });
    return res.status(423).json({ error: `Account temporarily locked — try again in ${retryMins} minute(s)` });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    // Track per-account failures for lockout
    const failKey  = `fail:${username}`;
    const failures = (_loginAttempts.get(failKey) || 0) + 1;
    _loginAttempts.set(failKey, failures);
    if (failures >= LOCKOUT_THRESH) {
      _accountLockout.set(username, now + LOCKOUT_WINDOW);
      _loginAttempts.delete(failKey);
      audit(username, 'POST', '/api/auth/login', null, 423, { ip, reason: 'account locked after repeated failures' });
      return res.status(423).json({ error: `Too many failed attempts — account locked for 30 minutes` });
    }
    audit(username || '__unknown__', 'POST', '/api/auth/login', null, 401, { ip, reason: 'invalid credentials', failCount: failures });
    logLogin(ip, username, false, req);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Successful login — clear all failure counters for this user and IP
  _loginAttempts.delete(`fail:${username}`);
  _loginAttempts.delete(ip);
  _accountLockout.delete(username);

  db.prepare('UPDATE users SET last_login = unixepoch() WHERE id = ?').run(user.id);
  const jti   = crypto.randomBytes(16).toString('hex');
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: '4h' }
  );
  audit(username, 'POST', '/api/auth/login', null, 200, { ip });
  logLogin(ip, username, true, req);
  res.json({ token, username: user.username, role: user.role });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// Logout — revokes the current token server-side
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  if (req.user.jti) _revokedTokens.set(req.user.jti, (req.user.exp || 0) * 1000);
  audit(req.user.username, 'POST', '/api/auth/logout', null, 200, null);
  res.json({ ok: true });
});

// Refresh — issues a new 4h token, revokes the old one
app.post('/api/auth/refresh', authMiddleware, (req, res) => {
  if (req.user.jti) _revokedTokens.set(req.user.jti, (req.user.exp || 0) * 1000);
  const jti   = crypto.randomBytes(16).toString('hex');
  const token = jwt.sign(
    { id: req.user.id, username: req.user.username, role: req.user.role, jti },
    JWT_SECRET,
    { expiresIn: '4h' }
  );
  audit(req.user.username, 'POST', '/api/auth/refresh', null, 200, null);
  res.json({ token });
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
  const hostErr = validateClusterHost(host.trim());
  if (hostErr) return res.status(400).json({ error: hostErr });
  const id = 'cluster-' + Date.now();
  db.prepare('INSERT INTO clusters (id, name, host, auth_type, auth_value, sort_order) VALUES (?,?,?,?,?,?)')
    .run(id, name.trim(), host.trim().replace(/\/$/, ''), auth_type || 'token', encryptValue(auth_value.trim()), parseInt(sort_order) || 0);
  audit(req.user.username, 'POST', '/api/clusters', id, 200, { name, host });
  res.status(201).json({ id, name, host, auth_type: auth_type || 'token' });
});

app.put('/api/clusters/:id', authMiddleware, adminOnly, bodyParser, (req, res) => {
  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.id);
  if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
  const { name, host, auth_type, auth_value, sort_order } = req.body || {};
  if (host) {
    const hostErr = validateClusterHost(host.trim());
    if (hostErr) return res.status(400).json({ error: hostErr });
  }
  db.prepare(`UPDATE clusters SET
    name       = COALESCE(?, name),
    host       = COALESCE(?, host),
    auth_type  = COALESCE(?, auth_type),
    auth_value = COALESCE(?, auth_value),
    sort_order = COALESCE(?, sort_order)
    WHERE id = ?`
  ).run(name || null, host || null, auth_type || null,
    auth_value ? encryptValue(auth_value) : null,
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

// Keys that drive privileged actions (scheduler, webhooks, live migration, node config
// changes, cloud-init deploys) are admin-only. A user-role account writing these could
// trigger VM operations or node changes once an admin enforces/applies/deploys them.
const SHARED_ADMIN_KEYS = new Set([
  'pve-schedules', 'pve-webhooks', 'pve-alert-thresholds',
  'pve-affinity-rules', 'pve-drs-settings', 'pve-host-profiles', 'pve-custom-specs',
]);

app.put('/api/shared/:key', authMiddleware, bodyParser, (req, res) => {
  if (SHARED_ADMIN_KEYS.has(req.params.key) && req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admins only' });
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

// ── SECURITY SETTINGS ─────────────────────────────────────

app.get('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } });
  res.json(out);
});

app.put('/api/admin/settings', authMiddleware, adminOnly, bodyParser, (req, res) => {
  const allowed = ['ip_allowlist', 'idle_timeout_mins',
    'digest_enabled','digest_schedule','digest_time','digest_to',
    'smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from',
    'digest_webhook_url',
    'node_snapshot_enabled','node_snapshot_time'];
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!allowed.includes(k)) continue;
      setSetting(k, v);
    }
  });
  tx();
  audit(req.user.username, 'PUT', '/api/admin/settings', null, 200, Object.keys(req.body || {}));
  res.json({ ok: true });
});

app.get('/api/admin/login-log', authMiddleware, adminOnly, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(db.prepare('SELECT * FROM login_log ORDER BY id DESC LIMIT ?').all(limit));
});

app.post('/api/admin/digest/test', authMiddleware, adminOnly, async (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg = {};
  rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; } });
  try {
    await sendDigest(cfg);
    audit(req.user.username, 'POST', '/api/admin/digest/test', null, 200, null);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
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

  // Extract PVE path + query string from originalUrl — strip /proxy/<clusterId> prefix.
  // Using originalUrl avoids relying on req._parsedUrl which may not be populated.
  const pveRelPath = req.originalUrl.replace(/^\/proxy\/[^/]+/, '') || '/';
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
    headers['Authorization'] = decryptValue(cluster.auth_value);
  }

  // Audit write operations (best-effort, body not yet consumed)
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    audit(req.user.username, req.method, pveRelPath, cluster.id, 0, null);
  }

  const options = {
    hostname: targetUrl.hostname,
    port:     parseInt(targetUrl.port) || (isHttps ? 443 : 80),
    path:     pveRelPath,
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
    console.error(`[proxy] ${cluster.id} ${req.method} ${pveRelPath}: ${err.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'Cannot reach cluster — check host connectivity' });
  });

  req.pipe(proxyReq);  // stream body directly — works for both form data and file uploads
});

// ── NODE CONFIG SNAPSHOTS ─────────────────────────────────

app.get('/api/node-snapshots', authMiddleware, adminOnly, (req, res) => {
  const limit   = Math.min(parseInt(req.query.limit) || 200, 1000);
  const cluster = req.query.cluster || null;
  const node    = req.query.node    || null;
  let sql = 'SELECT * FROM node_config_snapshots';
  const params = [];
  const where = [];
  if (cluster) { where.push('cluster_id = ?'); params.push(cluster); }
  if (node)    { where.push('node = ?');       params.push(node); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY ts DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/node-snapshots/capture', authMiddleware, adminOnly, async (req, res) => {
  try {
    const count = await captureAllNodeConfigs();
    res.json({ ok: true, count });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  const port      = parseInt(parsedUrl.searchParams.get('port') || '0', 10);
  const ticket    = parsedUrl.searchParams.get('vncticket') || '';
  const pccToken  = parsedUrl.searchParams.get('token');

  // Strict input validation to prevent CRLF injection into the raw HTTP Upgrade headers.
  const _safeId = /^[a-zA-Z0-9_.-]{1,128}$/;
  if (!_safeId.test(node) || !_safeId.test(ep) || (vmid && !_safeId.test(vmid))) {
    socket.destroy(); return;
  }
  if (!port || port < 1 || port > 65535) { socket.destroy(); return; }
  // vncticket is base64+URL chars; reject anything with CR/LF
  if (/[\r\n]/.test(ticket)) { socket.destroy(); return; }

  // Verify PCC JWT
  try { jwt.verify(pccToken, JWT_SECRET); } catch { socket.destroy(); return; }

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(clusterId);
  if (!cluster || !ticket) { socket.destroy(); return; }

  // Build target WebSocket URL on the PVE host
  let targetUrl;
  try { targetUrl = new url.URL(cluster.host); } catch { socket.destroy(); return; }

  const isHttps  = targetUrl.protocol === 'https:';
  const tPort    = parseInt(targetUrl.port) || (isHttps ? 443 : 80);
  const tHost    = targetUrl.hostname;
  // Node shell uses sentinel ep '__shell'; its Proxmox URL omits ep/vmid segments.
  const wsPath = ep === '__shell'
    ? `/api2/json/nodes/${node}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`
    : `/api2/json/nodes/${node}/${ep}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;

  // Build the HTTP Upgrade request to send to PVE
  const reqHeaders = [
    `GET ${wsPath} HTTP/1.1`,
    `Host: ${tHost}:${tPort}`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Key: ${req.headers['sec-websocket-key'] || 'dGhlIHNhbXBsZSBub25jZQ=='}`,
    `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
    `Authorization: ${decryptValue(cluster.auth_value)}`,
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': decryptValue(cluster.auth_value), 'Content-Length': Buffer.byteLength(bodyStr) },
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

// ── DIGEST ────────────────────────────────────────────────

const nodemailer = (() => { try { return require('nodemailer'); } catch { return null; } })();

function clusterApiGet(cluster, path) {
  return new Promise((resolve, reject) => {
    const targetUrl = new url.URL(cluster.host);
    const isHttps   = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const opts = {
      hostname: targetUrl.hostname, port: parseInt(targetUrl.port) || (isHttps ? 443 : 80),
      path, method: 'GET',
      headers: { Authorization: decryptValue(cluster.auth_value) },
      rejectUnauthorized: false,
    };
    const req = transport.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).data || []); } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function buildDigestData() {
  const clusters = db.prepare('SELECT * FROM clusters ORDER BY sort_order').all();
  const report = { generatedAt: new Date().toISOString(), clusters: [] };

  for (const cluster of clusters) {
    try {
      const nodes = await clusterApiGet(cluster, '/api2/json/nodes');
      const clusterData = { name: cluster.name, host: cluster.host, nodes: [], vms: [], storage: [] };

      await Promise.all(nodes.map(async n => {
        const [status, vms, cts, stor] = await Promise.all([
          clusterApiGet(cluster, `/api2/json/nodes/${n.node}/status`),
          clusterApiGet(cluster, `/api2/json/nodes/${n.node}/qemu`),
          clusterApiGet(cluster, `/api2/json/nodes/${n.node}/lxc`),
          clusterApiGet(cluster, `/api2/json/nodes/${n.node}/storage`),
        ]);
        const s = Array.isArray(status) ? {} : status;
        clusterData.nodes.push({
          node: n.node, online: n.status === 'online',
          cpu: s.cpu ? (s.cpu * 100).toFixed(1) : 0,
          memPct: s.memory ? ((s.memory.used / s.memory.total) * 100).toFixed(1) : 0,
          uptime: s.uptime || 0,
        });
        [...(Array.isArray(vms)?vms:[]), ...(Array.isArray(cts)?cts:[])].forEach(v => {
          clusterData.vms.push({ vmid: v.vmid, name: v.name, status: v.status, node: n.node, uptime: v.uptime || 0 });
        });
        (Array.isArray(stor)?stor:[]).forEach(st => {
          if (st.total && st.used !== undefined) {
            clusterData.storage.push({ storage: st.storage, node: n.node, usedPct: ((st.used/st.total)*100).toFixed(1), total: st.total });
          }
        });
      }));
      report.clusters.push(clusterData);
    } catch { /* skip cluster on error */ }
  }
  return report;
}

function buildDigestHtml(data) {
  const ts = new Date(data.generatedAt).toLocaleString();
  let html = `<html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:20px">
    <h2 style="color:#58a6ff">PCC Digest — ${ts}</h2>`;

  for (const c of data.clusters) {
    const offlineNodes = c.nodes.filter(n => !n.online);
    const stoppedVMs   = c.vms.filter(v => v.status !== 'running');
    const highStorage  = c.storage.filter(s => parseFloat(s.usedPct) > 80);
    const longRunning  = [...c.vms].filter(v=>v.status==='running'&&v.uptime>90*86400)
                          .sort((a,b)=>b.uptime-a.uptime).slice(0,5);

    html += `<h3 style="color:#79c0ff;border-bottom:1px solid #30363d;padding-bottom:6px">${c.name}</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:4px 8px;color:#8b949e">Nodes</td>
            <td style="padding:4px 8px">${c.nodes.filter(n=>n.online).length}/${c.nodes.length} online
            ${offlineNodes.length?`<span style="color:#f85149"> ⚠ Offline: ${offlineNodes.map(n=>n.node).join(', ')}</span>`:''}
            </td></tr>
        <tr><td style="padding:4px 8px;color:#8b949e">VMs/CTs</td>
            <td style="padding:4px 8px">${c.vms.filter(v=>v.status==='running').length} running, ${stoppedVMs.length} stopped</td></tr>
        ${highStorage.length?`<tr><td style="padding:4px 8px;color:#f85149">High storage</td>
            <td style="padding:4px 8px;color:#f85149">${highStorage.map(s=>`${s.storage}@${s.node}: ${s.usedPct}%`).join(', ')}</td></tr>`:''}
        ${longRunning.length?`<tr><td style="padding:4px 8px;color:#e3b341">Long-running VMs</td>
            <td style="padding:4px 8px;color:#e3b341">${longRunning.map(v=>`${v.name} (${Math.floor(v.uptime/86400)}d)`).join(', ')}</td></tr>`:''}
      </table>`;
  }
  html += '</body></html>';
  return html;
}

async function sendDigest(cfg) {
  const data = await buildDigestData();
  const html = buildDigestHtml(data);

  // Email
  if (cfg.smtp_host && cfg.digest_to && nodemailer) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.smtp_host, port: parseInt(cfg.smtp_port || 587),
        secure: parseInt(cfg.smtp_port) === 465,
        auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
      });
      await transporter.sendMail({
        from: cfg.smtp_from || cfg.smtp_user || 'pcc@localhost',
        to: cfg.digest_to,
        subject: `PCC Digest — ${new Date().toLocaleDateString()}`,
        html,
      });
      console.log('Digest email sent to', cfg.digest_to);
    } catch(e) { console.error('Digest email failed:', e.message); }
  }

  // Webhook
  if (cfg.digest_webhook_url) {
    try {
      const u = new url.URL(cfg.digest_webhook_url);
      const body = JSON.stringify({ text: 'PCC Digest', data, html });
      const isHttps = u.protocol === 'https:';
      await new Promise((resolve, reject) => {
        const req = (isHttps ? https : http).request({
          hostname: u.hostname, port: u.port || (isHttps?443:80), path: u.pathname + u.search,
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, res => { res.resume(); res.on('end', resolve); });
        req.on('error', reject);
        req.write(body); req.end();
      });
      console.log('Digest webhook sent to', cfg.digest_webhook_url);
    } catch(e) { console.error('Digest webhook failed:', e.message); }
  }
}

// ── NODE CONFIG SNAPSHOTS ─────────────────────────────────
// Nightly disaster-recovery capture: saves DNS, timezone, /etc/hosts
// and network interface config for every node in every cluster.
// Purely for reference if a host is lost and needs rebuilding.

async function captureAllNodeConfigs() {
  const clusters = db.prepare('SELECT * FROM clusters ORDER BY sort_order').all();
  let total = 0;
  const ins = db.prepare(
    'INSERT INTO node_config_snapshots (cluster_id, node, dns, timezone, hosts, network, status, storage) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const cluster of clusters) {
    try {
      const nodes = await clusterApiGet(cluster, '/api2/json/nodes');
      if (!Array.isArray(nodes)) continue;
      for (const n of nodes) {
        if (n.status !== 'online') continue;
        try {
          const [dns, tz, hosts, net, status, storage] = await Promise.all([
            clusterApiGet(cluster, `/api2/json/nodes/${n.node}/dns`),
            clusterApiGet(cluster, `/api2/json/nodes/${n.node}/time`),
            clusterApiGet(cluster, `/api2/json/nodes/${n.node}/hosts`),
            clusterApiGet(cluster, `/api2/json/nodes/${n.node}/network`),
            clusterApiGet(cluster, `/api2/json/nodes/${n.node}/status`),
            clusterApiGet(cluster, `/api2/json/nodes/${n.node}/storage`),
          ]);
          ins.run(
            cluster.id, n.node,
            JSON.stringify(dns),
            JSON.stringify(tz),
            typeof hosts === 'string' ? hosts : JSON.stringify(hosts),
            JSON.stringify(net),
            JSON.stringify(status),
            JSON.stringify(storage),
          );
          total++;
        } catch(e) { console.error(`Node snapshot failed for ${n.node}:`, e.message); }
      }
    } catch(e) { console.error(`Node snapshot cluster error (${cluster.name}):`, e.message); }
  }
  setSetting('node_snapshot_last_run', new Date().toISOString().slice(0, 10));
  console.log(`Node config snapshot: captured ${total} node(s).`);
  return total;
}

setInterval(async () => {
  try {
    if (!getSetting('node_snapshot_enabled', true)) return;
    const today = new Date().toISOString().slice(0, 10);
    if (getSetting('node_snapshot_last_run') === today) return;
    const [h, m] = (getSetting('node_snapshot_time', '02:00') || '02:00').split(':').map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    if (Math.abs(Date.now() - target.getTime()) > 5 * 60 * 1000) return;
    await captureAllNodeConfigs();
  } catch(e) { console.error('Node snapshot tick error:', e.message); }
}, 60000);

// Check digest schedule every 5 minutes
setInterval(async () => {
  try {
    const cfg = {};
    const rows = db.prepare('SELECT key, value FROM settings').all();
    rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; } });
    if (!cfg.digest_enabled) return;
    const now = Date.now();
    const lastSent = parseInt(cfg.digest_last_sent || '0');
    const schedule = cfg.digest_schedule || 'daily';
    const minInterval = schedule === 'weekly' ? 6.5 * 24 * 3600 * 1000 : 23 * 3600 * 1000;
    if (now - lastSent < minInterval) return;

    const [h, m] = (cfg.digest_time || '08:00').split(':').map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    if (Math.abs(Date.now() - target.getTime()) > 5 * 60 * 1000) return; // only fire within 5min of target time

    setSetting('digest_last_sent', now);
    await sendDigest(cfg);
  } catch(e) { console.error('Digest check error:', e.message); }
}, 5 * 60 * 1000);
