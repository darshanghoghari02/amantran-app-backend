import https from 'https';

function checkTime() {
  const localTime = new Date();
  console.log("Local Time:", localTime.toISOString());
  console.log("Local Time (string):", localTime.toString());

  https.get('https://www.google.com', (res) => {
    const serverDateStr = res.headers.date;
    if (serverDateStr) {
      const serverTime = new Date(serverDateStr);
      console.log("Google Server Time:", serverTime.toISOString());
      const diffMs = Math.abs(serverTime - localTime);
      console.log(`Difference: ${diffMs} ms (${diffMs / 1000} seconds)`);
      if (diffMs > 300000) {
        console.warn("⚠️ WARNING: Your system clock is out of sync with Google's servers by more than 5 minutes!");
        console.warn("This is highly likely the cause of '16 UNAUTHENTICATED: Request had invalid authentication credentials'.");
        console.warn("Please synchronize your Windows system clock in Settings > Time & Language > Date & time > Sync now.");
      } else {
        console.log("✅ Clock is in sync (within 5 minutes limit).");
      }
    } else {
      console.log("Could not read Date header from Google response.");
    }
  }).on('error', (err) => {
    console.error("Error fetching Google time:", err.message);
  });
}

checkTime();
