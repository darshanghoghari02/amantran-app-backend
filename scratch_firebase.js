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
    console.log("Querying for phone: '+916355983475'");
    const querySnap = await db.collection('app_users').where('phone', '==', '+916355983475').get();
    console.log(`Found ${querySnap.size} documents:`);
    querySnap.docs.forEach(doc => {
      console.log(`ID: ${doc.id}, phone: [${doc.data().phone}], provider: ${doc.data().provider}`);
    });
  } catch (err) {
    console.error("Firebase Error:", err.message);
  }
}

test();
