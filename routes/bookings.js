const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../db');
const { authenticateToken, allowRoles } = require('../middleware/auth');

const router = express.Router();
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}:00`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  });
}

const mailer = createMailer();

router.get('/available-slots', async (req, res, next) => {
  try {
    const serviceId = Number(req.query.service_id);
    const date = req.query.date;
    if (!Number.isInteger(serviceId) || serviceId < 1 || !validDate(date)) {
      return res.status(400).json({ message: 'Provide a valid service_id and date in YYYY-MM-DD format.' });
    }

    const [services] = await db.execute(
      'SELECT id, provider_id, duration_minutes FROM services WHERE id = ?',
      [serviceId]
    );
    if (!services.length) return res.status(404).json({ message: 'Service not found.' });

    const day = DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const [availability] = await db.execute(
      'SELECT start_time, end_time FROM availability WHERE provider_id = ? AND day_of_week = ? ORDER BY start_time',
      [services[0].provider_id, day]
    );
    const [bookings] = await db.execute(
      `SELECT b.start_time, b.end_time FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE s.provider_id = ? AND b.booking_date = ? AND b.status IN ('pending', 'confirmed')`,
      [services[0].provider_id, date]
    );

    const duration = Number(services[0].duration_minutes);
    const slots = [];
    for (const window of availability) {
      const windowStart = timeToMinutes(window.start_time);
      const windowEnd = timeToMinutes(window.end_time);
      for (let start = windowStart; start + duration <= windowEnd; start += duration) {
        const end = start + duration;
        const booked = bookings.some((booking) =>
          overlaps(start, end, timeToMinutes(booking.start_time), timeToMinutes(booking.end_time))
        );
        slots.push({ start_time: minutesToTime(start), end_time: minutesToTime(end), available: !booked });
      }
    }
    return res.json(slots);
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticateToken, allowRoles('customer'), async (req, res, next) => {
  const serviceId = Number(req.body.service_id);
  const date = req.body.booking_date;
  const startTime = req.body.start_time;
  if (!Number.isInteger(serviceId) || serviceId < 1 || !validDate(date) ||
      typeof startTime !== 'string' || !TIME_PATTERN.test(startTime)) {
    return res.status(400).json({ message: 'Provide a valid service_id, booking_date, and start_time.' });
  }
  if (date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ message: 'Bookings cannot be created for a past date.' });
  }

  let connection;
  let booking;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Locking the provider serializes reservations across all of their services.
    const [services] = await connection.execute(
      `SELECT s.id, s.provider_id, s.duration_minutes
       FROM services s JOIN users u ON u.id = s.provider_id
       WHERE s.id = ? FOR UPDATE`,
      [serviceId]
    );
    if (!services.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Service not found.' });
    }

    const service = services[0];
    const duration = Number(service.duration_minutes);
    const start = timeToMinutes(startTime);
    const end = start + duration;
    if (end > 24 * 60) {
      await connection.rollback();
      return res.status(400).json({ message: 'The selected time and service duration extend past midnight.' });
    }
    const normalizedStart = minutesToTime(start);
    const endTime = minutesToTime(end);
    const day = DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const [windows] = await connection.execute(
      `SELECT start_time, end_time FROM availability
       WHERE provider_id = ? AND day_of_week = ?`,
      [service.provider_id, day]
    );
    const withinAvailability = windows.some((window) =>
      timeToMinutes(window.start_time) <= start &&
      timeToMinutes(window.end_time) >= end &&
      (start - timeToMinutes(window.start_time)) % duration === 0
    );
    if (!withinAvailability) {
      await connection.rollback();
      return res.status(400).json({ message: 'The selected time is outside the provider’s availability.' });
    }

    const [conflicts] = await connection.execute(
      `SELECT b.id FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE s.provider_id = ? AND b.booking_date = ? AND b.status IN ('pending', 'confirmed')
         AND b.start_time < ? AND b.end_time > ?
       LIMIT 1`,
      [service.provider_id, date, endTime, normalizedStart]
    );
    if (conflicts.length) {
      await connection.rollback();
      return res.status(409).json({
        message: 'This time slot is already booked. Please choose another time slot.'
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO bookings (customer_id, service_id, booking_date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, serviceId, date, normalizedStart, endTime]
    );
    await connection.commit();
    booking = { id: result.insertId, endTime };
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }

  if (mailer) {
    try {
      const [customers] = await db.execute('SELECT email, name FROM users WHERE id = ?', [req.user.id]);
      const [services] = await db.execute('SELECT title FROM services WHERE id = ?', [serviceId]);
      await mailer.sendMail({
        from: process.env.EMAIL_FROM,
        to: customers[0].email,
        subject: 'Your salon appointment request was received',
        text: `Hi ${customers[0].name}, your appointment for ${services[0].title} on ${date} at ${startTime} has been received.`
      });
    } catch (error) {
      console.error('Booking confirmation email could not be sent:', error);
    }
  }

  return res.status(201).json({ id: booking.id, status: 'pending', message: 'Booking created.' });
});

router.get('/my-bookings', authenticateToken, async (req, res, next) => {
  try {
    let condition;
    let params;
    if (req.user.role === 'customer') {
      condition = 'b.customer_id = ?';
      params = [req.user.id];
    } else if (req.user.role === 'provider') {
      condition = 's.provider_id = ?';
      params = [req.user.id];
    } else {
      condition = '1 = 1';
      params = [];
    }

    const [bookings] = await db.execute(
      `SELECT b.id, b.customer_id, b.service_id, b.booking_date, b.start_time, b.end_time,
              b.status, b.created_at, s.title AS service_title, s.provider_id,
              provider.name AS provider_name, customer.name AS customer_name, customer.email AS customer_email
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN users provider ON provider.id = s.provider_id
       JOIN users customer ON customer.id = b.customer_id
       WHERE ${condition}
       ORDER BY b.booking_date, b.start_time`,
      params
    );
    return res.json(bookings);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', authenticateToken, async (req, res, next) => {
  try {
    const bookingId = Number(req.params.id);
    const { status } = req.body;
    const isCustomerCancellation = req.user.role === 'customer' && status === 'cancelled';
    if (!Number.isInteger(bookingId) || bookingId < 1 ||
        !['confirmed', 'completed', 'cancelled'].includes(status) ||
        (req.user.role !== 'provider' && req.user.role !== 'admin' && !isCustomerCancellation)) {
      return res.status(400).json({ message: 'Invalid booking or status update.' });
    }

    const [bookings] = await db.execute(
      `SELECT b.id, b.customer_id, s.provider_id, b.status AS current_status
       FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ?`,
      [bookingId]
    );
    const booking = bookings[0];
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (req.user.role === 'customer' &&
        (booking.customer_id !== req.user.id || status !== 'cancelled')) {
      return res.status(403).json({ message: 'You may only cancel your own bookings.' });
    }
    if (req.user.role === 'provider' && booking.provider_id !== req.user.id) {
      return res.status(403).json({ message: 'You may only update bookings for your services.' });
    }
    if (booking.current_status === 'completed' || booking.current_status === 'cancelled') {
      return res.status(409).json({ message: 'This booking can no longer be changed.' });
    }

    await db.execute('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);
    return res.json({ message: 'Booking status updated.', status });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
