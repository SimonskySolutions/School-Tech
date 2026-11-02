"""Signs in to the production stack through the portal, as a browser would (M8.3).

Used by scripts/prod-stack-test.sh:
  python scripts/prod-signin-check.py <root.crt> <https port> <portal host> <users.json>

users.json: {"parent": {"email", "password", "name"}, "staff": {...}}

- A parent signs in with a password and is in the portal.
- Staff sign in with a password and are not in the portal until they have set
  up a one-time code; signing in again asks for the password and the code.
"""

import json
import sys
import time

import prod_portal
from prod_portal import Browser, check, form, in_portal, sign_in_with_password, totp

ca, port, portal, users_file = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
with open(users_file, encoding="utf-8") as f:
    users = json.load(f)
portal_url = f"https://{portal}:{port}"

parent = users["parent"]
where, page = sign_in_with_password(Browser(ca), portal_url, parent)
check(in_portal(where, page, portal, parent), "a parent signs in with a password alone")

staff = users["staff"]
browser = Browser(ca)
where, page = sign_in_with_password(browser, portal_url, staff)
setup = form(page, "kc-totp-settings-form")
check(where.hostname != portal and setup is not None, "staff are asked to set up a one-time code before the portal opens")
secret = None
if setup:
    action, hidden = setup
    secret = hidden.get("totpSecret", "")
    where, page = browser.open(
        action, {**hidden, "totp": totp(secret, time.time()), "userLabel": "Authenticator app"}
    )
    check(in_portal(where, page, portal, staff), "with the code set up, staff are in the portal")

if secret:
    browser = Browser(ca)
    where, page = sign_in_with_password(browser, portal_url, staff)
    otp = form(page, "kc-otp-login-form")
    check(otp is not None, "signing in again, staff are asked for the code after the password")
    if otp:
        action, hidden = otp
        # The next period's code: the one used for set-up may not be used twice.
        where, page = browser.open(action, {**hidden, "otp": totp(secret, time.time() + 30)})
        check(in_portal(where, page, portal, staff), "and the code lets them in")

sys.exit(1 if prod_portal.failures else 0)
