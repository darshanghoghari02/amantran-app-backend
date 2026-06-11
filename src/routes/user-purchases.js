import express from 'express';
import { dbService } from '../services/db.js';

const router = express.Router();

// GET all purchases (admin view)
router.get('/', async (req, res) => {
  try {
    const list = await dbService.getAll('user_purchases');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all purchases by userId
router.get('/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('user_purchases');
    const userPurchases = list.filter(p => p.userId === req.params.userId);
    res.json(userPurchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET check if user has purchased a specific template
router.get('/:userId/check/:templateId', async (req, res) => {
  try {
    const list = await dbService.getAll('user_purchases');
    const purchased = list.find(
      p => p.userId === req.params.userId && p.templateId === req.params.templateId
    );
    res.json({ purchased: !!purchased, purchase: purchased || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create purchase record
router.post('/', async (req, res) => {
  try {
    const { userId, templateId, templateName, amountPaid } = req.body;
    if (!userId || !templateId) {
      return res.status(400).json({ error: 'userId and templateId are required.' });
    }

    // Check if already purchased
    const existing = await dbService.getAll('user_purchases');
    const alreadyPurchased = existing.find(
      p => p.userId === userId && p.templateId === templateId
    );
    if (alreadyPurchased) {
      return res.status(409).json({ error: 'Template already purchased by this user.', purchase: alreadyPurchased });
    }

    const newPurchase = await dbService.add('user_purchases', {
      userId,
      templateId,
      templateName: templateName || '',
      amountPaid: Number(amountPaid) || 0,
      purchasedAt: new Date().toISOString()
    });

    res.status(201).json(newPurchase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove purchase (admin revoke)
router.delete('/:id', async (req, res) => {
  try {
    await dbService.delete('user_purchases', req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
