import express from 'express';
import { dbService } from '../services/db.js';
import { requirePermission, logAuditEvent } from '../middleware/auth.js';

const router = express.Router();

const DEFAULT_SETTINGS = {
  id: 'system_config',
  appName: 'Amantran Invitation App CMS',
  supportEmail: 'support@amantran.com',
  maintenanceMode: false,
  defaultUserRole: 'user',
  allowSelfRegistration: true
};

// GET settings (guarded by settings.view)
router.get('/', requirePermission('settings.view'), async (req, res) => {
  try {
    let config = await dbService.getOne('settings', 'system_config');
    if (!config) {
      config = await dbService.add('settings', DEFAULT_SETTINGS);
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update settings (guarded by settings.edit)
router.put('/', requirePermission('settings.edit'), async (req, res) => {
  try {
    const updates = req.body;
    const userId = req.headers['x-user-id'];
    
    let config = await dbService.getOne('settings', 'system_config');
    if (!config) {
      await dbService.add('settings', { ...DEFAULT_SETTINGS, ...updates });
    } else {
      await dbService.update('settings', 'system_config', updates);
    }
    
    const updated = await dbService.getOne('settings', 'system_config');
    await logAuditEvent(userId, 'Updated system settings', 'Settings');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
