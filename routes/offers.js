const express = require('express');
const db = require('../db');
const { authenticateToken, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [offers] = await db.execute(
      `SELECT id, title, description, code, reward_type, reward_value, ends_at
       FROM offers WHERE active = TRUE
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP())
       ORDER BY id`
    );
    return res.json(offers);
  } catch (error) {
    return next(error);
  }
});

router.get('/loyalty/me', authenticateToken, allowRoles('customer'), async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS completed_appointments
       FROM bookings WHERE customer_id = ? AND status = 'completed'`,
      [req.user.id]
    );
    const completedAppointments = Number(rows[0].completed_appointments);
    return res.json({
      completed_appointments: completedAppointments,
      points: completedAppointments * 10,
      next_reward_at: Math.ceil((completedAppointments + 1) / 5) * 5
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;