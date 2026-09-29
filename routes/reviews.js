const express = require('express');
const db = require('../db');
const { authenticateToken, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/latest', async (req, res, next) => {
  try {
    const [reviews] = await db.execute(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS customer_name,
              p.name AS provider_name, s.title AS service_title
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       JOIN users p ON p.id = r.provider_id
       JOIN bookings b ON b.id = r.booking_id
       JOIN services s ON s.id = b.service_id
       ORDER BY r.created_at DESC LIMIT 8`
    );
    return res.json(reviews);
  } catch (error) {
    return next(error);
  }
});

router.get('/mine', authenticateToken, async (req, res, next) => {
  try {
    const [reviews] = await db.execute(
      'SELECT booking_id FROM reviews WHERE customer_id = ?',
      [req.user.id]
    );
    return res.json(reviews);
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticateToken, allowRoles('customer'), async (req, res, next) => {
  const bookingId = Number(req.body.booking_id);
  const rating = Number(req.body.rating);
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
  if (!Number.isInteger(bookingId) || bookingId < 1 || !Number.isInteger(rating) ||
      rating < 1 || rating > 5 || comment.length > 1000) {
    return res.status(400).json({ message: 'Provide a booking, a rating from 1 to 5, and a comment under 1000 characters.' });
  }

  try {
    const [bookings] = await db.execute(
      `SELECT b.id, b.status, s.provider_id
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.id = ? AND b.customer_id = ?`,
      [bookingId, req.user.id]
    );
    const booking = bookings[0];
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });
    if (booking.status !== 'completed') {
      return res.status(400).json({ message: 'Only completed appointments can be reviewed.' });
    }
    await db.execute(
      'INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [bookingId, req.user.id, booking.provider_id, rating, comment || null]
    );
    return res.status(201).json({ message: 'Thanks for sharing your review.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'You have already reviewed this appointment.' });
    }
    return next(error);
  }
});

module.exports = router;