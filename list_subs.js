import { dbService } from './src/services/db.js';

async function listSubs() {
  try {
    await dbService.initPromise;
    if (dbService.isFirebase) {
      const db = dbService.db;
      const snapshot = await db.collection('user_subscriptions').get();
      console.log(`User Subscriptions count: ${snapshot.size}`);
      snapshot.forEach(doc => {
        console.log(`Doc ID: ${doc.id}, Data:`, doc.data());
      });
    } else {
      console.log('Not Firebase');
    }
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}
listSubs();
