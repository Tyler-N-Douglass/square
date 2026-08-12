/**
 * Field Manual — SPEC §7B.7. Task-organized, offline, searchable.
 *
 * Every entry states the goal, the tools it uses, the steps with real
 * numbers, the failure modes, and ends with a verification step — the
 * honesty charter applies to teaching too (§15.8): small bit before the big
 * one, test cut on scrap, second sweep twelve inches up.
 *
 * "What this app can't do" comes first (§15.7 — teach the limits first).
 *
 * Rendering: prose face for paragraphs (.prose), glossary terms wrapped as
 * tappable .term spans (dotted 2px gray underline — never orange; orange is
 * reserved for live values). The mount() signature is unchanged so the
 * router keeps working.
 */
import type { AppContext, RouteId } from '../app/router';
import { findTerm, termRegex, type GlossaryEntry } from './glossary';

export interface ManualEntry {
  slug: string;
  /** The task, not the feature: "Hang a heavy mirror". */
  title: string;
  goal: string;
  /** Route ids of the tools this task uses. */
  tools: RouteId[];
  steps: string[];
  failureModes: string[];
  /** Mandatory — every entry ends with a verification step. */
  verify: string;
  /** Opens the right tool preconfigured. */
  openTool?: { route: RouteId; params?: Record<string, string> };
}

