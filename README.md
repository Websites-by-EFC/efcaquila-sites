# @efcaquila/sites

Aquila's runtime for a **bundled** school website (Vite, or any bundler): posting enquiries to the Aquila
Edge, carrying the visitor's first-touch attribution, reading the school's bookable trial sessions and
sign-up packages, and resolving links into Aquila's hosted pages. It is the module EFC's own website
templates are built on.

**No build step? Paste the script instead.** A static HTML site does not need this package: one
`<script src="{edge}/embed/v1.js" defer></script>` line gives it `<efc-form>`, `<efc-sessions>`,
`<efc-packages>` and `data-efc-handoff`, which do the same jobs through the same Edge. That route is
documented in the integration README the Edge serves at `{edge}/embed/v1/README.md`.

## Install

```sh
npm install @efcaquila/sites
```

ES module only, with TypeScript types; it runs in the browser and is safe to import in a pre-render pass
(with no `window` it captures nothing and decorates nothing).

## Configure

Call `configure` once, at app start:

```ts
import { configure } from "@efcaquila/sites";

configure({ edge: "https://{edge}", site: "{site token}" });
```

- `edge` is the Edge's public host for the school's region (a trailing slash is tolerated). Do not guess
  it: the snippet Aquila hands out carries the real value.
- `site` is the site's token. It is a public identifier, not a secret. Where it comes from (a site Aquila
  hosts, or a site registered under Library › Forms) and which page addresses may use it are in the
  "Getting a site token" section of `{edge}/embed/v1/README.md`.
- The Edge answers only the origins it holds for the token. From any other origin (`localhost` included)
  the reads come back empty and a submission fails.
- `configure` also captures the visitor's first-touch attribution and starts the dwell clock.

## Submit an enquiry

```ts
import { submitLead } from "@efcaquila/sites";

const result = await submitLead("contact", { firstName, lastName, email, phone, message, _hp });
if (result.success) showThanks(result.reference);
else if (result.error === "invalid") showFieldErrors(result.fieldErrors);
```

**Never submit a test lead.** Every submission, from any page and any environment, becomes a real lead
for a real school. Stub `fetch` to exercise the sent state.

- It posts to `{edge}/embed/contact?site=…`. The Edge stores the lead first and forwards it to Aquila, so
  Aquila being down never fails a submission.
- `"contact"` is the only type. A trial is booked through a session's `bookUrl` (below).
- Email or phone is needed for a usable lead. `programmeId` is set only from a control the visitor could
  see and change; anything extra rides with the lead verbatim.
- Options: `turnstile` (when the Edge has Turnstile on), `idempotencyKey` (a retried submit is stored
  once), `signal`, and `location` (below).
- Bind a hidden input to `_hp`. `HONEYPOT_FIELDS` (`_hp`, `honeypot`) are the names the Edge treats as a
  spam trap: a filled one gets a fake success and stores nothing, so never give a visible input one of
  those names.

### Refusals

- `{ success: true, reference? }`: the Edge's 202; the lead is stored.
- `error: "invalid"` with `fieldErrors`: a 400. The Edge holds the lead to Aquila's lead contract at the
  door; render each message against its field.
- `error: "rejected"`: a 403, the origin allow-list or Turnstile. The visitor cannot fix it.
- `error: "network"`: the fetch threw.
- Anything else: `Submission failed ({status})`, or the "not configured" message before `configure`.

### Marketing consent

Send it as `fields.compliance.consent` (`marketingSms`, `marketingEmail`), set `true` only for an explicit
tick on an unticked, never-required checkbox, and omit the envelope otherwise. An exactly-`true` flag
mints an Express marketing-consent grant in Aquila for that channel; `false` or absent mints nothing.

### Dwell

The module measures how long the form was in front of the visitor and sends it as `dwellMs` (absent when
unmeasurable, never 0). A submission with no message sent in under a second is parked in the school's
junk folder as a likely script; one with a message is judged on the words. The clock starts at load and
at `configure`; call `markLeadFormMounted()` when the form appears later (a modal, a route change, a tab).
It can only ever make a measured dwell longer. Pass your own `dwellMs` only when you time the form better.

## Trial sessions and packages

