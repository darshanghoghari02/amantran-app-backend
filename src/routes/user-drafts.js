import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbService } from '../services/db.js';
import { deleteFromCloudinary, extractPublicId } from '../services/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(BACKEND_DIR, 'assets');

// Helper: delete a single asset file safely (supports Cloudinary, Firebase, and local files)
async function deleteAssetFile(filePath) {
  if (!filePath) return;
  try {
    // Handle Cloudinary URLs
    if (filePath.includes('res.cloudinary.com')) {
      const publicId = extractPublicId(filePath);
      if (publicId) {
        await deleteFromCloudinary(publicId);
        console.log(`☁️ Deleted Cloudinary asset: ${publicId}`);
      }
      return;
    }

    // Handle Firebase Storage URLs (legacy — just log, no action needed)
    if (filePath.startsWith('https://firebasestorage.googleapis.com')) {
      console.log(`⏭️ Skipping legacy Firebase Storage URL: ${filePath}`);
      return;
    }

    // Handle local files
    let relativePath = filePath;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      try {
        const urlObj = new URL(filePath);
        relativePath = urlObj.pathname;
      } catch (e) {
        // ignore parsing error
      }
    }
    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    const absolutePath = path.join(BACKEND_DIR, cleanPath);
    if (absolutePath.startsWith(ASSETS_DIR) && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      console.log(`🗑️ Deleted local file: ${absolutePath}`);
    }
  } catch (err) {
    console.warn(`⚠️ Could not delete file ${filePath}:`, err.message);
  }
}

// Helper: collect all assets/images from a user draft customizedData object
function collectDraftAssets(draft) {
  const paths = new Set();
  if (!draft || !draft.customizedData) return paths;

  const data = draft.customizedData;

  const isUserAsset = (p) => {
    if (!p) return false;
    if (p.includes('res.cloudinary.com')) return true;
    if (p.includes('/images/') && !p.includes('/stickers/') && !p.includes('/defaults/')) return true;
    return false;
  };

  if (data.thumbnail && isUserAsset(data.thumbnail)) paths.add(data.thumbnail);
  if (Array.isArray(data.previewImages)) {
    data.previewImages.forEach(p => { if (isUserAsset(p)) paths.add(p); });
  }

  // Dynamic scanning: find any background images or element images in the pages array
  if (Array.isArray(data.pages)) {
    data.pages.forEach(page => {
      if (page.backgroundImage && isUserAsset(page.backgroundImage)) {
        paths.add(page.backgroundImage);
      }
      if (Array.isArray(page.elements)) {
        page.elements.forEach(elem => {
          if (elem.imagePath && isUserAsset(elem.imagePath)) {
            paths.add(elem.imagePath);
          }
          if (elem.imageUrl && isUserAsset(elem.imageUrl)) {
            paths.add(elem.imageUrl);
          }
        });
      }
    });
  }
  return paths;
}

const router = express.Router();

// GET all drafts (admin view, read-only)
router.get('/', async (req, res) => {
  try {
    const list = await dbService.getAll('user_drafts');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all drafts for a user
router.get('/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('user_drafts');
    const userDrafts = list.filter(d => d.userId === req.params.userId);
    res.json(userDrafts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single draft by draftId
router.get('/single/:draftId', async (req, res) => {
  try {
    const draft = await dbService.getOne('user_drafts', req.params.draftId);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    res.json(draft);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save new draft
router.post('/', async (req, res) => {
  try {
    const { userId, templateId, templateName, customizedData, isPurchased } = req.body;
    if (!userId || !templateId) {
      return res.status(400).json({ error: 'userId and templateId are required.' });
    }

    const newDraft = await dbService.add('user_drafts', {
      userId,
      templateId,
      templateName: templateName || '',
      customizedData: customizedData || {},
      isPurchased: isPurchased === true,
      savedAt: new Date().toISOString()
    });

    res.status(201).json(newDraft);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update draft (auto-save)
router.put('/:draftId', async (req, res) => {
  try {
    const draftToEdit = await dbService.getOne('user_drafts', req.params.draftId);
    if (!draftToEdit) {
      return res.status(404).json({ error: 'Draft not found.' });
    }

    const oldAssets = collectDraftAssets(draftToEdit);

    const updates = {};
    const { customizedData, isPurchased } = req.body;
    if (customizedData !== undefined) updates.customizedData = customizedData;
    if (isPurchased !== undefined) updates.isPurchased = isPurchased === true;
    updates.savedAt = new Date().toISOString();

    const updated = await dbService.update('user_drafts', req.params.draftId, updates);

    // Collect new assets and clean up obsolete ones
    const newAssets = collectDraftAssets(updated);
    const deletedAssets = [...oldAssets].filter(filePath => !newAssets.has(filePath));
    if (deletedAssets.length > 0) {
      const deletePromises = deletedAssets.map(filePath => deleteAssetFile(filePath));
      await Promise.allSettled(deletePromises);
      console.log(`🧹 Cleaned up ${deletedAssets.length} obsolete draft assets.`);
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE draft
router.delete('/:draftId', async (req, res) => {
  try {
    const draft = await dbService.getOne('user_drafts', req.params.draftId);
    if (draft) {
      const allPaths = collectDraftAssets(draft);
      const deletePromises = [];
      allPaths.forEach(filePath => deletePromises.push(deleteAssetFile(filePath)));
      await Promise.allSettled(deletePromises);
    }

    await dbService.delete('user_drafts', req.params.draftId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
