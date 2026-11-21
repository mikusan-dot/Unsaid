import {
  collection, doc, onSnapshot, query, setDoc, deleteDoc,
  getDoc, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase/client";

const REACTION_TYPES = ["understand", "alone", "feel"];

const reactionsCollection = (postId) => collection(db, "posts", postId, "reactions");

/**
 * Subscribe to real-time reactions for a post.
 * Returns a map of uid -> reaction type, and an unsubscribe function.
 */
export function subscribeToReactions(postId, onReactions, onError) {
  const q = query(reactionsCollection(postId));
  return onSnapshot(q, (snap) => {
    const userReactions = {}; // uid -> type
    snap.docs.forEach((d) => {
      const data = d.data();
      userReactions[d.id] = data.type; // document id is the uid
    });
    onReactions(userReactions);
  }, onError);
}

/**
 * Get the reaction type selected by a specific user on a post (null if none).
 */
export async function getUserReaction(postId, uid) {
  const snap = await getDoc(doc(db, "posts", postId, "reactions", uid));
  return snap.exists() ? snap.data().type : null;
}

/**
 * Set or change a user's reaction on a post.
 * One reaction per user per post (enforced by document id = uid).
 * Updates the post's reactions counter atomically via a transaction.
 */
export async function setReaction({ postId, uid, type }) {
  if (!REACTION_TYPES.includes(type)) {
    throw new Error("Invalid reaction type.");
  }

  const postRef = doc(db, "posts", postId);
  const reactionRef = doc(db, "posts", postId, "reactions", uid);

  await runTransaction(db, async (transaction) => {
    const postSnap = await transaction.get(postRef);
    if (!postSnap.exists()) {
      throw new Error("Post not found.");
    }

    const current = postSnap.data().reactions ?? { understand: 0, alone: 0, feel: 0 };
    const next = { ...current };

    const reactionSnap = await transaction.get(reactionRef);
    const existing = reactionSnap.exists() ? reactionSnap.data().type : null;

    if (existing && next[existing] !== undefined) {
      next[existing] = Math.max(0, next[existing] - 1);
    }
    if (next[type] !== undefined) {
      next[type] = (next[type] || 0) + 1;
    }

    transaction.update(postRef, { reactions: next });
    transaction.set(reactionRef, {
      type,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

/**
 * Remove a user's reaction from a post.
 */
export async function removeReaction({ postId, uid }) {
  const postRef = doc(db, "posts", postId);
  const reactionRef = doc(db, "posts", postId, "reactions", uid);

  await runTransaction(db, async (transaction) => {
    const reactionSnap = await transaction.get(reactionRef);
    if (!reactionSnap.exists()) {
      return; // nothing to remove
    }

    const type = reactionSnap.data().type;
    transaction.delete(reactionRef);

    const postSnap = await transaction.get(postRef);
    if (postSnap.exists()) {
      const current = postSnap.data().reactions ?? { understand: 0, alone: 0, feel: 0 };
      const next = { ...current };
      if (next[type] !== undefined) {
        next[type] = Math.max(0, next[type] - 1);
      }
      transaction.update(postRef, { reactions: next });
    }
  });
}

/**
 * Get aggregated reaction counts for a post.
 */
export async function getReactionCounts(postId) {
  const snap = await getDocs(reactionsCollection(postId));
  const counts = { understand: 0, alone: 0, feel: 0 };
  snap.docs.forEach((d) => {
    const type = d.data().type;
    if (Object.prototype.hasOwnProperty.call(counts, type)) {
      counts[type] += 1;
    }
  });
  return counts;
}

export { REACTION_TYPES };
