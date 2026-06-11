import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIREBASE_KEY_PATH = path.join(__dirname, 'firebase-service-account.json');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function deleteCollection(db, collectionPath) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.limit(100);
  
  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

async function syncTemplateFirestore(db, templateId, templateData) {
  try {
    const templateRef = db.collection('templates').doc(templateId);
    const pages = templateData.pages || [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageId = page.id || `page_${Math.random().toString(36).substring(2, 11)}`;

      const pageRef = templateRef.collection('pages').doc(pageId);
      
      await pageRef.set({
        id: pageId,
        backgroundImage: page.backgroundImage || '',
        pageNumber: i + 1,
        width: Number(page.width) || 1080,
        height: Number(page.height) || 1920
      }, { merge: true });

      const elements = page.elements || [];
      for (let j = 0; j < elements.length; j++) {
        const elem = elements[j];
        const elemId = elem.id || `elem_${Math.random().toString(36).substring(2, 11)}`;

        const elementRef = pageRef.collection('elements').doc(elemId);

        const firestoreElem = {
          id: elemId,
          type: elem.type || 'text',
          x: Number(elem.x) || 0,
          y: Number(elem.y) || 0,
          width: Number(elem.width) || 0,
          height: Number(elem.height) || 0,
          rotation: Number(elem.rotation) || 0,
          opacity: Number(elem.opacity) !== undefined ? Number(elem.opacity) : 1,
          zIndex: Number(elem.zIndex) || 0,
          fontSize: Number(elem.fontSize) || null,
          fontFamily: elem.fontFamily || null,
          fontWeight: elem.fontWeight || null,
          textAlign: elem.alignment || elem.textAlign || null,
          color: elem.color || null,
          lineHeight: elem.lineHeight !== undefined ? Number(elem.lineHeight) : null,
          letterSpacing: elem.letterSpacing !== undefined ? Number(elem.letterSpacing) : null,
          imageUrl: elem.imagePath || elem.imageUrl || null,
          translations: elem.translations || null,
          content: elem.text || elem.content || null
        };

        const elemWithOriginals = {
          ...elem,
          ...firestoreElem
        };

        await elementRef.set(elemWithOriginals);
      }
    }
    console.log(`  └─ Synced pages & elements subcollections for template: ${templateId}`);
  } catch (err) {
    console.error(`  └─ Failed to sync template subcollections for ${templateId}:`, err.message);
  }
}

async function runLiveSync() {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_KEY_PATH, 'utf-8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    const db = admin.firestore();

    console.log("🚀 Downloading live data from Render API...");
    const categories = await fetchUrl('https://amantran-admin-backend.onrender.com/api/categories');
    const templates = await fetchUrl('https://amantran-admin-backend.onrender.com/api/templates');
    const fonts = await fetchUrl('https://amantran-admin-backend.onrender.com/api/fonts');
    const languages = await fetchUrl('https://amantran-admin-backend.onrender.com/api/languages');
    const users = await fetchUrl('https://amantran-admin-backend.onrender.com/api/users');

    console.log("🧹 Cleaning up old Firestore collections...");
    await deleteCollection(db, 'categories');
    await deleteCollection(db, 'templates');
    await deleteCollection(db, 'languages');
    await deleteCollection(db, 'fonts');
    await deleteCollection(db, 'users');
    console.log("✨ Firestore collections cleaned.");

    console.log("📥 Uploading categories...");
    for (const c of categories) {
      await db.collection('categories').doc(c.id).set(c);
    }

    console.log("📥 Uploading fonts...");
    for (const f of fonts) {
      await db.collection('fonts').doc(f.id).set(f);
    }

    console.log("📥 Uploading languages...");
    for (const l of languages) {
      await db.collection('languages').doc(l.id).set(l);
    }

    console.log("📥 Uploading users...");
    for (const u of users) {
      await db.collection('users').doc(u.id).set(u);
    }

    console.log("📥 Uploading templates & syncing subcollections...");
    for (const t of templates) {
      await db.collection('templates').doc(t.id).set(t);
      await syncTemplateFirestore(db, t.id, t);
    }

    console.log("🎉 SUCCESS! Full live-to-firestore synchronization completed.");
    process.exit(0);
  } catch (err) {
    console.error("💥 Live sync failed:", err.message);
    process.exit(1);
  }
}

runLiveSync();
