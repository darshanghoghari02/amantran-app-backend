const fs = require('fs');

// 1. Modify AndroidManifest.xml
const manifestFile = 'c:/Users/olive/amantran_app/android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(manifestFile)) {
  let content = fs.readFileSync(manifestFile, 'utf-8');
  
  // Find <queries> block
  const queriesStart = content.indexOf('<queries>');
  const queriesEnd = content.indexOf('</queries>');
  
  if (queriesStart !== -1 && queriesEnd !== -1) {
    const originalQueries = content.substring(queriesStart, queriesEnd + '</queries>'.length);
    const newQueries = `<queries>
        <intent>
            <action android:name="android.intent.action.PROCESS_TEXT"/>
            <data android:mimeType="text/plain"/>
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW"/>
            <data android:scheme="https"/>
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW"/>
            <data android:scheme="whatsapp"/>
        </intent>
        <intent>
            <action android:name="android.intent.action.SEND"/>
            <data android:mimeType="application/pdf"/>
        </intent>
        <package android:name="com.whatsapp"/>
        <package android:name="com.whatsapp.w4b"/>
        <package android:name="com.google.android.gm"/>
        <package android:name="com.google.android.apps.messaging"/>
        <package android:name="com.samsung.android.messaging"/>
        <package android:name="com.android.mms"/>
        <package android:name="com.android.messaging"/>
        <package android:name="com.xiaomi.discover"/>
    </queries>`;
    
    content = content.replace(originalQueries, newQueries);
    fs.writeFileSync(manifestFile, content, 'utf-8');
    console.log('Successfully updated AndroidManifest.xml');
  } else {
    console.error('Error: <queries> block not found in AndroidManifest.xml');
  }
} else {
  console.error('Error: AndroidManifest.xml not found');
}
