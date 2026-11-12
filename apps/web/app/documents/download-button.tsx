/** A download button (ADR 0029): asks for a single-use link and follows it. */
export function DownloadButton({
  versionId,
  back,
  label,
}: {
  versionId: string;
  back: string;
  label: string;
}) {
  return (
    <form method="post" action="/documents/download" style={{ display: 'inline', marginLeft: '0.5rem' }}>
      <input type="hidden" name="version_id" value={versionId} />
      <input type="hidden" name="back" value={back} />
      <button type="submit">{label}</button>
    </form>
  );
}
