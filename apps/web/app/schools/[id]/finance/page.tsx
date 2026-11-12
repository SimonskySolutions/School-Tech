import { formatMoney } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { type CSSProperties } from 'react';
import { fetchSchoolFinance } from '../../../../lib/api-client';
import { budgetUse, EXPENSE_CATEGORIES, OPERATIONS_NOTICES } from '../../../../lib/operations';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CategorySelect = () => (
  <label>
    Category
    <select name="category">
      {Object.entries(EXPENSE_CATEGORIES).map(([value, name]) => (
        <option key={value} value={value}>
          {name}
        </option>
      ))}
    </select>
  </label>
);

/** A school's money this school year: what came in, what went out, against the budget. */
export default async function SchoolFinancePage({
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
  const result = await fetchSchoolFinance(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Finance</h1>
        <p data-testid="not-permitted">This page is for those who keep the school&apos;s finances.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (OPERATIONS_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const money = (minor: number) => formatMoney(minor, view.currency);
  const spent = view.categories.reduce((sum, line) => sum + line.spentMinor, 0);
  const budget = view.categories.reduce((sum, line) => sum + line.budgetMinor, 0);
  const action = `/schools/${view.school.id}/finance/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Finance at ${view.school.name}`}</h1>
      <p>{`School year ${view.academicYear}. Salaries stay in the accountants' own system.`}</p>
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

      <ul className="stats" data-testid="finance-stats">
        <li>
          <span className="stat-value">{money(view.incomeMinor)}</span>
          <span className="stat-label">paid by families</span>
        </li>
        <li>
          <span className="stat-value">{money(spent)}</span>
          <span className="stat-label">spent</span>
        </li>
        <li>
          <span className="stat-value">{money(budget)}</span>
          <span className="stat-label">budget</span>
        </li>
        <li>
          <span className="stat-value">{money(budget - spent)}</span>
          <span className="stat-label">left in the budget</span>
        </li>
      </ul>

      <section aria-labelledby="budget" data-testid="budget">
        <h2 id="budget">Budget</h2>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="number">Spent</th>
              <th className="number">Budget</th>
            </tr>
          </thead>
          <tbody>
            {view.categories.map((line) => {
              const use = budgetUse(line.spentMinor, line.budgetMinor);
              return (
                <tr key={line.category}>
                  <td className="budget-line">
                    {EXPENSE_CATEGORIES[line.category]}
                    <div
                      className={`meter ${use.state === 'ok' ? '' : use.state}`}
                      style={{ '--value': `${use.percent}%` } as CSSProperties}
                      role="img"
                      aria-label={`${use.percent}% used`}
                    />
                  </td>
                  <td className="number">{money(line.spentMinor)}</td>
                  <td className="number">{money(line.budgetMinor)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {view.canManage ? (
          <form method="post" action={action} className="form-row" data-testid="set-budget">
            <input type="hidden" name="action" value="set-budget" />
            <CategorySelect />
            <label>
              Amount for the year <input name="amount" required inputMode="decimal" size={9} />
            </label>
            <button type="submit">Set the budget</button>
          </form>
        ) : null}
      </section>

      {view.canManage ? (
        <section aria-labelledby="add-expense" data-testid="add-expense">
          <h2 id="add-expense">Record an expense</h2>
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="add-expense" />
            <CategorySelect />
            <label>
              What for <input name="description" required maxLength={300} />
            </label>
            <label>
              Supplier
              <select name="supplier_id" defaultValue="">
                <option value="">None</option>
                {view.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount <input name="amount" required inputMode="decimal" size={9} />
            </label>
            <label>
              Day <input type="date" name="spent_on" required />
            </label>
            <button type="submit">Record it</button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="expenses" data-testid="expenses">
        <h2 id="expenses">Latest expenses</h2>
        {view.expenses.length === 0 ? <p>None yet.</p> : null}
        {view.expenses.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>What for</th>
                <th className="number">Amount</th>
              </tr>
            </thead>
            <tbody>
              {view.expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="nowrap">{expense.spentOn}</td>
                  <td>
                    {expense.description}
                    <br />
                    <small>
                      {[EXPENSE_CATEGORIES[expense.category], expense.supplier].filter(Boolean).join(' · ')}
                    </small>
                  </td>
                  <td className="number">{money(expense.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
