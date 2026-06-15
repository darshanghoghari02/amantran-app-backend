import { dbService } from './src/services/db.js';
async function run() {
  try {
    await dbService.initPromise;
    const list = await dbService.getAll('app_users');
    console.log(`Total App Users: ${list.length}`);
    list.forEach((u, i) => {
      console.log(`[${i+1}] ID: ${u.id}, Phone: ${u.phone}, Email: ${u.email}, Name: ${u.displayName}, Created: ${u.createdAt}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
