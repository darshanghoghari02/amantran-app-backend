import express from 'express';
import { dbService } from '../services/db.js';
import { requirePermission, getUserPermissions, logAuditEvent } from '../middleware/auth.js';

const router = express.Router();

// Plan seeds if database is empty
const DEFAULT_PLANS = [
  {
    id: 'monthly',
    name: 'Monthly Premium',
    price: 99,
    description: 'Access all monthly premium templates.',
    isActive: true,
    includedCategories: [],
    includedTemplateIds: []
  },
  {
    id: 'yearly',
    name: 'Yearly Premium',
    price: 499,
    description: 'Access all premium templates including yearly exclusives.',
    isActive: true,
    includedCategories: [],
    includedTemplateIds: []
  }
];

// GET all subscription plans (guarded by subscriptions.view)
router.get('/', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    let list = await dbService.getAll('subscriptions');
    
    // Seed default plans if none exist in the database
    if (!list || list.length === 0) {
      console.log('🌱 No subscription plans found. Seeding defaults...');
      list = [];
      for (const plan of DEFAULT_PLANS) {
        const seeded = await dbService.add('subscriptions', plan);
        list.push(seeded);
      }
    }
    
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single subscription plan (guarded by subscriptions.view)
router.get('/:id', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    const plan = await dbService.getOne('subscriptions', req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Subscription plan not found.' });
    }
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update subscription plan (dynamic action-level guards, audit logged)
router.put('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Missing x-user-id header.' });
    }

    const userPerms = await getUserPermissions(userId);
    const isSuperAdmin = userPerms.includes('*');

    const {
      name,
      price,
      description,
      isActive,
      includedCategories,
      includedTemplateIds,
      durationType,
      durationDays,
      customStartDate,
      customEndDate
    } = req.body;

    const planToEdit = await dbService.getOne('subscriptions', req.params.id);
    if (!planToEdit) {
      return res.status(404).json({ error: 'Subscription plan not found.' });
    }

    // Dynamic Permission check
    let requiredPerm = 'subscriptions.edit';
    const isPriceChange = price !== undefined && Number(price) !== planToEdit.price;
    const isStatusChange = isActive !== undefined && isActive !== planToEdit.isActive;

    if (isPriceChange) {
      requiredPerm = 'subscriptions.manage_pricing';
    } else if (isStatusChange) {
      requiredPerm = isActive ? 'subscriptions.activate' : 'subscriptions.deactivate';
    }

    if (!isSuperAdmin && !userPerms.includes(requiredPerm)) {
      return res.status(403).json({ error: `Forbidden. You do not have permission: ${requiredPerm}` });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (price !== undefined) updates.price = Number(price) || 0;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.isActive = isActive === true;
    if (includedCategories !== undefined) updates.includedCategories = Array.isArray(includedCategories) ? includedCategories : [];
    if (includedTemplateIds !== undefined) updates.includedTemplateIds = Array.isArray(includedTemplateIds) ? includedTemplateIds : [];
    if (durationType !== undefined) updates.durationType = durationType;
    if (durationDays !== undefined) updates.durationDays = Number(durationDays) || 30;
    if (customStartDate !== undefined) updates.customStartDate = customStartDate;
    if (customEndDate !== undefined) updates.customEndDate = customEndDate;

    const updated = await dbService.update('subscriptions', req.params.id, updates);
    
    // Audit Logging
    if (isPriceChange) {
      await logAuditEvent(userId, `Updated price of plan ${updated.name} to ${updated.price}`, 'Subscription Management');
    } else if (isStatusChange) {
      await logAuditEvent(userId, `${isActive ? 'Activated' : 'Deactivated'} subscription plan: ${updated.name}`, 'Subscription Management');
    } else {
      await logAuditEvent(userId, `Updated subscription settings for: ${updated.name}`, 'Subscription Management');
    }
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create subscription plan (guarded by subscriptions.create)
router.post('/', requirePermission('subscriptions.create'), async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      isActive,
      includedCategories,
      includedTemplateIds,
      durationType,
      durationDays,
      customStartDate,
      customEndDate
    } = req.body;
    const userId = req.headers['x-user-id'];

    if (!name) {
      return res.status(400).json({ error: 'Name is a required field.' });
    }

    const newPlan = await dbService.add('subscriptions', {
      name,
      price: Number(price) || 0,
      description: description || '',
      isActive: isActive !== false,
      includedCategories: Array.isArray(includedCategories) ? includedCategories : [],
      includedTemplateIds: Array.isArray(includedTemplateIds) ? includedTemplateIds : [],
      durationType: durationType || 'monthly',
      durationDays: durationDays !== undefined ? Number(durationDays) : 30,
      customStartDate: customStartDate || null,
      customEndDate: customEndDate || null
    });

    await logAuditEvent(userId, `Created subscription plan: ${newPlan.name}`, 'Subscription Management');
    res.status(201).json(newPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE subscription plan (guarded by subscriptions.delete)
router.delete('/:id', requirePermission('subscriptions.delete'), async (req, res) => {
  try {
    const plan = await dbService.getOne('subscriptions', req.params.id);
    const userId = req.headers['x-user-id'];
    
    if (!plan) {
      return res.status(404).json({ error: 'Subscription plan not found.' });
    }

    // Check if plan is active on any templates or categories
    if (plan.id === 'monthly') {
      const templates = await dbService.getAll('templates');
      const linked = templates.filter(t => t.includedInMonthlyPlan === true);
      if (linked.length > 0) {
        return res.status(400).json({ 
          error: `Cannot delete plan. It is currently active on ${linked.length} template(s) (e.g. ${linked[0].name}).` 
        });
      }
    } else if (plan.id === 'yearly') {
      const templates = await dbService.getAll('templates');
      const linked = templates.filter(t => t.includedInYearlyPlan === true);
      if (linked.length > 0) {
        return res.status(400).json({ 
          error: `Cannot delete plan. It is currently active on ${linked.length} template(s) (e.g. ${linked[0].name}).` 
        });
      }
    } else {
      // Custom plan
      const hasTemplates = Array.isArray(plan.includedTemplateIds) && plan.includedTemplateIds.length > 0;
      const hasCategories = Array.isArray(plan.includedCategories) && plan.includedCategories.length > 0;
      if (hasTemplates || hasCategories) {
        let details = [];
        if (hasTemplates) details.push(`${plan.includedTemplateIds.length} template(s)`);
        if (hasCategories) details.push(`${plan.includedCategories.length} category/categories`);
        return res.status(400).json({ 
          error: `Cannot delete plan. It is currently active on: ${details.join(', ')}.` 
        });
      }
    }

    await dbService.delete('subscriptions', req.params.id);
    await logAuditEvent(userId, `Deleted subscription plan: ${plan.name}`, 'Subscription Management');
    res.json({ success: true, message: 'Subscription plan deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
