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
    --accent:#7c5cfc; --grid-minor:rgba(20,30,50,.07); --grid-major:rgba(20,30,50,.14);
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
      colorBy: S.colorBy,
    };
    S.selection = [];
    S.draft = null;
    S.scope = { type: 'hall', spaceId: null };
    S.showLabels = true;
    /* exports are working drawings — the measurement grid prints */
    S.showGrid = true;
    /* when the plan has named sections and no other colouring was chosen,
       the sheet colours by section — the placard look */
    if (S.colorBy === 'status' && FP.spaces().some((s) => String(s.props.section || '').trim())) {
      S.colorBy = 'section';
    }
    /* Labels gate themselves on screen legibility, so a zoomed-out
       editor window would print a numberless floor. Exports paint at a
       fixed reading zoom instead — every booth number and item name is
       decided by the sheet, not by how wide the editor happened to be. */
    S.view = { ...keep.view, zoom: 10 };
    FP.render.paintNow();
    const markup = svg.innerHTML;
    Object.assign(S, {
      selection: keep.selection, draft: keep.draft, scope: keep.scope,
      showLabels: keep.labels, showGrid: keep.grid, colorBy: keep.colorBy,
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
  ${rulersSvg(p, m)}
  ${aisleCalloutsSvg(p)}
  ${sectionChipsSvg(p)}
  ${titleBlock ? titleBlockSvg(p, m, p.height + m * 0.6, vbW, blockH) : ''}
</svg>`;
  }

  /* Coordinate rulers on all four edges — the sheet reads like a site
     drawing: tick every grid line, number every labelled step, feet. */
  function rulersSvg(p, m) {
    const W = p.width, H = p.height;
    const step = p.grid || 5;
    const label = (Math.max(W, H) >= 400 ? step * 10 : step * 2);
    const fs = Math.min(3, Math.max(1.6, m * 0.17));
    const t = [];
    const line = (x1, y1, x2, y2) =>
      t.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9aa5b8" stroke-width="0.18"/>`);
    const txt = (x, y, s, anchor = 'middle') =>
      t.push(`<text x="${x}" y="${y}" font-size="${fs}" fill="#5a6779" text-anchor="${anchor}"
        font-family="ui-monospace,Menlo,Consolas,monospace">${s}</text>`);

    for (let x = 0; x <= W; x += step) {
      const big = x % label === 0;
      const len = big ? 2 : 1.1;
      line(x, -0.8, x, -0.8 - len);
      line(x, H + 0.8, x, H + 0.8 + len);
      if (big) {
        txt(x, -0.8 - len - 0.8, x);
        txt(x, H + 0.8 + len + fs, x);
      }
    }
    for (let y = 0; y <= H; y += step) {
      const big = y % label === 0;
      const len = big ? 2 : 1.1;
      line(-0.8, y, -0.8 - len, y);
      line(W + 0.8, y, W + 0.8 + len, y);
      if (big) {
        txt(-0.8 - len - 0.6, y + fs * 0.35, y, 'end');
        txt(W + 0.8 + len + 0.6, y + fs * 0.35, y, 'start');
      }
    }
    /* units tag, top-left corner */
    txt(-0.8 - 2 - 0.6, -0.8 - 2 - 0.8, p.unit === 'm' ? 'm' : 'ft', 'end');
    return `<g>${t.join('')}</g>`;
  }

  /* Printed aisle widths — "10-FT AISLE" along each aisle band, the way
     venue placards mark them, so the crew reads clearances off the sheet. */
  function aisleCalloutsSvg(p) {
    const out = [];
    for (const el of p.elements) {
      if (el.kind !== 'aisle') continue;
      const q = el.geometry;
      if (!q || !q.w || !q.h) continue;
      const across = Math.min(q.w, q.h);
      const along = Math.max(q.w, q.h);
      const n = Math.round(across * 2) / 2;
      const label = `${n}-${p.unit === 'm' ? 'M' : 'FT'} AISLE`;
      const fs = Math.min(2.4, across * 0.42, along * 0.05 + 1.1);
      if (fs < 1.1) continue;
      const vert = q.h > q.w;
      /* off-centre so it clears the aisle's hanging-sign label */
      const cx = vert ? q.x + q.w / 2 : q.x + q.w * 0.35;
      const cy = vert ? q.y + q.h * 0.35 : q.y + q.h / 2;
      out.push(`<text x="${cx}" y="${cy + fs * 0.35}" font-size="${fs}" fill="#64748d"
        text-anchor="middle" font-weight="600" letter-spacing="${(fs * 0.1).toFixed(2)}"
        ${vert ? `transform="rotate(-90 ${cx} ${cy})"` : ''}>${label}</text>`);
    }
    return out.length ? `<g>${out.join('')}</g>` : '';
  }

  /* Placard-style section headers — "ITALIAN — 18 BTHS" on a colour chip
     over each named section's block of booths. */
  function sectionChipsSvg(p) {
    const groups = {};
    for (const el of p.elements) {
      if (!C.flag(el.kind, 'sellable')) continue;
      const name = String(el.props?.section || '').trim();
      if (!name) continue;
      const b = G.bbox(el);
      const g = groups[name] || (groups[name] = { n: 0, x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 });
      g.n++;
      g.x1 = Math.min(g.x1, b.x); g.y1 = Math.min(g.y1, b.y);
      g.x2 = Math.max(g.x2, b.x + b.w); g.y2 = Math.max(g.y2, b.y + b.h);
    }
    const names = Object.keys(groups);
    if (!names.length) return '';
    return `<g>${names.map((name) => {
      const g = groups[name];
      const label = `${name.toUpperCase()} — ${g.n} BTHS`;
      const fs = 2.3;
      const w = label.length * fs * 0.64 + 3;
      const h = fs * 1.75;
      const cx = (g.x1 + g.x2) / 2;
      /* straddle the section's top edge so it reads as a header without
         covering the first row's numbers */
      const y = Math.max(g.y1 - h * 0.65, 0.5);
      return `<g>
        <rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="0.9"
          fill="${C.sectionColor(name)}" stroke="#1c2333" stroke-width="0.14" opacity="0.96"/>
        <text x="${cx}" y="${y + fs * 1.28}" font-size="${fs}" font-weight="700"
          text-anchor="middle" fill="#1c2333" letter-spacing="0.1">${esc(label)}</text>
      </g>`;
    }).join('')}</g>`;
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
    const drapeTakeoff = FP.drape.takeoff(p);

    const legendKinds = [...new Set(p.elements.map((e) => e.kind))]
      .map((id) => C.kind(id))
      .filter((k) => k && k.cat !== 'annotate');

    /* aisle clearances, straight off the drawing */
    const aisles = p.elements.filter((e) => e.kind === 'aisle' && e.geometry?.w && e.geometry?.h);
    const aisleWidths = [...new Set(aisles.map((a) =>
      Math.round(Math.min(a.geometry.w, a.geometry.h))))].sort((a, b) => a - b);
    const usualAisle = (() => {
      const c = {};
      aisles.forEach((a) => {
        const w = Math.round(Math.min(a.geometry.w, a.geometry.h));
        c[w] = (c[w] || 0) + 1;
      });
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
    })();

    /* section totals — the placard's per-area booth counts */
    const sectionCounts = {};
    spaces.forEach((s) => {
      const n = String(s.props.section || '').trim();
      if (n) sectionCounts[n] = (sectionCounts[n] || 0) + 1;
    });
    const secRows = Object.entries(sectionCounts).sort((a, b) => b[1] - a[1]);
    const unassigned = st.total - secRows.reduce((t, [, n]) => t + n, 0);

    /* booth mix — counts by footprint, the placard-style totals table */
    const mix = {};
    spaces.forEach((s) => {
      const k = G.fmtDims(s.geometry.w, s.geometry.h, p.unit);
      mix[k] = (mix[k] || 0) + 1;
    });
    const mixRows = Object.entries(mix).sort((a, b) => b[1] - a[1]);

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
  .plan { border: 1px solid #dde3ec; padding: 8px; margin-bottom: 4px; }
  .plan svg { width: 100%; height: auto; }
  .plannote { font-size: 10.5px; color: #8b96a8; text-align: right; margin: 0 2px 16px; }
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
  <div><span>Aisles</span><b>${aisleWidths.length ? aisleWidths.map((w) => `${w} ft`).join(' / ') : '—'}</b></div>
  <div><span>Load-in</span><b>${esc(p.dates.loadIn || '—')}</b></div>
  <div><span>Opens</span><b>${esc(p.dates.open || '—')}</b></div>
</div>
<div class="plan">${planSvg()}</div>
<div class="plannote">Dimensions in ${p.unit === 'm' ? 'metres' : 'feet'} · grid ${p.grid || 5} ${p.unit || 'ft'}${
  usualAisle ? ` · all aisles ${usualAisle} ft unless otherwise indicated` : ''}</div>
<h2 class="legend-h">Legend</h2>
<div class="legend">${legendKinds.map((k) =>
  `<span class="lg">${FP.render.symbolSwatch(k.id, 18)}<em>${esc(k.name)}</em></span>`).join('')}</div>

${secRows.length ? `<h2>Sections</h2>
<table style="max-width:340px"><thead><tr><th>Section</th><th>Booths</th></tr></thead><tbody>
${secRows.map(([name, n]) => `<tr>
    <td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;
      background:${C.sectionColor(name)};border:1px solid #1c2333;margin-right:7px"></i>${esc(name)}</td>
    <td class="num">${n}</td></tr>`).join('')}
  ${unassigned > 0 ? `<tr><td style="color:#8b96a8">Unassigned</td><td class="num">${unassigned}</td></tr>` : ''}
  <tr style="font-weight:700;border-top:1.5px solid #131a26"><td>Total</td><td class="num">${st.total}</td></tr>
</tbody></table>` : ''}

${mixRows.length ? `<h2>Booth mix</h2>
<table style="max-width:340px"><thead><tr><th>Size</th><th>Booths</th></tr></thead><tbody>
${mixRows.map(([size, n]) => `<tr><td class="num">${esc(size)}</td><td class="num">${n}</td></tr>`).join('')}
  <tr style="font-weight:700;border-top:1.5px solid #131a26"><td>Total</td><td class="num">${st.total}</td></tr>
</tbody></table>` : ''}

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

${drapeTakeoff.groups.length ? `<h2>Pipe &amp; drape takeoff</h2>
<table><thead><tr>
  <th>Height</th><th>Colour</th><th>Length</th><th>Panels</th><th>Uprights &amp; bases</th><th>Runs</th>
</tr></thead><tbody>
${drapeTakeoff.groups.map((g) => `<tr>
    <td class="num">${g.height} ft</td>
    <td style="text-transform:capitalize">${esc(g.color)}</td>
    <td class="num">${esc(G.fmtLen(g.length, p.unit))}</td>
    <td class="num">${g.sections}</td>
    <td class="num">${g.uprights}</td>
    <td class="num">${g.runs}</td>
  </tr>`).join('')}
  <tr style="font-weight:700;border-top:1.5px solid #131a26">
    <td colspan="2">Total</td>
    <td class="num">${esc(G.fmtLen(drapeTakeoff.totalLength, p.unit))}</td>
    <td class="num">${drapeTakeoff.totalPanels}</td>
    <td class="num">${drapeTakeoff.totalUprights}</td>
    <td></td>
  </tr>
</tbody></table>` : ''}

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
     Drape order sheet

     Replaces the handwritten counts in the margin of a working plan —
     "8 BLACK DRAPE = 83", "3 BLACK DRAPE = 205" — with a sheet the drape
     contractor can price directly. One row per run, one totals row per
     colour/height, computed by FP.drape.takeoff() from the same geometry
     the plan draws.
     ============================================================ */
  function exportDrape() {
    const p = FP.plan;
    const t = FP.drape.takeoff(p);
    if (!t.groups.length) return FP.toast('No pipe & drape on this plan', true);

    const rows = [[
      'Height (ft)', 'Colour', 'Role', `Length (${t.unit})`, `Sections (@ width)`,
      `X1 (${t.unit})`, `Y1 (${t.unit})`, `X2 (${t.unit})`, `Y2 (${t.unit})`, 'Source',
    ]];

    FP.drape.runs(p)
      .slice()
      .sort((a, b) => (Number(b.props.drapeHeight) - Number(a.props.drapeHeight))
        || String(a.props.drapeColor).localeCompare(String(b.props.drapeColor)))
      .forEach((r) => {
        const len = G.length(r);
        const sw = Number(r.props.sectionWidth) || 10;
        rows.push([
          r.props.drapeHeight, r.props.drapeColor,
          FP.drape.roleName(r.props.drapeRole),
          G.round(len, 1), `${Math.max(1, Math.ceil(len / sw - 1e-9))} @ ${sw}`,
          G.round(r.geometry.x1, 2), G.round(r.geometry.y1, 2),
          G.round(r.geometry.x2, 2), G.round(r.geometry.y2, 2),
          r.props.derived ? 'Generated' : 'Drawn',
        ]);
      });

    rows.push([]);
    rows.push(['Height (ft)', 'Colour', `Total ${t.unit}`, 'Panels', 'Uprights & bases', 'Runs']);
    t.groups.forEach((g) => {
      rows.push([g.height, g.color, Math.round(g.length), g.sections, g.uprights, g.runs]);
    });
    rows.push([]);
    rows.push(['TOTAL', '', Math.round(t.totalLength), t.totalPanels, t.totalUprights, '']);

    const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
    download(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }),
      `${safeName()}-drape-${stamp()}.csv`);
    FP.toast('Drape order sheet exported');
  }

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
        case 'drape': return exportDrape();
        case 'workorders': return exportWorkOrders();
        case 'publish': return publishDialog();
      }
    },
    planSvg,
    importPlan,
    exportCsv,
    exportJson,
    exportElectrical,
    exportDrape,
    exportWorkOrders,
  };
})(window);
