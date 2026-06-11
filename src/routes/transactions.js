import express from 'express';
import { dbService } from '../services/db.js';

const router = express.Router();

// GET all transactions (admin view)
router.get('/', async (req, res) => {
  try {
    const list = await dbService.getAll('transactions');
    // Sort newest first
    const sorted = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(sorted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET transactions by userId
router.get('/user/:userId', async (req, res) => {
  try {
    const list = await dbService.getAll('transactions');
    const userTxns = list
      .filter(t => t.userId === req.params.userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(userTxns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET transaction stats summary (for dashboard)
router.get('/stats/summary', async (req, res) => {
  try {
    const list = await dbService.getAll('transactions');
    const successful = list.filter(t => t.status === 'success');

    const totalRevenue = successful.reduce((sum, t) => sum + (t.amount || 0), 0);
    const subscriptionRevenue = successful
      .filter(t => t.type === 'subscription')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const purchaseRevenue = successful
      .filter(t => t.type === 'single_purchase')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const monthlyCount = successful.filter(t => t.planId === 'monthly').length;
    const yearlyCount = successful.filter(t => t.planId === 'yearly').length;
    const singlePurchaseCount = successful.filter(t => t.type === 'single_purchase').length;

    res.json({
      totalRevenue,
      subscriptionRevenue,
      purchaseRevenue,
      totalTransactions: list.length,
      successfulTransactions: successful.length,
      monthlySubscriptions: monthlyCount,
      yearlySubscriptions: yearlyCount,
      singlePurchases: singlePurchaseCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create transaction log
router.post('/', async (req, res) => {
  try {
    const { userId, userEmail, type, amount, templateId, templateName, planId, status } = req.body;
    if (!userId || !type || amount === undefined) {
      return res.status(400).json({ error: 'userId, type, and amount are required.' });
    }

    const newTransaction = await dbService.add('transactions', {
      userId,
      userEmail: userEmail || '',
      type,
      amount: Number(amount) || 0,
      templateId: templateId || null,
      templateName: templateName || null,
      planId: planId || null,
      status: status || 'success',
      timestamp: new Date().toISOString()
    });

    res.status(201).json(newTransaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
