import React, { useState } from "react";
import { changePassword, resetPassword, signOutNow, resendVerification, refreshUser } from "../../services/auth/account";
import { deleteAccount, DELETE_STEPS } from "../../services/account/accountData";
import { getCounts } from "../../services/account/ownership";
import { friendlyAuthError } from "../../services/auth/errors";
import { Dialog, ConfirmDialog, FieldError } from "../shared/ui";
import { useLoad } from "./hooks";

export default function SecurityPage({ user, notify, navigate, onDeleted }) {
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [signOutAsk, setSignOutAsk] = useState(false); const [deleting, setDeleting] = useState(false);

  async function change(e) {
    e.preventDefault();
    if (!cur) return setError("Enter your current password.");
    if (next.length < 8) return setError("Choose a new password with at least 8 characters.");
    if (next !== again) return setError("The new passwords don't match.");
    setError(""); setBusy("pw");
    try { await changePassword(cur, next); setCur(""); setNext(""); setAgain(""); notify("Password changed."); }
    catch (err) { console.error(err); setError(friendlyAuthError(err, "Couldn't change your password.")); } finally { setBusy(""); }
  }
  async function sendReset() { setBusy("reset"); try { await resetPassword(user.email); notify("Reset link sent. Check your email."); } catch (e) { console.error(e); notify(friendlyAuthError(e, "Couldn't send the reset link.")); } finally { setBusy(""); } }
  async function resend() { setBusy("verify"); try { await resendVerification(); notify("Verification email sent."); } catch (e) { console.error(e); notify(friendlyAuthError(e, "Couldn't send it. Try again shortly.")); } finally { setBusy(""); } }
  async function recheck() { setBusy("recheck"); try { const u = await refreshUser(); notify(u.emailVerified ? "Email verified." : "Not verified yet."); } catch (e) { console.error(e); notify("Couldn't check. Try again."); } finally { setBusy(""); } }
  async function leave() { setBusy("out"); try { await signOutNow(); setSignOutAsk(false); notify("Signed out."); navigate("/"); } catch (e) { console.error(e); notify("Couldn't sign out."); setBusy(""); } }

  return <>
    <section className="page-head"><h1>Security.</h1><p>{user.isAnonymous ? "This session has no password. Securing it is the only way to keep it." : "Keep your account safe and in your control."}</p></section>

    {user.isAnonymous && <div className="notice open"><p><strong>Anonymous session.</strong> There's no password to change or reset, because nothing can recover it if this browser forgets it.</p><div className="page-actions"><button type="button" className="btn primary" onClick={() => navigate("/register")}>Secure this session</button></div></div>}

    {!user.isAnonymous && user.email && <>
      <h2 className="section-title">Email</h2>
      <div className="settings-block"><p className="settings-copy">{user.email} · {user.emailVerified ? "verified" : "not verified"}</p>
        {!user.emailVerified && <div className="page-actions"><button type="button" className="btn" onClick={resend} disabled={busy === "verify"}>Resend verification email</button><button type="button" className="btn" onClick={recheck} disabled={busy === "recheck"}>I've verified it</button></div>}</div></>}

    {user.hasPassword && <>
      <h2 className="section-title">Password</h2>
      <form className="settings-block" onSubmit={change} noValidate>
        <label className="field" htmlFor="pw-cur">Current password</label><input id="pw-cur" className="plain-input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <label className="field" htmlFor="pw-new">New password</label><input id="pw-new" className="plain-input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label className="field" htmlFor="pw-again">Confirm new password</label><input id="pw-again" className="plain-input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        <FieldError>{error}</FieldError>
        <div className="page-actions"><button type="submit" className="btn primary" disabled={busy === "pw"}>{busy === "pw" ? "Changing…" : "Change password"}</button><button type="button" className="btn" onClick={sendReset} disabled={busy === "reset"}>Email me a reset link</button></div>
      </form></>}
    {!user.isAnonymous && !user.hasPassword && <p className="settings-copy">You sign in with Google, so your password is managed by Google.</p>}

    <h2 className="section-title">Sign out</h2>
    <div className="settings-block"><p className="settings-copy">{user.isAnonymous ? "Signing out of an anonymous session ends it permanently on this device." : "You can sign back in any time with your email or Google."}</p>
      <div className="page-actions"><button type="button" className="btn" onClick={() => (user.isAnonymous ? setSignOutAsk(true) : leave())} disabled={busy === "out"}>Sign out</button></div></div>

    <h2 className="section-title">Delete account</h2>
    <div className="settings-block"><p className="settings-copy">Removes your private data and sign-in. You choose what happens to your public writing. This can't be undone.</p>
      <div className="page-actions"><button type="button" className="btn danger" onClick={() => setDeleting(true)}>Delete account…</button></div></div>

    {signOutAsk && <ConfirmDialog title="Sign out of this anonymous session?" confirmLabel="Sign out for good" busy={busy === "out"} onCancel={() => setSignOutAsk(false)} onConfirm={leave}
      message="Nothing can bring this session back. Your writing stays online anonymously, but you won't be able to edit or delete it, and your journal and saved items become unreachable. Secure the session first to avoid this." />}
    {deleting && <DeleteDialog user={user} onDeleted={onDeleted} onClose={() => setDeleting(false)} />}
  </>;
}

function DeleteDialog({ user, onDeleted, onClose }) {
  const counts = useLoad(() => getCounts(user.uid), [user.uid]);
  const [mode, setMode] = useState("detach"); const [typed, setTyped] = useState(""); const [password, setPassword] = useState("");
  const [step, setStep] = useState(-1); const [error, setError] = useState("");
  const needsPassword = user.hasPassword && !user.isAnonymous;
  const running = step >= 0;
  const c = counts.data;

  async function run() {
    if (typed.trim() !== "DELETE") return setError("Type DELETE to confirm.");
    if (needsPassword && !password) return setError("Enter your password to confirm it's you.");
    setError(""); setStep(0);
    // Once the sign-in is deleted the app leaves this page, so the result is handed to AccountApp, which stays mounted.
    try { const r = await deleteAccount({ password, mode, onStep: setStep }); onDeleted({ report: r, mode }); }
    catch (e) { console.error(e); setStep(-1); setError(`${friendlyAuthError(e, "Something went wrong.")} Nothing further was deleted; you can safely try again.`); }
  }
  return <Dialog titleId="del-title" title="Delete your account" onClose={() => { if (!running) onClose(); }}>
    <div className="del-body">
      <p className="dialog-hint"><strong>Always removed:</strong> your private journal ({c ? c.journal : "…"}), saved items ({c ? c.saved : "…"}), your profile and your sign-in. {c && <>You've published {c.total} {c.total === 1 ? "item" : "items"}.</>}</p>
      <fieldset className="choice" disabled={running}><legend className="field">What should happen to your public writing?</legend>
        <label className="check"><input type="radio" name="mode" checked={mode === "detach"} onChange={() => setMode("detach")} /> Keep it online, anonymously. It's detached from you; nobody can edit or delete it afterwards.</label>
        <label className="check"><input type="radio" name="mode" checked={mode === "delete"} onChange={() => setMode("delete")} /> Delete it too (posts, letters, questions, thoughts, answers, daily answers).</label></fieldset>
      <p className="dialog-note">Limits: replies and reactions you made on others' writing can't be found without scanning the database, so they remain, unlinked to any email. Older answers saved before accounts don't record their question and stay online. Deleting your sign-in doesn't by itself delete database records, which is why this list runs first.</p>
      {needsPassword && <><label className="field" htmlFor="del-pass">Your password</label><input id="del-pass" className="plain-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={running} /></>}
      {user.hasGoogle && !user.hasPassword && !user.isAnonymous && <p className="dialog-note">Google will ask you to confirm it's you.</p>}
      <label className="field" htmlFor="del-type">Type DELETE to confirm</label><input id="del-type" className="plain-input" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={running} autoComplete="off" />
      <FieldError>{error}</FieldError>
      {running && <ol className="steps" aria-live="polite">{DELETE_STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>{s}{i < step ? " ✓" : i === step ? "…" : ""}</li>)}</ol>}
    </div>
    <div className="dialog-foot"><button type="button" className="btn" onClick={onClose} disabled={running}>Cancel</button><button type="button" className="btn danger" onClick={run} disabled={running}>{running ? "Deleting…" : "Delete my account"}</button></div>
  </Dialog>;
}

export function DeletedDialog({ result, onDone }) {
  const { report, mode } = result;
  return <Dialog titleId="del-done" title="Your account was deleted" onClose={onDone}>
    <p className="dialog-hint">{mode === "delete" ? `${report.writing} public ${report.writing === 1 ? "item was" : "items were"} removed.` : `${report.detached} public ${report.detached === 1 ? "item was" : "items were"} detached from you and remain online anonymously.`}{report.unreachable ? ` ${report.unreachable} older ${report.unreachable === 1 ? "answer" : "answers"} couldn't be located and stay online anonymously.` : ""} Your journal entries and saved items were removed.</p>
    <p className="dialog-hint">Replies and reactions you made on other people's writing can't be located without scanning the whole database, so they remain, with no link to any email or name.</p>
    <div className="dialog-foot"><button type="button" className="btn primary" onClick={onDone}>Done</button></div>
  </Dialog>;
}
