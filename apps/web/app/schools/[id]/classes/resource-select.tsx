import { type NamedChoice } from '@pythagoras/shared';

/** A choice of teacher or room, which a class may not have yet. */
export function ResourceSelect({
  name,
  label,
  choices,
  chosen,
}: {
  name: string;
  label: string;
  choices: readonly NamedChoice[];
  chosen?: string | null;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={chosen ?? ''}>
        <option value="">None yet</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
}
