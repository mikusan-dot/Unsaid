import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, updateDoc } from "firebase/firestore";
import { db } from "../firebase/client";

// Private journal: journals/{uid}/entries/{entryId}. Only the signed-in owner can read or
// write these documents (enforced by firestore.rules). Nothing here touches public
// collections, search, feeds or share links.
const entries = (uid) => collection(db, "journals", uid, "entries");
const entryDoc = (uid, id) => doc(db, "journals", uid, "entries", id);

function shape(snap) {
  const d = snap.data();
  const created = d.createdAt?.toMillis?.() ?? Date.now();
  return { id: snap.id, title: d.title || "", body: d.body || "", mood: d.mood || "", createdAt: created, updatedAt: d.updatedAt?.toMillis?.() ?? created, _snap: snap };
}

export async function fetchEntries(uid, { after = null, pageSize = 20 } = {}) {
  const parts = [orderBy("createdAt", "desc"), ...(after ? [startAfter(after)] : []), limit(pageSize)];
  const snap = await getDocs(query(entries(uid), ...parts));
  return { items: snap.docs.map(shape), hasMore: snap.docs.length === pageSize };
}

export async function createEntry(uid, { title, body, mood }) {
  await addDoc(entries(uid), { title, body, mood, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function updateEntry(uid, id, { title, body, mood }) {
  await updateDoc(entryDoc(uid, id), { title, body, mood, updatedAt: serverTimestamp() });
}

export async function deleteEntry(uid, id) { await deleteDoc(entryDoc(uid, id)); }

// For export: read every entry (pages of 100, capped) so people can keep their own backup.
export async function fetchAllEntries(uid, cap = 1000) {
  const all = []; let after = null;
  while (all.length < cap) {
    const page = await fetchEntries(uid, { after, pageSize: 100 });
    all.push(...page.items);
    if (!page.hasMore) break;
    after = page.items[page.items.length - 1]._snap;
  }
  return all.map(({ _snap, ...rest }) => rest);
}
