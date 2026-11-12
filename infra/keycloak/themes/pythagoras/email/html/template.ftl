<#-- The frame around every HTML e-mail Keycloak sends (docs/design.md). Inline
     styles and tables only: e-mail programs ignore style sheets and SVG. -->
<#macro emailLayout>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<body style="margin:0;padding:0;background:#f3f5fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5fb;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dfe5f2;">
      <tr><td style="background:#0e1738;padding:22px 28px;font-family:'Segoe UI',Arial,sans-serif;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:#5480ff;vertical-align:middle;"></span>
        <span style="color:#ffffff;font-size:18px;font-weight:700;vertical-align:middle;margin-left:8px;">Pythagoras</span>
      </td></tr>
      <tr><td style="padding:28px;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6;color:#121a33;">
        <#nested>
      </td></tr>
      <tr><td style="padding:16px 28px 24px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#5a6587;border-top:1px solid #dfe5f2;">
        Pythagoras school group
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
</#macro>
