import React, { useEffect, useRef } from "react";
import { X, MessageCircle } from "lucide-react";
import { REACTION_TYPES } from "../../services/content/limits";
import { relativeTime } from "../../lib/format";

/* ---------- dialog (focus trap, Escape, focus restore) ---------- */
export function Dialog({ titleId, title, hint, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = ref.current;
    const focusables = () => [...dialog.querySelectorAll("button:not([disabled]), textarea, input, select, [href]")];
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = focusables(); if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); window.setTimeout(() => opener?.focus?.(), 0); };
  }, [onClose]);
  return <div className="backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="dialog-head">
        <div><h2 id={titleId}>{title}</h2>{hint && <p className="dialog-hint">{hint}</p>}</div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>
      {children}
    </section>
  </div>;
}

export function ConfirmDialog({ title, message, confirmLabel = "Delete", busy, onConfirm, onCancel }) {
  return <Dialog titleId="confirm-title" title={title} onClose={onCancel}>
    <p className="dialog-hint">{message}</p>
    <div className="dialog-foot">
      <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
    </div>
  </Dialog>;
}

/* ---------- states ---------- */
export function NeedsFirebase({ name }) {
  return <div className="empty"><h3>{name} needs the shared database</h3><p>Add your Firebase settings to <code>.env.local</code> and restart the dev server. See the README for setup.</p></div>;
}
export function FeedStatus({ status, count, onRetry, empty }) {
  if (status === "loading") return <div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton short" /></div>;
  if (status === "error") return <div className="empty" role="alert"><h3>Couldn't load this</h3><p>Check your connection and try again. If this keeps happening, the database indexes may still need deploying (see the README).</p><button type="button" className="btn" onClick={onRetry}>Try again</button></div>;
  if (!count) return <div className="empty">{empty}</div>;
  return null;
}
export function LoadMore({ hasMore, loading, onClick }) {
  if (!hasMore) return null;
  return <div className="load-more"><button type="button" className="btn" onClick={onClick} disabled={loading}>{loading ? "Loading…" : "Load more"}</button></div>;
}
export function Tabs({ label, value, options, onChange }) {
  return <div className="tabs" role="group" aria-label={label}>{options.map((o) => {
    const v = typeof o === "string" ? o : o.value; const l = typeof o === "string" ? o : o.label;
    return <button type="button" key={v} className="tab" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>;
  })}</div>;
}
export function FieldError({ children }) { return children ? <p className="field-error" role="alert">{children}</p> : null; }

// UX guard against accidental double posts, not a security boundary.
const lastAction = {};
export function cooldownOk(key, ms = 8000) {
  const now = Date.now();
  if (now - (lastAction[key] || 0) < ms) return false;
  lastAction[key] = now; return true;
}

/* ---------- shared bits ---------- */
export function Meta({ item, extra }) {
  return <div className="post-meta"><strong>{item.authorLabel || "Someone, somewhere"}</strong> · {relativeTime(item.createdAt)}{item.edited ? " · edited" : ""}{extra ? ` · ${extra}` : ""}</div>;
}
// Same look as the Phase 2 reaction buttons: one reaction per person, press again to remove.
export function ReactionBar({ id, reactions, mine, onReact }) {
  return <div className="reactions" role="group" aria-label="Reactions">
    {REACTION_TYPES.map((r) => <button type="button" key={r.type} className="react" aria-pressed={mine === r.type} onClick={() => onReact(id, r.type)}>{r.label} <span className="count">{reactions?.[r.type] || 0}</span></button>)}
  </div>;
}
export function CommentToggle({ count, open, onClick }) {
  return <button type="button" className="act" aria-expanded={open} onClick={onClick}><MessageCircle size={16} aria-hidden="true" /><span className="count">{count || 0}</span><span>{open ? "Hide replies" : "Replies"}</span></button>;
}
