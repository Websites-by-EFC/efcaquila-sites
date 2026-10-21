import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    configure,
    submitLead,
    getPackages,
    getPackagesFeed,
    getAvailability,
    getSessions,
    getAttribution,
    captureFirstTouch,
    decorateUrl,
    installedChannels,
    resolveHandoffUrl,
    resolvePackageUrl,
    ATTRIBUTION_KEYS,
    HONEYPOT_FIELDS,
    markLeadFormMounted,
} from "./index";

// The three EFC templates' shared runtime (an internal workspace module since 2026-10-08): it posts
// their enquiries to the Aquila Edge rail, carries attribution and resolves the hosted hand-off links.

describe("package identity", () => {
    it("documents the Edge's honeypot names so a form never uses one for a visible input", () => {
        // Mirrors Aquila.Edge.Abuse.AbuseGate.ReservedKeys — `website` was dropped from the Edge set on
        // 2026-08-24 because "your website" is a legitimate lead field. If the Edge set changes, change
        // this AND the README in the same commit.
        expect([...HONEYPOT_FIELDS]).toEqual(["_hp", "honeypot"]);
    });
});

/** Stamp the marker the templates' `installAnalytics` writes on `<html>` once it has actually
 *  injected a school's tags — i.e. once that school's consent posture was satisfied. Spelt out by
 *  hand rather than imported, because the attribute IS the contract between the two packages and a
 *  test that borrowed the writer's constant would pass through a rename that broke real sites. */
const installMarker = (channels: string) => document.documentElement.setAttribute("data-efc-analytics", channels);

