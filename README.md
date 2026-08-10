# Floorplan Studio — Source One Events

A web-based floor plan editor for trade shows. Draw the hall shell, mark dead space
and fire exits, lay out and number booth spaces, and let a configurable rules engine
catch problems before anyone is standing on the floor.

**Phase 1 of the platform: the hall editor, the element model, and the rules engine.**

No build step. Plain HTML, CSS and JavaScript — open it with any static server and it runs.

```bash
python3 -m http.server 4180 --directory "$(pwd)"
```

Then open <http://localhost:4180>. It deploys to Vercel as a static directory, unchanged.

---

## The two structural decisions

Everything else follows from these.

### 1. Configuration is data, not code

Element types, layers, statuses, space types, form fields, validation rules and booth
presets are all **records** in [`js/config.js`](js/config.js). A show with unusual
requirements is a config change, not a dev ticket.

`FP.config.load(records)` replaces or merges any of those record sets at runtime, so
when they move into Postgres in phase 2 nothing above them changes.

Concretely: adding `{ key: 'riser', label: 'Riser height', type: 'number', unit: 'len' }`
to a kind's `fields` array puts a labelled, unit-aware control in the inspector. No UI
code is written. The exhibitor submission form in phase 3 renders from the same
field-definition shape.

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
the booth interiors. Double-click a space to edit inside it; the catalog, the
inspector and the checks all follow the scope.

---

## What it does today

**Drawing** — booth spaces, walls, columns, doors, docks, stairs, fire exits, egress
paths, fire lanes, extinguishers, first aid, dead space (rectangular and freeform),
aisles, named zones, amenities, booth contents, power/water/network/rigging drops,
text, dimension lines and arrows.

**Editing** — snap to grid, marquee select, multi-select, move, resize (correct on
rotated elements — the pinned corner stays pinned), rotate, vertex editing, align,
distribute, duplicate, layer visibility and locking, full undo/redo.

**Booth interiors** — double-click a space to edit what the exhibitor is building
inside it, at booth scale, with the hall as faint context.

**Numbering** — auto-number by position (row sweep, serpentine, or columns) and a
booth-block generator that lays out a grid with aisles and numbers as it goes.

**Rules** — checked live, click an issue to zoom to the offenders:

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
| Rigging points inside allowed zones | warning |
| Required details complete | warning |
| Space numbers unique and present | warning |

Severity, thresholds and enabled-ness are editable per show in the Safety tab and
stored on the plan as `ruleConfig`.

**Exports** — PNG, standalone SVG, print/PDF with a title block and space manifest,
CSV manifest, and a `.json` plan file that round-trips.

**Storage** — autosaves to `localStorage` behind an async adapter (`FP.store`) whose
surface is already the one Supabase will implement.

---

## Keyboard

`V` select · `B` booth · `W` wall · `D` dead space · `P` freeform · `X` fire exit ·
`A` aisle · `T` text · `M` measure · `H` pan

`Ctrl Z` / `Ctrl ⇧ Z` undo/redo · `Ctrl D` duplicate · `Del` delete · arrows nudge ·
`⇧` constrain to square/45° · `Alt` ignore snap · `F` fit · `G` grid · `S` snap ·
`L` labels · `?` all shortcuts

---

## Files

| File | Role |
|---|---|
| `js/config.js` | Every configurable record set. Start here. |
| `js/geometry.js` | Pure math over the element primitive. No DOM, no state. |
| `js/state.js` | Document model, scope, history, persistence adapter. |
| `js/rules.js` | Evaluators keyed by rule `type`. Records live in config. |
| `js/render.js` | SVG renderer, scope-aware, one rAF-coalesced pass. |
| `js/interactions.js` | Pointer and keyboard editing. Writes no SVG. |
| `js/ui.js` | Panels and modals. The inspector is generated from field defs. |
| `js/exporters.js` | PNG, SVG, print, CSV, plan file. |
| `js/samples.js` | The worked example show. |

---

## Electrical distribution

Topology is by **ID reference, not object links**: a drop stores
`panelId: "D-1"`, never a pointer. That survives a JSON round-trip, maps directly
onto the Postgres model, and lets an exhibitor's submission cite a board they
never touched.

Kinds: `electrical-panel`, `distro-box`, `electrical-run`, `generator`,
`disconnect`. `power-drop` carries voltage, phase, panel, circuit, connector and
show-hours-vs-24-hour (24-hour power is billed differently and the crew must know).

Three rules, sharing one calculation with the Power tab so the schedule can never
disagree with the warnings:

- **panel-load** — sums drops by `panelId`, rolling downstream distros up into the
  panel feeding them (cycle-guarded). Warns past 80% of the main (NEC 210.19
  continuous-load derate), errors past 100%.
- **unassigned-power** — a drop with no panel, or one citing a board that doesn't
  exist, can't be ordered or billed.
- **voltage-drop** — single phase `VD = 2 × 12.9 × I × L ÷ CM`, three phase uses √3.
  `L` is the run's drawn length, so the cable path *is* the calculation input.

The **Power** tab is the panel schedule: each board with its circuits, load bar,
derate marker, and flagged overloads. Exports an electrical schedule CSV (drops,
board totals, feeder voltage drop) and printable per-booth work orders.

In the sample show: D-3 sits at 105 A on a 100 A distro (error), D-2 at 90%
(warning), and feeder F-3 drops 4.48% over 151 ft on 4 AWG — change it to 2 AWG
and the warning clears.

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
exhibitor can upload their booth CAD without touching the venue drawing.

## Public exhibitor viewer

`viewer.html` reuses `config.js`, `geometry.js` and `render.js` unchanged — there
is no second drawing path to keep in sync. Searchable directory, booth detail
cards, deep links (`viewer.html?booth=154`), and read-only booth interiors. No
tool rail, no inspector; `interactions.js` and `ui.js` are never loaded.

**The working plan and the public plan are different documents.** `publish.js`
builds the public one by copying across an explicit allow-list — it does not
serve the working plan with fields hidden. Withheld: contact emails, internal
notes, booking status (held / unsold / changes needed), every electrical and
utility element, connector types and 24-hour flags, tier, deadlines and freeze
dates. Published: booth outlines, numbers, sizes, types, company names, the hall
shell, and submitted interiors.

Assigned-vs-open is shown, because naming the company already reveals it. The
internal workflow state collapses away entirely — not even as a colour.

## Roadmap

1. **Hall editor, element model, rules engine** — *this*
2. Supabase schema, auth, row-level security, shows/spaces/exhibitors, server-side plans
3. Exhibitor portal — magic links, submission form, file upload, statuses
4. Ops dashboard, deadlines, reminders, freeze and approval
5. Crew PWA (offline — convention centre wifi is exactly when it must work), change log, print packs
6. Config builders — custom fields, statuses, rule editor, venue library, roles

Phase 3 is where the late-submission problem actually starts getting solved.
