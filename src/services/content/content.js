import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, limit, startAfter, where,
  writeBatch, serverTimestamp, updateDoc, increment, documentId,
} from "firebase/firestore";
import { db } from "../firebase/client";
import { makeAnonymousId } from "../../lib/format";

// Generic helpers for letters, questions, answers, midnight thoughts and daily responses.
// `path` is an array of collection/doc segments, e.g. ["questions", qid, "answers"].
// Comments, reactions and bookmarks are NOT implemented here: they reuse the Phase 2
// services (firestoreComments / firestoreReactions / firestoreBookmarks).
export const col = (path) => collection(db, ...path);
export const docAt = (path, id) => doc(db, ...path, id);
export { query, where, orderBy, limit, startAfter };

export function normalize(snap) {
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
    reactions: d.reactions ?? { understand: 0, alone: 0, feel: 0 },
    comments: d.comments ?? 0,
  };
}

// Same ownership pattern as Phase 2 posts: the public document never stores the author's uid;
// `postOwners/{contentId}` (readable only by its owner) links it to the anonymous session.
// `kind` is an optional extra field so each page can list only its own content.
async function assertOwner(id, uid, message) {
  const owner = await getDoc(doc(db, "postOwners", id));
  if (!owner.exists() || owner.data().uid !== uid) throw new Error(message);
}

export async function createContent({ path, kind, uid, fields, bumpParent, ownerExtra = {} }) {
  const ref = doc(col(path));
  const batch = writeBatch(db);
  batch.set(ref, { ...fields, authorLabel: makeAnonymousId(), createdAt: serverTimestamp() });
  batch.set(doc(db, "postOwners", ref.id), { uid, kind, ...ownerExtra, createdAt: serverTimestamp() });
  if (bumpParent) batch.update(doc(db, ...bumpParent.path), { [bumpParent.field]: increment(1) });
  await batch.commit();
  return ref.id;
}

export async function deleteContent({ path, id, uid, bumpParent }) {
  await assertOwner(id, uid, "You can only delete your own writing.");
  const batch = writeBatch(db);
  batch.delete(docAt(path, id));
  batch.delete(doc(db, "postOwners", id));
  if (bumpParent) batch.update(doc(db, ...bumpParent.path), { [bumpParent.field]: increment(-1) });
  await batch.commit();
}

export async function updateOwned({ path, id, uid, fields }) {
  await assertOwner(id, uid, "You can only edit your own writing.");
  await updateDoc(docAt(path, id), { ...fields, edited: true, updatedAt: serverTimestamp() });
}

export async function fetchDoc(path, id) {
  const snap = await getDoc(docAt(path, id));
  return snap.exists() ? normalize(snap) : null;
}
export function observeDoc(path, id, onData, onError) {
  return onSnapshot(docAt(path, id), (snap) => onData(snap.exists() ? normalize(snap) : null), onError);
}

// The ids of content of one kind that this anonymous session created (one listener, like Phase 2 posts).
export function subscribeOwnedIds(uid, kind, onIds, onError) {
  if (!uid) { onIds([]); return () => {}; }
  const q = query(collection(db, "postOwners"), where("uid", "==", uid), where("kind", "==", kind));
  return onSnapshot(q, (snap) => onIds(snap.docs
    .map((d) => ({ id: d.id, at: d.data().createdAt?.toMillis?.() ?? 0 }))
    .sort((a, b) => b.at - a.at).map((x) => x.id)), onError);
}

// Fetch specific documents by id (for "My ..." and "Saved" lists), chunked for `in` queries.
export async function fetchByIds(path, ids) {
  const unique = [...new Set(ids)].slice(0, 50);
  const chunks = [];
  for (let i = 0; i < unique.length; i += 10) chunks.push(unique.slice(i, i + 10));
  const results = await Promise.all(chunks.map((chunk) => getDocs(query(col(path), where(documentId(), "in", chunk)))));
  return results.flatMap((snap) => snap.docs.map(normalize)).sort((a, b) => b.createdAt - a.createdAt);
}
