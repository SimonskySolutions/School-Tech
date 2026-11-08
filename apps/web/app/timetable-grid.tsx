import { type TimetableEntry, type TimetablePeriod, type TimetableView } from '@pythagoras/shared';
import { type CSSProperties } from 'react';
import { lessonAt, SCHOOL_DAYS, subjectTone } from '../lib/timetable';

const DETAIL: Record<TimetableView, (entry: TimetableEntry) => string> = {
  class: (entry) => `${entry.teacher} · ${entry.room}`,
  teacher: (entry) => `${entry.classLabel} · ${entry.room}`,
  room: (entry) => `${entry.classLabel} · ${entry.teacher}`,
};

/**
 * One week: a column per school day with its periods lined up across the days
 * (docs/design.md). On a phone the days stack, and each lesson shows its own time.
 * `removeAction` adds a way to take a lesson out, for those who plan the timetable.
 */
export function TimetableGrid({
  periods,
  entries,
  view,
  removeAction,
}: {
  periods: readonly TimetablePeriod[];
  entries: readonly TimetableEntry[];
  view: TimetableView;
  removeAction?: string;
}) {
  return (
    <div
      className="timetable"
      data-testid="timetable"
      style={{ '--periods': periods.length } as CSSProperties}
    >
      <div className="timetable-column timetable-times" aria-hidden="true">
        <div className="timetable-head" />
        {periods.map((period) => (
          <div key={period.id} className="timetable-time">
            <strong>{period.position}</strong>
            {period.starts}
          </div>
        ))}
      </div>
      {SCHOOL_DAYS.map((day, index) => (
        <div key={day} className="timetable-column">
          <h3 className="timetable-head">{day}</h3>
          {periods.map((period) => {
            const lesson = lessonAt(entries, index + 1, period.id);
            return lesson ? (
              <div
                key={period.id}
                className={`lesson tone-${subjectTone(lesson.subject)}`}
                data-testid={`lesson-${lesson.id}`}
              >
                <span className="lesson-time">
                  {period.starts}
                  <br />
                  {period.ends}
                </span>
                <strong>{lesson.subject}</strong>
                <small>{DETAIL[view](lesson)}</small>
                {removeAction ? (
                  <form method="post" action={removeAction}>
                    <input type="hidden" name="action" value="remove-lesson" />
                    <input type="hidden" name="entry_id" value={lesson.id} />
                    <button type="submit" aria-label={`Remove ${lesson.subject}, ${day}`}>
                      Remove
                    </button>
                  </form>
                ) : null}
              </div>
            ) : (
              <div key={period.id} className="lesson-empty" />
            );
          })}
        </div>
      ))}
    </div>
  );
}
