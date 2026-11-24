import React, { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useFeed } from "../../hooks/useFeed";
import { createContent, deleteContent, where } from "../../services/content/content";
import { bookmarkKey } from "../../services/firestoreBookmarks";
import { THOUGHT_CATEGORIES, MOODS, LIMITS, checkLength, zeroReactions } from "../../services/content/limits";
import { Dialog, ConfirmDialog, NeedsFirebase, FeedStatus, LoadMore, Tabs, FieldError, Meta, ReactionBar, CommentToggle, cooldownOk } from "../shared/ui";
import { useOwnedIds, useReactionState, Thread } from "../shared/interactions";
import { SaveButton } from "../letters/LettersPage";

const PATH = ["midnightThoughts"];
const SCOPES = [{ value: "all", label: "All thoughts" }, { value: "mine", label: "My thoughts" }, { value: "saved", label: "Saved" }];
const key = (id) => bookmarkKey("thought", id);
const total = (t) => Object.values(t.reactions || {}).reduce((a, b) => a + b, 0);

export default function MidnightPage({ configured, user, ensureUser, notify, bookmarks, toggleBookmark }) {
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("All");
  const [mood, setMood] = useState("All");
  const [sort, setSort] = useState("Latest");
  const [search, setSearch] = useState("");
  const [writing, setWriting] = useState(false);
  const [openThreads, setOpenThreads] = useState({});
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const { ownedList, isOwned } = useOwnedIds("thought", user?.uid);
  const savedIds = useMemo(() => bookmarks.filter((k) => k.startsWith("thought_")).map((k) => k.slice(8)), [bookmarks]);
  const constraints = useMemo(() => (category === "All" ? [] : [where("category", "==", category)]), [category]);
  const feed = useFeed({ path: PATH, scope, constraints, constraintsKey: category, scopeIds: scope === "mine" ? ownedList : savedIds, enabled: configured });
  const ids = useMemo(() => feed.items.map((t) => t.id), [feed.items]);
  const { mine, react } = useReactionState({ basePath: PATH, ids, user, ensureUser, notify, patchLocal: feed.patchLocal });
  if (!configured) return <NeedsFirebase name="Midnight" />;

  let shown = feed.items.filter((t) => (scope === "all" || category === "All" || t.category === category)
    && (mood === "All" || t.mood === mood) && `${t.text} ${t.mood || ""} ${t.category}`.toLowerCase().includes(search.toLowerCase()));
  if (sort === "Trending") shown = [...shown].sort((a, b) => total(b) + (b.comments || 0) - (total(a) + (a.comments || 0)));

  async function remove() {
    setBusy(true);
    try { const u = user || await ensureUser(); await deleteContent({ path: PATH, id: toDelete, uid: u.uid }); feed.removeLocal(toDelete); notify("Deleted."); }
    catch (err) { console.error(err); notify("Couldn't delete this thought."); }
    finally { setBusy(false); setToDelete(null); }
  }

  return <>
    <section className="page-head">
      <h1>After dark.</h1>
      <p>Short thoughts that arrive late. Share one at any hour; there's no deadline here.</p>
      <div className="page-actions"><button type="button" className="btn primary" onClick={() => setWriting(true)}>Share a thought</button></div>
    </section>
    <p className="notice">If you're thinking about harming yourself, please reach out to local emergency services or a crisis line in your country, or someone you trust. You don't have to carry it alone.</p>
    <div className="subnav">
      <Tabs label="Show" value={scope} options={SCOPES} onChange={setScope} />
      <div className="feed-tools">
        <label className="searchbox"><span className="sr-only">Search loaded thoughts</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search thoughts" /></label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort thoughts"><option>Latest</option><option>Trending</option></select>
        <select value={mood} onChange={(e) => setMood(e.target.value)} aria-label="Filter by mood"><option value="All">Any mood</option>{MOODS.map((m) => <option key={m}>{m}</option>)}</select>
      </div>
    </div>
    <Tabs label="Filter by theme" value={category} options={["All", ...THOUGHT_CATEGORIES]} onChange={setCategory} />
    <FeedStatus status={feed.status} count={shown.length} onRetry={feed.retry} empty={
      scope === "mine" ? <><h3>You haven't shared a thought yet</h3><p>Thoughts you share appear here.</p></>
      : scope === "saved" ? <><h3>Nothing saved yet</h3><p>Select Save on a thought to keep it here.</p></>
      : search || mood !== "All" ? <><h3>No thoughts match</h3><p>Filters only cover thoughts already loaded. Try Load more.</p></>
      : <><h3>It's quiet here</h3><p>Share the first thought.</p></>} />
    {shown.map((t) => <article key={t.id} className="post">
      <Meta item={t} extra={t.category} />
      {t.mood && <p className="mood" style={{ fontSize: ".875rem", marginTop: "var(--s1)" }}>Feeling {t.mood.toLowerCase()}</p>}
      <p className="post-text" style={{ marginTop: "var(--s2)" }}>{t.text}</p>
      <div className="post-foot">
        <ReactionBar id={t.id} reactions={t.reactions} mine={mine[t.id]} onReact={react} />
        <div className="acts">
          <CommentToggle count={t.comments} open={Boolean(openThreads[t.id])} onClick={() => setOpenThreads((o) => ({ ...o, [t.id]: !o[t.id] }))} />
          <SaveButton saved={bookmarks.includes(key(t.id))} onClick={() => toggleBookmark(key(t.id))} />
          {isOwned(t.id) && <button type="button" className="act danger" onClick={() => setToDelete(t.id)}><Trash2 size={16} aria-hidden="true" />Delete</button>}
        </div>
      </div>
      {openThreads[t.id] && <Thread parentPath={[...PATH, t.id]} user={user} ensureUser={ensureUser} />}
    </article>)}
    <LoadMore hasMore={feed.hasMore && scope === "all"} loading={feed.loadingMore} onClick={feed.loadMore} />
    {writing && <ThoughtForm ensureUser={ensureUser} notify={notify} onClose={() => setWriting(false)} />}
    {toDelete && <ConfirmDialog title="Delete this thought?" message="It will be removed for everyone. This can't be undone." busy={busy} onConfirm={remove} onCancel={() => setToDelete(null)} />}
  </>;
}

function ThoughtForm({ ensureUser, notify, onClose }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState(THOUGHT_CATEGORIES[0]);
  const [mood, setMood] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const problem = checkLength(text, LIMITS.thought.text, "Your thought");
    if (problem) { setError(problem); return; }
    if (!cooldownOk("thought", 8000)) { setError("Please wait a few seconds before sharing another thought."); return; }
    setError(""); setBusy(true);
    try {
      const user = await ensureUser();
      await createContent({ path: PATH, kind: "thought", uid: user.uid, fields: { text: text.trim(), mood, category, reactions: zeroReactions(), comments: 0 } });
      notify("Shared anonymously."); onClose();
    } catch (err) { console.error(err); setError("Couldn't share your thought. Please try again."); setBusy(false); }
  }
  return <Dialog titleId="thought-form-title" title="Share a thought" hint="Short and honest is enough." onClose={onClose}>
    <label className="field" htmlFor="thought-text">Your thought</label>
    <textarea id="thought-text" rows={4} maxLength={LIMITS.thought.text[1]} value={text} onChange={(e) => setText(e.target.value)} placeholder="What's on your mind tonight?" style={{ minHeight: "7rem" }} />
    <label className="field" htmlFor="thought-category">Theme</label>
    <select id="thought-category" value={category} onChange={(e) => setCategory(e.target.value)}>{THOUGHT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
    <p className="field" id="mood-label">Mood <span>(optional)</span></p>
    <div className="chips" role="group" aria-labelledby="mood-label">{MOODS.map((m) => <button type="button" key={m} className="chip" aria-pressed={mood === m} onClick={() => setMood(mood === m ? "" : m)}>{m}</button>)}</div>
    <FieldError>{error}</FieldError>
    <div className="dialog-foot"><small>{text.length}/{LIMITS.thought.text[1]}</small><button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? "Sharing…" : "Share anonymously"}</button></div>
  </Dialog>;
}
