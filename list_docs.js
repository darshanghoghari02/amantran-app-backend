import { dbService } from './src/services/db.js';

async function listDocs() {
  try {
    await dbService.initPromise;
    if (dbService.isFirebase) {
      const db = dbService.db;
      const snapshot = await db.collection('app_users').get();
      console.log('App Users documents in Firestore:');
      snapshot.forEach(doc => {
        console.log(`- ${doc.id}`);
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
listDocs();
