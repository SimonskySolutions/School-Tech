import { describe, expect, it } from 'vitest';
import { emailHtml } from './email-html';

const PORTAL = 'https://portal.example.test';

describe('emailHtml', () => {
  it('says what the text says, with the portal link as a button', () => {
    const html = emailHtml(
      {
        subject: 'Payment received: order PY-00001234',
        text: `Dear Anna Ivanova,\n\nWe have received your payment.\nYour bookings are confirmed.\n\nSee the order (sign in first): ${PORTAL}/orders/1`,
      },
      PORTAL,
    );
    expect(html).toContain(
      '<h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#0e1738;">Payment received',
    );
    expect(html).toContain('<p style="margin:0 0 14px;">Dear Anna Ivanova,</p>');
    expect(html).toContain('We have received your payment.<br>Your bookings are confirmed.');
    expect(html).toMatch(
      new RegExp(`<a href="${PORTAL}/orders/1"[^>]*>See the order \\(sign in first\\)</a>`),
    );
  });

  it('escapes what people typed, such as a document title', () => {
    const html = emailHtml(
      { subject: 'Approve <b>"Rota"</b>', text: 'Title: <script>x</script> & more' },
      PORTAL,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&#60;script&#62;x&#60;/script&#62; &#38; more');
  });

  it('makes a button only of links into the portal', () => {
    const html = emailHtml({ subject: 'S', text: 'Elsewhere: https://other.example.test/x' }, PORTAL);
    expect(html).not.toContain('<a ');
    expect(html).toContain('Elsewhere: https://other.example.test/x');
  });
});
