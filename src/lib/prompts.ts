/**
 * The "Dear Future Us" prompt pack.
 *
 * These are fixed (not user-authored) on purpose:
 *   • a shared prompt set is what makes the pinboard comparable later — everyone
 *     answering a different question is just a wall of unrelated text
 *   • `prompt_key` is stable, which lets the resolution screen match guesses
 *   • no extra table, no extra query, 0 bytes
 *
 * A capsule can pass a subset via `promptKeys` later without a migration.
 */

export interface PredictionPrompt {
  key: string;
  text: string;
  /** Shown as a hint under the input, to keep guesses concrete. */
  nudge: string;
}

export const PROMPT_PACK: PredictionPrompt[] = [
  {
    key: 'where_we_live',
    text: 'Where will we be living when this opens?',
    nudge: 'City, street, or "still that flat with the bad radiator".',
  },
  {
    key: 'who_is_famous',
    text: 'Which one of us will be the most famous?',
    nudge: 'Be specific. Fame is measurable. Sort of.',
  },
  {
    key: 'still_talking',
    text: 'Will we still talk every week?',
    nudge: 'A number, a habit, or a name.',
  },
  {
    key: 'biggest_surprise',
    text: "What will be the biggest surprise about our lives?",
    nudge: 'The thing present-you cannot imagine.',
  },
  {
    key: 'still_doing',
    text: 'What will we still be doing exactly the same?',
    nudge: 'The ritual that survives everything.',
  },
  {
    key: 'world_thing',
    text: 'What will have changed about the world?',
    nudge: 'Ordinary things count: money, phones, weather.',
  },
  {
    key: 'the_pet',
    text: 'Will we have the pet? What will it be called?',
    nudge: 'Name it. Commit to the name.',
  },
  {
    key: 'first_thing',
    text: 'What is the first thing we will do that day?',
    nudge: 'The tiny mundane answer is usually the right one.',
  },
];

export const DEFAULT_PROMPT_KEYS = PROMPT_PACK.map((prompt) => prompt.key);

export function promptsFor(keys: string[] = DEFAULT_PROMPT_KEYS): PredictionPrompt[] {
  const set = new Set(keys);
  return PROMPT_PACK.filter((prompt) => set.has(prompt.key));
}

export function promptByKey(key: string): PredictionPrompt | undefined {
  return PROMPT_PACK.find((prompt) => prompt.key === key);
}

/**
 * Which prompts has *this browser* already answered?
 *
 * This is localStorage, and it is not laziness — it is forced by the RLS rule.
 * We cannot ask the database "which guesses are mine?" because that would be a
 * read of `prediction_responses` before unlock, which is exactly what we
 * promised never to do. So the client keeps its own little ledger of what it
 * sealed, purely for UI state. If it is lost, the worst outcome is that someone
 * answers a prompt twice — and the unique index rejects the duplicate quietly.
 */
const LEDGER_PREFIX = 'tiny-vault:guesses:';

export function readGuessLedger(capsuleId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${LEDGER_PREFIX}${capsuleId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberGuess(capsuleId: string, promptKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = Array.from(new Set([...readGuessLedger(capsuleId), promptKey]));
    window.localStorage.setItem(`${LEDGER_PREFIX}${capsuleId}`, JSON.stringify(next));
  } catch {
    /* private mode: the ledger just does not persist */
  }
}

export function forgetGuess(capsuleId: string, promptKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = readGuessLedger(capsuleId).filter((key) => key !== promptKey);
    window.localStorage.setItem(`${LEDGER_PREFIX}${capsuleId}`, JSON.stringify(next));
  } catch {
    /* noop */
  }
}
