require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const bookingRoutes = require('./routes/bookings');
const availabilityRoutes = require('./routes/availability');
const profileRoutes = require('./routes/profile');
const reviewRoutes = require('./routes/reviews');
const offerRoutes = require('./routes/offers');
const { notFound, errorHandler } = require('./middleware/errors');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters.');
}

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CLIENT_ORIGIN || `http://localhost:${port}` }));
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  if (req.is('application/json') &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
    return res.status(400).json({ message: 'The JSON request body must be an object.' });
  }
  return next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch (error) {
    return next(error);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/offers', offerRoutes);
app.use(notFound);
app.use(errorHandler);

function startServer(currentPort) {
  const server = app.listen(currentPort, () => {
    console.log(`BookEase is listening on port ${currentPort}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = currentPort + 1;
      if (nextPort <= 3100) {
        console.warn(`Port ${currentPort} is already in use. Retrying on port ${nextPort}...`);
        return startServer(nextPort);
      }

      console.error(`No free port found between ${port} and 3100.`);
      process.exit(1);
    }

    throw error;
  });

  return server;
}

let server = startServer(port);

async function shutdown() {
  if (server) {
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
