import React, { useState } from "react";
import { saveProfile, DEFAULT_PREFERENCES, SORTS } from "../../services/account/profile";
import { exportMyData, downloadJson } from "../../services/account/accountData";
import { linkGoogle, GOOGLE_ENABLED } from "../../services/auth/account";
import { friendlyAuthError } from "../../services/auth/errors";
import { syncProfileMirror } from "../../services/account/profile";
import { formatDate } from "../../lib/format";
import { FieldError } from "../shared/ui";

const SPACES = ["All", "Thoughts", "Confessions", "Relationships", "Friendship", "Loneliness", "University Life", "Mental Wellbeing", "Society", "Unpopular Opinions", "Life Experiences", "Questions"];

export default function SettingsPage({ user, profile, onProfile, applyPrefs, notify, navigate }) {
  const prefs = { ...DEFAULT_PREFERENCES, ...(profile?.preferences || {}) };
  const [name, setName] = useState(profile?.displayName || ""); const [p, setP] = useState(prefs);
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");

  async function save(patch, label) {
    setBusy(label); setError("");
    try { const next = await saveProfile(user, patch); onProfile(next); if (patch.preferences) applyPrefs(next.preferences, true); notify("Saved."); }
    catch (e) { console.error(e); setError("Couldn't save. Please try again."); } finally { setBusy(""); }
  }
  async function exportData() {
    setBusy("export"); setError("");
    try { const data = await exportMyData(user); downloadJson(data); notify("Your data was downloaded."); }
    catch (e) { console.error(e); setError("Couldn't export your data. Please try again."); } finally { setBusy(""); }
  }
  async function addGoogle() {
    setBusy("google"); setError("");
    try { const u = await linkGoogle(); await syncProfileMirror(u); notify("Google account linked."); }
    catch (e) { console.error(e); setError(e?.pendingCredential ? "That Google account already belongs to another UNSAID account, so it can't be added here." : friendlyAuthError(e)); } finally { setBusy(""); }
  }
  return <>
    <section className="page-head"><h1>Settings.</h1><p>Your preferences and privacy. None of this is ever shown publicly.</p></section>

    <h2 className="section-title">Profile</h2>
    <div className="settings-block">
      <label className="field" htmlFor="pf-name">Private nickname <span>(only you see it. Don't use your real name.)</span></label>
      <input id="pf-name" className="plain-input" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="page-actions"><button type="button" className="btn primary" disabled={busy === "name" || name.trim() === (profile?.displayName || "")} onClick={() => save({ displayName: name }, "name")}>{busy === "name" ? "Saving…" : "Save nickname"}</button></div>
      <dl className="facts">
        <div><dt>Account type</dt><dd>{user.isAnonymous ? "Anonymous session" : "Registered account"}</dd></div>
        <div><dt>Email</dt><dd>{user.email ? <>{user.email} <small>({user.emailVerified ? "verified" : "not verified"}, private)</small></> : "None added"}</dd></div>
        <div><dt>Created</dt><dd>{user.createdAt ? formatDate(user.createdAt) : "Unknown"}</dd></div>
      </dl>
    </div>

    <h2 className="section-title">Preferences</h2>
    <div className="settings-block">
      <label className="field" htmlFor="pr-theme">Theme</label>
      <select id="pr-theme" value={p.theme} onChange={(e) => setP({ ...p, theme: e.target.value })}><option value="system">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <label className="field" htmlFor="pr-sort">Order the home feed by</label>
      <select id="pr-sort" value={p.defaultSort} onChange={(e) => setP({ ...p, defaultSort: e.target.value })}>{SORTS.map((s) => <option key={s}>{s}</option>)}</select>
      <label className="field" htmlFor="pr-space">Open the home feed on</label>
      <select id="pr-space" value={p.defaultCategory} onChange={(e) => setP({ ...p, defaultCategory: e.target.value })}>{SPACES.map((s) => <option key={s}>{s}</option>)}</select>
      <div className="page-actions"><button type="button" className="btn primary" disabled={busy === "prefs"} onClick={() => save({ preferences: p }, "prefs")}>{busy === "prefs" ? "Saving…" : "Save preferences"}</button></div>
      <p className="dialog-note">Notifications: UNSAID can't send email or push notifications on the free plan, so there's nothing to turn on yet.</p>
    </div>

    <h2 className="section-title">Privacy</h2>
    <div className="settings-block">
      <p className="settings-copy"><strong>Public identity.</strong> Everything you publish shows a random label such as “Anonymous #1234”, chosen fresh each time. Your nickname, email and account details are never shown publicly and never stored with your writing.</p>
      <p className="settings-copy"><strong>Account linking.</strong></p>
      <ul className="link-status">
        <li><span>Email and password</span><span>{user.hasPassword ? "Linked" : "Not linked"}</span>{!user.hasPassword && <button type="button" className="btn" onClick={() => navigate("/register")}>Add email</button>}</li>
        {(GOOGLE_ENABLED || user.hasGoogle) && <li><span>Google</span><span>{user.hasGoogle ? "Linked" : "Not linked"}</span>{!user.hasGoogle && GOOGLE_ENABLED && <button type="button" className="btn" onClick={addGoogle} disabled={busy === "google"}>{busy === "google" ? "Opening…" : "Link Google"}</button>}</li>}
      </ul>
      {user.isAnonymous && <p className="settings-copy">This is an anonymous session. Link a method above to keep it.</p>}
      <div className="page-actions"><button type="button" className="btn" onClick={exportData} disabled={busy === "export"}>{busy === "export" ? "Preparing…" : "Download my data"}</button></div>
      <details className="notice"><summary>What if I lose access to an anonymous session?</summary>
        <p>An anonymous session exists only in this browser's storage. There is no email or password to recover it with, and nobody (including us) can restore it. If it's cleared, your public writing stays online anonymously, but you can no longer edit or delete it, and your journal and saved items are unreachable for good.</p>
        <p>Only linking prevents this. Add an email or Google while you still have the session; your writing, journal and bookmarks stay attached because the account keeps the same identity. Use “Download my data” for a backup.</p></details>
    </div>
    <FieldError>{error}</FieldError>
  </>;
}
