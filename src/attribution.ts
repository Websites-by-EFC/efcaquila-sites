// First-touch marketing attribution — a TypeScript port of the attribution.js the
// Websites-by-EFC sites already ship, keeping the SAME storage key and field names so a
// site that migrates onto this package keeps every existing visitor's first-touch record.
//
// First-touch fields are captured once (the first page a visitor lands on) and persisted in
// localStorage; GA4 ids are read live from the _ga / _ga_* cookies at submit time (the cookie
// may not exist on the very first pageview but will by the time a lead is submitted).
// Everything is optional and sparse — only fields with a real value are returned.

const STORAGE_KEY = "efc_attribution_v1";

// `msclkid` joined the list on 2026-09-01 with the package-conversion work. It is Microsoft
// Advertising's click id — the Bing half of the same closed vocabulary `gclid` and `fbclid` already
// covered — and its absence meant a school running Microsoft Ads got a lead (and now a purchase)
// with no way to attribute it to the click that paid for it, while the identical Google or Meta
// journey attributed fine. The pack has carried a `bingUet` tag id since 2026-08-21; this is the
// click id that tag's conversions are matched on. Additive: nothing downstream enumerates the list
// exhaustively (ingest's `attribution` is an open dictionary, clamped per pair), so an older site
// that never sends it is unaffected.
const QUERY_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_ad",
    "utm_content",
    "gclid",
    "fbclid",
    "msclkid",
] as const;

const FIRST_TOUCH_KEYS = [...QUERY_KEYS, "referrer_url", "landing_page_url"] as const;

/** Every attribution key this module can emit. */
export const ATTRIBUTION_KEYS = [...FIRST_TOUCH_KEYS, "ga4_client_id", "ga4_session_id"] as const;

function isBrowser(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

function isValidUrl(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function readQueryAttribution(): Record<string, string> {
    const out: Record<string, string> = {};
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(window.location.search);
    } catch {
        return out;
    }
    for (const key of QUERY_KEYS) {
        const value = params.get(key);
        if (value && value.trim()) out[key] = value.trim();
    }
    return out;
}

/** Capture & persist the first-touch record — write-once per browser; later calls return the
 *  stored record untouched (even on pages with different query strings). SSR/prerender-safe: a
 *  headless pass with no storage simply returns the current page's values without persisting. */
export function captureFirstTouch(): Record<string, string> {
    if (!isBrowser()) return {};

    let existing: unknown = null;
    try {
        existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
        /* unreadable storage — recapture below */
    }
    if (existing && typeof existing === "object") return existing as Record<string, string>;

    const data = readQueryAttribution();
    const referrer = document.referrer || "";
    if (referrer && isValidUrl(referrer)) data.referrer_url = referrer;
    const landing = window.location.href;
    if (isValidUrl(landing)) data.landing_page_url = landing;

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        /* storage unavailable (private mode) — still return this page's capture */
    }
    return data;
}

function getCookie(name: string): string | null {
    const re = new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)");
    const match = document.cookie.match(re);
    return match ? decodeURIComponent(match[1]) : null;
}

// _ga = GA1.1.<clientId>.<timestamp> → client id is the last two segments.
function ga4ClientId(): string | null {
    const ga = getCookie("_ga");
    if (!ga) return null;
    const parts = ga.split(".");
    return parts.length >= 4 ? parts.slice(-2).join(".") : null;
}

// _ga_<container> = GS1.1.<sessionId>.<…> → session id is the 3rd segment.
function ga4SessionId(): string | null {
    const match = document.cookie.match(/_ga_[A-Z0-9]+=([^;]*)/);
    if (!match) return null;
    const parts = decodeURIComponent(match[1]).split(".");
    return parts.length >= 3 && parts[2] ? parts[2] : null;
}

/**
 * The attribute the template packages' `installAnalytics` stamps on `<html>` once it has actually
 * injected a school's measurement tags — `gtm`, `gtag`, `meta` (space-separated) or `none`.
 *
 * Read here rather than imported: `analytics.ts` lives in the three TEMPLATE packages (mirrored,
 * pinned by their own mirrors test) and this middleware is a separate package they depend on, never
 * the other way round. The attribute IS the contract between them, so it is spelt out on both sides
 * — a rename is a change to both, and the SDK test suite stamps it by hand exactly as the templates
 * write it.
 */
const ANALYTICS_MARKER = "data-efc-analytics";

/** The marker's channel vocabulary — CLOSED, and the same three tokens `installAnalytics` writes and
 *  `fireLeadConversion` reads. `none` is deliberately not one of them: it is the install's way of
 *  saying it put nothing conversion-capable on the page, which is the absence of a channel. */
const CHANNELS = ["gtm", "gtag", "meta"] as const;

