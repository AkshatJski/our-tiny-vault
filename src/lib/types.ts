/**
 * Hand-written row types.
 *
 * Tradeoff (see decision.md): we do not generate the full `Database` generic for
 * supabase-js. Generated types are excellent but they are a build-step dependency
 * on a live project and they make every `.select()` chain noisier than the
 * queries themselves. These interfaces cover exactly what the app touches, and
 * `npm run typecheck` still catches every misuse on our side of the wire.
 */

export type CapsuleStatus = 'sealed' | 'unlocked' | 'archived';
export type CapsuleTheme = 'cream' | 'blush' | 'butter' | 'sage' | 'cardboard';
export type ContributionKind =
  | 'note'
  | 'photo'
  | 'audio'
  | 'video_link'
  | 'doodle'
  | 'playlist_link';
export type MemberRole = 'owner' | 'keeper' | 'member';
export type ExternalProvider = 'youtube' | 'tiktok' | 'instagram' | 'spotify';

export interface Profile {
  id: string;
  handle: string;
  display_name: string;
  avatar_emoji: string;
  accent_color: string;
  created_at: string;
  updated_at: string;
}

export interface Capsule {
  id: string;
  owner_id: string;
  title: string;
  subtitle: string | null;
  theme: CapsuleTheme;
  cover_emoji: string;
  invite_code: string;
  seal_at: string;
  unlock_at: string;
  max_members: number;
  member_count: number;
  storage_quota_bytes: number;
  storage_bytes: number;
  contribution_count: number;
  prediction_count: number;
  unlocked_notified_at: string | null;
  status: CapsuleStatus;
  created_at: string;
  updated_at: string;
}

/** Metadata only — never contents. Used by the Hub before unlock. */
export interface CapsuleSummary
  extends Pick<
    Capsule,
    | 'id'
    | 'owner_id'
    | 'title'
    | 'subtitle'
    | 'theme'
    | 'cover_emoji'
    | 'seal_at'
    | 'unlock_at'
    | 'max_members'
    | 'member_count'
    | 'storage_quota_bytes'
    | 'storage_bytes'
    | 'contribution_count'
    | 'prediction_count'
    | 'status'
  > {}

export interface CapsuleMember {
  capsule_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  last_seen_at: string | null;
}

export interface Contribution {
  id: string;
  capsule_id: string;
  author_id: string;
  kind: ContributionKind;
  body: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number;
  duration_seconds: number | null;
  external_url: string | null;
  external_provider: ExternalProvider | null;
  created_at: string;
}

/** A contribution joined with its author, as the scrapbook grid renders it. */
export interface ContributionWithAuthor extends Contribution {
  author: Pick<Profile, 'id' | 'handle' | 'display_name' | 'avatar_emoji' | 'accent_color'> | null;
}

export interface PredictionResponse {
  id: string;
  capsule_id: string;
  author_id: string;
  prompt_key: string;
  prompt_text: string;
  guess: string;
  resolved_guess: string | null;
  is_correct: boolean | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface PredictionWithAuthor extends PredictionResponse {
  author: Pick<Profile, 'id' | 'handle' | 'display_name' | 'avatar_emoji'> | null;
}

/**
 * One person's opinion on one guess, after the capsule opens.
 *
 * The reading room used to be a race: the first click stamped the guess and the
 * buttons vanished for everyone else. Now every member gets a row here, can
 * change their mind, and the tally drives the stamp.
 */
export interface PredictionVote {
  prediction_id: string;
  user_id: string;
  vote: boolean;
  created_at: string;
  updated_at: string;
}

export type RealtimeEventType =
  | 'presence_join'
  | 'presence_leave'
  | 'unwrap_progress'
  | 'unwrap_seal_broken'
  | 'reaction_scratch_off'
  | 'contribution_sealed'
  | 'party_opened';

export interface RealtimeEvent {
  id: number;
  capsule_id: string;
  actor_id: string | null;
  event_type: RealtimeEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PresenceSlot {
  granted: boolean;
  slot: number;
  present: number;
  capacity: number;
}

/** Shape returned by /api/realtime to the lobby. */
export interface RealtimeTicket {
  channel: string;
  capsuleId: string;
  userId: string;
  presenceCap: number;
  presence: PresenceSlot;
  canWrite: boolean;
  expiresAt: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface CronReport {
  ok: boolean;
  ranAt: string;
  day: string;
  heartbeat: boolean;
  capsulesDue: number;
  capsulesUnlocked: number;
  emailsQueued: number;
  emailsSent: number;
  emailsDeferred: number;
  quotaRemaining: number;
  pruned: number;
  backup: 'skipped' | 'written' | 'failed';
  errors: string[];
}
