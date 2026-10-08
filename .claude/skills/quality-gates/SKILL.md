---
name: quality-gates
description: Use before marking any VA Launchpad feature, task, or release as done. Defines the seven gates (Planner, Learning designer, Designer, Developer, Critic, Security, QA) and the owner approval that every change must pass in order.
---

# Quality gates

Nothing reaches the owner for approval until every gate below has passed for that change. A failed gate sends the change back to the Developer, and every review after the Developer runs again.

## Order

1. **Planner**: split the work into tasks, each with acceptance criteria that can be checked by running something. Pass when every task has a measurable "done" line.
2. **Learning designer** (only for lessons, quizzes, rubrics, coach prompts): each lesson has a task, an example, and a way to measure it. Taglish is correct and natural. Pass when `docs/curriculum/` and the rubric files match the level's "patunay na pasado".
3. **Designer**: uses `docs/design/tokens.json` and the glass rules in `.claude/skills/glass-design-system`. Pass when the screen works at 360px width with no horizontal scroll, text contrast is at least 4.5:1 (3:1 for large text), and no new colors or fonts appear outside the tokens.
4. **Developer**: code and tests. Pass when `npm test` and the typecheck/lint commands succeed on a clean checkout, and new behavior has a test that failed before the change.
5. **Critic**: reads the diff without the Developer's reasoning. Pass when there are no open correctness or maintainability issues. Output is a list of findings with "fixed" or "accepted with reason" for each.
6. **Security**: runs the checklist in `.claude/skills/security-checklist`. Pass when every item that applies to the change is checked with evidence (a test name, a file path, or a command output).
7. **QA**: walks the full flow as a learner and as an owner, on a phone-sized viewport and on desktop, on staging. Pass when the flow completes without a workaround and load time on a throttled mobile connection is under 3 seconds for the first screen.
8. **Owner approval**: the owner reviews staging and says "ilabas". Only then is the change merged to production.

## Rules

- The agent or person who wrote a change never approves its own gate. The Critic and Security reviews run in a fresh context.
- A gate report lists what was checked, the evidence, and the result. "Looks fine" is not a result.
- Payments and security changes also need a human developer review before the public launch (see the product plan).
- If a gate is skipped for an urgent fix, the fix is logged in `docs/decisions/` and the gate runs within 24 hours.
