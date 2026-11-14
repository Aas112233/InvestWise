import { ValidationError } from '@/lib/utils/errors';

/**
 * Text ceilings for goals. `goals.title` is varchar(255) and
 * `goals.description` is unbounded `text`, so neither the database nor the
 * request body stopped oversized input — an over-length title died inside the
 * INSERT as Postgres 22001 and an over-length description was simply stored.
 * Both write doors (POST /api/goals, PUT /api/goals/[id]) import these.
 */
export const GOAL_TITLE_MAX = 200;
export const GOAL_DESCRIPTION_MAX = 10000;

/** Validate a goal title/description pair; throws ValidationError on breach. */
export function assertGoalText(title: unknown, description: unknown) {
  if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > GOAL_TITLE_MAX) {
    throw new ValidationError(`title must be a string of 1-${GOAL_TITLE_MAX} characters`);
  }
  assertGoalDescription(description);
}

/** Shared so an update path can validate description without re-sending title. */
export function assertGoalDescription(description: unknown) {
  if (description != null && typeof description !== 'string') {
    throw new ValidationError('description must be a string');
  }
  if (typeof description === 'string' && description.trim().length > GOAL_DESCRIPTION_MAX) {
    throw new ValidationError(`description must be at most ${GOAL_DESCRIPTION_MAX} characters`);
  }
}
