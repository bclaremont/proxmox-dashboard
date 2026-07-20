#!/usr/bin/env node
// Break-glass 2FA recovery for PCC's own login.
// Run directly on the PCC server if 2FA is broken/lost and no other admin
// account is available to use the "Disable 2FA" button in Admin -> Users.
//
// Usage (from /opt/pcc):
//   node reset-2fa.js --list            List all users and their 2FA status
//   node reset-2fa.js <username>        Disable 2FA for that user

'use strict';

require('dotenv').config({ path: '/opt/pcc/.env' });
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/opt/pcc/data/pcc.db';
const arg = process.argv[2];

if (!arg) {
  console.error('Usage: node reset-2fa.js --list | node reset-2fa.js <username>');
  process.exit(1);
}

const db = new Database(DB_PATH);

if (arg === '--list') {
  const users = db.prepare('SELECT username, role, totp_enabled FROM users ORDER BY id').all();
  if (!users.length) { console.log('No users found.'); process.exit(0); }
  for (const u of users) {
    console.log(`${u.username}\t${u.role}\t2FA: ${u.totp_enabled ? 'ON' : 'off'}`);
  }
  process.exit(0);
}

const user = db.prepare('SELECT id, totp_enabled FROM users WHERE username = ?').get(arg);
if (!user) {
  console.error(`No user "${arg}" found. Run "node reset-2fa.js --list" to see valid usernames.`);
  process.exit(1);
}
if (!user.totp_enabled) {
  console.log(`2FA is already off for "${arg}" — nothing to do.`);
  process.exit(0);
}

db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.id);
console.log(`2FA disabled for "${arg}". They can sign in with just their password now — encourage them to re-enable it once they have a working authenticator.`);
