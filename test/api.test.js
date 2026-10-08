const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../db');
const { createApp } = require('../app');

let server, base, db;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function call(method, path, body, raw) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, data: await res.json() };
}

before(async () => {
  db = open(':memory:');
  await new Promise(r => { server = createApp(db).listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

let roomId, bookingId;

test('adds a room', async () => {
  const r = await call('POST', '/api/rooms', { roomNo: '101', type: 'Double', price: 4000 });
  assert.equal(r.status, 201);
  roomId = r.data.id;
  assert.equal(r.data.status, 'Available');
});

test('rejects duplicate room number (409)', async () => {
  assert.equal((await call('POST', '/api/rooms', { roomNo: '101', type: 'Single', price: 100 })).status, 409);
});

test('rejects invalid room data (400)', async () => {
  assert.equal((await call('POST', '/api/rooms', { roomNo: '', type: 'Double', price: 10 })).status, 400);
  assert.equal((await call('POST', '/api/rooms', { roomNo: '9', type: 'Castle', price: 10 })).status, 400);
  assert.equal((await call('POST', '/api/rooms', { roomNo: '9', type: 'Suite', price: -5 })).status, 400);
});

test('rejects malformed JSON (400)', async () => {
  assert.equal((await call('POST', '/api/rooms', null, '{bad json')).status, 400);
});

test('books a room and calculates total', async () => {
  const r = await call('POST', '/api/bookings', { roomId, guestName: 'Asha Rao', checkIn: addDays(10), checkOut: addDays(13) });
  assert.equal(r.status, 201);
  assert.equal(r.data.nights, 3);
  assert.equal(r.data.total, 12000);
  bookingId = r.data.id;
});

test('blocks double-booking for overlapping dates (409)', async () => {
  const overlaps = [[9, 11], [11, 12], [12, 15], [10, 13], [8, 20]];
  for (const [a, b] of overlaps) {
    const r = await call('POST', '/api/bookings', { roomId, guestName: 'Ravi K', checkIn: addDays(a), checkOut: addDays(b) });
    assert.equal(r.status, 409, `expected clash for days ${a}-${b}`);
  }
});

test('allows back-to-back stays (checkout day = next check-in)', async () => {
  assert.equal((await call('POST', '/api/bookings', { roomId, guestName: 'Before', checkIn: addDays(8), checkOut: addDays(10) })).status, 201);
  assert.equal((await call('POST', '/api/bookings', { roomId, guestName: 'After', checkIn: addDays(13), checkOut: addDays(14) })).status, 201);
});

test('validates booking input (400)', async () => {
  const bad = [
    { roomId, guestName: 'X', checkIn: addDays(20), checkOut: addDays(21) },
    { roomId, guestName: 'Valid Name', checkIn: addDays(21), checkOut: addDays(20) },
    { roomId, guestName: 'Valid Name', checkIn: addDays(-3), checkOut: addDays(2) },
    { roomId, guestName: 'Valid Name', checkIn: '2026-13-45', checkOut: '2026-14-01' },
  ];
  for (const b of bad) assert.equal((await call('POST', '/api/bookings', b)).status, 400);
});

test('booking a non-existent room returns 404', async () => {
  assert.equal((await call('POST', '/api/bookings', { roomId: 9999, guestName: 'Ghost', checkIn: addDays(1), checkOut: addDays(2) })).status, 404);
});

test('search excludes rooms booked for the dates and filters by type', async () => {
  await call('POST', '/api/rooms', { roomNo: '102', type: 'Double', price: 3800 });
  await call('POST', '/api/rooms', { roomNo: '103', type: 'Suite', price: 9000 });
  const free = await call('GET', `/api/rooms/search?type=Double&checkIn=${addDays(10)}&checkOut=${addDays(12)}`);
  assert.deepEqual(free.data.map(r => r.roomNo), ['102']);
  const any = await call('GET', `/api/rooms/search?checkIn=${addDays(10)}&checkOut=${addDays(12)}`);
  assert.equal(any.data.length, 2);
  assert.equal((await call('GET', `/api/rooms/search?checkIn=${addDays(10)}`)).status, 400);
});

test('maintenance rooms cannot be booked or appear in search', async () => {
  const m = await call('POST', '/api/rooms', { roomNo: '104', type: 'Single', price: 2000, status: 'Maintenance' });
  assert.equal((await call('POST', '/api/bookings', { roomId: m.data.id, guestName: 'Guest', checkIn: addDays(1), checkOut: addDays(2) })).status, 409);
  const s = await call('GET', '/api/rooms/search?type=Single');
  assert.equal(s.data.length, 0);
});

test('updates a booking, re-checking clashes', async () => {
  assert.equal((await call('PUT', `/api/bookings/${bookingId}`, { checkOut: addDays(16) })).status, 409);
  assert.equal((await call('PUT', `/api/bookings/${bookingId}`, { guestName: 'Asha R. Rao' })).status, 200);
  assert.equal((await call('PUT', '/api/bookings/9999', { guestName: 'Nobody' })).status, 404);
});

test('cannot delete a room that has upcoming bookings (409)', async () => {
  assert.equal((await call('DELETE', `/api/rooms/${roomId}`)).status, 409);
});

test('cancels a booking and frees the dates', async () => {
  assert.equal((await call('DELETE', `/api/bookings/${bookingId}`)).status, 200);
  const r = await call('POST', '/api/bookings', { roomId, guestName: 'New Guest', checkIn: addDays(10), checkOut: addDays(12) });
  assert.equal(r.status, 201);
});

test('cancelling a non-existent or already-cancelled booking returns 404', async () => {
  assert.equal((await call('DELETE', `/api/bookings/${bookingId}`)).status, 404);
  assert.equal((await call('DELETE', '/api/bookings/424242')).status, 404);
  assert.equal((await call('DELETE', '/api/bookings/abc')).status, 400);
});

test('unknown API route returns JSON 404', async () => {
  const r = await call('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.ok(r.data.error);
});
