import express from 'express';
import { dbService } from '../services/db.js';
import { requirePermission, logAuditEvent } from '../middleware/auth.js';

const router = express.Router();

// GET all languages (guarded by languages.view)
router.get('/', requirePermission('languages.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('languages');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add language (guarded by languages.create)
router.post('/', requirePermission('languages.create'), async (req, res) => {
  try {
    const { code, name, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    if (!code || !name) {
      return res.status(400).json({ error: 'Code and name are required.' });
    }
    const newLang = await dbService.add('languages', {
      code: code.toLowerCase(),
      name,
      isActive: isActive !== false
    });
    
    await logAuditEvent(userId, `Created language: ${newLang.name} (${newLang.code.toUpperCase()})`, 'Languages');
    res.status(201).json(newLang);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update language (guarded by languages.edit)
router.put('/:id', requirePermission('languages.edit'), async (req, res) => {
  try {
    const { code, name, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    const updates = {};
    if (code !== undefined) updates.code = code.toLowerCase();
    if (name !== undefined) updates.name = name;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await dbService.update('languages', req.params.id, updates);
    await logAuditEvent(userId, `Updated language settings for: ${updated.name}`, 'Languages');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE language (guarded by languages.delete)
router.delete('/:id', requirePermission('languages.delete'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const language = await dbService.getOne('languages', req.params.id);
    const nameStr = language ? `${language.name} (${language.code.toUpperCase()})` : req.params.id;
    
    await dbService.delete('languages', req.params.id);
    await logAuditEvent(userId, `Deleted language: ${nameStr}`, 'Languages');
    res.json({ success: true, message: 'Language removed successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
