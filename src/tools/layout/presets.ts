/**
 * LAYOUT presets — SPEC §4.4.3: the presets that make the tool feel built by
 * someone who has done the job. Each preset pre-fills the form AND states its
 * assumption in one line — an assumption the user cannot see is a lie waiting
 * to happen (SPEC §15).
 *
 * Values are strings in the same formats parseLength accepts, so applying a
 * preset is indistinguishable from typing — the fields stay ENTERED
 * provenance and stay editable.
 */
import type { LayoutMode } from './solver';

export interface LayoutPreset {
  id: string;
  name: string;
  /** One line: what this preset assumes. Rendered beside the form. */
  assumption: string;
  mode: LayoutMode;
  span: string;
  count: number;
  itemWidth?: string;
  margin?: string;
  pitch?: string;
  /** Extra context worth a second line (the 57″ standard, stud advice…). */
  note?: string;
}

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'gallery-wall',
    name: 'Gallery wall',
    mode: 'equal-gaps',
    span: `10'`,
    count: 5,
    itemWidth: '18"',
    assumption: 'Assumes frames hang with their centers at 57″ above the floor — the gallery-standard eye height.',
    note: 'Set the row height so each frame CENTER lands at 57″, then space the row with this table. Equal gaps reads better than equal centers when frame widths vary.',
  },
  {
    id: 'cabinet-pulls',
    name: 'Cabinet pulls',
    mode: 'fixed-pitch',
    span: '18"',
    count: 2,
    pitch: '96mm',
    assumption: 'Assumes a bar pull drilled at 96 mm center-to-center, centered on the drawer face. Standard pulls come in 96, 128 and 160 mm — edit the pitch to match yours.',
    note: 'For door pulls set a fixed margin from the stile edge instead — 2-1/2″ to 3″ from the corner is typical.',
  },
  {
    id: 'shelf-brackets',
    name: 'Shelf brackets',
    mode: 'equal-centers',
    span: `6'`,
    count: 3,
    assumption: 'Assumes brackets can shift to the nearest stud — tap USE FOUND STUDS below and put every bracket on one.',
    note: 'A bracket in drywall alone carries a picture, not a shelf.',
  },
  {
    id: 'curtain-rod',
    name: 'Curtain rod',
    mode: 'fixed-margins',
    span: `5' 8"`,
    count: 2,
    margin: '4"',
    pitch: `5'`,
    assumption: 'Assumes brackets 4″ past each side of the window so the curtain stacks off the glass.',
    note: 'Three brackets for rods over 6′ — add one at center.',
  },
  {
    id: 'fence-pickets',
    name: 'Fence pickets',
    mode: 'equal-gaps',
    span: `8'`,
    count: 21,
    itemWidth: '3-1/2"',
    assumption: 'Assumes 3-1/2″ pickets over an 8′ bay with equal gaps — adjust count until the gap lands near 1″.',
  },
  {
    id: 'tile-grout',
    name: 'Tile + grout',
    mode: 'fixed-pitch',
    span: `8'`,
    count: 8,
    pitch: '12-1/8"',
    assumption: 'Assumes 12″ tile with a 1/8″ grout line — pitch 12-1/8″, run centered so the cut tiles split evenly at both ends.',
  },
];
