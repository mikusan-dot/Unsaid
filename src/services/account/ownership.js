import { collection, doc, getDoc, getDocs, getCountFromServer, query, where, orderBy, limit, startAfter, writeBatch, increment, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/client";
import { fetchByIds, normalize } from "../content/content";
import { removePost } from "../posts/firestorePosts";
import { deleteContent, updateOwned } from "../content/content";

// All "mine" lists start from postOwners (readable only by the owner; public documents never hold a uid).
// Posts predate the `kind` field, so a post is an owner record with no `kind`.
const owners = () => collection(db, "postOwners");
export const COLLECTION = { post: "posts", letter: "letters", question: "questions", thought: "midnightThoughts" };
export const KIND_LABEL = { post: "Thought", letter: "Letter", question: "Question", answer: "Answer", thought: "Midnight thought" };
export const kindOf = (d) => d.kind || "post";

const count = async (q) => (await getCountFromServer(q)).data().count;
// Seven aggregate queries (each costs about one read). No collection is scanned.
export async function getCounts(uid) {
  const own = (kind) => count(query(owners(), where("uid", "==", uid), where("kind", "==", kind)));
  const [total, letters, questions, answers, thoughts, saved, journal] = await Promise.all([
    count(query(owners(), where("uid", "==", uid))), own("letter"), own("question"), own("answer"), own("thought"),
    count(collection(db, "users", uid, "bookmarks")), count(collection(db, "journals", uid, "entries")),
  ]);
  return { posts: Math.max(0, total - letters - questions - answers - thoughts), letters, questions, answers, thoughts, saved, journal, total };
}

const row = (d) => ({ id: d.id, kind: kindOf(d.data()), parent: d.data().parent || null, at: d.data().createdAt?.toMillis?.() ?? 0 });

// One page of owner records of a kind, newest first. Needs the composite indexes in firestore.indexes.json.
export async function fetchOwnedPage(uid, kind, { after = null, pageSize = 10 } = {}) {
  if (kind !== "post") {
    const q = query(owners(), where("uid", "==", uid), where("kind", "==", kind), orderBy("createdAt", "desc"), ...(after ? [startAfter(after)] : []), limit(pageSize));
    const snap = await getDocs(q);
    return { rows: snap.docs.map(row), cursor: snap.docs[snap.docs.length - 1] ?? after, hasMore: snap.docs.length === pageSize };
  }
  // Posts have no `kind`: scan the owner's own records (bounded) and keep the ones without it.
  const rows = []; let cursor = after, more = true, loops = 0;
  scan: while (more && loops++ < 6) {
    const snap = await getDocs(query(owners(), where("uid", "==", uid), orderBy("createdAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(30)));
    for (const d of snap.docs) {
      cursor = d;                                   // cursor always points at the last record consumed
      if (!d.data().kind) rows.push(row(d));
      if (rows.length === pageSize) { more = true; break scan; } // may have more; next call resumes after `cursor`
    }
    more = snap.docs.length === 30;
  }
  return { rows, cursor, hasMore: more };
}
export async function fetchRecentRows(uid, n = 8) {
  const snap = await getDocs(query(owners(), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(n)));
  return snap.docs.map(row);
}

// Turn owner rows into displayable items. A missing content document yields `doc: null`.
export async function resolveRows(rows) {
  const questionCache = {};
  const byKind = (k) => rows.filter((r) => r.kind === k).map((r) => r.id);
  const found = {};
  await Promise.all(Object.keys(COLLECTION).map(async (k) => { const ids = byKind(k); if (ids.length) (await fetchByIds([COLLECTION[k]], ids)).forEach((d) => { found[`${k}:${d.id}`] = d; }); }));
  await Promise.all(rows.filter((r) => r.kind === "answer").map(async (r) => {
    if (!r.parent) return;
    const [a, q] = await Promise.all([getDoc(doc(db, "questions", r.parent, "answers", r.id)), questionCache[r.parent] ?? (questionCache[r.parent] = getDoc(doc(db, "questions", r.parent)))]);
    if (a.exists()) found[`answer:${r.id}`] = { ...normalize(a), questionTitle: q.exists() ? q.data().title : null, questionMissing: !q.exists() };
  }));
  return rows.map((r) => ({ ...r, doc: found[`${r.kind}:${r.id}`] || null }));
}

export function pathFor(item) {
  if (item.kind === "post") return `/post/${item.id}`;
  if (item.kind === "letter") return `/letters/${item.id}`;
  if (item.kind === "question") return `/ask/${item.id}`;
  if (item.kind === "answer") return item.parent ? `/ask/${item.parent}` : null;
  return "/midnight";
}

// ---- saved (bookmarks) ----
const PREFIX = { letter_: "letter", question_: "question", thought_: "thought" };
export const parseBookmarkKey = (key) => { for (const [p, kind] of Object.entries(PREFIX)) if (key.startsWith(p)) return { kind, id: key.slice(p.length) }; return { kind: "post", id: key }; };
export async function fetchSaved(uid, n = 50) {
  const snap = await getDocs(query(collection(db, "users", uid, "bookmarks"), orderBy("createdAt", "desc"), limit(n)));
  const entries = snap.docs.map((d) => ({ key: d.id, ...parseBookmarkKey(d.id), at: d.data().createdAt?.toMillis?.() ?? 0 }));
  const found = {};
  await Promise.all(Object.keys(COLLECTION).map(async (k) => { const ids = entries.filter((e) => e.kind === k).map((e) => e.id); if (ids.length) (await fetchByIds([COLLECTION[k]], ids)).forEach((d) => { found[`${k}:${d.id}`] = d; }); }));
  return entries.map((e) => ({ ...e, doc: found[`${e.kind}:${e.id}`] || null }));
}

// ---- manage (owner only; rules enforce it too) ----
export async function deleteOwned(item, uid) {
  if (item.kind === "post") return removePost({ id: item.id, uid });
  if (item.kind === "answer") {
    if (!item.parent) throw new Error("This older answer can't be removed here because its question wasn't recorded.");
    const parentSnap = await getDoc(doc(db, "questions", item.parent));
    return deleteContent({ path: ["questions", item.parent, "answers"], id: item.id, uid, bumpParent: parentSnap.exists() ? { path: ["questions", item.parent], field: "answerCount" } : undefined });
  }
  return deleteContent({ path: [COLLECTION[item.kind]], id: item.id, uid });
}
export const editOwned = (item, uid, fields) => updateOwned({ path: [COLLECTION[item.kind]], id: item.id, uid, fields });
// Removes only the private ownership record of content that no longer exists.
export const removeStaleRecord = (id) => deleteDoc(doc(db, "postOwners", id));
export { writeBatch, increment };
