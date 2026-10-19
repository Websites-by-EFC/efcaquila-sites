// @efcaquila/sites — Aquila's runtime for a bundled school website: lead posting, attribution, hand-off URLs.
//
// Published to public npm (1.0.0 on 2026-10-19, epic 13325804047 L6, by trusted publishing from the mirror
// repository Websites-by-EFC/efcaquila-sites; 0.1.0 to 0.2.1 of July and August 2026 are superseded) AND
// the three EFC templates' shared module: the academy, school and abbi template packages take it as
// `file:../efcaquila-sites` and bundle it into the artifacts schools are served. It posts enquiries to the
// Aquila Edge's store-and-forward rail (`/embed/contact`; abuse controls enforced Edge-side), carries
// first-touch marketing attribution (utm/click-ids/referrer/GA4) on every lead and every hosted hand-off
// link, and reads the Edge's packages and trial-availability feeds. A site with NO build step does not
// need it: it pastes the Edge's script (`{edge}/embed/v1.js`, the `<efc-form>`, `<efc-sessions>` and
// `<efc-packages>` elements; the guide is served at `{edge}/embed/v1/README.md`).
//
// Usage (a bundled site, or inside a template):
//   import { configure, submitLead } from "@efcaquila/sites";
//   configure({ edge: "<forms address>", site: "<embed token>" });   // a template reads both off content.json
//   const result = await submitLead("contact", { firstName, lastName, email, phone, message });

import { getAttribution, captureFirstTouch, decorateUrl, installedChannels, ATTRIBUTION_KEYS } from "./attribution.js";

export { getAttribution, captureFirstTouch, decorateUrl, installedChannels, ATTRIBUTION_KEYS };

/** Field names the Edge treats as HONEYPOTS: a non-empty value in any of them makes the Edge answer
 *  with a fake success and store nothing. `_hp` is the one a template binds its hidden input to. Never name
 *  a VISIBLE input any of these — the visitor's real answer would silently bin the lead. Mirrors
 *  `Aquila.Edge.Abuse.AbuseGate.ReservedKeys` (the Edge is the authority; this is documentation). */
export const HONEYPOT_FIELDS = ["_hp", "honeypot"] as const;

export interface AquilaSitesConfig {
    /** The Aquila Edge base URL the forms submit to — the "Forms address" on the site's Website tab in
     *  Aquila (Launch section). Per environment, never per site; a trailing slash is tolerated. */
    edge: string;
    /** The site's embed token — the "Embed token" on the same tab. A public identifier (it rides
     *  every site's own pages), not a secret. Rotating it in Aquila breaks a built site until it is
     *  rebuilt with the new value and re-uploaded. */
    site: string;
}

export interface LeadFields {
    /** The participant (student / member-to-be). */
    firstName: string;
    lastName?: string;
    /** Email or phone is required for the lead to be usable. */
    email?: string;
    phone?: string;
    /** Parent / guardian for a minor — defaults to the participant's own name in Aquila. */
    contactFirstName?: string;
    contactLastName?: string;
    postCode?: string;
    address1?: string;
    town?: string;
    county?: string;
    /** Free-text enquiry. */
    message?: string;
    /**
     * WHICH PROGRAMME the visitor said they were interested in — the Aquila programme's own id, from
     * a site that has linked its authored programmes to the location's real ones.
     *
     * It rides the body beside the other fields, and it is a CHOICE
     * rather than a guess: set it only from a control the visitor could see and change, never from
     * the page they happened to be on with no control offered, and never inferred from the message.
     * A site that links no programmes never sends it, so a submission from one is byte-identical to
     * a submission from before this member existed.
     *
     * It does not replace {@link LeadFields.message}: an interest typed into the enquiry is still an
     * interest typed into the enquiry, and a person still reads it. This is the same interest
     * expressed as something Aquila can act on.
     */
    programmeId?: string;
    /** Bind a HIDDEN input to this — a filled value marks the submission as a bot (silently dropped). */
    _hp?: string;
    /** How long the form was in front of the visitor, in milliseconds. **You almost never set this** —
     *  this module measures it for you (see {@link markLeadFormMounted}) and only uses your value when you
     *  pass a finite number, which is for a form whose own mount you can time more precisely than the
     *  module can. Aquila reads it as weak evidence of a script: a submission with NO message sent in
     *  under a second lands in the school's junk folder (recoverable in one click) instead of becoming
     *  a lead. A submission WITH a message is judged on the words, never on the clock. */
    dwellMs?: number;
    /** Compliance attestations captured with the submission — see {@link ComplianceFields}. */
    compliance?: ComplianceFields;
    /** Anything extra rides along verbatim (stored with the lead payload). */
    [key: string]: unknown;
}

