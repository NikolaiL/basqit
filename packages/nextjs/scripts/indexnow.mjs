// Submits every URL in the live sitemap to IndexNow (Bing, Yandex and others share submissions).
// Run after a deploy that adds or changes pages: `yarn indexnow`. The key is public by design.
const host = "basqit.app";
const key = "6f9b4a647d68b0b873b19c58cfba229b";

const sitemap = await (await fetch(`https://${host}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
if (!urlList.length) throw new Error("Sitemap has no URLs");

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
});
// 200 and 202 both mean accepted; 403 means the key file is not live yet.
console.log(`IndexNow: ${response.status} for ${urlList.length} URLs`);
if (!response.ok) process.exit(1);
