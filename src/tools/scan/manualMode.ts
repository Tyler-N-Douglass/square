/**
 * MANUAL STUD MODE — SPEC §4.1.9. Pure arithmetic, no sensors, genuinely
 * useful: the whole SCAN experience on Tier NONE and always one tap away on
 * every other tier.
 *
 * Every number obeys §5/§15.5: user inputs echo as ENTERED (dotted, never
 * orange), predicted centerlines render as DERIVED with a propagated ± band
 * that grows with distance from the reference (model.manualBandIn), and the
 * tape map is a flat, screenshot-friendly strip + table with exact rational
 * fraction formatting (units.ts — no float drift across a long wall).
 */
import { derivedEl, enteredEl } from '../../ui/components/number';
import {
  type Rational,
  add,
  formatInches,
  parseLength,
  rational,
  toNumber,
} from '../../geometry/units';
import {
  MANUAL_HONESTY_LINE,
  MANUAL_NOTES,
  OC_CHOICES,
  type ManualReferenceKind,
  predictStuds,
  referenceAdjustment,
} from './model';

export interface ManualPanel {
  el: HTMLElement;
  /** Recompute from current inputs (also runs on every input event). */
  compute(): void;
}

/** Fraction text for an exact rational, flagged when 1/16 display rounds. */
function fractionText(r: Rational): string {
  const f = formatInches(r, 16);
  return f.rounding === 'exact' ? f.text : `≈ ${f.text}`;
}

function labeled(id: string, labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'scan__field';
  const span = document.createElement('span');
  span.className = 'scan__fieldlabel';
  span.textContent = labelText;
  control.id = id;
  wrap.append(span, control);
  return wrap;
}

