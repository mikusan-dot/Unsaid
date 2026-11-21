import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Compass, MessageCircle, MoonStar, Mail, Heart, Search, Sun, Menu, X, Bookmark, Flag,
  PenLine, LockKeyhole, Check, ArrowLeft, Copy, Pencil, Trash2,
} from "lucide-react";
import "./styles.css";
import { auth, firebaseConfigured, ensureAnonymousSession } from "./services/firebase/client";
import { onAuthStateChanged } from "firebase/auth";
import {
  subscribeToPosts, createPost, editPost, removePost, getPostById,
} from "./services/posts/firestorePosts";
import {
  subscribeToComments, addComment, deleteComment,
} from "./services/firestoreComments";
import {
  setReaction, removeReaction, subscribeToReactions,
} from "./services/firestoreReactions";
import {
  addBookmark, removeBookmark, subscribeToBookmarks,
} from "./services/firestoreBookmarks";
import CommentSection from "./components/CommentSection";

const STORAGE_KEY = "unsaid-phase2-posts";
const SAVED_KEY = "unsaid-phase2-saved";
const THEME_KEY = "unsaid-theme";
const categories = ["All", "Thoughts", "Confessions", "Relationships", "Friendship", "Loneliness", "University Life", "Mental Wellbeing", "Society", "Unpopular Opinions", "Life Experiences", "Questions"];
const prompts = [
  "What's something you wish people understood about you?",
  "When do you feel most like yourself?",
  "What's a small thing that made your week better?",
  "What have you outgrown but still find hard to leave behind?"
];
const seedPosts = [
  { id: "sample-1", category: "Thoughts", time: "8 min ago", createdAt: Date.now()-480000, text: "Sometimes I have a whole conversation in my head, rehearse every possible answer, and then when the moment comes I just smile and say nothing.", tags: ["overthinking"], reactions: { understand: 28, alone: 14, feel: 9 }, comments: 6, owner: false, author: "Anonymous #0284" },
  { id: "sample-2", category: "Confessions", time: "24 min ago", createdAt: Date.now()-1440000, text: "I miss the version of me who used to get excited about little things. I hope I find that person again.", tags: ["personal"], reactions: { understand: 42, alone: 31, feel: 18 }, comments: 12, owner: false, author: "Anonymous #1042" },
  { id: "sample-3", category: "University Life", time: "1 hr ago", createdAt: Date.now()-3600000, text: "Does anyone else feel surrounded by people at university but still somehow feel like they haven't found their people?", tags: ["campus"], reactions: { understand: 19, alone: 11, feel: 7 }, comments: 8, owner: false, author: "Anonymous #0619" },
  { id: "sample-4", category: "Unpopular Opinions", time: "2 hrs ago", createdAt: Date.now()-7200000, text: "Being quiet doesn't mean someone has nothing to contribute. Sometimes they're just waiting for a conversation worth joining.", tags: ["perspective"], reactions: { understand: 63, alone: 8, feel: 22 }, comments: 17, owner: false, author: "Anonymous #3391" },
];

function readJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
}
function makeAnonymousId() { return `Anonymous #${String(Math.floor(1000 + Math.random()*9000))}`; }
function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now()-timestamp)/60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
function totalReactions(post) { return Object.values(post.reactions || {}).reduce((a,b)=>a+b,0); }
const USER_ERRORS = new Set(["You can only edit your own thought.", "You can only delete your own thought.", "Your anonymous session is not ready."]);
function friendlyError(error, fallback) { return USER_ERRORS.has(error?.message) ? error.message : fallback; }
const PUBLISH_COOLDOWN_MS = 8000;

