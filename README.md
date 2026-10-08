# Hotel Room Booking System

A full-stack web application for managing hotel rooms and guest bookings. Staff can add rooms, search for free rooms by type and dates, book a room for a guest, and cancel bookings. The system prevents a room from being double-booked for overlapping dates, and the page updates instantly without reloading.

> **Student:** Devanshu Murthy · **Roll No:** 31 · **Submission:** Teacher Assessment — Aim 1 (Hotel Room Booking System)

## Technologies used

| Layer | Tools |
|-------|-------|
| Frontend | HTML5, CSS3, JavaScript (ES6), Fetch API (AJAX) |
| Backend | Node.js, Express.js (routing, JSON middleware, error-handling middleware) |
| Database | SQLite via the Node.js built-in `node:sqlite` module |
| Testing | Node.js built-in test runner (`node --test`) |

## Features

- Add, list, update (maintenance toggle) and delete rooms: Room No, Type, Price, Availability Status
- Search available rooms by type, date range and maximum price
- Book a room (guest name, check-in, check-out) with live price quote
- Cancel a booking, and modify a booking's guest name or dates
- **Double-booking protection** — overlapping dates for the same room are rejected (a guest checking out on the 5th does not block another checking in on the 5th)
- Room board shows who is staying tonight, with filters (Free tonight / Occupied / Maintenance)
- Friendly validation messages and edge-case handling (unknown room, already-cancelled booking, malformed JSON, past dates)

## Instructions to run

Requirements: [Node.js](https://nodejs.org) **22.13 or newer** (SQLite is built into Node.js, so no database needs to be installed).

```bash
git clone <your-repository-url>
cd hotel-room-booking-system
npm install
npm start
```

Open **http://localhost:3000** in your browser. The SQLite file `hotel.db` is created automatically on first run and filled with 8 sample rooms.

Note: Node.js prints an "ExperimentalWarning: SQLite is an experimental feature" message when the server starts. This is normal and harmless.

To use another port: `PORT=4000 npm start` (Windows PowerShell: `$env:PORT=4000; npm start`).

### Run the automated tests

```bash
npm test
```

The tests use an in-memory database, so your `hotel.db` is never touched.

## Database schema

```
rooms (id PK, room_no UNIQUE, type, price, status)
   │ 1
   │
   │ *
bookings (id PK, room_id FK → rooms.id ON DELETE CASCADE, guest_name, check_in, check_out, created_at)
```

- `type` ∈ Single, Double, Deluxe, Suite · `status` ∈ Available, Maintenance
- Overlap rule: a new stay clashes with an existing one when `existing.check_in < new.check_out AND existing.check_out > new.check_in`.

## REST API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/rooms` | List all rooms (with tonight's occupancy) |
| GET | `/api/rooms/search?type=&checkIn=&checkOut=&maxPrice=` | Search available rooms |
| POST | `/api/rooms` | Add a room |
| PUT | `/api/rooms/:id` | Update a room (price, type, status…) |
| DELETE | `/api/rooms/:id` | Delete a room (blocked if it has current/upcoming bookings) |
| GET | `/api/bookings?guest=&roomId=` | List bookings |
| POST | `/api/bookings` | Book a room |
| PUT | `/api/bookings/:id` | Change guest name or dates (re-checks clashes) |
| DELETE | `/api/bookings/:id` | Cancel a booking |

Example:

```bash
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"roomId":1,"guestName":"Asha Rao","checkIn":"2026-12-20","checkOut":"2026-12-23"}'
```

Errors are returned as JSON `{ "error": "message" }` with status 400 (invalid input), 404 (not found) or 409 (conflict, e.g. room already reserved).

## Edge cases tested

Booking an already-reserved room (every overlap pattern) · back-to-back stays · cancelling a non-existent or already-cancelled booking · booking a non-existent or under-maintenance room · duplicate room numbers · invalid prices, dates and names · malformed JSON · deleting a room that still has bookings.

## Project structure

```
├── server.js          # starts the server
├── app.js             # Express app: middleware, routes, validation
├── db.js              # SQLite connection, schema, sample data
├── public/            # frontend (index.html, style.css, app.js)
├── test/api.test.js   # automated API tests
└── package.json
```