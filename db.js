// Database layer: opens SQLite (built into Node.js) and creates the schema (Rooms 1—* Bookings).
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room_no TEXT    NOT NULL UNIQUE,
  type    TEXT    NOT NULL CHECK (type IN ('Single','Double','Deluxe','Suite')),
  price   REAL    NOT NULL CHECK (price > 0),
  status  TEXT    NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Maintenance'))
);
CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_name TEXT    NOT NULL,
  check_in   TEXT    NOT NULL,
  check_out  TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_dates ON bookings(room_id, check_in, check_out);
`;

function open(file = 'hotel.db') {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function seed(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM rooms').get();
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO rooms (room_no, type, price) VALUES (?, ?, ?)');
  [
    ['101', 'Single', 2500], ['102', 'Single', 2500], ['103', 'Double', 3800],
    ['201', 'Double', 4000], ['202', 'Deluxe', 5600], ['203', 'Deluxe', 5800],
    ['301', 'Suite', 9500], ['302', 'Suite', 12000],
  ].forEach(r => ins.run(...r));
}

module.exports = { open, seed };