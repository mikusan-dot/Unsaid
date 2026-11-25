import { doc, getDoc, setDoc, updateDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/client";
import { describeUser } from "../auth/account";

// users/{uid}: private profile. Never holds credentials, email or anything public.
// `accountType` / `linkedProviders` mirror Firebase Auth for convenience; Auth is the source of truth.
export const DEFAULT_PREFERENCES = { theme: "system", defaultSort: "Latest", defaultCategory: "All" };
export const SORTS = ["Latest", "Trending", "Most discussed"];
const ref = (uid) => doc(db, "users", uid);
const mirror = (user) => { const i = describeUser(user); return { accountType: i.isAnonymous ? "anonymous" : "registered", linkedProviders: i.providers.filter((p) => p === "password" || p === "google.com") }; };

export async function fetchProfile(uid) {
  const snap = await getDoc(ref(uid)); if (!snap.exists()) return null;
  const d = snap.data();
  return { ...d, createdAtMs: d.createdAt?.toMillis?.() ?? null, preferences: { ...DEFAULT_PREFERENCES, ...(d.preferences || {}) } };
}
export async function ensureProfile(user) {
  const existing = await fetchProfile(user.uid); if (existing) return existing;
  await setDoc(ref(user.uid), { createdAt: serverTimestamp(), updatedAt: serverTimestamp(), displayName: "", preferences: { ...DEFAULT_PREFERENCES }, ...mirror(user) });
  return fetchProfile(user.uid);
}
export async function saveProfile(user, patch) {
  await ensureProfile(user);
  const data = { updatedAt: serverTimestamp(), ...mirror(user) };
  if (patch.displayName !== undefined) data.displayName = patch.displayName.trim();
  if (patch.preferences) data.preferences = { ...DEFAULT_PREFERENCES, ...patch.preferences };
  await updateDoc(ref(user.uid), data);
  return fetchProfile(user.uid);
}
// Best effort after linking: keep the mirror fields current. Failure never blocks the link itself.
export async function syncProfileMirror(user) { try { const p = await fetchProfile(user.uid); if (p) await updateDoc(ref(user.uid), { updatedAt: serverTimestamp(), ...mirror(user) }); } catch (e) { console.warn("profile sync skipped", e); } }
export const deleteProfile = (uid) => deleteDoc(ref(uid));
