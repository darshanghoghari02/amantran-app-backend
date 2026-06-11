import https from 'https';

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

async function checkLiveTemplates() {
  try {
    console.log("Fetching templates from live Render API...");
    const templates = await fetchUrl('https://amantran-admin-backend.onrender.com/api/templates');
    console.log(`Live Templates count: ${templates.length}`);
    templates.forEach(t => {
      console.log(`- Template: ID=${t.id}, Name=${t.name}, CategoryId=${t.categoryId}, PagesCount=${t.pages ? t.pages.length : 0}`);
    });
    
    console.log("Fetching categories from live Render API...");
    const categories = await fetchUrl('https://amantran-admin-backend.onrender.com/api/categories');
    console.log(`Live Categories count: ${categories.length}`);
    categories.forEach(c => {
      console.log(`- Category: ID=${c.id}, Name=${c.name}`);
    });
  } catch (err) {
    console.error("Error fetching live data:", err.message);
  }
}

checkLiveTemplates();
