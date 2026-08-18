/* ============================================================
   config.js — configuration is DATA, not code.

   Everything here is a seed record set. At runtime `FP.config.load()`
   replaces or extends any of it from the server (phase 2), so a show with
   unusual requirements is a config change rather than a dev ticket.

   Five record types live here:
     layerDefs   — z-ordered draw groups
     kindDefs    — element types (what you can place)
     statusDefs  — workflow states, with counts_as_complete
     fieldDefs   — form fields; ONE shape reused by kind props, booth
                   submissions, and per-show custom fields
     ruleDefs    — validation records; evaluators are registered in rules.js
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const ic = {
    wall:    '<path d="M3 8h18M3 16h18M8 8v8M16 8v8"/>',
    door:    '<path d="M4 20V5l10-2v18"/><path d="M14 20h6M4 20h2"/><circle cx="11.5" cy="12" r=".9" fill="currentColor"/>',
    column:  '<rect x="8" y="4" width="8" height="16" rx="1"/><path d="M6 20h12M6 4h12"/>',
    stair:   '<path d="M3 20h5v-4h5v-4h5V8h3"/>',
    dock:    '<path d="M3 17h14V9H3zM17 12h3l1 3v2h-4"/><circle cx="7" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
    fire:    '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5S9 12 11 12c1.6 0 1-4 1-9Z"/>',
    exitrun: '<path d="M14 4h6v16h-6"/><path d="M4 12h10m0 0-3-3m3 3-3 3"/>',
    egress:  '<path d="M3 12h18"/><path d="m15 7 5 5-5 5"/>',
    aid:     '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M12 10v5M9.5 12.5h5"/>',
    extinct: '<path d="M9 8h6v12H9z"/><path d="M11 8V5h3v3M15 6l2-1"/>',
    dead:    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 9 10 6M17 9 7 15"/>',
    aisle:   '<path d="M6 3v18M18 3v18" stroke-dasharray="3 3"/><path d="M12 8v8m0 0-2-2m2 2 2-2"/>',
    zone:    '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="4 3"/>',
    stage:   '<path d="M3 16h18l-3-8H6z"/><path d="M3 16v3h18v-3"/>',
    reg:     '<rect x="3" y="9" width="18" height="7" rx="1"/><path d="M7 9V6h10v3M9 19v-3M15 19v-3"/>',
    food:    '<path d="M5 3v8a2 2 0 0 0 4 0V3M7 11v10"/><path d="M16 3c-1.5 2-2 4-2 6h4c0-2-.5-4-2-6ZM16 9v12"/>',
    lounge:  '<path d="M4 12V9a2 2 0 0 1 4 0v3M16 12V9a2 2 0 0 1 4 0v3"/><rect x="3" y="12" width="18" height="6" rx="2"/><path d="M6 18v2M18 18v2"/>',
    rest:    '<path d="M8 4a1.6 1.6 0 1 0 0 .01M6.5 20v-5H5l1.6-5h2.8L11 15H9.5v5z"/><path d="M16 4a1.6 1.6 0 1 0 0 .01M14 20l1-6h-1.4l1.4-4h2l1.4 4H17l1 6z"/>',
    store:   '<rect x="3" y="7" width="18" height="12" rx="1"/><path d="M3 11h18M9 7V4h6v3"/>',
    table:   '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M6 13v6M18 13v6"/>',
    chair:   '<path d="M6 4h12v8H6z"/><path d="M6 12v8M18 12v8M4 12h16"/>',
    banner:  '<path d="M5 3h14v13l-7-4-7 4z"/>',
    av:      '<rect x="3" y="6" width="14" height="10" rx="2"/><path d="m17 11 4-3v8l-4-3"/>',
    power:   '<path d="m13 2-9 12h7l-1 8 9-12h-7z"/>',
    water:   '<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z"/>',
    wifi:    '<path d="M3 9a15 15 0 0 1 18 0M6.5 13a10 10 0 0 1 11 0M10 16.5a5 5 0 0 1 4 0"/><circle cx="12" cy="20" r="1.1" fill="currentColor"/>',
    rig:     '<path d="M3 5h18M3 9h18M5 5v4M12 5v4M19 5v4"/><path d="M12 9v11m-3 0h6"/>',
    text:    '<path d="M5 6h14M12 6v13M9 19h6"/>',
    dim:     '<path d="M3 8v8M21 8v8M3 12h18"/><path d="m7 9-3 3 3 3M17 9l3 3-3 3"/>',
    booth:   '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18"/>',
    arrow:   '<path d="M4 12h14m0 0-5-5m5 5-5 5"/>',
    panel:   '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 7h8M8 11h8M8 15h4"/>',
    distro:  '<rect x="4" y="7" width="16" height="10" rx="1.5"/><path d="M8 7V4M16 7V4M9 12h6"/>',
    run:     '<path d="M3 17c4 0 4-10 8-10s4 10 8 10"/>',
    gen:     '<rect x="3" y="8" width="18" height="10" rx="2"/><path d="m12 2-2 4h4l-2 4"/><path d="M7 18v2M17 18v2"/>',
    discon:  '<circle cx="12" cy="12" r="9"/><path d="M12 6v7"/><path d="M8.5 8.5a5 5 0 1 0 7 0"/>',
    stool:   '<circle cx="12" cy="10" r="5"/><path d="M12 15v6M9 21h6"/>',
    monitor: '<rect x="3" y="5" width="18" height="11" rx="1.5"/><path d="M12 16v3M8 19h8"/>',
    shelf:   '<path d="M4 8h16M4 14h16M4 6v12M20 6v12"/>',
    drape:   '<path d="M4 5h16M6 5v14M18 5v14"/><path d="M8 5c0 5-1 9 0 14M12 5c0 5-1 9 0 14M16 5c0 5-1 9 0 14"/>',
    sofa:    '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M5 17v2M19 17v2"/>',
    cube:    '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    podium:  '<path d="M8 4h8l1 4H7z"/><path d="M9 8h6v12H9z"/>',
    deck:    '<rect x="3" y="6" width="18" height="12"/><path d="m3 6 18 12M21 6 3 18"/>',
    tower:   '<path d="M8 21V5l4-2 4 2v16"/><path d="M8 9h8M8 13h8M8 17h8"/>',
    ring:    '<path d="M12 2v4"/><circle cx="12" cy="13" r="7"/>',
    carpet:  '<rect x="4" y="4" width="16" height="16"/><path d="M8 8h8v8H8z"/>',
    arch:    '<path d="M4 21V10a8 8 0 0 1 16 0v11"/><path d="M8 21v-9a4 4 0 0 1 8 0v9"/>',
    case:    '<rect x="4" y="7" width="16" height="12" rx="1"/><path d="M4 11h16M12 7v12"/>',
    led:     '<rect x="7" y="3" width="10" height="18" rx="1"/><path d="M10 7h4M10 11h4M10 15h4"/>',
    charge:  '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M6 13v6M18 13v6"/><path d="m13 2-3 5h4l-3 5"/>',
  };
  FP.ICONS = ic;

  /* ------------------------------------------------------------
     Reusable field fragments — kind props and submission forms are
     built from the same field-definition shape.
     ------------------------------------------------------------ */
  const F = {
    label:    { key: 'label',    label: 'Label',        type: 'text' },
    notes:    { key: 'notes',    label: 'Notes',        type: 'textarea' },
    color:    { key: 'color',    label: 'Colour',       type: 'color' },
    number:   { key: 'number',   label: 'Space number', type: 'text', help: 'Shown on the plan and in the manifest' },
    clearance:{ key: 'clearance',label: 'Clearance',    type: 'number', unit: 'len', default: 10,
                help: 'Nothing may be placed within this distance' },
    capacity: { key: 'capacity', label: 'Circuit capacity', type: 'number', unit: 'A', default: 20 },
    height:   { key: 'height',   label: 'Height',       type: 'number', unit: 'len' },

    /* ---- electrical ---- */
    voltage: { key: 'voltage', label: 'Voltage', type: 'select', default: '208',
      options: [['120', '120 V'], ['208', '208 V 3Ø'], ['240', '240 V'], ['480', '480 V 3Ø']] },
    phase: { key: 'phase', label: 'Phase', type: 'select', default: '1',
      options: [['1', 'Single'], ['3', 'Three']] },
    gauge: { key: 'gauge', label: 'Conductor', type: 'select', default: '10',
      options: [['14', '14 AWG'], ['12', '12 AWG'], ['10', '10 AWG'], ['8', '8 AWG'],
                ['6', '6 AWG'], ['4', '4 AWG'], ['2', '2 AWG'], ['1/0', '1/0 AWG']] },
    panelId: { key: 'panelId', label: 'Fed from', type: 'text',
      help: 'Panel or distro ID — referenced by name, not by link' },
    circuitId: { key: 'circuitId', label: 'Circuit', type: 'text' },
    mainAmps: { key: 'mainAmps', label: 'Main breaker', type: 'number', unit: 'A', default: 100 },
    amps: { key: 'amps', label: 'Load', type: 'number', unit: 'A', default: 5 },
    connector: { key: 'connector', label: 'Connector', type: 'select', default: 'edison',
      options: [['edison', 'Edison 5-15'], ['l5-20', 'NEMA L5-20'], ['l6-30', 'NEMA L6-30'],
                ['cs6365', 'CS6365'], ['cam', 'Cam-lock'], ['hardwire', 'Hardwire']] },
    hours: { key: 'hours', label: 'Service hours', type: 'select', default: 'show',
      options: [['show', 'Show hours only'], ['24hr', '24 hour']],
      help: '24-hour power is billed separately and the crew must know' },
    method: { key: 'method', label: 'Routing', type: 'select', default: 'floor',
      options: [['floor', 'Floor'], ['overhead', 'Overhead'], ['trench', 'Trench'],
                ['under-carpet', 'Under carpet']] },

    /* ---- rentals ---- */
    throw_: { key: 'throw', label: 'Table throw', type: 'select', default: 'black',
      options: [['none', 'No throw'], ['black', 'Black'], ['blue', 'Royal blue'],
                ['white', 'White'], ['red', 'Red'], ['custom', 'Custom print']] },
  };

  /* ------------------------------------------------------------
     Colour-by modes.

     On the working plans this replaces, booths are highlighted BY HAND —
     yellow for a 10 amp order, pink for 20 amp — one booth at a time,
     with a felt pen. That is slow, and it goes stale the moment an order
     changes. Colouring is derived from the data instead, so the map is
     never out of date and never mis-highlighted.

     Buckets are records, so a show can recolour without code.
     ------------------------------------------------------------ */
  const colorModes = [
    { id: 'status', name: 'Booking status', from: 'status' },

    { id: 'power', name: 'Power ordered', from: 'amps',
      /* Matched to the pen colours the team already reads. */
      buckets: [
        { max: 0,   name: 'No power',      color: '#e2e8f0' },
        { max: 10,  name: 'Up to 10 A',    color: '#facc15' },
        { max: 20,  name: '11 – 20 A',     color: '#ec4899' },
        { max: 30,  name: '21 – 30 A',     color: '#a855f7' },
        { max: 60,  name: '31 – 60 A',     color: '#f97316' },
        { max: Infinity, name: 'Over 60 A', color: '#ef4444' },
      ] },

    { id: 'tier', name: 'Price tier', from: 'tier',
      values: { premium: '#7c5cfc', standard: '#94a3b8', discount: '#22c55e' } },

    { id: 'type', name: 'Space type', from: 'spaceType',
      values: { inline: '#94a3b8', corner: '#06b6d4', peninsula: '#f59e0b', island: '#a855f7' } },

    { id: 'submission', name: 'Submission received', from: 'submitted',
      values: { yes: '#22c55e', no: '#ef4444' } },

    /* Sections are named by the planner per booth (props.section); the
       colour comes from a stable hash of the name, so "Italian" is the
       same colour on every plan and every reprint. */
    { id: 'section', name: 'Section', from: 'section' },
  ];

  /* Placard-style section tints — light enough to carry booth numbers
     and exhibitor names printed on top, distinct enough to read at
     arm's length on a working sheet. */
  const SECTION_PALETTE = [
    '#93c5fd', '#fca5a5', '#fcd34d', '#86efac', '#c4b5fd', '#f9a8d4',
    '#fdba74', '#67e8f9', '#d9f99d', '#a5b4fc', '#f5d0fe', '#99f6e4',
  ];

  /* ------------------------------------------------------------
     Layers — drawn bottom to top.
     ------------------------------------------------------------ */
  const layerDefs = [
    { id: 'underlay',  name: 'Reference image', visible: true, locked: true },
    { id: 'structure', name: 'Structure',       visible: true, locked: false },
    { id: 'zones',     name: 'Zones & dead space', visible: true, locked: false },
    { id: 'spaces',    name: 'Booth spaces',    visible: true, locked: false },
    { id: 'contents',  name: 'Booth contents',  visible: true, locked: false },
    { id: 'amenities', name: 'Amenities',       visible: true, locked: false },
    { id: 'utilities', name: 'Utilities',       visible: true, locked: false },
    { id: 'electrical',name: 'Electrical',      visible: true, locked: false },
    { id: 'safety',    name: 'Life safety',     visible: true, locked: false },
    { id: 'annotate',  name: 'Annotations',     visible: true, locked: false },
  ];

  /* color + icon give each catalog section its own visual identity in the
     sidebar, instead of every group reading as the same grey text label.
     defaultOpen controls what a first-time user sees expanded — the
     groups reached constantly (spaces, structure, safety) stay open;
     the rest start collapsed so the sidebar isn't a wall of categories
     on first load. Anyone who expands a group has that choice remembered
     via FP.prefs, this only governs the very first visit. */
  const categories = [
    { id: 'spaces',    name: 'Booth spaces',          color: '#7c5cfc', icon: ic.booth,  defaultOpen: true },
    { id: 'structure', name: 'Structure',              color: '#64748b', icon: ic.wall,   defaultOpen: true },
    { id: 'safety',    name: 'Life safety',            color: '#ef4444', icon: ic.fire,   defaultOpen: true },
    { id: 'zones',     name: 'Zones',                  color: '#a855f7', icon: ic.zone,   defaultOpen: false },
    { id: 'amenities', name: 'Amenities & services',   color: '#f97316', icon: ic.stage,  defaultOpen: false },
    { id: 'contents',  name: 'Booth contents',         color: '#94a3b8', icon: ic.table,  defaultOpen: true },
    { id: 'rentals',   name: 'Source One rentals',     color: '#0d9488', icon: ic.sofa,   defaultOpen: true },
    { id: 'utilities', name: 'Utilities',               color: '#facc15', icon: ic.power,  defaultOpen: false },
    { id: 'electrical',name: 'Electrical distribution', color: '#f59e0b', icon: ic.panel,  defaultOpen: false },
    { id: 'annotate',  name: 'Annotation',             color: '#0ea5e9', icon: ic.text,   defaultOpen: false },
  ];

  /* ------------------------------------------------------------
     Element kinds.

     scope: which editing scope offers the kind — 'hall', 'booth', or both.
     flags: behavioural markers the rules engine reads (blocking, isExit…),
            kept as data so a new kind can opt into existing rules.
     ------------------------------------------------------------ */
  const kindDefs = [
    /* ---- sellable space ---- */
    { id: 'space', name: 'Booth space', cat: 'spaces', layer: 'spaces', shape: 'rect', scope: ['hall'],
      size: [10, 10], fill: '#7c5cfc', stroke: '#5a3fd6', opacity: .22, icon: ic.booth,
      flags: { sellable: true, snapChild: true },
      fields: [F.number, { key: 'spaceType', label: 'Type', type: 'select', default: 'inline',
                 options: [['inline', 'Inline'], ['corner', 'Corner'], ['peninsula', 'Peninsula'], ['island', 'Island']] },
               { key: 'tier', label: 'Tier', type: 'select', default: 'standard',
                 options: [['standard', 'Standard'], ['premium', 'Premium'], ['discount', 'Discount']] },
               F.notes] },

    /* ---- structure ---- */
    { id: 'wall', name: 'Wall / partition', cat: 'structure', layer: 'structure', shape: 'line', scope: ['hall', 'booth'],
      thickness: 0.75, fill: '#8b95a8', stroke: '#5c667a', opacity: .95, icon: ic.wall,
      /* Not `blocking`: a booth legitimately backs onto a perimeter or
         partition wall, and the wall's own line thickness made that
         normal, touching placement register as an overlap — every booth
         against a hall wall would report "placed on a blocking element". */
      flags: {}, fields: [F.label, F.height] },
    /* Pipe & drape — what the floor is actually built from.
       Height is the thing that matters commercially: an 8 ft back wall
       and a 3 ft side rail are different line items, ordered and priced
       separately, and on the working plans they are distinguished by
       line colour. */
    { id: 'drape', name: 'Pipe & drape', cat: 'structure', layer: 'structure',
      shape: 'line', scope: ['hall', 'booth'], thickness: 0.5,
      fill: '#1e293b', stroke: '#1e293b', opacity: .95, icon: ic.drape,
      /* Deliberately NOT `blocking` — that flag means "a booth may not
         touch this" (dead space, columns), and a back wall is meant to
         run flush along a booth's edge. Flagging it blocking made every
         generated back wall fire "booth placed on blocking element"
         against the very booth it belongs to. */
      flags: { drape: true },
      fields: [
        { key: 'drapeHeight', label: 'Drape height', type: 'select', default: '8',
          options: [['3', "3 ft side rail"], ['8', "8 ft back wall"],
                    ['10', "10 ft"], ['12', "12 ft"], ['16', "16 ft masking"]] },
        { key: 'drapeColor', label: 'Colour', type: 'select', default: 'black',
          options: [['black', 'Black'], ['blue', 'Blue'], ['white', 'White'],
                    ['grey', 'Grey'], ['red', 'Red']] },
        { key: 'drapeRole', label: 'Function', type: 'select', default: 'backwall',
          options: [['backwall', 'Back wall'], ['siderail', 'Side rail'],
                    ['masking', 'Masking / boneyard'], ['stage', 'Stage surround']] },
        { key: 'sectionWidth', label: 'Section width', type: 'number', unit: 'len', default: 10,
          help: 'Crossbar span — drives the panel and upright counts' },
        F.label,
      ] },

    { id: 'column', name: 'Column / pillar', cat: 'structure', layer: 'structure', shape: 'rect', scope: ['hall'],
      size: [2.5, 2.5], fill: '#6b7688', stroke: '#414b5c', opacity: .9, icon: ic.column,
      flags: { blocking: true, obstruction: true }, fields: [F.label] },
    { id: 'door', name: 'Door / entrance', cat: 'structure', layer: 'structure', shape: 'rect', scope: ['hall'],
      size: [8, 1.5], fill: '#22c55e', stroke: '#16a34a', opacity: .55, icon: ic.door,
      flags: { entrance: true, keepClear: true }, fields: [F.label, F.clearance] },
    { id: 'loading-dock', name: 'Loading dock', cat: 'structure', layer: 'structure', shape: 'rect', scope: ['hall'],
      size: [14, 10], fill: '#94a3b8', stroke: '#64748b', opacity: .28, icon: ic.dock,
      flags: { dock: true }, fields: [F.label, { key: 'dockId', label: 'Dock ID', type: 'text' }] },
    { id: 'stairs', name: 'Stairs / escalator', cat: 'structure', layer: 'structure', shape: 'rect', scope: ['hall'],
      size: [12, 6], fill: '#94a3b8', stroke: '#64748b', opacity: .3, icon: ic.stair,
      flags: { blocking: true }, fields: [F.label] },

    /* ---- life safety ---- */
    { id: 'fire-exit', name: 'Fire exit', cat: 'safety', layer: 'safety', shape: 'rect', scope: ['hall'],
      size: [8, 2], fill: '#ef4444', stroke: '#dc2626', opacity: .8, icon: ic.fire,
      flags: { exit: true, keepClear: true },
      fields: [F.label, { ...F.clearance, default: 10 },
               { key: 'exitWidth', label: 'Clear width', type: 'number', unit: 'len', default: 8 }] },
    { id: 'egress-path', name: 'Egress path', cat: 'safety', layer: 'safety', shape: 'line', scope: ['hall'],
      thickness: 6, fill: '#22c55e', stroke: '#16a34a', opacity: .16, icon: ic.egress,
      flags: { egress: true, keepClear: true }, fields: [F.label] },
    { id: 'fire-lane', name: 'Fire lane / keep clear', cat: 'safety', layer: 'safety', shape: 'rect', scope: ['hall'],
      size: [40, 12], fill: '#ef4444', stroke: '#dc2626', opacity: .1, hatch: 'diag-red', icon: ic.exitrun,
      flags: { keepClear: true }, fields: [F.label] },
    { id: 'extinguisher', name: 'Fire extinguisher', cat: 'safety', layer: 'safety', shape: 'marker', scope: ['hall'],
      r: 1.2, fill: '#ef4444', stroke: '#b91c1c', icon: ic.extinct, fields: [F.label] },
    { id: 'first-aid', name: 'First aid station', cat: 'safety', layer: 'safety', shape: 'rect', scope: ['hall'],
      size: [10, 8], fill: '#f87171', stroke: '#ef4444', opacity: .28, icon: ic.aid, fields: [F.label] },

    /* ---- zones ---- */
    { id: 'dead-space', name: 'Dead space', cat: 'zones', layer: 'zones', shape: 'rect', scope: ['hall'],
      size: [20, 20], fill: '#64748b', stroke: '#475569', opacity: .16, hatch: 'diag', icon: ic.dead,
      flags: { blocking: true, unsellable: true },
      fields: [F.label,
        { key: 'ceiling', label: 'Ceiling height', type: 'number', unit: 'len',
          help: 'For low-clearance areas — the feet show on the plan label' },
        F.notes] },
    { id: 'dead-space-poly', name: 'Dead space (freeform)', cat: 'zones', layer: 'zones', shape: 'poly', scope: ['hall'],
      fill: '#64748b', stroke: '#475569', opacity: .16, hatch: 'diag', icon: ic.dead,
      flags: { blocking: true, unsellable: true }, fields: [F.label, F.notes] },
    { id: 'aisle', name: 'Aisle', cat: 'zones', layer: 'zones', shape: 'rect', scope: ['hall'],
      size: [10, 80], fill: '#a3a3a3', stroke: '#78716c', opacity: .08, dashed: true, icon: ic.aisle,
      flags: { aisle: true, keepClear: true }, fields: [F.label] },
    { id: 'zone', name: 'Named zone / pavilion', cat: 'zones', layer: 'zones', shape: 'rect', scope: ['hall'],
      size: [40, 40], fill: '#a855f7', stroke: '#9333ea', opacity: .1, dashed: true, icon: ic.zone,
      flags: { zone: true },
      fields: [F.label, F.color,
        { key: 'ceiling', label: 'Ceiling height', type: 'number', unit: 'len',
          help: 'Overhead clearance — shown on the zone label so crews and '
              + 'exhibitors know exactly how many feet they have' }] },

    /* ---- amenities ---- */
    { id: 'registration', name: 'Registration', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [24, 8], fill: '#06b6d4', stroke: '#0891b2', opacity: .3, icon: ic.reg, fields: [F.label] },
    { id: 'stage', name: 'Stage / theatre', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [30, 20], fill: '#f59e0b', stroke: '#d97706', opacity: .28, icon: ic.stage, fields: [F.label] },
    { id: 'food', name: 'Food & beverage', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [20, 15], fill: '#f97316', stroke: '#ea580c', opacity: .28, icon: ic.food, fields: [F.label] },
    { id: 'lounge', name: 'Lounge / seating', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [20, 15], fill: '#14b8a6', stroke: '#0d9488', opacity: .26, icon: ic.lounge, fields: [F.label] },
    { id: 'restroom', name: 'Restrooms', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [14, 12], fill: '#38bdf8', stroke: '#0284c7', opacity: .28, icon: ic.rest,
      fields: [F.label,
        { key: 'poleSign', label: 'Overhead pictogram sign', type: 'bool', default: false,
          help: 'Adds the blue restroom sign on a pole in the 3D view' }] },
    { id: 'storage', name: 'Storage', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [12, 10], fill: '#a8a29e', stroke: '#78716c', opacity: .28, icon: ic.store, fields: [F.label] },
    { id: 'av-booth', name: 'AV / production', cat: 'amenities', layer: 'amenities', shape: 'rect', scope: ['hall'],
      size: [10, 8], fill: '#8b5cf6', stroke: '#7c3aed', opacity: .28, icon: ic.av, fields: [F.label] },

    /* ---- booth contents (same primitive, smaller scale) ---- */
    { id: 'table', name: 'Table / counter', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['hall', 'booth'],
      size: [6, 2.5], fill: '#d6d3d1', stroke: '#a8a29e', opacity: .55, icon: ic.table, fields: [F.label] },
    { id: 'chair', name: 'Chair', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['booth'],
      size: [1.6, 1.6], fill: '#cbd5e1', stroke: '#94a3b8', opacity: .6, icon: ic.chair, fields: [F.label] },
    { id: 'display', name: 'Display / banner', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['booth'],
      size: [8, 1], fill: '#818cf8', stroke: '#6366f1', opacity: .55, icon: ic.banner,
      flags: { heightRegulated: true }, fields: [F.label, { ...F.height, default: 8 }] },
    { id: 'stool', name: 'Bar stool', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['booth'],
      size: [1.5, 1.5], fill: '#cbd5e1', stroke: '#64748b', opacity: .6, icon: ic.stool,
      fields: [F.label] },
    { id: 'monitor', name: 'Monitor / TV', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['booth'],
      size: [4, 1.5], fill: '#334155', stroke: '#1e293b', opacity: .8, icon: ic.monitor,
      flags: { heightRegulated: true }, fields: [F.label, { ...F.height, default: 6 }] },
    { id: 'shelf', name: 'Shelf', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['booth'],
      size: [4, 1], fill: '#94a3b8', stroke: '#64748b', opacity: .5, icon: ic.shelf,
      fields: [F.label] },
    { id: 'counter', name: 'Reception counter', cat: 'contents', layer: 'contents', shape: 'rect', scope: ['booth'],
      size: [4, 2], fill: '#e7e5e4', stroke: '#78716c', opacity: .55, icon: ic.reg, fields: [F.label] },

    /* ---- Source One rentals ----
       The company's own product lines from sourceoneevents.com, one kind
       per line item so a plan doubles as an order sheet. The site publishes
       no dimensions, so footprints are the industry-standard sizes these
       products ship in. `symbol` reuses an ARCH renderer, so a 60" round
       draws as a circle and a bar gets its service edge. */
    { id: 'table-6ft', name: 'Banquet table 6 ft', short: '6 ft table', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [6, 2.5], symbol: 'table',
      fill: '#d6d3d1', stroke: '#78716c', opacity: .55, icon: ic.table, fields: [F.label, F.throw_] },
    { id: 'table-8ft', name: 'Banquet table 8 ft', short: '8 ft table', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [8, 2.5], symbol: 'table',
      fill: '#d6d3d1', stroke: '#78716c', opacity: .55, icon: ic.table, fields: [F.label, F.throw_] },
    { id: 'table-round-60', name: 'Round table 60"', short: '60" round', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [5, 5], symbol: 'table',
      fill: '#d6d3d1', stroke: '#78716c', opacity: .55, icon: ic.table, fields: [F.label, F.throw_] },
    { id: 'cocktail-table', name: 'Networking table 30"', short: '30" round', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [2.5, 2.5], symbol: 'table',
      fill: '#d6d3d1', stroke: '#78716c', opacity: .55, icon: ic.stool, fields: [F.label, F.throw_] },
    { id: 'charging-table', name: 'Charging table', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [6, 2.5], symbol: 'table',
      fill: '#fbbf24', stroke: '#b45309', opacity: .5, icon: ic.charge,
      flags: { power: true }, fields: [F.label, { ...F.amps, default: 5 }] },
    { id: 'sofa', name: 'Lounge sofa', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [7, 3], symbol: 'soft',
      fill: '#0d9488', stroke: '#0f766e', opacity: .45, icon: ic.sofa, fields: [F.label, F.color] },
    { id: 'lounge-chair', name: 'Lounge chair', short: 'Lounge', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [3, 3], symbol: 'soft',
      fill: '#0d9488', stroke: '#0f766e', opacity: .45, icon: ic.lounge, fields: [F.label, F.color] },
    { id: 'cube-seat', name: 'Branded cube', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [1.5, 1.5], symbol: 'cube',
      fill: '#0d9488', stroke: '#0f766e', opacity: .5, icon: ic.cube, fields: [F.label, F.color] },
    { id: 'coffee-table', name: 'Coffee table', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [4, 2], symbol: 'table',
      fill: '#d6d3d1', stroke: '#78716c', opacity: .5, icon: ic.table, fields: [F.label] },
    { id: 'bar', name: 'Bar', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [6, 2.5], symbol: 'counter',
      fill: '#a78bfa', stroke: '#7c3aed', opacity: .5, icon: ic.food, fields: [F.label] },
    { id: 'registration-counter', name: 'Registration counter', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [6, 2.5], symbol: 'counter',
      fill: '#06b6d4', stroke: '#0891b2', opacity: .5, icon: ic.reg, fields: [F.label] },
    { id: 'podium', name: 'Podium / lectern', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [2, 1.5], symbol: 'cube',
      fill: '#a8a29e', stroke: '#57534e', opacity: .6, icon: ic.podium, fields: [F.label] },
    { id: 'stage-deck', name: 'Stage deck 4×8', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [8, 4], symbol: 'deck',
      fill: '#f59e0b', stroke: '#b45309', opacity: .4, icon: ic.deck,
      fields: [F.label, { key: 'deckHeight', label: 'Deck height', type: 'select', default: '24',
        options: [['16', '16 in'], ['24', '24 in'], ['32', '32 in']] }] },
    { id: 'display-case', name: 'Display case', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [5, 1.7], symbol: 'case',
      fill: '#94a3b8', stroke: '#475569', opacity: .5, icon: ic.case, fields: [F.label] },
    { id: 'kiosk', name: 'Kiosk / workstation', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [3, 2], symbol: 'monitor',
      fill: '#334155', stroke: '#1e293b', opacity: .7, icon: ic.monitor,
      flags: { heightRegulated: true }, fields: [F.label, { ...F.height, default: 7 }] },
    { id: 'tower', name: 'Tower', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [4, 4],
      fill: '#8b5cf6', stroke: '#6d28d9', opacity: .45, icon: ic.tower,
      flags: { heightRegulated: true }, fields: [F.label, { ...F.height, default: 12 }] },
    { id: 'banner-stand', name: 'Banner stand', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [3, 1], symbol: 'display',
      fill: '#818cf8', stroke: '#6366f1', opacity: .55, icon: ic.banner,
      flags: { heightRegulated: true }, fields: [F.label, { ...F.height, default: 8 }] },
    { id: 'led-poster', name: 'LED poster', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [2, 1], symbol: 'monitor',
      fill: '#334155', stroke: '#0f172a', opacity: .8, icon: ic.led,
      flags: { power: true }, fields: [F.label, { ...F.amps, default: 3 }] },
    { id: 'poster-board', name: 'Poster board', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [4, 1], symbol: 'display',
      fill: '#818cf8', stroke: '#6366f1', opacity: .55, icon: ic.banner, fields: [F.label] },
    { id: 'grid-wall', name: 'Grid / slat wall', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [4, 0.5], symbol: 'display',
      fill: '#64748b', stroke: '#475569', opacity: .6, icon: ic.wall, fields: [F.label] },
    { id: 'hanging-sign', name: 'Hanging sign / circle sign', cat: 'rentals', layer: 'annotate', shape: 'marker',
      scope: ['hall', 'booth'], r: 2, fill: '#ec4899', stroke: '#be185d', icon: ic.ring,
      flags: { rigging: true },
      fields: [F.label, { key: 'loadLbs', label: 'Load', type: 'number', unit: 'lb', default: 150 }] },
    { id: 'entrance-unit', name: 'Entrance unit', cat: 'rentals', layer: 'structure', shape: 'rect',
      scope: ['hall'], size: [12, 3],
      fill: '#22c55e', stroke: '#15803d', opacity: .35, icon: ic.arch,
      flags: { entrance: true }, fields: [F.label, { ...F.height, default: 12 }] },
    /* Flooring, straight off the website: expo/plush/tiles/printed/
       laminate/vinyl, in the standard expo colour range. The colour
       select stores the hex, so the plan and the 3D pick it up as-is
       while the dropdown reads like the order form. */
    { id: 'carpet', name: 'Carpet', cat: 'rentals', layer: 'zones', shape: 'rect',
      scope: ['hall', 'booth'], size: [10, 10],
      fill: '#8b95a8', stroke: '#6b7280', opacity: .3, icon: ic.carpet,
      fields: [
        { key: 'flooringType', label: 'Flooring type', type: 'select', default: 'expo',
          options: [['expo', 'Expo carpet (standard)'], ['plush', 'Plush carpet (deluxe)'],
                    ['tiles', 'Carpet tiles'], ['printed', 'Custom printed carpet'],
                    ['laminate', 'Laminate (wood finish)'], ['vinyl', 'Printed vinyl']] },
        { key: 'color', label: 'Colour', type: 'select', default: '#4b5563',
          options: [['#1c1e24', 'Black'], ['#4b5563', 'Pepper grey'], ['#374151', 'Charcoal'],
                    ['#1d4ed8', 'Electric blue'], ['#1e3a5f', 'Navy'], ['#b91c1c', 'Red'],
                    ['#7f1d1d', 'Burgundy'], ['#14532d', 'Hunter green'], ['#d6cfc2', 'Beige'],
                    ['#5b21b6', 'Purple'], ['#0f766e', 'Teal'], ['#f4f4f2', 'White'],
                    ['#8a6d4a', 'Wood laminate']] },
        { key: 'padding', label: 'Carpet padding', type: 'bool', default: false,
          help: 'Recommended wherever staff stand all day' },
        F.label] },
    { id: 'turf', name: 'Turf / artificial grass', cat: 'rentals', layer: 'zones', shape: 'rect',
      scope: ['hall', 'booth'], size: [10, 10],
      fill: '#3e7d3a', stroke: '#2f5f2c', opacity: .45, icon: ic.carpet,
      fields: [
        { key: 'color', label: 'Turf style', type: 'select', default: '#3e7d3a',
          options: [['#3e7d3a', 'Field green'], ['#4c9f45', 'Bright green'],
                    ['#2f5f2c', 'Deep pile green']] },
        F.label] },
    { id: 'charging-station', name: 'Charging station', short: 'Charging', cat: 'rentals', layer: 'contents', shape: 'rect',
      scope: ['hall', 'booth'], size: [2.5, 2.5],
      fill: '#fbbf24', stroke: '#b45309', opacity: .55, icon: ic.charge,
      flags: { power: true }, fields: [F.label, { ...F.amps, default: 5 }] },
    { id: 'custom-room', name: 'Custom room / hardwall', cat: 'rentals', layer: 'structure', shape: 'rect',
      scope: ['hall', 'booth'], size: [10, 10],
      fill: '#e7e5e4', stroke: '#57534e', opacity: .3, icon: ic.store,
      fields: [F.label, { ...F.height, default: 8 }] },

    /* ---- utilities ---- */
    { id: 'power-drop', name: 'Power drop', cat: 'utilities', layer: 'utilities', shape: 'marker', scope: ['hall', 'booth'],
      r: 1, fill: '#facc15', stroke: '#ca8a04', icon: ic.power,
      flags: { power: true },
      fields: [F.label, F.amps, F.voltage, F.phase, F.panelId, F.circuitId,
               F.connector, F.hours, F.capacity] },
    { id: 'water-drop', name: 'Water / drain', cat: 'utilities', layer: 'utilities', shape: 'marker', scope: ['hall', 'booth'],
      r: 1, fill: '#38bdf8', stroke: '#0284c7', icon: ic.water, fields: [F.label] },
    { id: 'network-drop', name: 'Network drop', cat: 'utilities', layer: 'utilities', shape: 'marker', scope: ['hall', 'booth'],
      r: 1, fill: '#a78bfa', stroke: '#7c3aed', icon: ic.wifi, fields: [F.label] },
    { id: 'rigging-point', name: 'Rigging point', cat: 'utilities', layer: 'utilities', shape: 'marker', scope: ['hall', 'booth'],
      r: 1, fill: '#f472b6', stroke: '#db2777', icon: ic.rig,
      flags: { rigging: true },
      fields: [F.label, { key: 'loadLbs', label: 'Load', type: 'number', unit: 'lb', default: 0 }] },
    { id: 'rigging-zone', name: 'Rigging-allowed zone', cat: 'utilities', layer: 'utilities', shape: 'rect', scope: ['hall'],
      size: [40, 40], fill: '#f472b6', stroke: '#db2777', opacity: .07, dashed: true, icon: ic.rig,
      flags: { riggingZone: true }, fields: [F.label] },

    /* ---- electrical distribution ----
       Topology is by ID reference (panelId: "MDP-1"), never object links:
       it survives a JSON round-trip, maps straight onto the Postgres model,
       and lets an exhibitor's submission cite a board they never touched. */
    { id: 'electrical-panel', name: 'Electrical panel', cat: 'electrical', layer: 'electrical',
      shape: 'rect', scope: ['hall'], size: [5, 2.5],
      fill: '#f59e0b', stroke: '#b45309', opacity: .85, icon: ic.panel,
      /* keepClear + panel drives the NEC 110.26 working-space check */
      flags: { panel: true, keepClear: true, electrical: true },
      fields: [{ key: 'panelId', label: 'Panel ID', type: 'text', default: 'MDP-1' },
               F.voltage, F.phase, { ...F.mainAmps, default: 400 },
               { ...F.clearance, default: 3, help: 'NEC 110.26 working space in front of the board' },
               F.label, F.notes] },

    { id: 'distro-box', name: 'Distro box', cat: 'electrical', layer: 'electrical',
      shape: 'rect', scope: ['hall'], size: [2.5, 2],
      fill: '#fbbf24', stroke: '#d97706', opacity: .9, icon: ic.distro,
      flags: { panel: true, electrical: true, distro: true },
      fields: [{ key: 'distroId', label: 'Distro ID', type: 'text', default: 'D-1' },
               F.panelId, F.voltage, F.phase, F.mainAmps, F.label] },

    { id: 'electrical-run', name: 'Cable run / feeder', cat: 'electrical', layer: 'electrical',
      shape: 'line', scope: ['hall', 'booth'], thickness: 0.5,
      fill: '#f59e0b', stroke: '#f59e0b', opacity: .85, icon: ic.run,
      flags: { electrical: true, cableRun: true },
      fields: [F.circuitId, F.panelId, F.gauge, { ...F.amps, default: 100 },
               F.voltage, F.phase, F.method,
               { key: 'isBus', label: 'Distribution bus', type: 'bool', default: false,
                 help: 'On the 30 ft strip-bus module — booths are expected to reach this. '
                     + 'Leave off for a panel-to-distro backbone feeder.' },
               F.label] },

    { id: 'generator', name: 'Generator', cat: 'electrical', layer: 'electrical',
      shape: 'rect', scope: ['hall'], size: [16, 8],
      fill: '#78716c', stroke: '#44403c', opacity: .55, icon: ic.gen,
      flags: { panel: true, electrical: true },
      fields: [{ key: 'panelId', label: 'Source ID', type: 'text', default: 'GEN-1' },
               F.voltage, F.phase, { ...F.mainAmps, default: 600 }, F.label, F.notes] },

    { id: 'disconnect', name: 'Disconnect', cat: 'electrical', layer: 'electrical',
      shape: 'marker', scope: ['hall'], r: 1,
      fill: '#ef4444', stroke: '#991b1b', icon: ic.discon,
      flags: { electrical: true },
      fields: [F.label, F.panelId] },

    /* ---- annotation ---- */
    { id: 'text', name: 'Text label', cat: 'annotate', layer: 'annotate', shape: 'text', scope: ['hall', 'booth'],
      fill: 'transparent', stroke: 'transparent', icon: ic.text,
      fields: [{ key: 'text', label: 'Text', type: 'text', default: 'Label' },
               { key: 'fontSize', label: 'Size', type: 'number', unit: 'len', default: 4 }, F.color] },
    { id: 'dimension', name: 'Dimension line', cat: 'annotate', layer: 'annotate', shape: 'line', scope: ['hall', 'booth'],
      thickness: 0, fill: '#e11d48', stroke: '#e11d48', icon: ic.dim,
      flags: { dimension: true }, fields: [F.label] },
    { id: 'arrow', name: 'Arrow / flow', cat: 'annotate', layer: 'annotate', shape: 'line', scope: ['hall', 'booth'],
      thickness: 0.4, fill: '#0ea5e9', stroke: '#0ea5e9', icon: ic.arrow,
      flags: { arrow: true }, fields: [F.label] },
    /* markup for show management: highlight an area, leave a note —
       the felt pen and the post-it, but they survive reprints */
    { id: 'marker', name: 'Marker / highlight', cat: 'annotate', layer: 'annotate', shape: 'poly', scope: ['hall', 'booth'],
      fill: '#ef4444', stroke: '#dc2626', opacity: .22, icon: ic.zone,
      fields: [F.label, F.color] },
    { id: 'note', name: 'Sticky note', cat: 'annotate', layer: 'annotate', shape: 'rect', scope: ['hall', 'booth'],
      size: [10, 7], fill: '#fde047', stroke: '#eab308', opacity: .92, icon: ic.text,
      fields: [{ key: 'label', label: 'Note', type: 'text', default: 'Note' }, F.color] },
  ];

  /* ------------------------------------------------------------
     Workflow states. `complete` is the counts_as_complete flag the
     ops dashboard totals against.
     ------------------------------------------------------------ */
  const statusDefs = [
    { id: 'available',  name: 'Available',    color: '#64748b', complete: false, order: 1 },
    { id: 'held',       name: 'On hold',      color: '#f59e0b', complete: false, order: 2 },
    { id: 'sold',       name: 'Sold',         color: '#3b82f6', complete: false, order: 3 },
    { id: 'awaiting',   name: 'Awaiting info',color: '#f97316', complete: false, order: 4 },
    { id: 'submitted',  name: 'Submitted',    color: '#06b6d4', complete: false, order: 5 },
    { id: 'approved',   name: 'Approved',     color: '#22c55e', complete: true,  order: 6 },
    { id: 'changes',    name: 'Changes needed',color: '#ef4444',complete: false, order: 7 },
  ];

  /* ------------------------------------------------------------
     Space types — height limits live here, so the classic
     "8ft back wall / 4ft sides" rule is editable per show.
     ------------------------------------------------------------ */
  const spaceTypeDefs = [
    { id: 'inline',    name: 'Inline',    maxHeight: 8,  maxSideHeight: 4 },
    { id: 'corner',    name: 'Corner',    maxHeight: 8,  maxSideHeight: 4 },
    { id: 'peninsula', name: 'Peninsula', maxHeight: 16, maxSideHeight: 4 },
    { id: 'island',    name: 'Island',    maxHeight: 20, maxSideHeight: 20 },
  ];

  /* ------------------------------------------------------------
     Rule records. `type` maps to an evaluator registered in rules.js.
     Everything else is editable data.
     ------------------------------------------------------------ */
  const ruleDefs = [
    { id: 'r-overlap',   type: 'no-overlap',       severity: 'error',   enabled: true, scope: 'hall',
      name: 'Booths must not overlap', params: {} },
    { id: 'r-bounds',    type: 'inside-bounds',    severity: 'error',   enabled: true, scope: 'hall',
      name: 'Everything stays inside the hall', params: {} },
    { id: 'r-blocking',  type: 'not-on-blocking',  severity: 'error',   enabled: true, scope: 'hall',
      name: 'No booths on dead space or obstructions', params: {} },
    { id: 'r-clearance', type: 'keep-clear',       severity: 'error',   enabled: true, scope: 'hall',
      name: 'Fire exit and egress clearance', params: { defaultClearance: 10 } },
    { id: 'r-exits',     type: 'min-exit-count',   severity: 'error',   enabled: true, scope: 'hall',
      name: 'Hall must have fire exits', params: { min: 2 } },
    { id: 'r-aisle',     type: 'min-aisle-width',  severity: 'warning', enabled: true, scope: 'hall',
      name: 'Minimum aisle width', params: { min: 10 } },
    { id: 'r-footprint', type: 'inside-footprint', severity: 'error',   enabled: true,
      name: 'Booth contents stay inside the footprint', params: {} },
    { id: 'r-height',    type: 'height-limit',     severity: 'warning', enabled: true,
      name: 'Height limits by space type', params: {} },
    { id: 'r-power',     type: 'power-capacity',   severity: 'warning', enabled: true,
      name: 'Power draw within circuit capacity', params: { capacity: 20 } },
    { id: 'r-rigzone',   type: 'rigging-in-zone',  severity: 'warning', enabled: true, scope: 'hall',
      name: 'Rigging points inside allowed zones', params: {} },
    { id: 'r-required',  type: 'required-fields',  severity: 'warning', enabled: true,
      name: 'Required details complete', params: {} },
    { id: 'r-numbered',  type: 'unique-numbers',   severity: 'warning', enabled: true, scope: 'hall',
      name: 'Space numbers unique and present', params: {} },

    /* ---- electrical ---- */
    { id: 'r-panel-load', type: 'panel-load',      severity: 'warning', enabled: true, scope: 'hall',
      name: 'Panel load within capacity',
      /* NEC 210.19 continuous-load derate: design to 80% of the breaker. */
      params: { derate: 0.8 } },
    { id: 'r-unassigned', type: 'unassigned-power', severity: 'warning', enabled: true, scope: 'hall',
      name: 'Power drops assigned to a panel', params: {} },
    { id: 'r-bus',       type: 'bus-reach',        severity: 'warning', enabled: true, scope: 'hall',
      name: 'Booths reach an electrical bus',
      /* 10 ft booth + 10 ft aisle + 10 ft booth */
      params: { module: 30, maxDistance: 15 } },
    { id: 'r-vdrop',     type: 'voltage-drop',     severity: 'warning', enabled: true, scope: 'hall',
      name: 'Voltage drop within limit', params: { maxPercent: 3 } },
  ];

  /* ------------------------------------------------------------
     Standard trade-show footprints.
     ------------------------------------------------------------ */
  const presetDefs = [
    { w: 10, h: 10, label: '10 × 10', note: 'Inline',   spaceType: 'inline' },
    { w: 10, h: 20, label: '10 × 20', note: 'Inline',   spaceType: 'inline' },
    { w: 20, h: 20, label: '20 × 20', note: 'Island',   spaceType: 'island' },
    { w: 20, h: 30, label: '20 × 30', note: 'Island',   spaceType: 'island' },
    { w: 30, h: 30, label: '30 × 30', note: 'Island',   spaceType: 'island' },
    { w: 8,  h: 10, label: '8 × 10',  note: 'Tabletop', spaceType: 'inline' },
  ];

  /* ------------------------------------------------------------
     Registry
     ------------------------------------------------------------ */
  const cfg = {
    layers: layerDefs,
    categories,
    kinds: kindDefs,
    statuses: statusDefs,
    spaceTypes: spaceTypeDefs,
    rules: ruleDefs,
    presets: presetDefs,
    colorModes,
    palette: ['#7c5cfc', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
              '#14b8a6', '#f97316', '#06b6d4', '#ec4899', '#64748b'],
    _index: {},
  };

  function reindex() {
    cfg._index = { kinds: {}, statuses: {}, layers: {}, spaceTypes: {} };
    cfg.kinds.forEach((k) => (cfg._index.kinds[k.id] = k));
    cfg.statuses.forEach((s) => (cfg._index.statuses[s.id] = s));
    cfg.layers.forEach((l, i) => (cfg._index.layers[l.id] = { ...l, order: i }));
    cfg.spaceTypes.forEach((s) => (cfg._index.spaceTypes[s.id] = s));
  }

  /** Replace or merge config from the server. Called on show load in phase 2. */
  cfg.load = (records = {}) => {
    for (const key of ['layers', 'categories', 'kinds', 'statuses', 'spaceTypes', 'rules', 'presets']) {
      if (!records[key]) continue;
      if (records[`${key}Mode`] === 'merge') {
        const byId = Object.fromEntries(cfg[key].map((r) => [r.id, r]));
        records[key].forEach((r) => (byId[r.id] = { ...byId[r.id], ...r }));
        cfg[key] = Object.values(byId);
      } else {
        cfg[key] = records[key];
      }
    }
    reindex();
    return cfg;
  };

  cfg.kind      = (id) => cfg._index.kinds[id] || cfg._index.kinds.space;
  cfg.status    = (id) => cfg._index.statuses[id] || cfg.statuses[0];
  cfg.layer     = (id) => cfg._index.layers[id] || { id, name: id, order: 99 };
  cfg.spaceType = (id) => cfg._index.spaceTypes[id] || cfg.spaceTypes[0];
  cfg.layerOrder = (id) => (cfg._index.layers[id]?.order ?? 99);
  cfg.kindsForScope = (scope) => cfg.kinds.filter((k) => !k.scope || k.scope.includes(scope));
  cfg.flag = (kindId, flag) => !!cfg.kind(kindId)?.flags?.[flag];
  cfg.colorMode = (id) => cfg.colorModes.find((m) => m.id === id) || cfg.colorModes[0];

  /** Colour for a section name. Sections on the open plan take distinct
      palette slots by alphabetical rank — two sections can never share a
      colour until a plan has more than twelve. Names not on this plan
      fall back to a stable hash. */
  cfg.sectionColor = (name) => {
    const s = String(name || '').trim();
    if (!s) return '#e2e8f0';
    const uniq = [...new Set((FP.spaces?.() || [])
      .map((sp) => String(sp.props?.section || '').trim()).filter(Boolean)
      .map((n) => n.toLowerCase()))].sort();
    const i = uniq.indexOf(s.toLowerCase());
    if (i >= 0) return SECTION_PALETTE[i % SECTION_PALETTE.length];
    let h = 0;
    const t = s.toLowerCase();
    for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) >>> 0;
    return SECTION_PALETTE[h % SECTION_PALETTE.length];
  };

  /**
   * The colour a space should take under a given mode, plus the legend
   * entry it belongs to. Returns null when the mode does not apply, so
   * the caller can fall back to the kind's own colour.
   *
   * @param {object} space  the space element
   * @param {string} modeId
   * @param {number} amps   total ordered load, supplied by the caller
   *                        because it is summed from child drops
   */
  cfg.colorFor = (space, modeId, amps) => {
    const mode = cfg.colorMode(modeId);
    if (!mode) return null;

    if (mode.id === 'status') {
      const st = cfg.status(space.props.status);
      return st ? { color: st.color, label: st.name } : null;
    }

    if (mode.id === 'section') {
      const s = String(space.props.section || '').trim();
      return s ? { color: cfg.sectionColor(s), label: s } : null;
    }

    if (mode.buckets) {
      const v = Number(amps) || 0;
      const b = mode.buckets.find((x) => v <= x.max) || mode.buckets[mode.buckets.length - 1];
      return { color: b.color, label: b.name };
    }

    if (mode.values) {
      let key = space.props[mode.from];
      if (mode.id === 'submission') key = space.props.submitted ? 'yes' : 'no';
      const color = mode.values[key];
      if (!color) return null;
      const nice = mode.id === 'type' ? cfg.spaceType(key).name
                 : String(key).charAt(0).toUpperCase() + String(key).slice(1);
      return { color, label: nice };
    }
    return null;
  };

  reindex();
  FP.config = cfg;
})(window);
