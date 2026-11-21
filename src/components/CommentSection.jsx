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
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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
        console.error("unsaid comments error:", err);
        setError("Couldn't load replies.");
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
      setError("Your anonymous session isn't ready.");
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
      setError(err.message || "Couldn't post your reply.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReplySubmit(parentId, e) {
    e.preventDefault();
    const clean = replyDraft.trim();
    if (!clean || clean.length < 1 || clean.length > MAX_COMMENT_LENGTH) return;
    if (!currentUid) {
      setError("Your anonymous session isn't ready.");
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
    if (!window.confirm("Delete this reply? This cannot be undone.")) return;
    if (!currentUid) return;
    try {
      await deleteComment({ postId, commentId, uid: currentUid });
    } catch (err) {
      setError(err.message || "Couldn't delete the reply.");
    }
  }

  return (
    <section className="comment-section">
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading replies…</p>}
      {!loading && topLevel.length === 0 && !error && (
        <div className="empty">
          <MessageCircle size={16} />
          <p>No replies yet. Be the first to respond.</p>
        </div>
      )}
      {!loading && topLevel.length > 0 && (
        <div className="comment-list">
          {topLevel.map((comment) => (
            <article key={comment.id} className="comment">
              <div className="comment-head">
                <span className="author">{comment.authorLabel}</span>
                <span className="time">{formatTime(comment.createdAt)}</span>
                <span className="reply-count">
                  {repliesByParent[comment.id]?.length} reply{repliesByParent[comment.id].length !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="comment-text">{comment.text}</p>
              <div className="comment-actions">
                {isOwner(comment) && (
                  <button type="button" className="icon-btn compact danger" title="Delete reply" onClick={() => handleDelete(comment.id)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="reply-btn"
                  onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                >
                  <Reply size={16} aria-hidden="true" /> Reply
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
                        <Send size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {repliesByParent[comment.id]?.length > 0 && (
                <div className="replies-list">
                  {repliesByParent[comment.id].map((reply) => (
                    <article key={reply.id} className="comment comment--reply">
                      <div className="comment-head">
                        <span className="author">{reply.authorLabel}</span>
                        <span className="time">{formatTime(reply.createdAt)}</span>
                        <span className="reply-count"></span>
                      </div>
                      <p className="comment-text">{reply.text}</p>
                      <div className="comment-actions">
                        {isOwner(reply) && (
                          <button type="button" className="icon-btn compact danger" title="Delete reply" onClick={() => handleDelete(reply.id)}>
                            <Trash2 size={16} aria-hidden="true" />
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
        <textarea
          ref={textAreaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a reply…"
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          className="comment-textarea"
        />
        <div className="composer-foot">
          <span>{draft.length}/{MAX_COMMENT_LENGTH}</span>
          <button
            type="submit"
            className="btn reply-send"
            disabled={!draft.trim().length || submitting}
          >
            <Send size={14} aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
