import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, Trash2, Reply, Clock3 } from "lucide-react";
import {
  subscribeToComments,
  addComment,
  deleteComment,
} from "../services/firestoreComments";
import { ensureAnonymousSession } from "../services/firebase/client";

const MAX_COMMENT_LENGTH = 500;

function formatTime(timestamp) {
  const d = new Date(timestamp);
  const now = Date.now();
  const minutes = Math.max(0, Math.floor((now - d.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function CommentSection({
  postId,
  authorLabel,
  uid: currentUid,
  initialComments,
  onCountChange,
}) {
  const [comments, setComments] = useState(initialComments ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null); // commentId being replied to
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textAreaRef = useRef(null);

  useEffect(() => {
    if (!currentUid) {
      setLoading(false);
      return;
    }
    const unsubscribe = subscribeToComments(
      postId,
      (fresh) => {
        setComments(fresh);
        setLoading(false);
        setError(null);
        if (onCountChange) onCountChange(fresh.length);
      },
      (err) => {
        console.error("UNSAID comments error:", err);
        setError("Couldn't load comments.");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [postId, currentUid, onCountChange]);

  const isOwner = useCallback((comment) => currentUid && comment.uid === currentUid, [currentUid]);

  const topLevel = useMemo(
    () => comments.filter((c) => !c.parentId),
    [comments]
  );
  const repliesByParent = useMemo(() => {
    const map = {};
    comments.forEach((c) => {
      if (c.parentId) {
        if (!map[c.parentId]) map[c.parentId] = [];
        map[c.parentId].push(c);
      }
    });
    return map;
  }, [comments]);

  async function handleSubmit(e) {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean || clean.length < 1 || clean.length > MAX_COMMENT_LENGTH) return;
    if (!currentUid) {
      setError("Your anonymous session is not ready.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ensureAnonymousSession();
      await addComment({
        postId,
        uid: currentUid,
        authorLabel,
        text: clean,
        parentId: null,
      });
      setDraft("");
      if (textAreaRef.current) textAreaRef.current.value = "";
    } catch (err) {
      setError(err.message || "Couldn't post your comment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReplySubmit(parentId, e) {
    e.preventDefault();
    const clean = replyDraft.trim();
    if (!clean || clean.length < 1 || clean.length > MAX_COMMENT_LENGTH) return;
    if (!currentUid) {
      setError("Your anonymous session is not ready.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ensureAnonymousSession();
      await addComment({
        postId,
        uid: currentUid,
        authorLabel,
        text: clean,
        parentId,
      });
      setReplyDraft("");
      setReplyingTo(null);
    } catch (err) {
      setError(err.message || "Couldn't post your reply.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId) {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    if (!currentUid) return;
    try {
      await deleteComment({ postId, commentId, uid: currentUid });
    } catch (err) {
      setError(err.message || "Couldn't delete the comment.");
    }
  }

  return (
    <section className="comment-section">
      <div className="comment-header">
        <span className="comment-count">{topLevel.length} comment{topLevel.length !== 1 ? "s" : ""}</span>
        {error && <span className="comment-error">{error}</span>}
      </div>

      {loading ? (
        <div className="comment-skeleton-list">
          {[1, 2, 3].map((i) => (
            <div key={i} className="comment-skeleton">
              <div className="skeleton-avatar" />
              <div className="skeleton-body">
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : topLevel.length === 0 ? (
        <div className="empty-comments">
          <MessageCircle size={16} />
          <p>No comments yet. Be the first to share a thought.</p>
        </div>
      ) : (
        <div className="comment-list">
          {topLevel.map((comment) => (
            <article key={comment.id} className="comment-card">
              <div className="comment-header-row">
                <div className="comment-author">{comment.authorLabel}</div>
                <div className="comment-time">{formatTime(comment.createdAt)}</div>
                <div className="comment-meta">
                  {repliesByParent[comment.id]?.length && (
                    <span className="reply-count">
                      <Reply size={11} /> {repliesByParent[comment.id].length}
                    </span>
                  )}
                </div>
              </div>
              <p className="comment-text">{comment.text}</p>
              <div className="comment-actions">
                {isOwner(comment) && (
                  <button className="icon-btn compact" title="Delete comment" onClick={() => handleDelete(comment.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
                <button
                  className="reply-btn"
                  onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                >
                  <Reply size={13} /> Reply
                </button>
              </div>

              {replyingTo === comment.id && (
                <div className="reply-composer">
                  <form onSubmit={(e) => handleReplySubmit(comment.id, e)}>
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder="Write a reply…"
                      maxLength={MAX_COMMENT_LENGTH}
                      rows={2}
                      className="reply-textarea"
                      autoFocus
                    />
                    <div className="reply-foot">
                      <span>{replyDraft.length}/{MAX_COMMENT_LENGTH}</span>
                      <button
                        type="submit"
                        className="reply-send"
                        disabled={!replyDraft.trim().length || submitting}
                      >
                        <Send size={13} />
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {repliesByParent[comment.id]?.length > 0 && (
                <div className="replies-list">
                  {repliesByParent[comment.id].map((reply) => (
                    <article key={reply.id} className="comment-card comment-card--reply">
                      <div className="comment-header-row">
                        <div className="comment-author">{reply.authorLabel}</div>
                        <div className="comment-time">{formatTime(reply.createdAt)}</div>
                        <div className="comment-meta"></div>
                      </div>
                      <p className="comment-text">{reply.text}</p>
                      <div className="comment-actions">
                        {isOwner(reply) && (
                          <button className="icon-btn compact" title="Delete reply" onClick={() => handleDelete(reply.id)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="comment-composer">
        <div className="composer-avatar">✳</div>
        <textarea
          ref={textAreaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          className="comment-textarea"
        />
        <div className="composer-foot">
          <span>{draft.length}/{MAX_COMMENT_LENGTH}</span>
          <button
            type="submit"
            className="comment-send"
            disabled={!draft.trim().length || submitting}
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </section>
  );
}
