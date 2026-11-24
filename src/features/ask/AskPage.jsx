import React, { useEffect, useMemo, useState } from "react";
import { Copy, Trash2, Pencil, ArrowLeft } from "lucide-react";
import { useFeed } from "../../hooks/useFeed";
import { createContent, deleteContent, updateOwned, observeDoc, where } from "../../services/content/content";
import { bookmarkKey } from "../../services/firestoreBookmarks";
import { QUESTION_CATEGORIES, LIMITS, checkLength, zeroReactions } from "../../services/content/limits";
import { excerpt } from "../../lib/format";
import { Dialog, ConfirmDialog, NeedsFirebase, FeedStatus, LoadMore, Tabs, FieldError, Meta, ReactionBar, CommentToggle, cooldownOk } from "../shared/ui";
import { useOwnedIds, useReactionState, Thread } from "../shared/interactions";
import { SaveButton } from "../letters/LettersPage";

const PATH = ["questions"];
const SCOPES = [{ value: "all", label: "All questions" }, { value: "mine", label: "My questions" }, { value: "saved", label: "Saved" }];
const key = (id) => bookmarkKey("question", id);

export default function AskPage(ctx) {
  if (!ctx.configured) return <NeedsFirebase name="Ask Anything" />;
  return ctx.id ? <QuestionDetail {...ctx} /> : <QuestionFeed {...ctx} />;
}

