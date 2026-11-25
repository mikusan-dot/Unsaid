import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, ExternalLink, BookmarkMinus } from "lucide-react";
import { fetchOwnedPage, resolveRows, fetchSaved, deleteOwned, editOwned, removeStaleRecord, pathFor, KIND_LABEL } from "../../services/account/ownership";
import { editPost } from "../../services/posts/firestorePosts";
import { removeBookmark } from "../../services/firestoreBookmarks";
import { CATEGORIES } from "../../services/posts/firestorePosts";
import { LETTER_CATEGORIES, QUESTION_CATEGORIES, LIMITS, checkLength } from "../../services/content/limits";
import { excerpt, relativeTime } from "../../lib/format";
import { Dialog, ConfirmDialog, FieldError, LoadMore } from "../shared/ui";

export const ACTIVITY = {
  posts: { kind: "post", title: "My posts", blurb: "Thoughts you've shared in the main feed.", empty: "You haven't shared a thought yet.", edit: true },
  letters: { kind: "letter", title: "My letters", blurb: "Letters you've published.", empty: "You haven't published a letter yet.", edit: true },
  questions: { kind: "question", title: "My questions", blurb: "Questions you've asked, with their answer counts.", empty: "You haven't asked a question yet.", edit: true },
  answers: { kind: "answer", title: "My answers", blurb: "Answers you've given to other people's questions.", empty: "You haven't answered a question yet." },
  thoughts: { kind: "thought", title: "My Midnight thoughts", blurb: "Thoughts you've published after dark.", empty: "You haven't published a Midnight thought yet." },
};
const heading = (it) => it.doc?.title || null;
const bodyOf = (it) => it.doc?.body || it.doc?.details || it.doc?.text || "";

