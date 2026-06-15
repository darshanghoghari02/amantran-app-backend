import { dbService } from './src/services/db.js';
async function run() {
  try {
    await dbService.initPromise;
    const list = await dbService.getAll('transactions');
    console.log(`Total Transactions: ${list.length}`);
    list.forEach((t, i) => {
      console.log(`[${i+1}] ID: ${t.id}, Type: ${t.type}, Amount: ${t.amount}, Plan/Template: ${t.planId || t.templateName}, Status: ${t.status}, Email: ${t.userEmail || 'N/A'}, Date: ${t.timestamp || t.createdAt}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
