import { dbService } from './src/services/db.js';

async function seed() {
  console.log("Starting revenue database seeding...");
  try {
    await dbService.initPromise;

    // 1. Seed user subscription for ghogharidarshan05@gmail.com (app_q6vumvxvb)
    // Active monthly paid plan
    const sub1 = {
      id: 'sub_gh05_monthly',
      userId: 'app_q6vumvxvb',
      planType: 'monthly',
      status: 'active',
      isActive: true,
      startDate: new Date(Date.now() - 5 * 86400000).toISOString(), // 5 days ago
      expiryDate: new Date(Date.now() + 25 * 86400000).toISOString(), // 25 days remaining
      amountPaid: 99,
      autoRenew: true
    };
    await dbService.add('user_subscriptions', sub1);

    const tx1 = {
      id: 'tx_gh05_monthly_checkout',
      userId: 'app_q6vumvxvb',
      userEmail: 'ghogharidarshan05@gmail.com',
      type: 'subscription',
      amount: 99,
      planId: 'monthly',
      status: 'success',
      timestamp: new Date(Date.now() - 5 * 86400000).toISOString(),
      details: 'Monthly subscription checkout'
    };
    await dbService.add('transactions', tx1);

    // 2. Seed user subscription for app_1e067pbwq (+911122334455)
    // Active yearly paid plan
    const sub2 = {
      id: 'sub_phone_yearly',
      userId: 'app_1e067pbwq',
      planType: 'yearly',
      status: 'active',
      isActive: true,
      startDate: new Date(Date.now() - 20 * 86400000).toISOString(), // 20 days ago
      expiryDate: new Date(Date.now() + 345 * 86400000).toISOString(), // 345 days remaining
      amountPaid: 499,
      autoRenew: true
    };
    await dbService.add('user_subscriptions', sub2);

    const tx2 = {
      id: 'tx_phone_yearly_checkout',
      userId: 'app_1e067pbwq',
      userEmail: 'ghogharidarshan_phone@gmail.com',
      type: 'subscription',
      amount: 499,
      planId: 'yearly',
      status: 'success',
      timestamp: new Date(Date.now() - 20 * 86400000).toISOString(),
      details: 'Yearly subscription checkout'
    };
    await dbService.add('transactions', tx2);

    // 3. Seed historical subscriptions for ghogharidarshan1202@gmail.com (app_8ey1y8t2u)
    // March monthly expired
    const subHist1 = {
      id: 'sub_gh12_march',
      userId: 'app_8ey1y8t2u',
      planType: 'monthly',
      status: 'expired',
      isActive: false,
      startDate: '2026-03-01T00:00:00.000Z',
      expiryDate: '2026-04-01T00:00:00.000Z',
      amountPaid: 99,
      autoRenew: false
    };
    await dbService.add('user_subscriptions', subHist1);

    const txHist1 = {
      id: 'tx_gh12_march_checkout',
      userId: 'app_8ey1y8t2u',
      userEmail: 'ghogharidarshan1202@gmail.com',
      type: 'subscription',
      amount: 99,
      planId: 'monthly',
      status: 'success',
      timestamp: '2026-03-01T10:00:00.000Z',
      details: 'Monthly subscription'
    };
    await dbService.add('transactions', txHist1);

    // April monthly expired
    const subHist2 = {
      id: 'sub_gh12_april',
      userId: 'app_8ey1y8t2u',
      planType: 'monthly',
      status: 'expired',
      isActive: false,
      startDate: '2026-04-01T00:00:00.000Z',
      expiryDate: '2026-05-01T00:00:00.000Z',
      amountPaid: 99,
      autoRenew: false
    };
    await dbService.add('user_subscriptions', subHist2);

    const txHist2 = {
      id: 'tx_gh12_april_checkout',
      userId: 'app_8ey1y8t2u',
      userEmail: 'ghogharidarshan1202@gmail.com',
      type: 'subscription',
      amount: 99,
      planId: 'monthly',
      status: 'success',
      timestamp: '2026-04-01T10:00:00.000Z',
      details: 'Monthly subscription'
    };
    await dbService.add('transactions', txHist2);

    // May monthly expired
    const subHist3 = {
      id: 'sub_gh12_may',
      userId: 'app_8ey1y8t2u',
      planType: 'monthly',
      status: 'expired',
      isActive: false,
      startDate: '2026-05-01T00:00:00.000Z',
      expiryDate: '2026-06-01T00:00:00.000Z',
      amountPaid: 99,
      autoRenew: false
    };
    await dbService.add('user_subscriptions', subHist3);

    const txHist3 = {
      id: 'tx_gh12_may_checkout',
      userId: 'app_8ey1y8t2u',
      userEmail: 'ghogharidarshan1202@gmail.com',
      type: 'subscription',
      amount: 99,
      planId: 'monthly',
      status: 'success',
      timestamp: '2026-05-01T10:00:00.000Z',
      details: 'Monthly subscription'
    };
    await dbService.add('transactions', txHist3);

    console.log("🎉 Seeding completed successfully!");
  } catch (err) {
    console.error("Seeding failed:", err.message);
  } finally {
    process.exit(0);
  }
}
seed();
