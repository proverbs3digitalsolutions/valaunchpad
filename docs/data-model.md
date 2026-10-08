# VA Launchpad data model (draft for Sprint 0)

Database: Postgres with row-level security on every table that has `org_id`. Money is stored in centavos as integers. All timestamps are `timestamptz` in UTC.

## Accounts and companies

| Table | Key columns | Notes |
| --- | --- | --- |
| `organizations` | id, name, created_at | One per agency or solo learner. |
| `users` | id (auth user id), email, name, language (`tl` or `en`) | Email is unique. |
| `memberships` | org_id, user_id, role (`owner`, `learner`) | Unique on (org_id, user_id). A solo buyer has one row as owner and one as learner. |
| `consent_versions` | kind (`privacy`, `terms`), version, published_at | Only published versions can be accepted. Written by the server after counsel approves the text. |
| `consents` | user_id, kind, version (foreign key to `consent_versions`), accepted_at | Append-only history. Users can insert their own rows with `accepted_at` set by the database. Deleted with the profile (see open decision on retention). |
| `data_requests` | user_id, kind (`export`, `delete`), status (`requested`, `completed`, `rejected`), requested_at, completed_at | Users create and read their own. Only the server changes status. Completion cannot precede the request. |

## Learning

| Table | Key columns | Notes |
| --- | --- | --- |
| `lessons` | id, week, day, title, body_md, rubric_id, published | Curriculum, not tied to an org. Only `published` rows reach learners. |
| `enrollments` | id, org_id, user_id, status (`active`, `read_only`), started_at, ends_at | `ends_at` = `started_at` + 84 days. Created only by a paid webhook. |
| `lesson_progress` | enrollment_id, lesson_id, status, completed_at | Unique on (enrollment_id, lesson_id). |
| `assessments` | id, enrollment_id, kind (`baseline`, `final`), submitted_at | |
| `assessment_scores` | assessment_id, skill, score (1 to 4), evidence | Eight skills from the baseline. |
| `quiz_attempts` | id, enrollment_id, week, score, taken_at | Friday quiz. |

## Client work

| Table | Key columns | Notes |
| --- | --- | --- |
| `clients` | id, org_id, name, niche, platforms (array), ideal_client_profile, pillars (jsonb), voice_rules (jsonb) | Learner can only see clients in their org. |
| `submissions` | id, org_id, enrollment_id, client_id, kind (`hook`, `caption`, `script`, `calendar`, `post`), body, version, parent_id, created_at | `parent_id` links revisions. |
| `critiques` | id, submission_id, scores (jsonb: hook, linaw, halaga, cta, brand_fit), average, feedback, created_at | `average` is computed. Pass when average is 3 or higher. |
| `page_metrics` | id, org_id, client_id, platform, period_date, followers, avg_reach, engagement_rate, saves, shares, profile_visits, link_clicks, inquiries, entered_by | Entered weekly by the learner, shown on the scorecard. |

## AI coach and cost control

| Table | Key columns | Notes |
| --- | --- | --- |
| `coach_conversations` | id, enrollment_id, started_at, message_count, closed | Limit: 10 rows per enrollment. Enforced by a trigger that rejects the 11th. `message_count` may not exceed 12. |
| `coach_messages` | id, conversation_id, role (`user`, `assistant`), content, model, tokens_in, tokens_out, created_at | Assistant rows store model and token counts for cost reports. |
| `ai_usage_ledger` | id, org_id, user_id, feature (`coach`, `critique`), model, tokens_in, tokens_out, cost_usd, created_at | One row per AI call. Feeds the admin cost view. |

## Payments

| Table | Key columns | Notes |
| --- | --- | --- |
| `payments` | id, org_id, buyer_user_id, provider (`paymongo`), provider_ref (unique), seats, amount_centavos, status (`pending`, `paid`, `failed`, `refunded`), paid_at, receipt_sent_at | Price is `30000` centavos (P300) per seat. |
| `webhook_events` | provider_event_id (unique), type, payload, received_at, processed_at | Idempotency: a duplicate event is ignored. |

## Admin

| Table | Key columns | Notes |
| --- | --- | --- |
| `audit_log` | id, actor_id (no foreign key), action, target_type, target_id, at, details | Written for every admin action. Append-only: updates, deletes, and TRUNCATE are refused for every role. No client role can read it. `actor_id` has no foreign key, so erasing an admin's profile keeps the record. The app must connect as a role that does not own the table, because the table owner can disable triggers.

## Rules to test

- A learner cannot select another org's rows in any table.
- An enrollment cannot exist without a `paid` payment row.
- The 11th coach conversation for an enrollment is rejected at the database level.
- A duplicate webhook event produces no second enrollment or payment update.