const clearState = () => {
    window.localStorage.clear();
    // Expire any GA cookies a previous test set.
    for (const name of ["_ga", "_ga_ABC123"]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
    // No marker = the state a page is in before `installAnalytics` runs, and the state it STAYS in
    // for a `required`-posture visitor who has not accepted. Every decorating test opts in.
    document.documentElement.removeAttribute("data-efc-analytics");
    window.history.replaceState(null, "", "/");
};

beforeEach(clearState);
afterEach(() => vi.unstubAllGlobals());

describe("attribution", () => {
    it("captures first-touch utm/click-id fields and the landing page, write-once", () => {
        window.history.replaceState(null, "", "/?utm_source=google&utm_campaign=summer&gclid=abc123");
        const first = captureFirstTouch();
        expect(first.utm_source).toBe("google");
        expect(first.gclid).toBe("abc123");
        expect(first.landing_page_url).toContain("utm_source=google");

        // A later page with different params must NOT overwrite the first touch.
        window.history.replaceState(null, "", "/?utm_source=facebook");
        expect(getAttribution().utm_source).toBe("google");
    });

    it("reads GA4 client + session ids live from the _ga cookies", () => {
        window.history.replaceState(null, "", "/?utm_source=google");
        captureFirstTouch();
        document.cookie = "_ga=GA1.1.1111111.2222222";
        document.cookie = "_ga_ABC123=GS1.1.9999999.5.1.1700000000.0.0.0";

        const attribution = getAttribution();
        expect(attribution.ga4_client_id).toBe("1111111.2222222");
        expect(attribution.ga4_session_id).toBe("9999999");
    });

    it("returns a sparse record — no empty fields", () => {
        const attribution = getAttribution();
        for (const value of Object.values(attribution)) {
            expect(value).toBeTruthy();
        }
        expect(attribution.utm_source).toBeUndefined();
    });

    it("captures Microsoft Advertising's click id alongside Google's and Meta's", () => {
        // The Bing half of the vocabulary. A school running Microsoft Ads has carried a `bingUet`
        // tag id on its pack since 2026-08-21; without the click id the tag's conversions had
        // nothing to match on, so the identical journey attributed on Google and not on Bing.
        window.history.replaceState(null, "", "/?msclkid=bing-click-1&gclid=g1&fbclid=f1");
        const first = captureFirstTouch();
        expect(first.msclkid).toBe("bing-click-1");
        expect(first.gclid).toBe("g1");
        expect(first.fbclid).toBe("f1");
        expect([...ATTRIBUTION_KEYS]).toContain("msclkid");
    });
});

// The domain hop. A school's tags live on its own site; the package sign-up finishes on
// forms.<domain>, which has never seen the click. Decoration is what carries the bag across.
describe("decorateUrl", () => {
    it("appends every non-empty attribution key it holds, and nothing else", () => {
        window.history.replaceState(null, "", "/?utm_source=google&utm_campaign=summer&gclid=abc123");
        captureFirstTouch();
        document.cookie = "_ga=GA1.1.1111111.2222222";

        const decorated = new URL(decorateUrl("https://forms.example.com/package/abc"));
        expect(decorated.origin + decorated.pathname).toBe("https://forms.example.com/package/abc");
        expect(decorated.searchParams.get("utm_source")).toBe("google");
        expect(decorated.searchParams.get("utm_campaign")).toBe("summer");
        expect(decorated.searchParams.get("gclid")).toBe("abc123");
        expect(decorated.searchParams.get("ga4_client_id")).toBe("1111111.2222222");
        // Closed vocabulary — nothing outside ATTRIBUTION_KEYS is ever written.
        for (const key of decorated.searchParams.keys()) {
            expect([...ATTRIBUTION_KEYS]).toContain(key);
        }
    });

    it("leaves a parameter the minted link already carries exactly as the server set it", () => {
        window.history.replaceState(null, "", "/?utm_source=google");
        captureFirstTouch();

        const decorated = new URL(decorateUrl("https://forms.example.com/package/abc?utm_source=server-said-so"));
        expect(decorated.searchParams.getAll("utm_source")).toEqual(["server-said-so"]);
    });

    it("caps a long value rather than blowing the URL length budget", () => {
        window.history.replaceState(null, "", "/?utm_campaign=" + "c".repeat(900));
        captureFirstTouch();

        const decorated = new URL(decorateUrl("https://forms.example.com/package/abc"));
        expect(decorated.searchParams.get("utm_campaign")).toHaveLength(512);
    });

    it("leaves a relative URL, a malformed one and an empty one exactly as given", () => {
        window.history.replaceState(null, "", "/?utm_source=google");
        captureFirstTouch();
        // Relative is left alone deliberately: absolutising a link the caller handed us relative
        // would be a change it never asked for.
        expect(decorateUrl("/package/abc")).toBe("/package/abc");
        expect(decorateUrl("not a url at all")).toBe("not a url at all");
        expect(decorateUrl("")).toBe("");
    });

    it("carries the landing page even for a visitor who arrived with no campaign parameters", () => {
        // `captureFirstTouch` always records `landing_page_url` (and `referrer_url` when there is
        // one), so in a real browser the bag is never empty and every hosted link carries at least
        // where the visitor first landed — which is exactly what the lead rail already stores.
        // Worth pinning: it means "how did this member find us" is answerable for a direct visit too.
        const decorated = new URL(decorateUrl("https://forms.example.com/package/abc"));
        expect(decorated.searchParams.get("landing_page_url")).toBeTruthy();
        expect(decorated.pathname).toBe("/package/abc");
    });

    it("is unconditional — provenance crosses for every visitor, gated by nothing", () => {
        // THE RULING (2026-09-01). The bag is first-party CRM provenance: where this member came
        // from, on their own record, at the school they are joining — the same thing `submitLead`
        // has always attached to every lead with no gate in front of it. The consent-sensitive act
        // is firing a school's VENDOR tags, and that is licensed separately by `efc_tags`.
        window.history.replaceState(null, "", "/?utm_source=google");
        captureFirstTouch();
        expect(installedChannels()).toBeNull(); // no marker: nothing installed on this page

        const decorated = new URL(decorateUrl("https://forms.example.com/package/abc"));
        expect(decorated.searchParams.get("utm_source")).toBe("google");
        expect(decorated.searchParams.get("efc_tags")).toBeNull();
    });
});

// The consent signal, read on the domain that holds the answer. `installAnalytics` (in each template
// package) stamps this marker ONLY once the school's posture is satisfied — a `required` posture
// with no recorded Accept installs nothing and leaves it unset — so a marker naming a channel is the
// page attesting that the school's tags are running here. Same attribute `fireLeadConversion` reads.
describe("installedChannels", () => {
    it("returns the channels for every combination an install can record", () => {
        for (const channels of ["gtm", "gtag", "meta", "gtm meta", "gtag meta"]) {
            installMarker(channels);
            expect(installedChannels(), `marker "${channels}"`).toBe(channels);
        }
    });

    it("is null with no marker at all — the consent-gated visit", () => {
        expect(installedChannels()).toBeNull();
    });

    it('is null for "none" — installed, but carrying nothing a conversion can be reported to', () => {
        // A site whose only tags are Clarity/Hotjar/TikTok/Pinterest. `fireLeadConversion` fires
        // nothing on this page either: same marker, same answer.
        for (const marker of ["none", "  none  ", ""]) {
            installMarker(marker);
            expect(installedChannels(), `marker "${marker}"`).toBeNull();
        }
    });

    it("keeps only the closed vocabulary, and collapses duplicates", () => {
        // The value ends up on a URL and is read by a server that admits the same three tokens. A
        // token this package does not know is dropped here rather than carried and refused there.
        installMarker("gtm bogus meta gtm");
        expect(installedChannels()).toBe("gtm meta");
        installMarker("GTM");
        expect(installedChannels()).toBeNull();
    });

    it("never throws where there is no DOM — a pre-render pass reads null", () => {
        // The templates pre-render their pages through `entry-server`, where `document` does not
        // exist. Null is the safe answer: nothing attested, so nothing licensed.
        vi.stubGlobal("document", undefined);
        expect(installedChannels()).toBeNull();
    });
});

// The click-time resolution: the one place the two acts meet on one link.
describe("resolveHandoffUrl", () => {
    beforeEach(() => {
        window.history.replaceState(null, "", "/?utm_source=google&gclid=abc123");
        captureFirstTouch();
    });

    it("adds efc_tags naming the installed channels, alongside the bag", () => {
        installMarker("gtag meta");
        const resolved = new URL(resolveHandoffUrl("https://forms.example.com/package/a"));

        expect(resolved.searchParams.get("efc_tags")).toBe("gtag meta");
        expect(resolved.searchParams.get("gclid")).toBe("abc123");
    });

    it("adds NO efc_tags with no marker or a none marker — and still carries the bag", () => {
        // The refuser, and the school with no conversion-capable tag. Their provenance still rides;
        // their vendor tags are never licensed. This is the whole of the consent decision.
        for (const marker of [null, "none"]) {
            if (marker) installMarker(marker);
            const resolved = new URL(resolveHandoffUrl("https://forms.example.com/package/a"));
            expect(resolved.searchParams.get("efc_tags"), `marker ${marker ?? "absent"}`).toBeNull();
            expect(resolved.searchParams.get("gclid")).toBe("abc123");
        }
    });

    it("RESOLVES CORRECTLY BEFORE AND AFTER AN ACCEPT IN THE SAME SESSION", () => {
        // The reason this is a click-time call rather than a fetch-time one. The feed is fetched and
        // MEMOISED at boot (every template's App reads it to decide the nav), while a `required`
        // posture leaves the marker unset until the visitor clicks Accept — which happens later, on
        // the same page load, with nothing invalidating that memo. Same served URL, resolved twice:
        // bare before the Accept, licensed after it, no refetch involved.
        const served = "https://forms.example.com/package/a";

        const before = new URL(resolveHandoffUrl(served));
        expect(before.searchParams.get("efc_tags")).toBeNull();

        installMarker("gtm"); // the visitor accepts; ConsentBanner calls installAnalytics

        const after = new URL(resolveHandoffUrl(served));
        expect(after.searchParams.get("efc_tags")).toBe("gtm");
        expect(after.searchParams.get("utm_source")).toBe("google");
    });

    it("is idempotent, and never overwrites what the link already carries", () => {
        installMarker("gtm");
        const once = resolveHandoffUrl("https://forms.example.com/package/a");
        expect(resolveHandoffUrl(once)).toBe(once);

        // A server-minted parameter wins, exactly as it does for the bag.
        const preset = resolveHandoffUrl("https://forms.example.com/package/a?efc_tags=meta");
        expect(new URL(preset).searchParams.get("efc_tags")).toBe("meta");
    });

    it("never throws on a URL it cannot parse, and returns it as decorateUrl left it", () => {
        installMarker("gtm");
        expect(resolveHandoffUrl("/package/a")).toBe("/package/a");
        expect(resolveHandoffUrl("")).toBe("");
    });

    it("resolves a trial slot's bookUrl exactly as it resolves a package's", () => {
        // The 2026-09-10 generalisation. A Book control — a session band's `<a href>`, the contact
        // form's `<form action>` — is the same hop out of the school's site into a hosted flow, so it
        // gets the same two answers: the bag it already carries from the feed, plus the attestation
        // that licenses the hosted page to fire the school's tags for THIS visitor.
        installMarker("gtm");
        const resolved = new URL(resolveHandoffUrl("https://forms.example.com/book?token=abc"));

        expect(resolved.searchParams.get("token"), "the signed token is never touched").toBe("abc");
        expect(resolved.searchParams.get("efc_tags")).toBe("gtm");
        expect(resolved.searchParams.get("gclid")).toBe("abc123");
    });

    it("is still exported under its original name", () => {
        // `resolvePackageUrl` is the name every built template artifact and every bespoke site
        // imports. The rename is a second name for one implementation, never a replacement.
        expect(resolvePackageUrl).toBe(resolveHandoffUrl);
    });
});

describe("submitLead", () => {
    const stubFetch = (status: number, body?: unknown) => {
        const calls: { url: string; init: RequestInit }[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string, init: RequestInit) => {
                calls.push({ url, init });
                return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
            })
        );
        return calls;
    };

    it("POSTs the lead to the Edge with the site token and attribution, and no SDK marker", async () => {
        window.history.replaceState(null, "", "/?utm_source=google");
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        const calls = stubFetch(202, { received: true, reference: "ref-1" });

        const result = await submitLead(
            "contact",
            { firstName: "Ada", email: "ada@example.com", _hp: "" },
            { turnstile: "ts-token", idempotencyKey: "idem-1" }
        );

        expect(result).toEqual({ success: true, reference: "ref-1" });
        // ?site= rides the POST as well as the reads: it is the copy of the token the Edge's CORS
        // middleware can see BEFORE the body is read, which is what lets it answer for this one site
        // instead of for any site in the fleet. The body still carries it too.
        expect(calls[0].url).toBe("https://edge.example.com/embed/contact?site=tok123");
        const sent = JSON.parse(calls[0].init.body as string);
        expect(sent.site).toBe("tok123");
        expect(sent.turnstile).toBe("ts-token");
        expect(sent.idempotency).toBe("idem-1");
        expect(sent.fields.firstName).toBe("Ada");
        expect(sent.fields.attribution.utm_source).toBe("google");
        // The `_sdk` version stamp went when the package stopped being a published SDK (2026-10-08):
        // nothing read it — the drain never forwarded it to Ingest.
        expect(sent.fields).not.toHaveProperty("_sdk");
    });

    it("puts programmeId on the body when the form offered the choice, and omits it when it did not", async () => {
        // The one member the programme-of-interest select adds. ABSENCE is the whole contract for a
        // site that links no programmes: the body must be indistinguishable from the body this sent
        // before the field existed, so the second half asserts the KEY is gone rather than that its
        // value is undefined — those are the same JSON but not the same intent, and a `null` would be
        // neither.
        configure({ edge: "https://edge.example.com", site: "tok123" });

        const chosen = stubFetch(202);
        await submitLead("contact", {
            firstName: "Ada",
            email: "ada@example.com",
            programmeId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        });
        expect(JSON.parse(chosen[0].init.body as string).fields.programmeId).toBe(
            "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
        );

        const unchosen = stubFetch(202);
        await submitLead("contact", { firstName: "Ada", email: "ada@example.com" });
        expect(Object.keys(JSON.parse(unchosen[0].init.body as string).fields)).not.toContain("programmeId");
    });

    it("puts the Location of interest on the body as `location` when one is named", async () => {
        // A multi-location site (docs/website-linked-locations.plan.md §3e): the Edge lands the lead at
        // the named Location when the site fronts it. It rides the BODY beside the token, not inside
        // `fields` — it is a routing hint for the Edge, never a field of the lead.
        configure({ edge: "https://edge.example.com", site: "tok123" });
        const calls = stubFetch(202);

        await submitLead(
            "contact",
            { firstName: "Ada", email: "ada@example.com" },
            { location: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }
        );

        const sent = JSON.parse(calls[0].init.body as string);
        expect(sent.location).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
        expect(Object.keys(sent.fields)).not.toContain("location");
        expect(calls[0].url).toBe("https://edge.example.com/embed/contact?site=tok123");
    });

    it("sends a byte-identical body when no Location is named — the key is absent, not empty", async () => {
        // Every site with no linked Location, and every bespoke site, passes nothing: the body must be
        // exactly the body this SDK sent before the option existed. Compared as the raw string so a
        // `location: null`, an empty string or a reordered key would all fail.
        vi.stubGlobal("performance", undefined);
        configure({ edge: "https://edge.example.com", site: "tok123" });

        const without = stubFetch(202);
        await submitLead("contact", { firstName: "Ada", email: "ada@example.com" }, { idempotencyKey: "k" });
        const emptyName = stubFetch(202);
        await submitLead(
            "contact",
            { firstName: "Ada", email: "ada@example.com" },
            { idempotencyKey: "k", location: "" }
        );

        const body = without[0].init.body as string;
        expect(Object.keys(JSON.parse(body))).toEqual(["site", "fields", "idempotency"]);
        expect(body).not.toContain('"location"');
        expect(emptyName[0].init.body).toBe(body);
    });

    it("measures how long the form was in front of the visitor and sends it as dwellMs", async () => {
        // The signal Aquila uses on a submission that carries NO message, where there is nothing for a
        // classifier to read: a person cannot type a name, an email and a phone number in under a
        // second, and a script always can. Measured from configure() (app start, i.e. first render)
        // or from markLeadFormMounted(), whichever happened last.
        let clock = 1_000;
        vi.stubGlobal("performance", { now: () => clock });

        configure({ edge: "https://edge.example.com", site: "tok123" });
        clock = 9_400;
        const calls = stubFetch(202, {});

        await submitLead("contact", { firstName: "Ada", email: "ada@example.com" });

        const sent = JSON.parse(calls[0].init.body as string);
        expect(sent.fields.dwellMs).toBe(8_400);
    });

    it("re-starts the dwell clock at markLeadFormMounted, so a form that appears late is judged fairly", async () => {
        // It can only ever make a measured dwell LONGER — which is the direction that protects the
        // visitor, never the one that catches more of them.
        let clock = 1_000;
        vi.stubGlobal("performance", { now: () => clock });

        configure({ edge: "https://edge.example.com", site: "tok123" });
        clock = 30_000; // the visitor read the page for half a minute...
        markLeadFormMounted(); // ...and only now opened the form
        clock = 32_500;
        const calls = stubFetch(202, {});

        await submitLead("contact", { firstName: "Ada" });

        expect(JSON.parse(calls[0].init.body as string).fields.dwellMs).toBe(2_500);
    });

    it("sends NOTHING when the dwell cannot be measured — never a zero", async () => {
        // An engine with no performance.now must look like "no signal", not like "submitted
        // instantly": a zero would park a real lead in a school's junk folder for the crime of
        // running an old browser.
        vi.stubGlobal("performance", undefined);

        configure({ edge: "https://edge.example.com", site: "tok123" });
        const calls = stubFetch(202, {});

        await submitLead("contact", { firstName: "Ada", email: "ada@example.com" });

        const sent = JSON.parse(calls[0].init.body as string);
        expect("dwellMs" in sent.fields).toBe(false);
    });

    it("lets a caller's own finite measurement win, and ignores a nonsense one", async () => {
        let clock = 1_000;
        vi.stubGlobal("performance", { now: () => clock });
        configure({ edge: "https://edge.example.com", site: "tok123" });
        clock = 5_000;

        const supplied = stubFetch(202, {});
        await submitLead("contact", { firstName: "Ada", dwellMs: 1_234.6 });
        expect(JSON.parse(supplied[0].init.body as string).fields.dwellMs).toBe(1_235);

        const nonsense = stubFetch(202, {});
        await submitLead("contact", { firstName: "Ada", dwellMs: Number.NaN });
        // Falls back to the SDK's own reading rather than putting NaN on the wire.
        expect(JSON.parse(nonsense[0].init.body as string).fields.dwellMs).toBe(4_000);
    });

    it("attaches the attribution bag whatever the page installed — the parity the ruling rests on", async () => {
        // The package hop follows THIS, not the other way round. A lead has always carried its
        // first-touch bag with no reference to consent, because provenance on the school's own
        // member record is first-party CRM data, not vendor measurement. Pinned here so the two
        // halves of the funnel cannot drift apart again: no marker (a `required` posture nobody has
        // accepted), a `none` marker and a full install all send the same bag.
        for (const marker of [null, "none", "gtm meta"]) {
            clearState();
            if (marker) installMarker(marker);
            window.history.replaceState(null, "", "/?utm_source=google");
            configure({ edge: "https://edge.example.com/", site: "tok123" });
            const calls = stubFetch(202, { received: true });

            await submitLead("contact", { firstName: "Ada", email: "ada@example.com" });

            const sent = JSON.parse(calls[0].init.body as string);
            expect(sent.fields.attribution.utm_source, `marker ${marker ?? "absent"}`).toBe("google");
            // And never the attestation: `efc_tags` is a firing signal for the hosted hop, not a
            // field, so it has no business in a lead payload.
            expect(sent.fields.attribution.efc_tags).toBeUndefined();
        }
    });

    it("maps a 403 (origin / Turnstile rejection) to a rejected result", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        stubFetch(403);

        expect(await submitLead("contact", { firstName: "Ada" })).toEqual({
            success: false,
            error: "rejected",
        });
    });

    it("maps a 400 to an invalid result carrying the per-field reasons", async () => {
        // The Edge holds a submission to Aquila's own lead contract at the door. Before that, an
        // invalid lead was stored, thanked for, and then parked undeliverable on the first drain —
        // so the refusal has to reach the person who can still fix it, field by field.
        configure({ edge: "https://edge.example.com", site: "tok123" });
        stubFetch(400, {
            title: "The form could not be submitted.",
            errors: { firstName: ["First name is required."], email: ["Enter a valid email address."] },
        });

        expect(await submitLead("contact", { firstName: "" })).toEqual({
            success: false,
            error: "invalid",
            fieldErrors: {
                firstName: "First name is required.",
                email: "Enter a valid email address.",
            },
        });
    });

    it("still reports a 400 as invalid when the body isn't the expected problem document", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        stubFetch(400);

        expect(await submitLead("contact", { firstName: "Ada" })).toEqual({
            success: false,
            error: "invalid",
            fieldErrors: {},
        });
    });

    it("maps a thrown fetch to a network error", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("offline")))
        );

        expect(await submitLead("contact", { firstName: "Ada" })).toEqual({
            success: false,
            error: "network",
        });
    });
});