/**
 * The conversion channels THIS page actually installed, normalised — or `null` when it installed
 * none.
 *
 * **This is the consent signal, read on the one domain that holds the answer.** The visitor's
 * Accept/Decline is a cookie on the school's OWN site; `installAnalytics` reads it, and on a
 * `required` posture with no recorded Accept it returns having injected nothing and having left the
 * marker unset. So a marker naming a channel is this page ATTESTING that the school's tags are
 * running here — which can only be true if that school's posture was satisfied.
 * `fireLeadConversion` reads the same attribute for the same reason, one step earlier in the funnel.
 *
 * Read LAZILY, at the moment it is needed, and never cached: consent arrives mid-visit, and a
 * visitor who accepts a banner changes this answer with no page reload behind it.
 *
 * Unknown tokens are dropped and duplicates collapse, so the answer is only ever the closed
 * vocabulary above. Never throws and never assumes a DOM: a pre-render pass has no document and
 * reads `null`.
 */
export function installedChannels(): string | null {
    if (typeof document === "undefined" || !document.documentElement) return null;
    const marker = document.documentElement.getAttribute(ANALYTICS_MARKER);
    if (!marker) return null;
    const named = [...new Set(marker.trim().split(/\s+/))].filter((token) =>
        (CHANNELS as readonly string[]).includes(token)
    );
    return named.length > 0 ? named.join(" ") : null;
}

/**
 * Longest value carried on a DECORATED URL. Aquila's own store caps a pair at 2048 characters, and
 * this is deliberately far shorter: a decorated link is a real URL that browsers, proxies and the
 * odd mail client have their own opinions about past ~2000 characters, and the only two fields that
 * ever approach it (`referrer_url`, `landing_page_url`) are still recognisable at 512. Truncating
 * one of those costs a long query string; letting the URL blow the limit costs the whole hop.
 */
const MAX_DECORATED_VALUE = 512;

/**
 * Return `url` with this visitor's attribution bag appended as query parameters — the mechanism that
 * carries first-touch attribution ACROSS A DOMAIN HOP, from the school's own site to an Aquila-hosted
 * flow on `forms.<domain>`.
 *
 * Why it exists: the school's measurement tags live on the SITE. A visitor who arrives from a Google
 * ad and buys a package leaves the site at the checkout link, and everything after that — the sign-up,
 * the payment, the confirmation — happens on a host that has never seen the click id. The purchase was
 * therefore invisible to the ad platform that paid for it, which is the same blind-optimisation
 * problem `fireLeadConversion` solved for enquiries, one step further down the funnel.
 *
 * It carries {@link ATTRIBUTION_KEYS} AND NOTHING ELSE. The vocabulary is closed on purpose: the
 * receiving end treats every parameter as hostile input and admits only these names, so a key that
 * exists on one side and not the other is silently dropped rather than half-supported. Values are
 * capped ({@link MAX_DECORATED_VALUE}) for the same reason.
 *
 * It never overwrites a parameter the target URL already carries — the server minted that link and
 * its own values win — and it never throws: a relative URL, a malformed one, or a browserless
 * (pre-render) pass all return the URL exactly as given. An empty bag is a no-op, so a visitor with
 * no attribution to carry gets the byte-identical link they got before this existed.
 *
 * UNCONDITIONAL, AND THAT IS THE RULING (2026-09-01): the bag is FIRST-PARTY CRM PROVENANCE — where
 * this member came from, stored on their own record by the school they are joining — and it crosses
 * the hop for every visitor, exactly as `getAttribution()` rides every `submitLead` with no gate in
 * front of it. The consent-sensitive act is not carrying provenance, it is firing a school's VENDOR
 * tags on a hosted page; that is licensed separately and explicitly by `resolvePackageUrl`'s
 * `efc_tags` attestation ({@link installedChannels}). Two acts, two answers, one link.
 */
export function decorateUrl(url: string): string {
    if (!url || !isBrowser()) return url;
    let target: URL;
    try {
        // Absolute only, deliberately: resolving a relative URL against the current page would hand
        // the caller back an absolutised link it never asked for. The hosted-flow URLs this is used
        // on are absolute (the Edge serves them that way); anything else is left alone.
        target = new URL(url);
    } catch {
        return url;
    }

    const attribution = getAttribution();
    for (const key of ATTRIBUTION_KEYS) {
        const value = attribution[key];
        if (!value || target.searchParams.has(key)) continue;
        target.searchParams.set(key, value.length <= MAX_DECORATED_VALUE ? value : value.slice(0, MAX_DECORATED_VALUE));
    }
    return target.toString();
}

/** The attribution record to merge into a lead payload: the persisted first-touch fields plus
 *  live-read GA4 ids. Sparse — only fields with a real value are present. */
export function getAttribution(): Record<string, string> {
    if (!isBrowser()) return {};

    const firstTouch = captureFirstTouch();
    const out: Record<string, string> = {};
    for (const key of FIRST_TOUCH_KEYS) {
        if (firstTouch[key]) out[key] = firstTouch[key];
    }
    const clientId = ga4ClientId();
    if (clientId) out.ga4_client_id = clientId;
    const sessionId = ga4SessionId();
    if (sessionId) out.ga4_session_id = sessionId;
    return out;
}
