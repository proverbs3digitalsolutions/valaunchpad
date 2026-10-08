---
name: glass-design-system
description: Use when building or changing any VA Launchpad screen or component. Points to the design tokens and the glassmorphism and modern SaaS dashboard rules, and lists what is not allowed.
---

# Glass design system

The source of truth is `docs/design/tokens.json`. The rules are in `docs/design/README.md`. The visual reference is the "VA Launchpad Screens" canvas and the "VA Launchpad Design System" artifact.

## Use tokens, never raw values

- Colors come from tokens: `mimosa` (ground), `sunny` (the one accent, as a fill), `on-sunny` (text on sunny), `ink`, `ink-muted`, `surface-solid`, `glass`, `glass-border`, `line`, `success`, `danger`, and the soft and deep variants.
- Spacing: `space-2`, `space-4`, `space-6`, `space-8`. Radius: `radius-sm`, `radius-md`, `radius-lg`. Shadow: `shadow-glass`. Blur: `glass-blur`.
- Type: `display`, `stat`, `h1`, `h2`, `body`, `small`, `label`. The label style is the italic serif.

## Glass rules

- A glass card uses `glass`, `glass-blur` backdrop blur, a 1px `glass-border`, `radius-lg`, and `shadow-glass`.
- At most four blurred layers per screen. Fall back to `surface-solid` where backdrop blur is not supported.
- Long reading (lessons, the coach chat, forms) sits on `surface-solid`, not on glass.
- Decorative blurred shapes are behind content, `aria-hidden`, and do not move.

## Not allowed

- Text in `sunny` on `mimosa` at any size (about 1.8:1 contrast). Use `on-sunny` on sunny fills.
- Yellow as a warning color. Yellow is the brand.
- Emoji as interface icons. Use text labels until an icon set is chosen.
- Glass used to mark an input. Inputs use `line` borders.
- Color-only status. Every success or danger state has a word or icon.

## Checks before handing to QA

- Works at 360px width with no horizontal scroll.
- Contrast passes for every text and control pair in both light and dark themes.
- Touch targets are at least 44px high.
- Focus ring is a solid 2px `ink` outline with a 2px offset.
