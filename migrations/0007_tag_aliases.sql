-- M2.1.5: hierarchical tag aliases. One-way parent → alias relationships
-- within a single category (fandom→fandom, character→character, etc.;
-- enforced in the API, not in SQL because the cross-category check
-- needs a JOIN). The filter pipeline in /api/works expands a selected
-- tag set transitively via WITH RECURSIVE so selecting a parent pulls
-- in all descendants.
--
-- `hide_from_sidebar` is per-edge: a child tag is hidden from the
-- FilterSidebar feed only if EVERY one of its parent-alias rows has
-- hide_from_sidebar = 1 (show-wins). Default 0 means show.
--
-- The CHECK keeps a tag from aliasing itself (trivial self-cycle).
-- Multi-step cycles (A→B→A) are prevented at the API layer in
-- src/routes/api/tags/[parent_id]/aliases/+server.ts; the recursive
-- CTE in /api/works uses UNION (not UNION ALL) so even a slipped-
-- through cycle would terminate rather than loop forever.
CREATE TABLE tag_aliases (
	parent_tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
	alias_tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
	hide_from_sidebar INTEGER NOT NULL DEFAULT 0,
	created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (parent_tag_id, alias_tag_id),
	CHECK (parent_tag_id != alias_tag_id)
);

-- Indexes for both directions of lookup. The parent index supports the
-- recursive CTE's `JOIN ... ON ta.parent_tag_id = expansion.id` and
-- the per-parent alias-list endpoint. The alias index supports the
-- show-wins NOT EXISTS subquery in GET /api/tags and the reverse
-- "what parents does this tag have?" view on the /tags page.
CREATE INDEX idx_tag_aliases_parent ON tag_aliases(parent_tag_id);
CREATE INDEX idx_tag_aliases_alias  ON tag_aliases(alias_tag_id);
