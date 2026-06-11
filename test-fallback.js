import { dbService } from './src/services/db.js';

async function test() {
  console.log("Starting backend query test via dbService...");
  try {
    const categories = await dbService.getAll('categories');
    console.log(`\n🎉 Success! Fetched ${categories.length} categories.`);
    console.log("Categories details:", JSON.stringify(categories.map(c => ({ id: c.id, name: c.name })), null, 2));
  } catch (err) {
    console.error("Test failed with error:", err);
  }
}

test();