/** Compliance attestations riding a lead. An ENVELOPE rather than a bare consent object on
 *  purpose: future compliance-adjacent attestations (terms acceptance, media consent, waivers)
 *  join beside `consent` instead of each colonising the payload root. Omit the whole envelope
 *  when nothing was attested — absence means absence, and the lead lands exactly as before. */
export interface ComplianceFields {
    /** Marketing-consent ticks the visitor explicitly made — see {@link MarketingConsentFields}. */
    consent?: MarketingConsentFields;
}

/** Marketing-consent flags from the form's consent checkbox. Set a flag true ONLY for an explicit
 *  affirmative tick the visitor made on an unticked-by-default, never-required checkbox — NEVER
 *  derive it from the submission itself (submitting an enquiry is not consenting to marketing,
 *  and a pre-ticked box is legally void). Exactly `true` mints an Express marketing-consent grant
 *  in Aquila for the submitted address on that channel; `false` or absent mints NOTHING (absence
 *  of consent is not an opt-out). */
export interface MarketingConsentFields {
    /** The visitor ticked "you may text me about news and offers" (SMS marketing). */
    marketingSms?: boolean;
    /** The visitor ticked "you may email me about news and offers" (email marketing). */
    marketingEmail?: boolean;
}

export interface SubmitOptions {
    /** Cloudflare Turnstile response token — required when the Edge has Turnstile enabled. */
    turnstile?: string;
    /** Client-supplied idempotency key: a retried submit with the same key is stored once. */
    idempotencyKey?: string;
    /** AbortSignal for the underlying fetch. */
    signal?: AbortSignal;
    /**
     * WHICH LOCATION the visitor is enquiring with, on a site that fronts more than one — the
     * Location's id, from the site's own list (`GET /embed/config` answers it as `locations`, and the
     * EFC templates read it off their content pack).
     *
     * The Edge lands the lead there when the site fronts that Location — its owner or one LINKED to
     * it — and at the site's owner otherwise, logged rather than refused: a bad value never costs the
     * lead. Leave it unset for the owner, which is what every site did before linked locations
     * existed; a submission that passes nothing here is byte-identical on the wire to one from
     * before this member existed.
     */
    location?: string;
}

export type LeadResult =
    | { success: true; reference?: string }
    | {
          success: false;
          /** `"invalid"` = the Edge held the submission to Aquila's own lead contract and refused it;
           *  `fieldErrors` says which fields and why, and the visitor can fix it. `"rejected"` = an abuse
           *  gate (origin allow-list / Turnstile) said no, which the visitor cannot fix. */
          error: "rejected" | "network" | "invalid" | string;
          /** Field name → message, present only for `"invalid"`. Render these against the inputs: this
           *  is the one refusal the person filling the form is able to act on. */
          fieldErrors?: Record<string, string>;
      };

/** One sign-up package, as served by the Edge's `/embed/packages` (Aquila Ingest v1
 *  `PackageOption`, camelCase): name, optional one-off sign-up fee (recurring price is shown on
 *  the hosted page), and the absolute hosted enrol+pay URL. */
export interface PackageOption {
    name?: string;
    signUpFee?: number;
    /** The hosted enrol+pay flow, DECORATED with this visitor's attribution bag ({@link decorateUrl})
     *  so the sign-up that happens on `forms.<domain>` can be attributed to the click that paid for
     *  it. Render it verbatim — never rebuild it from parts — and resolve it through
     *  {@link resolvePackageUrl} on the click, which adds the page's `efc_tags` consent attestation
     *  as late as it can be read. */
    url?: string;
}

