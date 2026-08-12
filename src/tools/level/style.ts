/**
 * LEVEL tool styles — scoped, injected at mount (the same pattern
 * guidance/manual.ts uses: src/ui/base.css is A7's; this block can move
 * there later without touching markup). Draplin discipline (SPEC §7): flat
 * fills, 3px rules, radius 0, no shadows, no gradients, motion none.
 * Landscape-capable per §7.7 — LEVEL especially.
 */
export const LEVEL_CSS = `
.level { padding: calc(var(--grid) * 2); max-width: 760px; margin: 0 auto; }

.level__top {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: var(--grid) calc(var(--grid) * 2);
  margin-bottom: calc(var(--grid) * 2);
}
.level__state {
  font-family: var(--font-display);
  text-transform: uppercase; letter-spacing: 0.06em;
  font-size: 1.5rem;
}
.level__state--moving { color: var(--gray-mid); }
.level__state--hold { color: var(--type); }
.level__zerochip {
  font-family: var(--font-hud); font-size: 0.8125rem;
  border: 2px dotted var(--rule-strong); color: var(--type-2);
  padding: 2px 8px;
}
.level__guideme { margin-left: auto; }

.level__claim {
  display: block; width: 100%; text-align: left;
  background: var(--surface); color: var(--type-2);
  border: 0; border-left: var(--rule-w) solid var(--rule-strong);
  font-family: var(--font-ui); font-size: 0.9375rem;
  padding: var(--grid) calc(var(--grid) * 1.5);
  margin: 0 0 calc(var(--grid) * 2);
  cursor: pointer; min-height: var(--tap);
}
.level__claim--stale { border-left-color: var(--red); }

.level__stage { position: relative; min-height: 12rem; }
.level--moving .level__readout,
.level--moving .bubble__dot,
.ovl--moving .ovl__labelnum { opacity: 0.35; }

.level__panel { display: none; }
.level__panel--active { display: block; }

.level__readout { position: relative; z-index: 1; }
.level__lock {
  font-family: var(--font-display); text-transform: uppercase;
  letter-spacing: 0.06em; font-size: 2rem; min-height: 2.4rem; display: block;
}

/* Ghost bob — hangs true behind the readout when out of tolerance
   (SPEC §7.5.2, ADR-010: currentColor, never orange). */
.level__ghost {
  position: absolute; z-index: 0; right: calc(var(--grid) * 2); top: 0;
  height: 11rem; width: 5rem; color: var(--type);
}
.level__ghost svg { height: 100%; width: auto; }

/* ---- SURFACE: flat square field, crosshair, dot ---- */
.level__surface { display: flex; flex-wrap: wrap; gap: calc(var(--grid) * 3); align-items: center; }
.bubble {
  position: relative; width: 13rem; height: 13rem; flex: 0 0 auto;
  background: var(--surface); border: var(--rule-w) solid var(--type);
}
.bubble__cross-h, .bubble__cross-v { position: absolute; background: var(--rule); }
.bubble__cross-h { left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; }
.bubble__cross-v { top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; }
.bubble__tol {
  position: absolute; left: 50%; top: 50%; width: 16px; height: 16px;
  margin: -8px 0 0 -8px; border: 2px solid var(--rule-strong);
}
.bubble__dot {
  position: absolute; left: 50%; top: 50%; width: 20px; height: 20px;
  margin: -10px 0 0 -10px; background: var(--orange);
}
.bubble__dot--lock { background: var(--green); }
.level__pair { display: flex; flex-direction: column; gap: var(--grid); }
.level__axislabel {
  font-family: var(--font-display); text-transform: uppercase;
  letter-spacing: 0.06em; font-size: 0.9375rem; color: var(--type-2);
}

/* ---- PLUMB ---- */
.level__plumbrow { display: flex; flex-wrap: wrap; gap: calc(var(--grid) * 2); align-items: baseline; margin-top: calc(var(--grid) * 2); }
.level__height { display: inline-flex; align-items: center; gap: var(--grid); }
.level__height input {
  width: 6ch; min-height: var(--tap); font-family: var(--font-hud);
  font-size: 1.25rem; color: var(--type-2);
  background: var(--surface); border: 2px solid var(--rule-strong);
  border-bottom: 2px dotted var(--rule-strong); padding: 0 var(--grid);
}

/* ---- wake / denial / practice ---- */
.level__wakepanel, .level__denied, .level__nosensors {
  background: var(--surface); border: var(--rule-w) solid var(--type);
  padding: calc(var(--grid) * 3); margin-bottom: calc(var(--grid) * 2);
}
.level__wake { width: 100%; font-size: 1.25rem; }
.level__wakereason, .level__recovery { font-size: 0.9375rem; color: var(--type-2); line-height: 1.45; }
.level__deniedhead {
  font-family: var(--font-display); text-transform: uppercase;
  letter-spacing: 0.06em; font-size: 1.25rem; margin: 0 0 var(--grid);
}
.level__practice { border-top: var(--rule-w) solid var(--rule); margin-top: calc(var(--grid) * 2); padding-top: calc(var(--grid) * 2); }
.level__practice label { display: inline-flex; align-items: center; gap: var(--grid); font-size: 0.9375rem; }
.level__practice input {
  width: 8ch; min-height: var(--tap); font-family: var(--font-hud); font-size: 1.25rem;
  color: var(--type-2); background: var(--surface);
  border: 2px solid var(--rule-strong); border-bottom: 2px dotted var(--rule-strong);
  padding: 0 var(--grid);
}
.level__practicehead { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; font-size: 1rem; margin: 0 0 var(--grid); }

/* ---- slope strip ---- */
.lvlstrip { margin-top: calc(var(--grid) * 3); border-top: var(--rule-w-strong) solid var(--type); padding-top: calc(var(--grid) * 2); }
.lvlstrip__rows { display: flex; flex-wrap: wrap; gap: var(--grid) calc(var(--grid) * 3); }
.lvlstrip__row { display: flex; flex-direction: column; gap: 2px; }
.lvlstrip__label { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.8125rem; color: var(--type-2); }
.lvlstrip__drain { margin: calc(var(--grid) * 2) 0 0; padding: var(--grid) calc(var(--grid) * 1.5); font-size: 0.9375rem; border-left: var(--rule-w) solid var(--rule-strong); }
.lvlstrip__drain[data-state="in-band"] { border-left-color: var(--green); color: var(--green); }
.lvlstrip__drain[data-state="over"], .lvlstrip__drain[data-state="under"] { color: var(--type-2); }
.lvlstrip__idle { color: var(--gray-mid); font-size: 0.9375rem; }

/* ---- demos ---- */
.level__demos { margin-top: calc(var(--grid) * 3); border-top: var(--rule-w) solid var(--rule); padding-top: calc(var(--grid) * 2); }
.level__demohead { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; font-size: 1rem; margin: 0 0 var(--grid); }
.level__demobtns { display: flex; flex-wrap: wrap; gap: var(--grid); }
.level__synthetic {
  display: inline-block; margin: var(--grid) 0;
  background: var(--charcoal); color: var(--off-white);
  font-family: var(--font-hud); font-size: 0.8125rem;
  padding: 4px 8px; border: 2px solid var(--off-white);
}
.level__narration { min-height: 2.6em; font-size: 0.9375rem; line-height: 1.35; }

/* ---- reversal result ---- */
.level__revresult { background: var(--surface); border: var(--rule-w) solid var(--green); padding: calc(var(--grid) * 2); margin: calc(var(--grid) * 2) 0; }
.level__revhead { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; color: var(--green); margin: 0 0 var(--grid); }
.level__revline { margin: 0 0 var(--grid); font-size: 0.9375rem; }

/* ---- explain card (± one-liner, §7B.6) ---- */
.level__explain {
  background: var(--type); color: var(--ground);
  padding: var(--grid) calc(var(--grid) * 1.5);
  font-size: 0.9375rem; line-height: 1.4; margin: var(--grid) 0;
  cursor: pointer;
}

/* ---- camera overlay ---- */
.ovl__reason, .ovl__recovery { background: var(--surface); border: var(--rule-w) solid var(--type); padding: calc(var(--grid) * 3); }
.ovl__reasonline, .ovl__recoveryhow, .ovl__recoverystill { font-size: 0.9375rem; color: var(--type-2); line-height: 1.45; }
.ovl__recoverymsg { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 var(--grid); }
.ovl__start { width: 100%; }
.ovl__livewrap { position: relative; }
.ovl__video { display: block; width: 100%; background: var(--charcoal); }
.ovl__video--hidden { display: none; }
.ovl__frozen { display: block; width: 100%; }
.ovl__canvas { position: absolute; inset: 0; width: 100%; touch-action: none; }
.ovl__label { position: absolute; left: calc(var(--grid) * 2); top: calc(var(--grid) * 2); display: flex; align-items: center; gap: var(--grid); }
.ovl__ghost { height: 5rem; width: 2.5rem; color: var(--white); }
.ovl__ghost svg { height: 100%; width: auto; }
.ovl__hint { font-size: 0.8125rem; color: var(--type-2); margin: var(--grid) 0; }
.ovl__freeze, .ovl__resume { margin-top: var(--grid); }

/* ---- landscape (SPEC §7.7 — LEVEL especially) ---- */
@media (orientation: landscape) and (max-height: 30rem) {
  .level { max-width: none; }
  .level__stage { min-height: 9rem; }
  .level__surface { flex-wrap: nowrap; }
  .bubble { width: 9rem; height: 9rem; }
  .level__ghost { height: 8rem; }
}
`;
