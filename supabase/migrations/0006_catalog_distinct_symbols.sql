-- ============================================================
-- Give each product its own plan symbol.
--
-- A bar stool, a chair, a monitor and a shelf were all landing as the
-- same generic box. On a drawing that is not a cosmetic problem — a
-- hard-edged box conventionally means built structure, so reading a
-- stool as structure is actively misleading.
--
-- Each now maps to a kind that draws itself: a stool is a circle with a
-- footring, a monitor is a screen on a stand, a shelf is a wall-mounted
-- double line that does not read as floor-occupying furniture.
-- ============================================================

update catalog_item set spec = spec || jsonb_build_object('elementKind','stool')
where category = 'furniture' and name = 'Ale Bar Stool';

update catalog_item set spec = spec
  || jsonb_build_object('elementKind','monitor','footprint',jsonb_build_array(4,1.5),'height',6)
where category = 'accessories' and name = 'TV';

-- a shelf hangs on the wall, so it now places rather than being skipped
update catalog_item set spec = spec
  || jsonb_build_object('elementKind','shelf','footprint',jsonb_build_array(4,0.8))
where category = 'accessories' and name = 'Shelf';
