/** The outcome of the last set-up action, from the address the action returned to. */
export function Notice({
  params,
  done,
}: {
  params: Record<string, string | string[] | undefined>;
  done: Record<string, string>;
}) {
  const error = typeof params.error === 'string' ? params.error : null;
  const finished = typeof params.done === 'string' ? (done[params.done] ?? null) : null;
  if (error) {
    return (
      <p role="alert" data-testid="admin-error" style={{ color: '#9b1c1c' }}>
        {`Not done: ${error}`}
      </p>
    );
  }
  return finished ? (
    <p role="status" data-testid="admin-done">
      {finished}
    </p>
  ) : null;
}
