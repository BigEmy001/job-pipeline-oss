// One SQLite file holds everything: jobs found, applications sent, replies read, events.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || 'data/pipeline.db');
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,            -- source:native id
  source TEXT, company TEXT, title TEXT, url TEXT, apply_url TEXT, apply_kind TEXT,
  location TEXT, remote INTEGER, description TEXT, posted_at TEXT, found_at TEXT,
  score INTEGER, score_why TEXT, status TEXT DEFAULT 'new'   -- new | queued | applied | skipped | needs_you | closed
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, method TEXT, sent_at TEXT, state TEXT,
  detail TEXT, follow_up_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, job_id TEXT, received_at TEXT, from_addr TEXT, subject TEXT, snippet TEXT,
  kind TEXT, portal_url TEXT, handled INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
`);

export const log = (kind, detail) => db.prepare('INSERT INTO events (at, kind, detail) VALUES (?, ?, ?)').run(new Date().toISOString(), kind, typeof detail === 'string' ? detail : JSON.stringify(detail));

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, name TEXT, niche TEXT, city TEXT, website TEXT, final_url TEXT, phone TEXT, email TEXT,
  address TEXT, source TEXT, audit TEXT, score INTEGER, tier TEXT, why TEXT, found_at TEXT,
  status TEXT DEFAULT 'new'   -- new | drafted | sent | replied | won | lost | skip | unsubscribed
);`);

db.exec(`
CREATE TABLE IF NOT EXISTS pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT, to_addr TEXT, subject TEXT, body TEXT,
  created_at TEXT, sent_at TEXT, state TEXT DEFAULT 'draft'   -- draft | sent | skipped
);
CREATE TABLE IF NOT EXISTS optouts (email TEXT PRIMARY KEY, at TEXT);`);
for (const col of ['variant TEXT', 'attachment TEXT']) { try { db.exec(`ALTER TABLE pitches ADD COLUMN ${col}`); } catch {} }

// Tracker: status you set by hand on anything sent (interview, rejected, followed up...), keyed
// app:<job id> | pitch:<pitch id> | dm:<company>.
db.exec(`CREATE TABLE IF NOT EXISTS track (key TEXT PRIMARY KEY, status TEXT, note TEXT, followed_up_at TEXT, updated_at TEXT);`);

// People at a company you found by hand (founder, CEO, design lead), with where you found them.
db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT, job_id TEXT, name TEXT, role TEXT, email TEXT,
  linkedin TEXT, added_at TEXT
);`);
