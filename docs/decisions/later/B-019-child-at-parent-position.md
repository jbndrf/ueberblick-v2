# B-019 A child at its parent's position: drawn at the parent's anchor, no copied geometry
priority: medium        status: provisional
date: 2026-10-02   lead: b   work packages: WP-677   touches: R4, R13, map rendering, relations

## Context
v3's relation had `geometry_mode: inherit`. Features of the child workflow (an inspection, a defect) sat on their parent's spot. Their create form opened without a pin, they were hidden under the parent as a "family stack" (fanned out with "+N" when the relation was open), and they moved along when the parent moved (`reference/src/routes/(participant)/map/+page.svelte:2189-2252`, register p2-map #5, #8, G11; p3 "Children follow the parent"). The register left G11 as a lead decision.

## Options
- A) **Drawn at the parent's anchor:** a relation (reference with `inverse_of`, WP-647) declares the child's position as inherited. The child type then has no geometry of its own for that relation, and the map draws the child at the parent's anchor through the edge. Creating such a child needs no pin. Children follow a moved parent without any write. The family stack is a display rule: inherited children are not drawn separately unless the relation is open (WP-647's `isolate` fan-out).
- B) **Copied geometry:** a rule copies the parent's geometry to each child on every parent move (one system run per child).

## Chosen (provisional)
A. Nothing is copied, so there's no write amplification and no stale copies offline. It is O(children of the opened parent) to draw, never O(all features). It matches v3's visible behaviour.
- **Seam:** the anchor lookup is one function in the map layer. A later "store a copy" rule (B) can replace it without changing the config.
- **Open:** whether exports and external GIS (H6) need a materialised geometry per child. If they do, the export derives it from the same function.

## Cost to change later
low to medium (one config flag on the relation and one anchor function; no stored data depends on it).

- 2026-10-06 (WP-1065): the family stack is computed over the filter-visible set as v3 did. A parent with open children carries `$familyOpen` (their number, drawn as a badge); a parent hidden by the filter lets its visible children show at its anchor, the top one anchoring a stack that fans on tap. Children never get a position of their own; the anchor is still read through the edge.