describe("getPackages", () => {
    it("GETs the Edge packages endpoint with the site token and returns the array", async () => {
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) => {
                calls.push(url);
                return Promise.resolve(
                    new Response(JSON.stringify([{ name: "Adults", signUpFee: 25, url: "https://x/package" }]), {
                        status: 200,
                    })
                );
            })
        );

        const packages = await getPackages();
        expect(calls[0]).toBe("https://edge.example.com/embed/packages?site=tok123");
        expect(packages).toHaveLength(1);
        expect(packages[0].name).toBe("Adults");
        expect(packages[0].signUpFee).toBe(25);
        // The hosted URL comes back DECORATED (see the getPackagesFeed suite): even a visitor who
        // arrived with no campaign parameters carries a first-touch landing page, so the served URL
        // is the base plus the bag rather than the bytes the Edge answered with.
        expect(packages[0].url!.startsWith("https://x/package?")).toBe(true);
        expect(new URL(packages[0].url!).pathname).toBe("/package");
    });

    it("returns [] on a network failure", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("offline")))
        );
        expect(await getPackages()).toEqual([]);
    });

    it("returns [] on a non-2xx response and on a non-array body", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("oops", { status: 502 })))
        );
        expect(await getPackages()).toEqual([]);

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 })))
        );
        expect(await getPackages()).toEqual([]);
    });
});

