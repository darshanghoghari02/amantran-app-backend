import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testStorage() {
  try {
    const keyPath = path.join(__dirname, 'firebase-service-account.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    
    const projectId = serviceAccount.project_id;
    const bucketName = `${projectId}.appspot.com`;
    console.log(`Testing Firebase Storage Bucket: ${bucketName}...`);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: bucketName
    });
    
    const bucket = admin.storage().bucket();
    
    // Check if bucket exists/is accessible by listing files (limit 1)
    const [files] = await bucket.getFiles({ maxResults: 1 });
    console.log("Success! Firebase Storage bucket is accessible.");
    console.log(`Found ${files.length} files in bucket.`);
  } catch (err) {
    console.error("Storage Connection Error:", err.message);
    console.log("Trying alternative bucket name format (*.firebasestorage.app)...");
    
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-service-account.json'), 'utf8'))),
        storageBucket: `${JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-service-account.json'), 'utf8')).project_id}.firebasestorage.app`
      }, 'alt');
      const bucket = admin.storage().bucket(admin.app('alt'));
      const [files] = await bucket.getFiles({ maxResults: 1 });
      console.log("Success! Firebase Storage bucket (*.firebasestorage.app) is accessible.");
    } catch (errAlt) {
      console.error("Alternative Storage Connection Error:", errAlt.message);
    }
  }
}

testStorage();
