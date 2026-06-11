import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = __dirname;
const DB_JSON_PATH = path.join(BACKEND_DIR, 'db.json');
const FIREBASE_KEY_PATH = path.join(BACKEND_DIR, 'firebase-service-account.json');

async function migrateData() {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_KEY_PATH, 'utf-8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    const db = admin.firestore();

    const localData = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf-8'));
    console.log("Starting Migration to Firebase...");

    const collections = ['categories', 'fonts', 'languages', 'templates', 'users'];

    for (const collectionName of collections) {
      const items = localData[collectionName] || [];
      console.log(`Migrating ${items.length} items to '${collectionName}'...`);
      for (const item of items) {
        if (!item.id) continue;
        await db.collection(collectionName).doc(item.id).set(item);
      }
    }

    console.log("✅ Migration complete! All local data is now in Firebase.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
}

migrateData();
