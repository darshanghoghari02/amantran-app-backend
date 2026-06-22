import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Route Imports
import categoryRoutes from './src/routes/categories.js';
import templateRoutes from './src/routes/templates.js';
import fontRoutes from './src/routes/fonts.js';
import languageRoutes from './src/routes/languages.js';
import userRoutes from './src/routes/users.js';
import roleRoutes from './src/routes/roles.js';
import analyticsRoutes from './src/routes/analytics.js';
import uploadRoutes from './src/routes/uploads.js';
import subscriptionRoutes from './src/routes/subscriptions.js';
import userSubscriptionRoutes from './src/routes/user-subscriptions.js';
import ratingsRoutes from './src/routes/ratings.js';
import userPurchaseRoutes from './src/routes/user-purchases.js';
import userDraftRoutes from './src/routes/user-drafts.js';
import transactionRoutes from './src/routes/transactions.js';
import auditLogRoutes from './src/routes/audit-logs.js';
import settingsRoutes from './src/routes/settings.js';
import appMobileRoutes from './src/routes/app-mobile.js';
import authRoutes from './src/routes/auth.js';
import { dbService } from './src/services/db.js';
import { isCloudinaryConfigured } from './src/services/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Handle CORS preflight OPTIONS requests explicitly (must be before all routes)
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

// Setup CORS with open permissions for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: false,
  optionsSuccessStatus: 200
}));

// Ensure CORS headers are always set on every response (belt-and-suspenders for Hostinger proxy)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, Accept, Origin, X-Requested-With');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure required directories exist at startup
const requiredDirs = [
  path.join(__dirname, 'assets', 'images', 'defaults'),
  path.join(__dirname, 'assets', 'images', 'wedding', 'royal_wedding'),
  path.join(__dirname, 'assets', 'images', 'stickers'),
  path.join(__dirname, 'assets', 'fonts')
];

requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Initial directory created: ${dir}`);
  }
});

// Serve assets directory statically (including /static as fallback)
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/static', express.static(path.join(__dirname, 'assets')));

// Create simple placeholders if not present to avoid broken images
const createPlaceholderSvg = (filePath, text, width = 400, height = 300) => {
  if (!fs.existsSync(filePath)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#FAF3F0" stroke="#E6C280" stroke-width="4"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#4A2E35">${text}</text>
    </svg>`;
    fs.writeFileSync(filePath, svg);
    console.log(`🖼️ Created SVG Placeholder: ${filePath}`);
  }
};

// Generate initial placeholder visual assets
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'defaults', 'wedding.png'), 'Wedding Invitations');
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'defaults', 'engagement.png'), 'Engagement Invitations');
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'defaults', 'baby_shower.png'), 'Baby Shower Cards');
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'defaults', 'reception.png'), 'Reception Cards');
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'wedding', 'royal_wedding', 'bg_1.png'), 'Royal Wedding Cover BG', 1080, 1920);
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'wedding', 'royal_wedding', 'bg_2.png'), 'Royal Wedding Details BG', 1080, 1920);
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'wedding', 'royal_wedding', 'ganesh.png'), 'Ganesh Decal', 200, 200);
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'wedding', 'royal_wedding', 'thumbnail.png'), 'Royal Wedding Thumbnail', 360, 640);

// Create Ganesh sticker placeholder
createPlaceholderSvg(path.join(__dirname, 'assets', 'images', 'stickers', 'ganesh.png'), '🌺 Ganesha Sticker 🌺', 200, 200);

// API Route Registrations
app.use('/api/categories', categoryRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/fonts', fontRoutes);
app.use('/api/languages', languageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/user-subscriptions', userSubscriptionRoutes);
app.use('/api/ratings', ratingsRoutes);
app.use('/api/user-purchases', userPurchaseRoutes);
app.use('/api/user-drafts', userDraftRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/settings', settingsRoutes);
// Global Maintenance Mode Middleware for Mobile/Client App routes
app.use(async (req, res, next) => {
  const isMobileEndpoint = req.path.startsWith('/api/app') || req.path.startsWith('/api/auth');
  if (isMobileEndpoint) {
    try {
      const config = await dbService.getOne('settings', 'system_config');
      if (config && config.maintenanceMode === true) {
        return res.status(503).json({
          error: 'The platform is currently offline for scheduled maintenance. Please try again later.',
          maintenance: true
        });
      }
    } catch (err) {
      console.error('Error checking maintenance mode status:', err.message);
    }
  }
  next();
});

app.use('/api/app', appMobileRoutes);
app.use('/api/auth', authRoutes);

// Base route info
app.get('/', async (req, res) => {
  let appName = 'Amantran CMS Admin Backend API';
  let supportEmail = 'support@amantran.com';
  let maintenanceMode = false;

  try {
    const config = await dbService.getOne('settings', 'system_config');
    if (config) {
      appName = config.appName || appName;
      supportEmail = config.supportEmail || supportEmail;
      maintenanceMode = config.maintenanceMode || false;
    }
  } catch (err) {
    console.error('Error fetching settings for base route:', err.message);
  }

  res.json({
    name: appName,
    version: '1.0.0',
    mode: dbService.isMySQL ? 'mysql' : (dbService.isFirebase ? 'firebase' : 'local'),
    isFirebase: dbService.isFirebase,
    isMySQL: dbService.isMySQL,
    status: 'online',
    maintenanceMode,
    supportEmail,
    assetsUrl: `${req.protocol}://${req.get('host')}/assets`
  });
});

// Connection Diagnose Info
app.get('/api/diagnose', (req, res) => {
  res.json({
    isFirebaseConnected: dbService.isFirebase,
    isMySQLConnected: dbService.isMySQL,
    isCloudinaryConfigured: isCloudinaryConfigured(),
    mysqlHost: process.env.DB_HOST || 'localhost',
    mysqlDatabase: process.env.DB_NAME || 'amantran_db',
    connectionError: dbService.connectionError || 'None',
    imageStorage: isCloudinaryConfigured() ? 'Cloudinary (persistent)' : 'Local disk storage (assets/ folder)',
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      hasCloudinaryUrl: !!process.env.CLOUDINARY_URL,
      hasCloudinaryKeys: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
    }
  });
});

import https from 'https';

// Translation proxy endpoint to bypass browser CORS constraints
app.post('/api/translate', async (req, res) => {
  const { text, targetCode, sourceCode } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text parameter is required.' });
  }

  const sl = sourceCode || 'auto';
  const tl = targetCode || 'en';

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

  https.get(url, (apiRes) => {
    let rawData = '';
    apiRes.on('data', (chunk) => { rawData += chunk; });
    apiRes.on('end', () => {
      try {
        const data = JSON.parse(rawData);
        if (data && data[0]) {
          const translatedText = data[0].map((part) => part[0] || '').join('');
          res.json({ translatedText });
        } else {
          res.json({ translatedText: text });
        }
      } catch (err) {
        console.error('💥 Proxy translation parsing error:', err);
        res.json({ translatedText: text });
      }
    });
  }).on('error', (err) => {
    console.error('💥 Proxy translation connection error:', err);
    res.json({ translatedText: text });
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('💥 Backend Error:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'An internal server error occurred.'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Amantran CMS Backend running at http://localhost:${PORT}`);
  console.log(`📂 Storage Provider: Local Disk (assets/ folder)`);
});
// Trigger nodemon reload 5