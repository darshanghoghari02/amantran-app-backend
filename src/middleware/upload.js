import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(BACKEND_DIR, 'assets');

// Setup storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const { type, categorySlug, templateSlug } = req.query;
      let targetDir = ASSETS_DIR;

      if (type === 'font') {
        targetDir = path.join(ASSETS_DIR, 'fonts');
      } else if (type === 'sticker') {
        targetDir = path.join(ASSETS_DIR, 'images', 'stickers');
      } else if (type === 'category') {
        const cat = categorySlug || 'categories';
        targetDir = path.join(ASSETS_DIR, 'images', cat);
      } else if (type === 'template') {
        const cat = categorySlug || 'uncategorized';
        const tpl = templateSlug || 'temp_template';
        targetDir = path.join(ASSETS_DIR, 'images', cat, tpl);
      } else {
        // Default general uploads
        targetDir = path.join(ASSETS_DIR, 'images', 'general');
      }

      // Check if folder exists, if not, create it recursively
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`📁 Dynamically created asset folder: ${targetDir}`);
      }

      cb(null, targetDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const { templateSlug, categorySlug, type } = req.query;
    
    // Clean name logic
    const ext = path.extname(file.originalname).toLowerCase();
    const originalNameClean = path.basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_'); // alphanumeric only

    let prefix = 'asset';
    if (type === 'font') {
      prefix = 'font';
    } else if (type === 'category') {
      prefix = categorySlug || 'category';
    } else if (type === 'template') {
      prefix = templateSlug || 'template';
    }

    // e.g. royal_wedding_bg_1_1716382103445.png
    const uniqueName = `${prefix}_${originalNameClean}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

// File validation
const fileFilter = (req, file, cb) => {
  const allowedExts = /jpeg|jpg|png|webp|gif|ttf|otf|woff|woff2/;
  const extname = allowedExts.test(path.extname(file.originalname).toLowerCase());
  
  // Safely allow standard image or font mimetypes, or octet-stream fallbacks for fonts
  const mimetype = /image|font|octet-stream|x-font|sfnt/.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  
  cb(new Error(`Invalid file type. Only standard images (JPEG, PNG, WEBP) and fonts (TTF, OTF) are allowed!`));
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});