function QuestionFeed({ user, ensureUser, notify, bookmarks, navigate }) {
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [asking, setAsking] = useState(false);
  const { ownedList } = useOwnedIds("question", user?.uid);
  const savedIds = useMemo(() => bookmarks.filter((k) => k.startsWith("question_")).map((k) => k.slice(9)), [bookmarks]);
  const constraints = useMemo(() => (category === "All" ? [] : [where("category", "==", category)]), [category]);
  const feed = useFeed({ path: PATH, scope, constraints, constraintsKey: category, scopeIds: scope === "mine" ? ownedList : savedIds });
  const shown = feed.items.filter((q) => (scope === "all" || category === "All" || q.category === category) && `${q.title} ${q.details || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <section className="page-head">
      <h1>Ask anything.</h1>
      <p>Questions you can't ask out loud, answered by people who don't know who you are.</p>
      <div className="page-actions"><button type="button" className="btn primary" onClick={() => setAsking(true)}>Ask a question</button></div>
    </section>
    <div className="subnav">
      <Tabs label="Show" value={scope} options={SCOPES} onChange={setScope} />
      <label className="searchbox"><span className="sr-only">Search loaded questions</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions" /></label>
    </div>
    <Tabs label="Filter by category" value={category} options={["All", ...QUESTION_CATEGORIES]} onChange={setCategory} />
    <FeedStatus status={feed.status} count={shown.length} onRetry={feed.retry} empty={
      scope === "mine" ? <><h3>You haven't asked anything yet</h3><p>Questions you ask appear here.</p></>
      : scope === "saved" ? <><h3>Nothing saved yet</h3><p>Select Save on a question to keep it here.</p></>
      : search ? <><h3>No questions match</h3><p>Search only covers questions already loaded. Try Load more.</p></>
      : <><h3>No questions yet</h3><p>Ask the first one.</p></>} />
    {shown.map((q) => <article key={q.id} className="post">
      <Meta item={q} extra={q.category} />
      <button type="button" className="post-open" onClick={() => navigate(`/ask/${q.id}`)} aria-label={`Open question: ${q.title}`}>
        <h2 className="letter-title">{q.title}</h2>
        {q.details && <span className="excerpt">{excerpt(q.details, 160)}</span>}
      </button>
      <p className="count-line">{q.answerCount || 0} {q.answerCount === 1 ? "answer" : "answers"}</p>
    </article>)}
    <LoadMore hasMore={feed.hasMore && scope === "all"} loading={feed.loadingMore} onClick={feed.loadMore} />
    {asking && <QuestionForm ensureUser={ensureUser} notify={notify} onClose={() => setAsking(false)} onDone={(id) => { setAsking(false); navigate(`/ask/${id}`); }} />}
  </>;
}

function QuestionForm({ question, user, ensureUser, notify, onClose, onDone }) {
  const editing = Boolean(question);
  const [category, setCategory] = useState(question?.category || QUESTION_CATEGORIES[0]);
  const [title, setTitle] = useState(question?.title || "");
  const [details, setDetails] = useState(question?.details || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const problem = checkLength(title, LIMITS.question.title, "Your question") || checkLength(details, LIMITS.question.details, "The details");
    if (problem) { setError(problem); return; }
    if (!editing && !cooldownOk("question", 10000)) { setError("Please wait a few seconds before asking another question."); return; }
    setError(""); setBusy(true);
    try {
      const u = user || await ensureUser();
      const fields = { title: title.trim(), details: details.trim(), category };
      if (editing) { await updateOwned({ path: PATH, id: question.id, uid: u.uid, fields }); notify("Changes saved."); onDone(question.id); }
      else { const id = await createContent({ path: PATH, kind: "question", uid: u.uid, fields: { ...fields, answerCount: 0, edited: false } }); notify("Question posted anonymously."); onDone(id); }
    } catch (err) { console.error(err); setError("Couldn't save your question. Please try again."); setBusy(false); }
  }
  return <Dialog titleId="question-form-title" title={editing ? "Edit your question" : "Ask a question"} hint="Be specific, and keep other people's names out of it." onClose={onClose}>
    <label className="field" htmlFor="q-category">Category</label>
    <select id="q-category" value={category} onChange={(e) => setCategory(e.target.value)}>{QUESTION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
    <label className="field" htmlFor="q-title">Your question</label>
    <input id="q-title" maxLength={LIMITS.question.title[1]} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How do I…?" />
    <label className="field" htmlFor="q-details">Details <span>(optional)</span></label>
    <textarea id="q-details" rows={5} maxLength={LIMITS.question.details[1]} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Any context that would help people answer." />
    <FieldError>{error}</FieldError>
    <div className="dialog-foot"><small>{title.length}/{LIMITS.question.title[1]}</small><button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Post question"}</button></div>
  </Dialog>;
}

function QuestionDetail({ id, user, ensureUser, notify, bookmarks, toggleBookmark, navigate }) {
  const [question, setQuestion] = useState(undefined);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { isOwned } = useOwnedIds("question", user?.uid);
  useEffect(() => observeDoc(PATH, id, setQuestion, (e) => { console.error(e); setError(true); }), [id]);
  const back = <button type="button" className="back" onClick={() => navigate("/ask")}><ArrowLeft size={16} aria-hidden="true" /> All questions</button>;
  if (error) return <section className="detail">{back}<div className="empty" role="alert"><h3>Couldn't load this question</h3><p>Please try again in a moment.</p></div></section>;
  if (question === undefined) return <section className="detail">{back}<div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton" /></div></section>;
  if (question === null) return <section className="detail">{back}<div className="empty"><h3>Question not found</h3><p>It may have been deleted by whoever asked it.</p></div></section>;
  async function remove() {
    setBusy(true);
    try { const u = user || await ensureUser(); await deleteContent({ path: PATH, id, uid: u.uid }); notify("Question deleted."); navigate("/ask"); }
    catch (err) { console.error(err); notify("Couldn't delete this question."); setBusy(false); setConfirming(false); }
  }
  async function copyLink() { try { await navigator.clipboard.writeText(`${window.location.origin}/ask/${id}`); notify("Link copied."); } catch { notify("Couldn't copy the link."); } }
  return <section className="detail">
    {back}
    <article className="post" style={{ borderBottom: 0 }}>
      <Meta item={question} extra={question.category} />
      <h1 className="title">{question.title}</h1>
      {question.details && <p className="letter-body" style={{ fontSize: "1.125rem" }}>{question.details}</p>}
      <div className="post-foot"><span className="count-line">{question.answerCount || 0} {question.answerCount === 1 ? "answer" : "answers"}</span>
        <div className="acts">
          <SaveButton saved={bookmarks.includes(key(id))} onClick={() => toggleBookmark(key(id))} />
          <button type="button" className="act" onClick={copyLink}><Copy size={16} aria-hidden="true" />Copy link</button>
          {isOwned(id) && <><button type="button" className="act" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden="true" />Edit</button>
            <button type="button" className="act danger" onClick={() => setConfirming(true)}><Trash2 size={16} aria-hidden="true" />Delete</button></>}
        </div>
      </div>
    </article>
    <Answers questionId={id} user={user} ensureUser={ensureUser} notify={notify} />
    {editing && <QuestionForm question={question} user={user} ensureUser={ensureUser} notify={notify} onClose={() => setEditing(false)} onDone={() => setEditing(false)} />}
    {confirming && <ConfirmDialog title="Delete this question?" message="The question disappears for everyone, and its answers can no longer be reached." busy={busy} onConfirm={remove} onCancel={() => setConfirming(false)} />}
  </section>;
}

function Answers({ questionId, user, ensureUser, notify }) {
  const path = useMemo(() => ["questions", questionId, "answers"], [questionId]);
  const feed = useFeed({ path, scope: "all" });
  const { isOwned } = useOwnedIds("answer", user?.uid);
  const ids = useMemo(() => feed.items.map((a) => a.id), [feed.items]);
  const { mine, react } = useReactionState({ basePath: path, ids, user, ensureUser, notify, patchLocal: feed.patchLocal });
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openReplies, setOpenReplies] = useState({});
  const [toDelete, setToDelete] = useState(null);
  const bump = { path: ["questions", questionId], field: "answerCount" };
  async function submit(e) {
    e.preventDefault();
    const problem = checkLength(text, LIMITS.answer.text, "Your answer");
    if (problem) { setError(problem); return; }
    if (!cooldownOk(`answer:${questionId}`, 5000)) { setError("Please wait a few seconds before answering again."); return; }
    setError(""); setBusy(true);
    try {
      const u = user || await ensureUser();
      await createContent({ path, kind: "answer", uid: u.uid, fields: { text: text.trim(), reactions: zeroReactions(), comments: 0 }, bumpParent: bump });
      setText(""); notify("Answer posted anonymously.");
    } catch (err) { console.error(err); setError("Couldn't post your answer. Please try again."); }
    finally { setBusy(false); }
  }
  async function removeAnswer() {
    setBusy(true);
    try { const u = user || await ensureUser(); await deleteContent({ path, id: toDelete, uid: u.uid, bumpParent: bump }); feed.removeLocal(toDelete); notify("Answer deleted."); }
    catch (err) { console.error(err); notify("Couldn't delete this answer."); }
    finally { setBusy(false); setToDelete(null); }
  }
  return <section className="answers" aria-labelledby="answers-title">
    <h2 id="answers-title">Answers</h2>
    <form className="answer-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="answer-text">Your answer</label>
      <textarea id="answer-text" maxLength={LIMITS.answer.text[1]} value={text} onChange={(e) => setText(e.target.value)} placeholder="Share what helped you, or what you wish someone had told you." />
      <FieldError>{error}</FieldError>
      <div className="comment-foot"><small>{text.length}/{LIMITS.answer.text[1]}</small><button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? "Posting…" : "Post answer"}</button></div>
    </form>
    <FeedStatus status={feed.status} count={feed.items.length} onRetry={feed.retry} empty={<><h3>No answers yet</h3><p>Be the first to help.</p></>} />
    {feed.items.map((a) => <article key={a.id} className="post">
      <Meta item={a} />
      <p className="post-text" style={{ marginTop: "var(--s2)" }}>{a.text}</p>
      <div className="post-foot">
        <ReactionBar id={a.id} reactions={a.reactions} mine={mine[a.id]} onReact={react} />
        <div className="acts">
          <CommentToggle count={a.comments} open={Boolean(openReplies[a.id])} onClick={() => setOpenReplies((o) => ({ ...o, [a.id]: !o[a.id] }))} />
          {isOwned(a.id) && <button type="button" className="act danger" onClick={() => setToDelete(a.id)}><Trash2 size={16} aria-hidden="true" />Delete</button>}
        </div>
      </div>
      {openReplies[a.id] && <Thread parentPath={[...path, a.id]} user={user} ensureUser={ensureUser} />}
    </article>)}
    <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onClick={feed.loadMore} />
    {toDelete && <ConfirmDialog title="Delete your answer?" message="This removes your answer and its replies from view." busy={busy} onConfirm={removeAnswer} onCancel={() => setToDelete(null)} />}
  </section>;
}
