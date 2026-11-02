// Where the call console leaves the keyboard focus. A ring takes it to the newest call's Answer (the banner); when a
// card or the in-call bar that has it goes, or loses the control that had it, the focus goes on to what still needs
// the agent, else back to where it came into the console from, and never to the page itself, where a keyboard or a
// screen reader would start over at the top. The console's parts carry `data-call-console`, and the places the focus
// goes on to `data-call-focus`.
import type { FocusEvent } from 'react';

/** Where the focus came into the console from, while the console has it: it goes back there. */
let from: HTMLElement | null = null;
/** The focus is in the console, or fell from it to the page: it is out only once the agent moved it out. */
let held = false;

const inConsole = (el: EventTarget | null) => el instanceof Element && !!el.closest('[data-call-console]');

/** The main content, made able to take the focus for settleFocus's last resort, until it no longer has it. */
let lent: HTMLElement | null = null;
/**
 * The main content takes no focus but the one the console gives it: else a click beside every control (a header menu's
 * own text) would focus it, and close that menu. A window that loses the focus blurs it too, but it keeps the focus.
 */
function release() {
  if (!lent || document.activeElement === lent) return;
  lent.removeAttribute('tabindex');
  lent.removeEventListener('blur', release);
  lent = null;
}

/**
 * The console moves the focus to `el` (a ring to its Answer, a call to its bar), and keeps track of it as its focus
 * event would: a page behind another tab or window gets no focus events, the focus moves there silently.
 */
export function takeFocus(el: HTMLElement | null) {
  const was = document.activeElement;
  el?.focus();
  if (!el || document.activeElement !== el) return;
  held = true;
  if (was instanceof HTMLElement && was !== document.body && !inConsole(was)) from = was;
  release(); // the main content may have had it: behind another tab, no blur says it went
}

/** The focus events of each part of the console: the agent moving the focus into it, or out. */
export const consoleFocus = {
  onFocus(e: FocusEvent<HTMLElement>) {
    held = true;
    if (e.relatedTarget instanceof HTMLElement && !inConsole(e.relatedTarget)) from = e.relatedTarget;
  },
  onBlur(e: FocusEvent<HTMLElement>) {
    const el = e.target;
    // Not out: it moves within the console, the window lost it (the element keeps it), or the element went or was
    // disabled, which settleFocus makes up for.
    if (inConsole(e.relatedTarget) || document.activeElement === el || !el.isConnected || el.matches(':disabled')) return;
    // The agent moved it: to another element, or to the page itself (a click beside every control).
    held = false;
    from = null;
  },
};

// Where a focus that fell goes on to, in this order: the call this tab answers (its card's button) or is on (the bar),
// the newest call that rings (its Answer), a failed answer's card, which says why.
const NEXT = ['answering', 'live', 'ringing', 'failed'].map((at) => `[data-call-focus="${at}"]:not(:disabled)`);

/** After the console changed: a focus that fell from it to the page goes on, else back, else to the main content. */
export function settleFocus() {
  if (!held || (document.activeElement && document.activeElement !== document.body)) return;
  for (const selector of NEXT) {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].at(-1);
    el?.focus();
    if (el && document.activeElement === el) return;
  }
  held = false;
  from?.focus(); // unless it went, or can no longer take the focus
  if (!from || document.activeElement !== from) {
    lent = document.querySelector('main');
    if (lent) {
      lent.tabIndex = -1;
      lent.addEventListener('blur', release);
      lent.focus({ preventScroll: true });
    }
  }
  from = null;
}
