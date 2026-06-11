import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbService } from '../services/db.js';
import { requirePermission, logAuditEvent } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(BACKEND_DIR, 'assets');

// Helper: delete a local file safely (only inside assets/)
function deleteLocalFile(filePath) {
  if (!filePath) return;
  try {
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const absolutePath = path.join(BACKEND_DIR, cleanPath);
    if (absolutePath.startsWith(ASSETS_DIR) && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      console.log(`🗑️ Deleted file: ${absolutePath}`);
    }
  } catch (err) {
    console.warn(`⚠️ Could not delete file ${filePath}:`, err.message);
  }
}

const router = express.Router();

// GET all fonts (guarded by fonts.view)
router.get('/', requirePermission('fonts.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('fonts');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add font registry (guarded by fonts.create)
router.post('/', requirePermission('fonts.create'), async (req, res) => {
  try {
    const { family, localPath, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    if (!family || !localPath) {
      return res.status(400).json({ error: 'Family and localPath are required.' });
    }
    const newFont = await dbService.add('fonts', {
      family,
      localPath,
      isActive: isActive !== false
    });
    
    await logAuditEvent(userId, `Added custom typography: ${newFont.family}`, 'Typography & Fonts');
    res.status(201).json(newFont);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update font (guarded by fonts.edit)
router.put('/:id', requirePermission('fonts.edit'), async (req, res) => {
  try {
    const { family, localPath, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    const updates = {};
    if (family !== undefined) updates.family = family;
    if (localPath !== undefined) updates.localPath = localPath;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await dbService.update('fonts', req.params.id, updates);
    await logAuditEvent(userId, `Updated typography settings for: ${updated.family}`, 'Typography & Fonts');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE font (guarded by fonts.delete)
router.delete('/:id', requirePermission('fonts.delete'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    
    // Step 1: Fetch font to get localPath before deleting
    const font = await dbService.getOne('fonts', req.params.id);
    if (!font) {
      return res.status(404).json({ error: 'Font not found.' });
    }

    // Step 2: Delete the font file from disk
    if (font.localPath) {
      deleteLocalFile(font.localPath);
    }

    // Step 3: Delete DB record
    await dbService.delete('fonts', req.params.id);
    await logAuditEvent(userId, `Deleted typography: ${font.family}`, 'Typography & Fonts');
    res.json({ success: true, message: 'Font and its file deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
