import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbService } from '../services/db.js';
import { requirePermission, getUserPermissions, logAuditEvent } from '../middleware/auth.js';
import { deleteFromCloudinary, extractPublicId } from '../services/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(BACKEND_DIR, 'assets');

// Helper: delete a single asset file safely (supports Cloudinary URLs, Firebase URLs, and local files)
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

// Helper: try to remove a directory if it's empty
function tryRemoveEmptyDir(dirPath) {
  try {
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
      console.log(`📁 Removed empty folder: ${dirPath}`);
    }
  } catch (err) {
    // ignore — not critical
  }
}

// Helper: collect all assets/images from a template object
function collectTemplateAssets(template) {
  const paths = new Set();
  if (!template) return paths;

  // localAssetPaths has the canonical list (flutter-style paths)
  if (Array.isArray(template.localAssetPaths)) {
    template.localAssetPaths.forEach(p => { if (p) paths.add(p); });
  }
  // Also include thumbnail and previewImages in case they differ
  if (template.thumbnail) paths.add(template.thumbnail);
  if (Array.isArray(template.previewImages)) {
    template.previewImages.forEach(p => { if (p) paths.add(p); });
  }

  // Dynamic scanning: find any background images or custom sticker/ganesh images in the pages array
  if (Array.isArray(template.pages)) {
    template.pages.forEach(page => {
      if (page.backgroundImage) {
        paths.add(page.backgroundImage);
      }
      if (Array.isArray(page.elements)) {
        page.elements.forEach(elem => {
          // Include custom element stickers or uploaded overlay images
          if (elem.imagePath && (elem.imagePath.includes(`/${template.slug}/`) || elem.imagePath.includes('res.cloudinary.com'))) {
            paths.add(elem.imagePath);
          }
          if (elem.imageUrl && (elem.imageUrl.includes(`/${template.slug}/`) || elem.imageUrl.includes('res.cloudinary.com'))) {
            paths.add(elem.imageUrl);
          }
        });
      }
    });
  }
  return paths;
}

const router = express.Router();

