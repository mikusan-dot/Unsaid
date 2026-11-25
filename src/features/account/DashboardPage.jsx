import React from "react";
import { getCounts, fetchRecentRows, resolveRows, pathFor, KIND_LABEL } from "../../services/account/ownership";
import { excerpt, relativeTime } from "../../lib/format";
import { useLoad } from "./hooks";

const TILES = [
  { key: "posts", label: "Posts", to: "/account/posts" }, { key: "letters", label: "Letters", to: "/account/letters" },
  { key: "questions", label: "Questions", to: "/account/questions" }, { key: "answers", label: "Answers", to: "/account/answers" },
  { key: "thoughts", label: "Midnight thoughts", to: "/account/thoughts" }, { key: "saved", label: "Saved thoughts", to: "/account/saved" },
  { key: "journal", label: "Private journal", to: "/journal" },
];
export const titleOf = (item) => { const d = item.doc; if (!d) return null; return d.title || d.text || ""; };

export default function DashboardPage({ user, profile, navigate }) {
  const counts = useLoad(() => getCounts(user.uid), [user.uid]);
  const recent = useLoad(async () => resolveRows(await fetchRecentRows(user.uid, 8)), [user.uid]);
  const name = profile?.displayName?.trim();
  return <>
    <section className="page-head"><h1>{name ? `Hello, ${name}.` : "Your space."}</h1><p>Only you can see this page. What you published still appears anonymously.</p></section>
    {user.isAnonymous && <div className="notice open" role="note"><p><strong>This is an anonymous session.</strong> If you clear this browser's data you'll lose access to it for good, including your journal and saved thoughts. Adding an email or Google keeps everything and lets you return from any device.</p>
      <div className="page-actions"><button type="button" className="btn primary" onClick={() => navigate("/register")}>Secure this session</button></div></div>}
    {!user.isAnonymous && !user.emailVerified && user.email && <div className="notice open" role="note"><p><strong>Verify your email.</strong> A typo would block password resets. Open the link we sent, or resend it from <button type="button" className="linklike" onClick={() => navigate("/account/security")}>Security</button>.</p></div>}

    <h2 className="section-title">At a glance</h2>
    {counts.status === "error" ? <div className="empty" role="alert"><h3>Couldn't load your numbers</h3><p>Check your connection and try again.</p><button type="button" className="btn" onClick={counts.reload}>Try again</button></div>
      : <div className="tiles" role="list">{TILES.map((t) => <button type="button" role="listitem" key={t.key} className="tile" onClick={() => navigate(t.to)} aria-label={`${t.label}: ${counts.data ? counts.data[t.key] : "loading"}. Open`}>
          <span className="tile-n">{counts.status === "loading" && !counts.data ? "–" : counts.data?.[t.key] ?? 0}</span><span className="tile-l">{t.label}</span></button>)}</div>}

    <h2 className="section-title">Recent activity</h2>
    {recent.status === "loading" && <div className="skeletons" role="status" aria-busy="true" aria-label="Loading"><div className="skeleton" /><div className="skeleton short" /></div>}
    {recent.status === "error" && <div className="empty" role="alert"><h3>Couldn't load recent activity</h3><p>If this persists, the Firestore indexes may still be building (see the README).</p><button type="button" className="btn" onClick={recent.reload}>Try again</button></div>}
    {recent.status === "ready" && !recent.data.length && <div className="empty"><h3>Nothing yet</h3><p>Everything you publish appears here, only to you.</p><button type="button" className="btn primary" onClick={() => navigate("/")}>Write something</button></div>}
    {recent.status === "ready" && recent.data.map((it) => { const t = titleOf(it); const to = pathFor(it);
      return <article key={it.id} className="post"><div className="post-meta"><strong>{KIND_LABEL[it.kind]}</strong> · {relativeTime(it.at || Date.now())}</div>
        {t ? <button type="button" className="post-open" onClick={() => to && navigate(to)} disabled={!to}><span className="excerpt">{excerpt(t, 180)}</span></button> : <p className="excerpt muted-copy">No longer available.</p>}</article>; })}
  </>;
}