/** Where a trial slot's class actually runs — the HOST Location's name and address. The feed
 *  deliberately includes account-pooled sessions hosted at sibling Locations, so a picker must
 *  render these on every tile: "which venue is nearest me" is answered by reading. */
export interface AvailabilityVenue {
    name?: string;
    address1?: string;
    address2?: string;
    town?: string;
    county?: string;
    postCode?: string;
}

/** One bookable trial slot, as served by the Edge's `/embed/availability` (the synced
 *  `WebsiteAvailability` snapshot, camelCase). Times are VENUE-LOCAL wall time and must be
 *  rendered as-is — never converted through the viewer's clock.
 *
 *  EVERY slot carries `bookUrl` as of 2026-09-10, free and paid alike: Aquila's hosted booking
 *  form takes the visitor's details, the fee where there is one, and writes the booking, and
 *  `bookingFee` now only decides what a Book control SAYS. Consume the URL exactly as served —
 *  never rebuild it. The one slot without one is a row whose host Location could not be resolved,
 *  which nothing can book.
 *
 *  Like a package's `url`, a served `bookUrl` is DECORATED with this visitor's attribution bag
 *  ({@link decorateUrl}) on the way out of {@link getAvailability}, so the member a trial booking
 *  creates on `forms.<domain>` carries the same first-touch provenance an enquiry does — it was the
 *  one hosted hand-off that had never carried any. Resolve it through {@link resolveHandoffUrl} on
 *  the click, which adds the page's `efc_tags` consent attestation as late as it can be read. */
export interface AvailabilitySlot {
    /** Venue-local start, ISO without offset (e.g. "2026-07-01T17:30:00"). */
    startsAt?: string;
    sessionId?: string;
    name?: string;
    /** Venue-local "HH:mm". */
    start?: string;
    end?: string;
    bookingFee?: number;
    /** Hosted booking flow for a paid slot; null/absent for free ones. */
    bookUrl?: string | null;
    /** Host Location's name + address; null/absent when the feed row carried no snapshot. */
    venue?: AvailabilityVenue | null;
    /** `true` when a SIBLING Location of the same account runs the class; ABSENT for a local one, so
     *  a feed served before this member existed is byte-identical and absent reads as local. A pooled
     *  slot may be offered anywhere a local one is: its `bookUrl` names the site's own Location, so the
     *  lead stays there and the booking sits on the sibling's class. Name its `venue` (Ian, 2026-09-23). */
    pooled?: boolean;
}

let config: AquilaSitesConfig | null = null;

/** A monotonic reading in milliseconds, or `null` where the browser has no `performance.now`
 *  (very old engines, some embedded webviews) — in which case nothing is measured and nothing is
 *  sent. `Date.now()` is deliberately NOT the fallback: it is wall-clock, it jumps, and a negative
 *  or absurd "dwell" from a clock change is worse than no reading at all. */
function now(): number | null {
    try {
        return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : null;
    } catch {
        return null;
    }
}

/** When the lead form came in front of the visitor. Set at module evaluation — which is when the
 *  page's own bundle ran, i.e. first render — and re-set by {@link configure} (every site calls it
 *  at app start) and by {@link markLeadFormMounted}. `null` means unmeasurable. */
let formShownAt: number | null = now();

/** Configure once at app start. Also captures the visitor's first-touch attribution
 *  immediately (write-once), so it survives navigation before the form is ever opened.
 *
 *  It also starts the dwell clock — see {@link markLeadFormMounted}. */
export function configure(next: AquilaSitesConfig): void {
    config = next;
    captureFirstTouch();
    formShownAt = now();
}

/**
 * Restart the dwell clock, for a form that appears later than the page does (a modal, a route
 * change, a tab). **Optional**: this module already starts the clock at load and at {@link configure},
 * which is right for a page whose form is part of its first render — so a site that does nothing
 * measures something sensible, and the three EFC templates need no change at all.
 *
 * What the measurement is FOR: Aquila treats a submission that carries no message and was sent in
 * under a second as a script rather than a person — nobody types a name, an email and a phone
 * number that fast — and parks it in the school's junk folder, where one click turns it into a lead
 * if it was real. Calling this when your form actually appears makes that judgement fairer to the
 * visitor, never harsher: it can only ever make a measured dwell LONGER.
 */
