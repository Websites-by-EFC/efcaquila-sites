# Changelog

`@efcaquila/sites` follows semver. Newest first.

## 1.1.0 (2026-10-21)

- **`getSessions({ location?, signal? })`** reads the Edge's `/embed/sessions`: the Location's whole
  timetable for the next 14 days (every session that is not invite-only, plus every session offered to trials, pooled siblings included), each
  slot a **`SessionSlot`**, the `AvailabilitySlot` shape plus `bookable`. A bookable slot carries its
  decorated `bookUrl`; a listed-only one carries none and is drawn with no Book control. Same contract as
  `getAvailability`: `[]` on any failure, `&location=` only when named. The availability feed is exactly
  the bookable subset, and stays the read for anything that is only for booking.

## 1.0.0 (2026-10-19)

The first version under the v1 contract and the first by trusted publishing, from
[Websites-by-EFC/efcaquila-sites](https://github.com/Websites-by-EFC/efcaquila-sites) with provenance. The
module was published as 0.1.0 to 0.2.1 in July and August 2026 from Ian's account, then described as the
templates' internal module on 8 Oct 2026 when no bespoke site had installed it; the same module the three
EFC website templates have bundled since 0.x. The 1.x line is the npm twin of the Edge script's `v1` channel.

- **Superseded:** 0.1.0, 0.1.1 and 0.2.1 (the "EFC websites middleware" releases). They will be deprecated
  on the registry after 1.0.0 lands, by hand (Ian's act, not the pipeline's).

- **What it is:** the runtime a bundled school website (Vite or any bundler) uses to talk to the Aquila
  Edge: `configure({ edge, site })`, `submitLead("contact", …)` to the store-and-forward `/embed/contact`
  rail, `getAvailability` and `getPackages` / `getPackagesFeed` over the Edge's feeds, and the first-touch
  attribution store (`efc_attribution_v1`, `ATTRIBUTION_KEYS` pinned to Aquila's own key list).
- **The hand-off resolver:** `resolveHandoffUrl(url)` (alias `resolvePackageUrl`) resolves a hosted
  hand-off link at click time: the visitor's attribution bag, plus the `efc_tags` consent attestation when
  the page's `data-efc-analytics` marker names a channel. Every `url` and `bookUrl` the feeds serve is
  already decorated with the bag.
- **Linked locations:** `submitLead`'s `options.location` and `getAvailability`'s `location` name one of
  the Locations a site fronts; unset is the site's owner.
- **The trial rail is gone** (8 October 2026): `submitLead` takes `"contact"` only, and the Edge's
  `/embed/trial` is unmapped. A trial is booked through a slot's `bookUrl`.
- `"private": true` is lifted; the package ships `dist/`, this changelog and the README only.
