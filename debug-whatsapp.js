/**
 * Debug script v3 - Uses WABA ID directly to list templates and phone numbers
 * Run: node debug-whatsapp.js
 */

import dotenv from 'dotenv';
dotenv.config();

const ACCESS_TOKEN = process.env.META_WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
const WABA_ID = process.env.META_WHATSAPP_WABA_ID;

async function run() {
  console.log('=== Meta WhatsApp Debug v3 ===\n');
  console.log('WABA ID:', WABA_ID);
  console.log('Phone Number ID:', PHONE_NUMBER_ID);
  console.log('Token (first 30 chars):', ACCESS_TOKEN?.slice(0, 30) + '...\n');

  // Step 1: List all phone numbers in this WABA
  console.log('--- Step 1: All phone numbers in WABA ---');
  const phonesRes = await fetch(
    `https://graph.facebook.com/v20.0/${WABA_ID}/phone_numbers?fields=display_phone_number,verified_name,id,quality_rating,status`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
  const phonesData = await phonesRes.json();

  if (phonesData.error) {
    console.log('❌ Error fetching phone numbers:', JSON.stringify(phonesData.error, null, 2));
  } else {
    const phones = phonesData.data || [];
    console.log(`✅ Found ${phones.length} phone number(s) in WABA:\n`);
    phones.forEach(p => {
      const isTest = p.display_phone_number?.includes('555');
      console.log(`  - ID: ${p.id}`);
      console.log(`    Number: ${p.display_phone_number} ${isTest ? '⚠️ TEST NUMBER' : '✅ REAL NUMBER'}`);
      console.log(`    Name: ${p.verified_name}`);
      console.log(`    Status: ${p.status}, Quality: ${p.quality_rating}\n`);
    });
  }

  // Step 2: List all templates in this WABA
  console.log('--- Step 2: All templates in WABA ---');
  const templatesRes = await fetch(
    `https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?fields=name,language,status,category&limit=50`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
  const templatesData = await templatesRes.json();

  if (templatesData.error) {
    console.log('❌ Error fetching templates:', JSON.stringify(templatesData.error, null, 2));
  } else {
    const templates = templatesData.data || [];
    console.log(`✅ Found ${templates.length} template(s):\n`);
    templates.forEach(t => {
      const isTarget = t.name === 'amantran_ticket_id';
      console.log(`  ${isTarget ? '👉' : '  '} Name: ${t.name}, Language: ${t.language}, Status: ${t.status}`);
    });

    const target = templates.find(t => t.name === 'amantran_ticket_id');
    if (target) {
      console.log(`\n✅ Template "amantran_ticket_id" EXISTS in WABA!`);
      console.log(`   Language code in API: "${target.language}"`);
      console.log(`\n👉 Use this in .env: META_WHATSAPP_TEMPLATE_LANG=${target.language}`);
    } else {
      console.log('\n❌ Template "amantran_ticket_id" NOT found in WABA!');
    }
  }

  // Step 3: Summary
  console.log('\n--- Step 3: Summary & Next Action ---');
  const phones2 = (await (await fetch(
    `https://graph.facebook.com/v20.0/${WABA_ID}/phone_numbers?fields=display_phone_number,id`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  )).json()).data || [];

  const realNumbers = phones2.filter(p => !p.display_phone_number?.includes('555'));
  if (realNumbers.length > 0) {
    console.log('✅ You have real phone numbers! Use one of these IDs in .env:');
    realNumbers.forEach(p => console.log(`   META_WHATSAPP_PHONE_NUMBER_ID=${p.id}  (${p.display_phone_number})`));
  } else {
    console.log('❌ No real phone numbers found. You must add one at:');
    console.log(`   https://developers.facebook.com/apps/891482820637677/whatsapp-business/wa-dev-console`);
  }
}

run().catch(console.error);
