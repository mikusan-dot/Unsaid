import { useCallback, useEffect, useRef, useState } from "react";

// Small loader: { status: loading|ready|error, data, reload }. Ignores results that arrive after unmount/dep change.
export function useLoad(fn, deps) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(fn); latest.current = fn;
  useEffect(() => {
    let on = true; setState((s) => ({ status: "loading", data: s.data }));
    Promise.resolve().then(() => latest.current()).then((data) => { if (on) setState({ status: "ready", data }); })
      .catch((e) => { console.error("unsaid account load error:", e); if (on) setState({ status: "error", data: null }); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
