const express = require('express');
const db = require('../db');
const { authenticateToken, allowRoles } = require('../middleware/auth');

const router = express.Router();
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/;

router.use(authenticateToken, allowRoles('provider'));

router.get('/', async (req, res, next) => {
  try {
    const [availability] = await db.execute(
      `SELECT id, day_of_week, start_time, end_time
       FROM availability WHERE provider_id = ?
       ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
                start_time`,
      [req.user.id]
    );
    return res.json(availability);
  } catch (error) {
    return next(error);
  }
});

router.put('/', async (req, res, next) => {
  const windows = req.body.windows;
  if (!Array.isArray(windows) || windows.length > 42) {
    return res.status(400).json({ message: 'Provide up to six availability windows per weekday.' });
  }

  const normalized = [];
  for (const window of windows) {
    if (!window || !DAYS.includes(window.day_of_week) ||
        typeof window.start_time !== 'string' || !TIME_PATTERN.test(window.start_time) ||
        typeof window.end_time !== 'string' || !TIME_PATTERN.test(window.end_time)) {
      return res.status(400).json({ message: 'Each window needs a valid weekday, start time, and end time.' });
    }
    const start = window.start_time.slice(0, 5);
    const end = window.end_time.slice(0, 5);
    if (start >= end) {
      return res.status(400).json({ message: 'Availability start times must be earlier than end times.' });
    }
    normalized.push({ day: window.day_of_week, start, end });
  }

  for (const day of DAYS) {
    const dayWindows = normalized.filter((window) => window.day === day)
      .sort((first, second) => first.start.localeCompare(second.start));
    if (dayWindows.length > 6) {
      return res.status(400).json({ message: `You can set at most six windows for ${day}.` });
    }
    for (let index = 1; index < dayWindows.length; index += 1) {
      if (dayWindows[index].start < dayWindows[index - 1].end) {
        return res.status(400).json({ message: `Availability windows overlap on ${day}.` });
      }
    }
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute('DELETE FROM availability WHERE provider_id = ?', [req.user.id]);
    if (normalized.length) {
      const values = normalized.map((window) => [req.user.id, window.day, `${window.start}:00`, `${window.end}:00`]);
      await connection.query(
        'INSERT INTO availability (provider_id, day_of_week, start_time, end_time) VALUES ?',
        [values]
      );
    }
    await connection.commit();
    return res.json({ message: 'Weekly availability saved.', windows: normalized.length });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
