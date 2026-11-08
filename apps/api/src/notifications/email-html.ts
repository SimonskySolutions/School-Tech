import { type RenderedMessage } from './templates';

// The HTML part of every message (docs/design.md), made from the plain text the
// template wrote (ADR 0031), so the two parts can never say different things.
// Inline styles and tables only: e-mail programs ignore style sheets, scripts
// and SVG. The link to the portal becomes a button; nothing else is added.

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const FONT = "font-family:'Segoe UI',Arial,sans-serif;";

/** "Label (sign in first): https://portal/…" on a line of its own. */
const PORTAL_LINK = /^(.+?): (https?:\/\/\S+)$/;

function paragraph(block: string, portal: string): string {
  const lines = block.split('\n');
  const link = lines.length === 1 ? PORTAL_LINK.exec(lines[0]!) : null;
  if (link && link[2]!.startsWith(portal)) {
    const [, label, url] = link;
    return `<p style="margin:22px 0 6px;"><a href="${escape(url!)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#2f5bf5;color:#ffffff;font-weight:600;text-decoration:none;">${escape(label!)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#5a6587;">Or open ${escape(url!)}</p>`;
  }
  return `<p style="margin:0 0 14px;">${lines.map(escape).join('<br>')}</p>`;
}

export function emailHtml(message: RenderedMessage, portal: string): string {
  const body = message.text
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== '')
    .map((block) => paragraph(block, portal))
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(message.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f5fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5fb;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;border:1px solid #dfe5f2;">
<tr><td style="background:#0e1738;border-radius:18px 18px 0 0;padding:22px 28px;${FONT}">
<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:#5480ff;vertical-align:middle;"></span>
<span style="color:#ffffff;font-size:18px;font-weight:700;vertical-align:middle;margin-left:8px;">Pythagoras</span>
</td></tr>
<tr><td style="padding:28px;${FONT}font-size:15px;line-height:1.6;color:#121a33;">
<h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#0e1738;">${escape(message.subject)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 28px 24px;${FONT}font-size:12px;line-height:1.5;color:#5a6587;border-top:1px solid #dfe5f2;">
Pythagoras school group. You receive this because of your Pythagoras account; choose which messages you get under Notifications in the portal.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
