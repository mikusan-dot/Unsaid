export function makeAnonymousId() { return `Anonymous #${String(Math.floor(1000 + Math.random() * 9000))}`; }

export function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function excerpt(text, max = 220) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateUTC(dateId) {
  return new Date(`${dateId}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}
