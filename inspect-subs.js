import { dbService } from './src/services/db.js';
async function run() {
  try {
    await dbService.initPromise;
    const list = await dbService.getAll('user_subscriptions');
    console.log(`Total User Subscriptions: ${list.length}`);
    list.forEach((s, i) => {
      console.log(`[${i+1}] ID: ${s.id}, UserID: ${s.userId}, Plan: ${s.planType}, Status: ${s.status}, Active: ${s.isActive}, Start: ${s.startDate}, Expiry: ${s.expiryDate}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
