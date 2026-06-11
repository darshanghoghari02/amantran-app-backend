import express from 'express';
import { dbService } from '../services/db.js';
import { requirePermission, logAuditEvent } from '../middleware/auth.js';

const router = express.Router();

// Helper to parse dates securely
function safeDate(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (typeof val._seconds === 'number') return new Date(val._seconds * 1000).toISOString();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000).toISOString();
  try { const d = new Date(val); return isNaN(d.getTime()) ? null : d.toISOString(); } catch { return null; }
}

// Helper to check trial eligibility
async function checkTrialEligible(userId) {
  if (dbService.isFirebase) {
    try {
      const snapshot = await dbService.db.collection('user_subscriptions').where('userId', '==', userId).limit(1).get();
      return snapshot.empty;
    } catch (e) {
      console.error('Error checking trial eligibility in Firestore:', e);
    }
  }
  const allSubs = await dbService.getAll('user_subscriptions');
  const userSubs = allSubs.filter(s => s.userId === userId);
  return userSubs.length === 0;
}

// On-the-fly expiry and auto-renewal evaluator
async function getOrUpdateActiveSubscription(userId, preFetchedSubs = null) {
  let userSubs;
  if (preFetchedSubs) {
    userSubs = preFetchedSubs.filter(s => s.userId === userId);
  } else if (dbService.isFirebase) {
    try {
      const snapshot = await dbService.db.collection('user_subscriptions').where('userId', '==', userId).get();
      userSubs = [];
      snapshot.forEach(doc => userSubs.push({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.error('Error querying user subscription in Firestore:', e);
      const allSubs = await dbService.getAll('user_subscriptions');
      userSubs = allSubs.filter(s => s.userId === userId);
    }
  } else {
    const allSubs = await dbService.getAll('user_subscriptions');
    userSubs = allSubs.filter(s => s.userId === userId);
  }

  if (userSubs.length === 0) {
    return {
      planType: 'none',
      type: 'none',
      isActive: false,
      status: 'expired',
      expiryDate: new Date(0).toISOString()
    };
  }

  // Sort newest first
  userSubs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
  const latest = userSubs[0];

  const now = new Date();
  const expiry = new Date(latest.expiryDate);

  if (expiry < now) {
    // Record is past its expiration date
    if ((latest.status === 'active' || latest.status === 'trial') && latest.autoRenew !== false) {
      // AUTO-RENEW: Deactivate old, create new
      await dbService.update('user_subscriptions', latest.id, {
        isActive: false,
        status: 'expired',
        updatedAt: now.toISOString()
      });

      // Find plan details
      const plans = await dbService.getAll('subscriptions');
      const plan = plans.find(p => p.id === latest.planType);
      const price = plan ? plan.price : (latest.planType === 'yearly' ? 499 : 99);
      const durationDays = plan ? (plan.durationDays || 30) : (latest.planType === 'yearly' ? 365 : 30);

      const newExpiry = new Date(expiry.getTime() + durationDays * 24 * 60 * 60 * 1000);

      // Create new sub record
      const newSub = await dbService.add('user_subscriptions', {
        userId,
        planType: latest.planType,
        type: latest.planType,
        status: 'active',
        isActive: true,
        startDate: expiry.toISOString(),
        expiryDate: newExpiry.toISOString(),
        amountPaid: price,
        autoRenew: true
      });

      // Log transaction
      await dbService.add('transactions', {
        userId,
        userEmail: latest.userEmail || '',
        type: 'subscription',
        amount: price,
        planId: latest.planType,
        status: 'success',
        timestamp: now.toISOString()
      });

      return getOrUpdateActiveSubscription(userId);
    } else {
      // Marked as expired
      if (latest.isActive !== false || latest.status !== 'expired') {
        await dbService.update('user_subscriptions', latest.id, {
          isActive: false,
          status: 'expired',
          updatedAt: now.toISOString()
        });
        latest.isActive = false;
        latest.status = 'expired';
      }
    }
  }

  return latest;
}

// GET all user subscriptions (admin view)
router.get('/', requirePermission('users.view'), async (req, res) => {
  try {
    const users = await dbService.getAll('app_users');
    const allSubs = await dbService.getAll('user_subscriptions');
    const allTxns = await dbService.getAll('transactions');

    const resultList = [];

    for (const u of users) {
      // Run dynamic checks for user
      const activeSub = await getOrUpdateActiveSubscription(u.id, allSubs);
      
      const userSubs = allSubs
        .filter(s => s.userId === u.id)
        .sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));

      const userTxns = allTxns
        .filter(t => t.userId === u.id)
        .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));

      if (userSubs.length > 0) {
        resultList.push({
          userId: u.id,
          email: u.email || '',
          displayName: u.displayName || u.phone || 'App User',
          phone: u.phone || '',
          activeSubscription: activeSub,
          history: userSubs,
          transactions: userTxns
        });
      }
    }

    res.json(resultList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET active subscription status by userId
router.get('/:userId', async (req, res) => {
  try {
    const sub = await getOrUpdateActiveSubscription(req.params.userId);
    res.json({
      id: sub.id,
      userId: sub.userId,
      planType: sub.planType,
      type: sub.planType,
      isActive: sub.isActive,
      status: sub.status,
      startDate: safeDate(sub.startDate),
      expiryDate: safeDate(sub.expiryDate),
      amountPaid: Number(sub.amountPaid) || 0,
      autoRenew: sub.autoRenew !== false,
      updatedAt: safeDate(sub.updatedAt)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST sandbox purchase simulation
router.post('/purchase', async (req, res) => {
  try {
    const { userId, planType, amount, userEmail } = req.body;
    if (!userId || !planType) {
      return res.status(400).json({ error: 'userId and planType are required.' });
    }

    const now = new Date();
    const isEligibleForTrial = await checkTrialEligible(userId);

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

    let newSub;
    if (isEligibleForTrial) {
      // First time purchase: Grant 3-day Free Trial
      const trialExpiry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      newSub = await dbService.add('user_subscriptions', {
        userId,
        planType,
        type: planType,
        status: 'trial',
        isActive: true,
        startDate: now.toISOString(),
        expiryDate: trialExpiry.toISOString(),
        amountPaid: 0,
        autoRenew: true,
        userEmail: userEmail || ''
      });

      // Log transaction
      await dbService.add('transactions', {
        userId,
        userEmail: userEmail || '',
        type: 'subscription',
        amount: 0,
        planId: planType,
        status: 'success',
        timestamp: now.toISOString(),
        details: '3-day Free Trial activation'
      });
    } else {
      // Normal purchase or plan change/upgrade
      const plans = await dbService.getAll('subscriptions');
      const plan = plans.find(p => p.id === planType);
      const price = Number(amount) || (plan ? plan.price : (planType === 'yearly' ? 499 : 99));
      const durationDays = plan ? (plan.durationDays || 30) : (planType === 'yearly' ? 365 : 30);
      const expiry = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      newSub = await dbService.add('user_subscriptions', {
        userId,
        planType,
        type: planType,
        status: 'active',
        isActive: true,
        startDate: now.toISOString(),
        expiryDate: expiry.toISOString(),
        amountPaid: price,
        autoRenew: true,
        userEmail: userEmail || ''
      });

      // Log transaction
      await dbService.add('transactions', {
        userId,
        userEmail: userEmail || '',
        type: 'subscription',
        amount: price,
        planId: planType,
        status: 'success',
        timestamp: now.toISOString()
      });
    }

    res.status(201).json(newSub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST cancel subscription
router.post('/:userId/cancel', async (req, res) => {
  try {
    const { userId } = req.params;
    const allSubs = await dbService.getAll('user_subscriptions');
    const userSubs = allSubs.filter(s => s.userId === userId && s.isActive);

    if (userSubs.length === 0) {
      return res.status(400).json({ error: 'No active subscription found to cancel.' });
    }

    userSubs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
    const activeSub = userSubs[0];

    const updated = await dbService.update('user_subscriptions', activeSub.id, {
      status: 'cancelled',
      autoRenew: false,
      updatedAt: new Date().toISOString()
    });

    await dbService.add('transactions', {
      userId,
      userEmail: activeSub.userEmail || '',
      type: 'subscription',
      amount: 0,
      planId: activeSub.planType,
      status: 'success',
      timestamp: new Date().toISOString(),
      details: 'Subscription auto-renew cancelled'
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST assign/create subscription (Admin panel actions)
router.post('/', requirePermission('users.edit'), async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    const { userId, planType, startDate, expiryDate, amountPaid } = req.body;

    if (!userId || !planType || !expiryDate) {
      return res.status(400).json({ error: 'userId, planType, and expiryDate are required.' });
    }

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

    const newSub = await dbService.add('user_subscriptions', {
      userId,
      planType,
      type: planType,
      status: 'active',
      isActive: true,
      startDate: startDate || now.toISOString(),
      expiryDate,
      amountPaid: Number(amountPaid) || 0,
      autoRenew: true,
      updatedAt: now.toISOString()
    });

    await dbService.add('transactions', {
      userId,
      type: 'subscription',
      amount: Number(amountPaid) || 0,
      planId: planType,
      status: 'success',
      timestamp: now.toISOString(),
      details: 'Admin assigned subscription'
    });

    await logAuditEvent(adminUserId, `Admin assigned ${planType} subscription to user: ${userId}`, 'Subscriptions');
    res.status(201).json(newSub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update subscription details manually
router.put('/:id', requirePermission('users.edit'), async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    const updates = {};
    const { planType, startDate, expiryDate, isActive, amountPaid, status, autoRenew } = req.body;

    if (planType !== undefined) { updates.planType = planType; updates.type = planType; }
    if (startDate !== undefined) updates.startDate = startDate;
    if (expiryDate !== undefined) updates.expiryDate = expiryDate;
    if (isActive !== undefined) updates.isActive = isActive === true;
    if (amountPaid !== undefined) updates.amountPaid = Number(amountPaid) || 0;
    if (status !== undefined) updates.status = status;
    if (autoRenew !== undefined) updates.autoRenew = autoRenew === true;
    updates.updatedAt = new Date().toISOString();

    const updated = await dbService.update('user_subscriptions', req.params.id, updates);
    await logAuditEvent(adminUserId, `Admin updated subscription record: ${req.params.id}`, 'Subscriptions');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE delete/expire a subscription record manually
router.delete('/:id', requirePermission('users.edit'), async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    await dbService.update('user_subscriptions', req.params.id, {
      isActive: false,
      status: 'expired',
      updatedAt: new Date().toISOString()
    });
    await logAuditEvent(adminUserId, `Admin deactivated subscription record: ${req.params.id}`, 'Subscriptions');
    res.json({ success: true, message: 'Subscription deactivated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
