import express from 'express';
import { dbService } from '../services/db.js';
import { deleteFromCloudinary, extractPublicId, isCloudinaryConfigured } from '../services/cloudinary.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { realtimeService } from '../services/realtime.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '../..');
const ASSETS_DIR = path.join(BACKEND_DIR, 'assets');

// Helper to delete old profile image from Cloudinary or local storage
async function deleteOldProfilePhoto(oldPhotoUrl) {
  if (!oldPhotoUrl) return;

  try {
    // If it's a Cloudinary URL, delete from Cloudinary
    if (oldPhotoUrl.includes('res.cloudinary.com')) {
      const publicId = extractPublicId(oldPhotoUrl);
      if (publicId && isCloudinaryConfigured()) {
        await deleteFromCloudinary(publicId);
        console.log(`✅ Deleted old profile photo from Cloudinary: ${publicId}`);
      }
    } else if (oldPhotoUrl.startsWith('https://firebasestorage.googleapis.com')) {
      // Legacy Firebase Storage URL - just log, no action needed
      console.log('ℹ️ Legacy Firebase Storage URL detected, skipping deletion');
    } else if (!oldPhotoUrl.startsWith('http')) {
      // Local file path
      const cleanPath = oldPhotoUrl.startsWith('/') ? oldPhotoUrl.substring(1) : oldPhotoUrl;
      const absolutePath = path.join(BACKEND_DIR, cleanPath);
      
      if (absolutePath.startsWith(ASSETS_DIR) && fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
        console.log(`✅ Deleted old profile photo from local storage: ${absolutePath}`);
      }
    }
  } catch (err) {
    console.warn(`⚠️ Failed to delete old profile photo: ${err.message}`);
  }
}

