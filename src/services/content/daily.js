import {
  collection, doc, getDoc, getDocFromServer, getDocs, setDoc, serverTimestamp, writeBatch,
  query, where, orderBy, limit, getCountFromServer,
} from "firebase/firestore";
import { db } from "../firebase/client";
import { makeAnonymousId } from "../../lib/format";
import { DAILY_DAY_OFFSET_HOURS } from "./limits";
import { normalize } from "./content";

// ---- Which day is it? Ask Firestore, not the visitor's clock. ----
// We write `serverTimestamp()` to clock/{uid} and read it straight back. That costs
// one write and one read, works on the Spark plan, and cannot be spoofed by changing
// the device date.
let clockOffset = null;
export async function getServerNowMs(uid) {
  if (clockOffset !== null) return Date.now() + clockOffset;
  const ref = doc(db, "clock", uid);
  const before = Date.now();
  await setDoc(ref, { t: serverTimestamp() });
  const snap = await getDocFromServer(ref);
  const serverMs = snap.data().t.toMillis();
  clockOffset = serverMs - Math.round((before + Date.now()) / 2);
  return Date.now() + clockOffset;
}
export function dateIdFromMs(ms) { return new Date(ms + DAILY_DAY_OFFSET_HOURS * 3600000).toISOString().slice(0, 10); }
export const isDateId = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const prompt = (snap) => ({ id: snap.id, date: snap.data().date, text: snap.data().text });

// Prompts are managed by you (Firebase Console or the seed script); clients can only read them.
// If a day has no prompt, the most recent earlier prompt stays current.
export async function fetchCurrentPrompt(todayId) {
  const snap = await getDocs(query(collection(db, "dailyPrompts"), where("date", "<=", todayId), orderBy("date", "desc"), limit(1)));
  return snap.docs[0] ? prompt(snap.docs[0]) : null;
}
export async function fetchPrompt(dateId) {
  const snap = await getDoc(doc(db, "dailyPrompts", dateId));
  return snap.exists() ? prompt(snap) : null;
}
export async function fetchPastPrompts(beforeDate, pageSize = 15) {
  const snap = await getDocs(query(collection(db, "dailyPrompts"), where("date", "<", beforeDate), orderBy("date", "desc"), limit(pageSize)));
  return { items: snap.docs.map(prompt), hasMore: snap.docs.length === pageSize };
}

let todayCache = null; // { at, value }
export async function getToday(uid) {
  if (todayCache && Date.now() - todayCache.at < 10 * 60000) return todayCache.value;
  const nowMs = await getServerNowMs(uid);
  const todayId = dateIdFromMs(nowMs);
  const value = { todayId, prompt: await fetchCurrentPrompt(todayId) };
  todayCache = { at: Date.now(), value };
  return value;
}

// ---- One response per anonymous session per prompt ----
// A private marker doc `dailyMarkers/{promptId}_{uid}` is created in the same batch as the
// response. Rules refuse a second response while the marker exists, and the public
// response never contains the uid.
const markerRef = (promptId, uid) => doc(db, "dailyMarkers", `${promptId}_${uid}`);
export async function getMyResponseId(promptId, uid) {
  const snap = await getDoc(markerRef(promptId, uid));
  return snap.exists() ? snap.data().responseId : null;
}
export async function submitDailyResponse({ promptId, uid, text }) {
  if (await getMyResponseId(promptId, uid)) throw new Error("You've already answered this question.");
  const ref = doc(collection(db, "dailyResponses"));
  const batch = writeBatch(db);
  batch.set(ref, { promptId, text, authorLabel: makeAnonymousId(), reactions: { understand: 0, alone: 0, feel: 0 }, comments: 0, createdAt: serverTimestamp() });
  batch.set(markerRef(promptId, uid), { promptId, responseId: ref.id, createdAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}
export async function deleteDailyResponse({ promptId, uid, responseId }) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "dailyResponses", responseId));
  batch.delete(markerRef(promptId, uid));
  await batch.commit();
}
export async function countResponses(promptId) {
  const snap = await getCountFromServer(query(collection(db, "dailyResponses"), where("promptId", "==", promptId)));
  return snap.data().count;
}
export { normalize };
