const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
const imageExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    callback(null, Object.hasOwn(imageExtensions, file.mimetype));
  }
});

function parseProfilePhoto(req, res, next) {
  photoUpload.single('photo')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ message: status === 413 ? 'Profile photos must be 5 MB or smaller.' : 'Choose one profile photo to upload.' });
    }
    return next(error);
  });
}

function imageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function isStoredPhoto(photoUrl, userId) {
  return typeof photoUrl === 'string' &&
    new RegExp(`^/uploads/profile-${userId}-[a-f0-9-]+\\.(jpg|png|webp)$`).test(photoUrl);
}

router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role, p.phone, p.city, p.bio, p.specialty, p.photo_url
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
      [req.user.id]
    );
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.put('/me', authenticateToken, async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const city = typeof req.body.city === 'string' ? req.body.city.trim() : '';
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
  const specialty = typeof req.body.specialty === 'string' ? req.body.specialty.trim() : '';
  const photoUrl = typeof req.body.photo_url === 'string' ? req.body.photo_url.trim() : '';

  if (!name || name.length > 100 || phone.length > 30 || city.length > 100 ||
      bio.length > 1000 || specialty.length > 120 || photoUrl.length > 2048) {
    return res.status(400).json({ message: 'Check the profile fields and their maximum lengths.' });
  }
  if (photoUrl) {
    try {
      if (!['https:', 'http:'].includes(new URL(photoUrl).protocol)) throw new Error();
    } catch {
      return res.status(400).json({ message: 'Profile photo must be a valid http or https URL.' });
    }
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
    await connection.execute(
      `INSERT INTO user_profiles (user_id, phone, city, bio, specialty, photo_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE phone = VALUES(phone), city = VALUES(city), bio = VALUES(bio),
         specialty = VALUES(specialty), photo_url = VALUES(photo_url)`,
      [req.user.id, phone || null, city || null, bio || null, specialty || null, photoUrl || null]
    );
    await connection.commit();
    return res.json({ message: 'Profile updated.', name });
  } catch (error) {
    if (connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }
});

router.post('/me/photo', authenticateToken, parseProfilePhoto, async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Choose a JPEG, PNG, or WebP image.' });
  }

  const extension = imageExtension(req.file.buffer);
  if (!extension || imageExtensions[req.file.mimetype] !== extension) {
    return res.status(400).json({ message: 'The uploaded file does not contain a supported image.' });
  }

  const filename = `profile-${req.user.id}-${randomUUID()}.${extension}`;
  const filePath = path.join(uploadDirectory, filename);
  let fileWritten = false;
  try {
    await fs.mkdir(uploadDirectory, { recursive: true });
    await fs.writeFile(filePath, req.file.buffer, { flag: 'wx' });
    fileWritten = true;
    const [profiles] = await db.execute(
      'SELECT photo_url FROM user_profiles WHERE user_id = ?',
      [req.user.id]
    );
    const photoUrl = `/uploads/${filename}`;
    await db.execute(
      `INSERT INTO user_profiles (user_id, photo_url) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE photo_url = VALUES(photo_url)`,
      [req.user.id, photoUrl]
    );
    if (profiles[0] && isStoredPhoto(profiles[0].photo_url, req.user.id)) {
      await fs.unlink(path.join(uploadDirectory, path.basename(profiles[0].photo_url))).catch(() => {});
    }
    return res.json({ message: 'Profile photo uploaded.', photo_url: photoUrl });
  } catch (error) {
    if (fileWritten) await fs.unlink(filePath).catch(() => {});
    return next(error);
  }
});

router.get('/stylists', async (req, res, next) => {
  try {
    const [stylists] = await db.execute(
      `SELECT u.id, u.name, p.city, p.bio, p.specialty, p.photo_url,
              COALESCE(r.average_rating, 0) AS average_rating,
              COALESCE(r.review_count, 0) AS review_count
       FROM users u
       JOIN (SELECT DISTINCT provider_id FROM services) listed ON listed.provider_id = u.id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN (
         SELECT provider_id, AVG(rating) AS average_rating, COUNT(*) AS review_count
         FROM reviews GROUP BY provider_id
       ) r ON r.provider_id = u.id
       WHERE u.role = 'provider' ORDER BY r.average_rating DESC, u.name`
    );
    return res.json(stylists);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;