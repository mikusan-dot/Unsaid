// Seeds dailyPrompts/{YYYY-MM-DD} from scripts/daily-prompts.json, one per day starting at a date you choose.
// Free on the Spark plan: it uses the Firebase Admin SDK locally with a service-account key you download
// from Firebase Console -> Project settings -> Service accounts. NEVER commit that key.
//
//   npm install --no-save firebase-admin
//   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/seed-daily-prompts.mjs 2026-11-21
//
// Re-running is safe: it overwrites the same date ids. (Not yet run against a live project.)
import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const start = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")) { console.error("Usage: node scripts/seed-daily-prompts.mjs YYYY-MM-DD"); process.exit(1); }
const prompts = JSON.parse(readFileSync(new URL("./daily-prompts.json", import.meta.url), "utf8"));
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const batch = db.batch();
prompts.forEach((text, i) => {
  const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
  batch.set(db.collection("dailyPrompts").doc(date), { date, text });
});
await batch.commit();
console.log(`Seeded ${prompts.length} prompts from ${start}.`);
