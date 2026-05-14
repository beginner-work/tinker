/* tinker — first-sign-in welcome card.
 *
 * One-time modal that lands when a tester completes their first
 * phone-OTP sign-in. Suppressed thereafter via the localStorage flag
 * tinker.welcomed.v1 so reloads / new sessions don't keep poking the
 * card up. Independent of auth.js — it just reads tinker_jwt to know
 * whether the user is signed in.
 *
 * Personal framing, no "beta" badge. The whole point is to make the
 * tester feel inside, not pre-launch.
 */

(function () {
  "use strict";

  const FLAG = "tinker.welcomed.v1";
  const JWT_KEY = "tinker_jwt";

  const card = document.getElementById("welcome-card");
  if (!card) return;

  function dismiss() {
    card.hidden = true;
    try { localStorage.setItem(FLAG, "1"); } catch (e) { /* ignore */ }
  }

  // Direct handlers (not delegated through the card) so stacking-
  // context surprises with the absolute-positioned backdrop can't
  // swallow the click before it reaches the button.
  const btn = card.querySelector(".welcome-card__btn");
  const backdrop = card.querySelector(".welcome-card__backdrop");
  if (btn) btn.addEventListener("click", dismiss);
  if (backdrop) backdrop.addEventListener("click", dismiss);
  document.addEventListener("keydown", (e) => {
    if (!card.hidden && e.key === "Escape") dismiss();
  });

  function maybeShow() {
    let signedIn = false;
    try { signedIn = !!localStorage.getItem(JWT_KEY); } catch (e) { /* ignore */ }
    let welcomed = false;
    try { welcomed = localStorage.getItem(FLAG) === "1"; } catch (e) { /* ignore */ }
    if (signedIn && !welcomed) {
      card.hidden = false;
      const btn = card.querySelector(".welcome-card__btn");
      if (btn) setTimeout(() => btn.focus(), 30);
    }
  }

  // The auth gate reloads the page after issuing the JWT, so a normal
  // boot will catch the just-signed-in state. A second poll covers
  // any flow that doesn't reload.
  maybeShow();
  setTimeout(maybeShow, 400);
})();
