# Floorplan Studio — Source One Events

A web-based floor plan editor for trade shows. Draw the hall shell, mark dead space
and fire exits, lay out and number booth spaces, design the electrical distribution
and pipe & drape, and let a configurable rules engine catch problems before anyone
is standing on the floor. Exhibitors sign in with a magic link, see their own booth
only, order furniture and graphics, and submit — enforced by the database, not the UI.

No build step. Plain HTML, CSS and JavaScript — open it with any static server and it runs.

```bash
python3 -m http.server 4180 --directory "$(pwd)"
```

Then open <http://localhost:4180>. It deploys to Vercel as a static directory, unchanged.

---

## The two structural decisions

Everything else follows from these.

### 1. Configuration is data, not code

Element types, layers, statuses, space types, form fields, validation rules, colour
modes, and booth presets are all **records** in [`js/config.js`](js/config.js). A
show with unusual requirements is a config change, not a dev ticket.

`FP.config.load(records)` replaces or merges any of those record sets at runtime, so
moving them into Postgres changed nothing above them.

Concretely: adding `{ key: 'riser', label: 'Riser height', type: 'number', unit: 'len' }`
to a kind's `fields` array puts a labelled, unit-aware control in the inspector. No UI
code is written. The exhibitor submission form renders from the same field-definition
shape.

### 2. One element primitive, used at both scales

There is no separate booth model. A fire exit in the hall shell and a table inside
Booth 214 are the same record:

```js
{ id, kind, shape, layer, parentId, geometry: {…}, props: {…} }
```

- `kind` points at a record in the config registry
- `shape` (`rect` | `poly` | `line` | `marker` | `text`) tells the geometry layer how to read `geometry`
- `parentId` is what makes a thing *booth contents* rather than *hall furniture*
- `props` holds everything else, including custom field answers

So one editor, one renderer, one exporter and one rules engine serve the hall **and**
the booth interiors, **and** the exhibitor portal. Double-click a space to edit inside
it; the catalog, the inspector and the checks all follow the scope.

---

## What it does today