export function markLeadFormMounted(): void {
    formShownAt = now();
}

/** The dwell to send with a submission, in whole milliseconds — the caller's own reading when they
 *  passed a finite one, else this module's, else `null` for "not measured", which Aquila treats as no
 *  signal at all rather than as zero. Clamped at 0 because a clock that appears to run backwards is
 *  a broken reading, not an instant submission. */
function resolveDwell(supplied: unknown): number | null {
    if (typeof supplied === "number" && Number.isFinite(supplied)) return Math.max(0, Math.round(supplied));

    const started = formShownAt;
    const sent = now();
    if (started === null || sent === null) return null;
    return Math.max(0, Math.round(sent - started));
}

/**
 * Submit an enquiry to the Aquila Edge rail (`POST /embed/contact`). Resolves `{ success: true }`
 * when the Edge has durably stored the lead — Aquila being down never fails a submission
 * (store-and-forward). `contact` is the only type: the trial rail (`submitLead("trial", …)` and the
 * Edge's `/embed/trial`) was retired on 2026-10-08 — a trial is booked through a slot's `bookUrl`.
 */
export async function submitLead(
    type: "contact",
    fields: LeadFields,
    options: SubmitOptions = {}
): Promise<LeadResult> {
    if (!config) {
        return { success: false, error: "@efcaquila/sites is not configured — call configure() first." };
    }

    const payload: Record<string, unknown> = {
        ...fields,
        attribution: getAttribution(),
    };

    // How long the form was in front of them. ABSENT when it could not be measured — never 0, which
    // a rule downstream would read as "submitted instantly" and act on. See resolveDwell.
    const dwellMs = resolveDwell(fields.dwellMs);
    if (dwellMs === null) delete payload.dwellMs;
    else payload.dwellMs = dwellMs;

    const body = {
        site: config.site,
        fields: payload,
        idempotency: options.idempotencyKey,
        turnstile: options.turnstile,
        // ONLY when set: a site that names no Location sends exactly the body it always sent, and the
        // Edge lands the lead at the site's owner as it always has.
        ...(options.location ? { location: options.location } : {}),
    };

    try {
        // ?site= rides the POST as well as the reads: it lets the Edge scope its CORS answer to THIS
        // site instead of to any site in the fleet. The token is in the body too — this is the copy
        // that is visible before the body is read.
        const url = `${config.edge.replace(/\/+$/, "")}/embed/${type}?site=${encodeURIComponent(config.site)}`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: options.signal,
        });

        if (response.status === 202) {
            let reference: string | undefined;
            try {
                reference = ((await response.json()) as { reference?: string }).reference;
            } catch {
                /* a 202 without a body is still a success */
            }
            return { success: true, reference };
        }
        if (response.status === 403) {
            // Origin not allowed for this site, or the Turnstile check failed.
            return { success: false, error: "rejected" };
        }
        if (response.status === 400) {
            // The Edge enforces Aquila's lead contract at the door, so an invalid submission is refused
            // to the visitor's face instead of being stored, thanked for, and then parked undeliverable
            // on the first drain. Surface the per-field reasons — they are the actionable half.
            return { success: false, error: "invalid", fieldErrors: await readFieldErrors(response) };
        }
        return { success: false, error: `Submission failed (${response.status})` };
    } catch {
        return { success: false, error: "network" };
    }
}

/** Flatten an RFC7807 validation body (`{ errors: { field: [msg, …] } }`) to one message per field.
 *  An unreadable or differently-shaped body yields `{}` — the caller still knows it was invalid. */
async function readFieldErrors(response: Response): Promise<Record<string, string>> {
    try {
        const body = (await response.json()) as { errors?: Record<string, unknown> };
        const errors = body?.errors;
        if (!errors || typeof errors !== "object") return {};

        const flat: Record<string, string> = {};
        for (const [field, value] of Object.entries(errors)) {
            const message = Array.isArray(value) ? value[0] : value;
            if (typeof message === "string" && message) flat[field] = message;
        }
        return flat;
    } catch {
        return {};
    }
}