export const MANUAL_ENTRIES: readonly ManualEntry[] = [
  {
    slug: 'cant-do',
    title: 'What this app can’t do',
    goal: 'Know the failure modes before trusting a success. A user who knows what the tool cannot see drills fewer wrong holes.',
    tools: [],
    steps: [
      'SCAN finds ferrous screws and nails, not wood. Drywall over wood framing works; glued panels and fastener-free surfaces give it nothing to find.',
      'Plaster over lath scatters fasteners densely and irregularly. Expect a crowded, ambiguous ribbon and low confidence — on purpose.',
      'Metal-stud walls read hot end to end. The app refuses rather than marking studs that are not there.',
      'Magnets on the phone — MagSafe rings, wallets, mounts — swamp the field. The app detects the offset and stops until the accessory comes off.',
      'LAYOUT’s overlay plans and verifies. The tape measure still makes the mark.',
      'Photo angles are only as good as the lens calibration. Uncalibrated is ±1.5–3°; calibrated is ±0.3–0.8°; the screen says which claim is in effect.',
      'Skip CALIBRATE and every tool claims less, visibly. Accuracy is earned, not assumed.',
    ],
    failureModes: [
      'Trusting a confident-looking number in a state the app has flagged. The badge and the warning are part of the reading — a value without them is a guess.',
    ],
    verify:
      'Run the failure DEMOs in SCAN — the metal-stud wall and the MagSafe case. Watch the app refuse on known-bad input so you recognize the refusal when a real wall triggers it.',
    openTool: { route: 'scan', params: { demo: 'scan-hot-wall' } },
  },
  {
    slug: 'hang-heavy-mirror',
    title: 'Hang a heavy mirror',
    goal: 'Put two fasteners into stud centers so the wall carries the weight, not the drywall.',
    tools: ['scan', 'level', 'log'],
    steps: [
      'Sweep SCAN across the hanging zone at the paced speed. Mark the first peak rated STRONG or LIKELY with a pencil witness mark.',
      'Confirm it: sweep the same span twelve inches higher. A stud puts the second peak within 3/4″ of the first; a stray fastener does not.',
      'Find the second stud 16″ over — the lattice prediction shows where. Confirm it with one pass of its own.',
      'Hold the phone on the wall in LEVEL with the camera overlay and draw the level line through both stud marks at hanger height.',
      'Drill a 1/8″ pilot hole into each stud center. Wood curls mean stud; white dust and no resistance mean you missed — move 3/4″ and try once more.',
      'Drive the mounting screws into the pilots and hang. Anything over about 50 lb gets studs, not bare drywall anchors.',
    ],
    failureModes: [
      'The peak is a plumbing strap or conduit, not a stud fastener. The twelve-inch confirm sweep catches most of these — straps and pipes do not repeat on the stud rhythm.',
      'The mirror spans a door or window: king studs and a header change the spacing near openings. Expect extra metal at the edges and solid wood above.',
      'The wall reads hot (metal studs). Stop hunting studs; use toggle bolts rated for the full weight instead.',
    ],
    verify:
      'Load-test before you trust it: pull down hard on the hung wire or cleat with both hands. It holds your pull without creaking or shifting, it holds the mirror.',
    openTool: { route: 'scan' },
  },
  {
    slug: 'find-stud-no-power-tools',
    title: 'Find a stud with no power tools',
    goal: 'Locate a stud center with the phone, a pencil, and one finishing nail — nothing powered.',
    tools: ['scan'],
    steps: [
      'Start from a known reference: an outlet, a corner, or a door jamb. Outlet boxes fasten to the side of a stud, so one box edge sits within about 3/4″ of stud wood.',
      'Open MANUAL mode in SCAN and enter the reference and layout direction. It lays out the 16″ on-center predictions with a ± band that widens with distance.',
      'Knock along the prediction line with a knuckle: the tone deadens over a stud and rings over open stud bay.',
      'Sweep SCAN over the predicted line if your phone’s sensor tier allows. A fastener peak landing on a prediction confirms the layout.',
      'Mark the center with a pencil witness mark. Tape shifts; pencil stays.',
    ],
    failureModes: [
      'The first stud off a corner is often irregular — corners are built up and the first bay is frequently narrow. Trust the second and third predictions more than the first.',
      'Older houses drift off 16″ on center. The ± band grows with every bay from the reference; re-anchor on anything the knock or sweep confirms.',
      'Garages and some interior walls run 24″ on center. If nothing lands on the 16″ rhythm, relay the predictions at 24″ before doubting the reference.',
    ],
    verify:
      'Push a finishing nail through the drywall on your mark, in a spot the hanging will cover. Solid resistance after 1/2″ of gypsum is the stud; a nail that sails through hit the bay — measure, re-mark, and test again.',
    openTool: { route: 'scan', params: { mode: 'manual' } },
  },
  {
    slug: 'trim-corner',
    title: 'Why won’t my trim fit this corner?',
    goal: 'Measure the corner that actually exists and cut to it, instead of cutting to the 90° the house promised.',
    tools: ['corner', 'bevel'],
    steps: [
      'Photograph the corner in CORNER. Mark both edges with the loupe, two points per edge, spread as far apart along each edge as the photo allows.',
      'Read the measured angle with its ±. Drywall corners are rarely 90.0° — anything from 88° to 92° is normal construction.',
      'Set the miter to half the measured corner: a 92.6° corner cuts at 46.3° per side, not 45°.',
      'Know what the error costs: a corner out by Δ leaves a gap of about L·tan(Δ) at the heel of a piece L wide. On 3″ trim, 2° of error opens about 0.1″ — visible from across the room.',
      'Cut a test pair on scrap at the computed miter, check the fit in the corner, then commit the stick.',
    ],
    failureModes: [
      'LENS NOT CALIBRATED: the angle carries ±1.5–3° and the test cut disagrees with the math. Calibrate with a sheet of paper first — two minutes against a wasted stick.',
      'POOR GEOMETRY warning: the edges are marked too short or too flat to the camera. Re-shoot squarer-on and mark longer runs of each edge.',
      'The corner is out of plumb, so the angle changes with height. Measure at the height the trim will sit — baseboard height and crown height can differ by degrees.',
    ],
    verify:
      'Dry-fit the two scrap pieces in the corner before cutting finished stock. The scrap gap predicts the trim gap exactly — no gap on scrap, no gap on the wall.',
    openTool: { route: 'corner' },
  },
  {
    slug: 'space-five-frames',
    title: 'Space five frames evenly',
    goal: 'Five frames on one wall with equal gaps, centers at gallery height, marked without stacking error.',
    tools: ['layout', 'level'],
    steps: [
      'Measure the wall span with a tape — say 148″ between the casings.',
      'Enter span 148″, count 5, and frame width in LAYOUT equal-gaps mode. For 20″-wide frames: gap = (148 − 5×20)/6 = 8″, centers at 18″, 46″, 74″, 102″, 130″.',
      'Set the line height: 57″ from the floor to frame center is the gallery standard.',
      'Read the cumulative column and measure every mark from the same end. Chaining tape from mark to mark stacks each error onto the next.',
      'Draw the level line through the marks with LEVEL’s camera overlay, then offset each hanger mark up by that frame’s hanger drop — mark hangers, not frame tops.',
    ],
    failureModes: [
      'Chained marks drift about 1/16″–1/8″ per mark. Five chained marks can land the last frame 1/2″ off — cumulative from one datum avoids it.',
      'Frames of different widths break equal-centers math. Use equal gaps, enter each width, and lay the row out on the floor first.',
      'The floor or ceiling is visibly out of level, so a truly level row reads crooked against it. Decide which reference wins — level, or parallel to the ceiling line — before marking.',
    ],
    verify:
      'Check the last center against the far end before any nail goes in: by the math it reads 18″ from the right casing — the tape agrees within 1/8″, or a mark is wrong. Then step back across the room and count the gaps by eye.',
    openTool: { route: 'layout', params: { mode: 'equal-gaps', count: '5' } },
  },
  {
    slug: 'crown-not-90',
    title: 'Cut crown for a corner that isn’t 90°',
    goal: 'Get compound saw settings for the corner you measured, not the corner the chart assumes.',
    tools: ['corner', 'bevel'],
    steps: [
      'Measure the corner in CORNER — say it reads 92.6° ± 0.6°.',
      'Identify the crown’s spring angle: 45/45 and 52/38 are the stock profiles. Capture an unknown stick with BEVEL against its flats.',
      'Enter corner and spring angle in BEVEL’s crown solver. For a true 90.0° corner at 45/45 the card reads miter 35.26°, bevel 30.00° — your measured corner shifts both numbers.',
      'Read the whole saw card: table direction, tilt direction, which face rides the fence, which end of the cut is the keeper.',
      'Cut the pair on scrap first. Crown reads mirror-backward on the saw, and scrap is cheaper than stick.',
    ],
    failureModes: [
      'Wrong spring angle: 45/45 settings on 52/38 stock open a gap no corner measurement fixes. Check the profile before the saw moves.',
      'Nested versus flat cutting use different numbers. The card states which method its settings are for — match it to how the stock sits on your saw.',
      'The corner is out of plumb, so the angle at crown height differs from the angle at eye height. Measure where the crown will sit.',
    ],
    verify:
      'Fit the scrap pair in position at the ceiling before cutting stock. If the joint gaps, re-measure the corner and re-check the spring angle before blaming the saw.',
    openTool: { route: 'bevel', params: { solver: 'crown' } },
  },
  {
    slug: 'shelf-level',
    title: 'Check a shelf is level before drilling',
    goal: 'Verify the bracket line is level while it is still pencil, when fixing it costs an eraser instead of a re-drill.',
    tools: ['level', 'scan', 'calibrate', 'log'],
    steps: [
      'Run the reversal calibration in CALIBRATE if you have not: measure, rotate the phone 180° in place, measure again. It splits sensor bias from true tilt and tightens the claim from ±0.5° to ±0.15°.',
      'SCAN for the studs first. A level line into bare drywall will not hold a loaded shelf.',
      'Set the phone on its long edge along the penciled bracket line. Wait for the HOLD state — the number is a measurement only after 400 ms of stillness.',
      'Read the angle with its ±. A 36″ shelf at 0.5° drops 5/16″ end to end — visible with the first glass you set on it.',
      'Mark the first bracket, draw the level line through it with the camera overlay, and mark the second. Log the reading — LOG keeps the ± and the calibration state with it.',
    ],
    failureModes: [
      'Zeroing on a surface that is itself off passes that error into every later reading. Use reversal calibration, not zero-here, for anything that matters.',
      'Reading while MOVING: a dim, twitching number is motion, not measurement. Let the motion gate settle before believing anything.',
      'Brackets level but missing the studs. Level and strong are separate questions — SCAN answers the second.',
    ],
    verify:
      'After the first bracket is fixed and before the second hole is drilled, rest the shelf on the fixed bracket and the second mark, and put the phone on it: 0.0° ± 0.15°, or move the mark now while it is one hole instead of four.',
    openTool: { route: 'level', params: { mode: 'edge' } },
  },
];

