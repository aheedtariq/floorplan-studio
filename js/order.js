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

    msg(`Order saved — ${O.count()} item${O.count() === 1 ? '' : 's'}.`);
    FP.toast?.('Order saved');
  };
})(window);
