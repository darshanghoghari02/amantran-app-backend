import { dbService } from './src/services/db.js';

async function listUsers() {
  try {
    await dbService.initPromise;
    if (dbService.isFirebase) {
      const db = dbService.db;
      const snapshot = await db.collection('app_users').get();
      console.log(`App Users count: ${snapshot.size}`);
      snapshot.forEach(doc => {
        console.log(`User: ${doc.id}`);
        console.log('Fields:', Object.keys(doc.data()));
        console.log('Values:', doc.data());
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
listUsers();
