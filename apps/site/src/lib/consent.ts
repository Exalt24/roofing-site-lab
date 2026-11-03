// Google Consent Mode v2, as the two inline snippets the site needs. The default must run BEFORE the Tag Manager snippet loads, so a tag never fires with storage the visitor has not allowed.
// The site's own rule is that advertising measurement is a separate, unticked box on the quote form: until it is ticked every signal stays denied, and unticking it denies them again.

export const CONSENT_SIGNALS = ["ad_storage", "ad_user_data", "ad_personalization", "analytics_storage"] as const;
export type ConsentSignal = (typeof CONSENT_SIGNALS)[number];

const state = (value: "granted" | "denied") => CONSENT_SIGNALS.map((s) => `${s}:'${value}'`).join(",");
const GTAG = "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}";

/** Runs first, on every page that loads Tag Manager: every signal denied, and Tag Manager waits up to half a second for an update before it reads the state. */
export function consentDefaultSnippet(): string {
  // COPY-OK: inline script text, never shown on screen
  return `${GTAG}gtag('consent','default',{${state("denied")},wait_for_update:500});`;
}

/** Runs when the measurement box changes: ticked grants all four signals, unticked denies all four. */
export function consentUpdateSnippet(checkboxName: string): string {
  if (!/^[a-z_]{3,40}$/.test(checkboxName)) throw new Error(`unsafe checkbox name: ${checkboxName}`);
  const find = `var b=document.querySelector("input[name='${checkboxName}']");if(!b)return;`;
  const grant = `{${state("granted")}}`;
  const deny = `{${state("denied")}}`;
  // COPY-OK: inline script text, never shown on screen
  return `${GTAG}(function(){${find}b.addEventListener("change",function(){gtag('consent','update',b.checked?${grant}:${deny});});})();`;
}

/** True when the page's HTML sets the consent default before it loads Tag Manager, with every signal denied. Used by the build test, and a swapped order must read false. */
export function consentComesFirst(html: string): boolean {
  const consent = html.indexOf("gtag('consent','default'");
  const gtm = html.indexOf("googletagmanager.com/gtm.js");
  if (consent < 0 || gtm < 0 || consent > gtm) return false;
  const call = html.slice(consent, html.indexOf(");", consent) + 2);
  return CONSENT_SIGNALS.every((s) => call.includes(`${s}:'denied'`));
}