/** Case-insensitive substring search across everything a reader might remember. */
export function searchManual(query: string, entries: readonly ManualEntry[] = MANUAL_ENTRIES): ManualEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...entries];
  return entries.filter((e) => {
    const hay = [e.title, e.goal, ...e.steps, ...e.failureModes, e.verify, ...e.tools].join('\n').toLowerCase();
    return hay.includes(q);
  });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Wrap glossary terms in a run of prose as tappable .term spans.
 * All-caps matches are skipped unless the glossary term itself is all-caps
 * (SNR): LEVEL, BEVEL, SCAN in copy are tool names, not glossary hits.
 */
export function wrapTerms(text: string, onTap: (slug: string, entry: GlossaryEntry) => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = termRegex();
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const surface = m[0];
    const hit = findTerm(surface);
    const isToolName = surface === surface.toUpperCase() && hit !== null && hit.entry.term !== hit.entry.term.toUpperCase();
    if (hit === null || isToolName) continue;
    frag.append(text.slice(last, m.index));
    const span = document.createElement('span');
    span.className = 'term';
    span.dataset['slug'] = hit.slug;
    span.setAttribute('role', 'button');
    span.tabIndex = 0;
    span.setAttribute('aria-label', `Define ${hit.entry.term}`);
    span.textContent = surface;
    const tap = (): void => onTap(hit.slug, hit.entry);
    span.addEventListener('click', tap);
    span.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        tap();
      }
    });
    frag.append(span);
    last = m.index + surface.length;
  }
  frag.append(text.slice(last));
  return frag;
}

