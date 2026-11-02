"""A family's purchase on the production stack, through the portal (M8.8).

Used by scripts/prod-stack-test.sh, after scripts/prod-stack-fixture.sql:
  python scripts/prod-purchase-check.py book|paid <root.crt> <https port> <portal host> <api host>
      <users.json> <webhook secret file> -- <command that runs one SQL query, given as its last argument>

- The parent sees the chess club for their child and books it through the
  booking form; the portal sends them to Stripe's hosted checkout.
- The API created the checkout with the Stripe stand-in (infra/stripe-standin),
  which sends no webhooks: this check sends checkout.session.completed itself,
  signed with the webhook secret as Stripe signs it.
- A badly signed event is refused, the same event twice is stored once, and the
  worker marks the order paid: the parent's order page says so.

"paid" only signs the parent in and checks that the order page still shows the
order paid: after a rollback, with the previous release's applications.
"""

import hashlib
import hmac
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

import prod_portal
from prod_portal import Browser, check, gateway, in_portal, sign_in_with_password

mode, ca, port, portal, api, users_file, secret_file = sys.argv[1:8]
query_command = sys.argv[sys.argv.index("--") + 1 :]
port = int(port)
with open(users_file, encoding="utf-8") as f:
    parent = json.load(f)["parent"]
with open(secret_file, encoding="utf-8") as f:
    webhook_secret = f.read().strip()
portal_url = f"https://{portal}:{port}"
CHILD = "c8000000-0000-7000-8000-000000000003"
CHESS = "d8000000-0000-7000-8000-000000000002"


def sql(query):
    result = subprocess.run(query_command + [query], capture_output=True, text=True, encoding="utf-8", check=True)
    return result.stdout.strip()


def webhook(event, signature=None):
    """Posts an event to the API as Stripe would; returns the status and the answer."""
    body = json.dumps(event).encode()
    stamp = int(time.time())
    mac = hmac.new(webhook_secret.encode(), b"%d." % stamp + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        f"https://{api}:{port}/webhooks/stripe",
        data=body,
        headers={"content-type": "application/json", "stripe-signature": signature or f"t={stamp},v1={mac}"},
    )
    try:
        with urllib.request.build_opener(gateway(ca)).open(request, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, None


def order_page_shows_paid(group, label_wanted="Paid", attempts=60):
    label = ""
    for _ in range(attempts):
        _, page = browser.open(f"{portal_url}/orders/{group}")
        found = re.search(r'data-testid="order-status">([^<]*)<', page)
        label = found.group(1) if found else ""
        if label == label_wanted:
            break
        time.sleep(2)
    check(label == label_wanted, f"the parent's order page shows it paid (shows '{label}')")


browser = Browser(ca)
where, page = sign_in_with_password(browser, portal_url, parent)
check(in_portal(where, page, portal, parent), "the parent signs in")
if mode == "paid":
    order_page_shows_paid(sql("SELECT checkout_group_id FROM commerce.customer_order"), attempts=1)
    sys.exit(1 if prod_portal.failures else 0)

_, page = browser.open(f"{portal_url}/services")
check(
    "Chess club, School E" in page and re.search(r"60[.,]00", page) is not None,
    "the parent sees the chess club for their child at 60.00 a term",
)
booking = prod_portal.form(page, testid="booking-form")
check(booking is not None and f'value="{CHILD}|{CHESS}"' in page, "the booking form offers it")
if booking is None:
    sys.exit(1)
action, hidden = booking
status, location = browser.post_without_following(
    f"{portal_url}{action}",
    [("idempotency_key", hidden["idempotency_key"]), ("activity", f"{CHILD}|{CHESS}")],
    {"origin": portal_url},
)
check(
    status == 303 and (location or "").startswith("https://checkout.stripe.com/"),
    f"booking sends the parent to Stripe's checkout (answered {status} {location})",
)

row = sql(
    "SELECT o.checkout_group_id || ' ' || o.status || ' ' || p.provider_checkout_id || ' ' || p.amount_minor"
    " || ' ' || p.currency FROM commerce.customer_order o JOIN commerce.payment p ON p.order_id = o.id"
    " JOIN people.person a ON a.id = o.payer_person_id WHERE a.email = 'parent@example.bg'"
)
check(len(row.splitlines()) == 1, "one order with one payment is placed for the parent")
group, order_status, checkout_id, amount, currency = (row.split() + [""] * 5)[:5]
check(
    order_status != "paid" and checkout_id.startswith("cs_") and amount == "6000" and currency == "EUR",
    f"it waits for payment of 60.00 EUR, with a checkout made at the stand-in ({order_status} {checkout_id} {amount} {currency})",
)

event = {
    "id": "evt_production_check_1",
    "object": "event",
    "type": "checkout.session.completed",
    "created": int(time.time()),
    "livemode": False,
    "data": {
        "object": {
            "id": checkout_id,
            "object": "checkout.session",
            "amount_total": int(amount or 0),
            "currency": currency.lower(),
            "payment_status": "paid",
            "payment_intent": "pi_production_check_1",
        }
    },
}
status, _ = webhook(event, signature=f"t={int(time.time())},v1={'0' * 64}")
check(status == 400, f"an event with a wrong signature is refused (answered {status})")
status, answer = webhook(event)
check(status == 200 and answer == {"received": True, "duplicate": False}, f"Stripe's event is accepted ({status} {answer})")
status, answer = webhook(event)
check(status == 200 and answer == {"received": True, "duplicate": True}, f"the same event again is a duplicate ({status} {answer})")

order_page_shows_paid(group)
check(
    sql(
        "SELECT o.status || ' ' || (o.paid_at IS NOT NULL) || ' ' || p.status FROM commerce.customer_order o"
        f" JOIN commerce.payment p ON p.order_id = o.id WHERE o.checkout_group_id = '{group}'"
    )
    == "paid true succeeded",
    "the order and its payment are recorded as paid, once",
)

sys.exit(1 if prod_portal.failures else 0)
