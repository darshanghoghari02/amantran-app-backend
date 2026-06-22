import https from 'https';

const text = "શુભ વિવાહ";
const sl = "gu";
const tl = "ur";
const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;

console.log("Fetching URL:", url);

https.get(url, (res) => {
  console.log("Response status code:", res.statusCode);
  console.log("Response headers:", res.headers);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Response body:", data);
  });
}).on('error', (err) => {
  console.error("Error:", err);
});