/* Draplin rules: flat, 3px rules, radius 0, no shadows. .term underline is
   dotted 2px --gray, never orange (§7B.8). Scoped under .manual; A7 may
   supersede these in the shared stylesheet later. */
const MANUAL_CSS = `
.manual { padding: 16px; max-width: 720px; margin: 0 auto; }
.manual__head { font-size: clamp(32px, 10vw, 56px); margin: 16px 0; }
.manual__search {
  width: 100%; min-height: 56px; padding: 0 12px;
  font: inherit; font-size: 16px; color: inherit; background: transparent;
  border: 2px solid currentColor; border-radius: 0;
}
.manual__list { list-style: none; padding: 0; margin: 16px 0; }
.manual__item {
  display: block; width: 100%; text-align: left; cursor: pointer;
  background: transparent; color: inherit; border: 0;
  border-top: 3px solid var(--rule, #58595B); padding: 12px 0; min-height: 56px;
}
.manual__item-title { display: block; font-size: 20px; }
.manual__item-goal { display: block; font-size: 14px; opacity: 0.75; }
.manual__empty { padding: 16px 0; }
.manual__back {
  background: transparent; color: inherit; border: 2px solid currentColor;
  border-radius: 0; min-height: 44px; padding: 0 12px; font: inherit; cursor: pointer;
}
.manual__section { margin: 20px 0 4px; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.75; }
.manual__verify { border-top: 3px solid var(--rule, #58595B); margin-top: 20px; padding-top: 12px; }
.manual__open {
  display: inline-block; margin-top: 16px; min-height: 56px; line-height: 52px;
  padding: 0 16px; border: 2px solid currentColor; text-decoration: none; color: inherit;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.manual__def {
  border: 2px solid var(--rule, #58595B); padding: 12px; margin: 16px 0 0;
  font-size: 15px; line-height: 1.5;
}
.manual__def:empty { display: none; }
.prose { font-family: var(--font-prose, system-ui, sans-serif); font-size: 16px; line-height: 1.5; max-width: 60ch; margin: 8px 0; }
ol.prose, ul.prose { padding-left: 24px; }
.prose li { margin: 8px 0; }
.term {
  text-decoration: underline dotted 2px var(--gray, #58595B);
  text-underline-offset: 3px; cursor: pointer;
}
`;

function toolHref(route: RouteId, params?: Record<string, string>): string {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return `#/${route}${qs}`;
}

