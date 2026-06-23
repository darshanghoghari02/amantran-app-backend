import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { upload } from '../middleware/upload.js';
import { dbService } from '../services/db.js';
import { uploadToCloudinary, deleteFromCloudinary, extractPublicId, isCloudinaryConfigured } from '../services/cloudinary.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(BACKEND_DIR, 'assets');

const getUploadsDir = () => {
  if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR;
  const siblingDir = path.resolve(BACKEND_DIR, '..', 'public_html');
  if (fs.existsSync(siblingDir)) return path.join(siblingDir, 'uploads');
  const parentSiblingDir = path.resolve(BACKEND_DIR, '..', '..', 'public_html');
  if (fs.existsSync(parentSiblingDir)) return path.join(parentSiblingDir, 'uploads');
  return path.join(BACKEND_DIR, 'public_html', 'uploads');
};
const UPLOADS_DIR = getUploadsDir();

/**
 * Helper to upload a single local file to Cloudinary and delete temp file on success.
 * Falls back to local path only if Cloudinary is not configured (dev mode).
 */
async function uploadFileToCloud(localFilePath, queryParams) {
  // Build a Cloudinary folder based on the upload type/category/template
  const { type, categorySlug, templateSlug } = queryParams || {};
  let folder = 'amantran/assets';

  if (type === 'font') {
    folder = 'amantran/fonts';
  } else if (type === 'sticker') {
    folder = 'amantran/images/stickers';
  } else if (type === 'category') {
    folder = `amantran/images/${categorySlug || 'categories'}`;
  } else if (type === 'template') {
    let cat = categorySlug || 'uncategorized';
    if (templateSlug) {
      try {
        const templatesList = await dbService.getAll('templates');
        const matchedTemplate = templatesList.find(t => t.slug === templateSlug);
        if (matchedTemplate && matchedTemplate.categoryId) {
          const category = await dbService.getOne('categories', matchedTemplate.categoryId);
          if (category && category.slug) {
            cat = category.slug;
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to dynamically resolve category slug for template upload:', err.message);
      }
    }
    const tpl = templateSlug || 'temp_template';
    folder = `amantran/images/${cat}/${tpl}`;
  } else {
    folder = 'amantran/images/general';
  }

  if (!isCloudinaryConfigured()) {
    console.warn('⚠️ Cloudinary is NOT configured. Saving to local disk as fallback (images will be lost on Render restart!).');
    return null;
  }

  try {
    const result = await uploadToCloudinary(localFilePath, folder);

    // Clean up local temp file after successful cloud upload
    try {
      fs.unlinkSync(localFilePath);
    } catch (e) {
      console.warn(`⚠️ Failed to delete local temp file at ${localFilePath}:`, e.message);
    }

    console.log(`☁️ Cloudinary upload success: ${result.secureUrl}`);
    return result.secureUrl;
  } catch (err) {
    console.error('⚠️ Cloudinary upload FAILED:', err.message);
    // In production, we should NOT silently fall back - the image will be lost on restart
    // Throw error so the client knows the upload failed
    throw new Error(`Cloud upload failed: ${err.message}. Please check Cloudinary configuration.`);
  }
}

// Endpoint: POST upload single file
router.post('/single', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
      // Upload to Cloudinary
      const cloudUrl = await uploadFileToCloud(req.file.path, req.query);

      if (cloudUrl) {
        return res.json({
          success: true,
          message: 'File uploaded successfully to Cloudinary!',
          filePath: cloudUrl,
          flutterPath: cloudUrl,
          fileName: req.file.filename,
          size: req.file.size
        });
      }
    } catch (cloudErr) {
      // If Cloudinary is configured but upload failed, return error (don't silently fallback)
      if (isCloudinaryConfigured()) {
        // Clean up local temp file
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(500).json({
          error: cloudErr.message,
          hint: 'Cloudinary upload failed. Please verify your CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET environment variables.'
        });
      }
    }

    // Fallback: Local disk path resolution (only when Cloudinary is NOT configured — dev mode)
    const webUrl = `/uploads/${req.file.filename}`;
    const flutterPath = `uploads/${req.file.filename}`;

    res.json({
      success: true,
      message: 'File uploaded to permanent local storage.',
      filePath: webUrl,
      flutterPath: flutterPath,
      fileName: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: POST upload multiple files
router.post('/multiple', upload.array('files', 15), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const uploadedFiles = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const cloudUrl = await uploadFileToCloud(file.path, req.query);

        if (cloudUrl) {
          uploadedFiles.push({
            filePath: cloudUrl,
            flutterPath: cloudUrl,
            fileName: file.filename,
            size: file.size
          });
        } else {
          // Cloudinary not configured — local fallback (dev mode)
          const webUrl = `/uploads/${file.filename}`;
          uploadedFiles.push({
            filePath: webUrl,
            flutterPath: webUrl,
            fileName: file.filename,
            size: file.size
          });
        }
      } catch (uploadErr) {
        errors.push({ fileName: file.filename, error: uploadErr.message });
        // Clean up temp file on failed cloud upload
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }

    if (uploadedFiles.length === 0 && errors.length > 0) {
      return res.status(500).json({
        error: 'All file uploads failed.',
        details: errors
      });
    }

    res.json({
      success: true,
      message: `${uploadedFiles.length} files uploaded successfully!${errors.length > 0 ? ` (${errors.length} failed)` : ''}`,
      files: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: DELETE remove an asset file
router.delete('/', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath parameter is required.' });
    }

    // If it's a Cloudinary URL, delete from Cloudinary
    if (filePath.includes('res.cloudinary.com')) {
      const publicId = extractPublicId(filePath);
      if (publicId) {
        const deleted = await deleteFromCloudinary(publicId);
        return res.json({
          success: true,
          message: deleted
            ? `Cloudinary file ${publicId} deleted successfully.`
            : `Cloudinary file ${publicId} not found or already deleted.`
        });
      }
      return res.status(400).json({ error: 'Could not extract public_id from Cloudinary URL.' });
    }

    // If it's a Firebase Storage URL (legacy), just acknowledge
    if (filePath.startsWith('https://firebasestorage.googleapis.com')) {
      return res.json({
        success: true,
        message: 'Legacy Firebase Storage URL acknowledged. No action taken (images are now on Cloudinary).'
      });
    }

    // Fallback: Delete local file
    let absolutePath;
    if (filePath.startsWith('/uploads/') || filePath.startsWith('uploads/')) {
      const filename = path.basename(filePath);
      absolutePath = path.join(UPLOADS_DIR, filename);
    } else {
      const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
      absolutePath = path.join(BACKEND_DIR, cleanPath);
      
      // Safety guard for legacy assets
      if (!absolutePath.startsWith(ASSETS_DIR)) {
        return res.status(403).json({ error: 'Access denied. You can only delete files inside the assets directory.' });
      }
    }

    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      res.json({ success: true, message: `File at ${filePath} deleted successfully.` });
    } else {
      res.status(404).json({ error: `File at ${filePath} does not exist.` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: GET /status — check Cloudinary configuration status
router.get('/status', (req, res) => {
  res.json({
    cloudinaryConfigured: isCloudinaryConfigured(),
    message: isCloudinaryConfigured()
      ? '✅ Cloudinary is configured and ready for uploads.'
      : '⚠️ Cloudinary is NOT configured. Uploads will go to ephemeral local disk. Set CLOUDINARY_URL env variable.'
  });
});

export default router;
