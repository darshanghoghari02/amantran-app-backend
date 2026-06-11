import express from 'express';
import { dbService } from '../services/db.js';

const router = express.Router();

// GET dashboard statistics summary
router.get('/summary', async (req, res) => {
  try {
    const templates = await dbService.getAll('templates');
    const categories = await dbService.getAll('categories');
    const users = await dbService.getAll('app_users');
    const drafts = await dbService.getAll('user_drafts').catch(() => []);
    const transactions = await dbService.getAll('transactions').catch(() => []);
    const purchases = await dbService.getAll('user_purchases').catch(() => []);

    const totalTemplates = templates.length;
    const totalCategories = categories.length;
    const totalUsers = users.length;

    const premiumTemplates = templates.filter(t => t.isPremium).length;
    const activeUsersCount = users.filter(u => !u.isBlocked).length;
    const totalDrafts = drafts.length;

    // Aggregate invitation counts from user metadata
    let totalInvitations = 0;
    users.forEach(u => {
      totalInvitations += u.invitationCount || 0;
    });

    // 1. Generate real recent activities from transactions, templates, users, and drafts
    const activities = [];

    // Add templates
    templates.forEach(t => {
      if (t.createdAt) {
        activities.push({
          id: `tpl_${t.id}`,
          user: 'Admin',
          action: `Published template "${t.name}" (${t.isPremium ? 'Premium' : 'Free'})`,
          timestamp: new Date(t.createdAt)
        });
      }
    });

    // Add users
    users.forEach(u => {
      if (u.createdAt) {
        activities.push({
          id: `usr_${u.id}`,
          user: 'System',
          action: `New user registered: ${u.displayName || u.email}`,
          timestamp: new Date(u.createdAt)
        });
      }
    });

    // Add transactions
    transactions.forEach(tx => {
      const timeVal = tx.timestamp || tx.createdAt;
      if (timeVal) {
        activities.push({
          id: `tx_${tx.id}`,
          user: tx.userEmail || 'User',
          action: tx.type === 'subscription' 
            ? `Purchased ${tx.planId} subscription plan (₹${tx.amount})`
            : `Purchased template "${tx.templateName || 'invitation'}" (₹${tx.amount})`,
          timestamp: new Date(timeVal)
        });
      }
    });

    // Add drafts
    drafts.forEach(d => {
      const timeVal = d.savedAt || d.createdAt;
      if (timeVal) {
        activities.push({
          id: `drf_${d.id}`,
          user: `User ID: ${d.userId.slice(0, 6)}...`,
          action: `Created draft invitation for "${d.templateName || 'Template'}"`,
          timestamp: new Date(timeVal)
        });
      }
    });

    // Sort descending by timestamp
    activities.sort((a, b) => b.timestamp - a.timestamp);

    // Format top 5 recent activities with relative time strings
    const recentActivities = activities.slice(0, 5).map(act => {
      const diffMs = new Date() - act.timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      let timeStr = 'Just now';
      if (diffDays > 0) {
        timeStr = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      } else if (diffHours > 0) {
        timeStr = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      } else if (diffMins > 0) {
        timeStr = `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
      }

      return {
        id: act.id,
        user: act.user,
        action: act.action,
        time: timeStr
      };
    });

    // 2. Calculate real template popularity using drafts + direct purchases count
    const templateCounts = {};
    drafts.forEach(d => {
      if (d.templateId) {
        templateCounts[d.templateId] = (templateCounts[d.templateId] || 0) + 1;
      }
    });
    purchases.forEach(p => {
      if (p.templateId) {
        templateCounts[p.templateId] = (templateCounts[p.templateId] || 0) + 1;
      }
    });

    const topTemplates = templates.map(t => {
      const count = templateCounts[t.id] || 0;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        downloads: count,
        isPremium: t.isPremium
      };
    });

    // Sort descending, take top 3
    topTemplates.sort((a, b) => b.downloads - a.downloads);
    const finalTopTemplates = topTemplates.slice(0, 3);

    res.json({
      counters: {
        totalTemplates,
        totalCategories,
        totalUsers,
        premiumTemplates,
        activeUsersCount,
        totalInvitations,
        totalDrafts
      },
      recentActivities,
      topTemplates: finalTopTemplates
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET detailed chart metrics
router.get('/charts', async (req, res) => {
  try {
    const templates = await dbService.getAll('templates');
    const categories = await dbService.getAll('categories');
    const users = await dbService.getAll('app_users');

    // 1. User growth trend (cumulative registration count based on range parameter)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const userGrowthTrend = [];
    const now = new Date();
    let start = new Date();
    let end = new Date();
    let stepMonths = 6;
    
    const range = req.query.userGrowthRange || '6m';
    if (range === '6m') {
      stepMonths = 6;
      start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      end = now;
    } else if (range === '12m') {
      stepMonths = 12;
      start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      end = now;
    } else if (range === 'this_year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = now;
      stepMonths = now.getMonth() + 1;
    } else if (range === 'last_year') {
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      stepMonths = 12;
    } else if (range === 'custom') {
      const startDateStr = req.query.userGrowthStart;
      const endDateStr = req.query.userGrowthEnd;
      start = startDateStr ? new Date(startDateStr) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
      end = endDateStr ? new Date(endDateStr) : now;
      
      const diffYear = end.getFullYear() - start.getFullYear();
      const diffMonth = end.getMonth() - start.getMonth();
      stepMonths = Math.max(1, diffYear * 12 + diffMonth + 1);
    }
    
    for (let i = 0; i < stepMonths; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const monthLabel = months[d.getMonth()] + (range === '12m' || range === 'last_year' || range === 'custom' ? ` '${String(d.getFullYear()).slice(-2)}` : '');
      const year = d.getFullYear();
      const monthIndex = d.getMonth();
      
      const endOfMonth = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
      
      const count = users.filter(u => {
        const uDate = new Date(u.createdAt);
        return uDate <= endOfMonth;
      }).length;
      
      userGrowthTrend.push({
        month: monthLabel,
        users: count
      });
    }

    // 2. Template distribution by Category (count templates belonging to category in date range)
    let filteredTemplates = [...templates];
    const distRange = req.query.distributionRange || 'this_month';
    
    if (distRange === 'this_month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      filteredTemplates = templates.filter(t => {
        const tDate = t.createdAt ? new Date(t.createdAt) : null;
        return tDate && tDate >= startOfMonth;
      });
    } else if (distRange === 'last_month') {
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      filteredTemplates = templates.filter(t => {
        const tDate = t.createdAt ? new Date(t.createdAt) : null;
        return tDate && tDate >= startOfLastMonth && tDate <= endOfLastMonth;
      });
    } else if (distRange === 'this_year') {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      filteredTemplates = templates.filter(t => {
        const tDate = t.createdAt ? new Date(t.createdAt) : null;
        return tDate && tDate >= startOfYear;
      });
    } else if (distRange === 'custom') {
      const startDateStr = req.query.distributionStart;
      const endDateStr = req.query.distributionEnd;
      if (startDateStr) {
        const startD = new Date(startDateStr);
        filteredTemplates = filteredTemplates.filter(t => {
          const tDate = t.createdAt ? new Date(t.createdAt) : null;
          return tDate && tDate >= startD;
        });
      }
      if (endDateStr) {
        const endD = new Date(endDateStr);
        endD.setHours(23, 59, 59, 999);
        filteredTemplates = filteredTemplates.filter(t => {
          const tDate = t.createdAt ? new Date(t.createdAt) : null;
          return tDate && tDate <= endD;
        });
      }
    }

    const categoryDistribution = categories.map(cat => {
      const count = filteredTemplates.filter(t => t.categoryId === cat.id).length;
      return {
        name: cat.name,
        count: count
      };
    });

    // Sort descending by template count
    categoryDistribution.sort((a, b) => b.count - a.count);

    res.json({
      userGrowthTrend,
      categoryDistribution
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET subscription analytics summary
router.get('/subscription-summary', async (req, res) => {
  try {
    const allSubs = await dbService.getAll('user_subscriptions');
    const allTxns = await dbService.getAll('transactions');

    const now = new Date();
    
    // Group subs by userId
    const userMap = {};
    for (const sub of allSubs) {
      const uId = sub.userId;
      if (!userMap[uId]) {
        userMap[uId] = [];
      }
      userMap[uId].push(sub);
    }

    let totalActive = 0;
    let totalCancelled = 0;
    let activeTrials = 0;
    const subscribers = new Set();

    for (const uId in userMap) {
      const subs = userMap[uId];
      // Sort newest first
      subs.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
      const latest = subs[0];

      if (latest.isActive && new Date(latest.expiryDate) > now) {
        subscribers.add(uId);
        if (latest.status === 'active') {
          totalActive++;
        } else if (latest.status === 'trial') {
          activeTrials++;
          totalActive++;
        } else if (latest.status === 'cancelled') {
          totalCancelled++;
          totalActive++;
        }
      }
    }

    const totalSubscribers = subscribers.size;

    // Monthly subscription revenue
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    
    const monthlyRevenue = allTxns
      .filter(t => t.type === 'subscription' && t.status === 'success' && new Date(t.timestamp || t.createdAt) >= startOfMonth)
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // Churn rate = cancelled / total active
    const totalActiveSubscribersCount = totalActive; // active + trial + cancelled
    const churnRate = totalActiveSubscribersCount > 0 
      ? Number(((totalCancelled / totalActiveSubscribersCount) * 100).toFixed(1))
      : 0.0;

    // Monthly growth trend over the last 6 months
    const growthTrend = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const label = months[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);
      
      // Count active subscribers as of end of that month
      let activeAsOf = 0;
      for (const uId in userMap) {
        const subs = userMap[uId];
        // Find if there was any active record at that time
        const activeAtEnd = subs.some(s => {
          const start = new Date(s.startDate);
          const expiry = new Date(s.expiryDate);
          return start <= endOfMonth && expiry >= endOfMonth && s.status !== 'expired';
        });
        if (activeAtEnd) {
          activeAsOf++;
        }
      }
      growthTrend.push({
        month: label,
        subscribers: activeAsOf
      });
    }

    res.json({
      totalSubscribers,
      activeTrials,
      monthlyRevenue,
      churnRate,
      growthTrend
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
