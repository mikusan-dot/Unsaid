import {
  collection, doc, getDocs, onSnapshot, orderBy, query, where, limit,
  writeBatch, serverTimestamp, updateDoc, deleteDoc, getDoc,
} from "firebase/firestore";
import { db } from "../firebase/client";

const postsRef = () => collection(db, "posts");
const ownersRef = () => collection(db, "postOwners");

function normalizePost(snapshot, ownerIds) {
  const data = snapshot.data();
  const createdAt = data.createdAt?.toMillis?.() ?? Date.now();
  return {
    id: snapshot.id, category: data.category, text: data.text, tags: data.tags ?? [],
    createdAt, time: "", comments: data.comments ?? 0,
    reactions: data.reactions ?? { understand: 0, alone: 0, feel: 0 },
    edited: Boolean(data.edited), owner: ownerIds.has(snapshot.id),
    author: data.authorLabel ?? "Someone, somewhere",
  };
}

export function subscribeToPosts(uid, onPosts, onError) {
  let latestPosts = [];
  let ownerIds = new Set();
  let postsReady = false;
  let ownersReady = false;
  const publish = () => {
    if (postsReady && ownersReady) onPosts(latestPosts.map((item) => normalizePost(item, ownerIds)));
  };
  const stopPosts = onSnapshot(query(postsRef(), orderBy("createdAt", "desc"), limit(60)), (snap) => {
    latestPosts = snap.docs; postsReady = true; publish();
  }, onError);
  const stopOwners = uid
    ? onSnapshot(query(ownersRef(), where("uid", "==", uid)), (snap) => {
        ownerIds = new Set(snap.docs.map((item) => item.id)); ownersReady = true; publish();
      }, onError)
    : () => { ownersReady = true; publish(); };
  if (!uid) { ownersReady = true; publish(); }
  return () => { stopPosts(); stopOwners(); };
}

export async function createPost({ uid, text, category, tags, authorLabel }) {
  const postRef = doc(postsRef());
  const ownerRef = doc(ownersRef(), postRef.id);
  const batch = writeBatch(db);
  batch.set(postRef, {
    text, category, tags, authorLabel, comments: 0,
    reactions: { understand: 0, alone: 0, feel: 0 },
    createdAt: serverTimestamp(), edited: false,
  });
  batch.set(ownerRef, { uid, createdAt: serverTimestamp() });
  await batch.commit();
  return postRef.id;
}

export async function editPost({ id, uid, text, category, tags }) {
  const owner = await getDoc(doc(db, "postOwners", id));
  if (!owner.exists() || owner.data().uid !== uid) throw new Error("You can only edit your own thought.");
  await updateDoc(doc(db, "posts", id), { text, category, tags, edited: true, updatedAt: serverTimestamp() });
}

export async function removePost({ id, uid }) {
  const ownerRef = doc(db, "postOwners", id);
  const owner = await getDoc(ownerRef);
  if (!owner.exists() || owner.data().uid !== uid) throw new Error("You can only delete your own thought.");
  const batch = writeBatch(db);
  batch.delete(doc(db, "posts", id));
  batch.delete(ownerRef);
  await batch.commit();
}
