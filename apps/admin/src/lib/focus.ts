/**
 * Gives the focus to `el` when it fell to the page, as when the control that had it left the screen. A focus the user
 * moved on to meanwhile is left where it is.
 */
export function refocus(el: HTMLElement | null | undefined) {
  if (document.activeElement === document.body) el?.focus();
}