// The unflattened read. `[]` and `null` are DIFFERENT answers here — "the school publishes no
// packages" versus "we never heard back" — and a template that reshapes its navigation around the
// feed depends on telling them apart.
describe("getPackagesFeed", () => {
    it("returns the array the Edge answered with, empty included", async () => {
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
        );
        expect(await getPackagesFeed()).toEqual([]);

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify([{ name: "Adults" }]), { status: 200 })))
        );
        expect(await getPackagesFeed()).toEqual([{ name: "Adults" }]);
    });

    it("returns null when there was no answer — network, non-2xx or a non-array body", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("offline")))
        );
        expect(await getPackagesFeed()).toBeNull();

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("oops", { status: 502 })))
        );
        expect(await getPackagesFeed()).toBeNull();

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 })))
        );
        expect(await getPackagesFeed()).toBeNull();
    });

    /** The Edge's answer for every decoration test below: one option with a hosted URL, one without. */
    const stubFeed = () => {
        window.history.replaceState(null, "", "/?utm_source=google&gclid=abc123");
        captureFirstTouch();
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    new Response(
                        JSON.stringify([
                            { name: "Adults", signUpFee: 25, url: "https://forms.example.com/package/a" },
                            { name: "No link" },
                        ]),
                        { status: 200 }
                    )
                )
            )
        );
    };

    it("decorates every option's hosted URL with the visitor's attribution bag", async () => {
        // The whole point of the piece: the school's tags are on the SITE, the sign-up finishes on
        // forms.<domain>, and this is the only thing carrying the click across. Templates render
        // `p.url` verbatim, so doing it here is what makes all three (and any bespoke site) carry it.
        stubFeed();

        const feed = (await getPackagesFeed())!;
        const decorated = new URL(feed[0].url!);
        expect(decorated.origin + decorated.pathname).toBe("https://forms.example.com/package/a");
        expect(decorated.searchParams.get("utm_source")).toBe("google");
        expect(decorated.searchParams.get("gclid")).toBe("abc123");
        // Everything else about the option is untouched, and an option with no link stays as served.
        expect(feed[0].name).toBe("Adults");
        expect(feed[0].signUpFee).toBe(25);
        expect(feed[1]).toEqual({ name: "No link" });
    });

    it("decorates whatever the marker says — provenance is not consent-gated", async () => {
        // The v3 ruling, pinned from the feed's side: no marker (a `required` posture nobody has
        // accepted yet), a `none` marker (a school with no conversion-capable tag), a full install —
        // all three carry the visitor's bag, because the bag is first-party CRM provenance and the
        // member's record is the school's own. It is `efc_tags`, added at CLICK time, that decides
        // whether that school's vendor tags may fire on the hosted page.
        for (const marker of [null, "none", "gtm meta"]) {
            clearState();
            if (marker) installMarker(marker);
            stubFeed();
            const feed = (await getPackagesFeed())!;
            expect(new URL(feed[0].url!).searchParams.get("gclid"), `marker ${marker ?? "absent"}`).toBe("abc123");
        }
    });

    it("never carries efc_tags at fetch time — that is the click's job", async () => {
        // Deliberate. The marker can change after this answer is memoised (the templates cache the
        // feed for the session, and a `required`-posture visitor accepts long after boot), so an
        // attestation minted here would be a stale answer to the one question that must be current.
        installMarker("gtm meta");
        stubFeed();

        const feed = (await getPackagesFeed())!;
        expect(new URL(feed[0].url!).searchParams.get("efc_tags")).toBeNull();
    });

    it("returns null when the package was never configured — nothing was asked, so nothing is known", async () => {
        // A fresh module instance: `configure()` is module state and every test above has set it.
        vi.resetModules();
        const fresh = await import("./index");
        expect(await fresh.getPackagesFeed()).toBeNull();
        expect(await fresh.getPackages()).toEqual([]);
    });
});

