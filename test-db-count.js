import { dbService } from './src/services/db.js';
async function run() {
  try {
    await dbService.initPromise;
    const tables = ['user_subscriptions', 'transactions', 'app_users'];
    for (const t of tables) {
      const items = await dbService.getAll(t);
      console.log(`Table: ${t}, Count: ${items.length}`);
      if (items.length > 0) {
        console.log(`First item in ${t}:`, JSON.stringify(items[0], null, 2));
      }
    }
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    process.exit(0);
  }
}
run();
