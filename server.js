const { open, seed } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const db = open(process.env.DB_FILE || 'hotel.db');
seed(db);

createApp(db).listen(PORT, () => {
  console.log(`Hotel Room Booking System running at http://localhost:${PORT}`);
});
