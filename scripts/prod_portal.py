"""Talking to the production stack through its gateway, as a browser would.

Shared by scripts/prod-signin-check.py (M8.3) and scripts/prod-purchase-check.py
(M8.8). Every request goes to the gateway on 127.0.0.1 with the real host
name, and certificates are checked against the gateway's local authority.
"""

import hashlib
import hmac
import html
import http.client
import http.cookiejar
import re
import socket
import ssl
import struct
import urllib.parse
import urllib.request

failures = 0


def check(condition, label):
    global failures
    print(("ok - " if condition else "not ok - ") + label)
    if not condition:
        failures += 1


def gateway(ca):
    """An HTTPS handler that connects to the gateway on this machine whatever the host name says."""
    context = ssl.create_default_context(cafile=ca)

    class GatewayConnection(http.client.HTTPSConnection):
        def connect(self):
            sock = socket.create_connection(("127.0.0.1", self.port), self.timeout)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

    class GatewayHandler(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(GatewayConnection, req, context=context)

    return GatewayHandler()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Leaves redirects to the caller: a payment provider's page is not the gateway's."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Browser:
    def __init__(self, ca):
        self.ca = ca
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(gateway(ca), urllib.request.HTTPCookieProcessor(self.cookies))
        self.stay = urllib.request.build_opener(
            gateway(ca), urllib.request.HTTPCookieProcessor(self.cookies), NoRedirect()
        )

    def open(self, url, form=None):
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        with self.opener.open(urllib.request.Request(url, data=data), timeout=30) as response:
            return urllib.parse.urlsplit(response.geturl()), response.read().decode("utf-8", "replace")

    def post_without_following(self, url, fields, headers):
        """Posts a form (fields: pairs, names may repeat); returns the status and Location."""
        request = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), headers=headers)
        try:
            with self.stay.open(request, timeout=30) as response:
                return response.status, response.headers.get("Location")
        except urllib.error.HTTPError as error:
            return error.code, error.headers.get("Location")


def form(page, form_id=None, testid=None):
    """The action and hidden fields of the form with this id (or data-testid), or None."""
    attribute = 'id="%s"' % re.escape(form_id) if form_id else 'data-testid="%s"' % re.escape(testid)
    match = re.search(r"<form\b[^>]*\b%s[^>]*>(.*?)</form>" % attribute, page, re.S)
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


def sign_in_with_password(browser, portal_url, user):
    where, page = browser.open(f"{portal_url}/auth/sign-in")
    login = form(page, "kc-form-login")
    if not login:
        return where, page
    action, hidden = login
    return browser.open(action, {**hidden, "username": user["email"], "password": user["password"]})


def in_portal(where, page, portal, user):
    return where.hostname == portal and where.path == "/" and "error=" not in where.query and user["name"] in page
