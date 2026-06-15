// Use native global fetch

async function test() {
  const urls = [
    'http://localhost:5000/api/analytics/summary',
    'http://localhost:5000/api/analytics/subscription-summary',
    'http://localhost:5000/api/transactions/stats/summary',
    'http://localhost:5000/api/transactions'
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      console.log(`\nURL: ${url}`);
      console.log(`Status: ${res.status}`);
      if (res.ok) {
        const json = await res.json();
        console.log(`Response length/keys:`, Array.isArray(json) ? `Array with ${json.length} items` : Object.keys(json));
        console.log(`Data:`, JSON.stringify(Array.isArray(json) ? json.slice(0, 2) : json, null, 2));
      } else {
        console.log(`Error body:`, await res.text());
      }
    } catch (err) {
      console.error(`Failed to fetch ${url}:`, err.message);
    }
  }
}
test();
