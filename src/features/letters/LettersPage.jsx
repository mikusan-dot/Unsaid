import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Copy, Trash2, ArrowLeft } from "lucide-react";
import { useFeed } from "../../hooks/useFeed";
import { createContent, deleteContent, observeDoc, where } from "../../services/content/content";
import { bookmarkKey } from "../../services/firestoreBookmarks";
import { LETTER_CATEGORIES, LIMITS, checkLength, zeroReactions } from "../../services/content/limits";
import { excerpt } from "../../lib/format";
import { Dialog, ConfirmDialog, NeedsFirebase, FeedStatus, LoadMore, Tabs, FieldError, Meta, ReactionBar, CommentToggle, cooldownOk } from "../shared/ui";
import { useOwnedIds, useReactionState, Thread } from "../shared/interactions";

const PATH = ["letters"];
const SCOPES = [{ value: "all", label: "All letters" }, { value: "mine", label: "My letters" }, { value: "saved", label: "Saved" }];
const key = (id) => bookmarkKey("letter", id);

export default function LettersPage(ctx) {
  if (!ctx.configured) return <NeedsFirebase name="Letters" />;
  return ctx.id ? <LetterDetail {...ctx} /> : <LetterFeed {...ctx} />;
}

function LetterFeed({ user, ensureUser, notify, bookmarks, toggleBookmark, navigate }) {
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [writing, setWriting] = useState(false);
  const [openThreads, setOpenThreads] = useState({});
  const { ownedList } = useOwnedIds("letter", user?.uid);
  const savedIds = useMemo(() => bookmarks.filter((k) => k.startsWith("letter_")).map((k) => k.slice(7)), [bookmarks]);
  const constraints = useMemo(() => (category === "All" ? [] : [where("category", "==", category)]), [category]);
  const feed = useFeed({ path: PATH, scope, constraints, constraintsKey: category, scopeIds: scope === "mine" ? ownedList : savedIds });
  const ids = useMemo(() => feed.items.map((l) => l.id), [feed.items]);
  const { mine, react } = useReactionState({ basePath: PATH, ids, user, ensureUser, notify, patchLocal: feed.patchLocal });
  const shown = feed.items.filter((l) => (scope === "all" || category === "All" || l.category === category) && `${l.title} ${l.body}`.toLowerCase().includes(search.toLowerCase()));

  return <>
    <section className="page-head">
      <h1>Letters never sent.</h1>
      <p>Write the words you never got to say. No name, no reply required.</p>
      <div className="page-actions"><button type="button" className="btn primary" onClick={() => setWriting(true)}>Write a letter</button></div>
    </section>
    <div className="subnav">
      <Tabs label="Show" value={scope} options={SCOPES} onChange={setScope} />
      <label className="searchbox"><span className="sr-only">Search loaded letters</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search letters" /></label>
    </div>
    <Tabs label="Filter by category" value={category} options={["All", ...LETTER_CATEGORIES]} onChange={setCategory} />
    <FeedStatus status={feed.status} count={shown.length} onRetry={feed.retry} empty={
      scope === "mine" ? <><h3>You haven't written a letter yet</h3><p>Letters you publish appear here.</p></>
      : scope === "saved" ? <><h3>Nothing saved yet</h3><p>Select Save on a letter to keep it here.</p></>
      : search ? <><h3>No letters match</h3><p>Search only covers letters already loaded. Try Load more.</p></>
      : <><h3>No letters yet</h3><p>Be the first to write one.</p></>} />
    {shown.map((l) => <article key={l.id} className="post">
      <Meta item={l} extra={l.category} />
      <button type="button" className="post-open" onClick={() => navigate(`/letters/${l.id}`)} aria-label={`Open letter: ${l.title}`}>
        <h2 className="letter-title">{l.title}</h2>
        <span className="excerpt">{excerpt(l.body)}</span>
      </button>
      <div className="post-foot">
        <ReactionBar id={l.id} reactions={l.reactions} mine={mine[l.id]} onReact={react} />
        <div className="acts">
          <CommentToggle count={l.comments} open={Boolean(openThreads[l.id])} onClick={() => setOpenThreads((o) => ({ ...o, [l.id]: !o[l.id] }))} />
          <SaveButton saved={bookmarks.includes(key(l.id))} onClick={() => toggleBookmark(key(l.id))} />
        </div>
      </div>
      {openThreads[l.id] && <Thread parentPath={[...PATH, l.id]} user={user} ensureUser={ensureUser} />}
    </article>)}
    <LoadMore hasMore={feed.hasMore && scope === "all"} loading={feed.loadingMore} onClick={feed.loadMore} />
    {writing && <LetterForm ensureUser={ensureUser} notify={notify} onClose={() => setWriting(false)} onDone={(id) => { setWriting(false); navigate(`/letters/${id}`); }} />}
  </>;
}

