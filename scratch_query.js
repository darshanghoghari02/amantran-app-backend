import { dbService } from './src/services/db.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await dbService.initPromise;
  const users = await dbService.getAll('users');
  console.log("Current Users in DB:", JSON.stringify(users, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
