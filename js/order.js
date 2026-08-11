/* ============================================================
   order.js — the exhibitor's order, inside the portal.

   SourceOne's "Build an Exhibit" configurator already solves product
   selection beautifully. What it cannot do is remember: it states plainly
   that the layout resets on reload and that uploaded artwork is never
   stored, so the exhibitor exports a PDF and emails it, and somebody
   re-keys it by hand.

   This is the persistence half. Same products, attached to a real booth
   at a real show, saved against the exhibitor's record and therefore
   printable onto the work order the crew already carries.

   Prices come from the catalog and may be null, which renders as "quote
   on request". A missing price is never shown as free.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const O = (FP.order = {});
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Display order and human labels for the catalog's category column. */
  const CATEGORIES = [
    ['booth-package', 'Booth packages', 'BeMatrix rental exhibits. Pick one, or bring your own build.'],
    ['graphics',      'Graphics',       'Supply artwork at the stated size and it goes straight to print.'],
    ['counters',      'Counters',       null],
    ['furniture',     'Furniture',      null],
    ['accessories',   'Accessories',    null],
    ['flooring',      'Flooring',       null],
  ];

  let items = [];        // catalog_item rows
  let lines = {};        // catalog_item_id -> { qty, id, options }

  O.itemsById = () => Object.fromEntries(items.map((i) => [i.id, i]));

  /* ---------------- loading ---------------- */

  O.load = async (showId, exhibitorId) => {
    const sb = FP.auth.client();
    if (!sb) return;

    const [{ data: cat }, { data: ord }] = await Promise.all([
      /* global catalog plus anything scoped to this show */
      sb.from('catalog_item').select('*')
        .or(`show_id.is.null,show_id.eq.${showId}`)
        .eq('active', true)
        .order('category').order('sort'),
      sb.from('order_line').select('*').eq('exhibitor_id', exhibitorId),
    ]);

    items = cat || [];
    lines = {};
    (ord || []).forEach((l) => {
      lines[l.catalog_item_id] = { id: l.id, qty: l.qty, options: l.options || {} };
    });
  };

  O.count = () => Object.values(lines).reduce((n, l) => n + l.qty, 0);

  /** Total of the priced lines, plus how many are awaiting a quote. */
  O.total = () => {
    const byId = O.itemsById();
    let sum = 0, unpriced = 0;
    for (const [itemId, line] of Object.entries(lines)) {
      const price = byId[itemId]?.price;
      if (price === null || price === undefined) unpriced += line.qty;
      else sum += Number(price) * line.qty;
    }
    return { sum, unpriced };
  };

  O.lines = () => lines;

  /* ---------------- rendering ---------------- */

  const money = (v) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  function specNote(item) {
    const s = item.spec || {};
    if (s.widthPx && s.heightPx) {
      return `${s.widthPx} × ${s.heightPx} px · ${(s.formats || []).join(' or ')}` +
             (s.maxFileMb ? ` · max ${s.maxFileMb} MB` : '');
    }
    if (Array.isArray(s.sizes)) return s.sizes.join(' / ');
    if (Array.isArray(s.footprint)) return `${s.footprint[0]} × ${s.footprint[1]} ft footprint`;
    return '';
  }

  function itemRow(item, locked) {
    const line = lines[item.id];
    const qty = line?.qty || 0;
    const note = specNote(item);
    const priceLabel = item.price === null || item.price === undefined
      ? '<span class="o-quote">Quote on request</span>'
      : `<b>${money(item.price)}</b><span class="o-unit"> / ${esc(item.unit)}</span>`;

    return `<div class="o-item${qty ? ' picked' : ''}" data-item="${esc(item.id)}">
      <div class="o-info">
        <b>${esc(item.name)}${item.sku ? ` <span class="o-sku">${esc(item.sku)}</span>` : ''}</b>
        ${item.description ? `<span>${esc(item.description)}</span>` : ''}
        ${note ? `<span class="o-spec">${esc(note)}</span>` : ''}
      </div>
      <div class="o-price">${priceLabel}</div>
      <div class="o-qty">
        <button class="o-step" data-dec="${esc(item.id)}" ${locked || !qty ? 'disabled' : ''}
          aria-label="Remove one">−</button>
        <span class="o-n">${qty}</span>
        <button class="o-step" data-inc="${esc(item.id)}" ${locked ? 'disabled' : ''}
          aria-label="Add one">+</button>
      </div>
    </div>`;
  }

  O.html = (locked) => {
    if (!items.length) {
      return `<div class="p-card"><h2>Order</h2>
        <p class="sub">No catalog is published for this show yet.</p></div>`;
    }

    const { sum, unpriced } = O.total();
    const n = O.count();

    const sections = CATEGORIES.map(([cat, label, blurb]) => {
      const list = items.filter((i) => i.category === cat);
      if (!list.length) return '';
      return `<section class="o-sect">
        <h3>${esc(label)}</h3>
        ${blurb ? `<p class="o-blurb">${esc(blurb)}</p>` : ''}
        ${list.map((i) => itemRow(i, locked)).join('')}
      </section>`;
    }).join('');

    return `<div class="p-card">
      <h2>Order furniture &amp; graphics</h2>
      <p class="sub">The same rentals you would pick in Build an Exhibit — but saved
        against your booth, so nothing has to be emailed and re-keyed.</p>
      ${sections}
      <div class="o-total">
        <div>
          <b>${n} item${n === 1 ? '' : 's'}</b>
          ${unpriced ? `<span> · ${unpriced} awaiting a quote</span>` : ''}
        </div>
        <div class="o-sum">${sum > 0 ? money(sum) : '—'}</div>
      </div>
      ${locked ? '' : '<button class="mini" id="oSave" style="width:100%;margin-top:10px">Save order</button>'}
      <div id="oMsg" class="helptext" style="margin-top:8px"></div>
    </div>`;
  };

  /* ---------------- interaction ---------------- */

  O.wire = (locked, onChange) => {
    if (locked) return;

    const bump = (itemId, delta) => {
      const cur = lines[itemId]?.qty || 0;
      const next = Math.max(0, cur + delta);
      if (next === 0) delete lines[itemId];
      else lines[itemId] = { ...(lines[itemId] || {}), qty: next };
      onChange?.();
    };

    document.querySelectorAll('[data-inc]').forEach((b) =>
      b.addEventListener('click', () => bump(b.dataset.inc, +1)));
    document.querySelectorAll('[data-dec]').forEach((b) =>
      b.addEventListener('click', () => bump(b.dataset.dec, -1)));

    document.getElementById('oSave')?.addEventListener('click', () => O.save());
  };

  /* ============================================================
     Ordering something puts it on the floor plan.

     Every placeable catalog item carries spec.elementKind and
     spec.footprint, so a Standard Counter becomes a 4 × 2 ft counter
     inside the exhibitor's own footprint, at true scale.

     Placement is a shelf pack: left to right along the back of the
     booth, wrapping to a new row when the width runs out. It is not
     trying to be a designer — the exhibitor can drag things afterwards.
     What it is trying to do is make ORDERING TOO MUCH VISIBLE. If the
     furniture will not fit, items spill past the footprint and the
     existing inside-footprint rule reports it, before load-in rather
     than on the floor.

     Only elements this routine created are ever removed, marked with
     props.fromOrder. Anything the exhibitor placed by hand survives.
     ============================================================ */

  const MARGIN = 0.75;   // ft of clear space inside the booth edge
  const GAP = 0.5;       // ft between adjacent items

  /** Build the element rows for the current order inside a space. */
  function layout(space, byId) {
    const g = space.geometry;
    const usableW = g.w - MARGIN * 2;
    const rows = [];

    /* Largest first: big counters get the clean runs, stools fill in. */
    const queue = [];
    for (const [itemId, line] of Object.entries(lines)) {
      const item = byId[itemId];
      const kind = item?.spec?.elementKind;
      const fp = item?.spec?.footprint;
      if (!kind || !Array.isArray(fp)) continue;      // not a floor object
      for (let i = 0; i < line.qty; i++) {
        queue.push({
          item, kind,
          w: item.spec.fullWidth ? usableW : Number(fp[0]),
          h: Number(fp[1]),
        });
      }
    }
    /* Full-width pieces (the back wall graphic) pin to the back edge. */
    queue.sort((a, b) => (b.item.spec.fullWidth ? 1 : 0) - (a.item.spec.fullWidth ? 1 : 0)
      || (b.w * b.h) - (a.w * a.h));

    let cx = g.x + MARGIN;
    let cy = g.y + MARGIN;
    let rowH = 0;

    for (const piece of queue) {
      /* Wrap when this piece would run past the right-hand edge. */
      if (cx > g.x + MARGIN && cx + piece.w > g.x + g.w - MARGIN) {
        cx = g.x + MARGIN;
        cy += rowH + GAP;
        rowH = 0;
      }
      rows.push({
        kind: piece.kind,
        geometry: { x: cx, y: cy, w: piece.w, h: piece.h, rot: 0 },
        props: {
          label: piece.item.name,
          fromOrder: piece.item.id,
          ...(piece.item.spec.height ? { height: piece.item.spec.height } : {}),
        },
      });
      cx += piece.w + GAP;
      rowH = Math.max(rowH, piece.h);
    }
    return rows;
  }

  /**
   * Sync the booth contents to the order. Returns how many were placed,
   * or null when there is nothing to place into.
   */
  O.placeInBooth = async () => {
    const ctx = FP.portalContext?.();
    const sb = FP.auth.client();
    if (!sb || !ctx?.space) return null;

    const space = FP.get ? ctx.plan.elements.find((e) => e.id === ctx.space.id) : null;
    if (!space) return null;

    const rows = layout(space, O.itemsById());

    /* Clear only what a previous order placed. */
    const { error: delErr } = await sb.from('element')
      .delete()
      .eq('parent_id', space.id)
      .not('props->>fromOrder', 'is', null);
    if (delErr) { console.warn(delErr.message); return null; }

    if (rows.length) {
      const payload = rows.map((r, i) => ({
        show_id: ctx.show.id,
        parent_id: space.id,
        kind: r.kind,
        shape: FP.config.kind(r.kind).shape,
        layer: FP.config.kind(r.kind).layer,
        geometry: r.geometry,
        props: r.props,
        z: 100 + i,
      }));
      const { error } = await sb.from('element').insert(payload);
      if (error) { console.warn(error.message); return null; }
    }
    return rows.length;
  };

  /* ---------------- persistence ---------------- */

  O.save = async (showId, exhibitorId) => {
    const sb = FP.auth.client();
    const ctx = FP.portalContext?.();
    const sid = showId || ctx?.show?.id;
    const eid = exhibitorId || ctx?.ex?.id;
    if (!sb || !sid || !eid) return;

    const msg = (t, bad) => {
      const m = document.getElementById('oMsg');
      if (!m) return;
      m.textContent = t;
      m.style.color = bad ? 'var(--err)' : 'var(--ok)';
    };
    msg('Saving…');

    const byId = O.itemsById();
    const rows = Object.entries(lines).map(([itemId, l]) => ({
      show_id: sid,
      exhibitor_id: eid,
      catalog_item_id: itemId,
      qty: l.qty,
      options: l.options || {},
      /* snapshot the price so a later repricing cannot change what an
         exhibitor already agreed to */
      price_each: byId[itemId]?.price ?? null,
    }));

    /* Replace the whole order: simpler than diffing, and an order is a
       handful of rows, not a floor plan. */
    const { error: delErr } = await sb.from('order_line')
      .delete().eq('exhibitor_id', eid);
    if (delErr) return msg(delErr.message, true);

    if (rows.length) {
      const { error } = await sb.from('order_line').insert(rows);
      if (error) return msg(error.message, true);
    }

    /* Ordering something puts it on the plan, so the exhibitor sees
       immediately whether it fits. */
    const placed = await O.placeInBooth();
    msg(`Order saved — ${O.count()} item${O.count() === 1 ? '' : 's'}` +
        (placed ? `, ${placed} placed in your booth.` : '.'));
    FP.toast?.('Order saved');
    await FP.portalRefresh?.();
  };
})(window);
