// Express application: middleware, REST routes, validation and business rules.
const express = require('express');
const path = require('path');

const TYPES = ['Single', 'Double', 'Deluxe', 'Suite'];
const ROOM_STATUSES = ['Available', 'Maintenance'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDate = s =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'ID must be a positive whole number.');
  return id;
}

function validateRoom(body) {
  const roomNo = String(body.roomNo ?? '').trim();
  const price = Number(body.price);
  const status = body.status ?? 'Available';
  if (!roomNo || roomNo.length > 10) throw new HttpError(400, 'Room number is required (max 10 characters).');
  if (!TYPES.includes(body.type)) throw new HttpError(400, `Type must be one of: ${TYPES.join(', ')}.`);
  if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'Price must be a number greater than 0.');
  if (!ROOM_STATUSES.includes(status)) throw new HttpError(400, `Status must be one of: ${ROOM_STATUSES.join(', ')}.`);
  return { roomNo, type: body.type, price, status };
}

function validateStay(body, allowPast = false) {
  const guestName = String(body.guestName ?? '').trim();
  if (guestName.length < 2 || guestName.length > 80) throw new HttpError(400, 'Guest name must be 2–80 characters.');
  if (!isDate(body.checkIn) || !isDate(body.checkOut)) throw new HttpError(400, 'Check-in and check-out must be valid dates (YYYY-MM-DD).');
  if (body.checkOut <= body.checkIn) throw new HttpError(400, 'Check-out must be after check-in.');
  if (!allowPast && body.checkIn < today()) throw new HttpError(400, 'Check-in cannot be in the past.');
  return { guestName, checkIn: body.checkIn, checkOut: body.checkOut };
}

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

  // Two stays overlap when each starts before the other ends.
  // A guest leaving on the 5th does not clash with a guest arriving on the 5th.
  const findConflict = (roomId, checkIn, checkOut, excludeId = 0) =>
    db.prepare(`SELECT * FROM bookings
                WHERE room_id = ? AND id <> ? AND check_in < ? AND check_out > ?
                ORDER BY check_in LIMIT 1`).get(roomId, excludeId, checkOut, checkIn);

  const mapRoom = r => ({ id: r.id, roomNo: r.room_no, type: r.type, price: r.price, status: r.status });

  const bookingSelect = `
    SELECT b.id, b.room_id, b.guest_name, b.check_in, b.check_out, b.created_at,
           r.room_no, r.type, r.price
    FROM bookings b JOIN rooms r ON r.id = b.room_id`;
  const mapBooking = b => {
    const nights = nightsBetween(b.check_in, b.check_out);
    return {
      id: b.id, roomId: b.room_id, roomNo: b.room_no, roomType: b.type,
      guestName: b.guest_name, checkIn: b.check_in, checkOut: b.check_out,
      nights, total: nights * b.price, createdAt: b.created_at,
    };
  };

  // ---------- Rooms ----------
  // List all rooms with live occupancy (is someone staying tonight?)
  app.get('/api/rooms', wrap((req, res) => {
    const t = today();
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY room_no').all();
    const current = db.prepare('SELECT room_id, guest_name, check_out FROM bookings WHERE check_in <= ? AND check_out > ?').all(t, t);
    const byRoom = new Map(current.map(c => [c.room_id, c]));
    res.json(rooms.map(r => {
      const c = byRoom.get(r.id);
      return { ...mapRoom(r), occupiedNow: !!c, currentGuest: c ? c.guest_name : null, freeFrom: c ? c.check_out : null };
    }));
  }));

  // Search available rooms by type and/or date range (and optional max price)
  app.get('/api/rooms/search', wrap((req, res) => {
    const { type, checkIn, checkOut, maxPrice } = req.query;
    if (type && !TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${TYPES.join(', ')}.`);
    if ((checkIn && !checkOut) || (!checkIn && checkOut)) throw new HttpError(400, 'Provide both checkIn and checkOut, or neither.');
    if (checkIn) {
      if (!isDate(checkIn) || !isDate(checkOut)) throw new HttpError(400, 'Dates must be valid (YYYY-MM-DD).');
      if (checkOut <= checkIn) throw new HttpError(400, 'Check-out must be after check-in.');
    }
    if (maxPrice !== undefined && maxPrice !== '' && (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) <= 0))
      throw new HttpError(400, 'maxPrice must be a positive number.');

    let sql = `SELECT * FROM rooms WHERE status = 'Available'`;
    const params = [];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (maxPrice) { sql += ' AND price <= ?'; params.push(Number(maxPrice)); }
    if (checkIn) {
      sql += ` AND id NOT IN (SELECT room_id FROM bookings WHERE check_in < ? AND check_out > ?)`;
      params.push(checkOut, checkIn);
    }
    sql += ' ORDER BY price, room_no';
    res.json(db.prepare(sql).all(...params).map(mapRoom));
  }));

  app.post('/api/rooms', wrap((req, res) => {
    const v = validateRoom(req.body || {});
    if (db.prepare('SELECT 1 FROM rooms WHERE room_no = ?').get(v.roomNo))
      throw new HttpError(409, `Room ${v.roomNo} already exists.`);
    const info = db.prepare('INSERT INTO rooms (room_no, type, price, status) VALUES (?, ?, ?, ?)').run(v.roomNo, v.type, v.price, v.status);
    res.status(201).json(mapRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(info.lastInsertRowid))));
  }));

  app.put('/api/rooms/:id', wrap((req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Room not found.');
    const v = validateRoom({
      roomNo: existing.room_no, type: existing.type, price: existing.price, status: existing.status,
      ...req.body,
    });
    if (db.prepare('SELECT 1 FROM rooms WHERE room_no = ? AND id <> ?').get(v.roomNo, id))
      throw new HttpError(409, `Room ${v.roomNo} already exists.`);
    db.prepare('UPDATE rooms SET room_no = ?, type = ?, price = ?, status = ? WHERE id = ?').run(v.roomNo, v.type, v.price, v.status, id);
    res.json(mapRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)));
  }));

  app.delete('/api/rooms/:id', wrap((req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) throw new HttpError(404, 'Room not found.');
    const upcoming = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE room_id = ? AND check_out > ?').get(id, today());
    if (upcoming.n > 0) throw new HttpError(409, 'This room has current or upcoming bookings. Cancel them first.');
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    res.json({ message: 'Room deleted.' });
  }));

  // ---------- Bookings ----------
  app.get('/api/bookings', wrap((req, res) => {
    let sql = bookingSelect + ' WHERE 1=1';
    const params = [];
    if (req.query.roomId) { sql += ' AND b.room_id = ?'; params.push(parseId(req.query.roomId)); }
    if (req.query.guest) { sql += ' AND b.guest_name LIKE ?'; params.push(`%${String(req.query.guest).trim()}%`); }
    sql += ' ORDER BY b.check_in, b.id';
    res.json(db.prepare(sql).all(...params).map(mapBooking));
  }));

  app.post('/api/bookings', wrap((req, res) => {
    const body = req.body || {};
    const roomId = parseId(body.roomId);
    const v = validateStay(body);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room) throw new HttpError(404, 'Room not found.');
    if (room.status !== 'Available') throw new HttpError(409, `Room ${room.room_no} is under maintenance and cannot be booked.`);
    const clash = findConflict(roomId, v.checkIn, v.checkOut);
    if (clash) throw new HttpError(409, `Room ${room.room_no} is already reserved from ${clash.check_in} to ${clash.check_out}.`);
    const info = db.prepare('INSERT INTO bookings (room_id, guest_name, check_in, check_out) VALUES (?, ?, ?, ?)')
      .run(roomId, v.guestName, v.checkIn, v.checkOut);
    res.status(201).json(mapBooking(db.prepare(bookingSelect + ' WHERE b.id = ?').get(Number(info.lastInsertRowid))));
  }));

  // Modify a booking (guest name / dates), re-checking for clashes
  app.put('/api/bookings/:id', wrap((req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Booking not found.');
    const b = req.body || {};
    // Editing a stay already under way (past check-in) is fine as long as the check-in date itself is unchanged.
    const keepsCheckIn = b.checkIn === undefined || b.checkIn === existing.check_in;
    const v = validateStay({
      guestName: existing.guest_name, checkIn: existing.check_in, checkOut: existing.check_out, ...b,
    }, keepsCheckIn);
    const clash = findConflict(existing.room_id, v.checkIn, v.checkOut, id);
    if (clash) throw new HttpError(409, `Those dates clash with another booking (${clash.check_in} to ${clash.check_out}).`);
    db.prepare('UPDATE bookings SET guest_name = ?, check_in = ?, check_out = ? WHERE id = ?').run(v.guestName, v.checkIn, v.checkOut, id);
    res.json(mapBooking(db.prepare(bookingSelect + ' WHERE b.id = ?').get(id)));
  }));

  app.delete('/api/bookings/:id', wrap((req, res) => {
    const id = parseId(req.params.id);
    const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
    if (info.changes === 0) throw new HttpError(404, 'Booking not found. It may already be cancelled.');
    res.json({ message: 'Booking cancelled.' });
  }));

  // ---------- Errors ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

module.exports = { createApp, today };