// GET all templates (guarded by templates.view)
router.get('/', requirePermission('templates.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('templates');
    const activeLangs = await dbService.getAll('languages');
    const activeNames = activeLangs.filter(l => l.isActive).map(l => l.name);
    if (!activeNames.includes('English')) activeNames.push('English');

    let filtered = list;
    const { categoryId } = req.query;
    if (categoryId) {
      filtered = list.filter(t => t.categoryId === categoryId);
    }

    const cleaned = filtered.map(t => {
      if (t.languages) {
        t.languages = t.languages.filter(lang => activeNames.includes(lang));
      }
      return t;
    });

    res.json(cleaned);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single template (guarded by templates.view)
router.get('/:id', requirePermission('templates.view'), async (req, res) => {
  try {
    const template = await dbService.getOne('templates', req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const activeLangs = await dbService.getAll('languages');
    const activeNames = activeLangs.filter(l => l.isActive).map(l => l.name);
    if (!activeNames.includes('English')) activeNames.push('English');

    if (template.languages) {
      template.languages = template.languages.filter(lang => activeNames.includes(lang));
    }

    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create template (guarded by templates.create)
router.post('/', requirePermission('templates.create'), async (req, res) => {
  try {
    const {
      categoryId,
      name,
      slug,
      thumbnail,
      previewImages,
      localAssetPaths,
      isPremium,
      isActive,
      fonts,
      languages,
      pages,
      singlePurchasePrice,
      includedInMonthlyPlan,
      includedInYearlyPlan
    } = req.body;
    const userId = req.headers['x-user-id'];

    if (!categoryId || !name || !slug) {
      return res.status(400).json({ error: 'Category, name, and slug are required fields.' });
    }

    const newTemplate = await dbService.add('templates', {
      categoryId,
      name,
      slug: slug.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      thumbnail: thumbnail || '',
      previewImages: previewImages || [],
      localAssetPaths: localAssetPaths || [],
      isPremium: isPremium === true,
      isActive: isActive !== false,
      fonts: fonts || [],
      languages: languages || [],
      pages: pages || [],
      singlePurchasePrice: singlePurchasePrice !== undefined ? Number(singlePurchasePrice) : 49,
      includedInMonthlyPlan: includedInMonthlyPlan !== false,
      includedInYearlyPlan: includedInYearlyPlan !== false
    });

    await logAuditEvent(userId, `Created template: ${newTemplate.name}`, 'Templates');
    res.status(201).json(newTemplate);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update template (dynamic action-level guards, audit logged)
router.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Missing x-user-id header.' });
    }

    const userPerms = await getUserPermissions(userId);
    const isSuperAdmin = userPerms.includes('*');

    const {
      categoryId,
      name,
      slug,
      thumbnail,
      previewImages,
      localAssetPaths,
      isPremium,
      isActive,
      fonts,
      languages,
      pages,
      singlePurchasePrice,
      includedInMonthlyPlan,
      includedInYearlyPlan
    } = req.body;

    const templateToEdit = await dbService.getOne('templates', req.params.id);
    if (!templateToEdit) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    // Collect existing assets before applying updates
    const oldAssets = collectTemplateAssets(templateToEdit);

    // Dynamic Permission check
    let requiredPerm = 'templates.edit';
    const isPublishChange = isActive !== undefined && isActive !== templateToEdit.isActive;
    
    if (isPublishChange) {
      requiredPerm = isActive ? 'templates.publish' : 'templates.unpublish';
    }

    if (!isSuperAdmin && !userPerms.includes(requiredPerm)) {
      return res.status(403).json({ error: `Forbidden. You do not have permission: ${requiredPerm}` });
    }

    const updates = {};
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (thumbnail !== undefined) updates.thumbnail = thumbnail;
    if (previewImages !== undefined) updates.previewImages = previewImages;
    if (localAssetPaths !== undefined) updates.localAssetPaths = localAssetPaths;
    if (isPremium !== undefined) updates.isPremium = isPremium;
    if (isActive !== undefined) updates.isActive = isActive;
    if (fonts !== undefined) updates.fonts = fonts;
    if (languages !== undefined) updates.languages = languages;
    if (pages !== undefined) updates.pages = pages;
    if (singlePurchasePrice !== undefined) updates.singlePurchasePrice = Number(singlePurchasePrice) || 0;
    if (includedInMonthlyPlan !== undefined) updates.includedInMonthlyPlan = includedInMonthlyPlan === true;
    if (includedInYearlyPlan !== undefined) updates.includedInYearlyPlan = includedInYearlyPlan === true;

    const updated = await dbService.update('templates', req.params.id, updates);

    // Collect assets after update and delete obsolete ones
    const newAssets = collectTemplateAssets(updated);
    const deletedAssets = [...oldAssets].filter(filePath => !newAssets.has(filePath));
    if (deletedAssets.length > 0) {
      const deletePromises = deletedAssets.map(filePath => deleteAssetFile(filePath));
      await Promise.allSettled(deletePromises);
      console.log(`🧹 Cleaned up ${deletedAssets.length} obsolete template assets.`);
    }
    
    if (isPublishChange) {
      await logAuditEvent(userId, `${isActive ? 'Published' : 'Unpublished'} template: ${updated.name}`, 'Templates');
    } else {
      await logAuditEvent(userId, `Updated template: ${updated.name}`, 'Templates');
    }
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST duplicate template (guarded by templates.create)
router.post('/:id/duplicate', requirePermission('templates.create'), async (req, res) => {
  try {
    const original = await dbService.getOne('templates', req.params.id);
    const userId = req.headers['x-user-id'];
    
    if (!original) {
      return res.status(404).json({ error: 'Original template not found' });
    }

    const uniqueId = `tpl_${Math.random().toString(36).substr(2, 9)}`;
    const clonedTemplate = {
      ...original,
      id: uniqueId,
      name: `${original.name} (Copy)`,
      slug: `${original.slug}_copy_${Date.now()}`,
      isActive: false // duplicated templates are draft by default
    };

    delete clonedTemplate.createdAt;
    delete clonedTemplate.updatedAt;

    const savedClone = await dbService.add('templates', clonedTemplate);
    await logAuditEvent(userId, `Cloned template: ${original.name} into ${savedClone.name}`, 'Templates');
    res.status(201).json(savedClone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE template (guarded by templates.delete)
router.delete('/:id', requirePermission('templates.delete'), async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    // Step 1: Fetch template to get all asset paths before deleting
    const template = await dbService.getOne('templates', req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    // Step 2: Collect all file paths to delete
    const allPaths = collectTemplateAssets(template);

    // Step 3: Delete each file (supports Cloudinary, Firebase, and local)
    const deletePromises = [];
    allPaths.forEach(filePath => deletePromises.push(deleteAssetFile(filePath)));
    await Promise.allSettled(deletePromises);

    // Step 4: Try to remove the now-empty template folder (local only)
    if (template.slug) {
      // Template images are stored under assets/images/<categorySlug>/<templateSlug>/
      // Find the category to get its slug
      const category = await dbService.getOne('categories', template.categoryId).catch(() => null);
      if (category?.slug) {
        const templateDir = path.join(BACKEND_DIR, 'assets', 'images', category.slug, template.slug);
        tryRemoveEmptyDir(templateDir);
      }
    }

    // Step 5: Delete DB record (including recursive Firestore subcollections)
    await dbService.delete('templates', req.params.id);
    await logAuditEvent(userId, `Deleted template: ${template.name}`, 'Templates');
    res.json({
      success: true,
      message: `Template deleted. ${allPaths.size} asset file(s) cleaned up.`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
