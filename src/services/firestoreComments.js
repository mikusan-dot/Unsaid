import {
  collection, doc, getDocs, onSnapshot, query, orderBy, limit,
  addDoc, deleteDoc, getDoc, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase/client";

const MAX_COMMENT_LENGTH = 500;
const MIN_COMMENT_LENGTH = 1;
const COMMENTS_PER_POST = 50;

// `target` is either a post id (Phase 2, unchanged) or a parent document path
// array such as ["letters", id] or ["questions", qid, "answers", aid].
const parentRef = (target) => (Array.isArray(target) ? doc(db, ...target) : doc(db, "posts", target));
const parentId = (target) => (Array.isArray(target) ? target[target.length - 1] : target);
const commentsCollection = (target) => collection(parentRef(target), "comments");

/**
 * Subscribe to real-time comments for a post (top-level + replies, one level).
 * Returns an unsubscribe function.
 */
export function subscribeToComments(target, onComments, onError) {
  const q = query(
    commentsCollection(target),
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
export async function addComment({ postId, parentPath, uid, authorLabel, text, parentId: replyTo = null }) {
  const target = parentPath ?? postId;
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

  const postRef = parentRef(target);

  await runTransaction(db, async (transaction) => {
    const postSnap = await transaction.get(postRef);
    if (!postSnap.exists()) {
      throw new Error("Post not found.");
    }

    const commentRef = doc(commentsCollection(target));
    transaction.set(commentRef, {
      postId: parentId(target),
      uid,
      authorLabel: authorLabel.trim(),
      text: clean,
      createdAt: serverTimestamp(),
      parentId: replyTo || null,
    });

    const nextCount = (postSnap.data().comments ?? 0) + 1;
    transaction.update(postRef, { comments: nextCount });
  });
}

/**
 * Delete a comment (or reply). Only the author (uid match) may delete.
 * Decrements the post's comments counter atomically.
 */
export async function deleteComment({ postId, parentPath, commentId, uid }) {
  const target = parentPath ?? postId;
  const postRef = parentRef(target);
  const commentRef = doc(commentsCollection(target), commentId);

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
export async function getCommentCount(target) {
  const snap = await getDocs(commentsCollection(target));
  return snap.size;
}
