import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Download } from "lucide-react";
import { fetchEntries, createEntry, updateEntry, deleteEntry, fetchAllEntries } from "../../services/content/journal";
import { MOODS, LIMITS, checkLength } from "../../services/content/limits";
import { excerpt, formatDate } from "../../lib/format";
import { Dialog, ConfirmDialog, NeedsFirebase, FeedStatus, LoadMore, FieldError } from "../shared/ui";

export default function JournalPage({ configured, ensureUser, notify }) {
  if (!configured) return <NeedsFirebase name="The private journal" />;
  return <Journal ensureUser={ensureUser} notify={notify} />;
}

function Journal({ ensureUser, notify }) {
  const [uid, setUid] = useState(null);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [mood, setMood] = useState("All");
  const [editing, setEditing] = useState(null); // null | "new" | entry
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async (userId) => {
    setStatus("loading");
    try { const page = await fetchEntries(userId); setItems(page.items); setHasMore(page.hasMore); setStatus("ready"); }
    catch (e) { console.error(e); setStatus("error"); }
  }, []);
  useEffect(() => { let on = true; ensureUser().then((u) => { if (on) { setUid(u.uid); load(u.uid); } }).catch((e) => { console.error(e); if (on) setStatus("error"); }); return () => { on = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function more() {
    setLoadingMore(true);
    try { const page = await fetchEntries(uid, { after: items[items.length - 1]._snap }); setItems((prev) => [...prev, ...page.items]); setHasMore(page.hasMore); }
    catch (e) { console.error(e); notify("Couldn't load more entries."); }
    finally { setLoadingMore(false); }
  }
  async function remove() {
    setBusy(true);
    try { await deleteEntry(uid, toDelete.id); setItems((prev) => prev.filter((e) => e.id !== toDelete.id)); notify("Entry deleted."); }
    catch (e) { console.error(e); notify("Couldn't delete this entry."); }
    finally { setBusy(false); setToDelete(null); }
  }
  async function exportAll() {
    try {
      const all = await fetchAllEntries(uid);
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: all }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "unsaid-journal.json"; a.click(); URL.revokeObjectURL(a.href);
      notify(`Exported ${all.length} ${all.length === 1 ? "entry" : "entries"}.`);
    } catch (e) { console.error(e); notify("Couldn't export your journal."); }
  }
  const shown = useMemo(() => items.filter((e) => (mood === "All" || e.mood === mood) && `${e.title} ${e.body}`.toLowerCase().includes(search.toLowerCase())), [items, mood, search]);

  return <>
    <section className="page-head">
      <h1>Your private journal.</h1>
      <p>Only for you. Never shown in feeds, search, or shared links.</p>
      <div className="page-actions">
        <button type="button" className="btn primary" onClick={() => setEditing("new")} disabled={!uid}>New entry</button>
        <button type="button" className="btn" onClick={exportAll} disabled={!uid || !items.length}><Download size={16} aria-hidden="true" /> Export</button>
      </div>
    </section>
    <details className="notice">
      <summary>How private is this, really?</summary>
      <p><strong>Who can read it:</strong> only this anonymous session. The database rules reject every read and write except by the owner, and entries are stored apart from all public content.</p>
      <p><strong>What it isn't:</strong> it is not end-to-end encrypted. Entries are stored unencrypted on Google's Firebase servers, so anyone with administrator access to this project's Firebase console could technically see database contents. The app has no moderation view of journals.</p>
      <p><strong>No account recovery:</strong> your journal is tied to this browser's anonymous session. Clearing site data, switching browsers or devices, or private windows will lock you out permanently, and nobody can restore access. Link an email or Google account from <a href="/account/security">Account → Security</a> to keep access, and use Export for your own backup.</p>
    </details>
    <div className="subnav">
      <label className="searchbox"><span className="sr-only">Search your entries</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your entries" /></label>
      <select value={mood} onChange={(e) => setMood(e.target.value)} aria-label="Filter by mood"><option value="All">Any mood</option>{MOODS.map((m) => <option key={m}>{m}</option>)}</select>
    </div>
    <FeedStatus status={status} count={shown.length} onRetry={() => uid ? load(uid) : window.location.reload()} empty={
      search || mood !== "All" ? <><h3>No entries match</h3><p>Search only covers entries already loaded. Try Load more.</p></>
      : <><h3>Your journal is empty</h3><p>Write the first entry whenever you're ready.</p></>} />
    {shown.map((e) => {
      const open = Boolean(expanded[e.id]); const long = e.body.length > 300;
      return <article key={e.id} className="post">
        <div className="post-top">
          <div className="post-meta"><strong>{formatDate(e.createdAt)}</strong>{e.updatedAt - e.createdAt > 5000 ? " · edited" : ""}{e.mood ? <> · <span className="mood">{e.mood}</span></> : null}</div>
          <div className="acts">
            <button type="button" className="icon-btn compact" aria-label="Edit entry" title="Edit" onClick={() => setEditing(e)}><Pencil size={16} aria-hidden="true" /></button>
            <button type="button" className="icon-btn compact" aria-label="Delete entry" title="Delete" onClick={() => setToDelete(e)}><Trash2 size={16} aria-hidden="true" /></button>
          </div>
        </div>
        {e.title && <h2 className="entry-title">{e.title}</h2>}
        {open ? <p className="entry-body">{e.body}</p> : <span className="excerpt">{excerpt(e.body, 300)}</span>}
        {long && <button type="button" className="act" aria-expanded={open} onClick={() => setExpanded((o) => ({ ...o, [e.id]: !open }))}>{open ? "Show less" : "Read more"}</button>}
      </article>;
    })}
    <LoadMore hasMore={hasMore} loading={loadingMore} onClick={more} />
    {editing && <EntryForm entry={editing === "new" ? null : editing} uid={uid} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(uid); }} />}
    {toDelete && <ConfirmDialog title="Delete this entry?" message="It will be permanently removed. This can't be undone." busy={busy} onConfirm={remove} onCancel={() => setToDelete(null)} />}
  </>;
}