function App() {
  const [posts, setPosts] = useState(() => readJSON(STORAGE_KEY, seedPosts));
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudStatus, setCloudStatus] = useState(firebaseConfigured ? "connecting" : "demo");
  const [saved, setSaved] = useState(() => readJSON(SAVED_KEY, []));
  const [cloudBookmarks, setCloudBookmarks] = useState([]);
  const [userReactions, setUserReactions] = useState({}); // postId -> type | null
  const [comments, setComments] = useState({}); // postId -> comment[]
  const [cloudReactions, setCloudReactions] = useState({}); // postId -> {uid: type}
  const [detailPost, setDetailPost] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [active, setActive] = useState("Explore");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("Latest");
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState("Thoughts");
  const [draftTags, setDraftTags] = useState("");
  const [toast, setToast] = useState("");
  const [light, setLight] = useState(() => {
    try { const t = localStorage.getItem(THEME_KEY); if (t) return t === "light"; } catch {}
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const toastTimer = useRef(null);
  const lastPublish = useRef(0);
  const composerOpener = useRef(null);
  const commentUnsubRef = useRef(null);
  const reactionUnsubRef = useRef(null);
  const [dailyIndex] = useState(() => new Date().getDate() % prompts.length);

  const effectiveSaved = firebaseConfigured ? cloudBookmarks : saved;

  useEffect(() => {
    if (!firebaseConfigured) return;
    return onAuthStateChanged(auth, (user) => setCloudUser(user));
  }, []);
  useEffect(() => {
    if (!firebaseConfigured) localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  }, [posts]);
  useEffect(() => {
    if (!firebaseConfigured) return;
    setCloudStatus("connecting");
    return subscribeToPosts(cloudUser?.uid ?? null, (remotePosts) => {
      setPosts(remotePosts); setCloudStatus("connected");
    }, (error) => {
      console.error("unsaid Firestore feed error:", error); setCloudStatus("error");
    });
  }, [cloudUser?.uid]);
  // Subscribe to the current user's bookmarks (Firebase only)
  useEffect(() => {
    if (!firebaseConfigured || !cloudUser) {
      setCloudBookmarks([]);
      return;
    }
    return subscribeToBookmarks(cloudUser.uid, (bookmarks) => {
      setCloudBookmarks(bookmarks);
    });
  }, [cloudUser?.uid, firebaseConfigured]);
  // When the selected post changes: load the post if needed, subscribe to comments & reactions
  useEffect(() => {
    if (commentUnsubRef.current) { commentUnsubRef.current(); commentUnsubRef.current = null; }
    if (reactionUnsubRef.current) { reactionUnsubRef.current(); reactionUnsubRef.current = null; }

    if (!selectedPost) {
      setDetailPost(null);
      setCloudReactions(prev => { const next = { ...prev }; delete next[selectedPost]; return next; });
      return;
    }

    const found = posts.find(p => String(p.id) === String(selectedPost));
    if (found) {
      setDetailPost(found);
    } else {
      setDetailLoading(true);
      getPostById(selectedPost).then((post) => {
        setDetailPost(post);
        setDetailLoading(false);
      }).catch((err) => {
        console.error("unsaid detail load error:", err);
        setDetailLoading(false);
      });
    }

    if (firebaseConfigured && cloudUser) {
      commentUnsubRef.current = subscribeToComments(selectedPost, (fresh) => {
        setComments(prev => ({ ...prev, [selectedPost]: fresh }));
      });
      reactionUnsubRef.current = subscribeToReactions(selectedPost, (reactions) => {
        setCloudReactions(prev => ({ ...prev, [selectedPost]: reactions }));
      });
    }
  }, [selectedPost, posts, cloudUser, firebaseConfigured]);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, light ? "light" : "dark"); } catch {}
  }, [light]);
  useEffect(() => { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }, [saved]);
  useEffect(() => {
    const sync = () => {
      const match = window.location.pathname.match(/^\/post\/([^/]+)\/?$/);
      setSelectedPost(match ? decodeURIComponent(match[1]) : null);
    };
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function notify(message) { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(()=>setToast(""), 2600); }
  function goHome(section="Explore") {
    window.history.pushState({}, "", "/");
    setSelectedPost(null); setActive(section); setMobileNav(false); window.scrollTo({top:0,behavior:"smooth"});
  }
  function openPost(id) {
    window.history.pushState({}, "", `/post/${encodeURIComponent(id)}`);
    setSelectedPost(id); window.scrollTo({top:0,behavior:"smooth"});
  }
  const currentPost = selectedPost ? (detailPost || posts.find(p=>String(p.id)===String(selectedPost))) : null;

  const visiblePosts = useMemo(() => {
    let result = posts.filter(p => (category==="All" || p.category===category) &&
      `${p.text} ${(p.tags||[]).join(" ")} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
    if (active==="Confessions") result = result.filter(p=>p.category==="Confessions");
    if (active==="Discussions") result = result.filter(p=>["Questions","Unpopular Opinions","Society"].includes(p.category));
    if (active==="Saved thoughts") result = result.filter(p=>effectiveSaved.includes(p.id));
    if (sort==="Most discussed") result = [...result].sort((a,b)=>(b.comments||0)-(a.comments||0));
    if (sort==="Trending") result = [...result].sort((a,b)=>totalReactions(b)-totalReactions(a));
    if (sort==="Latest") result = [...result].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return result;
  }, [posts, category, query, sort, active, effectiveSaved]);

  function openComposer(post=null) {
    composerOpener.current = document.activeElement;
    setEditingId(post?.id ?? null);
    setDraft(post?.text ?? "");
    setDraftCategory(post?.category ?? "Thoughts");
    setDraftTags((post?.tags ?? []).join(", "));
    setComposer(true);
  }
  function closeComposer() {
    setComposer(false); setEditingId(null);
    window.setTimeout(()=>composerOpener.current?.focus?.(), 0);
  }
  async function publish() {
    const clean = draft.trim();
    if (clean.length < 12) { notify("Add a little more context before publishing."); return; }
    if (clean.length > 1200) { notify("Please keep your thought under 1,200 characters."); return; }
    if (!editingId && Date.now() - lastPublish.current < PUBLISH_COOLDOWN_MS) { notify("Please wait a few seconds before sharing another thought."); return; }
    const tags = [...new Set(draftTags.split(",").map(t=>t.trim().replace(/^#/,"").toLowerCase()).filter(Boolean))].slice(0,5);
    try {
      if (firebaseConfigured) {
        const user = cloudUser || await ensureAnonymousSession();
        if (!cloudUser) setCloudUser(user);
        if (editingId) await editPost({ id: editingId, uid: user.uid, text: clean, category: draftCategory, tags });
        else await createPost({ uid: user.uid, text: clean, category: draftCategory, tags, authorLabel: makeAnonymousId() });
      } else if (editingId) {
        setPosts(old=>old.map(p=>p.id===editingId ? {...p,text:clean,category:draftCategory,tags,edited:true} : p));
      } else {
        const createdAt = Date.now();
        const item = { id: `post-${createdAt}-${Math.random().toString(36).slice(2,7)}`, category:draftCategory, time:"just now", createdAt, text:clean, tags, reactions:{understand:0,alone:0,feel:0}, comments:0, owner:true, author:makeAnonymousId() };
        setPosts(old=>[item,...old]); setCategory("All"); setActive("Explore");
      }
      if (!editingId) lastPublish.current = Date.now();
      notify(editingId ? "Changes saved." : "Shared anonymously.");
      setComposer(false); setEditingId(null); setDraft(""); setDraftTags("");
      window.setTimeout(()=>composerOpener.current?.focus?.(), 0);
    } catch (error) { console.error(error); notify(friendlyError(error, "Couldn't publish your thought. Please try again.")); }
  }

  // Persistent reaction: one per user per post. Clicking the same type removes it.
  async function handleReact(postId, type) {
    if (firebaseConfigured) {
      if (!cloudUser) { notify("Your anonymous session isn't ready."); return; }
      try {
        const current = userReactions[postId];
        if (current === type) {
          await removeReaction({ postId, uid: cloudUser.uid });
          setUserReactions(old => ({ ...old, [postId]: null }));
        } else {
          await setReaction({ postId, uid: cloudUser.uid, type });
          setUserReactions(old => ({ ...old, [postId]: type }));
        }
      } catch (error) {
        console.error(error);
        notify(error.message || "Couldn't save your reaction.");
      }
    } else {
      const current = userReactions[postId];
      if (current === type) {
        setUserReactions(old => ({ ...old, [postId]: null }));
        setPosts(old => old.map(p => p.id === postId ? {
          ...p,
          reactions: { ...p.reactions, [type]: Math.max(0, (p.reactions?.[type] || 0) - 1) }
        } : p));
      } else {
        if (current) {
          setPosts(old => old.map(p => p.id === postId ? {
            ...p,
            reactions: { ...p.reactions, [current]: Math.max(0, (p.reactions?.[current] || 0) - 1) }
          } : p));
        }
        setUserReactions(old => ({ ...old, [postId]: type }));
        setPosts(old => old.map(p => p.id === postId ? {
          ...p,
          reactions: { ...p.reactions, [type]: (p.reactions?.[type] || 0) + 1 }
        } : p));
      }
    }
  }

  async function handleToggleSave(postId) {
    if (firebaseConfigured) {
      if (!cloudUser) { notify("Your anonymous session isn't ready."); return; }
      try {
        const isSaved = cloudBookmarks.includes(postId);
        if (isSaved) {
          await removeBookmark({ uid: cloudUser.uid, postId });
          notify("Removed from saved.");
        } else {
          await addBookmark({ uid: cloudUser.uid, postId });
          notify("Saved.");
        }
      } catch (error) {
        console.error(error);
        notify(error.message || "Couldn't update your bookmark.");
      }
    } else {
      const wasSaved = saved.includes(postId);
      setSaved(old => old.includes(postId) ? old.filter(x => x !== postId) : [...old, postId]);
      notify(wasSaved ? "Removed from saved." : "Saved on this device.");
    }
  }

  async function handleAddComment(postId, text, parentId = null) {
    if (!cloudUser) { notify("Your anonymous session isn't ready."); return; }
    try {
      await addComment({
        postId,
        uid: cloudUser.uid,
        authorLabel: makeAnonymousId(),
        text,
        parentId,
      });
    } catch (error) {
      console.error(error);
      notify(error.message || "Couldn't post your reply.");
    }
  }

  async function handleDeleteComment(postId, commentId) {
    if (!cloudUser) { notify("Your anonymous session isn't ready."); return; }
    try {
      await deleteComment({ postId, commentId, uid: cloudUser.uid });
    } catch (error) {
      console.error(error);
      notify(error.message || "Couldn't delete the reply.");
    }
  }

  async function deletePost(id) {
    if (!window.confirm("Delete this thought? This cannot be undone.")) return;
    try {
      if (firebaseConfigured) {
        if (!cloudUser) throw new Error("Your anonymous session isn't ready.");
        await removePost({ id, uid: cloudUser.uid });
      } else { setPosts(old=>old.filter(p=>p.id!==id)); }
      setSaved(old=>old.filter(x=>x!==id));
      if(selectedPost) goHome("Explore");
      notify("Deleted.");
    } catch (error) { console.error(error); notify(friendlyError(error, "Couldn't delete this thought.")); }
  }

  async function sharePost(id) {
    const url = `${window.location.origin}/post/${encodeURIComponent(id)}`;
    try { await navigator.clipboard.writeText(url); notify("Link copied."); }
    catch { notify(url); }
  }
  function reportPost() { notify("Thank you. Reporting will be connected to moderation in a later phase."); }

  const navItems = [
    { name: "Explore", icon: Compass }, { name: "Confessions", icon: Heart },
    { name: "Discussions", icon: MessageCircle }, { name: "Letters", icon: Mail }, { name: "Midnight", icon: MoonStar },
  ];
  const heads = {
    Explore: ["Say what you haven't said.", "Anonymous thoughts from people who don't need to be known."],
    Confessions: ["Confessions.", "Things people have carried quietly."],
    Discussions: ["Discussions.", "Questions and opinions worth talking through."],
    "Saved thoughts": ["Saved thoughts.", "Kept on this device only."],
    About: ["About unsaid.", "A place for thoughtful anonymous writing. Currently a prototype."],
    Letters: ["Letters never sent.", "Write the words you never got to say."],
    Midnight: ["After dark.", "A quiet place for thoughts that arrive late."],
  };
  const [pageTitle, pageSub] = heads[active] ?? heads.Explore;
  const comingSoon = active === "Letters" || active === "Midnight";
  const statusText = cloudStatus === "connected" ? "Shared community" : cloudStatus === "connecting" ? "Connecting…" : cloudStatus === "error" ? "Connection issue" : "Local preview";

  const REACTIONS = [{ type: "understand", label: "I understand" }, { type: "alone", label: "Not alone" }, { type: "feel", label: "Feel this" }];

  function Reactions({ post, reacted, onReact }) {
    return <div className="reactions" role="group" aria-label="Reactions">
      {REACTIONS.map(r => { const on = reacted === r.type; return <button type="button" key={r.type} className="react" aria-pressed={on} onClick={() => onReact(post.id, r.type)}>{r.label} <span className="count">{post.reactions?.[r.type] || 0}</span></button>; })}
    </div>;
  }

  function PostMeta({ post }) {
    return <div className="post-meta"><strong>{post.author || "Someone, somewhere"}</strong> · {relativeTime(post.createdAt || Date.now())}{post.edited ? " · edited" : ""} · {post.category}</div>;
  }

  function OwnerActions({ post, onEdit, onDelete, onReport }) {
    return <div className="acts">
      {post.owner && <>
        <button type="button" className="icon-btn compact" title="Edit" aria-label="Edit your thought" onClick={onEdit}><Pencil size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-btn compact" title="Delete" aria-label="Delete your thought" onClick={onDelete}><Trash2 size={16} aria-hidden="true" /></button>
      </>}
      <button type="button" className="icon-btn compact" title="Report" aria-label="Report this thought" onClick={onReport}><Flag size={16} aria-hidden="true" /></button>
    </div>;
  }

  function PostCard({ post, reacted, isSaved, onReact, onSave, onOpen, onReport, onEdit, onDelete }) {
    return <article className="post">
      <div className="post-top"><PostMeta post={post} /><OwnerActions post={post} onEdit={onEdit} onDelete={onDelete} onReport={onReport} /></div>
      <button type="button" className="post-open" onClick={onOpen} aria-label="Open thought"><span className="post-text">{post.text}</span></button>
      {!!post.tags?.length && <div className="post-tags">{post.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
      <div className="post-foot">
        <Reactions post={post} reacted={reacted} onReact={onReact} />
        <div className="acts">
          <button type="button" className="act" onClick={onOpen} aria-label={`Open thought, ${post.comments || 0} responses`}><MessageCircle size={16} aria-hidden="true" /><span className="count">{post.comments || 0}</span></button>
          <button type="button" className="act" aria-pressed={isSaved} onClick={onSave}><Bookmark size={16} aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />{isSaved ? "Saved" : "Save"}</button>
        </div>
      </div>
    </article>;
  }

  function PostDetail({ post, detailLoading, onBack, onReact, userReaction, reactions, isSaved, onSave, onShare, onReport, onEdit, onDelete, comments, onAddComment, onDeleteComment, authorLabel, currentUid }) {
    return <section className="detail">
      {detailLoading && <p className="muted">Loading thought…</p>}
      {!detailLoading && (
      <>
        <button type="button" className="back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back to the feed</button>
        <h1 className="sr-only">Anonymous thought</h1>
        <article className="post" style={{ borderBottom: 0 }}>
          <div className="post-top"><PostMeta post={post} /><OwnerActions post={post} onEdit={onEdit} onDelete={onDelete} onReport={onReport} /></div>
          <p className="post-text">{post.text}</p>
          {!!post.tags?.length && <div className="post-tags">{post.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
          <div className="post-foot">
            <Reactions post={{ ...post, reactions }} reacted={userReaction} onReact={onReact} />
            <div className="acts">
              <button type="button" className="act" aria-pressed={isSaved} onClick={onSave}><Bookmark size={16} aria-hidden="true" fill={isSaved ? "currentColor" : "none"} />{isSaved ? "Saved" : "Save"}</button>
              <button type="button" className="act" onClick={() => onShare(post.id)}><Copy size={16} aria-hidden="true" />Copy link</button>
            </div>
          </div>
        </article>
        {!post.owner && (
          <CommentSection
            postId={post.id}
            authorLabel={authorLabel}
            uid={currentUid}
            initialComments={comments}
          />
        )}
      </>
      )}
    </section>;
  }

  function Composer({ editing, draft, setDraft, category, setCategory, tags, setTags, onClose, onPublish }) {
    const dialogRef = useRef(null);
    useEffect(() => {
      const dialog = dialogRef.current;
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
      return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);
    const tooShort = draft.trim().length < 12;
    return <div className="backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="dialog-head">
          <div><h2 id="composer-title">{editing ? "Edit your thought" : "Write something"}</h2><p className="dialog-hint">No name, no profile. Write what feels true.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <label className="field" htmlFor="post-category">Space</label>
        <select id="post-category" value={category} onChange={e => setCategory(e.target.value)}>{categories.filter(c => c !== "All").map(c => <option key={c}>{c}</option>)}</select>
        <label className="field" htmlFor="thought">Your thought</label>
        <textarea id="thought" autoFocus maxLength={1200} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Start anywhere. It doesn't have to be polished." rows={6} aria-describedby="thought-help" />
        <label className="field" htmlFor="post-tags">Tags <span>(optional, comma separated, up to 5)</span></label>
        <input id="post-tags" maxLength={100} value={tags} onChange={e => setTags(e.target.value)} placeholder="overthinking, friendship" />
        <div className="dialog-foot">
          <small id="thought-help">{tooShort ? "At least 12 characters. " : ""}{draft.length}/1200</small>
          <button type="button" className="btn primary" onClick={onPublish} disabled={tooShort}>{editing ? "Save changes" : "Share anonymously"}</button>
        </div>
        <p className="dialog-note">Please don't include identifying details about yourself or anyone else.</p>
      </section>
    </div>;
  }

  return <div className="app">
    <header className="topbar">
      <button type="button" className="mobile-menu icon-btn" aria-label="Toggle navigation" aria-expanded={mobileNav} aria-controls="side-nav" onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={20} /> : <Menu size={20} />}</button>
      <a className="brand" href="/" aria-label="unsaid, home" onClick={e => { e.preventDefault(); goHome(); }}>unsaid<b>.</b></a>
      <div className="top-actions">
        <button type="button" className="icon-btn" aria-label="Light theme" aria-pressed={light} onClick={() => setLight(!light)}>{light ? <MoonStar size={18} /> : <Sun size={18} />}</button>
        <button type="button" className="btn primary" aria-label="Write anonymously" onClick={() => openComposer()}><PenLine size={16} aria-hidden="true" /><span className="write-label" aria-hidden="true">Write anonymously</span></button>
      </div>
    </header>

    <div className="layout">
      <nav id="side-nav" aria-label="Sections" className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="side-label">Spaces</div>
        {navItems.map(n => { const Icon = n.icon; const on = active === n.name && !selectedPost; return <button type="button" key={n.name} className={`side-link ${on ? "active" : ""}`} aria-current={on ? "page" : undefined} onClick={() => goHome(n.name)}><Icon size={18} aria-hidden="true" />{n.name}</button>; })}
        <div className="side-label">Yours</div>
        <button type="button" className={`side-link ${active === "Saved thoughts" && !selectedPost ? "active" : ""}`} aria-current={active === "Saved thoughts" && !selectedPost ? "page" : undefined} onClick={() => goHome("Saved thoughts")}><Bookmark size={18} aria-hidden="true" />Saved thoughts</button>
        <button type="button" className="side-link" onClick={() => notify("Private journal is planned for a later phase.")}><LockKeyhole size={18} aria-hidden="true" />Private journal</button>
        <p className="side-note">{firebaseConfigured ? "No names, no profiles. Posts are tied to a random anonymous session." : "Local preview: posts stay in this browser and are not shared."}</p>
      </nav>

      <main className="main">
        <div className="column">
          {selectedPost && !currentPost && cloudStatus !== "connecting"
            ? <section className="detail"><button type="button" className="back" onClick={() => goHome()}><ArrowLeft size={16} aria-hidden="true" /> Back to the feed</button><div className="empty"><h1 className="sr-only">Thought not found</h1><h3>Thought not found</h3><p>It may have been deleted, or it isn't available here.</p></div></section>
            : currentPost
              ? <PostDetail post={currentPost} detailLoading={detailLoading} onBack={() => goHome()} onReact={(id,type)=>handleReact(id,type)} userReaction={cloudReactions[currentPost.id]?.[cloudUser?.uid] ?? userReactions[currentPost.id]} reactions={currentPost.reactions} isSaved={effectiveSaved.includes(currentPost.id)} onSave={()=>handleToggleSave(currentPost.id)} onShare={sharePost} onReport={reportPost} onEdit={()=>openComposer(currentPost)} onDelete={()=>deletePost(currentPost.id)} comments={comments[currentPost.id] ?? []} onAddComment={(text, parentId)=>handleAddComment(currentPost.id, text, parentId)} onDeleteComment={(commentId)=>handleDeleteComment(currentPost.id, commentId)} authorLabel={currentPost.author} currentUid={cloudUser?.uid ?? null} />
              : <>
                <section className="page-head">
                  <h1>{pageTitle}</h1>
                  <p>{pageSub}</p>
                </section>
                {comingSoon
                  ? <div className="empty"><h2 className="sr-only">Not open yet</h2><h3>Not open yet</h3><p>This space isn't ready. For now, you can read and write in Explore.</p><button type="button" className="btn" onClick={() => goHome("Explore")}>Go to Explore</button></div>
                  : <>
                    <section className="question" aria-labelledby="daily-q">
                      <small>Today's question</small>
                      <h2 id="daily-q">{prompts[dailyIndex]}</h2>
                      <button type="button" className="btn" onClick={() => openComposer()}>Answer anonymously</button>
                    </section>
                    <section id="community-feed" aria-labelledby="feed-title">
                      <div className="feed-head">
                        <h2 id="feed-title">{active === "Saved thoughts" ? "Your saved thoughts" : "Recent thoughts"}</h2>
                        <div className="feed-tools">
                          <label className="searchbox"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search thoughts" aria-label="Search thoughts" /></label>
                          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort thoughts"><option>Latest</option><option>Trending</option><option>Most discussed</option></select>
                        </div>
                      </div>
                      <div className="tabs" role="group" aria-label="Filter by space">{categories.map(c => <button type="button" key={c} className="tab" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
                      <div>
                        {visiblePosts.length
                          ? visiblePosts.map(p => <PostCard key={p.id} post={p} reacted={userReactions[p.id]} isSaved={effectiveSaved.includes(p.id)} onReact={(id,type)=>handleReact(id,type)} onSave={()=>handleToggleSave(p.id)} onOpen={()=>openPost(p.id)} onReport={reportPost} onEdit={()=>openComposer(p)} onDelete={()=>deletePost(p.id)} />)
                          : active === "Saved thoughts" && !query && category === "All"
                            ? <div className="empty"><h3>Nothing saved yet</h3><p>Select Save on a thought to keep it here.</p></div>
                            : <div className="empty"><h3>No thoughts match</h3><p>Try another search or space.</p><button type="button" className="btn" onClick={() => { setQuery(""); setCategory("All"); }}>Clear filters</button></div>}
                      </div>
                      {!!visiblePosts.length && <p className="feed-end">You're all caught up.</p>}
                    </section>
                  </>}
              </>}
        </div>
        <footer className="footer">
          <span><a className="brand" href="/" aria-label="unsaid, home" onClick={e => { e.preventDefault(); goHome(); }}>unsaid<b>.</b></a>{statusText}</span>
          <div className="footer-links">
            <button type="button" onClick={() => goHome("About")}>About</button>
            <button type="button" onClick={() => notify("Be kind. Don't share identifying details, threats, or targeted harassment.")}>Guidelines</button>
            <button type="button" onClick={() => notify(firebaseConfigured ? "Posts are stored anonymously. We don't ask for your name or email." : "This preview stores data only in your browser.")}>Privacy</button>
          </div>
        </footer>
      </main>
    </div>

    {composer && <Composer editing={Boolean(editingId)} draft={draft} setDraft={setDraft} category={draftCategory} setCategory={setDraftCategory} tags={draftTags} setTags={setDraftTags} onClose={closeComposer} onPublish={publish} />}
    <div className="toast-region" role="status" aria-live="polite">{toast && <div className="toast"><Check size={16} aria-hidden="true" />{toast}</div>}</div>
  </div>;
}

createRoot(document.getElementById("root")).render(<App/>);