// Helper to parse dates into ISO string safely
function getSafeDateString(val) {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000).toISOString();
  if (typeof val._seconds === 'number') return new Date(val._seconds * 1000).toISOString();
  if (val instanceof Date) return val.toISOString();
  try {
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

// Helper to check if any user account with matching email or phone is suspended
async function checkSuspension(email, phone) {
  try {
    const list = await dbService.getAll('app_users');
    const targetEmail = email ? email.toLowerCase().trim() : '';
    const targetPhone = phone ? phone.replace(/\D/g, '') : '';

    if (!targetEmail && !targetPhone) return false;

    const matchedSuspended = list.find(u => {
      const isSusp = u.isBlocked === true || u.status === 'Suspended' || u.accountStatus === 'suspended';
      if (!isSusp) return false;

      if (targetEmail && u.email && u.email.toLowerCase().trim() === targetEmail) {
        return true;
      }
      if (targetPhone && u.phone) {
        const p = u.phone.replace(/\D/g, '');
        if (p && (p === targetPhone || p.endsWith(targetPhone) || targetPhone.endsWith(p))) {
          return true;
        }
      }
      return false;
    });

    return !!matchedSuspended;
  } catch (e) {
    console.error('Error in checkSuspension:', e);
    return false;
  }
}

// Middleware to block write requests from suspended users
async function requireActiveUser(req, res, next) {
  try {
    const userId = req.params.uid || req.body.userId || req.query.userId || req.headers['x-user-id'];
    if (!userId) {
      return next(); // Allow request if no user context is detected
    }

    const user = await dbService.getOne('app_users', userId);
    if (user) {
      const isSuspended = await checkSuspension(user.email, user.phone);
      if (isSuspended || user.isBlocked || user.accountStatus === 'suspended') {
        return res.status(403).json({ error: 'Your account has been suspended.' });
      }
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET SSE connection for real-time mobile app updates
router.get('/realtime', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial connection verification event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  realtimeService.addClient(res);

  req.on('close', () => {
    realtimeService.removeClient(res);
  });
});

// GET public app config (brand settings & maintenance status)
router.get('/config', async (req, res) => {
  try {
    const config = await dbService.getOne('settings', 'system_config');
    if (config) {
      return res.json({
        appName: config.appName,
        supportEmail: config.supportEmail,
        maintenanceMode: config.maintenanceMode
      });
    }
    res.json({
      appName: 'Amantran Invitation App CMS',
      supportEmail: 'support@amantran.com',
      maintenanceMode: false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 1. PUBLIC CATALOG DATA
// -------------------------------------------------------------

// GET all categories
router.get('/categories', async (req, res) => {
  try {
    const list = await dbService.getAll('categories');
    list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all languages
router.get('/languages', async (req, res) => {
  try {
    const list = await dbService.getAll('languages');
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all templates
router.get('/templates', async (req, res) => {
  try {
    const list = await dbService.getAll('templates');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single template (including pages & elements)
router.get('/templates/:id', async (req, res) => {
  try {
    const template = await dbService.getOne('templates', req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all fonts
router.get('/fonts', async (req, res) => {
  try {
    const list = await dbService.getAll('fonts');
    const mapped = list.map(f => ({
      id: f.id,
      fontFamily: f.family || f.fontFamily || '',
      fontUrl: f.localPath || f.fontUrl || '',
      isActive: f.isActive !== false
    }));
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET subscription plans
router.get('/subscriptions', async (req, res) => {
  try {
    const list = await dbService.getAll('subscriptions');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// -------------------------------------------------------------
// 2. USER PROFILE & AUTHENTICATION
// -------------------------------------------------------------

// GET resolve user by email or phone
router.get('/users/resolve/find', async (req, res) => {
  try {
    const { email, phone } = req.query;
    if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });

    let matched = null;

    if (email) {
      const targetEmail = email.toLowerCase().trim();
      const results = await dbService.getByField('app_users', 'email', targetEmail);
      if (results && results.length > 0) {
        matched = results[0];
      }
    }

    if (!matched && phone) {
      const targetPhone = phone.replace(/\D/g, '');
      const list = await dbService.getAll('app_users');
      matched = list.find(u => {
        if (!u.phone) return false;
        const p = u.phone.replace(/\D/g, '');
        return p === targetPhone || p.endsWith(targetPhone) || targetPhone.endsWith(p);
      });
    }

    if (matched) {
      // Check for suspension by association
      const isSuspended = await checkSuspension(matched.email, matched.phone);
      if (isSuspended) {
        matched.isBlocked = true;
        matched.accountStatus = 'suspended';
        matched.status = 'Suspended';
      }
      return res.json(matched);
    } else {
      return res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET app user by UID
router.get('/users/:uid', async (req, res) => {
  try {
    const user = await dbService.getOne('app_users', req.params.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check for suspension by association
    const isSuspended = await checkSuspension(user.email, user.phone);
    if (isSuspended) {
      user.isBlocked = true;
      user.accountStatus = 'suspended';
      user.status = 'Suspended';
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all app users (for mobile admin panel)
router.get('/users', async (req, res) => {
  try {
    const list = await dbService.getAll('app_users');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update app user (role/status)
router.put('/users/:uid', async (req, res) => {
  try {
    const { role, accountStatus } = req.body;
    const uid = req.params.uid;
    const existing = await dbService.getOne('app_users', uid);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const updates = {};
    if (role !== undefined) updates.role = role;
    if (accountStatus !== undefined) {
      updates.accountStatus = accountStatus;
      updates.isBlocked = accountStatus === 'suspended';
      updates.status = accountStatus === 'suspended' ? 'Suspended' : 'Active';
    }

    const updated = await dbService.update('app_users', uid, updates);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save user document
router.post('/users', async (req, res) => {
  try {
    const { uid, name, email, phone, profilePhoto, provider, role, accountStatus } = req.body;
    if (!uid) return res.status(400).json({ error: 'uid is required' });

    const existing = await dbService.getOne('app_users', uid);
    const now = new Date().toISOString();

    // Validate unique email
    if (email) {
      const targetEmail = email.toLowerCase().trim();
      if (targetEmail && targetEmail !== 'user@example.com') {
        const results = await dbService.getByField('app_users', 'email', targetEmail);
        const emailExists = results.some(u => (u.uid !== uid && u.id !== uid));
        if (emailExists) {
          return res.status(400).json({ error: 'This email address is already registered with another account.' });
        }
      }
    }

    // Validate unique phone
    if (phone) {
      const targetPhone = phone.replace(/\D/g, '');
      if (targetPhone) {
        const allUsers = await dbService.getAll('app_users');
        const phoneExists = allUsers.some(u => {
          if (u.uid === uid || u.id === uid || !u.phone) return false;
          const p = u.phone.replace(/\D/g, '');
          return p === targetPhone || p.endsWith(targetPhone) || targetPhone.endsWith(p);
        });
        if (phoneExists) {
          return res.status(400).json({ error: 'This phone number is already registered with another account.' });
        }
      }
    }

    const isSuspended = await checkSuspension(email, phone);

    // Delete old profile photo if it's being updated with a new one
    if (existing && profilePhoto !== undefined && profilePhoto !== null && existing.profilePhoto && existing.profilePhoto !== profilePhoto) {
      await deleteOldProfilePhoto(existing.profilePhoto);
    }

    const userData = {
      id: uid,
      uid,
      name: name || (existing ? existing.name : 'New User'),
      email: email || (existing ? existing.email : 'user@example.com'),
      phone: phone !== undefined && phone !== null ? phone : (existing ? (existing.phone || '') : ''),
      profilePhoto: profilePhoto !== undefined && profilePhoto !== null ? profilePhoto : (existing ? (existing.profilePhoto || '') : ''),
      provider: provider || (existing ? existing.provider : 'google'),
      role: role || (existing ? existing.role : 'user'),
      accountStatus: accountStatus || (existing ? existing.accountStatus : (isSuspended ? 'suspended' : 'active')),
      isBlocked: accountStatus === 'suspended' || isSuspended || (existing ? existing.isBlocked : false),
      lastLoginAt: now,
      updatedAt: now
    };

    if (existing) {
      if (existing.accountStatus === 'suspended' || existing.isBlocked || isSuspended) {
        userData.accountStatus = 'suspended';
        userData.isBlocked = true;
      }
      const updated = await dbService.update('app_users', uid, userData);
      res.json(updated);
    } else {
      // Check if self-registration is allowed
      const config = await dbService.getOne('settings', 'system_config');
      if (config && config.allowSelfRegistration === false) {
        return res.status(403).json({ error: 'Public registrations are currently disabled by settings.' });
      }
      const defaultRole = (config && config.defaultUserRole) || 'user';
      userData.role = userData.role || defaultRole;
      userData.createdAt = now;
      const created = await dbService.add('app_users', userData);
      res.status(201).json(created);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET app user profile subcollection fallback
router.get('/users/:uid/profile', async (req, res) => {
  try {
    const user = await dbService.getOne('app_users', req.params.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.profile || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save app user profile
router.post('/users/:uid/profile', requireActiveUser, async (req, res) => {
  try {
    const user = await dbService.getOne('app_users', req.params.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const profile = req.body;

    // Validate unique email
    if (profile.email) {
      const targetEmail = profile.email.toLowerCase().trim();
      if (targetEmail && targetEmail !== 'user@example.com') {
        const results = await dbService.getByField('app_users', 'email', targetEmail);
        const emailExists = results.some(u => (u.uid !== req.params.uid && u.id !== req.params.uid));
        if (emailExists) {
          return res.status(400).json({ error: 'This email address is already registered with another account.' });
        }
      }
    }

    // Validate unique phone
    if (profile.phone) {
      const targetPhone = profile.phone.replace(/\D/g, '');
      if (targetPhone) {
        const allUsers = await dbService.getAll('app_users');
        const phoneExists = allUsers.some(u => {
          if (u.uid === req.params.uid || u.id === req.params.uid || !u.phone) return false;
          const p = u.phone.replace(/\D/g, '');
          return p === targetPhone || p.endsWith(targetPhone) || targetPhone.endsWith(p);
        });
        if (phoneExists) {
          return res.status(400).json({ error: 'This phone number is already registered with another account.' });
        }
      }
    }
    const updated = await dbService.update('app_users', req.params.uid, {
      profile: {
        ...(user.profile || {}),
        ...profile
      }
    });
    res.json(updated.profile || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET app user settings subcollection fallback
router.get('/users/:uid/settings', async (req, res) => {
  try {
    const user = await dbService.getOne('app_users', req.params.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.settings || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save app user settings
router.post('/users/:uid/settings', requireActiveUser, async (req, res) => {
  try {
    const user = await dbService.getOne('app_users', req.params.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const settings = req.body;
    const updated = await dbService.update('app_users', req.params.uid, {
      settings: {
        ...(user.settings || {}),
        ...settings
      }
    });
    res.json(updated.settings || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// -------------------------------------------------------------
// 3. DRAFTS & COMPLETED CARDS
// -------------------------------------------------------------

// GET all drafts for a user
router.get('/drafts/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('user_drafts');
    const userDrafts = list.filter(d => d.userId === req.params.userId);
    res.json(userDrafts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save draft
router.post('/drafts', requireActiveUser, async (req, res) => {
  try {
    const { id, userId, templateId, templateName, customizedData, isDraft, elements, template } = req.body;
    if (!id || !userId) return res.status(400).json({ error: 'id and userId are required' });

    const draftData = {
      id,
      userId,
      templateId: templateId || (template && template.id) || '',
      templateName: templateName || (template && template.title) || '',
      customizedData: customizedData || req.body,
      isDraft: isDraft !== false,
      updatedAt: new Date().toISOString()
    };

    const existing = await dbService.getOne('user_drafts', id);
    if (existing) {
      const updated = await dbService.update('user_drafts', id, draftData);
      res.json(updated);
    } else {
      const created = await dbService.add('user_drafts', draftData);
      res.status(201).json(created);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE draft
router.delete('/drafts/:draftId', async (req, res) => {
  try {
    await dbService.delete('user_drafts', req.params.draftId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all completed cards for a user
router.get('/cards/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('user_cards');
    const userCards = list.filter(c => c.userId === req.params.userId);
    res.json(userCards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save completed card
router.post('/cards', requireActiveUser, async (req, res) => {
  try {
    const { id, userId, templateId, templateName, customizedData, isDraft, elements, template } = req.body;
    if (!id || !userId) return res.status(400).json({ error: 'id and userId are required' });

    const cardData = {
      id,
      userId,
      templateId: templateId || (template && template.id) || '',
      templateName: templateName || (template && template.title) || '',
      customizedData: customizedData || req.body,
      isDraft: isDraft === true,
      updatedAt: new Date().toISOString()
    };

    const existing = await dbService.getOne('user_cards', id);
    if (existing) {
      const updated = await dbService.update('user_cards', id, cardData);
      res.json(updated);
    } else {
      const created = await dbService.add('user_cards', cardData);
      res.status(201).json(created);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE completed card
router.delete('/cards/:cardId', async (req, res) => {
  try {
    await dbService.delete('user_cards', req.params.cardId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// -------------------------------------------------------------
// 4. FAVORITES
// -------------------------------------------------------------

// GET favorite template IDs for a user
router.get('/favorites/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('user_favorites');
    const userFavs = list.filter(f => f.userId === req.params.userId);
    res.json(userFavs.map(f => f.templateId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST toggle favorite
router.post('/favorites', requireActiveUser, async (req, res) => {
  try {
    const { userId, templateId, isFavorite } = req.body;
    if (!userId || !templateId) return res.status(400).json({ error: 'userId and templateId are required' });

    const favId = `${userId}_${templateId}`;
    if (isFavorite) {
      const favData = {
        id: favId,
        userId,
        templateId,
        isFavorite: true,
        updatedAt: new Date().toISOString()
      };
      await dbService.add('user_favorites', favData);
      res.json({ success: true, isFavorite: true });
    } else {
      await dbService.delete('user_favorites', favId);
      res.json({ success: true, isFavorite: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// -------------------------------------------------------------
// 5. GUESTS
// -------------------------------------------------------------

// GET all guests for a user
router.get('/guests/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('guests');
    const userGuests = list.filter(g => g.userId === req.params.userId);
    res.json(userGuests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save/update guest
router.post('/guests', requireActiveUser, async (req, res) => {
  try {
    const { id, userId, name, phone, relation, inviteStatus, updatedAt } = req.body;
    if (!id || !userId) return res.status(400).json({ error: 'id and userId are required' });

    const guestData = {
      id,
      userId,
      name: name || '',
      phone: phone || '',
      relation: relation || '',
      inviteStatus: inviteStatus || 'pending',
      updatedAt: updatedAt || new Date().toISOString()
    };

    const existing = await dbService.getOne('guests', id);
    if (existing) {
      const updated = await dbService.update('guests', id, guestData);
      res.json(updated);
    } else {
      const created = await dbService.add('guests', guestData);
      res.status(201).json(created);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE guest
router.delete('/guests/:guestId', async (req, res) => {
  try {
    await dbService.delete('guests', req.params.guestId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE clear all guests for user
router.delete('/guests/clear/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('guests');
    const userGuests = list.filter(g => g.userId === req.params.userId);
    for (const guest of userGuests) {
      await dbService.delete('guests', guest.id);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// -------------------------------------------------------------
// 6. USER SUBSCRIPTIONS & TRANSACTIONS
// -------------------------------------------------------------

// GET subscription status
router.get('/user-subscriptions/:userId', async (req, res) => {
  try {
    const allSubs = await dbService.getAll('user_subscriptions');
    const userSubs = allSubs.filter(s => s.userId === req.params.userId);

    if (userSubs.length === 0) {
      return res.json({
        planType: 'none',
        type: 'none',
        isActive: false,
        status: 'expired'
      });
    }

    userSubs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
    const sub = userSubs[0];
    res.json(sub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST purchase subscription (mock)
router.post('/user-subscriptions/purchase', requireActiveUser, async (req, res) => {
  try {
    const { userId, planType, price, isTrial } = req.body;
    if (!userId || !planType) return res.status(400).json({ error: 'userId and planType are required' });

    const now = new Date();

    // Deactivate previous active records
    const allSubs = await dbService.getAll('user_subscriptions');
    const activeSubs = allSubs.filter(s => s.userId === userId && s.isActive);
    for (const sub of activeSubs) {
      await dbService.update('user_subscriptions', sub.id, {
        isActive: false,
        status: 'expired',
        updatedAt: now.toISOString()
      });
    }

    let expiry;
    let status;
    let finalPrice;

    if (isTrial) {
      expiry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      status = 'trial';
      finalPrice = 0.0;
    } else {
      status = 'active';
      finalPrice = Number(price) || (planType === 'yearly' ? 499.0 : (planType === 'lifetime' ? 999.0 : 99.0));
      let durationDays = 30;
      if (planType === 'yearly') {
        durationDays = 365;
      } else if (planType === 'lifetime') {
        durationDays = 36500; // 100 years
      }
      expiry = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    const newSub = await dbService.add('user_subscriptions', {
      userId,
      planType,
      type: planType,
      status,
      isActive: true,
      startDate: now.toISOString(),
      expiryDate: expiry.toISOString(),
      amountPaid: finalPrice,
      autoRenew: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    await dbService.add('transactions', {
      userId,
      type: 'subscription',
      amount: finalPrice,
      planId: planType,
      status: 'success',
      timestamp: now.toISOString(),
      details: isTrial ? '3-day trial activated' : 'Mock gateway checkout'
    });

    res.status(201).json(newSub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST cancel subscription
router.post('/user-subscriptions/:userId/cancel', async (req, res) => {
  try {
    const allSubs = await dbService.getAll('user_subscriptions');
    const userSubs = allSubs.filter(s => s.userId === req.params.userId && s.isActive);

    if (userSubs.length === 0) {
      return res.status(400).json({ error: 'No active subscription found to cancel' });
    }

    userSubs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
    const activeSub = userSubs[0];

    const updated = await dbService.update('user_subscriptions', activeSub.id, {
      status: 'cancelled',
      autoRenew: false,
      updatedAt: new Date().toISOString()
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST reactivate subscription
router.post('/user-subscriptions/:userId/reactivate', async (req, res) => {
  try {
    const allSubs = await dbService.getAll('user_subscriptions');
    const userSubs = allSubs.filter(s => s.userId === req.params.userId && s.isActive);

    if (userSubs.length === 0) {
      return res.status(400).json({ error: 'No active subscription found to reactivate' });
    }

    userSubs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
    const activeSub = userSubs[0];

    const updated = await dbService.update('user_subscriptions', activeSub.id, {
      status: 'active',
      autoRenew: true,
      updatedAt: new Date().toISOString()
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST purchase template
router.post('/user-subscriptions/purchase-template', requireActiveUser, async (req, res) => {
  try {
    const { userId, templateId, price } = req.body;
    if (!userId || !templateId) return res.status(400).json({ error: 'userId and templateId are required' });

    const allSubs = await dbService.getAll('user_subscriptions');
    const userSubs = allSubs.filter(s => s.userId === userId);

    let doc;
    let currentPurchased = [];

    if (userSubs.length > 0) {
      userSubs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
      doc = userSubs[0];
      if (doc.purchasedTemplates) {
        currentPurchased = [...doc.purchasedTemplates];
      }
    } else {
      // Create a basic blank document
      doc = await dbService.add('user_subscriptions', {
        userId,
        planType: 'none',
        status: 'expired',
        isActive: false,
        startDate: new Date().toISOString(),
        expiryDate: new Date(0).toISOString(),
        amountPaid: 0.0,
        autoRenew: false,
        purchasedTemplates: []
      });
    }

    if (!currentPurchased.includes(templateId)) {
      currentPurchased.push(templateId);
    }

    const updated = await dbService.update('user_subscriptions', doc.id, {
      purchasedTemplates: currentPurchased,
      updatedAt: new Date().toISOString()
    });

    await dbService.add('transactions', {
      userId,
      type: 'single_purchase',
      amount: Number(price) || 49.0,
      planId: templateId,
      status: 'success',
      timestamp: new Date().toISOString(),
      details: 'Template purchase'
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 6.5. TRANSACTIONS
// -------------------------------------------------------------

// GET transactions for a user
router.get('/transactions/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('transactions');
    const userTxns = list.filter(t => t.userId === req.params.userId);
    res.json(userTxns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 7. RATINGS
// -------------------------------------------------------------

// GET user rating
router.get('/ratings/:userId', async (req, res) => {
  try {
    const rating = await dbService.getOne('ratings', req.params.userId);
    if (!rating) return res.status(404).json({ error: 'Rating not found' });
    res.json(rating);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save user rating
router.post('/ratings', requireActiveUser, async (req, res) => {
  try {
    const { userId, rating, userName, userEmail, userPhone } = req.body;
    if (!userId || !rating) return res.status(400).json({ error: 'userId and rating are required' });

    const ratingData = {
      id: userId,
      userId,
      rating: Number(rating),
      userName: userName || '',
      userEmail: userEmail || '',
      userPhone: userPhone || '',
      updatedAt: new Date().toISOString()
    };

    const existing = await dbService.getOne('ratings', userId);
    if (existing) {
      const updated = await dbService.update('ratings', userId, ratingData);
      res.json(updated);
    } else {
      const created = await dbService.add('ratings', ratingData);
      res.status(201).json(created);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save audit log
router.post('/audit-logs', async (req, res) => {
  try {
    const { userId, type, description, details } = req.body;
    const logData = {
      userId: userId || 'anonymous',
      type: type || 'info',
      description: description || '',
      details: details || {},
      createdAt: new Date().toISOString()
    };
    const created = await dbService.add('audit_logs', logData);
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
