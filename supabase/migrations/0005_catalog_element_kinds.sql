-- ============================================================
-- Teach the catalog what each product becomes on the floor plan.
--
-- spec.elementKind names a kind from config.js, and spec.footprint is
-- its real size in feet. Ordering a counter can then drop a correctly
-- scaled counter into the booth drawing.
--
-- This is data, not a mapping table in code: a new product becomes
-- placeable by setting two keys, with no deploy.
--
-- Items with no elementKind (carpet, booth packages, wall-mounted
-- shelves) are ordered but not placed — they are not floor objects.
-- ============================================================

update catalog_item set spec = spec || jsonb_build_object('elementKind','counter')
where category = 'counters' and name in
  ('Standard Counter','Storage Counter','Slim Counter','Double Counter','Octanorm Counter');

-- tables read as tables, not counters
update catalog_item set spec = spec || jsonb_build_object('elementKind','table')
where category = 'counters' and name in ('Networking Table','Octanorm Table');

update catalog_item set spec = spec || jsonb_build_object('elementKind','chair')
where category = 'furniture' and name = 'Ale Bar Stool';

update catalog_item set spec = spec || jsonb_build_object('elementKind','table')
where category = 'furniture' and name = 'Brava Bar Table';

-- a monitor occupies floor space on its stand; a shelf hangs on the wall
update catalog_item set spec = spec
  || jsonb_build_object('elementKind','display','footprint',jsonb_build_array(4,1.5))
where category = 'accessories' and name = 'TV';

-- the back wall graphic spans the full width of the booth's back edge
update catalog_item set spec = spec
  || jsonb_build_object('elementKind','display','fullWidth',true,
                        'footprint',jsonb_build_array(10,0.5),'height',8)
where category = 'graphics' and name = 'Back Wall Graphic';
