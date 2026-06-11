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
    console.log("Checking Firestore collections...");
    
    const catsSnapshot = await db.collection('categories').get();
    console.log(`Categories count: ${catsSnapshot.size}`);
    catsSnapshot.forEach(doc => {
      console.log(`- Category: ${doc.id} => Name: ${doc.data().name}, isActive: ${doc.data().isActive}`);
    });
    
    const tplsSnapshot = await db.collection('templates').get();
    console.log(`Templates count: ${tplsSnapshot.size}`);
    tplsSnapshot.forEach(doc => {
      console.log(`- Template: ${doc.id} => Name: ${doc.data().name}, isActive: ${doc.data().isActive}`);
    });
    
  } catch (err) {
    console.error("Error checking collections:", err.message);
  }
}

test();
