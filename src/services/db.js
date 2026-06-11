import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = path.resolve(__dirname, '../..');
const LOCAL_DB_PATH = path.join(BACKEND_DIR, 'db.json');
const FIREBASE_KEY_PATH = path.join(BACKEND_DIR, 'firebase-service-account.json');

class DatabaseService {
  constructor() {
    this.isFirebase = false;
    this.db = null;
    this.connectionError = null;
    this.initPromise = this.init();
  }

  async init() {
    try {
      let serviceAccount;

      // Try loading from environment variable first (standard for production/Render)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      } else {
        // Fallback to checking and reading local file
        await fs.access(FIREBASE_KEY_PATH);
        serviceAccount = JSON.parse(await fs.readFile(FIREBASE_KEY_PATH, 'utf-8'));
      }

      // Determine the correct storage bucket dynamically
      let selectedBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.STORAGE_BUCKET || undefined;

      if (!selectedBucket && serviceAccount.project_id) {
        const primaryBucket = `${serviceAccount.project_id}.appspot.com`;
        const secondaryBucket = `${serviceAccount.project_id}.firebasestorage.app`;

        console.log(`🔍 Checking Firebase Storage bucket accessibility...`);

        // Use a temporary named Firebase App to test bucket accessibility
        const tempAppName = `temp-discovery-${Date.now()}`;
        let tempApp;
        try {
          tempApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          }, tempAppName);

          // Test primary bucket
          try {
            const bucket = tempApp.storage().bucket(primaryBucket);
            await bucket.getFiles({ maxResults: 1 });
            selectedBucket = primaryBucket;
            console.log(`✅ Verified Firebase Storage bucket: ${primaryBucket}`);
          } catch (primaryErr) {
            // Test secondary bucket
            try {
              const bucket = tempApp.storage().bucket(secondaryBucket);
              await bucket.getFiles({ maxResults: 1 });
              selectedBucket = secondaryBucket;
              console.log(`✅ Verified Firebase Storage bucket: ${secondaryBucket}`);
            } catch (secondaryErr) {
              // If both failed, Firebase Storage might not be enabled yet in Firebase Console
              console.warn(`⚠️ Warning: Firebase Storage bucket is not provisioned or accessible.`);
              console.warn(`👉 Please ensure Firebase Storage is enabled in the Firebase Console:`);
              console.warn(`   https://console.firebase.google.com/project/${serviceAccount.project_id}/storage`);
              console.warn(`🔄 Falling back to local disk storage for asset uploads.`);
              // Default to primary so standard SDK APIs do not crash on startup
              selectedBucket = primaryBucket;
            }
          }
        } catch (initErr) {
          console.warn(`⚠️ Error during storage bucket discovery:`, initErr.message);
          selectedBucket = primaryBucket;
        } finally {
          if (tempApp) {
            try {
              await tempApp.delete();
            } catch (_) { }
          }
        }
      }

      // Initialize Firebase Admin with verified storageBucket configuration
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: selectedBucket
      });

      const dbId = process.env.FIREBASE_DATABASE_ID || undefined;
      this.db = dbId ? getFirestore(app, dbId) : getFirestore(app);

      try {
        // Run a test query to verify connection and database existence
        await this.db.collection('categories').limit(1).get();
        this.isFirebase = true;
        this.connectionError = null;
        console.log('🔥 Connected successfully to Firebase Firestore.', dbId ? `Database instance: ${dbId}` : 'Database instance: (default)');
      } catch (testError) {
        // If it failed because a custom database was not found, try falling back to the '(default)' database
        const isNotFoundError = testError.code === 5 ||
          testError.message?.includes('NOT_FOUND') ||
          testError.message?.toLowerCase().includes('not found');

        if (dbId && isNotFoundError) {
          console.warn(`⚠️ Custom database ID '${dbId}' was not found. Attempting fallback to the '(default)' database...`);
          this.db = getFirestore(app);

          // Test the default database connection
          await this.db.collection('categories').limit(1).get();
          this.isFirebase = true;
          this.connectionError = `Fallback active: Custom database '${dbId}' not found. Using default database.`;
          console.log('🔥 Connected successfully to Firebase Firestore (default database fallback).');
        } else {
          // If it is another error (e.g. invalid credentials), rethrow to let the main catch block handle it
          throw testError;
        }
      }

      // Clean up any orphaned ghost template subcollections in the background
      this.cleanupOrphanedFirestoreTemplates();
    } catch (error) {
      console.warn('⚠️ Firebase Credentials not found or invalid, or Firestore database does not exist. Falling back to LOCAL JSON DB Mode.');
      console.error('Connection Error:', error.message || error);
      console.log(`📁 Local database path: ${LOCAL_DB_PATH}`);
      this.isFirebase = false;
      this.connectionError = error.message || String(error);
      await this.initLocalDb();
    }
  }

  async cleanupOrphanedFirestoreTemplates() {
    if (!this.isFirebase || !this.db) return;
    try {
      console.log('🧹 Scanning Firestore for orphaned/ghost template subcollections...');
      const templatesRef = this.db.collection('templates');
      const docRefs = await templatesRef.listDocuments();

      let count = 0;
      for (const docRef of docRefs) {
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          console.log(`🧹 Found orphaned/ghost template document: ${docRef.id}. Cleaning up subcollections recursively...`);

          // Delete all pages in this page's subcollection
          const pagesSnapshot = await docRef.collection('pages').get();
          for (const pageDoc of pagesSnapshot.docs) {
            const elementsSnapshot = await pageDoc.ref.collection('elements').get();
            for (const elemDoc of elementsSnapshot.docs) {
              await elemDoc.ref.delete();
            }
            await pageDoc.ref.delete();
          }
          count++;
        }
      }
      if (count > 0) {
        console.log(`✅ Successfully cleaned up ${count} orphaned template subcollection(s) from Firestore.`);
      } else {
        console.log('✅ No orphaned template subcollections found in Firestore.');
      }
    } catch (err) {
      console.warn('⚠️ Failed to run Firestore orphaned template cleanup:', err.message);
    }
  }

  async initLocalDb() {
    try {
      await fs.access(LOCAL_DB_PATH);
      // Auto-migrate: if app_users is missing in existing db.json, add default ones
      const data = await this.readLocal();
      if (!data.app_users) {
        const defaultData = this.getDefaultMockData();
        data.app_users = defaultData.app_users;
        await this.writeLocal(data);
        console.log('✅ Auto-migrated: Seeded app_users into existing local database.');
      }
    } catch (error) {
      // If db.json doesn't exist, create it with beautiful default mock data
      const defaultDb = this.getDefaultMockData();
      await fs.writeFile(LOCAL_DB_PATH, JSON.stringify(defaultDb, null, 2), 'utf-8');
      console.log('✅ Created new local database with rich initial mock data.');
    }
  }

  getDefaultMockData() {
    const now = new Date().toISOString();
    return {
      categories: [
        {
          id: 'cat_wedding',
          name: 'Wedding',
          slug: 'wedding',
          imageUrl: '/assets/images/defaults/wedding.png',
          displayOrder: 1,
          isActive: true,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'cat_engagement',
          name: 'Engagement',
          slug: 'engagement',
          imageUrl: '/assets/images/defaults/engagement.png',
          displayOrder: 2,
          isActive: true,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'cat_baby_shower',
          name: 'Baby Shower',
          slug: 'baby_shower',
          imageUrl: '/assets/images/defaults/baby_shower.png',
          displayOrder: 3,
          isActive: true,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'cat_reception',
          name: 'Reception',
          slug: 'reception',
          imageUrl: '/assets/images/defaults/reception.png',
          displayOrder: 4,
          isActive: true,
          createdAt: now,
          updatedAt: now
        }
      ],
      fonts: [
        { id: 'font_rasa', family: 'Rasa', localPath: 'assets/fonts/Rasa-Regular.ttf', isActive: true, createdAt: now },
        { id: 'font_hind_vadodara', family: 'Hind Vadodara', localPath: 'assets/fonts/HindVadodara-Regular.ttf', isActive: true, createdAt: now },
        { id: 'font_farsan', family: 'Farsan', localPath: 'assets/fonts/Farsan-Regular.ttf', isActive: true, createdAt: now },
        { id: 'font_kap011', family: 'KAP011', localPath: 'assets/fonts/KAP011.ttf', isActive: true, createdAt: now }
      ],
      languages: [
        { id: 'lang_en', code: 'en', name: 'English', isActive: true },
        { id: 'lang_gu', code: 'gu', name: 'Gujarati', isActive: true },
        { id: 'lang_hi', code: 'hi', name: 'Hindi', isActive: true },
        { id: 'lang_mr', code: 'mr', name: 'Marathi', isActive: true },
        { id: 'lang_ur', code: 'ur', name: 'Urdu', isActive: true },
        { id: 'lang_ta', code: 'ta', name: 'Tamil', isActive: true }
      ],
      templates: [
        {
          id: 'tpl_royal_wedding',
          categoryId: 'cat_wedding',
          name: 'Royal Wedding',
          slug: 'royal_wedding',
          thumbnail: '/assets/images/wedding/royal_wedding/thumbnail.png',
          previewImages: [
            '/assets/images/wedding/royal_wedding/bg_1.png',
            '/assets/images/wedding/royal_wedding/bg_2.png'
          ],
          localAssetPaths: [
            'assets/images/wedding/royal_wedding/bg_1.png',
            'assets/images/wedding/royal_wedding/bg_2.png',
            'assets/images/wedding/royal_wedding/ganesh.png',
            'assets/images/wedding/royal_wedding/thumbnail.png'
          ],
          isPremium: true,
          isActive: true,
          fonts: ['Rasa', 'KAP011'],
          languages: ['English', 'Hindi', 'Gujarati'],
          pages: [
            {
              id: 'page_cover',
              name: 'Cover Page',
              backgroundImage: '/assets/images/wedding/royal_wedding/bg_1.png',
              elements: [
                {
                  id: 'elem_ganesh',
                  type: 'image',
                  x: 440,
                  y: 150,
                  width: 200,
                  height: 200,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 1,
                  isLocked: false,
                  imagePath: '/assets/images/stickers/ganesh.png'
                },
                {
                  id: 'elem_heading',
                  type: 'text',
                  x: 100,
                  y: 450,
                  width: 880,
                  height: 120,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 2,
                  isLocked: false,
                  text: 'WEDDING INVITATION',
                  fontFamily: 'KAP011',
                  fontSize: 56,
                  color: '#D4AF37',
                  lineHeight: 1.2,
                  alignment: 'center'
                },
                {
                  id: 'elem_couple',
                  type: 'text',
                  x: 100,
                  y: 650,
                  width: 880,
                  height: 200,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 3,
                  isLocked: false,
                  text: 'Aarav\n&\nAnanya',
                  fontFamily: 'Rasa',
                  fontSize: 72,
                  color: '#4A2E35',
                  lineHeight: 1.1,
                  alignment: 'center'
                },
                {
                  id: 'elem_details',
                  type: 'text',
                  x: 100,
                  y: 1100,
                  width: 880,
                  height: 100,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 4,
                  isLocked: false,
                  text: 'SAVE THE DATE',
                  fontFamily: 'Hind Vadodara',
                  fontSize: 28,
                  color: '#7C6268',
                  lineHeight: 1.4,
                  alignment: 'center'
                },
                {
                  id: 'elem_date',
                  type: 'text',
                  x: 100,
                  y: 1250,
                  width: 880,
                  height: 100,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 5,
                  isLocked: false,
                  text: 'DECEMBER 18, 2026 | MUMBAI',
                  fontFamily: 'Hind Vadodara',
                  fontSize: 32,
                  color: '#D4AF37',
                  lineHeight: 1.4,
                  alignment: 'center'
                }
              ]
            },
            {
              id: 'page_details',
              name: 'Event Details',
              backgroundImage: '/assets/images/wedding/royal_wedding/bg_2.png',
              elements: [
                {
                  id: 'elem_title_2',
                  type: 'text',
                  x: 100,
                  y: 200,
                  width: 880,
                  height: 100,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 1,
                  isLocked: false,
                  text: 'Wedding Ceremonies',
                  fontFamily: 'KAP011',
                  fontSize: 48,
                  color: '#D4AF37',
                  lineHeight: 1.2,
                  alignment: 'center'
                },
                {
                  id: 'elem_card_1',
                  type: 'text',
                  x: 150,
                  y: 400,
                  width: 780,
                  height: 350,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 2,
                  isLocked: false,
                  text: '✨ BARAAT & SHAADI ✨\nTime: 4:00 PM Onwards\nVenue: The Royal Palace Banquet, Colaba, Mumbai\nJoin us as we take our wedding vows.',
                  fontFamily: 'Rasa',
                  fontSize: 36,
                  color: '#4A2E35',
                  lineHeight: 1.5,
                  alignment: 'center'
                },
                {
                  id: 'elem_card_2',
                  type: 'text',
                  x: 150,
                  y: 850,
                  width: 780,
                  height: 350,
                  rotation: 0,
                  opacity: 1,
                  zIndex: 3,
                  isLocked: false,
                  text: '✨ ROYAL RECEPTION ✨\nTime: 8:00 PM Onwards\nVenue: Palace Gardens\nLet us celebrate love, laughter, and happily ever after.',
                  fontFamily: 'Rasa',
                  fontSize: 36,
                  color: '#4A2E35',
                  lineHeight: 1.5,
                  alignment: 'center'
                }
              ]
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      subscriptions: [
        {
          id: 'monthly',
          name: 'Monthly Premium',
          price: 99,
          description: 'Access all monthly premium templates.',
          isActive: true,
          includedCategories: [],
          includedTemplateIds: [],
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'yearly',
          name: 'Yearly Premium',
          price: 499,
          description: 'Access all premium templates including yearly exclusives.',
          isActive: true,
          includedCategories: [],
          includedTemplateIds: [],
          createdAt: now,
          updatedAt: now
        }
      ],
      users: [
        { id: 'user_1', email: 'vicky.patel@gmail.com', displayName: 'Vicky Patel', role: 'editor', isBlocked: false, invitationCount: 12, draftsCount: 3, createdAt: now },
        { id: 'user_2', email: 'sneha.sharma@yahoo.com', displayName: 'Sneha Sharma', role: 'content_manager', isBlocked: false, invitationCount: 4, draftsCount: 1, createdAt: now },
        { id: 'user_3', email: 'rajesh.shah@hotmail.com', displayName: 'Rajesh Shah', role: 'editor', isBlocked: true, invitationCount: 0, draftsCount: 0, createdAt: now }
      ],
      app_users: [
        { id: 'app_user_1', phone: '+919876543210', email: 'amit.patel@gmail.com', displayName: 'Amit Patel', provider: 'phone', isBlocked: false, invitationCount: 5, draftsCount: 2, createdAt: now },
        { id: 'app_user_2', phone: '+918765432109', email: 'priya.mehta@yahoo.com', displayName: 'Priya Mehta', provider: 'google', isBlocked: false, invitationCount: 14, draftsCount: 4, createdAt: now },
        { id: 'app_user_3', phone: '+917654321098', email: 'rahul.sharma@outlook.com', displayName: 'Rahul Sharma', provider: 'google', isBlocked: true, invitationCount: 0, draftsCount: 0, createdAt: now }
      ],
      user_subscriptions: [],
      user_purchases: [],
      user_drafts: [],
      transactions: []
    };
  }

  // Helper to read local DB
  async readLocal() {
    const data = await fs.readFile(LOCAL_DB_PATH, 'utf-8');
    return JSON.parse(data);
  }

  // Helper to write local DB
  async writeLocal(data) {
    await fs.writeFile(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  // Generic Query method to get all documents from a collection
  async getAll(collectionName) {
    await this.initPromise;
    if (this.isFirebase) {
      try {
        let snapshot;
        if (collectionName === 'ratings') {
          snapshot = await this.db.collectionGroup('ratings').get();
        } else {
          snapshot = await this.db.collection(collectionName).get();
        }
        const list = [];
        snapshot.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        return list;
      } catch (error) {
        console.error(`⚠️ Firebase Firestore query failed (getAll: ${collectionName}):`, error.message);
        console.warn('🔄 Falling back to LOCAL JSON DB Mode for this query.');
        const data = await this.readLocal();
        return data[collectionName] || [];
      }
    } else {
      const data = await this.readLocal();
      return data[collectionName] || [];
    }
  }

  // Generic Get Single Document
  async getOne(collectionName, id) {
    await this.initPromise;
    if (this.isFirebase) {
      try {
        const doc = await this.db.collection(collectionName).doc(id).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
      } catch (error) {
        console.error(`⚠️ Firebase Firestore query failed (getOne: ${collectionName}, id: ${id}):`, error.message);
        console.warn('🔄 Falling back to LOCAL JSON DB Mode for this query.');
        const data = await this.readLocal();
        const list = data[collectionName] || [];
        return list.find(item => item.id === id) || null;
      }
    } else {
      const data = await this.readLocal();
      const list = data[collectionName] || [];
      return list.find(item => item.id === id) || null;
    }
  }

  async syncTemplateFirestore(templateId, templateData) {
    if (!this.isFirebase || !this.db) return;

    try {
      const templateRef = this.db.collection('templates').doc(templateId);
      const pages = templateData.pages || [];

      // 1. Process all pages in the templateData
      const currentPageIds = new Set();
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageId = page.id || `page_${Math.random().toString(36).substr(2, 9)}`;
        currentPageIds.add(pageId);

        const pageRef = templateRef.collection('pages').doc(pageId);

        // Write the page document
        await pageRef.set({
          id: pageId,
          backgroundImage: page.backgroundImage || '',
          pageNumber: i + 1,
          width: Number(page.width) || 1080,
          height: Number(page.height) || 1920
        }, { merge: true });

        // Process elements on this page
        const elements = page.elements || [];
        const currentElementIds = new Set();
        for (let j = 0; j < elements.length; j++) {
          const elem = elements[j];
          const elemId = elem.id || `elem_${Math.random().toString(36).substr(2, 9)}`;
          currentElementIds.add(elemId);

          const elementRef = pageRef.collection('elements').doc(elemId);

          // Standardize element fields according to Requirement 5
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

          // Also keep original keys for backwards compatibility in element subcollection!
          const elemWithOriginals = {
            ...elem,
            ...firestoreElem
          };

          await elementRef.set(elemWithOriginals);
        }

        // Clean up deleted elements from Firestore subcollection for this page
        const elementsSnapshot = await pageRef.collection('elements').get();
        for (const elDoc of elementsSnapshot.docs) {
          if (!currentElementIds.has(elDoc.id)) {
            await elDoc.ref.delete();
            console.log(`🗑️ Deleted stale element subcollection doc: ${elDoc.id}`);
          }
        }
      }

      // 2. Clean up deleted pages from Firestore subcollections
      const pagesSnapshot = await templateRef.collection('pages').get();
      for (const pDoc of pagesSnapshot.docs) {
        const pageId = pDoc.id;
        if (!currentPageIds.has(pageId)) {
          // First delete all elements inside that page
          const staleElementsSnapshot = await pDoc.ref.collection('elements').get();
          for (const elDoc of staleElementsSnapshot.docs) {
            await elDoc.ref.delete();
          }
          // Then delete the page itself
          await pDoc.ref.delete();
          console.log(`🗑️ Deleted stale page subcollection doc: ${pageId}`);
        }
      }
    } catch (err) {
      console.error(`⚠️ Failed to sync template subcollections in Firestore (id: ${templateId}):`, err.message);
    }
  }

  // Generic Add Document
  async add(collectionName, documentData) {
    await this.initPromise;
    const now = new Date().toISOString();
    const docWithDates = {
      ...documentData,
      createdAt: now,
      updatedAt: now
    };

    if (this.isFirebase) {
      try {
        const docRef = documentData.id
          ? this.db.collection(collectionName).doc(documentData.id)
          : this.db.collection(collectionName).doc();

        const finalData = { ...docWithDates, id: docRef.id };
        await docRef.set(finalData);
        if (collectionName === 'templates') {
          await this.syncTemplateFirestore(finalData.id, finalData);
        }
        return finalData;
      } catch (error) {
        console.error(`⚠️ Firebase Firestore write failed (add: ${collectionName}):`, error.message);
        console.warn('🔄 Falling back to LOCAL JSON DB Mode to store this document.');
        // Write to local database as fallback
        const data = await this.readLocal();
        if (!data[collectionName]) data[collectionName] = [];

        const newDoc = {
          id: documentData.id || `${collectionName.slice(0, 3)}_${Math.random().toString(36).substr(2, 9)}`,
          ...docWithDates
        };

        data[collectionName].push(newDoc);
        await this.writeLocal(data);
        return newDoc;
      }
    } else {
      const data = await this.readLocal();
      if (!data[collectionName]) data[collectionName] = [];

      const newDoc = {
        id: documentData.id || `${collectionName.slice(0, 3)}_${Math.random().toString(36).substr(2, 9)}`,
        ...docWithDates
      };

      data[collectionName].push(newDoc);
      await this.writeLocal(data);
      return newDoc;
    }
  }

  // Generic Update Document
  async update(collectionName, id, updates) {
    await this.initPromise;
    const now = new Date().toISOString();
    const dataWithUpdate = { ...updates, updatedAt: now };

    if (this.isFirebase) {
      try {
        await this.db.collection(collectionName).doc(id).update(dataWithUpdate);
        const updatedDoc = await this.db.collection(collectionName).doc(id).get();
        const finalData = { id: updatedDoc.id, ...updatedDoc.data() };
        if (collectionName === 'templates' && updates.pages !== undefined) {
          await this.syncTemplateFirestore(id, finalData);
        }
        return finalData;
      } catch (error) {
        console.error(`⚠️ Firebase Firestore write failed (update: ${collectionName}, id: ${id}):`, error.message);
        console.warn('🔄 Falling back to LOCAL JSON DB Mode to update this document.');
        // Update local database as fallback
        const data = await this.readLocal();
        const list = data[collectionName] || [];
        const index = list.findIndex(item => item.id === id);
        if (index === -1) throw new Error(`Document not found in local db ${collectionName} with id: ${id}`);

        const updatedItem = {
          ...list[index],
          ...dataWithUpdate
        };
        list[index] = updatedItem;
        data[collectionName] = list;
        await this.writeLocal(data);
        return updatedItem;
      }
    } else {
      const data = await this.readLocal();
      const list = data[collectionName] || [];
      const index = list.findIndex(item => item.id === id);
      if (index === -1) throw new Error(`Document not found in ${collectionName} with id: ${id}`);

      const updatedItem = {
        ...list[index],
        ...dataWithUpdate
      };
      list[index] = updatedItem;
      data[collectionName] = list;
      await this.writeLocal(data);
      return updatedItem;
    }
  }

  async deleteTemplateSubcollections(templateId) {
    if (!this.isFirebase || !this.db) return;
    try {
      const templateRef = this.db.collection('templates').doc(templateId);
      const pagesSnapshot = await templateRef.collection('pages').get();

      for (const pageDoc of pagesSnapshot.docs) {
        // Delete all elements in this page's subcollection
        const elementsSnapshot = await pageDoc.ref.collection('elements').get();
        for (const elemDoc of elementsSnapshot.docs) {
          await elemDoc.ref.delete();
        }
        // Delete the page document itself
        await pageDoc.ref.delete();
      }
      console.log(`🗑️ Recursively deleted Firestore pages & elements subcollections for template: ${templateId}`);
    } catch (err) {
      console.error(`⚠️ Failed to recursively delete subcollections for template ${templateId}:`, err.message);
    }
  }

  // Generic Delete Document
  async delete(collectionName, id) {
    await this.initPromise;
    if (this.isFirebase) {
      try {
        if (collectionName === 'templates') {
          await this.deleteTemplateSubcollections(id);
        }
        await this.db.collection(collectionName).doc(id).delete();
        return true;
      } catch (error) {
        console.error(`⚠️ Firebase Firestore delete failed (delete: ${collectionName}, id: ${id}):`, error.message);
        console.warn('🔄 Falling back to LOCAL JSON DB Mode to delete this document.');
        // Delete from local database as fallback
        const data = await this.readLocal();
        const list = data[collectionName] || [];
        const filtered = list.filter(item => item.id !== id);
        data[collectionName] = filtered;
        await this.writeLocal(data);
        return true;
      }
    } else {
      const data = await this.readLocal();
      const list = data[collectionName] || [];
      const filtered = list.filter(item => item.id !== id);
      data[collectionName] = filtered;
      await this.writeLocal(data);
      return true;
    }
  }
}

export const dbService = new DatabaseService();
