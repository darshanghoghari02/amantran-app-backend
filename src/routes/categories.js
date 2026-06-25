import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbService } from '../services/db.js';
import { requirePermission, logAuditEvent } from '../middleware/auth.js';
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

const router = express.Router();

// GET all categories (guarded by categories.view)
router.get('/', requirePermission('categories.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('categories');
    // Sort by displayOrder
    list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single category (guarded by categories.view)
router.get('/:id', requirePermission('categories.view'), async (req, res) => {
  try {
    const category = await dbService.getOne('categories', req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create category (guarded by categories.create)
router.post('/', requirePermission('categories.create'), async (req, res) => {
  try {
    const { name, slug, imageUrl, displayOrder, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required fields.' });
    }
    const newCategory = await dbService.add('categories', {
      name,
      slug: slug.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      imageUrl: imageUrl || '',
      displayOrder: parseInt(displayOrder) || 1,
      isActive: isActive !== false
    });
    
    await logAuditEvent(userId, `Created category: ${newCategory.name}`, 'Categories');
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update category (guarded by categories.edit)
router.put('/:id', requirePermission('categories.edit'), async (req, res) => {
  try {
    const { name, slug, imageUrl, displayOrder, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    const categoryToEdit = await dbService.getOne('categories', req.params.id);
    if (!categoryToEdit) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (imageUrl !== undefined) updates.imageUrl = imageUrl;
    if (displayOrder !== undefined) updates.displayOrder = parseInt(displayOrder);
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await dbService.update('categories', req.params.id, updates);

    // Clean up old category image if replaced
    if (imageUrl !== undefined && categoryToEdit.imageUrl && categoryToEdit.imageUrl !== imageUrl) {
      await deleteAssetFile(categoryToEdit.imageUrl);
    }

    await logAuditEvent(userId, `Updated category: ${updated.name}`, 'Categories');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE category (guarded by categories.delete)
router.delete('/:id', requirePermission('categories.delete'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    
    // Step 1: Fetch category to get imageUrl before deleting
    const category = await dbService.getOne('categories', req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    // Check if any template belongs to this category
    const templates = await dbService.getAll('templates');
    const hasTemplates = templates.some(t => t.categoryId === req.params.id);
    if (hasTemplates) {
      return res.status(400).json({ error: 'Cannot delete category because it contains active templates. Please delete or reassign the templates first.' });
    }

    // Step 2: Delete image file from disk
    if (category.imageUrl) {
      await deleteAssetFile(category.imageUrl);
    }

    // Step 2.5: Try to remove category folder from Cloudinary
    if (category.slug) {
      const { deleteFolderFromCloudinary, isCloudinaryConfigured } = await import('../services/cloudinary.js');
      if (isCloudinaryConfigured()) {
        const cloudFolder = `amantran/images/${category.slug}`;
        setTimeout(async () => {
          try {
            await deleteFolderFromCloudinary(cloudFolder);
          } catch (e) {
            console.warn(`⚠️ Failed to delete Cloudinary category folder: ${cloudFolder}`, e.message);
          }
        }, 1500); // 1.5 second delay to let image deletion complete
      }
    }

    // Step 3: Delete DB record
    await dbService.delete('categories', req.params.id);
    await logAuditEvent(userId, `Deleted category: ${category.name}`, 'Categories');
    res.json({ success: true, message: 'Category and its image deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