```ts
import { getAvailability, getPackages, getPackagesFeed } from "@efcaquila/sites";

const slots = await getAvailability({ location }); // AvailabilitySlot[]; [] on any failure
const packages = await getPackages(); // PackageOption[]; [] on any failure
const feed = await getPackagesFeed(); // PackageOption[] | null
```

- `getAvailability` reads the Edge's synced `/embed/availability` snapshot. Times are venue-local wall
  time: render `start` / `end` / `startsAt` as given, never through the viewer's clock. Name the `venue`
  on every tile; a `pooled` slot runs at a sibling Location of the same account. `bookingFee` decides only
  what the Book control says.
- `getPackages` reads `/embed/packages` (name, optional `signUpFee`, `url` to the hosted sign-up).
  `getPackagesFeed` keeps "no packages" (`[]`) apart from "no answer" (`null`): use it when the answer
  reshapes the site (a nav entry), so an outage does not rewrite the navigation.
- Every `bookUrl` and package `url` comes back already decorated with the visitor's attribution bag.

## Hand-off links

Render a served `url` / `bookUrl` verbatim and never rebuild it from parts. Resolve it on the click with
`resolveHandoffUrl` (alias `resolvePackageUrl`):

```tsx
<a
    href={slot.bookUrl}
    onClick={(e) => (e.currentTarget.href = resolveHandoffUrl(slot.bookUrl!))}
    onAuxClick={(e) => (e.currentTarget.href = resolveHandoffUrl(slot.bookUrl!))}
    onContextMenu={(e) => (e.currentTarget.href = resolveHandoffUrl(slot.bookUrl!))}
>
    Book
</a>
```

For a `<form>` that POSTs to a hosted flow, resolve its `action` in `onSubmit`. Any other link into
Aquila's hosted pages (a student portal, say) goes through the same resolver.

- **The attribution bag** is first-party provenance and is never consent-gated.
- **`efc_tags`** is added only when the page's `<html data-efc-analytics="…">` marker names a channel
  (`gtm`, `gtag`, `meta`, space-separated; `none` or absent adds nothing). Set the marker only once the
  school's tags are actually running under the visitor's consent. It is read at the click, never cached,
  so a visitor who accepts a banner mid-visit gets a licensed link on the next click.
- A parameter the link already carries is never overwritten, and the resolver never throws.

## Linked locations

On a site that fronts more than one Location, `submitLead`'s `options.location` and `getAvailability`'s
`location` take a Location id from the site's own list (`/embed/config` answers it as `locations`). The
Edge uses it when the site fronts that Location and the owner otherwise, logged rather than refused.
Unset is the owner, and the request is byte-identical to one without the option.

## The attribution store

`getAttribution()` returns the sparse record that rides every lead: the first-touch fields (the UTM set,
`gclid`, `fbclid`, `msclkid`, `referrer_url`, `landing_page_url`) captured once per browser into
localStorage under `efc_attribution_v1`, plus `ga4_client_id` / `ga4_session_id` read live from the GA
cookies. `captureFirstTouch()` is write-once (`configure` calls it). `decorateUrl(url)` appends the bag
to an absolute URL, values capped at 512 characters. `installedChannels()` reads the
`data-efc-analytics` marker. `ATTRIBUTION_KEYS` is the closed key list, pinned to Aquila's server side
and to the Edge script by tests on both sides.

## Versions

Semver; see `CHANGELOG.md`. The 1.x line speaks the Edge's `v1` contract; 0.1.0 to 0.2.1 (July and
August 2026) are superseded. Published from
[Websites-by-EFC/efcaquila-sites](https://github.com/Websites-by-EFC/efcaquila-sites), a mirror of the
package folder in EFC's Aquila repository, by npm trusted publishing with provenance; issues and changes
go to EFC, not to the mirror.

## Building this package (EFC)

`npm run build` emits `dist/`; `npm test` runs the vitest suite. Inside Aquila the three website template
packages take it as `file:../efcaquila-sites` and bundle it, so **any change to `src/` changes all three
template artifacts' bytes** and bumps their versions in `Aquila.Services/Website/TemplateRegistry.cs` in
the same commit. Bumping `version` here is what publishes: the Aquila.Templates pipeline mirrors the
folder to GitHub on a version change, and the mirror's `.github/workflows/publish.yml` publishes it,
skipping a version npm already has.
