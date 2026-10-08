// Frontend logic: talks to the Express API with fetch() and updates the page without reloading.
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

let rooms = [];
let bookings = [];
let filter = 'all';
let bookingRoom = null;

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.forEach(c => node.append(c));
  return node;
}

// ---------- Loading ----------
async function refresh() {
  try {
    [rooms, bookings] = await Promise.all([api('/rooms'), api('/bookings?guest=' + encodeURIComponent($('guestFilter').value))]);
    renderRooms();
    renderBookings();
    const free = rooms.filter(r => r.status === 'Available' && !r.occupiedNow).length;
    $('summary').textContent = `${rooms.length} rooms · ${free} free tonight · ${bookings.length} bookings shown`;
  } catch (e) {
    $('summary').textContent = 'Could not reach the server. Is it running?';
    toast(e.message);
  }
}

// ---------- Rooms ----------
function roomState(r) { return r.status === 'Maintenance' ? 'Maintenance' : r.occupiedNow ? 'occupied' : 'free'; }

function renderRooms() {
  const box = $('rooms');
  box.replaceChildren();
  const list = rooms.filter(r => filter === 'all' || roomState(r) === filter);
  if (!list.length) { box.append(el('p', { class: 'empty' }, 'No rooms match this filter.')); return; }
  list.forEach(r => {
    const state = roomState(r);
    const label = state === 'Maintenance' ? 'Maintenance'
      : state === 'occupied' ? `Occupied until ${r.freeFrom}` : 'Free tonight';
    const acts = el('div', { class: 'acts' });
    if (r.status === 'Available') acts.append(el('button', { class: 'small solid', onclick: () => openBooking(r) }, 'Book'));
    acts.append(
      el('button', { class: 'small', onclick: () => toggleMaintenance(r) }, r.status === 'Available' ? 'Set maintenance' : 'Mark available'),
      el('button', { class: 'small danger', onclick: () => deleteRoom(r) }, 'Delete'),
    );
    const card = el('article', { class: `room ${state}` },
      el('div', { class: 'no' }, r.roomNo),
      el('div', { class: 'meta' }, r.type),
      el('div', { class: 'price' }, `${money(r.price)} / night`),
      el('span', { class: 'badge' }, label),
      el('div', { class: 'meta' }, r.currentGuest ? `Guest: ${r.currentGuest}` : ''),
      acts,
    );
    box.append(card);
  });
}

async function toggleMaintenance(r) {
  try {
    await api(`/rooms/${r.id}`, { method: 'PUT', body: { status: r.status === 'Available' ? 'Maintenance' : 'Available' } });
    toast(`Room ${r.roomNo} updated.`);
    refresh();
  } catch (e) { toast(e.message); }
}

async function deleteRoom(r) {
  if (!confirm(`Delete room ${r.roomNo}? This cannot be undone.`)) return;
  try { await api(`/rooms/${r.id}`, { method: 'DELETE' }); toast(`Room ${r.roomNo} deleted.`); refresh(); }
  catch (e) { toast(e.message); }
}

document.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => {
  filter = btn.dataset.filter;
  document.querySelectorAll('.chip').forEach(b => b.classList.toggle('is-on', b === btn));
  renderRooms();
}));

// ---------- Bookings ----------
function renderBookings() {
  const body = $('bookings');
  body.replaceChildren();
  if (!bookings.length) {
    body.append(el('tr', {}, el('td', { colspan: '7', class: 'empty' }, 'No bookings yet. Pick a room above and choose Book.')));
    return;
  }
  bookings.forEach(b => body.append(el('tr', {},
    el('td', {}, b.guestName),
    el('td', {}, `${b.roomNo} · ${b.roomType}`),
    el('td', {}, b.checkIn),
    el('td', {}, b.checkOut),
    el('td', { class: 'num' }, String(b.nights)),
    el('td', { class: 'num' }, money(b.total)),
    el('td', {}, el('button', { class: 'small danger', onclick: () => cancelBooking(b) }, 'Cancel booking')),
  )));
}

async function cancelBooking(b) {
  if (!confirm(`Cancel ${b.guestName}'s booking for room ${b.roomNo} (${b.checkIn} to ${b.checkOut})?`)) return;
  try { await api(`/bookings/${b.id}`, { method: 'DELETE' }); toast('Booking cancelled.'); refresh(); if ($('results').children.length) $('paneFind').requestSubmit(); }
  catch (e) { toast(e.message); refresh(); }
}