export default function ActivityPage({ section, user, navigate, notify }) {
  const cfg = ACTIVITY[section];
  const [items, setItems] = useState([]); const [status, setStatus] = useState("loading");
  const [cursor, setCursor] = useState(null); const [hasMore, setHasMore] = useState(false); const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(null); const [toDelete, setToDelete] = useState(null); const [busy, setBusy] = useState(false);

  const load = useCallback(async (after = null) => {
    const page = await fetchOwnedPage(user.uid, cfg.kind, { after });
    const rows = await resolveRows(page.rows);
    return { rows, cursor: page.cursor, hasMore: page.hasMore };
  }, [user.uid, cfg.kind]);
  const first = useCallback(() => { setStatus("loading"); setItems([]); load().then((p) => { setItems(p.rows); setCursor(p.cursor); setHasMore(p.hasMore); setStatus("ready"); }).catch((e) => { console.error(e); setStatus("error"); }); }, [load]);
  useEffect(first, [first]);
  async function loadMore() { setMore(true); try { const p = await load(cursor); setItems((o) => [...o, ...p.rows]); setCursor(p.cursor); setHasMore(p.hasMore); } catch (e) { console.error(e); notify("Couldn't load more."); } finally { setMore(false); } }

  async function remove() {
    setBusy(true);
    try {
      if (toDelete.doc) await deleteOwned(toDelete, user.uid); else await removeStaleRecord(toDelete.id);
      setItems((o) => o.filter((i) => i.id !== toDelete.id)); notify("Deleted.");
    } catch (e) { console.error(e); notify(e.message?.startsWith("This older") ? e.message : "Couldn't delete this. Please try again."); }
    finally { setBusy(false); setToDelete(null); }
  }
  return <>
    <section className="page-head"><h1>{cfg.title}.</h1><p>{cfg.blurb}</p></section>
    {status === "loading" && <div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton short" /></div>}
    {status === "error" && <div className="empty" role="alert"><h3>Couldn't load this</h3><p>Check your connection. If it keeps happening, the Firestore indexes may still be building (see the README).</p><button type="button" className="btn" onClick={first}>Try again</button></div>}
    {status === "ready" && !items.length && <div className="empty"><h3>Nothing here yet</h3><p>{cfg.empty}</p></div>}
    {status === "ready" && items.map((it) => { const to = pathFor(it); const gone = !it.doc;
      return <article key={it.id} className="post">
        <div className="post-top"><div className="post-meta"><strong>{KIND_LABEL[it.kind]}</strong> · {relativeTime(it.at || Date.now())}{it.doc?.category ? ` · ${it.doc.category}` : ""}{it.doc?.edited ? " · edited" : ""}</div>
          <div className="acts">
            {!gone && to && <button type="button" className="icon-btn compact" aria-label="Open" title="Open" onClick={() => navigate(to)}><ExternalLink size={16} aria-hidden="true" /></button>}
            {!gone && cfg.edit && <button type="button" className="icon-btn compact" aria-label="Edit" title="Edit" onClick={() => setEditing(it)}><Pencil size={16} aria-hidden="true" /></button>}
            {!(it.kind === "answer" && !it.parent) && <button type="button" className="icon-btn compact" aria-label="Delete" title="Delete" onClick={() => setToDelete(it)}><Trash2 size={16} aria-hidden="true" /></button>}
          </div></div>
        {gone ? <p className="excerpt muted-copy">{it.kind === "answer" && !it.parent ? "An older answer from before accounts. Its question wasn't recorded, so it can't be linked or removed from here." : "This is no longer available. You can remove the leftover record."}</p> : <>
          {it.kind === "answer" && <p className="count-line">In reply to: {it.doc.questionMissing ? "a question that was deleted" : it.doc.questionTitle}</p>}
          {heading(it) && <h2 className="letter-title">{heading(it)}</h2>}
          <p className="excerpt">{excerpt(bodyOf(it), 220)}</p>
          {it.kind === "question" && <p className="count-line">{it.doc.answerCount || 0} {it.doc.answerCount === 1 ? "answer" : "answers"}</p>}
          {!!it.doc.tags?.length && <div className="post-tags">{it.doc.tags.map((t) => <span key={t}>#{t}</span>)}</div>}</>}
      </article>; })}
    <LoadMore hasMore={hasMore} loading={more} onClick={loadMore} />
    {editing && <EditDialog item={editing} uid={user.uid} onClose={() => setEditing(null)} onSaved={(patch) => { setItems((o) => o.map((i) => (i.id === editing.id ? { ...i, doc: { ...i.doc, ...patch, edited: true } } : i))); setEditing(null); notify("Changes saved."); }} />}
    {toDelete && <ConfirmDialog title={`Delete this ${KIND_LABEL[toDelete.kind].toLowerCase()}?`} busy={busy} onCancel={() => setToDelete(null)} onConfirm={remove}
      message={toDelete.doc ? "It disappears for everyone and can't be restored." : "This removes only the leftover private record."} />}
  </>;
}

function EditDialog({ item, uid, onClose, onSaved }) {
  const d = item.doc; const k = item.kind;
  const cats = k === "post" ? CATEGORIES : k === "letter" ? LETTER_CATEGORIES : QUESTION_CATEGORIES;
  const [category, setCategory] = useState(d.category || cats[0]);
  const [title, setTitle] = useState(d.title || ""); const [text, setText] = useState(d.text || d.body || d.details || "");
  const [tags, setTags] = useState((d.tags || []).join(", ")); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    let problem = "";
    if (k === "post") problem = checkLength(text, [12, 1200], "Your thought");
    if (k === "letter") problem = checkLength(title, LIMITS.letter.title, "The title") || checkLength(text, LIMITS.letter.body, "Your letter");
    if (k === "question") problem = checkLength(title, LIMITS.question.title, "Your question") || checkLength(text, LIMITS.question.details, "The details");
    if (problem) return setError(problem);
    setError(""); setBusy(true);
    try {
      if (k === "post") { const t = [...new Set(tags.split(",").map((x) => x.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 5); await editPost({ id: item.id, uid, text: text.trim(), category, tags: t }); onSaved({ text: text.trim(), category, tags: t }); }
      else if (k === "letter") { const f = { title: title.trim(), body: text.trim(), category }; await editOwned(item, uid, f); onSaved(f); }
      else { const f = { title: title.trim(), details: text.trim(), category }; await editOwned(item, uid, f); onSaved(f); }
    } catch (e) { console.error(e); setError("Couldn't save your changes. Please try again."); setBusy(false); }
  }
  return <Dialog titleId="edit-title" title={`Edit your ${KIND_LABEL[k].toLowerCase()}`} onClose={onClose}>
    <label className="field" htmlFor="ed-cat">{k === "post" ? "Space" : "Category"}</label>
    <select id="ed-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
    {k !== "post" && <><label className="field" htmlFor="ed-title">Title</label><input id="ed-title" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} /></>}
    <label className="field" htmlFor="ed-text">{k === "post" ? "Your thought" : k === "letter" ? "Your letter" : "Details"}</label>
    <textarea id="ed-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
    {k === "post" && <><label className="field" htmlFor="ed-tags">Tags <span>(comma separated, up to 5)</span></label><input id="ed-tags" value={tags} maxLength={100} onChange={(e) => setTags(e.target.value)} /></>}
    <FieldError>{error}</FieldError>
    <div className="dialog-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
  </Dialog>;
}

/* ---------------- Saved ---------------- */
export function SavedPage({ user, navigate, notify }) {
  const [items, setItems] = useState([]); const [status, setStatus] = useState("loading");
  const load = useCallback(() => { setStatus("loading"); fetchSaved(user.uid).then((r) => { setItems(r); setStatus("ready"); }).catch((e) => { console.error(e); setStatus("error"); }); }, [user.uid]);
  useEffect(load, [load]);
  async function unsave(it) { try { await removeBookmark({ uid: user.uid, postId: it.key }); setItems((o) => o.filter((x) => x.key !== it.key)); notify("Removed from saved."); } catch (e) { console.error(e); notify("Couldn't remove it. Please try again."); } }
  const to = (it) => (it.kind === "post" ? `/post/${it.id}` : it.kind === "letter" ? `/letters/${it.id}` : it.kind === "question" ? `/ask/${it.id}` : "/midnight");
  return <>
    <section className="page-head"><h1>Saved thoughts.</h1><p>Only you can see what you've saved. It covers thoughts, letters, questions and Midnight thoughts.</p></section>
    {status === "loading" && <div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton short" /></div>}
    {status === "error" && <div className="empty" role="alert"><h3>Couldn't load your saved items</h3><button type="button" className="btn" onClick={load}>Try again</button></div>}
    {status === "ready" && !items.length && <div className="empty"><h3>Nothing saved yet</h3><p>Select Save on anything you want to come back to.</p><button type="button" className="btn primary" onClick={() => navigate("/")}>Browse thoughts</button></div>}
    {status === "ready" && items.map((it) => <article key={it.key} className="post">
      <div className="post-top"><div className="post-meta"><strong>{KIND_LABEL[it.kind]}</strong>{it.doc?.category ? ` · ${it.doc.category}` : ""}</div>
        <div className="acts">{it.doc && <button type="button" className="icon-btn compact" aria-label="Open" title="Open" onClick={() => navigate(to(it))}><ExternalLink size={16} aria-hidden="true" /></button>}
          <button type="button" className="icon-btn compact" aria-label="Remove from saved" title="Remove from saved" onClick={() => unsave(it)}><BookmarkMinus size={16} aria-hidden="true" /></button></div></div>
      {it.doc ? <>{it.doc.title && <h2 className="letter-title">{it.doc.title}</h2>}<p className="excerpt">{excerpt(it.doc.body || it.doc.details || it.doc.text || "", 200)}</p></> : <p className="excerpt muted-copy">This was deleted by its writer. You can remove it from your saved list.</p>}
    </article>)}
  </>;
}
