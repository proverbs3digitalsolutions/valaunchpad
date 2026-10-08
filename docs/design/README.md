Build every VA Launchpad screen from these rules. The product trains Filipino social media managers; it should feel warm, clear and encouraging, never corporate.

## Voice

- Write interface copy in Taglish by default, with an English toggle. Speak to one learner as "ikaw/mo": "Gawain mo ngayong araw", "Ipasa ang gawa mo".
- Sentence case everywhere except the one `display` word per screen, which is caps: "GALING!", "TULOY LANG".
- Be specific and kind in feedback: say what worked, then one thing to fix. No emoji in the interface.
- Money is in pesos with the sign and no decimals: ₱300.

## Color

- `mimosa` is the ground of every screen. `sunny` is the only accent; use it as a fill for the primary button, progress fills, the active nav item and one feature card per screen.
- Put `on-sunny` text on `sunny` fills. Never put white or `mimosa` text on `sunny`.
- Never set text in `sunny` on `mimosa` at any size: the pair is about 1.8:1. Display words are `ink` on `mimosa` or `on-sunny` on `sunny`; links and small accents are `sunny-deep`.
- Body copy is `ink`; secondary copy is `ink-muted`.
- `success` and `danger` are for scores and trends only, always with a word or icon. Yellow is never a warning color here because it is the brand.

## Glass

- A glass card is `glass` fill, `glass-blur` backdrop blur, a 1px `glass-border` edge, `radius-lg` corners and `shadow-glass`.
- Place two or three large blurred `sunny-soft` or `sunny` shapes on `mimosa` behind the cards so the glass has something to show. They do not move.
- Use at most four blurred layers per screen. Where backdrop blur is unsupported, fall back to `surface-solid`.
- Long reading (lesson text, the AI coach chat, forms) sits on `surface-solid`, not on glass.
- Control borders use `line`. `glass-border` is decoration and never marks an input.

## Type

- `display`, `stat`, `h1` and `h2` are Archivo at heavy weights. `body` and `small` are Archivo regular and medium.
- `label` is Instrument Serif italic, used for the small line under a display word or a stat, as in "engagement rate".
- One `display` word per screen at most.

## Layout

- Design for a 360px phone first: one column, `space-4` gutters, bottom navigation with four items.
- From 1024px: a glass sidebar on the left, a top bar, and a grid of cards with `space-4` gaps.
- Card padding is `space-6`; sections are `space-8` apart.
- The focus ring is a solid 2px `ink` outline with a 2px offset.

## Iconography

- No icon set is chosen yet. Until one is, use text labels; do not draw icons or use emoji.
- There is no logo. Set the name "VA Launchpad" in `h2` weight type.