let guestTimer;
$('guestFilter').addEventListener('input', () => { clearTimeout(guestTimer); guestTimer = setTimeout(refresh, 250); });

// ---------- Booking dialog ----------
function openBooking(room, checkIn = '', checkOut = '') {
  bookingRoom = room;
  $('bookTitle').textContent = `Book room ${room.roomNo}`;
  $('bookInfo').textContent = `${room.type} · ${money(room.price)} per night`;
  $('bName').value = '';
  $('bIn').value = checkIn || $('sIn').value;
  $('bOut').value = checkOut || $('sOut').value;
  $('bookMsg').textContent = '';
  updateQuote();
  $('bookDialog').showModal();
  $('bName').focus();
}

function updateQuote() {
  const a = $('bIn').value, b = $('bOut').value;
  const n = a && b ? nightsBetween(a, b) : 0;
  $('bookQuote').textContent = n > 0 ? `${n} night${n > 1 ? 's' : ''} · ${money(n * bookingRoom.price)} total` : '';
}
['bIn', 'bOut'].forEach(id => $(id).addEventListener('change', updateQuote));
$('bookCancel').addEventListener('click', () => $('bookDialog').close());

$('bookForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const msg = $('bookMsg');
  msg.textContent = '';
  try {
    const b = await api('/bookings', { method: 'POST', body: {
      roomId: bookingRoom.id, guestName: $('bName').value, checkIn: $('bIn').value, checkOut: $('bOut').value,
    } });
    $('bookDialog').close();
    toast(`Booked room ${b.roomNo} for ${b.guestName}.`);
    refresh();
    if ($('results').children.length) $('paneFind').requestSubmit();
  } catch (e) { msg.textContent = e.message; }
});

// ---------- Search ----------
$('paneFind').addEventListener('submit', async ev => {
  ev.preventDefault();
  const msg = $('findMsg'), list = $('results');
  msg.className = 'msg'; msg.textContent = '';
  const q = new URLSearchParams();
  if ($('sType').value) q.set('type', $('sType').value);
  if ($('sMax').value) q.set('maxPrice', $('sMax').value);
  if ($('sIn').value || $('sOut').value) { q.set('checkIn', $('sIn').value); q.set('checkOut', $('sOut').value); }
  try {
    const found = await api('/rooms/search?' + q);
    list.replaceChildren();
    if (!found.length) { msg.textContent = 'No free rooms match. Try other dates or a different type.'; return; }
    msg.className = 'msg ok';
    msg.textContent = `${found.length} room${found.length > 1 ? 's' : ''} free.`;
    found.forEach(r => list.append(el('li', {},
      el('span', {}, el('strong', {}, r.roomNo), ` ${r.type} · ${money(r.price)}`),
      el('button', { type: 'button', class: 'small solid', onclick: () => openBooking(r) }, 'Book'),
    )));
  } catch (e) { list.replaceChildren(); msg.textContent = e.message; }
});

// ---------- Add room ----------
$('paneAdd').addEventListener('submit', async ev => {
  ev.preventDefault();
  const msg = $('addMsg');
  msg.className = 'msg'; msg.textContent = '';
  try {
    const r = await api('/rooms', { method: 'POST', body: {
      roomNo: $('aNo').value, type: $('aType').value, price: $('aPrice').value, status: $('aStatus').value,
    } });
    $('paneAdd').reset();
    msg.className = 'msg ok';
    msg.textContent = `Room ${r.roomNo} added.`;
    refresh();
  } catch (e) { msg.textContent = e.message; }
});

// ---------- Tabs ----------
function showTab(which) {
  const find = which === 'find';
  $('tabFind').setAttribute('aria-selected', find);
  $('tabAdd').setAttribute('aria-selected', !find);
  $('paneFind').hidden = !find;
  $('paneAdd').hidden = find;
}
$('tabFind').addEventListener('click', () => showTab('find'));
$('tabAdd').addEventListener('click', () => showTab('add'));

// ---------- Start ----------
const t = todayStr();
['sIn', 'sOut', 'bIn', 'bOut'].forEach(id => { $(id).min = t; });
$('todayLabel').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
refresh();