/**
 * The site's sign-up packages AS ANSWERED by the Edge (`GET /embed/packages?site=…`, proxied live
 * to the Location's home-region Aquila) — the list when it answered (**possibly empty**), and
 * `null` when we never got an answer at all: unconfigured, network error, non-2xx, or a body that
 * isn't an array.
 *
 * The distinction {@link getPackages} throws away is load-bearing for anything that reshapes the
 * SITE around the feed rather than just declining to draw a band. "The school has published no
 * packages" is a fact about the school; "the Edge is down" is a fact about this minute — a
 * template drops its packages nav entry on the first and must keep it on the second, or a
 * transient outage rewrites the navigation of every site that renders one.
 *
 * EVERY OPTION'S `url` IS DECORATED with the visitor's attribution bag on the way out — see
 * {@link decorateUrl} — for EVERY visitor, with no gate in front of it. It happens HERE rather than
 * in each template's card component because this is the one place the package feed and the
 * attribution store meet, and it is the same job this module already does for `submitLead` (which
 * merges `getAttribution()` into every lead): a hosted flow we hand a visitor to is a submission we
 * have not received yet. Doing it here also means the three template packages get it without
 * rendering a single line differently.
 *
 * **The bag is first-party CRM provenance and is not consent-gated** — the same ruling the lead rail
 * has always run on. What IS gated is firing the school's vendor tags on the hosted page, and that
 * licence is a separate parameter added at CLICK time by {@link resolvePackageUrl}: feed-time
 * decoration deliberately carries the bag and never `efc_tags`, because the marker it reads can
 * change (a visitor accepts a banner) long after this answer was memoised by the caller.
 */
export async function getPackagesFeed(options: { signal?: AbortSignal } = {}): Promise<PackageOption[] | null> {
    if (!config) return null;
    try {
        const url = `${config.edge.replace(/\/+$/, "")}/embed/packages?site=${encodeURIComponent(config.site)}`;
        const response = await fetch(url, { signal: options.signal });
        if (!response.ok) return null;
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) return null;
        return (body as PackageOption[]).map((option) =>
            option && option.url ? { ...option, url: decorateUrl(option.url) } : option
        );
    } catch {
        return null;
    }
}

/** The query parameter carrying a page's own attestation of which conversion channels it installed:
 *  the school's site telling the hosted flow "the school's tags are running here, under this
 *  visitor's consent". Aquila admits the same closed vocabulary on the far side and reads anything
 *  else as absent. A FIRING SIGNAL ONLY — it is never stored on the member. */
const TAGS_PARAM = "efc_tags";

/**
 * The URL a hand-off control should actually reach, resolved AT CLICK TIME — a package CTA's
 * `href`, and since 2026-09-10 a trial slot's Book control too (an `href` in a session band, the
 * `action` of the contact form's Book form). One resolver for every hop out of a school's site into
 * a hosted Aquila flow, because the two rules below are the same two rules whatever is being handed
 * over. (It was `resolvePackageUrl` until then; the old name is still exported as an alias so the
 * templates' `packageLinkProps` keep working unchanged.)
 *
 * Two things ride a hosted hand-off link, and they answer to different rules:
 *
 *   1. **the attribution bag** — first-party CRM provenance, already on the URL the feed served
 *      ({@link getPackagesFeed}) and re-applied here so a link minted before the GA cookies existed
 *      still carries them. Never gated. `decorateUrl` never overwrites, so this is idempotent;
 *   2. **`efc_tags`** — the page's attestation of the school's own installed channels
 *      ({@link installedChannels}), added only when the marker names one. This is the CONSENT
 *      SIGNAL, and it is what licenses Aquila's hosted confirmation page to fire the school's vendor
 *      tags for this purchase. `none` and an absent marker both add nothing.
 *
 * **Why click time.** The marker is not stable for the life of a page: on a `required` posture the
 * install is blocked until the visitor accepts, and the packages feed is typically fetched and
 * memoised at boot — long before anyone reaches the banner. Resolving here means a visitor who
 * accepts mid-session gets a correctly licensed link on their very next click, with no cache to
 * invalidate and no ordering to get right. A visitor who declines, or a school with no tags at all,
 * simply never adds the parameter — and still carries their provenance.
 *
 * Never throws: a URL it cannot parse, or a browserless pass, comes back as `decorateUrl` left it.
 * A parameter the link already carries is never overwritten — the server minted that link.
 */
