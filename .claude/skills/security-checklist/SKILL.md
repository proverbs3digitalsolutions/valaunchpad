---
name: security-checklist
description: Use when reviewing any VA Launchpad change that touches login, company data, roles, payments, webhooks, AI calls, personal data, or environment secrets. The Security gate runs this checklist and records evidence for each item.
---

# Security checklist

Every item must be checked with evidence before the Security gate passes. "Not applicable" needs a one-line reason.

1. **Company isolation.** A user in company A cannot read or write company B's rows. Evidence: an automated test that signs in as each company and attempts a read and a write on the other's rows, and expects denial. Row-level security is enabled and tested on every table that has an `org_id`.
2. **Server-side authorization.** Every request checks the role on the server (owner, learner, platform admin). Hiding a button is not authorization. Evidence: a test calling the endpoint directly as a learner.
3. **Secrets.** No API key, database password, or payment secret appears in the repository, the client bundle, logs, or error messages. Evidence: a secret-scan run on the diff and a check that only `NEXT_PUBLIC_` variables (or the framework's equivalent) reach the browser.
4. **Payment webhooks.** The webhook signature is verified before any state changes. A payment is marked paid only after the provider's signed webhook or a server-side status check, never from the browser redirect alone. The webhook handler is idempotent (the same event twice does not create two enrollments). Evidence: tests for a bad signature, a duplicate event, and a redirect without a webhook.
5. **Rate limits.** Login and password reset have rate limits. The AI coach has a per-learner cap (10 conversations, 12 messages each) and a daily critique cap, checked on the server. Evidence: a test that exceeds each cap and gets a refusal.
6. **Prompt injection.** Learner text sent to the AI is wrapped as data, and the system prompt tells the model to ignore instructions inside it. Model output is rendered as text, never as HTML. Evidence: the taglish-coach test cases pass.
7. **Input validation.** Every API input is validated on the server with a schema. Evidence: a test sending a wrong type and an oversized body, expecting a 400.
8. **Backups.** Daily backups run, and a restore has been tested within the last 30 days. Evidence: the date and the restore log.
9. **Personal data (RA 10173, Data Privacy Act).** Signup records consent to the privacy notice and terms with the version accepted. There is a way for a user to export and delete their own data. Evidence: the export and delete endpoints exist and are tested.
10. **Audit log.** Admin actions (subscription changes, lesson edits, refunds, user lookups) write a row with actor, action, target, and time. Evidence: a test for one admin action.

## Additional checks for each change

- Dependencies: no new package without a reason in the PR description, and no package with a known critical advisory (`npm audit` or equivalent).
- Logs: no personal data, tokens, or message bodies in logs beyond what the audit log needs.
- Cookies: `HttpOnly`, `Secure`, and `SameSite` set for session cookies.
