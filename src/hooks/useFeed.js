import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDocs, onSnapshot } from "firebase/firestore";
import { col, normalize, query, orderBy, limit, startAfter, fetchByIds } from "../services/content/content";

// One hook for every list: a live first page (a single listener), "load more" pages fetched
// once, and one-shot scopes for "mine" (ids from postOwners) and "saved" (ids from bookmarks).
export function useFeed({ path, scope = "all", constraints = [], constraintsKey = "", scopeIds = [], pageSize = 20, enabled = true }) {
  const [first, setFirst] = useState([]);
  const [extra, setExtra] = useState([]);
  const [status, setStatus] = useState("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = useRef(null);
  const idsKey = scope === "all" ? "" : scopeIds.join(",");
  const key = `${path.join("/")}|${scope}|${constraintsKey}|${idsKey}|${attempt}`;
  const latest = useRef({ constraints, scopeIds });
  latest.current = { constraints, scopeIds };

  useEffect(() => {
    if (!enabled) return undefined;
    setFirst([]); setExtra([]); setStatus("loading"); setHasMore(false); cursor.current = null;
    let cancelled = false;
    if (scope === "all") {
      const q = query(col(path), ...latest.current.constraints, orderBy("createdAt", "desc"), limit(pageSize));
      return onSnapshot(q, (snap) => {
        setFirst(snap.docs.map(normalize));
        setStatus("ready");
        setExtra((prev) => {
          if (!prev.length) { cursor.current = snap.docs[snap.docs.length - 1] ?? null; setHasMore(snap.docs.length === pageSize); }
          return prev;
        });
      }, (error) => { console.error("unsaid feed error:", error); setStatus("error"); });
    }
    const ids = latest.current.scopeIds;
    if (!ids.length) { setStatus("ready"); return undefined; }
    fetchByIds(path, ids)
      .then((items) => { if (!cancelled) { setFirst(items); setStatus("ready"); } })
      .catch((error) => { console.error("unsaid feed error:", error); if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, pageSize, scope]);

  const loadMore = useCallback(async () => {
    if (!cursor.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const snap = await getDocs(query(col(path), ...latest.current.constraints, orderBy("createdAt", "desc"), startAfter(cursor.current), limit(pageSize)));
      cursor.current = snap.docs[snap.docs.length - 1] ?? cursor.current;
      setExtra((prev) => [...prev, ...snap.docs.map(normalize)]);
      setHasMore(snap.docs.length === pageSize);
    } catch (error) { console.error("unsaid load more error:", error); setStatus("error"); }
    finally { setLoadingMore(false); }
  }, [path, pageSize, loadingMore]);

  const items = useMemo(() => {
    const seen = new Set();
    return [...first, ...extra].filter((item) => (seen.has(item.id) ? false : seen.add(item.id)));
  }, [first, extra]);
  const patchLocal = useCallback((id, updater) => { const apply = (l) => l.map((i) => (i.id === id ? updater(i) : i)); setFirst(apply); setExtra(apply); }, []);
  const removeLocal = useCallback((id) => { const drop = (l) => l.filter((i) => i.id !== id); setFirst(drop); setExtra(drop); }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { items, status, hasMore, loadingMore, loadMore, patchLocal, removeLocal, retry };
}