describe("getAvailability", () => {
    it("asks for one Location's slots with &location= only when one is named", async () => {
        // A multi-location site keys its trial list on the visitor's Location of interest; every other
        // caller names none and must make exactly the request it made before the option existed.
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) => {
                calls.push(url);
                return Promise.resolve(new Response("[]", { status: 200 }));
            })
        );

        await getAvailability({ location: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
        await getAvailability();
        await getAvailability({ location: "" });
        await getAvailability({ location: "a b&c" });

        expect(calls).toEqual([
            "https://edge.example.com/embed/availability?site=tok123&location=3f2504e0-4f89-11d3-9a0c-0305e82c3301",
            "https://edge.example.com/embed/availability?site=tok123",
            "https://edge.example.com/embed/availability?site=tok123",
            // Encoded as a query VALUE: a hostile string cannot add a parameter.
            "https://edge.example.com/embed/availability?site=tok123&location=a%20b%26c",
        ]);
    });

    it("GETs the Edge availability endpoint with the site token and returns the slots verbatim", async () => {
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        // One free slot, one paid + pooled: the venue rides each slot (the feed includes sessions
        // hosted at sibling Locations, so the tile must say where the class runs), and a paid
        // slot's bookUrl is consumed AS SERVED — nothing here re-mints or transforms it.
        const slots = [
            {
                startsAt: "2026-07-01T10:00:00",
                sessionId: "s1",
                name: "Tots",
                start: "10:00",
                end: "11:00",
                bookingFee: 0,
                bookUrl: null,
                venue: { name: "Riverside Dojo", address1: "1 Bridge Street", town: "Yorkton", postCode: "YO1 1AA" },
            },
            {
                startsAt: "2026-07-01T17:30:00",
                sessionId: "s2",
                name: "Pooled Juniors",
                start: "17:30",
                end: "18:30",
                bookingFee: 15,
                pooled: true,
                bookUrl: "https://forms.example.com/book?token=abc",
                venue: { name: "Harbour Academy", address1: "7 Quay Road", town: "Portsea", postCode: "PO5 5XX" },
            },
        ];
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) => {
                calls.push(url);
                return Promise.resolve(new Response(JSON.stringify(slots), { status: 200 }));
            })
        );

        const availability = await getAvailability();
        expect(calls[0]).toBe("https://edge.example.com/embed/availability?site=tok123");
        // Verbatim in every field but the ONE the SDK is licensed to touch: `bookUrl` comes back
        // decorated (the attribution tests below), so it is compared as a URL rather than a string.
        expect(availability.map((slot) => ({ ...slot, bookUrl: null }))).toEqual(
            slots.map((slot) => ({ ...slot, bookUrl: null }))
        );
        expect(availability[0].bookUrl, "a slot with no URL stays exactly as served").toBeNull();
        const booked = new URL(availability[1].bookUrl!);
        expect(booked.origin + booked.pathname).toBe("https://forms.example.com/book");
        expect(booked.searchParams.get("token")).toBe("abc");

        // `pooled` (2026-09-17) rides through untouched, and is ABSENT on a local slot rather than
        // false — so a feed served before the member existed is byte-identical and absence reads as
        // local. The SDK never filters on it: consumers read it to name a sibling's venue.
        expect(availability[1].pooled).toBe(true);
        expect(availability[0].pooled, "absent, never false, for a class this Location runs").toBeUndefined();
    });

    /** The Edge's answer for every decoration test below: one bookable slot, one unbookable one. */
    const stubAvailability = () => {
        window.history.replaceState(null, "", "/?utm_source=google&gclid=abc123");
        captureFirstTouch();
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    new Response(
                        JSON.stringify([
                            {
                                startsAt: "2026-07-01T17:30:00",
                                sessionId: "s2",
                                bookUrl: "https://forms.example.com/book?token=abc",
                            },
                            { startsAt: "2026-07-01T10:00:00", sessionId: "s1", bookUrl: null },
                        ]),
                        { status: 200 }
                    )
                )
            )
        );
    };

    it("decorates every slot's bookUrl with the visitor's attribution bag", async () => {
        // The gap the one-rail change left behind: EVERY trial booking off a template site now
        // finishes on forms.<domain>, and the member it creates used to arrive with no first-touch
        // provenance at all — while the same visitor's enquiry and package purchase both arrived
        // with the lot. Templates render `slot.bookUrl` verbatim, so doing it here is what makes all
        // three (and any bespoke site) carry it.
        stubAvailability();

        const slots = await getAvailability();
        const decorated = new URL(slots[0].bookUrl!);
        expect(decorated.origin + decorated.pathname).toBe("https://forms.example.com/book");
        expect(decorated.searchParams.get("token"), "the signed occurrence token survives").toBe("abc");
        expect(decorated.searchParams.get("utm_source")).toBe("google");
        expect(decorated.searchParams.get("gclid")).toBe("abc123");
        // A slot with no URL is handed back untouched rather than given one.
        expect(slots[1].bookUrl).toBeNull();
    });

    it("decorates whatever the marker says — provenance is not consent-gated", async () => {
        // The same ruling the packages feed runs on, pinned from availability's side: no marker (a
        // `required` posture nobody has accepted yet), a `none` marker (a school with no
        // conversion-capable tag), a full install — all three carry the visitor's bag, because the
        // bag is first-party CRM provenance about the school's own member-to-be.
        for (const marker of [null, "none", "gtm meta"]) {
            clearState();
            if (marker) installMarker(marker);
            stubAvailability();
            const slots = await getAvailability();
            expect(new URL(slots[0].bookUrl!).searchParams.get("gclid"), `marker ${marker ?? "absent"}`).toBe("abc123");
        }
    });

    it("never carries efc_tags at fetch time — that is the click's job", async () => {
        // Same reason as the packages feed: `useAvailability` memoises the answer for the session,
        // and a `required`-posture visitor accepts long after that. An attestation minted here would
        // be a stale answer to the one question that must be current.
        installMarker("gtm meta");
        stubAvailability();

        const slots = await getAvailability();
        expect(new URL(slots[0].bookUrl!).searchParams.get("efc_tags")).toBeNull();
    });

    it("returns [] on a network failure, a non-2xx response and a non-array body", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("offline")))
        );
        expect(await getAvailability()).toEqual([]);

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("oops", { status: 502 })))
        );
        expect(await getAvailability()).toEqual([]);

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 })))
        );
        expect(await getAvailability()).toEqual([]);
    });
});

