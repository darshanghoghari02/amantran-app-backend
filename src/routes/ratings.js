import express from 'express';
import { dbService } from '../services/db.js';
import { requirePermission } from '../middleware/auth.js';

const router = express.Router();

// Helper to parse Firestore timestamp to ISO string
function safeDate(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (typeof val._seconds === 'number') return new Date(val._seconds * 1000).toISOString();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000).toISOString();
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

// GET all ratings (admin view - guarded by users.view)
router.get('/', requirePermission('users.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('ratings');
    const normalized = list.map(r => ({
      id: r.id,
      userId: r.userId || '',
      userName: r.userName || r.userEmail || 'Unknown',
      userEmail: r.userEmail || '',
      userPhone: r.userPhone || '',
      rating: Number(r.rating) || 0,
      createdAt: safeDate(r.createdAt) || new Date().toISOString()
    }));
    normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(normalized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ratings for a specific user
router.get('/user/:userId', requirePermission('users.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('ratings');
    const userRatings = list
      .filter(r => r.userId === req.params.userId)
      .map(r => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName || r.userEmail || 'Unknown',
        userEmail: r.userEmail || '',
        userPhone: r.userPhone || '',
        rating: Number(r.rating) || 0,
        createdAt: safeDate(r.createdAt) || new Date().toISOString()
      }));
    userRatings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(userRatings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
