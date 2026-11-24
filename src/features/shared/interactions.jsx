import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CommentSection from "../../components/CommentSection";
import { setReaction, removeReaction, getUserReaction } from "../../services/firestoreReactions";
import { subscribeOwnedIds } from "../../services/content/content";
import { makeAnonymousId } from "../../lib/format";

// Ids of content (of one kind) created by this anonymous session; used for owner controls and "My ...".
export function useOwnedIds(kind, uid) {
  const [ids, setIds] = useState([]);
  useEffect(() => subscribeOwnedIds(uid, kind, setIds, (e) => console.error("unsaid owners error:", e)), [kind, uid]);
  const set = useMemo(() => new Set(ids), [ids]);
  return { ownedList: ids, isOwned: (id) => set.has(id) };
}

const adjust = (from, to) => (item) => {
  const reactions = { ...item.reactions };
  if (from && reactions[from] !== undefined) reactions[from] = Math.max(0, reactions[from] - 1);
  if (to && reactions[to] !== undefined) reactions[to] = (reactions[to] || 0) + 1;
  return { ...item, reactions };
};

// Wraps the Phase 2 reaction service for a list of items under `basePath`.
// One reaction per person; pressing the same one again removes it. Your own reactions are
// looked up once per item (one small read each) so the pressed state is accurate after a reload.
export function useReactionState({ basePath, ids, user, ensureUser, notify, patchLocal }) {
  const [mine, setMine] = useState({});
  const seen = useRef(new Set());
  const pathKey = basePath.join("/");
  const idsKey = ids.join(",");
  useEffect(() => { seen.current = new Set(); setMine({}); }, [pathKey, user?.uid]);
  useEffect(() => {
    if (!user) return;
    const todo = ids.filter((id) => !seen.current.has(id));
    todo.forEach((id) => seen.current.add(id));
    if (!todo.length) return;
    Promise.all(todo.map((id) => getUserReaction([...basePath, id], user.uid).then((t) => [id, t]).catch(() => [id, null])))
      .then((entries) => setMine((old) => ({ ...Object.fromEntries(entries), ...old })));
  }, [idsKey, user?.uid, pathKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const react = useCallback(async (id, type) => {
    const current = mine[id] ?? null;
    const next = current === type ? null : type;
    try {
      const u = await ensureUser();
      setMine((o) => ({ ...o, [id]: next }));
      patchLocal?.(id, adjust(current, next));
      const parentPath = [...basePath, id];
      if (next) await setReaction({ parentPath, uid: u.uid, type: next });
      else await removeReaction({ parentPath, uid: u.uid });
    } catch (error) {
      console.error(error);
      setMine((o) => ({ ...o, [id]: current }));
      patchLocal?.(id, adjust(next, current));
      notify("Couldn't save your reaction. Please try again.");
    }
  }, [mine, basePath, ensureUser, notify, patchLocal]);
  return { mine, react };
}

// Your Phase 2 CommentSection (threaded replies, one level) under any parent document.
export function Thread({ parentPath, user, ensureUser }) {
  const [session, setSession] = useState(user);
  useEffect(() => { if (user) setSession(user); else ensureUser().then(setSession).catch((e) => console.error(e)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = useMemo(() => makeAnonymousId(), []);
  if (!session) return <div className="skeletons" role="status" aria-busy="true" aria-label="Loading replies"><div className="skeleton short" /></div>;
  return <CommentSection postId={parentPath[parentPath.length - 1]} parentPath={parentPath} authorLabel={label} uid={session.uid} />;
}