export function buildManualPanel(opts: { onComputed?: () => void } = {}): ManualPanel {
  const root = document.createElement('div');
  root.className = 'scan__manual';

  const h = document.createElement('h2');
  h.className = 'display';
  h.textContent = 'MANUAL STUD MODE';
  root.append(h);

  const intro = document.createElement('p');
  intro.className = 'scan__prose';
  intro.textContent =
    'No sensor required. Enter a reference you trust and the on-center spacing; read predicted centerlines with an honest ± band.';
  root.append(intro);

  /* ---- inputs ---- */
  const form = document.createElement('div');
  form.className = 'scan__manualform';

  const kindSel = document.createElement('select');
  kindSel.className = 'scan__input';
  for (const [v, t] of [
    ['corner', 'Corner / wall end'],
    ['outlet', 'Outlet or switch box edge'],
    ['stud', 'Known stud center'],
    ['other', 'Other reference'],
  ] as const) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    kindSel.append(o);
  }

  const refInput = document.createElement('input');
  refInput.className = 'scan__input';
  refInput.type = 'text';
  refInput.inputMode = 'text';
  refInput.value = '0';
  refInput.placeholder = 'e.g. 12-1/2, 2′, 320mm';

  const ocSel = document.createElement('select');
  ocSel.className = 'scan__input';
  for (const c of OC_CHOICES) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.label;
    ocSel.append(o);
  }

  const dirSel = document.createElement('select');
  dirSel.className = 'scan__input';
  for (const [v, t] of [
    ['1', 'Toward larger tape readings'],
    ['-1', 'Toward smaller tape readings'],
  ] as const) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    dirSel.append(o);
  }

  const spanInput = document.createElement('input');
  spanInput.className = 'scan__input';
  spanInput.type = 'text';
  spanInput.inputMode = 'text';
  spanInput.value = "8'";
  spanInput.placeholder = 'e.g. 96, 8′, 2440mm';

  form.append(
    labeled('scan-manual-refkind', 'Reference', kindSel),
    labeled('scan-manual-ref', 'Reference position on your tape', refInput),
    labeled('scan-manual-oc', 'On-center spacing', ocSel),
    labeled('scan-manual-dir', 'Layout direction', dirSel),
    labeled('scan-manual-span', 'Wall span', spanInput),
  );
  root.append(form);

  const echo = document.createElement('p');
  echo.className = 'scan__manualecho';
  root.append(echo);

  const err = document.createElement('p');
  err.className = 'scan__manualerr';
  err.hidden = true;
  root.append(err);

  const statement = document.createElement('p');
  statement.className = 'scan__prose';
  root.append(statement);

  /* ---- tape map: strip + table ---- */
  const map = document.createElement('div');
  map.className = 'scan__tapemap';

  const strip = document.createElement('div');
  strip.className = 'scan__strip';
  strip.setAttribute('aria-hidden', 'true');
  map.append(strip);

  const table = document.createElement('table');
  table.className = 'scan__tapetable';
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (const t of ['#', 'CENTERLINE', 'TAPE READING', 'FROM REFERENCE']) {
    const th = document.createElement('th');
    th.textContent = t;
    hrow.append(th);
  }
  thead.append(hrow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  map.append(table);
  root.append(map);

  /* ---- standard-practice notes + honesty line ---- */
  const notes = document.createElement('ul');
  notes.className = 'scan__prose scan__manualnotes';
  for (const n of MANUAL_NOTES) {
    const li = document.createElement('li');
    li.textContent = n;
    notes.append(li);
  }
  root.append(notes);

  const honesty = document.createElement('p');
  honesty.className = 'scan__manual-honesty';
  honesty.textContent = MANUAL_HONESTY_LINE;
  root.append(honesty);

  let computedOnce = false;

  const compute = (): void => {
    const refParsed = parseLength(refInput.value);
    const spanParsed = parseLength(spanInput.value);
    if (!refParsed || !spanParsed) {
      err.hidden = false;
      err.textContent = 'Enter lengths like 24, 2′ 6″, 610mm — a value it cannot read exactly stays unread.';
      return;
    }
    err.hidden = true;

    const kind = kindSel.value as ManualReferenceKind;
    const direction = dirSel.value === '-1' ? -1 : (1 as 1 | -1);
    const oc = OC_CHOICES.find((c) => c.id === ocSel.value) ?? OC_CHOICES[0]!;
    const refAdjusted = add(refParsed.inches, referenceAdjustment(kind, direction));
    const marks = predictStuds(refAdjusted, oc.inches, direction, spanParsed.inches);

    // Echo the ENTERED values in their own style — the user's numbers are
    // not claims the app makes.
    echo.replaceChildren(
      document.createTextNode('Entered: reference '),
      enteredEl(fractionText(refParsed.inches).replace(/″$/, ''), '″'),
      document.createTextNode(' · span '),
      enteredEl(fractionText(spanParsed.inches).replace(/″$/, ''), '″'),
      document.createTextNode(` · ${oc.label}`),
    );

    statement.textContent =
      kind === 'outlet'
        ? `Boxes fasten to a stud side — the first centerline below includes the 3/4″ standard-practice offset. ${marks.length} predicted centerlines.`
        : `${marks.length} predicted centerlines from your reference.`;

    // Strip — flat marks positioned along the span; band width to scale.
    strip.replaceChildren();
    const spanF = toNumber(spanParsed.inches);
    for (const m of marks) {
      const mark = document.createElement('div');
      mark.className = 'scan__stripmark';
      const leftPct = spanF > 0 ? (m.centerIn / spanF) * 100 : 0;
      const bandPct = spanF > 0 ? Math.max(0.5, ((2 * m.bandIn) / spanF) * 100) : 1;
      mark.style.left = `${(leftPct - bandPct / 2).toFixed(2)}%`;
      mark.style.width = `${bandPct.toFixed(2)}%`;
      const line = document.createElement('div');
      line.className = 'scan__stripline';
      mark.append(line);
      strip.append(mark);
    }

    // Table — DERIVED numbers with the propagated ± band, plus the exact
    // fraction a tape measure speaks.
    tbody.replaceChildren();
    const refFloat = toNumber(refAdjusted);
    for (const m of marks) {
      const tr = document.createElement('tr');
      const tdIdx = document.createElement('td');
      tdIdx.textContent = String(m.index);
      const tdCenter = document.createElement('td');
      tdCenter.append(derivedEl(m.centerIn, '″', m.bandIn, 'nominal', { decimals: 2 }));
      const tdFrac = document.createElement('td');
      const frac = document.createElement('span');
      frac.className = 'derived hud';
      frac.textContent = fractionText(m.center);
      frac.title = 'nearest 1/16″';
      tdFrac.append(frac);
      const tdFrom = document.createElement('td');
      const delta = m.centerIn - refFloat;
      tdFrom.append(derivedEl(Math.abs(delta), '″', m.bandIn, 'nominal', { decimals: 1 }));
      tr.append(tdIdx, tdCenter, tdFrac, tdFrom);
      tbody.append(tr);
    }

    if (!computedOnce && marks.length > 0) {
      computedOnce = true;
      opts.onComputed?.();
    }
  };

  for (const elx of [kindSel, refInput, ocSel, dirSel, spanInput]) {
    elx.addEventListener('input', compute);
    elx.addEventListener('change', compute);
  }
  compute();

  return { el: root, compute };
}
