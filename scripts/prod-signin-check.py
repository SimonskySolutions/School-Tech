"""Signs in to the production stack through the portal, as a browser would (M8.3).

Used by scripts/prod-stack-test.sh:
  python scripts/prod-signin-check.py <root.crt> <https port> <portal host> <users.json>

users.json: {"parent": {"email", "password", "name"}, "staff": {...}}

- A parent signs in with a password and is in the portal.
- Staff sign in with a password and are not in the portal until they have set
  up a one-time code; signing in again asks for the password and the code.
Every request goes to the gateway on 127.0.0.1 with the real host name, and
certificates are checked against the gateway's local authority.
"""

import base64
import hashlib
import hmac
import html
import http.client
import http.cookiejar
import json
import re
import socket
import ssl
import struct
import sys
import time
import urllib.parse
import urllib.request

ca, port, portal, users_file = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
with open(users_file, encoding="utf-8") as f:
    users = json.load(f)
context = ssl.create_default_context(cafile=ca)
failures = 0


def check(condition, label):
    global failures
    print(("ok - " if condition else "not ok - ") + label)
    if not condition:
        failures += 1


class GatewayConnection(http.client.HTTPSConnection):
    """Connects to the gateway on this machine whatever the host name says."""

    def connect(self):
        sock = socket.create_connection(("127.0.0.1", self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class GatewayHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(GatewayConnection, req, context=context)


class Browser:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            GatewayHandler(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def open(self, url, form=None):
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        with self.opener.open(urllib.request.Request(url, data=data), timeout=30) as response:
            return urllib.parse.urlsplit(response.geturl()), response.read().decode("utf-8", "replace")


def form(page, form_id):
    """The action and hidden fields of the form with this id, or None."""
    match = re.search(r'<form\b[^>]*\bid="%s"[^>]*>(.*?)</form>' % re.escape(form_id), page, re.S)
    if not match:
        return None
    action = re.search(r'\baction="([^"]+)"', match.group(0)).group(1)
    hidden = {
        html.unescape(name): html.unescape(value)
        for name, value in re.findall(
            r'<input\b[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', match.group(1)
        )
    }
    return html.unescape(action), hidden


def totp(secret, at):
    """RFC 6238 code for Keycloak's raw secret (HMAC-SHA1, 6 digits, 30 seconds)."""
    digest = hmac.new(secret.encode(), struct.pack(">Q", int(at // 30)), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return "%06d" % ((struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000)


def sign_in_with_password(browser, user):
    where, page = browser.open(f"https://{portal}:{port}/auth/sign-in")
    login = form(page, "kc-form-login")
    if not login:
        return where, page
    action, hidden = login
    return browser.open(action, {**hidden, "username": user["email"], "password": user["password"]})


def in_portal(where, page, user):
    return where.hostname == portal and where.path == "/" and "error=" not in where.query and user["name"] in page


parent = users["parent"]
where, page = sign_in_with_password(Browser(), parent)
check(in_portal(where, page, parent), "a parent signs in with a password alone")

staff = users["staff"]
browser = Browser()
where, page = sign_in_with_password(browser, staff)
setup = form(page, "kc-totp-settings-form")
check(where.hostname != portal and setup is not None, "staff are asked to set up a one-time code before the portal opens")
secret = None
if setup:
    action, hidden = setup
    secret = hidden.get("totpSecret", "")
    where, page = browser.open(
        action, {**hidden, "totp": totp(secret, time.time()), "userLabel": "Authenticator app"}
    )
    check(in_portal(where, page, staff), "with the code set up, staff are in the portal")

if secret:
    browser = Browser()
    where, page = sign_in_with_password(browser, staff)
    otp = form(page, "kc-otp-login-form")
    check(otp is not None, "signing in again, staff are asked for the code after the password")
    if otp:
        action, hidden = otp
        # The next period's code: the one used for set-up may not be used twice.
        where, page = browser.open(action, {**hidden, "otp": totp(secret, time.time() + 30)})
        check(in_portal(where, page, staff), "and the code lets them in")

sys.exit(1 if failures else 0)
