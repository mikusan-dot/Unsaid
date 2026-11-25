import React, { useEffect, useState } from "react";
import { registerWithEmail, signInWithEmail, signInWithGoogle, linkGoogle, switchToCredential, resetPassword, GOOGLE_ENABLED, describeUser } from "../../services/auth/account";
import { friendlyAuthError, authCode } from "../../services/auth/errors";
import { getCounts } from "../../services/account/ownership";
import { syncProfileMirror } from "../../services/account/profile";
import { Dialog, ConfirmDialog, FieldError } from "../shared/ui";

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// What would be left behind if this anonymous session were replaced? (a handful of cheap aggregate reads)
function useSessionSummary(user) {
  const [counts, setCounts] = useState(null);
  useEffect(() => { if (user?.isAnonymous) getCounts(user.uid).then(setCounts).catch(() => setCounts(null)); else setCounts(null); }, [user?.uid, user?.isAnonymous]);
  return counts;
}
const countsSentence = (c) => (c ? `It has ${c.total} published ${c.total === 1 ? "item" : "items"}, ${c.saved} saved and ${c.journal} private journal ${c.journal === 1 ? "entry" : "entries"}.` : "");

function GoogleButton({ onClick, busy, label }) {
  if (!GOOGLE_ENABLED) return null;
  return <button type="button" className="btn" onClick={onClick} disabled={busy}>{label}</button>;
}

