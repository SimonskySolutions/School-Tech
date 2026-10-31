import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatMoney } from '@pythagoras/shared';
import { fetchSchoolUniforms } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { UNIFORM_NOTICES } from '../../../../lib/uniforms';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const cell = { textAlign: 'right', paddingRight: '1rem' } as const;

/** Uniform stock per size, deliveries and corrections, and paid items to hand over (ADR 0025). */
export default async function SchoolUniformsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolUniforms(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Uniforms</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (UNIFORM_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/schools/${view.school.id}/uniforms/actions`;
  const low = view.products.flatMap((p) =>
    p.variants.filter((v) => v.lowStock).map((v) => ({ product: p.name, ...v })),
  );

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Uniforms at ${view.school.name}`}</h1>
      {done ? (
        <p role="status" data-testid="done">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="error">
          {error}
        </p>
      ) : null}

      {low.length ? (
        <section aria-labelledby="low" data-testid="low-stock">
          <h2 id="low">Low stock</h2>
          <ul>
            {low.map((v) => (
              <li
                key={v.id}
              >{`${v.product}, ${v.size ?? v.sku}: ${v.free} free (reorder at ${v.lowStockThreshold})`}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="handover" data-testid="awaiting-handover">
        <h2 id="handover">Paid, to hand over</h2>
        {view.awaitingHandOver.length === 0 ? <p>Nothing waiting.</p> : null}
        <ul>
          {view.awaitingHandOver.map((item) => (
            <li key={item.reservationId}>
              {`${item.studentName ?? 'A child'}${item.classLabel ? `, ${item.classLabel}` : ''}: ${item.quantity} × ${item.product}, ${item.variant}`}
              {view.canHandOver ? (
                <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                  <input type="hidden" name="action" value="hand-over" />
                  <input type="hidden" name="reservation_id" value={item.reservationId} />
                  <button type="submit" data-testid="hand-over">
                    Handed over
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {view.products.map((product) => (
        <section
          key={product.id}
          aria-labelledby={`product-${product.id}`}
          data-testid={`product-${product.name}`}
        >
          <h2 id={`product-${product.id}`}>{product.name}</h2>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Size</th>
                <th style={cell}>Price</th>
                <th style={cell}>In store</th>
                <th style={cell}>Unpaid orders</th>
                <th style={cell}>Paid, not handed over</th>
                <th style={cell}>Free</th>
                {view.canManage ? <th style={{ textAlign: 'left' }}>Change stock</th> : null}
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => (
                <tr key={v.id} data-testid={`variant-${v.sku}`} style={{ verticalAlign: 'top' }}>
                  <td style={{ paddingRight: '1rem' }}>
                    {[v.size, v.colour].filter(Boolean).join(', ') || v.sku}
                  </td>
                  <td style={cell}>
                    {v.price ? formatMoney(v.price.unitAmountMinor, v.price.currency) : '—'}
                  </td>
                  <td style={cell}>{v.onHand}</td>
                  <td style={cell}>{v.reserved}</td>
                  <td style={cell}>{v.allocated}</td>
                  <td style={{ ...cell, ...(v.lowStock ? { color: '#9b1c1c', fontWeight: 600 } : {}) }}>
                    {v.free}
                  </td>
                  {view.canManage ? (
                    <td>
                      <form method="post" action={action}>
                        <input type="hidden" name="action" value="stock" />
                        <input type="hidden" name="variant_id" value={v.id} />
                        <select name="kind" defaultValue="delivery">
                          <option value="delivery">Delivery in</option>
                          <option value="correction">Correction (+/−)</option>
                        </select>{' '}
                        <input name="delta" inputMode="numeric" size={4} required aria-label="Items" />{' '}
                        <input
                          name="reason"
                          required
                          maxLength={300}
                          placeholder="Delivery note or count"
                          aria-label="Why"
                        />{' '}
                        <button type="submit">Save</button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {view.canManage ? (
            <details>
              <summary>Add a size or colour</summary>
              <form
                method="post"
                action={action}
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '32rem' }}
              >
                <input type="hidden" name="action" value="add-variant" />
                <input type="hidden" name="offering_id" value={product.id} />
                <label>
                  Code <input name="sku" required placeholder="POLO-NAVY-164" />
                </label>
                <label>
                  Size <input name="size" maxLength={40} />
                </label>
                <label>
                  Colour <input name="colour" maxLength={40} />
                </label>
                <label>
                  Price in euros <input name="price" required inputMode="decimal" placeholder="25.00" />
                </label>
                <label>
                  Reorder at (items){' '}
                  <input name="low_stock_threshold" inputMode="numeric" defaultValue="3" size={4} />
                </label>
                <button type="submit">Add</button>
              </form>
            </details>
          ) : null}
        </section>
      ))}
    </main>
  );
}