describe("getSessions", () => {
    it("GETs /embed/sessions with the site token, and &location= only when one is named", async () => {
        // The timetable read builds its URL exactly as the availability read does, against its own path.
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) => {
                calls.push(url);
                return Promise.resolve(new Response("[]", { status: 200 }));
            })
        );

        await getSessions();
        await getSessions({ location: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
        await getSessions({ location: "" });
        await getSessions({ location: "a b&c" });

        expect(calls).toEqual([
            "https://edge.example.com/embed/sessions?site=tok123",
            "https://edge.example.com/embed/sessions?site=tok123&location=3f2504e0-4f89-11d3-9a0c-0305e82c3301",
            "https://edge.example.com/embed/sessions?site=tok123",
            "https://edge.example.com/embed/sessions?site=tok123&location=a%20b%26c",
        ]);
    });

    it("hands every slot back with its bookable flag, decorating only a served bookUrl", async () => {
        window.history.replaceState(null, "", "/?utm_source=google&gclid=abc123");
        captureFirstTouch();
        configure({ edge: "https://edge.example.com/", site: "tok123" });
        const served = [
            {
                startsAt: "2026-07-01T17:30:00",
                sessionId: "s2",
                name: "Juniors",
                start: "17:30",
                end: "18:30",
                bookingFee: 0,
                bookUrl: "https://forms.example.com/book?token=abc",
                venue: { name: "Riverside Dojo" },
                bookable: true,
            },
            {
                startsAt: "2026-07-01T19:00:00",
                sessionId: "s3",
                name: "Adults",
                start: "19:00",
                end: "20:00",
                bookUrl: null,
                venue: { name: "Harbour Academy" },
                pooled: true,
                bookable: false,
            },
        ];
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify(served), { status: 200 })))
        );

        const slots = await getSessions();
        expect(slots.map((slot) => ({ ...slot, bookUrl: null }))).toEqual(
            served.map((slot) => ({ ...slot, bookUrl: null }))
        );
        const decorated = new URL(slots[0].bookUrl!);
        expect(decorated.origin + decorated.pathname).toBe("https://forms.example.com/book");
        expect(decorated.searchParams.get("token")).toBe("abc");
        expect(decorated.searchParams.get("gclid")).toBe("abc123");
        expect(decorated.searchParams.get("efc_tags"), "the consent attestation is the click's job").toBeNull();
        expect(slots[1].bookUrl, "a listed-only class is never given a link").toBeNull();
        expect(slots[1].bookable).toBe(false);
        expect(slots[1].pooled).toBe(true);
    });

    it("reads a missing or non-boolean bookable as false", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    new Response(
                        JSON.stringify([
                            { sessionId: "a" },
                            { sessionId: "b", bookable: "true" },
                            { sessionId: "c", bookable: true },
                        ]),
                        { status: 200 }
                    )
                )
            )
        );
        expect((await getSessions()).map((slot) => slot.bookable)).toEqual([false, false, true]);
    });

    it("returns [] on a network failure, a non-2xx response and a non-array body", async () => {
        configure({ edge: "https://edge.example.com", site: "tok123" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("offline")))
        );
        expect(await getSessions()).toEqual([]);

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("oops", { status: 502 })))
        );
        expect(await getSessions()).toEqual([]);

        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 })))
        );
        expect(await getSessions()).toEqual([]);
    });

    it("returns [] before configure", async () => {
        vi.resetModules();
        const fresh = await import("./index");
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        expect(await fresh.getSessions()).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