/* ============================== Register ============================== */
export function RegisterPage({ user, notify, navigate }) {
  const info = describeUser(user);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState(null); // { kind: "email" | "google", credential }
  const counts = useSessionSummary(user);

  if (info && !info.isAnonymous) return <section className="account-narrow"><h1 className="account-title">You have an account.</h1><p className="account-lead">You're signed in{info.email ? ` as ${info.email}` : ""}.</p><div className="page-actions"><button type="button" className="btn primary" onClick={() => navigate("/account")}>Go to your account</button></div></section>;

  async function submit(e) {
    e.preventDefault();
    if (!emailOk(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Choose a password with at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setError(""); setBusy(true);
    try {
      const { user: u, linked } = await registerWithEmail(email.trim(), password);
      await syncProfileMirror(u);
      notify(linked ? "Account created. Everything you wrote is still yours." : "Account created.");
      navigate("/account");
    } catch (err) {
      if (authCode(err) === "auth/email-already-in-use") setCollision({ kind: "email" });
      else { console.error(err); setError(friendlyAuthError(err, "Couldn't create your account. Nothing was changed.")); }
      setBusy(false);
    }
  }
  async function google() {
    setError(""); setBusy(true);
    try {
      const u = user ? await linkGoogle() : await signInWithGoogle();
      await syncProfileMirror(u); notify(user ? "Google account linked. Everything you wrote is still yours." : "Signed in with Google."); navigate("/account");
    } catch (err) {
      if (err?.pendingCredential) setCollision({ kind: "google", credential: err.pendingCredential });
      else { console.error(err); setError(friendlyAuthError(err, "Couldn't connect Google. Nothing was changed.")); }
    } finally { setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true);
    try { await switchToCredential(collision.credential); setCollision(null); notify("Signed in to your existing account."); navigate("/account"); }
    catch (err) { console.error(err); setError(friendlyAuthError(err)); setCollision(null); setBusy(false); }
  }

  return <section className="account-narrow">
    <h1 className="account-title">Keep what you write.</h1>
    <p className="account-lead">An account is optional. It lets you come back to your writing, journal and saved thoughts from any device, and recover access if you clear your browser. You still post anonymously.</p>
    {user && <div className="notice open"><p>{info?.isAnonymous ? <>You're using an anonymous session. Creating an account <strong>links</strong> it, so your existing posts, replies, reactions, bookmarks and journal stay yours. {countsSentence(counts)}</> : null}</p></div>}
    <form onSubmit={submit} noValidate className="account-form">
      <label className="field" htmlFor="reg-email">Email <span>(private, used only to sign in and reset your password)</span></label>
      <input id="reg-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="field" htmlFor="reg-pass">Password <span>(at least 8 characters)</span></label>
      <input id="reg-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <label className="field" htmlFor="reg-confirm">Confirm password</label>
      <input id="reg-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <FieldError>{error}</FieldError>
      <div className="page-actions">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <GoogleButton onClick={google} busy={busy} label="Continue with Google" />
        <button type="button" className="btn" onClick={() => navigate(user ? "/account" : "/")} disabled={busy}>Not now</button>
      </div>
    </form>
    <p className="dialog-note">Already registered? <button type="button" className="linklike" onClick={() => navigate("/signin")}>Sign in</button></p>
    {collision?.kind === "email" && <Dialog titleId="collide-email" title="That email already has an account" hint="Your anonymous session was not changed." onClose={() => setCollision(null)}>
      <p className="dialog-hint">You can use a different email, or sign in to that account. Signing in replaces this anonymous session on this device, and you won't be able to edit what you wrote in it. {countsSentence(counts)}</p>
      <div className="dialog-foot"><button type="button" className="btn primary" onClick={() => setCollision(null)}>Use a different email</button><button type="button" className="btn" onClick={() => navigate("/signin")}>Go to sign in</button></div>
    </Dialog>}
    {collision?.kind === "google" && <ConfirmDialog title="This Google account already has an UNSAID account" confirmLabel="Switch to that account" busy={busy} onCancel={() => setCollision(null)} onConfirm={switchAccount}
      message={`Your anonymous session was not changed. If you switch, it stays behind on this device and cannot be recovered or merged. Its writing stays public but you won't be able to edit it. ${countsSentence(counts)} Switch only if you're sure.`} />}
  </section>;
}

/* ============================== Sign in ============================== */
export function SignInPage({ user, notify, navigate }) {
  const info = describeUser(user);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [understood, setUnderstood] = useState(false); const [forgot, setForgot] = useState(false);
  const counts = useSessionSummary(user);
  const leaving = Boolean(info?.isAnonymous);

  if (info && !info.isAnonymous) return <section className="account-narrow"><h1 className="account-title">You're signed in.</h1><p className="account-lead">{info.email || "Signed in with Google."}</p><div className="page-actions"><button type="button" className="btn primary" onClick={() => navigate("/account")}>Go to your account</button></div></section>;

  async function submit(e) {
    e.preventDefault();
    if (!emailOk(email) || !password) return setError("Enter your email and password.");
    if (leaving && !understood) return setError("Please confirm that you understand what happens to this anonymous session.");
    setError(""); setBusy(true);
    try { await signInWithEmail(email.trim(), password); notify("Signed in."); navigate("/account"); }
    catch (err) { console.error(err); setError(friendlyAuthError(err, "Couldn't sign you in. Please try again.")); setBusy(false); }
  }
  async function google() {
    if (leaving && !understood) return setError("Please confirm that you understand what happens to this anonymous session.");
    setError(""); setBusy(true);
    try { await signInWithGoogle(); notify("Signed in with Google."); navigate("/account"); }
    catch (err) { console.error(err); setError(friendlyAuthError(err, "Couldn't sign in with Google.")); setBusy(false); }
  }
  return <section className="account-narrow">
    <h1 className="account-title">Welcome back.</h1>
    <p className="account-lead">Sign in to reach your dashboard, journal and saved thoughts.</p>
    {leaving && <div className="notice open" role="note">
      <p><strong>You're using an anonymous session on this device.</strong> Signing in replaces it. Its writing stays public but you'll no longer be able to edit or delete it, and its private journal and saved items become unreachable. {countsSentence(counts)}</p>
      <p>To keep it, <button type="button" className="linklike" onClick={() => navigate("/register")}>create an account instead</button> (that links this session).</p>
      <label className="check"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand and want to sign in anyway</label>
    </div>}
    <form onSubmit={submit} noValidate className="account-form">
      <label className="field" htmlFor="si-email">Email</label>
      <input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="field" htmlFor="si-pass">Password</label>
      <input id="si-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <FieldError>{error}</FieldError>
      <div className="page-actions">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <GoogleButton onClick={google} busy={busy} label="Sign in with Google" />
      </div>
    </form>
    <p className="dialog-note"><button type="button" className="linklike" onClick={() => setForgot(true)}>Forgot your password?</button> · <button type="button" className="linklike" onClick={() => navigate("/register")}>Create an account</button></p>
    {forgot && <ForgotDialog initial={email} onClose={() => setForgot(false)} />}
  </section>;
}

export function ForgotDialog({ initial = "", onClose }) {
  const [email, setEmail] = useState(initial); const [sent, setSent] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function send() {
    if (!emailOk(email)) return setError("Enter the email you registered with.");
    setError(""); setBusy(true);
    try { await resetPassword(email.trim()); setSent(true); } // same message whether or not the email exists
    catch (err) { console.error(err); if (["auth/invalid-email", "auth/network-request-failed", "auth/too-many-requests"].includes(authCode(err))) setError(friendlyAuthError(err)); else setSent(true); }
    finally { setBusy(false); }
  }
  return <Dialog titleId="forgot-title" title="Reset your password" hint="We'll email you a link to choose a new one." onClose={onClose}>
    {sent ? <p className="dialog-hint" role="status">If an account exists for that email, a reset link is on its way. Check your spam folder too.</p> : <>
      <label className="field" htmlFor="forgot-email">Email</label>
      <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <FieldError>{error}</FieldError></>}
    <div className="dialog-foot"><button type="button" className="btn" onClick={onClose}>{sent ? "Close" : "Cancel"}</button>{!sent && <button type="button" className="btn primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>}</div>
  </Dialog>;
}
