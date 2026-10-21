import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Authentication IDs and private question snapshots never enter browser assets.
// A profile revision serializes its balance, inventory, equipment and attempt.
export const players = sqliteTable('game_players', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull(),
  name: text('name').notNull(),
  coins: integer('coins').notNull(),
  owned: text('owned').notNull(),
  equipped: text('equipped').notNull(),
  activeId: text('active_id'),
  revision: integer('revision').notNull().default(0),
  mutationToken: text('mutation_token'),
  createdDay: text('created_day').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  uniqueIndex('game_players_public_id_unique').on(table.publicId),
  check('game_players_nonnegative_coins', sql`${table.coins} >= 0 AND typeof(${table.coins}) = 'integer'`),
  check('game_players_revision_valid', sql`${table.revision} >= 0`),
  check('game_players_inventory_json', sql`json_valid(${table.owned}) AND json_valid(${table.equipped})`),
]);

export const attempts = sqliteTable('game_attempts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  week: text('week').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  payload: text('payload').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
}, table => [
  uniqueIndex('game_attempts_user_day_mode_unique').on(table.userId, table.day, table.mode),
  index('game_attempts_week_index').on(table.week),
  check('game_attempts_mode_valid', sql`${table.mode} IN ('daily', 'practice')`),
  check('game_attempts_status_valid', sql`${table.status} IN ('active', 'complete', 'expired')`),
  check('game_attempts_payload_json', sql`json_valid(${table.payload})`),
]);

export const results = sqliteTable('game_results', {
  attemptId: text('attempt_id').primaryKey().references(() => attempts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  week: text('week').notNull(),
  mode: text('mode').notNull(),
  correct: integer('correct').notNull(),
  totalTimeMs: integer('total_time_ms').notNull(),
  scoreCent: integer('score_cent').notNull(),
  result: text('result').notNull(),
  completedAt: integer('completed_at').notNull(),
}, table => [
  uniqueIndex('game_results_user_day_mode_unique').on(table.userId, table.day, table.mode),
  index('game_results_week_mode_index').on(table.week, table.mode),
  check('game_results_correct_valid', sql`${table.correct} BETWEEN 0 AND 5`),
  check('game_results_time_valid', sql`${table.totalTimeMs} >= 0`),
  check('game_results_score_valid', sql`${table.scoreCent} BETWEEN 0 AND 509900`),
  check('game_results_json_valid', sql`json_valid(${table.result})`),
]);

export const mutationReceipts = sqliteTable('game_mutation_receipts', {
  userId: text('user_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.requestId] })]);

export const coinLedger = sqliteTable('game_coin_ledger', {
  userId: text('user_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull(),
  reason: text('reason').notNull(),
  amount: integer('amount').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.reference] })]);

// Insertion of the fence and its immutable ranking snapshot is one D1 batch.
// Final submissions must prove that their week has not been closed.
export const closedWeeks = sqliteTable('game_closed_weeks', {
  week: text('week').primaryKey(),
  closeToken: text('close_token').notNull(),
  closedAt: integer('closed_at').notNull(),
  rulesVersion: integer('rules_version').notNull(),
});

export const weeklyAwards = sqliteTable('game_weekly_awards', {
  userId: text('user_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  week: text('week').notNull().references(() => closedWeeks.week),
  correct: integer('correct').notNull(),
  totalTimeMs: integer('total_time_ms').notNull(),
  playedDays: integer('played_days').notNull(),
  rank: integer('rank').notNull(),
  participants: integer('participants').notNull(),
  tierId: text('tier_id').notNull(),
  coins: integer('coins').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.week] }),
  index('game_weekly_awards_week_index').on(table.week),
]);

export const rateLimits = sqliteTable('game_rate_limits', {
  userId: text('user_id').primaryKey(),
  windowStart: integer('window_start').notNull(),
  requestCount: integer('request_count').notNull(),
});

// Separate application accounts from the Sites outer access gate. Existing
// trusted Sites account IDs are retained, so their game records do not move.
// Social profile names, emails, access tokens and refresh tokens are not stored.
export const authAccounts = sqliteTable('auth_accounts', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  disabledAt: integer('disabled_at'),
});

export const authIdentities = sqliteTable('auth_identities', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  issuer: text('issuer').notNull(),
  audience: text('audience').notNull(),
  subject: text('subject').notNull(),
  linkedAt: integer('linked_at').notNull(),
}, table => [
  uniqueIndex('auth_identities_subject_unique').on(table.provider, table.issuer, table.audience, table.subject),
  uniqueIndex('auth_identities_account_provider_unique').on(table.accountId, table.provider),
  check('auth_identities_provider_valid', sql`${table.provider} IN ('kakao', 'google', 'naver')`),
]);

