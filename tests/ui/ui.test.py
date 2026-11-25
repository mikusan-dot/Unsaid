"""Browser tests (Chromium) against the real app bundled with Firebase stand-ins. Two tabs = two sessions on one shared backend.
Run: node tests/ui/build.mjs && python3 tests/ui/serve.py 5199 &  then  python3 tests/ui/ui.test.py"""
import json, re, sys, os
from playwright.sync_api import sync_playwright, expect
BASE = "http://127.0.0.1:5199"; SHOTS = "/tmp/shots"; os.makedirs(SHOTS, exist_ok=True)
results = []
def check(name, fn):
    try: fn(); results.append((name, True, "")); print("PASS", name)
    except Exception as e: results.append((name, False, str(e)[:300])); print("FAIL", name, "->", str(e)[:300])
sess = lambda p: p.evaluate("sessionStorage.getItem('fakeSession')")
db = lambda p: json.loads(p.evaluate("localStorage.getItem('fakeDB')") or '{"docs":{}}')["docs"]
def toast(p, text): expect(p.locator(".toast")).to_contain_text(text, timeout=6000)
def go(p, path): p.goto(BASE + path); p.wait_for_load_state("domcontentloaded")

with sync_playwright() as pw:
    browser = pw.chromium.launch(); ctx = browser.new_context(viewport={"width": 1100, "height": 900})
    ctx.add_init_script("window.__fakeGoogle = {email:'goog@example.com', id:'G-A'};")
    errors = []
    A = ctx.new_page(); A.on("pageerror", lambda e: errors.append(str(e))); A.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text and "auth/" not in m.text else None)  # handled, deliberately provoked auth errors are logged by the app and ignored here

    # ---------- anonymous browsing / posting ----------
    go(A, "/")
    check("anonymous browsing creates no session", lambda: (expect(A.locator("h1").first).to_contain_text("Say what you haven't said"), None) and sess(A) is None or sess(A) is None)
    check("account button present in top bar and sidebar", lambda: (expect(A.get_by_label("Account and sign in")).to_be_visible(), expect(A.get_by_role("button", name="My account")).to_be_visible()))
    A.get_by_label("Write anonymously").click(); A.locator("#thought").fill("An anonymous thought written before any account exists."); A.get_by_role("button", name="Share anonymously").click()
    toast(A, "Shared anonymously"); UID = sess(A)
    check("anonymous posting creates an anonymous session", lambda: (_ for _ in ()).throw(AssertionError("no session")) if not UID else None)
    A.locator(".post").first.get_by_role("button", name="Save").click(); toast(A, "Saved")
    go(A, "/journal"); A.get_by_role("button", name="New entry").click(); A.locator("#entry-body").fill("Private journal text."); A.get_by_role("button", name="Save entry").click(); toast(A, "Saved to your journal")
    go(A, "/account")
    check("dashboard shows real counts + anonymous warning", lambda: (expect(A.locator(".tile").nth(0)).to_contain_text("1"), expect(A.locator(".tile").nth(5)).to_contain_text("1"), expect(A.locator(".tile").nth(6)).to_contain_text("1"), expect(A.get_by_text("This is an anonymous session")).to_be_visible(), expect(A.get_by_text("Recent activity")).to_be_visible()))
    A.screenshot(path=f"{SHOTS}/dash-anon-dark.png")

    # ---------- registration + linking ----------
    A.get_by_role("button", name="Secure this session").click(); expect(A).to_have_url(re.compile("/register"))
    check("register page explains linking and shows counts", lambda: expect(A.get_by_text("links it")).to_be_visible())
    A.locator("#reg-email").fill("not-an-email"); A.locator("#reg-pass").fill("hunter22"); A.locator("#reg-confirm").fill("hunter22"); A.get_by_role("button", name="Create account").click()
    check("register validates email", lambda: expect(A.locator(".field-error")).to_contain_text("valid email"))
    A.locator("#reg-email").fill("me@example.com"); A.locator("#reg-confirm").fill("different1"); A.get_by_role("button", name="Create account").click()
    check("register validates matching passwords", lambda: expect(A.locator(".field-error")).to_contain_text("don't match"))
    A.locator("#reg-confirm").fill("hunter22"); A.get_by_role("button", name="Create account").click(); toast(A, "Everything you wrote is still yours")
    expect(A).to_have_url(re.compile("/account$"))
    check("UID preserved after email linking", lambda: (_ for _ in ()).throw(AssertionError(f"{UID} != {sess(A)}")) if sess(A) != UID else None)
    check("post, bookmark, journal still counted after linking", lambda: (expect(A.locator(".tile").nth(0)).to_contain_text("1"), expect(A.locator(".tile").nth(5)).to_contain_text("1"), expect(A.locator(".tile").nth(6)).to_contain_text("1")))
    check("anonymous warning gone, verify-email prompt shown", lambda: (expect(A.get_by_text("This is an anonymous session")).to_have_count(0), expect(A.get_by_text("Verify your email")).to_be_visible()))
    check("owner row for original post still points at same uid", lambda: (_ for _ in ()).throw(AssertionError("owner mismatch")) if not any(v.get("uid") == UID for k, v in db(A).items() if k.startswith("postOwners/")) else None)

    # ---------- my activity ----------
    A.get_by_role("button", name="Posts", exact=True).first.click() if False else go(A, "/account/posts")
    check("My posts lists the post with category and time", lambda: (expect(A.locator(".post").first).to_contain_text("An anonymous thought"), expect(A.locator(".post").first).to_contain_text("Thoughts")))
    A.get_by_label("Edit").first.click(); A.locator("#ed-text").fill("Edited thought text that is long enough."); A.get_by_role("button", name="Save changes").click(); toast(A, "Changes saved")
    check("editing an owned post updates it in place", lambda: (expect(A.locator(".post").first).to_contain_text("Edited thought text"), expect(A.locator(".post").first).to_contain_text("edited")))
    go(A, "/account/saved"); check("Saved lists the bookmark; removing works", lambda: expect(A.locator(".post")).to_have_count(1))
    A.get_by_label("Remove from saved").click(); toast(A, "Removed from saved"); check("saved empty state", lambda: expect(A.get_by_text("Nothing saved yet")).to_be_visible())
    go(A, "/account/letters"); check("empty state on My letters", lambda: expect(A.get_by_text("You haven't published a letter yet.")).to_be_visible())
    check("Private journal tile links to the existing journal", lambda: (go(A, "/account"), A.locator(".tile").nth(6).click(), expect(A).to_have_url(re.compile("/journal")), expect(A.get_by_text("Private journal text.")).to_be_visible()))

    # ---------- settings ----------
    go(A, "/account/settings")
    check("settings show account type, email, created date", lambda: (expect(A.get_by_text("Registered account")).to_be_visible(), expect(A.get_by_text("me@example.com").first).to_be_visible(), expect(A.locator(".facts")).to_contain_text("Created")))
    A.locator("#pf-name").fill("Night owl"); A.get_by_role("button", name="Save nickname").click(); toast(A, "Saved")
    A.locator("#pr-theme").select_option("light"); A.locator("#pr-sort").select_option("Trending"); A.get_by_role("button", name="Save preferences").click(); toast(A, "Saved")
    check("theme preference applied immediately", lambda: expect(A.locator("html")).to_have_attribute("data-theme", "light"))
    A.screenshot(path=f"{SHOTS}/settings-light.png", full_page=True)
    A.evaluate("localStorage.removeItem('unsaid-theme')"); go(A, "/account")
    check("preferences + nickname persist across reload", lambda: (expect(A.locator("html")).to_have_attribute("data-theme", "light"), expect(A.get_by_text("Hello, Night owl.")).to_be_visible()))
    check("no email or password is stored in any Firestore document", lambda: (_ for _ in ()).throw(AssertionError("leak")) if any(("me@example.com" in json.dumps(v) or "hunter22" in json.dumps(v)) for v in db(A).values()) else None)

    # ---------- security ----------
    go(A, "/account/security")
    A.locator("#pw-cur").fill("wrong-pass"); A.locator("#pw-new").fill("newpass99"); A.locator("#pw-again").fill("newpass99"); A.get_by_role("button", name="Change password").click()
    check("wrong current password rejected", lambda: expect(A.locator(".field-error")).to_contain_text("incorrect"))
    A.locator("#pw-cur").fill("hunter22"); A.get_by_role("button", name="Change password").click(); toast(A, "Password changed")
    A.get_by_role("button", name="Email me a reset link").click(); toast(A, "Reset link sent")
    check("reset mail recorded", lambda: (_ for _ in ()).throw(AssertionError("no mail")) if not any(m["type"] == "reset" for m in json.loads(A.evaluate("localStorage.getItem('fakeMail')"))) else None)

    # ---------- second session (tab B): isolation + collision ----------
    B = ctx.new_page(); B.on("pageerror", lambda e: errors.append(str(e)))
    go(B, "/"); B.get_by_label("Write anonymously").click(); B.locator("#thought").fill("A different person's anonymous thought here."); B.get_by_role("button", name="Share anonymously").click(); toast(B, "Shared anonymously")
    UB = sess(B); check("tab B is a distinct session", lambda: (_ for _ in ()).throw(AssertionError("same")) if UB == UID else None)
    go(B, "/account")
    check("B's dashboard shows only B's data (A's items absent)", lambda: (expect(B.locator(".tile").nth(0)).to_contain_text("1"), expect(B.locator(".tile").nth(6)).to_contain_text("0"), expect(B.locator("body")).not_to_contain_text("Edited thought text")))
    go(B, "/account/posts"); check("B's My posts excludes A's post", lambda: (expect(B.locator(".post")).to_have_count(1), expect(B.locator(".post").first).to_contain_text("different person")))
    go(B, "/register"); B.locator("#reg-email").fill("me@example.com"); B.locator("#reg-pass").fill("hunter22"); B.locator("#reg-confirm").fill("hunter22"); B.get_by_role("button", name="Create account").click()
    check("email collision shows dialog and leaves B's anonymous session intact", lambda: (expect(B.get_by_text("That email already has an account")).to_be_visible(), (_ for _ in ()).throw(AssertionError("session changed")) if sess(B) != UB else None))
    B.get_by_role("button", name="Use a different email").click()
    go(B, "/register"); B.get_by_role("button", name="Continue with Google").click(); toast(B, "Google account linked"); 
    check("Google linking preserves B's uid", lambda: (_ for _ in ()).throw(AssertionError("uid changed")) if sess(B) != UB else None)
    # a third anonymous tab that tries the same Google account -> collision, confirm dialog, no silent switch
    Cc = ctx.new_page(); go(Cc, "/"); Cc.get_by_label("Write anonymously").click(); Cc.locator("#thought").fill("Third anonymous visitor writing something."); Cc.get_by_role("button", name="Share anonymously").click(); toast(Cc, "Shared anonymously"); UC = sess(Cc)
    go(Cc, "/register"); Cc.get_by_role("button", name="Continue with Google").click()
    check("Google collision asks before switching and keeps the session", lambda: (expect(Cc.get_by_text("already has an UNSAID account")).to_be_visible(), (_ for _ in ()).throw(AssertionError("silently switched")) if sess(Cc) != UC else None))
    Cc.get_by_role("button", name="Cancel").click(); check("cancelling leaves session untouched", lambda: (_ for _ in ()).throw(AssertionError("changed")) if sess(Cc) != UC else None)
    go(Cc, "/signin")
    check("sign-in warns an anonymous session will be replaced and requires confirmation", lambda: (expect(Cc.get_by_text("Signing in replaces it")).to_be_visible()))
    Cc.locator("#si-email").fill("me@example.com"); Cc.locator("#si-pass").fill("newpass99"); Cc.get_by_role("button", name="Sign in", exact=True).click()
    check("sign-in blocked until the warning is acknowledged", lambda: (expect(Cc.locator(".field-error")).to_contain_text("confirm"), (_ for _ in ()).throw(AssertionError("signed in")) if sess(Cc) != UC else None))
    Cc.get_by_label("I understand and want to sign in anyway").check(); Cc.get_by_role("button", name="Sign in", exact=True).click(); expect(Cc).to_have_url(re.compile("/account$"))
    check("after confirmed sign-in, C is A's account with A's data", lambda: (_ for _ in ()).throw(AssertionError("wrong uid")) if sess(Cc) != UID else None)
    Cc.close()

    # ---------- sign out / sign in ----------
    go(A, "/account/security"); A.get_by_role("button", name="Sign out").click(); toast(A, "Signed out")
    go(A, "/account"); check("signed-out /account is welcoming, not a wall", lambda: (expect(A.get_by_text("No account needed.")).to_be_visible(), expect(A.get_by_role("button", name="Keep browsing")).to_be_visible()))
    go(A, "/"); check("public feed still readable when signed out", lambda: expect(A.locator(".post").first).to_be_visible())
    go(A, "/signin"); A.get_by_role("button", name="Forgot your password?").click(); A.locator("#forgot-email").fill("nobody@example.com"); A.get_by_role("button", name="Send reset link").click()
    check("forgot password gives a neutral message", lambda: expect(A.get_by_text("If an account exists")).to_be_visible()); A.locator("button.btn", has_text="Close").click()
    A.locator("#si-email").fill("me@example.com"); A.locator("#si-pass").fill("bad-bad-bad"); A.get_by_role("button", name="Sign in", exact=True).click()
    check("bad credentials show a clear error", lambda: expect(A.locator(".field-error")).to_contain_text("incorrect"))
    A.locator("#si-pass").fill("newpass99"); A.get_by_role("button", name="Sign in", exact=True).click(); expect(A).to_have_url(re.compile("/account$"))
    check("sign-in returns the same uid and data", lambda: (_ for _ in ()).throw(AssertionError("uid")) if sess(A) != UID else expect(A.locator(".tile").nth(0)).to_contain_text("1"))

    # ---------- mobile + themes ----------
    M = ctx.new_page(); M.set_viewport_size({"width": 390, "height": 800}); M.add_init_script(f"sessionStorage.setItem('fakeSession','{UID}')"); go(M, "/account")
    expect(M.locator(".tile").first).to_be_visible(timeout=6000)
    check("mobile: dashboard has no horizontal overflow", lambda: (_ for _ in ()).throw(AssertionError("overflow")) if M.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1") else None)
    for path in ["/account/settings", "/account/security", "/account/posts", "/register"]:
        go(M, path); M.wait_for_timeout(400)
        check(f"mobile: no horizontal overflow on {path}", lambda: (_ for _ in ()).throw(AssertionError("overflow")) if M.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1") else None)
    go(M, "/account"); M.wait_for_timeout(400); M.screenshot(path=f"{SHOTS}/dash-mobile.png")
    M.evaluate("document.documentElement.dataset.theme='dark'"); M.screenshot(path=f"{SHOTS}/dash-mobile-dark.png")
    M.close()

    # ---------- deletion ----------
    go(A, "/account/security"); A.get_by_role("button", name="Delete account…").click()
    check("delete dialog explains scope and limits", lambda: (expect(A.get_by_text("Always removed:")).to_be_visible(), expect(A.get_by_text("Limits:")).to_be_visible()))
    A.screenshot(path=f"{SHOTS}/delete-dialog.png")
    A.get_by_role("button", name="Delete my account").click(); check("deletion needs the confirmation word", lambda: expect(A.locator(".field-error")).to_contain_text("DELETE"))
    A.locator("#del-type").fill("DELETE"); A.get_by_role("button", name="Delete my account").click(); check("deletion needs the password", lambda: expect(A.locator(".field-error")).to_contain_text("password"))
    A.locator("#del-pass").fill("newpass99"); A.get_by_role("button", name="Delete my account").click()
    check("deletion completes and reports honestly", lambda: (expect(A.get_by_text("Your account was deleted")).to_be_visible(timeout=8000), expect(A.get_by_text("can't be located without scanning")).to_be_visible()))
    d = db(A)
    check("private docs removed; public post kept but unowned; B's data intact", lambda: (_ for _ in ()).throw(AssertionError(str([k for k in d if UID in k or d[k].get("uid") == UID]))) if any((k.startswith(("users/", "journals/")) and UID in k) or d[k].get("uid") == UID for k in d) or not any(k.startswith("posts/") for k in d) or not any(v.get("uid") == UB for k, v in d.items() if k.startswith("postOwners/")) else None)
    A.get_by_role("button", name="Done").click(); expect(A).to_have_url(BASE + "/")
    check("session ended after deletion", lambda: (_ for _ in ()).throw(AssertionError("still signed in")) if sess(A) else None)
    check("no uncaught page errors during the run", lambda: (_ for _ in ()).throw(AssertionError("; ".join(errors[:3]))) if errors else None)
    browser.close()
bad = [r for r in results if not r[1]]; print(f"\n{len(results)-len(bad)}/{len(results)} passed"); sys.exit(1 if bad else 0)
