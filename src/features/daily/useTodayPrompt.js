import { useEffect, useState } from "react";
import { getToday } from "../../services/content/daily";

// Used by the home page. Only runs once an anonymous session already exists, so
// simply visiting the site never creates an account.
export function useTodayPrompt(user, enabled) {
  const [state, setState] = useState({ status: "idle", prompt: null });
  useEffect(() => {
    if (!enabled || !user) return undefined;
    let cancelled = false;
    setState({ status: "loading", prompt: null });
    getToday(user.uid)
      .then((v) => { if (!cancelled) setState({ status: "ready", prompt: v.prompt }); })
      .catch((e) => { console.error(e); if (!cancelled) setState({ status: "error", prompt: null }); });
    return () => { cancelled = true; };
  }, [enabled, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
