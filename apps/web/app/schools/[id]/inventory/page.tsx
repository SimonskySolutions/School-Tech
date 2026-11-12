import { type StockKind } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolInventory } from '../../../../lib/api-client';
import { OPERATIONS_NOTICES, STOCK_KINDS, STOCK_REASONS } from '../../../../lib/operations';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** What a school keeps beyond uniforms: books, equipment and supplies, and who supplies them. */
export default async function SchoolInventoryPage({
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
  const result = await fetchSchoolInventory(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Inventory</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (OPERATIONS_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const low = view.items.filter((item) => item.onHand <= item.reorderLevel);
  const action = `/schools/${view.school.id}/inventory/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href={`/schools/${view.school.id}/uniforms`}>Uniforms</Link>
      </p>
      <h1>{`Inventory at ${view.school.name}`}</h1>
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

      <ul className="stats" data-testid="stock-stats">
        <li>
          <span className="stat-value">{view.items.length}</span>
          <span className="stat-label">items kept</span>
        </li>
        <li>
          <span className="stat-value">{low.length}</span>
          <span className="stat-label">to reorder</span>
        </li>
        <li>
          <span className="stat-value">{view.suppliers.length}</span>
          <span className="stat-label">suppliers</span>
        </li>
      </ul>

      {(Object.keys(STOCK_KINDS) as StockKind[]).map((kind) => {
        const items = view.items.filter((item) => item.kind === kind);
        return items.length > 0 ? (
          <section key={kind} aria-labelledby={`kind-${kind}`} data-testid={`stock-${kind}`}>
            <h2 id={`kind-${kind}`}>{STOCK_KINDS[kind]}</h2>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="number">In stock</th>
                  <th className="number">Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}{' '}
                      {item.onHand <= item.reorderLevel ? <span className="badge warn">Reorder</span> : null}
                      {item.supplier ? (
                        <>
                          <br />
                          <small>{item.supplier}</small>
                        </>
                      ) : null}
                    </td>
                    <td className="number">{item.onHand}</td>
                    <td className="number">{item.reorderLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null;
      })}

      {view.canManage && view.items.length > 0 ? (
        <section aria-labelledby="move" data-testid="move-stock">
          <h2 id="move">Update the stock</h2>
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="move" />
            <label>
              Item
              <select name="item_id">
                {view.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What happened
              <select name="reason">
                {Object.entries(STOCK_REASONS).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity <input name="quantity" required inputMode="numeric" size={5} />
            </label>
            <button type="submit">Update</button>
          </form>
        </section>
      ) : null}

      {view.canManage ? (
        <section aria-labelledby="add-item" data-testid="add-item">
          <h2 id="add-item">Add an item</h2>
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="add-item" />
            <label>
              Kind
              <select name="kind">
                {Object.entries(STOCK_KINDS).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name <input name="name" required maxLength={160} placeholder="Maths textbook, grade 3" />
            </label>
            <label>
              Reorder at <input name="reorder_level" required inputMode="numeric" defaultValue="5" size={5} />
            </label>
            <label>
              Supplier
              <select name="supplier_id" defaultValue="">
                <option value="">None yet</option>
                {view.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add the item</button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="suppliers" data-testid="suppliers">
        <h2 id="suppliers">Suppliers</h2>
        {view.suppliers.length === 0 ? <p>None yet.</p> : null}
        <ul>
          {view.suppliers.map((supplier) => (
            <li key={supplier.id}>
              <strong>{supplier.name}</strong>
              {[supplier.email, supplier.phone].filter(Boolean).length > 0
                ? ` · ${[supplier.email, supplier.phone].filter(Boolean).join(' · ')}`
                : ''}
            </li>
          ))}
        </ul>
        {view.canManage ? (
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="add-supplier" />
            <label>
              Name <input name="name" required maxLength={160} />
            </label>
            <label>
              E-mail <input type="email" name="email" />
            </label>
            <label>
              Phone <input name="phone" maxLength={40} />
            </label>
            <button type="submit">Add the supplier</button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
