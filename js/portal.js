/* ============================================================
   portal.js — the exhibitor's view.

   Reuses config.js, geometry.js, render.js and rules.js unchanged. The
   exhibitor sees a real drawing of their own booth produced by the same
   renderer the planners use, and their submission is checked by the same
   rules engine — so "your banner is too tall" means exactly what it will
   mean when the show team looks at it.

   Nothing here decides what an exhibitor may see. Row level security
   already limits every query to their own booth; this file just presents
   what comes back. Load it signed in as a planner and you still only get
   your own row, because the database does not care which page asked.

   The form is the fast path on purpose. Most exhibitors will never drag
   a table around, but all of them can answer eight questions.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let ctx = null;          // { ex, show, elements, space, submissions, plan }
  let answers = {};
  let dirty = false;

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  FP.toast = (msg, bad) => {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('err', !!bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  };

  /* ------------------------------------------------------------
     The questions every exhibitor answers.

     Same field-definition shape the editor's inspector uses, so a show
     can bolt on its own questions via show.field_defs and they render
     here with no code change.
     ------------------------------------------------------------ */
  const STANDARD_FIELDS = [
    { key: 'contactName',  label: 'On-site contact',   type: 'text', required: true,
      placeholder: 'Who will be on the floor' },
    { key: 'contactPhone', label: 'Mobile number',     type: 'text', required: true,
      placeholder: 'Reachable during load-in' },
    { key: 'powerAmps',    label: 'Total power needed', type: 'number', unit: 'A',
      help: 'Everything you plug in, added up' },
    { key: 'powerHours',   label: 'Service hours',     type: 'select', default: 'show',
      options: [['show', 'Show hours only'], ['24hr', '24 hour']],
      help: '24-hour power is billed separately' },
    { key: 'tables',       label: 'Tables needed',     type: 'number' },
    { key: 'chairs',       label: 'Chairs needed',     type: 'number' },
    { key: 'bannerW',      label: 'Banner width',      type: 'number', unit: 'len' },
    { key: 'bannerH',      label: 'Banner height',     type: 'number', unit: 'len',
      help: 'Measured from the floor' },
    { key: 'deliveryDate', label: 'Freight arriving',  type: 'date' },
    { key: 'notes',        label: 'Anything we should know', type: 'textarea',
      placeholder: 'Rigging, vehicles, unusual builds, accessibility needs…' },
  ];

  const allFields = () => [...STANDARD_FIELDS, ...((ctx?.show?.field_defs) || [])];

  /**
   * Write field defaults into the answers, so what the exhibitor sees
   * selected is what actually gets saved. Without this a dropdown left
   * untouched submits nothing, and the crew reads a blank where the
   * exhibitor is certain they answered.
   */
  function seedDefaults() {
    for (const f of allFields()) {
      if (f.default === undefined) continue;
      if (answers[f.key] === undefined || answers[f.key] === '') {
        answers[f.key] = f.default;
      }
    }
  }

  /** Answers carried over from the last submission, plus what we know. */
  function primeAnswers() {
    answers = { ...(latest()?.answers || {}) };
    if (!answers.contactName && ctx.ex.contact_name) answers.contactName = ctx.ex.contact_name;
    if (!answers.contactPhone && ctx.ex.contact_phone) answers.contactPhone = ctx.ex.contact_phone;
    seedDefaults();
  }

  /* ---------------- field rendering ---------------- */
  function fieldHtml(f, value, unit, disabled) {
    const id = `f-${f.key}`;
    const dis = disabled ? 'disabled' : '';
    const suffix = f.unit === 'len' ? unit : f.unit;
    let input;

    switch (f.type) {
      case 'textarea':
        input = `<textarea class="inp" id="${id}" data-f="${f.key}" ${dis}
          placeholder="${esc(f.placeholder || '')}">${esc(value ?? '')}</textarea>`;
        break;
      case 'number':
        input = `<div class="unit-inp"><input class="inp num" id="${id}" type="number"
          data-f="${f.key}" value="${value ?? ''}" ${dis}
          />${suffix ? `<span class="u">${esc(suffix)}</span>` : ''}</div>`;
        break;
      case 'select':
        input = `<select class="inp" id="${id}" data-f="${f.key}" ${dis}>${
          (f.options || []).map(([v, l]) =>
            `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`
          ).join('')}</select>`;
        break;
      case 'bool':
        return `<label class="check"><input type="checkbox" data-f="${f.key}"
          ${value ? 'checked' : ''} ${dis}/> ${esc(f.label)}</label>`;
      case 'date':
        input = `<input class="inp" id="${id}" type="date" data-f="${f.key}"
          value="${esc(value ?? '')}" ${dis}/>`;
        break;
      default:
        input = `<input class="inp" id="${id}" type="text" data-f="${f.key}"
          value="${esc(value ?? '')}" ${dis} placeholder="${esc(f.placeholder || '')}"/>`;
    }

    return `<div class="field">
      <label for="${id}">${esc(f.label)}${f.required ? ' <span style="color:var(--err)">*</span>' : ''}</label>
      ${input}
      ${f.help ? `<div style="font-size:10.5px;color:var(--tx-3);margin-top:4px">${esc(f.help)}</div>` : ''}
    </div>`;
  }

  /* ---------------- data ---------------- */
  async function loadContext() {
    const sb = FP.auth.client();
    if (!sb) return { error: 'Cloud unavailable' };

    /* RLS returns only the caller's own exhibitor rows. */
    const { data: exRows, error: exErr } = await sb.from('exhibitor').select('*');
    if (exErr) return { error: exErr.message };
    if (!exRows?.length) return { none: true };

    const ex = exRows[0];

    const [{ data: show }, { data: elements }, { data: subs }] = await Promise.all([
      sb.from('show').select('*').eq('id', ex.show_id).maybeSingle(),
      sb.from('element').select('*').eq('show_id', ex.show_id),
      sb.from('submission').select('*').eq('exhibitor_id', ex.id)
        .order('version', { ascending: false }),
    ]);

    if (!show) return { error: 'Show not found' };

    const rows = elements || [];
    const space = rows.find((e) => e.exhibitor_id === ex.id && !e.parent_id) || null;
    const plan = FP.cloud.planFromRows(show, rows);

    /* Catalog and any existing order, so the Order card can render in the
       same pass rather than popping in afterwards. */
    await FP.order?.load?.(show.id, ex.id);

    return { ex, show, rows, space, plan, submissions: subs || [] };
  }

  FP.portalContext = () => ctx;

  const latest = () => ctx?.submissions?.[0] || null;

  const isFrozen = () =>
    !!ctx?.show?.freeze_date && new Date(ctx.show.freeze_date) < new Date();

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const ms = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
    return Math.round(ms / 86400000);
  }

  /* ---------------- views ---------------- */

  function renderSignIn(message) {
    $('pMain').innerHTML = `
      <div class="p-signin">
        <h1>Exhibitor sign in</h1>
        <p>Enter the email your booth was booked under. We will send you a
           one-time link — there is no password to remember.</p>
        <input class="inp" id="pEmail" type="email" placeholder="you@company.com" autocomplete="email"/>
        <button class="btn primary" id="pSend">Email me a sign-in link</button>
        <div id="pMsg" style="font-size:12px;margin-top:14px;min-height:18px">${esc(message || '')}</div>
      </div>`;

    const msg = (t, bad) => {
      const m = $('pMsg');
      m.textContent = t;
      m.style.color = bad ? 'var(--err)' : 'var(--ok)';
    };

    $('pSend').onclick = async () => {
      const email = ($('pEmail').value || '').trim();
      if (!email) return msg('Enter your email address.', true);
      msg('Sending…');
      const r = await FP.auth.signInWithMagicLink(email);
      msg(r.error || 'Link sent. Check your inbox — it expires in an hour.', !!r.error);
    };
    $('pEmail').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('pSend').click();
    });
  }

  function renderNoBooth() {
    $('pMain').innerHTML = `
      <div class="p-empty">
        <p>You are signed in, but no booth is linked to this address yet.</p>
        <p>Contact the show team and ask them to connect
           <b>${esc(FP.auth.user()?.email || '')}</b> to your booth.</p>
      </div>`;
  }

  function heroHtml() {
    const { show, space, ex } = ctx;
    const unit = show.unit || 'ft';
    const g = space?.geometry || {};
    const props = space?.props || {};
    const type = C.spaceType(props.spaceType);

    const dl = daysUntil(show.deadline);
    const dlClass = dl === null ? '' : dl < 0 ? 'over' : dl <= 7 ? 'soon' : '';
    const dlText = dl === null ? '—'
      : dl < 0 ? `${Math.abs(dl)} days overdue`
      : dl === 0 ? 'Due today'
      : `${dl} days left`;

    return `<div class="p-hero">
      <div class="p-hero-top">
        <div class="p-booth-no">${esc(props.number || '—')}</div>
        <div class="p-hero-meta">
          <h1>${esc(ex.company)}</h1>
          <p>${esc(show.name)}${show.venue_id ? '' : ''} · ${esc(show.unit === 'm' ? '' : '')}
             ${esc(g.w && g.h ? G.fmtDims(g.w, g.h, unit) : 'Booth not yet assigned')}</p>
        </div>
        <div class="p-fact p-deadline ${dlClass}">
          <span>Submission deadline</span>
          <b>${esc(dlText)}</b>
        </div>
      </div>
      <div class="p-facts">
        <div class="p-fact"><span>Booth type</span><b>${esc(type.name)}</b></div>
        <div class="p-fact"><span>Area</span><b>${esc(g.w && g.h ? G.fmtArea(g.w * g.h, unit) : '—')}</b></div>
        <div class="p-fact"><span>Max build height</span><b>${esc(G.fmtLen(type.maxHeight, unit))}</b></div>
        <div class="p-fact"><span>Show opens</span><b>${esc(show.opens || '—')}</b></div>
        <div class="p-fact"><span>Load-in</span><b>${esc(show.load_in || '—')}</b></div>
      </div>
    </div>`;
  }

  function findingsHtml(issues) {
    if (!issues.length) {
      return `<div class="p-clear">
        <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
        Everything checks out against the show rules.
      </div>`;
    }
    /* Ordering sixteen stools produces sixteen identical findings, which
       reads as panic rather than information. Collapse repeats into one
       line with a count — the exhibitor needs to know what is wrong and
       how much of it, not to scroll past the same sentence. */
    const grouped = [];
    const seen = new Map();
    for (const i of issues) {
      const key = `${i.severity}|${i.message}`;
      if (seen.has(key)) { seen.get(key).count += 1; continue; }
      const entry = { ...i, count: 1 };
      seen.set(key, entry);
      grouped.push(entry);
    }

    return grouped.map((i) => `<div class="p-finding ${esc(i.severity)}">
      <div><b>${esc(i.message)}${i.count > 1 ? ` <span class="p-count">× ${i.count}</span>` : ''}</b>
        <span>${esc(i.detail)}</span></div>
    </div>`).join('');
  }

  function renderPortal() {
    const { show, space, plan } = ctx;
    const unit = show.unit || 'ft';
    const frozen = isFrozen();
    const sub = latest();
    const locked = frozen || sub?.status === 'approved';

    /* Same rules the planners see, narrowed to this booth. */
    const issues = space
      ? FP.rules.run(plan, { scope: { type: 'booth', spaceId: space.id } })
      : [];
    const blocking = FP.rules.blocking(issues);

    const fields = allFields();
    const missing = fields.filter(
      (f) => f.required && !String(answers[f.key] ?? '').trim());

    const statusName = sub ? sub.status : 'not started';
    const statusColor = { approved: 'var(--ok)', submitted: 'var(--accent)',
                          changes: 'var(--err)', draft: 'var(--warn)' }[statusName] || 'var(--tx-3)';

    $('pMain').innerHTML = `
      ${heroHtml()}

      ${frozen ? `<div class="p-frozen">
        <b>This plan is frozen.</b> The show team locked changes on
        ${esc(show.freeze_date)}. You can still review everything below, but
        edits now need to go through your show contact.
      </div>` : ''}

      <div class="p-card">
        <h2>Your booth</h2>
        <p class="sub">Drawn from the live show plan. The faded shapes around it
          are the rest of the hall, for orientation.</p>
        <div class="p-plan"><svg id="pCanvas" xmlns="http://www.w3.org/2000/svg"></svg></div>
      </div>

      <div class="p-card">
        <h2>Checks</h2>
        <p class="sub">Run against this show's rules. Anything marked as an error
          has to be resolved before you can submit.</p>
        ${findingsHtml(issues)}
      </div>

      <div class="p-card">
        <h2>Your details</h2>
        <p class="sub">This is what the crew works from on load-in day.
          Fields marked <span style="color:var(--err)">*</span> are required.</p>
        <div class="p-grid2">
          ${fields.slice(0, -1).map((f) =>
            fieldHtml(f, answers[f.key] ?? f.default ?? '', unit, locked)).join('')}
        </div>
        ${fieldHtml(fields[fields.length - 1],
          answers[fields[fields.length - 1].key] ?? '', unit, locked)}
      </div>

      ${FP.order ? FP.order.html(locked) : ''}

      <div class="p-submit">
        <div class="status">
          Status
          <span class="p-status-pill" style="background:${statusColor}22;color:${statusColor}">
            ${esc(statusName)}
          </span>
          ${sub ? `<span style="color:var(--tx-3)"> · version ${sub.version}</span>` : ''}
          ${blocking.length ? `<div style="color:var(--err);margin-top:4px">
            ${blocking.length} issue${blocking.length === 1 ? '' : 's'} to resolve first</div>` : ''}
          ${missing.length ? `<div style="color:var(--warn);margin-top:4px">
            Missing: ${esc(missing.map((f) => f.label).join(', '))}</div>` : ''}
        </div>
        ${locked ? '' : `
          <button class="btn ghost" id="pSaveDraft">Save draft</button>
          <button class="btn primary" id="pSubmit"
            ${blocking.length || missing.length ? 'disabled' : ''}>Submit</button>`}
      </div>`;

    drawBooth();
    wireForm(locked);
  }

  /* Render the booth with the shared renderer, in booth scope. */
  function drawBooth() {
    const { plan, space } = ctx;
    if (!space) return;
    FP.plan = plan;
    FP.state.scope = { type: 'booth', spaceId: space.id };
    FP.state.selection = [];
    FP.state.showLabels = true;
    FP.state.issues = [];
    const svg = $('pCanvas');
    if (!svg) return;
    FP.render.init(svg);
    /* a little padding so the footprint is not flush to the frame */
    FP.render.fit(G.bbox(FP.get(space.id)), 46);
  }

  function wireForm(locked) {
    FP.order?.wire?.(locked, () => renderPortal());
    if (locked) return;

    document.querySelectorAll('[data-f]').forEach((el) => {
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const key = el.dataset.f;
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number') v = v === '' ? '' : Number(v);
        answers[key] = v;
        dirty = true;
        /* Required-field state drives the submit button, so refresh the
           bar without rebuilding the form and losing focus. */
        refreshSubmitBar();
      });
    });

    $('pSaveDraft')?.addEventListener('click', () => save('draft'));
    $('pSubmit')?.addEventListener('click', () => save('submitted'));
  }

  function refreshSubmitBar() {
    const fields = allFields();
    const missing = fields.filter((f) => f.required && !String(answers[f.key] ?? '').trim());
    const btn = $('pSubmit');
    if (btn) btn.disabled = missing.length > 0 || currentBlocking() > 0;
    const bar = document.querySelector('.p-submit .status');
    if (!bar) return;
    const warn = bar.querySelector('[data-missing]');
    if (warn) warn.remove();
    if (missing.length) {
      const d = document.createElement('div');
      d.dataset.missing = '1';
      d.style.cssText = 'color:var(--warn);margin-top:4px';
      d.textContent = `Missing: ${missing.map((f) => f.label).join(', ')}`;
      bar.appendChild(d);
    }
  }

  function currentBlocking() {
    if (!ctx?.space) return 0;
    return FP.rules.blocking(
      FP.rules.run(ctx.plan, { scope: { type: 'booth', spaceId: ctx.space.id } })).length;
  }

  /* ---------------- submit ---------------- */
  async function save(status) {
    const sb = FP.auth.client();
    if (!sb) return FP.toast('Not connected', true);

    if (status === 'submitted') {
      if (currentBlocking() > 0) {
        return FP.toast('Resolve the errors above before submitting', true);
      }
      const missing = allFields().filter(
        (f) => f.required && !String(answers[f.key] ?? '').trim());
      if (missing.length) return FP.toast('Fill in the required fields', true);
    }

    const prev = latest();
    /* A draft edits in place; a submission always cuts a new version, so
       "what changed since Friday" stays answerable. */
    const row = {
      show_id: ctx.show.id,
      exhibitor_id: ctx.ex.id,
      space_id: ctx.space?.id || null,
      status,
      answers,
      version: status === 'submitted' ? (prev?.version || 0) + 1 : (prev?.version || 1),
      submitted_at: status === 'submitted' ? new Date().toISOString() : null,
    };

    let error;
    if (prev && (status === 'draft' || prev.status === 'draft')) {
      ({ error } = await sb.from('submission').update(row).eq('id', prev.id));
    } else {
      ({ error } = await sb.from('submission').insert(row));
    }

    if (error) return FP.toast(error.message, true);

    dirty = false;
    FP.toast(status === 'submitted' ? 'Submitted — thank you' : 'Draft saved');
    await refresh();
  }

  FP.portalRefresh = () => refresh();

  async function refresh() {
    const next = await loadContext();
    if (next.error) return FP.toast(next.error, true);
    if (next.none) return renderNoBooth();
    ctx = next;
    primeAnswers();
    renderPortal();
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    document.documentElement.dataset.theme = FP.prefs?.theme || 'light';

    $('pTheme').onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      FP.setPref?.('theme', next);
      if (ctx?.space) drawBooth();
    };

    $('pSignOut').onclick = async () => {
      await FP.auth.signOut();
      location.reload();
    };

    if (!FP.auth?.available?.()) {
      $('pMain').innerHTML = `<div class="p-empty">
        The portal could not reach the server. Check your connection and reload.
      </div>`;
      return;
    }

    await FP.auth.init();

    window.addEventListener('beforeunload', (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    if (!FP.auth.signedIn()) {
      renderSignIn();
      return;
    }

    $('pWho').textContent = FP.auth.user().email;
    $('pSignOut').hidden = false;

    const data = await loadContext();
    if (data.error) {
      $('pMain').innerHTML = `<div class="p-empty">${esc(data.error)}</div>`;
      return;
    }
    if (data.none) return renderNoBooth();

    ctx = data;
    primeAnswers();
    renderPortal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
