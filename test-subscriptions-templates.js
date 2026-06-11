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
    console.log("=== CHECK SUBSCRIPTIONS ===");
    const subSnapshot = await db.collection('subscriptions').get();
    subSnapshot.forEach(doc => {
      console.log(`Plan ID: ${doc.id}`);
      console.log(`  Name: ${doc.data().name}`);
      console.log(`  Price: ${doc.data().price}`);
      console.log(`  IsActive: ${doc.data().isActive}`);
      console.log(`  Included Template IDs:`, doc.data().includedTemplateIds);
      console.log(`  Included Categories:`, doc.data().includedCategories);
      console.log("------------------------");
    });
    
    console.log("=== CHECK TEMPLATES ===");
    const tplsSnapshot = await db.collection('templates').get();
    tplsSnapshot.forEach(doc => {
      console.log(`Template ID: ${doc.id}`);
      console.log(`  Name: ${doc.data().name}`);
      console.log(`  Slug: ${doc.data().slug}`);
      console.log(`  IsPremium: ${doc.data().isPremium}`);
      console.log(`  Included in Monthly: ${doc.data().includedInMonthlyPlan}`);
      console.log(`  Included in Yearly: ${doc.data().includedInYearlyPlan}`);
      console.log("------------------------");
    });
  } catch (err) {
    console.error("Error checking collections:", err.message);
  }
}

test();