export function mount(el: HTMLElement, _ctx: AppContext): () => void {
  const root = document.createElement('div');
  root.className = 'manual';

  const style = document.createElement('style');
  style.textContent = MANUAL_CSS;
  root.append(style);

  const h = document.createElement('h1');
  h.className = 'manual__head display';
  h.textContent = 'FIELD MANUAL';
  root.append(h);

  const body = document.createElement('div');
  root.append(body);

  /* --- entry view --- */
  const showEntry = (entry: ManualEntry): void => {
    body.replaceChildren();

    const defPanel = document.createElement('p');
    defPanel.className = 'manual__def';
    defPanel.setAttribute('aria-live', 'polite');
    const onTap = (_slug: string, g: GlossaryEntry): void => {
      defPanel.textContent = `${g.term} — ${g.def} ${g.whyItMatters}`;
    };

    const back = document.createElement('button');
    back.className = 'manual__back';
    back.textContent = '← ALL TASKS';
    back.addEventListener('click', () => showList(search.value));
    body.append(back);

    const title = document.createElement('h2');
    title.className = 'display';
    title.textContent = entry.title;
    body.append(title);

    const goal = document.createElement('p');
    goal.className = 'prose';
    goal.append(wrapTerms(entry.goal, onTap));
    body.append(goal);

    if (entry.tools.length > 0) {
      const toolsLabel = document.createElement('p');
      toolsLabel.className = 'manual__section';
      toolsLabel.textContent = 'Tools: ' + entry.tools.map((t) => t.toUpperCase()).join(' · ');
      body.append(toolsLabel);
    }

    const stepsHead = document.createElement('p');
    stepsHead.className = 'manual__section';
    stepsHead.textContent = 'Steps';
    const ol = document.createElement('ol');
    ol.className = 'prose';
    for (const s of entry.steps) {
      const li = document.createElement('li');
      li.append(wrapTerms(s, onTap));
      ol.append(li);
    }
    body.append(stepsHead, ol);

    if (entry.failureModes.length > 0) {
      const fmHead = document.createElement('p');
      fmHead.className = 'manual__section';
      fmHead.textContent = 'Where it goes wrong';
      const ul = document.createElement('ul');
      ul.className = 'prose';
      for (const f of entry.failureModes) {
        const li = document.createElement('li');
        li.append(wrapTerms(f, onTap));
        ul.append(li);
      }
      body.append(fmHead, ul);
    }

    const verifyWrap = document.createElement('div');
    verifyWrap.className = 'manual__verify';
    const vHead = document.createElement('p');
    vHead.className = 'manual__section';
    vHead.textContent = 'Verify';
    const vBody = document.createElement('p');
    vBody.className = 'prose';
    vBody.append(wrapTerms(entry.verify, onTap));
    verifyWrap.append(vHead, vBody);
    body.append(verifyWrap);

    if (entry.openTool) {
      const a = document.createElement('a');
      a.className = 'manual__open';
      a.href = toolHref(entry.openTool.route, entry.openTool.params);
      a.textContent = `Open ${entry.openTool.route.toUpperCase()}`;
      body.append(a);
    }

    body.append(defPanel);
    title.scrollIntoView?.();
  };

  /* --- list view --- */
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'manual__search';
  search.placeholder = 'Search tasks — mirror, crown, stud…';
  search.setAttribute('aria-label', 'Search the manual');

  const list = document.createElement('ul');
  list.className = 'manual__list';

  const renderList = (query: string): void => {
    list.replaceChildren();
    const hits = searchManual(query);
    if (hits.length === 0) {
      const li = document.createElement('li');
      li.className = 'manual__empty prose';
      li.textContent = 'No task matches. Search shorter — one word finds more.';
      list.append(li);
      return;
    }
    for (const entry of hits) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'manual__item';
      btn.dataset['slug'] = entry.slug;
      const t = document.createElement('span');
      t.className = 'manual__item-title display';
      t.textContent = entry.title;
      const g = document.createElement('span');
      g.className = 'manual__item-goal';
      g.textContent = entry.goal;
      btn.append(t, g);
      btn.addEventListener('click', () => showEntry(entry));
      li.append(btn);
      list.append(li);
    }
  };

  const showList = (query: string): void => {
    body.replaceChildren(search, list);
    renderList(query);
    search.focus?.({ preventScroll: true });
  };

  search.addEventListener('input', () => renderList(search.value));

  showList('');
  el.append(root);
  return () => {
    root.remove();
  };
}
