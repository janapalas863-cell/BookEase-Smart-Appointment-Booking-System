const express = require('express');
const db = require('../db');
const { authenticateToken, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [services] = await db.execute(
            `SELECT s.id, s.provider_id, s.title, s.description, s.price,
              s.price_min_inr, s.price_max_inr, s.duration_minutes,
              u.name AS provider_name, p.city AS provider_city, p.bio AS provider_bio,
              p.specialty AS provider_specialty, p.photo_url AS provider_photo_url,
              COALESCE(r.average_rating, 0) AS average_rating,
              COALESCE(r.review_count, 0) AS review_count
       FROM services s
       JOIN users u ON u.id = s.provider_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN (
         SELECT provider_id, AVG(rating) AS average_rating, COUNT(*) AS review_count
         FROM reviews GROUP BY provider_id
       ) r ON r.provider_id = u.id
       ORDER BY s.created_at DESC`
    );
    return res.json(services);
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticateToken, allowRoles('provider'), async (req, res, next) => {
  try {
    const { title, description, price, duration_minutes: durationMinutes } = req.body;
    const rawMinimumInr = req.body.price_min_inr;
    const rawMaximumInr = req.body.price_max_inr;
    const hasMinimumInr = rawMinimumInr !== undefined && rawMinimumInr !== null && rawMinimumInr !== '';
    const hasMaximumInr = rawMaximumInr !== undefined && rawMaximumInr !== null && rawMaximumInr !== '';
    const parsedPrice = Number(price);
    const parsedDuration = Number(durationMinutes === undefined ? 30 : durationMinutes);
    const parsedMinimumInr = hasMinimumInr ? Number(rawMinimumInr) : null;
    const parsedMaximumInr = hasMaximumInr ? Number(rawMaximumInr) : null;

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 150 ||
        (description !== undefined && description !== null && typeof description !== 'string') ||
        !Number.isFinite(parsedPrice) || parsedPrice < 0 ||
        !Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440 ||
        hasMinimumInr !== hasMaximumInr ||
        (hasMinimumInr && (!Number.isFinite(parsedMinimumInr) || !Number.isFinite(parsedMaximumInr) ||
          parsedMinimumInr < 0 || parsedMaximumInr < parsedMinimumInr))) {
      return res.status(400).json({ message: 'Provide a title, non-negative prices, and a duration between 1 and 1440 minutes. India prices need a valid minimum and maximum.' });
    }

    const [result] = await db.execute(
      `INSERT INTO services
       (provider_id, title, description, price, price_min_inr, price_max_inr, duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title.trim(), description || null, parsedPrice, parsedMinimumInr, parsedMaximumInr, parsedDuration]
    );
    return res.status(201).json({ id: result.insertId, message: 'Service created.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