**Drawing** — booth spaces, walls, columns, doors, docks, stairs, fire exits, egress
paths, fire lanes, extinguishers, first aid, dead space (rectangular and freeform),
aisles, named zones, amenities, pipe & drape, electrical distribution, booth contents
(tables, chairs, stools, counters, monitors, shelves, displays), power/water/network/
rigging drops, text, dimension lines and arrows — each drawn as itself (a stool is a
circle with a footring, a door shows its swing, a counter's service edge is heavy),
not a coloured square with a label.

**Editing** — snap to grid, marquee select, multi-select, move, resize (correct on
rotated elements — the pinned corner stays pinned), rotate, vertex editing, align,
distribute, duplicate, layer visibility and locking, full undo/redo. Placement tools
stay armed after each use — drop a whole row without re-clicking the tool; Alt on
release places one and drops back to Select.

**Booth interiors** — double-click a space to edit what the exhibitor is building
inside it, at booth scale, with the hall as faint context.

**Bulk layout** — a coordinate-entry block generator; a **fill-region tool** (drag a
box over traced venue art or empty floor, it lays booths into it on the module); and
two numbering methods — reading-order sweep, or **aisle numbering**, which matches
how a real floor is numbered: the hundreds digit is the aisle, the last two digits
run odd/even down each side, and two rows only share a block when they actually face
each other across an aisle.

**Colour by** anything instead of highlighting booths with a felt pen — booking
status, power ordered, price tier, space type, or submission received — with a live
legend. Replaces the yellow/pink hand-highlighting on a paper plan.

**Rules** — 16 checks, run live, click an issue to zoom to the offenders. Severity,
thresholds and enabled-ness are editable per show in the Safety tab and stored on the
plan as `ruleConfig`. Hall-level rules (fire exits, aisle width, overlap…) don't run
inside booth scope, so an exhibitor is never blocked by something they can't see or
fix.

| Rule | Default |
|---|---|
| Booths must not overlap | error |
| Everything stays inside the hall | error |
| No booths on dead space or obstructions | error |
| Fire exit and egress clearance | error |
| Hall must have fire exits | error, min 2 |
| Booth contents stay inside the footprint | error |
| Minimum aisle width | warning, 10 ft |
| Height limits by space type | warning |
| Power draw within circuit capacity | warning |
| Panel/distro load within capacity (NEC derate) | warning → error |
| Power drop assigned to a real board | warning |
| Voltage drop within limit | warning |
| Booths reach an electrical bus (30 ft module) | warning |
| Rigging points inside allowed zones | warning |
| Required details complete | warning |
| Space numbers unique and present | warning |

**Exports** — PNG, standalone SVG, print/PDF with a title block, a legend drawn from
the *same* symbol code as the plan (never a lookalike), and a space manifest; CSV
booth manifest, electrical schedule, and drape order sheet; printable per-booth work
orders; and a `.json` plan file that round-trips.

**Storage** — `FP.store` is an async adapter with two implementations: `localStorage`
for offline work, and a Supabase-backed one behind the identical interface. Swapping
is `FP.useStore('supabase' | 'local')`; nothing above it changes.

---

## Keyboard

`V` select · `H` pan · `M` measure · `U` fill area with booths · `B` booth ·
`W` wall · `D` dead space · `P` freeform · `X` fire exit · `A` aisle · `T` text

`Ctrl Z` / `Ctrl ⇧ Z` undo/redo · `Ctrl C/X/V` copy/cut/paste · `Ctrl D` duplicate ·
`Ctrl A` select all · `Del` delete · arrows nudge (`⇧` further, `Alt` finer) ·
`⇧` constrain to square/45° while drawing · `Alt` ignore snap while dragging, or
place one and drop to Select on release · `F` fit · `G` grid · `S` snap ·
`L` labels · `Ctrl ]` / `Ctrl [` front/back · `?` all shortcuts

---

## Files

| File | Role |
|---|---|
| `js/config.js` | Every configurable record set — kinds, rules, colour modes, statuses. Start here. |
| `js/geometry.js` | Pure math over the element primitive. No DOM, no state. |
| `js/state.js` | Document model, scope, history, persistence adapter. |
| `js/rules.js` | Evaluators keyed by rule `type`. Records live in config. |
| `js/render.js` | SVG renderer, scope-aware, one rAF-coalesced pass. Also builds print/legend swatches from the live drawing code. |
| `js/interactions.js` | Pointer and keyboard editing. Writes no SVG. |
| `js/ui.js` | Panels and modals. The inspector is generated from field defs. |
| `js/exporters.js` | PNG, SVG, print, CSV, plan file. |
| `js/drape.js` | Pipe & drape generation and the material takeoff (panels, uprights, bases). |
| `js/backend.js` | Supabase client, session, auth (password + magic link). |
| `js/store-supabase.js` | The cloud `FP.store` implementation. |
| `js/admin.js` | Team & access — roles, enforced by RLS and a last-admin DB trigger, not this file. |
| `js/publish.js` | Builds the public document by allow-list, never by hiding fields on the working plan. |
| `js/viewer.js` | Read-only public exhibitor directory (`viewer.html`). |
| `js/portal.js` | Exhibitor portal — magic-link sign-in, own-booth-only, submission (`portal.html`). |
| `js/order.js` | Furniture & graphics ordering inside the portal; placement onto the booth plan. |
| `js/samples.js`, `js/pcma.js` | The two worked-example shows / plan templates. |
| `supabase/migrations/` | Schema, RLS policies, and the last-admin guard trigger. |

---

## Electrical distribution

Topology is by **ID reference, not object links**: a drop stores
`panelId: "D-1"`, never a pointer. That survives a JSON round-trip, maps directly
onto the Postgres model, and lets an exhibitor's submission cite a board they
never touched.

Kinds: `electrical-panel`, `distro-box`, `electrical-run`, `generator`,
`disconnect`. `power-drop` carries voltage, phase, panel, circuit, connector and
show-hours-vs-24-hour (24-hour power is billed differently and the crew must know).

Five rules, sharing one calculation with the Power tab so the schedule can never
disagree with the warnings:

- **panel-load** — sums drops by `panelId`, rolling downstream distros up into the
  panel feeding them (cycle-guarded). Warns past 80% of the main (NEC 210.19
  continuous-load derate), errors past 100%.
- **unassigned-power** — a drop with no panel, or one citing a board that doesn't
  exist, can't be ordered or billed.
- **voltage-drop** — single phase `VD = 2 × 12.9 × I × L ÷ CM`, three phase uses √3.
  `L` is the run's drawn length, so the cable path *is* the calculation input.
- **bus-reach** — buses sit on the 30 ft module (10 ft booth + 10 ft aisle + 10 ft
  booth), generated with `FP.interact.generateBuses()`. A booth that ordered power
  but sits more than half a module from the nearest run can only be fed by crossing
  an aisle — flagged before it becomes a trip hazard on-site.

The **Power** tab is the panel schedule: each board with its circuits, load bar,
derate marker, and flagged overloads, plus bus generation and a reach-check list.
Exports an electrical schedule CSV (drops, board totals, feeder voltage drop) and
printable per-booth work orders.

## Pipe & drape

Replaces the arithmetic in the margin of a paper plan — *"8 BLACK DRAPE = 83"*,
*"147 qty 3' high"* — with a takeoff computed from the geometry that's already on the
plan. `drape` is a line-shape kind carrying height, colour, function (back wall /
side rail / masking / stage) and section width.

`FP.drape.generate()` derives back walls and side rails straight from the booth
layout: back-to-back rows share **one** wall instead of double-ordering it, and side
rails only appear between booths that actually touch. `FP.drape.takeoff()` groups
every run by height + colour — because that's how drape is priced — and computes
panels, uprights and bases **per run**, not pooled (two 15 ft runs on 10 ft crossbars
need 4 sections, not the 3 you'd get by adding the lengths first).

The **Drape** tab shows the generated takeoff and exports a drape order sheet CSV;
the print pack includes it as a section.

## Reference images and scale calibration

Import a venue drawing, then **calibrate** it: drag across something whose real
length you know and enter that length. The image is rescaled about the point
where the drag started, so what you trace on top comes out at true dimensions.

```
scale = realLength / drawnLength
w *= scale;  h *= scale
x = px - (px - x) * scale     // calibration start point stays fixed
```

Calibrating locks the image so tracing can't nudge it. Underlays are scope-aware:
the hall keeps one on the plan, and a booth keeps its own on the space — so an
exhibitor can upload their booth CAD without touching the venue drawing. Once
calibrated, drag the **fill-region** tool over a traced block to lay real booths
onto it on the module — the payoff of importing the drawing in the first place.

## Cloud backend — Supabase

`js/backend.js` and `js/store-supabase.js` swap `FP.store`'s localStorage
implementation for a Postgres one behind the identical async interface — nothing
above the adapter changed. Auth supports password and magic-link sign-in.

**Row-level security does the real work.** An exhibitor's query for `element` rows
returns only their own booth and its contents — enforced in Postgres via RLS, not by
hiding rows in the UI. Verified directly: signed in as a real exhibitor, the client
receives 2 elements (their booth and its contents) out of 92 on the hall.

**Team & access** (`js/admin.js`) lets an admin change roles — exhibitor, crew, sales,
planner, admin — but enforces nothing itself. Every rule it displays is enforced
underneath it:

- who may read the team list → RLS
- who may change a role → RLS
- you cannot remove the last active admin → a Postgres trigger
  (`supabase/migrations/0003_guard_last_admin.sql`), so hiding a button never had to
  be the only thing standing between the project and a lockout.

**Plan freeze** is enforced the same way, at both layers: past the freeze date, the
portal's UI disables editing, and a direct write to `submission` is refused by RLS
even if the UI is bypassed entirely — verified by attempting the write directly.

## Exhibitor portal

`portal.html` / `js/portal.js` — an exhibitor signs in with a magic link (no
password), sees a real drawing of **only their own booth**, rendered by the same
`render.js` the hall editor uses, and checked by the same rules engine narrowed to
their space. Hall-level findings (fire exits, aisles, neighbouring booths) don't
leak into their view, because RLS never sent them that data.

**Ordering** (`js/order.js`): furniture and graphics from a per-show catalog. Every
placeable item carries `spec.elementKind` and `spec.footprint` — ordering a Standard
Counter drops a correctly-scaled counter into the booth drawing. This makes
over-ordering visible before load-in: furniture that won't fit spills past the
footprint and the existing inside-footprint rule blocks submission. Only elements the
order placed are ever replaced on a re-save (`props.fromOrder`); anything placed by
hand survives.

**Submission** is versioned — a draft edits in place, a submission always cuts a new
version — so "what changed since Friday" stays answerable, and is blocked (both by
the UI and by RLS) past the plan's freeze date.

## Public exhibitor viewer

`viewer.html` reuses `config.js`, `geometry.js` and `render.js` unchanged — there
is no second drawing path to keep in sync. Searchable directory, booth detail
cards, deep links (`viewer.html?booth=154`), and read-only booth interiors —
"View interior" only appears when a booth actually has one. No tool rail, no
inspector; `interactions.js` and `ui.js` are never loaded.

**The working plan and the public plan are different documents.** `publish.js`
builds the public one by copying across an explicit allow-list — it does not
serve the working plan with fields hidden. Withheld: contact emails, internal
notes, booking status (held / unsold / changes needed), every electrical and
utility element, connector types and 24-hour flags, tier, deadlines and freeze
dates. Verified directly against the published payload — none of `contact`,
`notes`, `status`, `connector`, or `hours` appear anywhere in it, not just hidden
by CSS.

Assigned-vs-open is shown, because naming the company already reveals it. The
internal workflow state collapses away entirely — not even as a colour.

## What's not built yet

- **Ops dashboard** — a chase-list view over submission status, deadlines and
  freeze/approval workflow. Freeze itself is enforced (see above); the dashboard
  to manage it isn't built.
- **Reminders** — no scheduled email/notification system for T-14 / T-7 / T-2 /
  overdue submissions.
- **File upload** in the exhibitor portal — the submission form and furniture
  ordering are complete; attaching artwork or CAD files is not.
- **Crew PWA** — an offline-capable, read-only mobile view for load-in day. The
  print packs (work orders, electrical schedule, drape order sheet) exist; the
  installable offline app doesn't.
- **Config builder GUIs** — custom fields, statuses and rules are all data in
  `config.js` and can be edited per-show via `FP.config.load()` or `plan.ruleConfig`,
  but there's no admin screen to do that without touching the file directly.

## License

All rights reserved — see [`LICENSE`](LICENSE). This is a real operational tool for
Source One Events, not an open-source project.
