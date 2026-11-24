import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, ArrowLeft } from "lucide-react";
import { useFeed } from "../../hooks/useFeed";
import { where } from "../../services/content/content";
import { getToday, fetchPrompt, fetchPastPrompts, getMyResponseId, submitDailyResponse, deleteDailyResponse, countResponses, isDateId } from "../../services/content/daily";
import { LIMITS, checkLength } from "../../services/content/limits";
import { formatDateUTC } from "../../lib/format";
import { ConfirmDialog, NeedsFirebase, FeedStatus, LoadMore, FieldError, Meta, ReactionBar, CommentToggle, cooldownOk } from "../shared/ui";
import { useReactionState, Thread } from "../shared/interactions";

const PATH = ["dailyResponses"];

export default function DailyPage({ id, configured, user, ensureUser, notify, navigate }) {
  if (!configured) return <NeedsFirebase name="Daily questions" />;
  return <DailyView key={id || "today"} dateId={id} user={user} ensureUser={ensureUser} notify={notify} navigate={navigate} />;
}

function DailyView({ dateId, user: sessionUser, ensureUser, notify, navigate }) {
  const [state, setState] = useState({ status: "loading" });
  const [uid, setUid] = useState(null);
  const [myResponse, setMyResponse] = useState(undefined); // undefined = unknown, null = none
  const [count, setCount] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [openThreads, setOpenThreads] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await ensureUser();
        const today = await getToday(user.uid);
        let prompt = today.prompt;
        if (dateId) prompt = isDateId(dateId) && dateId <= today.todayId ? await fetchPrompt(dateId) : null;
        if (cancelled) return;
        setUid(user.uid);
        if (!prompt) { setState({ status: "none", todayId: today.todayId }); return; }
        setState({ status: "ready", prompt, todayId: today.todayId, isToday: prompt.id === today.prompt?.id });
        const [mine, total] = await Promise.all([getMyResponseId(prompt.id, user.uid), countResponses(prompt.id)]);
        if (!cancelled) { setMyResponse(mine); setCount(total); }
      } catch (e) { console.error(e); if (!cancelled) setState({ status: "error" }); }
    })();
    return () => { cancelled = true; };
  }, [dateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const promptId = state.prompt?.id;
  const constraints = useMemo(() => (promptId ? [where("promptId", "==", promptId)] : []), [promptId]);
  const feed = useFeed({ path: PATH, kind: "daily", scope: "all", constraints, constraintsKey: promptId || "", enabled: Boolean(promptId) });
  const ids = useMemo(() => feed.items.map((r) => r.id), [feed.items]);
  const { mine, react } = useReactionState({ basePath: PATH, ids, user: sessionUser || (uid ? { uid } : null), ensureUser, notify, patchLocal: feed.patchLocal });
  const refreshCount = useCallback(() => countResponses(promptId).then(setCount).catch(() => {}), [promptId]);

  async function submit(e) {
    e.preventDefault();
    const problem = checkLength(text, LIMITS.daily.text, "Your response");
    if (problem) { setError(problem); return; }
    if (!cooldownOk("daily", 5000)) { setError("Please wait a moment."); return; }
    setError(""); setBusy(true);
    try {
      const rid = await submitDailyResponse({ promptId, uid, text: text.trim() });
      setMyResponse(rid); setText(""); notify("Response shared anonymously."); refreshCount();
    } catch (err) { console.error(err); setError(/already answered/.test(err.message) ? err.message : "Couldn't share your response. Please try again."); }
    finally { setBusy(false); }
  }
  async function removeMine() {
    setBusy(true);
    try { await deleteDailyResponse({ promptId, uid, responseId: myResponse }); feed.removeLocal(myResponse); setMyResponse(null); notify("Response deleted."); refreshCount(); }
    catch (err) { console.error(err); notify("Couldn't delete your response."); }
    finally { setBusy(false); setConfirming(false); }
  }

  if (state.status === "loading") return <div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton" /></div>;
  if (state.status === "error") return <div className="empty" role="alert"><h3>Couldn't load the daily question</h3><p>Check your connection and try again.</p><button type="button" className="btn" onClick={() => navigate(dateId ? `/daily/${dateId}` : "/daily")}>Try again</button></div>;
  if (state.status === "none") return <>
    <section className="page-head"><h1>{dateId ? "Question not found." : "No question yet."}</h1><p>{dateId ? "That day doesn't have a question." : "Today's question hasn't been published. Check back soon."}</p>
      {dateId && <div className="page-actions"><button type="button" className="btn" onClick={() => navigate("/daily")}>Go to today's question</button></div>}</section>
    <Past beforeDate={state.todayId} navigate={navigate} />
  </>;

  return <>
    <section className="page-head">
      {!state.isToday && <button type="button" className="back" onClick={() => navigate("/daily")}><ArrowLeft size={16} aria-hidden="true" /> Today's question</button>}
      <h1>{state.isToday ? "Today's question." : "A past question."}</h1>
      <p>{formatDateUTC(state.prompt.date)}</p>
    </section>
    <section className="question" aria-labelledby="daily-prompt">
      <small>{count === null ? "Community responses" : `${count} ${count === 1 ? "response" : "responses"}`}</small>
      <h2 id="daily-prompt">{state.prompt.text}</h2>
    </section>
    {myResponse === undefined ? null : myResponse
      ? <div className="notice"><p>You've answered this question. One response per question keeps the conversation honest.</p><div className="page-actions"><button type="button" className="btn danger" onClick={() => setConfirming(true)}><Trash2 size={16} aria-hidden="true" /> Delete my response</button></div></div>
      : <form className="answer-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="daily-text">Your response</label>
          <textarea id="daily-text" maxLength={LIMITS.daily.text[1]} value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer honestly. No one will know it's you." />
          <FieldError>{error}</FieldError>
          <div className="comment-foot"><small>{text.length}/{LIMITS.daily.text[1]}</small><button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? "Sharing…" : "Share anonymously"}</button></div>
        </form>}
    <section className="answers" aria-labelledby="responses-title">
      <h2 id="responses-title">Responses</h2>
      <FeedStatus status={feed.status} count={feed.items.length} onRetry={feed.retry} empty={<><h3>No responses yet</h3><p>Be the first to answer.</p></>} />
      {feed.items.map((r) => <article key={r.id} className="post">
        <Meta item={r} />
        <p className="post-text" style={{ marginTop: "var(--s2)" }}>{r.text}</p>
        <div className="post-foot">
          <ReactionBar id={r.id} reactions={r.reactions} mine={mine[r.id]} onReact={react} />
          <div className="acts"><CommentToggle count={r.comments} open={Boolean(openThreads[r.id])} onClick={() => setOpenThreads((o) => ({ ...o, [r.id]: !o[r.id] }))} /></div>
        </div>
        {openThreads[r.id] && <Thread parentPath={[...PATH, r.id]} user={sessionUser} ensureUser={ensureUser} />}
      </article>)}
      <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onClick={feed.loadMore} />
    </section>
    <Past beforeDate={state.prompt.date} navigate={navigate} />
    {confirming && <ConfirmDialog title="Delete your response?" message="It will be removed for everyone, and you'll be able to answer again." busy={busy} onConfirm={removeMine} onCancel={() => setConfirming(false)} />}
  </>;
}

function Past({ beforeDate, navigate }) {
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async (before, append) => {
    try { const r = await fetchPastPrompts(before); setItems((prev) => (append ? [...prev, ...r.items] : r.items)); setHasMore(r.hasMore); setStatus("ready"); }
    catch (e) { console.error(e); setStatus("error"); }
  }, []);
  useEffect(() => { setStatus("loading"); load(beforeDate, false); }, [beforeDate, load]);
  return <section className="answers" aria-labelledby="past-title">
    <h2 id="past-title">Previous questions</h2>
    {status === "error" && <p className="field-error" role="alert">Couldn't load previous questions.</p>}
    {status === "ready" && !items.length && <p className="count-line">No earlier questions yet.</p>}
    <ul className="past-list">{items.map((p) => <li key={p.id}><button type="button" onClick={() => navigate(`/daily/${p.id}`)}><small>{p.date}</small><span>{p.text}</span></button></li>)}</ul>
    <LoadMore hasMore={hasMore} loading={loadingMore} onClick={async () => { setLoadingMore(true); await load(items[items.length - 1].date, true); setLoadingMore(false); }} />
  </section>;
}
