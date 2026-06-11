import express from 'express';
import { dbService } from '../services/db.js';
import { requirePermission } from '../middleware/auth.js';

const router = express.Router();

// GET all audit logs (guarded by roles.view)
router.get('/', requirePermission('roles.view'), async (req, res) => {
  try {
    const logs = await dbService.getAll('audit_logs');
    
    // Sort descending by createdAt
    logs.sort((a, b) => {
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
