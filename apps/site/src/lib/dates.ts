/** The day this build ran. Pages, videos and the sitemap are stamped with it, because that is when they were really published or last changed; the job's own finish date appears in the page text only. */
export const BUILD_DATE = new Date().toISOString().slice(0, 10);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** 2026-04-18 becomes "April 2026" (a homeowner does not read ISO dates). */
export function monthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}
