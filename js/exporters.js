/* ============================================================
   exporters.js — everything that leaves the app.

   The SVG export re-uses the live renderer rather than a second drawing
   path: chrome is cleared, one synchronous paint runs, and the result is
   wrapped with concrete colour variables so the file stands alone
   outside the app's stylesheet.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;
  const S = FP.state;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Concrete values for the CSS variables the renderer emits, so an
     exported file looks right with no stylesheet attached. */
  const EXPORT_VARS = `
    --paper:#ffffff; --canvas-bg:#ffffff;
    --ink:#131a26; --ink-2:#5a6779; --ink-3:#8b96a8;
    --tx:#131a26; --tx-2:#5a6779; --tx-3:#8b96a8;
    --line:#dde3ec; --line-2:#c6cfdd;
    --accent:#4f7cff; --grid-minor:rgba(20,30,50,.07); --grid-major:rgba(20,30,50,.14);
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  `.replace(/\s+/g, ' ').trim();

  const stamp = () => new Date().toISOString().slice(0, 10);
  const safeName = () =>
    (FP.plan.name || 'floorplan').replace(/[^\w\d\-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

  /* ---------------- download helpers ---------------- */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ============================================================
     SVG
     ============================================================ */

  /** Paint the plan with no selection chrome and return the markup. */
  function paintClean() {
    const svg = document.getElementById('canvas');
    const keep = {
      selection: S.selection,
      draft: S.draft,
      scope: S.scope,
      view: { ...S.view },
      labels: S.showLabels,
      grid: S.showGrid,
    };
    S.selection = [];
    S.draft = null;
    S.scope = { type: 'hall', spaceId: null };
    S.showLabels = true;
    S.showGrid = false;
    FP.render.paintNow();
    const markup = svg.innerHTML;
    Object.assign(S, {
      selection: keep.selection, draft: keep.draft, scope: keep.scope,
      showLabels: keep.labels, showGrid: keep.grid,
    });
    S.view = keep.view;
    FP.render.paintNow();
    return markup;
  }

  function planSvg({ titleBlock = false } = {}) {
    const p = FP.plan;
    const body = paintClean();
    const m = Math.max(p.width, p.height) * 0.04 + 4;
    const blockH = titleBlock ? Math.max(p.height * 0.16, 26) : 0;
    const vbW = p.width + m * 2;
    const vbH = p.height + m * 2 + blockH;

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="${-m} ${-m} ${vbW} ${vbH}" width="${Math.round(vbW * 6)}" height="${Math.round(vbH * 6)}">
  <style>svg{${EXPORT_VARS}} text{font-family:var(--font)}</style>
  <rect x="${-m}" y="${-m}" width="${vbW}" height="${vbH}" fill="#ffffff"/>
  ${body}
  ${titleBlock ? titleBlockSvg(p, m, p.height + m * 0.6, vbW, blockH) : ''}
</svg>`;
  }

  function titleBlockSvg(p, m, y, vbW, h) {
    const st = FP.stats();
    const fs = h * 0.17;
    const rows = [
      ['Venue', p.venue || '—'],
      ['Hall', p.hall || '—'],
      ['Show opens', p.dates.open || '—'],
      ['Spaces', `${st.total}`],
      ['Sellable', G.fmtArea(st.sellable, p.unit)],
      ['Hall size', G.fmtDims(p.width, p.height, p.unit)],
    ];
    const colW = (vbW - m * 0.5) / 3;
    return `<g>
      <rect x="${-m + m * 0.25}" y="${y}" width="${vbW - m * 0.5}" height="${h}"
        fill="none" stroke="#131a26" stroke-width="0.4"/>
      <text x="${-m + m * 0.75}" y="${y + fs * 1.5}" font-size="${fs * 1.5}" font-weight="700"
        fill="#131a26">${esc(p.name)}</text>
      <text x="${-m + m * 0.75}" y="${y + fs * 2.7}" font-size="${fs * 0.8}" fill="#5a6779"
        >Source One Events · issued ${stamp()}</text>
      ${rows.map((r, i) => {
        const col = Math.floor(i / 2), row = i % 2;
        const x = -m + m * 0.75 + colW * (col + 1);
        const ty = y + fs * (1.5 + row * 1.3);
        return `<text x="${x}" y="${ty}" font-size="${fs * 0.78}" fill="#8b96a8">${esc(r[0])}</text>
          <text x="${x + colW * 0.45}" y="${ty}" font-size="${fs * 0.78}" font-weight="600"
            fill="#131a26">${esc(r[1])}</text>`;
      }).join('')}
    </g>`;
  }

  function exportSvg() {
    download(new Blob([planSvg({ titleBlock: true })], { type: 'image/svg+xml' }),
      `${safeName()}-${stamp()}.svg`);
    FP.toast('SVG exported');
  }

  /* ============================================================
     PNG
     ============================================================ */
  function exportPng(scale = 2) {
    const markup = planSvg({ titleBlock: true });
    const img = new Image();
    const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return FP.toast('PNG export failed', true);
        download(b, `${safeName()}-${stamp()}.png`);
        FP.toast('PNG exported');
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      FP.toast('PNG export failed', true);
    };
    img.src = url;
  }

  /* ============================================================
     Print / PDF
     ============================================================ */
  function printPlan() {
    const p = FP.plan;
    const st = FP.stats();
    const issues = S.issues || [];
    const counts = FP.rules.counts(issues);
    const spaces = FP.spaces().slice().sort(byNumber);

    const legendKinds = [...new Set(p.elements.map((e) => e.kind))]
      .map((id) => C.kind(id))
      .filter((k) => k && k.cat !== 'annotate');

    const win = window.open('', '_blank');
    if (!win) return FP.toast('Allow pop-ups to print', true);

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(p.name)} — floor plan</title>
<style>
  @page { size: landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #131a26; margin: 0; padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #5a6779; font-size: 12px; margin-bottom: 14px; }
  .meta { display: flex; gap: 26px; flex-wrap: wrap; margin-bottom: 14px;
          border-top: 1px solid #dde3ec; border-bottom: 1px solid #dde3ec; padding: 9px 0; }
  .meta div span { display: block; font-size: 10px; color: #8b96a8; text-transform: uppercase;
                   letter-spacing: .06em; }
  .meta div b { font-size: 13px; }
  .plan { border: 1px solid #dde3ec; padding: 8px; margin-bottom: 18px; }
  .plan svg { width: 100%; height: auto; }
  .legend-h { font-size: 12px; margin: 0 0 8px; }
  /* the legend carries real drawings, so it is laid out as a grid rather
     than a wrapped run of chips — symbols need to line up to be compared */
  .legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 7px 16px; margin-bottom: 20px; font-size: 11px;
            border: 1px solid #dde3ec; border-radius: 4px; padding: 11px 13px; }
  .legend .lg { display: flex; align-items: center; gap: 8px; break-inside: avoid; }
  .legend .lg svg { flex: 0 0 auto; }
  .legend .lg em { font-style: normal; color: #131a26; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; border-bottom: 1.5px solid #131a26; padding: 5px 6px; font-size: 10px;
       text-transform: uppercase; letter-spacing: .05em; color: #5a6779; }
  td { border-bottom: 1px solid #eef1f7; padding: 5px 6px; }
  td.num { font-family: ui-monospace, Menlo, monospace; }
  h2 { font-size: 13px; margin: 22px 0 8px; }
  .issue { font-size: 11px; padding: 4px 0; border-bottom: 1px solid #eef1f7; }
  .issue b { color: #b91c1c; }
  .issue.warning b { color: #b45309; }
  @media print { .pagebreak { page-break-before: always; } }
</style></head><body>
<h1>${esc(p.name)}</h1>
<div class="sub">Source One Events · ${esc(p.venue || 'Venue TBC')}${p.hall ? ` · ${esc(p.hall)}` : ''} · issued ${stamp()}</div>
<div class="meta">
  <div><span>Hall</span><b>${esc(G.fmtDims(p.width, p.height, p.unit))}</b></div>
  <div><span>Spaces</span><b>${st.total}</b></div>
  <div><span>Complete</span><b>${st.complete}</b></div>
  <div><span>Outstanding</span><b>${st.outstanding}</b></div>
  <div><span>Sellable area</span><b>${esc(G.fmtArea(st.sellable, p.unit))}</b></div>
  <div><span>Utilisation</span><b>${Math.round(st.utilization * 100)}%</b></div>
  <div><span>Load-in</span><b>${esc(p.dates.loadIn || '—')}</b></div>
  <div><span>Opens</span><b>${esc(p.dates.open || '—')}</b></div>
</div>
<div class="plan">${planSvg()}</div>
<h2 class="legend-h">Legend</h2>
<div class="legend">${legendKinds.map((k) =>
  `<span class="lg">${FP.render.symbolSwatch(k.id, 18)}<em>${esc(k.name)}</em></span>`).join('')}</div>

<div class="pagebreak"></div>
<h2>Space manifest</h2>
<table><thead><tr>
  <th>No.</th><th>Exhibitor</th><th>Status</th><th>Type</th><th>Size</th>
  <th>Area</th><th>Position</th><th>Items</th>
</tr></thead><tbody>
${spaces.map((s) => {
  const q = s.geometry;
  const kids = FP.childrenOf(s.id).length;
  return `<tr>
    <td class="num">${esc(s.props.number || '—')}</td>
    <td>${esc(s.props.exhibitor || '—')}</td>
    <td>${esc(C.status(s.props.status).name)}</td>
    <td>${esc(C.spaceType(s.props.spaceType).name)}</td>
    <td class="num">${esc(G.fmtDims(q.w, q.h, p.unit))}</td>
    <td class="num">${esc(G.fmtArea(G.area(s), p.unit))}</td>
    <td class="num">${G.round(q.x, 1)}, ${G.round(q.y, 1)}</td>
    <td class="num">${kids || '—'}</td>
  </tr>`;
}).join('')}
</tbody></table>

${issues.length ? `<h2>Outstanding checks — ${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}</h2>
${issues.map((i) => `<div class="issue ${i.severity}"><b>${esc(i.message)}</b> — ${esc(i.detail)}</div>`).join('')}`
: '<h2>Checks</h2><div class="issue">All active rules pass.</div>'}
</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  }

  const byNumber = (a, b) =>
    String(a.props.number || '').localeCompare(String(b.props.number || ''), undefined, { numeric: true });

  /* ============================================================
     CSV manifest
     ============================================================ */
  function exportCsv() {
    const p = FP.plan;
    const rows = [[
      'Space', 'Exhibitor', 'Status', 'Type', 'Tier',
      `Width (${p.unit})`, `Depth (${p.unit})`, `Area (${p.unit}²)`,
      `X (${p.unit})`, `Y (${p.unit})`, 'Rotation',
      'Items placed', 'Power (A)', 'Notes',
    ]];

    FP.spaces().slice().sort(byNumber).forEach((s) => {
      const q = s.geometry;
      const kids = FP.childrenOf(s.id);
      const amps = kids.reduce((sum, k) => sum + (Number(k.props.amps) || 0), 0);
      rows.push([
        s.props.number || '',
        s.props.exhibitor || '',
        C.status(s.props.status).name,
        C.spaceType(s.props.spaceType).name,
        s.props.tier || '',
        G.round(q.w, 2), G.round(q.h, 2), G.round(G.area(s), 1),
        G.round(q.x, 2), G.round(q.y, 2), G.round(q.rot || 0, 1),
        kids.length, amps || '',
        (s.props.notes || '').replace(/\s+/g, ' '),
      ]);
    });

    const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
    download(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }),
      `${safeName()}-manifest-${stamp()}.csv`);
    FP.toast(`Exported ${rows.length - 1} spaces`);
  }

  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /* ============================================================
     Electrical schedule

     One row per drop — what the electrical contractor prices and what
     the crew pulls on load-in day.
     ============================================================ */
  function exportElectrical() {
    const p = FP.plan;
    const E = FP.rules.electrical;
    const ctx = { plan: p, cfg: C, all: p.elements, unit: p.unit };
    const connOptions = C.kind('power-drop').fields.find((f) => f.key === 'connector')?.options || [];
    const connName = (v) => (connOptions.find(([id]) => id === v) || [null, v || ''])[1];

    const rows = [[
      'Circuit', 'Booth', 'Exhibitor', 'Panel', 'Amps', 'Volts', 'Phase',
      'Connector', 'Hours', `X (${p.unit})`, `Y (${p.unit})`, 'Label',
    ]];

    E.dropsOf(ctx)
      .slice()
      .sort((a, b) => String(a.props.circuitId || '').localeCompare(
        String(b.props.circuitId || ''), undefined, { numeric: true }))
      .forEach((d) => {
        const owner = d.parentId ? FP.get(d.parentId) : null;
        rows.push([
          d.props.circuitId || '',
          owner ? owner.props.number || '' : 'HALL',
          owner ? owner.props.exhibitor || '' : '',
          d.props.panelId || 'UNASSIGNED',
          Number(d.props.amps) || 0,
          d.props.voltage || '',
          d.props.phase === '3' ? '3' : '1',
          connName(d.props.connector),
          d.props.hours === '24hr' ? '24 HOUR' : 'Show hours',
          G.round(d.geometry.x, 2), G.round(d.geometry.y, 2),
          d.props.label || '',
        ]);
      });

    /* Board totals go at the bottom so the sheet prices and checks out. */
    rows.push([]);
    rows.push(['Board', 'Type', 'Volts', 'Main (A)', 'Connected (A)', '% of main', 'Circuits']);
    Object.entries(E.loadByBoard(ctx)).forEach(([id, node]) => {
      const cap = Number(node.board.props.mainAmps) || 0;
      rows.push([
        id, C.kind(node.board.kind).name, node.board.props.voltage || '',
        cap || '', Math.round(node.total),
        cap ? `${Math.round((node.total / cap) * 100)}%` : '',
        node.drops.length,
      ]);
    });

    rows.push([]);
    rows.push(['Feeder', 'Gauge (AWG)', `Length (${p.unit})`, 'Amps', 'Volts', 'Volt drop', '% drop', 'Routing']);
    p.elements.filter((e) => C.flag(e.kind, 'cableRun')).forEach((r) => {
      const vd = E.voltageDrop(r);
      rows.push([
        r.props.circuitId || '', r.props.gauge || '',
        G.round(G.length(r), 1), r.props.amps || '', r.props.voltage || '',
        vd ? G.round(vd.volts, 2) : '', vd ? `${vd.percent.toFixed(2)}%` : '',
        r.props.method || '',
      ]);
    });

    const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
    download(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }),
      `${safeName()}-electrical-${stamp()}.csv`);
    FP.toast('Electrical schedule exported');
  }

  /* ============================================================
     Per-booth work orders

     One card per contracted booth: what the crew hands to the floor
     team. Printed at four to a page.
     ============================================================ */
  function exportWorkOrders() {
    const p = FP.plan;
    const connOptions = C.kind('power-drop').fields.find((f) => f.key === 'connector')?.options || [];
    const connName = (v) => (connOptions.find(([id]) => id === v) || [null, v || ''])[1];

    const booths = FP.spaces().slice().sort(byNumber).filter((s) => s.props.exhibitor);
    if (!booths.length) return FP.toast('No contracted booths to print', true);

    const card = (s) => {
      const kids = FP.childrenOf(s.id);
      const drops = kids.filter((k) => C.flag(k.kind, 'power'));
      const rigs = kids.filter((k) => C.flag(k.kind, 'rigging'));
      const amps = drops.reduce((sum, d) => sum + (Number(d.props.amps) || 0), 0);
      const q = s.geometry;

      const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

      return `<article class="wo">
        <header>
          <span class="no">${esc(s.props.number || '—')}</span>
          <span class="co">${esc(s.props.exhibitor)}</span>
          <span class="st">${esc(C.status(s.props.status).name)}</span>
        </header>
        <table>
          ${row('Footprint', `${esc(G.fmtDims(q.w, q.h, p.unit))} · ${esc(C.spaceType(s.props.spaceType).name)}`)}
          ${row('Position', `${G.round(q.x, 1)}, ${G.round(q.y, 1)} ${esc(p.unit)}`)}
          ${row('Total power', amps ? `<b>${amps} A</b>` : '—')}
          ${drops.length ? row('Circuits', `<ul>${drops.map((d) => `<li>
              <b>${esc(d.props.circuitId || d.props.label || 'drop')}</b> —
              ${Number(d.props.amps) || 0} A ${esc(d.props.voltage || '')} V ·
              ${esc(connName(d.props.connector))} ·
              from ${esc(d.props.panelId || 'UNASSIGNED')}
              ${d.props.hours === '24hr' ? '<span class="tag24">24 HOUR</span>' : ''}
            </li>`).join('')}</ul>`) : ''}
          ${rigs.length ? row('Rigging', rigs.map((r) =>
              `${esc(r.props.label || 'point')} ${r.props.loadLbs ? `(${r.props.loadLbs} lb)` : ''}`).join(', ')) : ''}
          ${row('Items placed', kids.length)}
          ${s.props.notes ? row('Notes', esc(s.props.notes)) : ''}
        </table>
      </article>`;
    };

    const win = window.open('', '_blank');
    if (!win) return FP.toast('Allow pop-ups to print', true);
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(p.name)} — booth work orders</title>
<style>
  @page { size: portrait; margin: 12mm; }
  body { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #131a26; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #5a6779; margin-bottom: 12px; font-size: 11px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .wo { border: 1px solid #c6cfdd; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .wo header { display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid #dde3ec;
               padding-bottom: 5px; margin-bottom: 5px; }
  .wo .no { font-size: 17px; font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
  .wo .co { flex: 1; font-weight: 600; }
  .wo .st { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #5a6779; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #8b96a8; font-weight: 500; width: 74px;
       vertical-align: top; padding: 2px 6px 2px 0; font-size: 10px; }
  td { padding: 2px 0; vertical-align: top; }
  ul { margin: 0; padding-left: 14px; }
  li { margin-bottom: 2px; }
  .tag24 { background: #fde68a; color: #92400e; font-weight: 700; font-size: 9px;
           padding: 1px 4px; border-radius: 3px; margin-left: 3px; }
</style></head><body>
<h1>${esc(p.name)} — booth work orders</h1>
<div class="sub">${esc(p.venue || '')}${p.hall ? ` · ${esc(p.hall)}` : ''} ·
  ${booths.length} contracted booths · issued ${stamp()} · Source One Events</div>
<div class="grid">${booths.map(card).join('')}</div>
</body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  }

  /* ============================================================
     Publish the public directory

     Publishing writes a SEPARATE document. The dialog states exactly
     what is being withheld, because "who is in booth 154" is public and
     "what they are paying for" is not.
     ============================================================ */
  function publishDialog() {
    const a = FP.publishAudit();
    const line = (n, what) =>
      `<li><b>${n}</b> ${esc(what)}</li>`;

    FP.modal({
      title: 'Publish public directory',
      body: `
        <p class="helptext">This builds a <b>separate public document</b> — the working
          plan is not served with fields hidden, it is copied across an allow-list.
          Anything not listed as included simply is not in the published file.</p>

        <div class="pub-cols">
          <div class="pub-col ok">
            <h5>Published</h5>
            <ul>
              ${line(a.spaces, 'booth outlines and numbers')}
              ${line(a.listed, 'exhibitor company names')}
              <li>Booth sizes, types and positions</li>
              <li>Hall shell, entrances and amenities</li>
              <li>Booth interiors where submitted</li>
            </ul>
          </div>
          <div class="pub-col no">
            <h5>Withheld</h5>
            <ul>
              ${line(a.contactsRemoved, 'exhibitor contact emails')}
              ${line(a.notesRemoved, 'internal notes')}
              ${line(a.elementsRemoved, 'electrical and utility elements')}
              <li>Booking status — held, unsold, changes needed</li>
              <li>Connector types and 24-hour power flags</li>
              <li>Deadlines, freeze dates and tier/pricing</li>
            </ul>
          </div>
        </div>

        <p class="helptext" style="margin-top:12px">Published to this browser for now.
          Phase 2 puts it behind a real URL.</p>`,
      foot: `<button class="btn ghost" data-cancel>Cancel</button>
             <button class="btn primary" data-ok>Publish</button>`,
      onMount: (body, foot) => {
        foot.querySelector('[data-cancel]').onclick = FP.closeModal;
        foot.querySelector('[data-ok]').onclick = () => {
          const snap = FP.publish();
          FP.closeModal();
          if (!snap) return FP.toast('Publish failed', true);
          FP.toast(`Published ${a.listed} exhibitors`);
          window.open('viewer.html', '_blank');
        };
      },
    });
  }

  /* ============================================================
     Plan file
     ============================================================ */
  function exportJson() {
    const data = JSON.stringify(FP.plan, null, 2);
    download(new Blob([data], { type: 'application/json' }), `${safeName()}-${stamp()}.json`);
    FP.toast('Plan file saved');
  }

  function importPlan() {
    const picker = document.getElementById('filePicker');
    picker.accept = 'application/json,.json';
    picker.value = '';
    picker.onchange = () => {
      const file = picker.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(reader.result);
          if (!raw || (!raw.elements && !raw.objects)) throw new Error('Not a plan file');
          raw.id = raw.id || FP.uid('plan');
          FP.loadPlan(raw);
          FP.save();
          FP.render.fit();
          FP.renderAll();
          FP.toast(`Imported “${raw.name || 'plan'}”`);
        } catch (e) {
          console.warn(e);
          FP.toast('That file is not a valid plan', true);
        }
      };
      reader.readAsText(file);
    };
    picker.click();
  }

  /* ============================================================
     Dispatch
     ============================================================ */
  FP.exporters = {
    run(kind) {
      switch (kind) {
        case 'png': return exportPng();
        case 'svg': return exportSvg();
        case 'pdf': return printPlan();
        case 'csv': return exportCsv();
        case 'json': return exportJson();
        case 'import': return importPlan();
        case 'electrical': return exportElectrical();
        case 'workorders': return exportWorkOrders();
        case 'publish': return publishDialog();
      }
    },
    planSvg,
    importPlan,
    exportCsv,
    exportJson,
    exportElectrical,
    exportWorkOrders,
  };
})(window);
