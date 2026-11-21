import {
  collection, doc, onSnapshot, query, orderBy, limit,
  addDoc, deleteDoc, getDoc, getDocs, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase/client";

const MAX_COMMENT_LENGTH = 500;
const MIN_COMMENT_LENGTH = 1;
const COMMENTS_PER_POST = 50;

const commentsCollection = (postId) => collection(db, "posts", postId, "comments");

/**
 * Subscribe to real-time comments for a post (top-level + replies, one level).
 * Returns an unsubscribe function.
 */
export function subscribeToComments(postId, onComments, onError) {
  const q = query(
    commentsCollection(postId),
    orderBy("createdAt", "asc"),
    limit(COMMENTS_PER_POST)
  );
  return onSnapshot(q, (snap) => {
    const comments = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        postId: data.postId,
        uid: data.uid,
        authorLabel: data.authorLabel ?? "Anonymous",
        text: data.text,
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
        parentId: data.parentId ?? null,
      };
    });
    onComments(comments);
  }, onError);
}

/**
 * Add a top-level comment or a reply (parentId set). Updates the post's
 * comments counter atomically via a Firestore transaction.
 */
export async function addComment({ postId, uid, authorLabel, text, parentId = null }) {
  const clean = text.trim();
  if (!clean || clean.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty.");
  }
  if (clean.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment must be under ${MAX_COMMENT_LENGTH} characters.`);
  }
  if (!authorLabel || !authorLabel.trim()) {
    throw new Error("Author label is required.");
  }

  const postRef = doc(db, "posts", postId);

  await runTransaction(db, async (transaction) => {
    const postSnap = await transaction.get(postRef);
    if (!postSnap.exists()) {
      throw new Error("Post not found.");
    }

    const commentRef = doc(commentsCollection(postId));
    transaction.set(commentRef, {
      postId,
      uid,
      authorLabel: authorLabel.trim(),
      text: clean,
      createdAt: serverTimestamp(),
      parentId: parentId || null,
    });

    const nextCount = (postSnap.data().comments ?? 0) + 1;
    transaction.update(postRef, { comments: nextCount });
  });
}

/**
 * Delete a comment (or reply). Only the author (uid match) may delete.
 * Decrements the post's comments counter atomically.
 */
export async function deleteComment({ postId, commentId, uid }) {
  const postRef = doc(db, "posts", postId);
  const commentRef = doc(db, "posts", postId, "comments", commentId);

  await runTransaction(db, async (transaction) => {
    const commentSnap = await transaction.get(commentRef);
    if (!commentSnap.exists()) {
      throw new Error("Comment not found.");
    }
    const comment = commentSnap.data();
    if (comment.uid !== uid) {
      throw new Error("You can only delete your own comment.");
    }

    transaction.delete(commentRef);

    const postSnap = await transaction.get(postRef);
    if (postSnap.exists()) {
      const nextCount = Math.max(0, (postSnap.data().comments ?? 0) - 1);
      transaction.update(postRef, { comments: nextCount });
    }
  });
}

/**
 * Get the total comment count for a post (derived from the comments subcollection).
 */
export async function getCommentCount(postId) {
  const snap = await getDocs(commentsCollection(postId));
  return snap.size;
}
