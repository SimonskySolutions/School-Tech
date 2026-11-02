<#-- The frame around every HTML e-mail Keycloak sends (docs/design.md). Inline
     styles and tables only: e-mail programs ignore style sheets and SVG. -->
<#macro emailLayout>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<body style="margin:0;padding:0;background:#f5f4fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4fa;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e3f1;">
      <tr><td style="background:#16132e;padding:22px 28px;font-family:'Segoe UI',Arial,sans-serif;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:#7459ff;vertical-align:middle;"></span>
        <span style="color:#ffffff;font-size:18px;font-weight:700;vertical-align:middle;margin-left:8px;">Pythagoras</span>
      </td></tr>
      <tr><td style="padding:28px;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1a2e;">
        <#nested>
      </td></tr>
      <tr><td style="padding:16px 28px 24px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#74719a;border-top:1px solid #e6e3f1;">
        Pythagoras school group
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
</#macro>