export function SaveButton({ saved, onClick }) {
  return <button type="button" className="act" aria-pressed={saved} onClick={onClick}><Bookmark size={16} aria-hidden="true" fill={saved ? "currentColor" : "none"} />{saved ? "Saved" : "Save"}</button>;
}

function LetterForm({ ensureUser, notify, onClose, onDone }) {
  const [category, setCategory] = useState(LETTER_CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const problem = checkLength(title, LIMITS.letter.title, "The title") || checkLength(body, LIMITS.letter.body, "Your letter");
    if (problem) { setError(problem); return; }
    if (!cooldownOk("letter", 10000)) { setError("Please wait a few seconds before publishing another letter."); return; }
    setError(""); setBusy(true);
    try {
      const user = await ensureUser();
      const id = await createContent({ path: PATH, kind: "letter", uid: user.uid, fields: { title: title.trim(), body: body.trim(), category, reactions: zeroReactions(), comments: 0 } });
      notify("Letter published anonymously.");
      onDone(id);
    } catch (err) { console.error(err); setError("Couldn't publish your letter. Please try again."); setBusy(false); }
  }
  return <Dialog titleId="letter-form-title" title="Write a letter" hint="Addressed to someone, or to no one. Don't include names or details that could identify anyone." onClose={onClose}>
    <label className="field" htmlFor="letter-category">Category</label>
    <select id="letter-category" value={category} onChange={(e) => setCategory(e.target.value)}>{LETTER_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
    <label className="field" htmlFor="letter-title">Title</label>
    <input id="letter-title" maxLength={LIMITS.letter.title[1]} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dear…" />
    <label className="field" htmlFor="letter-body">Your letter</label>
    <textarea id="letter-body" rows={9} maxLength={LIMITS.letter.body[1]} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Say it all. Nobody will know it's you." />
    <FieldError>{error}</FieldError>
    <div className="dialog-foot"><small>{body.trim().length < LIMITS.letter.body[0] ? `At least ${LIMITS.letter.body[0]} characters. ` : ""}{body.length.toLocaleString()}/{LIMITS.letter.body[1].toLocaleString()}</small><button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? "Publishing…" : "Publish letter"}</button></div>
  </Dialog>;
}

function LetterDetail({ id, user, ensureUser, notify, bookmarks, toggleBookmark, navigate }) {
  const [letter, setLetter] = useState(undefined);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { isOwned } = useOwnedIds("letter", user?.uid);
  useEffect(() => observeDoc(PATH, id, setLetter, (e) => { console.error(e); setError(true); }), [id]);
  const ids = useMemo(() => [id], [id]);
  const { mine, react } = useReactionState({ basePath: PATH, ids, user, ensureUser, notify });
  const back = <button type="button" className="back" onClick={() => navigate("/letters")}><ArrowLeft size={16} aria-hidden="true" /> All letters</button>;
  if (error) return <section className="detail">{back}<div className="empty" role="alert"><h3>Couldn't load this letter</h3><p>Please try again in a moment.</p></div></section>;
  if (letter === undefined) return <section className="detail">{back}<div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton" /></div></section>;
  if (letter === null) return <section className="detail">{back}<div className="empty"><h3>Letter not found</h3><p>It may have been deleted by its writer.</p></div></section>;
  async function remove() {
    setBusy(true);
    try { const u = user || await ensureUser(); await deleteContent({ path: PATH, id, uid: u.uid }); notify("Letter deleted."); navigate("/letters"); }
    catch (err) { console.error(err); notify("Couldn't delete this letter."); setBusy(false); setConfirming(false); }
  }
  async function copyLink() { try { await navigator.clipboard.writeText(`${window.location.origin}/letters/${id}`); notify("Link copied."); } catch { notify("Couldn't copy the link."); } }
  return <section className="detail">
    {back}
    <article className="post" style={{ borderBottom: 0 }}>
      <Meta item={letter} extra={letter.category} />
      <h1 className="title">{letter.title}</h1>
      <p className="letter-body">{letter.body}</p>
      <div className="post-foot">
        <ReactionBar id={id} reactions={letter.reactions} mine={mine[id]} onReact={react} />
        <div className="acts">
          <SaveButton saved={bookmarks.includes(key(id))} onClick={() => toggleBookmark(key(id))} />
          <button type="button" className="act" onClick={copyLink}><Copy size={16} aria-hidden="true" />Copy link</button>
          {isOwned(id) && <button type="button" className="act danger" onClick={() => setConfirming(true)}><Trash2 size={16} aria-hidden="true" />Delete</button>}
        </div>
      </div>
    </article>
    <section className="replies" aria-labelledby="letter-replies"><h2 id="letter-replies">Replies ({letter.comments})</h2><Thread parentPath={[...PATH, id]} user={user} ensureUser={ensureUser} /></section>
    {confirming && <ConfirmDialog title="Delete this letter?" message="This removes it for everyone. This can't be undone." busy={busy} onConfirm={remove} onCancel={() => setConfirming(false)} />}
  </section>;
}