export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  bindingHash: text('binding_hash'),
  // Provider-signed authentication time; never backfill from session issuance.
  authenticatedAt: integer('authenticated_at'),
  accountId: text('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => [
  index('auth_sessions_account_index').on(table.accountId, table.createdAt),
  index('auth_sessions_expiry_index').on(table.expiresAt),
  index('auth_sessions_binding_index').on(table.bindingHash),
  check('auth_sessions_provider_valid', sql`${table.provider} IN ('kakao', 'google', 'naver', 'local')`),
  check('auth_sessions_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
  check('auth_sessions_authenticated_at_valid', sql`${table.authenticatedAt} IS NULL OR (typeof(${table.authenticatedAt}) = 'integer' AND ${table.authenticatedAt} >= 0 AND ${table.authenticatedAt} <= ${table.createdAt})`),
]);

export const authOAuthTransactions = sqliteTable('auth_oauth_transactions', {
  stateHash: text('state_hash').primaryKey(),
  bindingHash: text('binding_hash').notNull(),
  provider: text('provider').notNull(),
  audience: text('audience').notNull(),
  intent: text('intent').notNull(),
  accountId: text('account_id').references(() => authAccounts.id, { onDelete: 'cascade' }),
  // Reauthentication is pinned to one existing session and linked identity.
  sessionHash: text('session_hash'),
  identityId: text('identity_id'),
  contextHash: text('context_hash').notNull(),
  nonceHash: text('nonce_hash').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  claimToken: text('claim_token'),
  signupPolicyVersion: text('signup_policy_version'),
  signupConfirmedAt: integer('signup_confirmed_at'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [
  index('auth_oauth_transactions_expiry_index').on(table.expiresAt),
  check('auth_oauth_transactions_provider_valid', sql`${table.provider} IN ('kakao', 'google', 'naver')`),
  check('auth_oauth_transactions_intent_valid', sql`${table.intent} IN ('login', 'link', 'reauth')`),
  check('auth_oauth_transactions_link_account_valid', sql`${table.intent} != 'link' OR ${table.accountId} IS NOT NULL`),
  check('auth_oauth_transactions_reauth_valid', sql`${table.intent} != 'reauth' OR (${table.accountId} IS NOT NULL AND ${table.sessionHash} IS NOT NULL AND length(${table.sessionHash}) = 64 AND ${table.identityId} IS NOT NULL)`),
  check('auth_oauth_transactions_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
  check('auth_oauth_signup_valid', sql`(${table.signupPolicyVersion} IS NULL AND ${table.signupConfirmedAt} IS NULL) OR (${table.provider} = 'google' AND ${table.intent} = 'login' AND typeof(${table.signupConfirmedAt}) = 'integer' AND ${table.signupConfirmedAt} = ${table.createdAt} AND length(${table.signupPolicyVersion}) BETWEEN 1 AND 80)`),
]);

export const authLocalCredentials = sqliteTable('auth_local_credentials', {
  username: text('username').primaryKey(),
  accountId: text('account_id').notNull().references(() => authAccounts.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  uniqueIndex('auth_local_credentials_account_unique').on(table.accountId),
  check('auth_local_username_valid', sql`length(${table.username}) BETWEEN 4 AND 24 AND ${table.username} NOT GLOB '*[^a-z0-9_]*'`),
  check('auth_local_hash_valid', sql`length(${table.passwordHash}) BETWEEN 32 AND 512`),
]);

// Explicit preview acknowledgements are self declarations, never verified age.
export const authRegistrationConsents = sqliteTable('auth_registration_consents', {
  accountId: text('account_id').primaryKey().references(() => authAccounts.id, { onDelete: 'cascade' }),
  policyVersion: text('policy_version').notNull(),
  selfDeclared14: integer('self_declared_14').notNull(),
  acceptedAt: integer('accepted_at').notNull(),
}, table => [check('auth_registration_consent_valid', sql`${table.selfDeclared14} = 1 AND typeof(${table.acceptedAt}) = 'integer' AND ${table.acceptedAt} >= 0 AND length(${table.policyVersion}) BETWEEN 1 AND 80`)]);

export const authLocalRequests = sqliteTable('auth_local_requests', {
  id: text('id').primaryKey(), bindingHash: text('binding_hash').notNull(),
  contextHash: text('context_hash').notNull(), action: text('action').notNull(),
  createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
}, table => [
  index('auth_local_requests_binding_index').on(table.bindingHash),
  index('auth_local_requests_expiry_index').on(table.expiresAt),
  check('auth_local_request_action_valid', sql`${table.action} IN ('register', 'login')`),
  check('auth_local_request_expiry_valid', sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + 120000`),
]);

export const authLocalRateLimits = sqliteTable('auth_local_rate_limits', {
  bucket: text('bucket').primaryKey(), windowStart: integer('window_start').notNull(),
  requestCount: integer('request_count').notNull(), expiresAt: integer('expires_at').notNull(),
}, table => [
  index('auth_local_rate_limits_expiry_index').on(table.expiresAt),
  check('auth_local_rate_count_valid', sql`${table.requestCount} > 0`),
]);

// Exactly six named buckets (start/callback × three providers), never client
// controlled keys. This caps pending OAuth state without retaining IP addresses.
export const authRateLimits = sqliteTable('auth_rate_limits', {
  bucket: text('bucket').primaryKey(),
  windowStart: integer('window_start').notNull(),
  requestCount: integer('request_count').notNull(),
}, table => [
  check('auth_rate_limits_bucket_valid', sql`${table.bucket} IN ('start:kakao', 'start:google', 'start:naver', 'callback:kakao', 'callback:google', 'callback:naver')`),
]);

// Privacy closure rows deliberately have no FK to auth_accounts: deleting an
// account must not erase the tombstone that prevents trusted-ID recreation.
export const privacyAccountControls = sqliteTable('privacy_account_controls', {
  accountId: text('account_id').primaryKey(),
  state: text('state').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [check('privacy_account_state_valid', sql`${table.state} IN ('pending', 'active', 'withdrawn', 'deletion_pending', 'deleted')`)]);

export const privacyDeletionJobs = sqliteTable('privacy_deletion_jobs', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedAt: integer('requested_at').notNull(),
  completedAt: integer('completed_at'),
  status: text('status').notNull(),
}, table => [
  uniqueIndex('privacy_deletion_account_unique').on(table.accountId),
  index('privacy_deletion_status_index').on(table.status, table.requestedAt),
  check('privacy_deletion_status_valid', sql`${table.status} IN ('pending', 'complete')`),
]);

// No child contact, social identifier, raw verification token, or proof JWT is
// collected here. Pending request metadata expires on the original deadline.
export const guardianRequests = sqliteTable('guardian_requests', {
  id: text('id').primaryKey(),
  guardianAccountId: text('guardian_account_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  nonceHash: text('nonce_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  policyVersion: text('policy_version').notNull(),
  state: text('state').notNull(),
  consumeToken: text('consume_token'),
}, table => [
  index('guardian_requests_expiry_index').on(table.expiresAt),
  index('guardian_requests_guardian_index').on(table.guardianAccountId),
  check('guardian_request_state_valid', sql`${table.state} IN ('pending', 'approved', 'consumed')`),
  check('guardian_request_deadline_valid', sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + 432000000`),
]);

export const guardianConsents = sqliteTable('guardian_consents', {
  id: text('id').primaryKey(),
  guardianAccountId: text('guardian_account_id').notNull(),
  childAccountId: text('child_account_id'),
  proofHash: text('proof_hash').notNull(),
  jtiHash: text('jti_hash').notNull(),
  subjectHash: text('subject_hash').notNull(),
  scopes: text('scopes').notNull(),
  policyVersion: text('policy_version').notNull(),
  approvedAt: integer('approved_at').notNull(),
  withdrawnAt: integer('withdrawn_at'),
}, table => [
  uniqueIndex('guardian_consents_proof_unique').on(table.proofHash),
  uniqueIndex('guardian_consents_jti_unique').on(table.jtiHash),
  index('guardian_consents_guardian_index').on(table.guardianAccountId),
  check('guardian_consents_scopes_valid', sql`json_valid(${table.scopes})`),
]);

export const guardianLinks = sqliteTable('guardian_links', {
  childAccountId: text('child_account_id').primaryKey(),
  guardianAccountId: text('guardian_account_id').notNull(),
  consentId: text('consent_id').notNull(),
  state: text('state').notNull(),
  linkedAt: integer('linked_at').notNull(),
}, table => [
  uniqueIndex('guardian_links_consent_unique').on(table.consentId),
  index('guardian_links_guardian_index').on(table.guardianAccountId),
  check('guardian_links_state_valid', sql`${table.state} IN ('active', 'withdrawn')`),
  check('guardian_links_distinct_accounts', sql`${table.guardianAccountId} != ${table.childAccountId}`),
]);
