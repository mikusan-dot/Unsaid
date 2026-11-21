import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Feather, Compass, MessageCircle, MoonStar, Mail, Heart, Sparkles, Search,
  Sun, Menu, X, Bookmark, Flag, ArrowUpRight, ShieldCheck, Send, PenLine,
  LockKeyhole, Check, Hash, ArrowLeft, Copy, Pencil, Trash2, Clock3
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
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes/60);
  if (hours < 24) return `${hours} hr${hours===1?"":"s"} ago`;
  const days = Math.floor(hours/24);
  return `${days} day${days===1?"":"s"} ago`;
}
function totalReactions(post) { return Object.values(post.reactions || {}).reduce((a,b)=>a+b,0); }

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
  const [light, setLight] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [dailyIndex] = useState(() => new Date().getDate() % prompts.length);

  const toastTimer = useRef(null);
  const commentUnsubRef = useRef(null);
  const reactionUnsubRef = useRef(null);

  const effectiveSaved = firebaseConfigured ? cloudBookmarks : saved;

  useEffect(() => {
    if (!firebaseConfigured) { localStorage.setItem(STORAGE_KEY, JSON.stringify(posts)); return; }
    return onAuthStateChanged(auth, (user) => setCloudUser(user));
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    setCloudStatus("connecting");
    return subscribeToPosts(cloudUser?.uid ?? null, (remotePosts) => {
      setPosts(remotePosts); setCloudStatus("connected");
    }, (error) => {
      console.error("UNSAID Firestore feed error:", error); setCloudStatus("error");
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
        console.error("UNSAID detail load error:", err);
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

  const currentPost = selectedPost ? (detailPost || posts.find(p => String(p.id) === String(selectedPost))) : null;

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
    setEditingId(post?.id ?? null);
    setDraft(post?.text ?? "");
    setDraftCategory(post?.category ?? "Thoughts");
    setDraftTags((post?.tags ?? []).join(", "));
    setComposer(true);
  }

  async function publish() {
    const clean = draft.trim();
    if (clean.length < 12) { notify("Add a little more context before publishing."); return; }
    if (clean.length > 1200) { notify("Please keep your thought under 1,200 characters."); return; }
    const tags = [...new Set(draftTags.split(",").map(t=>t.trim().replace(/^#/ ,"").toLowerCase()).filter(Boolean))].slice(0,5);
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
      notify(editingId ? "Your thought has been updated." : "Your thought has been shared anonymously.");
      setComposer(false); setEditingId(null); setDraft(""); setDraftTags("");
    } catch (error) { console.error(error); notify(error.message || "Couldn't publish your thought. Please try again."); }
  }

  // Persistent reaction: one per user per post. Clicking the same type removes it.
  async function handleReact(postId, type) {
    if (firebaseConfigured) {
      if (!cloudUser) { notify("Your anonymous session is not ready."); return; }
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
        notify(error.message || "Couldn't update your reaction.");
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
      if (!cloudUser) { notify("Your anonymous session is not ready."); return; }
      try {
        const isSaved = cloudBookmarks.includes(postId);
        if (isSaved) {
          await removeBookmark({ uid: cloudUser.uid, postId });
          notify("Removed from saved thoughts.");
        } else {
          await addBookmark({ uid: cloudUser.uid, postId });
          notify("Saved to your thoughts.");
        }
      } catch (error) {
        console.error(error);
        notify(error.message || "Couldn't update your bookmark.");
      }
    } else {
      const wasSaved = saved.includes(postId);
      setSaved(old => old.includes(postId) ? old.filter(x => x !== postId) : [...old, postId]);
      notify(wasSaved ? "Removed from saved thoughts." : "Saved on this device.");
    }
  }

  async function handleAddComment(postId, text, parentId = null) {
    if (!cloudUser) { notify("Your anonymous session is not ready."); return; }
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
      notify(error.message || "Couldn't post your comment.");
    }
  }

  async function handleDeleteComment(postId, commentId) {
    if (!cloudUser) { notify("Your anonymous session is not ready."); return; }
    try {
      await deleteComment({ postId, commentId, uid: cloudUser.uid });
    } catch (error) {
      console.error(error);
      notify(error.message || "Couldn't delete the comment.");
    }
  }

  async function deletePost(id) {
    if (!window.confirm("Delete this thought? This cannot be undone.")) return;
    try {
      if (firebaseConfigured) {
        if (!cloudUser) throw new Error("Your anonymous session is not ready.");
        await removePost({ id, uid: cloudUser.uid });
      } else { setPosts(old=>old.filter(p=>p.id!==id)); }
      setSaved(old=>old.filter(x=>x!==id));
      if(selectedPost) goHome("Explore");
      notify("Your thought has been deleted.");
    } catch (error) { console.error(error); notify(error.message || "Couldn't delete this thought."); }
  }

  async function sharePost(id) {
    const url = `${window.location.origin}/post/${encodeURIComponent(id)}`;
    try { await navigator.clipboard.writeText(url); notify("Post link copied."); }
    catch { notify(url); }
  }

  function reportPost() { notify("Thank you. Reporting will be connected to moderation in a later phase."); }

  const navItems = [
    {name:"Explore",icon:Compass},{name:"Confessions",icon:Heart},
    {name:"Discussions",icon:MessageCircle},{name:"Letters",icon:Mail},{name:"Midnight",icon:MoonStar}
  ];
  const pageTitle = active==="Explore"?"A little less alone.":active==="Letters"?"Letters never sent.":active==="Midnight"?"For the hours that feel different.":active;
  const pageSub = active==="Explore"?"Honest thoughts from people who don't need to be known.":active==="Letters"?"Write the words you never got to say. Keep them private or let them go.":active==="Midnight"?"A quiet place for thoughts that arrive after dark.":"A space to share, listen, and understand.";

  return <div className={light?"app light":"app"}>
    <header className="topbar">
      <button className="mobile-menu icon-btn" aria-label="Open navigation" onClick={()=>setMobileNav(!mobileNav)}>{mobileNav?<X/>:<Menu/>}</button>
      <a className="brand" href="/" onClick={e=>{e.preventDefault();goHome()}}><span className="brand-mark"><Feather size={18}/></span><span>UNSAID<span className="brand-dot">.</span></span></a>
      <nav className="top-links">{navItems.slice(0,3).map(n=><button key={n.name} className={active===n.name?"top-link selected":"top-link"} onClick={()=>goHome(n.name)}>{n.name}</button>)}<button className="top-link" onClick={()=>goHome("About")}>About</button></nav>
      <div className="top-actions"><button className="icon-btn theme-toggle" aria-label="Toggle color theme" onClick={()=>setLight(!light)}>{light?<MoonStar size={18}/>:<Sun size={18}/>}</button><button className="write-btn" onClick={()=>openComposer()}><PenLine size={16}/><span>Write anonymously</span></button></div>
    </header>

    <div className="layout">
      <aside className={`sidebar ${mobileNav?"open":""}`}>
        <div className="side-label">YOUR SPACE</div>
        {navItems.map(n=>{const Icon=n.icon;return <button key={n.name} className={`side-link ${active===n.name&&!selectedPost?"active":""}`} onClick={()=>goHome(n.name)}><Icon size={18}/>{n.name}</button>})}
        <div className="side-divider"/><div className="side-label">YOUR COLLECTION</div>
        <button className={`side-link ${active==="Saved thoughts"?"active":""}`} onClick={()=>goHome("Saved thoughts")}><Bookmark size={18}/>Saved thoughts</button>
        <button className="side-link" onClick={()=>notify("Private journal is planned for a later phase.")}><LockKeyhole size={18}/>Private journal</button>
        <div className="sidebar-bottom"><div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={17}/></div><strong>Your identity stays yours.</strong><p>This demo stores posts only in this browser. It is not yet a shared or production anonymous service.</p><button onClick={()=>notify("Privacy and security details will be completed before public launch.")}>Privacy status <ArrowUpRight size={13}/></button></div><div className="side-foot">A quieter corner of the internet.<br/>© 2026 UNSAID</div></div>
      </aside>

      <main className="main">
        {selectedPost && !currentPost && cloudStatus!=="connecting" ? (
          <section className="detail-page"><button className="back-link" onClick={()=>goHome()}><ArrowLeft size={16}/> Back to the community</button><div className="empty-state"><Search size={24}/><h3>Thought not found</h3><p>It may have been deleted, or it isn't available in this view.</p></div></section>
        ) : currentPost ? (
          <PostDetail
            post={currentPost}
            detailLoading={detailLoading}
            onBack={()=>goHome()}
            onReact={(id,type)=>handleReact(id,type)}
            userReaction={cloudReactions[currentPost.id]?.[cloudUser?.uid] ?? userReactions[currentPost.id]}
            reactions={currentPost.reactions}
            saved={effectiveSaved.includes(currentPost.id)}
            onSave={()=>handleToggleSave(currentPost.id)}
            onShare={sharePost}
            onReport={reportPost}
            onEdit={()=>openComposer(currentPost)}
            onDelete={()=>deletePost(currentPost.id)}
            comments={comments[currentPost.id] ?? []}
            onAddComment={(text, parentId)=>handleAddComment(currentPost.id, text, parentId)}
            onDeleteComment={(commentId)=>handleDeleteComment(currentPost.id, commentId)}
            authorLabel={currentPost.author}
            currentUid={cloudUser?.uid ?? null}
          />
        ) : (
          <>
            <section className="hero"><div className="hero-glow glow-one"/><div className="hero-glow glow-two"/><div className="hero-content"><div className="eyebrow"><span className="eyebrow-dot"/> A SPACE BEYOND IDENTITY</div><h1>{pageTitle}<br/><em>Your thoughts deserve a voice.</em></h1><p>{pageSub}</p><div className="hero-buttons"><button className="primary-btn" onClick={()=>openComposer()}>Share your thoughts <ArrowUpRight size={16}/></button><button className="quiet-btn" onClick={()=>document.getElementById("community-feed")?.scrollIntoView({behavior:"smooth"})}>Explore the community <span>↓</span></button></div></div><div className="hero-note"><span className="note-star"><Sparkles size={15}/></span><span>NO JUDGMENT. NO PRESSURE.<br/><b>JUST YOU AND YOUR THOUGHTS.</b></span></div><div className="hero-orbit orbit-a"/><div className="hero-orbit orbit-b"/></section>
            <section className="daily-card"><div className="daily-icon"><Sparkles size={18}/></div><div className="daily-copy"><div className="section-kicker">A QUESTION TO SIT WITH</div><h3>{prompts[dailyIndex]}</h3><span>Today's quiet prompt · Take your time</span></div><button className="daily-cta" onClick={()=>openComposer()}>Reflect on this <ArrowUpRight size={15}/></button></section>
            <section className="feed-section" id="community-feed"><div className="feed-heading"><div><div className="section-kicker">THE COMMUNITY</div><h2>{active==="Saved thoughts"?"Your saved thoughts":"Thoughts, out in the open"}<span>.</span></h2><p>Little pieces of people, shared without names.</p></div><div className="feed-tools"><label className="searchbox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a thought..." aria-label="Search thoughts"/></label><select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort posts"><option>Latest</option><option>Trending</option><option>Most discussed</option></select></div></div>
              <div className="category-row">{categories.map(c=><button key={c} className={`category-pill ${category===c?"chosen":""}`} onClick={()=>setCategory(c)}>{c}</button>)}</div>
              <div className="post-list">{visiblePosts.length?visiblePosts.map((p,i)=><PostCard key={p.id} post={p} index={i} userReaction={userReactions[p.id]} isSaved={effectiveSaved.includes(p.id)} onReact={(id,type)=>handleReact(id,type)} onSave={()=>handleToggleSave(p.id)} onOpen={()=>openPost(p.id)} onReport={reportPost} onEdit={()=>openComposer(p)} onDelete={()=>deletePost(p.id)}/>):<div className="empty-state"><Search size={24}/><h3>No thoughts found</h3><p>Try another search or category. There may be a thought waiting for you.</p><button onClick={()=>{setQuery("");setCategory("All")}}>Clear filters</button></div>}</div>
              <div className="feed-end"><span/> THAT'S ALL FOR NOW <span/></div>
            </section>
            <section className="bottom-invite"><div className="invite-mark"><Feather size={22}/></div><div><h2>Something on your mind?</h2><p>It doesn't have to be perfect. It just has to be yours.</p></div><button className="primary-btn" onClick={()=>openComposer()}>Let it out <ArrowUpRight size={16}/></button></section>
          </>
        )}
        </main>

        <footer className="footer"><a className="brand small" href="/" onClick={e=>{e.preventDefault();goHome()}}><span className="brand-mark"><Feather size={15}/></span><span>UNSAID<span className="brand-dot">.</span></span></a><span>Your thoughts deserve a voice. {cloudStatus==="connected"?"Community connected":cloudStatus==="connecting"?"Connecting…":cloudStatus==="error"?"Connection issue":"Local preview mode"}</span><div><button onClick={()=>notify("About UNSAID: a space for thoughtful anonymous expression.")}>About</button><button onClick={()=>notify("Be kind. Do not share identifying details, threats, or targeted harassment.")}>Guidelines</button><button onClick={()=>notify("This prototype stores data locally in your browser.")}>Privacy</button></div></footer>

      <aside className="rightbar"><div className="right-intro"><div className="online-indicator"/> <span>A QUIETER KIND OF SOCIAL</span></div><div className="right-card welcome-card"><div className="welcome-art"><div className="welcome-orb"/><span>✳</span></div><div className="section-kicker">WELCOME TO UNSAID</div><h3>You can be heard<br/>without being known.</h3><p>Some things are easier to say when you don't have to explain who you are.</p><button onClick={()=>notify("UNSAID is currently a local prototype.")}>Get to know us <ArrowUpRight size={14}/></button></div><div className="right-card values-card"><div className="section-kicker">A FEW THINGS WE BELIEVE</div><div className="value-row"><span className="value-icon"><Heart size={16}/></span><div><b>Kindness comes first</b><p>Be gentle with someone's truth.</p></div></div><div className="value-row"><span className="value-icon"><LockKeyhole size={16}/></span><div><b>Privacy is a promise</b><p>Your identity isn't the story.</p></div></div><div className="value-row"><span className="value-icon"><MessageCircle size={16}/></span><div><b>Listen to understand</b><p>Not every thought needs a debate.</p></div></div></div><div className="right-quote"><span>“</span><p>There is a kind of courage in finally putting a feeling into words.</p><small>— A thought worth keeping</small></div><div className="right-bottom"><ShieldCheck size={14}/> Built around privacy, care & respect.</div></aside>
    </div>

    {composer&&<Composer editing={Boolean(editingId)} draft={draft} setDraft={setDraft} category={draftCategory} setCategory={setDraftCategory} tags={draftTags} setTags={setDraftTags} onClose={()=>{setComposer(false);setEditingId(null)}} onPublish={publish}/>}
    <div className="toast-region" role="status" aria-live="polite">{toast&&<div className="toast"><Check size={16} aria-hidden="true"/>{toast}</div>}</div>
  </div>;
}

function PostCard({post,index,userReaction,isSaved,onReact,onSave,onOpen,onReport,onEdit,onDelete}) {
  return <article className="post-card">
    <div className="post-top"><div className="anon-avatar">{["✳","◌","✦","⌁"][index%4]}</div><div className="post-meta"><strong>{post.author||"Someone, somewhere"}</strong><span>{relativeTime(post.createdAt||Date.now())}{post.edited?" · edited":""} <i>·</i> <span className="post-category">{post.category}</span></span></div><div className="post-card-actions">{post.owner&&<><button className="icon-btn compact" title="Edit your post" onClick={onEdit}><Pencil size={14}/></button><button className="icon-btn compact" title="Delete your post" onClick={onDelete}><Trash2 size={14}/></button></>}<button className="icon-btn compact" title="Report post" onClick={onReport}><Flag size={14}/></button></div></div>
    <button className="post-open-area" onClick={onOpen} aria-label="Open post details"><p className="post-text">{post.text}</p></button>
    {!!post.tags?.length&&<div className="post-tags">{post.tags.map(tag=><span key={tag}><Hash size={12}/>{tag}</span>)}</div>}
    <div className="post-bottom"><div className="reaction-group"><button className={userReaction==="understand"?"reacted":""} onClick={()=>onReact(post.id,"understand")}><span>♡</span> I understand <b>{post.reactions?.understand||0}</b></button><button className={userReaction==="alone"?"reacted":""} onClick={()=>onReact(post.id,"alone")}><span>✧</span> Not alone <b>{post.reactions?.alone||0}</b></button><button className={userReaction==="feel"?"reacted":""} onClick={()=>onReact(post.id,"feel")}><span>♥</span> Feel this <b>{post.reactions?.feel||0}</b></button></div><div className="post-actions"><button onClick={onOpen}><MessageCircle size={15}/>{post.comments||0}</button><button className={isSaved?"saved":""} aria-label="Save post" onClick={onSave}><Bookmark size={15}/></button></div></div>
  </article>;
}

function PostDetail({post,detailLoading,onBack,onReact,userReaction,reactions,saved,onSave,onShare,onReport,onEdit,onDelete,comments,onAddComment,onDeleteComment,authorLabel,currentUid}) {
  return <section className="detail-page">
    {detailLoading && <div className="detail-loading">Loading thought…</div>}
    {!detailLoading && (
    <>
      <button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Back to the community</button>
      <div className="detail-kicker">A THOUGHT SHARED ANONYMOUSLY</div>
      <article className="detail-card">
        <div className="post-top"><div className="anon-avatar large">✳</div><div className="post-meta"><strong>{post.author||"Someone, somewhere"}</strong><span><Clock3 size={12}/> {relativeTime(post.createdAt||Date.now())} · {post.category}{post.edited?" · edited":""}</span></div><div className="post-card-actions">{post.owner&&<><button className="icon-btn compact" onClick={onEdit} title="Edit post"><Pencil size={15}/></button><button className="icon-btn compact" onClick={onDelete} title="Delete post"><Trash2 size={15}/></button></>}<button className="icon-btn compact" onClick={onReport} title="Report post"><Flag size={15}/></button></div></div>
        <p className="detail-text">{post.text}</p>
        {!!post.tags?.length&&<div className="post-tags">{post.tags.map(tag=><span key={tag}><Hash size={12}/>{tag}</span>)}</div>}
        <div className="detail-actions"><div className="reaction-group"><button className={userReaction==="understand"?"reacted":""} onClick={()=>onReact(post.id,"understand")}><span>♡</span> I understand <b>{reactions?.understand||0}</b></button><button className={userReaction==="alone"?"reacted":""} onClick={()=>onReact(post.id,"alone")}><span>✧</span> Not alone <b>{reactions?.alone||0}</b></button><button className={userReaction==="feel"?"reacted":""} onClick={()=>onReact(post.id,"feel")}><span>♥</span> Feel this <b>{reactions?.feel||0}</b></button></div><div className="post-actions"><button className={saved?"saved":""} onClick={onSave}><Bookmark size={16}/>{saved?"Saved":"Save"}</button><button onClick={()=>onShare(post.id)}><Copy size={15}/>Copy link</button></div></div>
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

function Composer({editing,draft,setDraft,category,setCategory,tags,setTags,onClose,onPublish}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title"><div className="modal-head"><div><div className="section-kicker">{editing?"MAKE IT YOUR WORDS":"A MOMENT FOR YOURSELF"}</div><h2 id="composer-title">{editing?"Edit your thought":"Let it out"}<span>.</span></h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X/></button></div><p className="modal-desc">You don't need a name here. Just write what feels true.</p><label className="field-label" htmlFor="post-category">Choose a space</label><select id="post-category" className="modal-select" value={category} onChange={e=>setCategory(e.target.value)}>{categories.filter(c=>c!=="All").map(c=><option key={c}>{c}</option>)}</select><label className="field-label" htmlFor="thought">What's on your mind?</label><textarea id="thought" autoFocus maxLength={1200} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Start wherever you are. Nobody here needs you to have the perfect words..." rows={6}/><div className="field-row"><label className="field-label" htmlFor="post-tags">Optional tags <span>(comma separated, up to 5)</span></label><input id="post-tags" className="tag-input" maxLength={100} value={tags} onChange={e=>setTags(e.target.value)} placeholder="e.g. overthinking, friendship, life"/></div><div className="composer-foot"><span><LockKeyhole size={13}/> No public profile attached <b>{draft.length}/1200</b></span><button className="primary-btn" onClick={onPublish} disabled={draft.trim().length<12}>{editing?"Save changes":"Publish thought"} <Send size={15}/></button></div><div className="modal-safety"><ShieldCheck size={15}/> Please don't share identifying details about yourself or anyone else.</div></section></div>;
}

createRoot(document.getElementById("root")).render(<App/>);
