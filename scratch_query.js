import { dbService } from './src/services/db.js';
import fs from 'fs/promises';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await dbService.initPromise;
  const templates = await dbService.getAll('templates');
  await fs.writeFile('temp_templates.json', JSON.stringify(templates, null, 2), 'utf-8');
  console.log("Dumped " + templates.length + " templates to temp_templates.json");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
