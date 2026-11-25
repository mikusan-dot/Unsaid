import React, { useEffect, useState } from "react";
import { describeUser, onAccountChange } from "../../services/auth/account";
import { fetchProfile } from "../../services/account/profile";
import { NeedsFirebase, Tabs } from "../shared/ui";
import { RegisterPage, SignInPage } from "./AuthPages";
import DashboardPage from "./DashboardPage";
import ActivityPage, { SavedPage, ACTIVITY } from "./ActivityPage";
import SettingsPage from "./SettingsPage";
import SecurityPage, { DeletedDialog } from "./SecurityPage";

const TABS = [{ value: "", label: "Dashboard" }, { value: "activity", label: "My activity" }, { value: "settings", label: "Settings" }, { value: "security", label: "Security" }];
const tabFor = (section) => (!section ? "" : section === "settings" || section === "security" ? section : "activity");

export default function AccountApp(props) {
  const [deleted, setDeleted] = useState(null);
  return <>
    <AccountRoutes {...props} onDeleted={setDeleted} />
    {deleted && <DeletedDialog result={deleted} onDone={() => { setDeleted(null); props.notify("Account deleted."); props.navigate("/"); }} />}
  </>;
}

function AccountRoutes({ page, section, configured, user, ensureUser, notify, navigate, applyPrefs, onDeleted }) {
  const [, setTick] = useState(0);
  useEffect(() => onAccountChange(() => setTick((t) => t + 1)), []);
  const info = describeUser(user); // cheap; recomputed every render because Firebase mutates the User object in place
  const [profile, setProfile] = useState(null);
  useEffect(() => { let on = true; setProfile(null); if (user) fetchProfile(user.uid).then((p) => on && setProfile(p)).catch((e) => console.error("profile load failed", e)); return () => { on = false; }; }, [user?.uid]);

  if (!configured) return <NeedsFirebase name="Accounts" />;
  if (page === "signin") return <SignInPage user={user} notify={notify} navigate={navigate} />;
  if (page === "register") return <RegisterPage user={user} notify={notify} navigate={navigate} />;

  if (!user) return <section className="account-narrow">
    <h1 className="account-title">No account needed.</h1>
    <p className="account-lead">You can read and write on UNSAID without signing up. Create an account only if you want your dashboard, journal and saved thoughts to follow you across devices.</p>
    <div className="page-actions"><button type="button" className="btn primary" onClick={() => navigate("/register")}>Create an account</button><button type="button" className="btn" onClick={() => navigate("/signin")}>Sign in</button><button type="button" className="btn" onClick={() => navigate("/")}>Keep browsing</button></div>
  </section>;

  const go = (v) => navigate(v === "" ? "/account" : v === "activity" ? "/account/posts" : `/account/${v}`);
  const known = !section || section === "settings" || section === "security" || section === "saved" || ACTIVITY[section];
  return <>
    <nav aria-label="Account" className="account-tabs"><Tabs label="Account sections" value={tabFor(section)} options={TABS} onChange={go} /></nav>
    {tabFor(section) === "activity" && <Tabs label="My activity" value={section} onChange={(v) => navigate(`/account/${v}`)} options={[...Object.entries(ACTIVITY).map(([value, c]) => ({ value, label: c.title.replace("My ", "") })), { value: "saved", label: "Saved" }]} />}
    {!known ? <div className="empty"><h3>Page not found</h3><button type="button" className="btn" onClick={() => navigate("/account")}>Back to your account</button></div>
      : !section ? <DashboardPage user={info} profile={profile} navigate={navigate} />
      : section === "settings" ? <SettingsPage user={info} profile={profile} onProfile={setProfile} applyPrefs={applyPrefs} notify={notify} navigate={navigate} />
      : section === "security" ? <SecurityPage user={info} notify={notify} navigate={navigate} onDeleted={onDeleted} />
      : section === "saved" ? <SavedPage user={info} navigate={navigate} notify={notify} />
      : <ActivityPage key={section} section={section} user={info} navigate={navigate} notify={notify} />}
  </>;
}
