/**
 * Bridge from the tour engine's injected deps (src/guidance/tour.ts) to A7's
 * coach-mark component. Shared by CORNER and CALIBRATE (A3b's tools).
 *
 * Subtlety, on purpose: coachMark dismisses on ANY tap (it must never block
 * the control underneath). For event-advanced steps, the engine treats a
 * dismissal as "hide this step forever" — which must NOT happen when the tap
 * was the user simply operating the tool (placing a mark, pressing START).
 * So the dismissal only propagates to the engine when the tap landed on the
 * mark itself; any other tap hides the prompt visually while the step stays
 * armed and still advances on its real event.
 */
import { coachMark } from '../../ui/components/coach';
import type { GuideDeps, GuideStep } from '../../guidance/tour';

export function coachRenderDep(root: HTMLElement): GuideDeps['render'] {
  return (step: GuideStep, onDismiss: () => void): (() => void) => {
    const anchor =
      (step.anchor ? root.querySelector<HTMLElement>(step.anchor) : null) ?? root;
    let torn = false;
    let tappedOnMark = false;
    const mark = coachMark(anchor, step.text, {
      onDismiss: () => {
        if (torn) return;
        if (step.advanceOn === 'tap' || tappedOnMark) onDismiss();
      },
    });
    const onMarkPointer = (): void => {
      tappedOnMark = true;
    };
    mark.addEventListener('pointerdown', onMarkPointer);
    mark.addEventListener('keydown', onMarkPointer);
    return () => {
      torn = true;
      mark.removeEventListener('pointerdown', onMarkPointer);
      mark.removeEventListener('keydown', onMarkPointer);
      mark.dismiss();
    };
  };
}

/** No live sensor stream drives these guides — steps advance on custom events. */
export const noSensorHook: GuideDeps['sensorHook'] = () => () => undefined;
