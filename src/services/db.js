import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { realtimeService } from './realtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables relative to this file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });


const BACKEND_DIR = path.resolve(__dirname, '../..');
const LOCAL_DB_PATH = path.join(BACKEND_DIR, 'db.json');

class DatabaseService {
  constructor() {
    this.isFirebase = false;
    this.isMySQL = false;
    this.pool = null;
    this.connectionError = null;
    this.initPromise = this.init();
  }

  async init() {
    try {
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
      const dbUser = process.env.DB_USER || 'root';
      const dbPassword = process.env.DB_PASSWORD || '';
      const dbName = process.env.DB_NAME || 'amantran_db';

      console.log(`🔌 Connecting to MySQL server at ${dbHost}:${dbPort}...`);

      // 1. Try connecting directly to the database first
      let dbExists = false;
      try {
        const testConn = await mysql.createConnection({
          host: dbHost,
          port: dbPort,
          user: dbUser,
          password: dbPassword,
          database: dbName
        });
        await testConn.end();
        dbExists = true;
        console.log(`✅ Database \`${dbName}\` exists and connection verified.`);
      } catch (connError) {
        // Check if database does not exist (ER_BAD_DB_ERROR / errno: 1049)
        const isDbMissing = connError.code === 'ER_BAD_DB_ERROR' || connError.errno === 1049;
        if (isDbMissing) {
          console.log(`ℹ️ Database \`${dbName}\` does not exist. Attempting to create it...`);
          try {
            const connection = await mysql.createConnection({
              host: dbHost,
              port: dbPort,
              user: dbUser,
              password: dbPassword
            });
            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
            await connection.end();
            dbExists = true;
            console.log(`✅ Database \`${dbName}\` created successfully.`);
          } catch (createError) {
            console.error(`❌ Failed to create database \`${dbName}\`:`, createError.message);
            throw createError;
          }
        } else {
          // Credential or host network issues (e.g. Access Denied)
          console.error(`❌ Connection to database \`${dbName}\` failed:`, connError.message);
          throw connError;
        }
      }

      // 2. Create the pool with the database specified
      this.pool = mysql.createPool({
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });

      this.isMySQL = true;
      console.log(`🚀 Connected successfully to XAMPP MySQL database \`${dbName}\`.`);

      // 3. Create tables for all collections
      const collections = [
        'categories',
        'fonts',
        'languages',
        'templates',
        'subscriptions',
        'users',
        'app_users',
        'user_subscriptions',
        'user_purchases',
        'user_drafts',
        'transactions',
        'audit_logs',
        'roles',
        'ratings',
        'settings',
        'user_cards',
        'user_favorites',
        'guests',
        'otp_codes'
      ];

      for (const col of collections) {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS \`${col}\` (
            \`id\` VARCHAR(255) PRIMARY KEY,
            \`data\` LONGTEXT NOT NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
      }
      console.log(`✅ Database tables verified/created.`);

      // 4. Initialize local db file if missing (as fallback/seed source)
      await this.initLocalDbFile();

      // 5. Migrate data from db.json if tables are empty
      await this.migrateDataFromLocalDb(collections);

      // 6. Ensure Super Admin account exists/is seeded with current credentials
      await this.ensureSuperAdminExists();

    } catch (error) {
      console.error('❌ Failed to initialize MySQL database. Falling back to local JSON database mode.');
      console.error('Connection Error:', error.message || error);
      this.isMySQL = false;
      this.connectionError = error.message || String(error);
      await this.initLocalDbFile();
      await this.ensureSuperAdminExists();
    }
  }

  async initLocalDbFile() {
    try {
      await fs.access(LOCAL_DB_PATH);
    } catch (error) {
      // If db.json doesn't exist, create it with beautiful default mock data
      const defaultDb = this.getDefaultMockData();
      await fs.writeFile(LOCAL_DB_PATH, JSON.stringify(defaultDb, null, 2), 'utf-8');
      console.log('✅ Created new local db.json file with rich initial mock data.');
    }
  }

  async migrateDataFromLocalDb(collections) {
    try {
      // Read db.json
      const localData = JSON.parse(await fs.readFile(LOCAL_DB_PATH, 'utf-8'));

      for (const col of collections) {
        // Check if table has any data
        const [rows] = await this.pool.query(`SELECT COUNT(*) as count FROM \`${col}\``);
        const count = rows[0].count;

        if (count === 0 && localData[col] && Array.isArray(localData[col])) {
          console.log(`📦 Migrating ${localData[col].length} items into table \`${col}\`...`);
          for (const item of localData[col]) {
            const id = item.id || `${col.slice(0, 3)}_${Math.random().toString(36).substr(2, 9)}`;
            // Make sure ID is set in the data itself
            item.id = id;
            await this.pool.query(
              `INSERT INTO \`${col}\` (id, data) VALUES (?, ?)`,
              [id, JSON.stringify(item)]
            );
          }
          console.log(`✅ Migration for \`${col}\` complete.`);
        }
      }
    } catch (err) {
      console.error('⚠️ Migration from local database failed:', err.message);
    }
  }

  async ensureSuperAdminExists() {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.log('⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set in environment variables. Skipping Super Admin seeding.');
      return;
    }

    console.log(`🔑 Verifying Super Admin account (${adminEmail}) in database...`);

    const now = new Date().toISOString();
    const adminUser = {
      id: 'admin_super',
      email: adminEmail,
      name: 'Super Admin',
      displayName: 'Super Admin',
      role: 'super_admin',
      roleId: 'super_admin',
      isBlocked: false,
      invitationCount: 18,
      draftsCount: 6,
      createdAt: now,
      updatedAt: now,
      password: hashPassword(adminPassword)
    };

    if (this.isMySQL) {
      try {
        // Query database directly bypassing initPromise to avoid deadlock
        const [rows] = await this.pool.query(
          `SELECT id, data FROM \`users\` WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.email')) = ?`,
          [adminEmail.toLowerCase()]
        );

        if (rows.length === 0) {
          console.log(`➕ Seeding new Super Admin user in MySQL: ${adminEmail}`);
          await this.pool.query(
            `INSERT INTO \`users\` (id, data) VALUES (?, ?)`,
            [adminUser.id, JSON.stringify(adminUser)]
          );
          // Also sync to local JSON backup
          await this.syncLocalDbBackup('users', adminUser, 'add');
        } else {
          // If super admin exists, verify password or metadata matches
          const existing = JSON.parse(rows[0].data);
          const isPasswordValid = verifyPassword(adminPassword, existing.password);
          const isHashed = existing.password && existing.password.startsWith('pbkdf2$');
          if (existing.id !== 'admin_super' || !isPasswordValid || !isHashed || existing.role !== 'super_admin') {
            console.log(`🔄 Updating existing Super Admin credentials/role in MySQL...`);
            if (existing.id !== 'admin_super') {
              console.log(`🧹 Deleting old Super Admin record with ID: ${existing.id}`);
              await this.pool.query(`DELETE FROM \`users\` WHERE id = ?`, [existing.id]);
              await this.syncLocalDbBackup('users', { id: existing.id }, 'delete');
              
              await this.pool.query(
                `INSERT INTO \`users\` (id, data) VALUES (?, ?)`,
                [adminUser.id, JSON.stringify(adminUser)]
              );
              await this.syncLocalDbBackup('users', adminUser, 'add');
            } else {
              const updated = {
                ...existing,
                password: hashPassword(adminPassword),
                role: 'super_admin',
                roleId: 'super_admin',
                updatedAt: now
              };
              await this.pool.query(
                `UPDATE \`users\` SET data = ? WHERE id = ?`,
                [JSON.stringify(updated), existing.id]
              );
              await this.syncLocalDbBackup('users', updated, 'update');
            }
          }
        }
      } catch (err) {
        console.error('❌ Failed to seed Super Admin in MySQL:', err.message);
      }
    } else {
      // Local JSON mode fallback
      try {
        const localData = await this.readLocal();
        if (!localData.users) {
          localData.users = [];
        }

        const existingIdx = localData.users.findIndex(
          u => u.email && u.email.toLowerCase() === adminEmail.toLowerCase()
        );

        if (existingIdx === -1) {
          console.log(`➕ Seeding new Super Admin user in local db.json: ${adminEmail}`);
          localData.users.push(adminUser);
          await this.writeLocal(localData);
        } else {
          const existing = localData.users[existingIdx];
          const isPasswordValid = verifyPassword(adminPassword, existing.password);
          const isHashed = existing.password && existing.password.startsWith('pbkdf2$');
          if (existing.id !== 'admin_super' || !isPasswordValid || !isHashed || existing.role !== 'super_admin') {
            console.log(`🔄 Updating existing Super Admin credentials/role in local db.json...`);
            localData.users[existingIdx] = {
              ...existing,
              id: 'admin_super',
              password: hashPassword(adminPassword),
              role: 'super_admin',
              roleId: 'super_admin',
              updatedAt: now
            };
            await this.writeLocal(localData);
          }
        }
      } catch (err) {
        console.error('❌ Failed to seed Super Admin in local JSON:', err.message);
      }
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
    try {
      const data = await fs.readFile(LOCAL_DB_PATH, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  // Helper to write local DB
  async writeLocal(data) {
    try {
      await fs.writeFile(LOCAL_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write local database file:', err);
    }
  }

  // Generic Query method to get all documents from a collection
  async getAll(collectionName) {
    await this.initPromise;
    if (this.isMySQL) {
      try {
        const [rows] = await this.pool.query(`SELECT data FROM \`${collectionName}\``);
        return rows.map(r => JSON.parse(r.data));
      } catch (error) {
        console.error(`⚠️ MySQL query failed (getAll: ${collectionName}):`, error.message);
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
    if (this.isMySQL) {
      try {
        const [rows] = await this.pool.query(`SELECT data FROM \`${collectionName}\` WHERE id = ?`, [id]);
        if (rows.length === 0) return null;
        return JSON.parse(rows[0].data);
      } catch (error) {
        console.error(`⚠️ MySQL query failed (getOne: ${collectionName}, id: ${id}):`, error.message);
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

  // Generic Get Documents matching a specific field value
  async getByField(collectionName, fieldName, value) {
    await this.initPromise;
    if (this.isMySQL) {
      try {
        // Query using MySQL JSON functions for safety and performance
        const sql = `SELECT data FROM \`${collectionName}\` WHERE JSON_EXTRACT(data, '$.${fieldName}') = ? OR JSON_UNQUOTE(JSON_EXTRACT(data, '$.${fieldName}')) = ?`;
        const jsonVal = JSON.stringify(value);
        const [rows] = await this.pool.query(sql, [jsonVal, String(value)]);
        return rows.map(r => JSON.parse(r.data));
      } catch (error) {
        console.error(`⚠️ MySQL query failed (getByField: ${collectionName}, fieldName: ${fieldName}, value: ${value}):`, error.message);
        const list = await this.getAll(collectionName);
        return list.filter(item => item[fieldName] === value);
      }
    } else {
      const list = await this.getAll(collectionName);
      return list.filter(item => item[fieldName] === value);
    }
  }

  // Generic Add Document
  async add(collectionName, documentData) {
    await this.initPromise;
    const now = new Date().toISOString();
    const id = documentData.id || `${collectionName.slice(0, 3)}_${Math.random().toString(36).substr(2, 9)}`;

    const finalDoc = {
      ...documentData,
      id,
      createdAt: now,
      updatedAt: now
    };

    let result;
    if (this.isMySQL) {
      try {
        await this.pool.query(
          `INSERT INTO \`${collectionName}\` (id, data) VALUES (?, ?)`,
          [id, JSON.stringify(finalDoc)]
        );
        // Sync local db.json file in the background so it is kept in sync as a backup
        this.syncLocalDbBackup(collectionName, finalDoc, 'add');
        result = finalDoc;
      } catch (error) {
        console.error(`⚠️ MySQL write failed (add: ${collectionName}):`, error.message);
        result = await this.addLocalFallback(collectionName, finalDoc);
      }
    } else {
      result = await this.addLocalFallback(collectionName, finalDoc);
    }

    if (['categories', 'templates', 'languages'].includes(collectionName)) {
      realtimeService.notifyUpdate(collectionName, 'add', id);
    }
    return result;
  }

  async addLocalFallback(collectionName, finalDoc) {
    const data = await this.readLocal();
    if (!data[collectionName]) data[collectionName] = [];
    data[collectionName].push(finalDoc);
    await this.writeLocal(data);
    return finalDoc;
  }

  // Generic Update Document
  async update(collectionName, id, updates) {
    await this.initPromise;
    const now = new Date().toISOString();

    let result;
    if (this.isMySQL) {
      try {
        // Fetch current first
        const current = await this.getOne(collectionName, id);
        if (!current) throw new Error(`Document not found in ${collectionName} with id: ${id}`);

        // Cleanup old profile photos if updated
        if (collectionName === 'app_users') {
          if (updates.profilePhoto !== undefined && current.profilePhoto && current.profilePhoto !== updates.profilePhoto) {
            await this.deleteProfilePhotoFile(current.profilePhoto);
          }
          if (updates.profile && updates.profile.profileImagePath !== undefined) {
            if (current.profile?.profileImagePath && current.profile.profileImagePath !== updates.profile.profileImagePath) {
              await this.deleteProfilePhotoFile(current.profile.profileImagePath);
            }
          }
        }

        const updatedDoc = {
          ...current,
          ...updates,
          id, // protect id field
          updatedAt: now
        };

        await this.pool.query(
          `UPDATE \`${collectionName}\` SET data = ? WHERE id = ?`,
          [JSON.stringify(updatedDoc), id]
        );
        // Sync local db.json in the background
        this.syncLocalDbBackup(collectionName, updatedDoc, 'update');
        result = updatedDoc;
      } catch (error) {
        console.error(`⚠️ MySQL write failed (update: ${collectionName}, id: ${id}):`, error.message);
        result = await this.updateLocalFallback(collectionName, id, updates, now);
      }
    } else {
      result = await this.updateLocalFallback(collectionName, id, updates, now);
    }

    if (['categories', 'templates', 'languages'].includes(collectionName)) {
      realtimeService.notifyUpdate(collectionName, 'update', id);
    }
    return result;
  }

  async updateLocalFallback(collectionName, id, updates, now) {
    const data = await this.readLocal();
    const list = data[collectionName] || [];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) throw new Error(`Document not found in ${collectionName} with id: ${id}`);

    const current = list[index];

    // Cleanup old profile photos if updated
    if (collectionName === 'app_users') {
      if (updates.profilePhoto !== undefined && current.profilePhoto && current.profilePhoto !== updates.profilePhoto) {
        await this.deleteProfilePhotoFile(current.profilePhoto);
      }
      if (updates.profile && updates.profile.profileImagePath !== undefined) {
        if (current.profile?.profileImagePath && current.profile.profileImagePath !== updates.profile.profileImagePath) {
          await this.deleteProfilePhotoFile(current.profile.profileImagePath);
        }
      }
    }

    const updatedItem = {
      ...list[index],
      ...updates,
      id,
      updatedAt: now
    };
    list[index] = updatedItem;
    data[collectionName] = list;
    await this.writeLocal(data);
    return updatedItem;
  }

  // Generic Delete Document
  async delete(collectionName, id) {
    await this.initPromise;
    let result;
    if (this.isMySQL) {
      try {
        await this.pool.query(`DELETE FROM \`${collectionName}\` WHERE id = ?`, [id]);
        // Sync local db.json in the background
        this.syncLocalDbBackup(collectionName, { id }, 'delete');
        result = true;
      } catch (error) {
        console.error(`⚠️ MySQL delete failed (delete: ${collectionName}, id: ${id}):`, error.message);
        result = await this.deleteLocalFallback(collectionName, id);
      }
    } else {
      result = await this.deleteLocalFallback(collectionName, id);
    }

    if (['categories', 'templates', 'languages'].includes(collectionName)) {
      realtimeService.notifyUpdate(collectionName, 'delete', id);
    }
    return result;
  }

  async deleteLocalFallback(collectionName, id) {
    const data = await this.readLocal();
    const list = data[collectionName] || [];
    const filtered = list.filter(item => item.id !== id);
    data[collectionName] = filtered;
    await this.writeLocal(data);
    return true;
  }

  // Background sync helper to keep db.json as a backup
  async syncLocalDbBackup(collectionName, item, operation) {
    try {
      const data = await this.readLocal();
      if (!data[collectionName]) data[collectionName] = [];

      if (operation === 'add') {
        data[collectionName].push(item);
      } else if (operation === 'update') {
        const idx = data[collectionName].findIndex(x => x.id === item.id);
        if (idx !== -1) {
          data[collectionName][idx] = item;
        } else {
          data[collectionName].push(item);
        }
      } else if (operation === 'delete') {
        data[collectionName] = data[collectionName].filter(x => x.id !== item.id);
      }

      await this.writeLocal(data);
    } catch (err) {
      console.warn('⚠️ Background db.json backup sync failed:', err.message);
    }
  }

  async deleteProfilePhotoFile(filePath) {
    if (!filePath) return;
    try {
      // 1. If it's a Cloudinary URL, delete from Cloudinary
      if (filePath.includes('res.cloudinary.com')) {
        const { deleteFromCloudinary, extractPublicId } = await import('./cloudinary.js');
        const publicId = extractPublicId(filePath);
        if (publicId) {
          await deleteFromCloudinary(publicId);
          console.log(`☁️ Auto-deleted old Cloudinary profile photo: ${publicId}`);
        }
        return;
      }

      // 2. Skip legacy Firebase Storage URLs
      if (filePath.startsWith('https://firebasestorage.googleapis.com')) {
        return;
      }

      // 3. Delete local file
      let relativePath = filePath;
      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        try {
          const urlObj = new URL(filePath);
          relativePath = urlObj.pathname;
        } catch (_) { }
      }

      const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
      const absolutePath = path.join(BACKEND_DIR, cleanPath);
      const assetsDir = path.join(BACKEND_DIR, 'assets');

      const normAbs = path.normalize(absolutePath).toLowerCase();
      const normAssets = path.normalize(assetsDir).toLowerCase();

      if (normAbs.startsWith(normAssets) && existsSync(absolutePath)) {
        await fs.unlink(absolutePath);
        console.log(`🗑️ Auto-deleted old local profile photo file: ${absolutePath}`);
      }
    } catch (err) {
      console.warn(`⚠️ Failed to auto-delete old profile photo ${filePath}:`, err.message);
    }
  }
}

export const dbService = new DatabaseService();
