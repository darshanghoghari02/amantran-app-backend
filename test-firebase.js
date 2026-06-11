import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  try {
    const keyPath = path.join(__dirname, 'firebase-service-account.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    const db = admin.firestore();
    console.log("Connecting to Firestore...");
    const snapshot = await db.collection('test').limit(1).get();
    console.log("Success! Firebase connected and queries work.");
  } catch (err) {
    console.error("Firebase Error:", err.message);
  }
}

test();
