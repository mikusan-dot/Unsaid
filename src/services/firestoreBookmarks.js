import {
  collection, doc, onSnapshot, query, setDoc, deleteDoc, getDoc,
} from "firebase/firestore";
import { db } from "./firebase/client";

const bookmarksCollection = (uid) => collection(db, "users", uid, "bookmarks");

/**
 * Subscribe to the current user's bookmarked post IDs.
 * Returns an unsubscribe function.
 */
export function subscribeToBookmarks(uid, onBookmarks, onError) {
  if (!uid) {
    onBookmarks([]);
    return () => {};
  }
  const q = query(bookmarksCollection(uid));
  return onSnapshot(q, (snap) => {
    const bookmarks = snap.docs.map((d) => d.id); // document id = postId
    onBookmarks(bookmarks);
  }, onError);
}

/**
 * Bookmark a post for the current user.
 */
export async function addBookmark({ uid, postId }) {
  await setDoc(doc(db, "users", uid, "bookmarks", postId), {
    postId,
    createdAt: serverTimestamp(),
  });
}

/**
 * Remove a bookmark for the current user.
 */
export async function removeBookmark({ uid, postId }) {
  await deleteDoc(doc(db, "users", uid, "bookmarks", postId));
}

/**
 * Check whether a post is bookmarked by the current user.
 */
export async function isBookmarked({ uid, postId }) {
  const snap = await getDoc(doc(db, "users", uid, "bookmarks", postId));
  return snap.exists();
}