function EntryForm({ entry, uid, notify, onClose, onSaved }) {
  const [title, setTitle] = useState(entry?.title || "");
  const [body, setBody] = useState(entry?.body || "");
  const [mood, setMood] = useState(entry?.mood || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const problem = checkLength(title, LIMITS.journal.title, "The title") || checkLength(body, LIMITS.journal.body, "Your entry");
    if (problem) { setError(problem); return; }
    setError(""); setBusy(true);
    try {
      const data = { title: title.trim(), body: body.trim(), mood };
      if (entry) await updateEntry(uid, entry.id, data); else await createEntry(uid, data);
      notify(entry ? "Changes saved." : "Saved to your journal."); onSaved();
    } catch (e) { console.error(e); setError("Couldn't save this entry. Please try again."); setBusy(false); }
  }
  return <Dialog titleId="entry-form-title" title={entry ? "Edit entry" : "New entry"} hint="Only you can read this." onClose={onClose}>
    <label className="field" htmlFor="entry-title">Title <span>(optional)</span></label>
    <input id="entry-title" maxLength={LIMITS.journal.title[1]} value={title} onChange={(e) => setTitle(e.target.value)} />
    <label className="field" htmlFor="entry-body">Entry</label>
    <textarea id="entry-body" rows={10} maxLength={LIMITS.journal.body[1]} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write freely." />
    <p className="field" id="entry-mood">Mood <span>(optional)</span></p>
    <div className="chips" role="group" aria-labelledby="entry-mood">{MOODS.map((m) => <button type="button" key={m} className="chip" aria-pressed={mood === m} onClick={() => setMood(mood === m ? "" : m)}>{m}</button>)}</div>
    <FieldError>{error}</FieldError>
    <div className="dialog-foot"><small>{body.length.toLocaleString()}/{LIMITS.journal.body[1].toLocaleString()}</small><button type="button" className="btn primary" onClick={submit} disabled={busy || !body.trim()}>{busy ? "Saving…" : "Save entry"}</button></div>
  </Dialog>;
}