export function resolveHandoffUrl(url: string): string {
    const decorated = decorateUrl(url);
    const channels = installedChannels();
    if (!channels) return decorated;
    try {
        const target = new URL(decorated);
        if (target.searchParams.has(TAGS_PARAM)) return decorated;
        target.searchParams.set(TAGS_PARAM, channels);
        return target.toString();
    } catch {
        return decorated;
    }
}

/**
 * The original name of {@link resolveHandoffUrl}, kept as an alias.
 *
 * It was named for the only hand-off that existed when it was written. The templates' call sites
 * still use it; keeping one implementation under two names costs a line. New callers use the neutral
 * name.
 */
export const resolvePackageUrl = resolveHandoffUrl;

/**
 * Fetch the site's sign-up packages from the Edge. Best-effort: resolves `[]` on ANY failure —
 * unconfigured, network error, non-2xx, or a non-array body — so package sections simply don't
 * render rather than erroring the page. Callers that need to tell "no packages" from "no answer"
 * read {@link getPackagesFeed} instead; this stays the flattened view every card renderer wants.
 */
export async function getPackages(options: { signal?: AbortSignal } = {}): Promise<PackageOption[]> {
    return (await getPackagesFeed(options)) ?? [];
}

/**
 * Fetch the site's bookable trial slots from the Edge (`GET /embed/availability?site=…` — the
 * availability snapshot Aquila syncs, so it answers with no live Aquila call). Best-effort with
 * the same contract as {@link getPackages}: resolves `[]` on ANY failure, so session sections
 * degrade to their authored fallback rather than erroring the page.
 *
 * EVERY SLOT'S `bookUrl` IS DECORATED with the visitor's attribution bag on the way out — see
 * {@link decorateUrl} — for EVERY visitor, with no gate in front of it, exactly as
 * {@link getPackagesFeed} has decorated every package `url` since 2026-09-01. Availability was the
 * hand-off that had never carried any, so a member created by a trial booking arrived on the
 * school's own CRM with no first-touch provenance at all while a member created by the same
 * visitor's enquiry or purchase arrived with the lot.
 *
 * It happens HERE for the same reason it happens there: this is the one place the feed and the
 * attribution store meet, so every template package gets it without rendering a line differently.
 * The bag is first-party CRM provenance and is NOT consent-gated;
 * what IS gated — firing the school's vendor tags on the hosted page — is a separate parameter
 * added at CLICK time by {@link resolveHandoffUrl}, because the marker it reads can change (a
 * visitor accepts a banner) long after this answer was memoised by the caller.
 *
 * `location` asks for ONE Location's slots on a site that fronts several (see
 * {@link SubmitOptions.location}): the Edge answers that Location's own snapshot, with Book links
 * naming it, when the site fronts it, and the owner's otherwise. Unset is the owner's, and the
 * request is byte-identical to the one made before the option existed.
 */
export async function getAvailability(
    options: { signal?: AbortSignal; location?: string } = {}
): Promise<AvailabilitySlot[]> {
    if (!config) return [];
    try {
        const url =
            `${config.edge.replace(/\/+$/, "")}/embed/availability?site=${encodeURIComponent(config.site)}` +
            (options.location ? `&location=${encodeURIComponent(options.location)}` : "");
        const response = await fetch(url, { signal: options.signal });
        if (!response.ok) return [];
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) return [];
        return (body as AvailabilitySlot[]).map((slot) =>
            slot && slot.bookUrl ? { ...slot, bookUrl: decorateUrl(slot.bookUrl) } : slot
        );
    } catch {
        return [];
    }
}
