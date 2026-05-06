(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const main = document.getElementById('main');
  const statRequest = document.getElementById('stat-request');
  const statAgents = document.getElementById('stat-agents');
  const statTokens = document.getElementById('stat-tokens');
  const statCost = document.getElementById('stat-cost');
  const statElapsed = document.getElementById('stat-elapsed');

  const btnRun = document.getElementById('btn-run');
  const btnClear = document.getElementById('btn-clear');

  // --- State ---
  /** @type {Map<string, {workOrderId:string, role:string, title:string, status:string, events:any[], iters:number, startedAt:number, output?:string}>} */
  const agents = new Map();
  let totalTokens = 0;
  let totalCost = 0;
  let startTime = 0;
  let elapsedTimer = null;
  let phaseEl = null;

  // --- Helpers ---
  function el(tag, opts = {}, ...children) {
    const e = document.createElement(tag);
    if (opts.cls) e.className = opts.cls;
    if (opts.id) e.id = opts.id;
    if (opts.text) e.textContent = opts.text;
    if (opts.html) e.innerHTML = opts.html;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
    for (const c of children) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  function escapeHtml(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatMs(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
  }

  function clearMain() {
    main.innerHTML = '';
    agents.clear();
    totalTokens = 0;
    totalCost = 0;
    startTime = 0;
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    statRequest.textContent = 'idle';
    statAgents.textContent = '0';
    statTokens.textContent = '0';
    statCost.textContent = '$0.0000';
    statElapsed.textContent = '0s';
    showIdle();
  }

  function showIdle() {
    main.innerHTML = '';
    const idle = el('div', { cls: 'idle' },
      el('h3', { text: 'Orchestra is idle' }),
      el('p', { text: 'Click "Execute Task" to start a multi-agent orchestration. The architect will plan, agents will work in parallel, and a security reviewer will audit the result.' })
    );
    main.appendChild(idle);
  }

  function startElapsed() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    startTime = Date.now();
    elapsedTimer = setInterval(() => {
      statElapsed.textContent = formatMs(Date.now() - startTime);
    }, 200);
  }

  function stopElapsed() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (startTime) statElapsed.textContent = formatMs(Date.now() - startTime);
  }

  function addPhase(label) {
    phaseEl = el('div', { cls: 'phase', text: label });
    main.appendChild(phaseEl);
    main.scrollTop = main.scrollHeight;
    return phaseEl;
  }

  function ensureAgent(agentId, workOrderId, role, title) {
    if (agents.has(agentId)) return agents.get(agentId);

    const data = { workOrderId, role, title, status: 'thinking', events: [], iters: 0, startedAt: Date.now() };
    agents.set(agentId, data);
    statAgents.textContent = String(agents.size);

    const card = el('div', { cls: 'agent thinking', id: 'agent-' + agentId });
    const head = el('div', { cls: 'agent-head' });
    head.appendChild(el('span', { cls: 'agent-id', text: agentId }));
    head.appendChild(el('span', { cls: 'agent-status', id: 'status-' + agentId, text: 'starting' }));
    head.appendChild(el('span', { cls: 'agent-title', text: workOrderId + ': ' + title }));
    head.appendChild(el('span', { cls: 'agent-iter', id: 'iter-' + agentId, text: '0 iter' }));
    head.addEventListener('click', () => card.classList.toggle('expanded'));
    card.appendChild(head);

    const body = el('div', { cls: 'agent-body' });
    body.appendChild(el('div', { cls: 'agent-events', id: 'events-' + agentId }));
    body.appendChild(el('div', { cls: 'agent-output', id: 'output-' + agentId, text: '(no output yet)' }));
    card.appendChild(body);

    main.appendChild(card);
    main.scrollTop = main.scrollHeight;
    return data;
  }

  function setAgentStatus(agentId, status) {
    const data = agents.get(agentId);
    if (!data) return;
    data.status = status;
    const card = document.getElementById('agent-' + agentId);
    if (card) {
      card.classList.remove('thinking', 'tool', 'running', 'done', 'failed', 'security');
      card.classList.add(status);
    }
    const statusEl = document.getElementById('status-' + agentId);
    if (statusEl) statusEl.textContent = status;
  }

  function pushAgentEvent(agentId, kind, text) {
    const data = agents.get(agentId);
    if (!data) return;
    data.events.push({ kind, text, t: Date.now() });
    const eventsEl = document.getElementById('events-' + agentId);
    if (!eventsEl) return;
    const line = el('div', { cls: 'event-line ' + kind, text });
    eventsEl.appendChild(line);
    eventsEl.scrollTop = eventsEl.scrollHeight;
    // Keep last 100 events
    while (eventsEl.children.length > 100) eventsEl.removeChild(eventsEl.firstChild);
  }

  function setAgentIter(agentId, n) {
    const data = agents.get(agentId);
    if (data) data.iters = n;
    const iterEl = document.getElementById('iter-' + agentId);
    if (iterEl) iterEl.textContent = n + ' iter';
  }

  function appendOutput(agentId, text) {
    const data = agents.get(agentId);
    if (!data) return;
    data.output = (data.output || '') + text;
    const out = document.getElementById('output-' + agentId);
    if (out) {
      if (out.textContent === '(no output yet)') out.textContent = '';
      out.textContent = data.output;
    }
  }

  function renderMail(msg) {
    const div = el('div', { cls: 'mail ' + msg.type });
    const head = el('div', { cls: 'mail-head' });
    head.appendChild(el('span', { cls: 'mail-from', text: msg.from }));
    head.appendChild(el('span', { cls: 'mail-arrow', text: '→' }));
    head.appendChild(el('span', { cls: 'mail-to', text: msg.to }));
    head.appendChild(el('span', { cls: 'mail-type', text: msg.type }));
    if (msg.workOrderId) head.appendChild(el('span', { text: '[' + msg.workOrderId + ']' }));
    div.appendChild(head);
    div.appendChild(el('div', { cls: 'mail-subject', text: msg.subject }));
    div.appendChild(el('div', { cls: 'mail-body', text: msg.body }));
    main.appendChild(div);
    main.scrollTop = main.scrollHeight;
  }

  function renderSecurity(review) {
    const block = el('div', { cls: 'security-block ' + (review.approved ? 'approved' : '') });
    block.appendChild(el('div', { html: '<strong>Security Review by ' + escapeHtml(review.agentId) + '</strong> — ' + (review.approved ? '✅ APPROVED' : '⚠️ ISSUES FOUND') }));
    block.appendChild(el('div', { html: '<small>' + escapeHtml(review.summary) + '</small>' }));
    for (const issue of review.issues || []) {
      const i = el('div', { cls: 'security-issue ' + issue.severity });
      i.innerHTML =
        '<span class="severity-tag">' + escapeHtml(issue.severity) + '</span>' +
        '<strong>' + escapeHtml(issue.category) + '</strong> — ' + escapeHtml(issue.description) +
        (issue.fileRef ? '<br><small>' + escapeHtml(issue.fileRef) + '</small>' : '') +
        '<br><small>→ ' + escapeHtml(issue.recommendation) + '</small>';
      block.appendChild(i);
    }
    main.appendChild(block);
    main.scrollTop = main.scrollHeight;
  }

  // --- Event handlers from extension host ---
  window.addEventListener('message', (e) => {
    const msg = e.data;
    switch (msg.type) {
      case 'reset':
        clearMain();
        break;

      case 'plan-start':
        clearMain();
        main.innerHTML = '';
        statRequest.textContent = (msg.request || '').substring(0, 60) + ((msg.request || '').length > 60 ? '...' : '');
        addPhase('Phase 1 — Planning');
        startElapsed();
        break;

      case 'plan-done':
        addPhase('Phase 2 — Executing ' + msg.workOrderCount + ' work orders');
        break;

      case 'wo-start':
        ensureAgent(msg.agentId, msg.workOrderId, msg.role, msg.title);
        setAgentStatus(msg.agentId, 'running');
        if (msg.role === 'security') setAgentStatus(msg.agentId, 'security');
        break;

      case 'wo-progress': {
        const ev = msg.event;
        if (ev.type === 'thinking') {
          setAgentIter(msg.agentId, ev.iteration);
          setAgentStatus(msg.agentId, 'thinking');
          pushAgentEvent(msg.agentId, 'thinking', '· thinking (iter ' + ev.iteration + ')');
        } else if (ev.type === 'text') {
          setAgentStatus(msg.agentId, 'thinking');
          appendOutput(msg.agentId, ev.content);
        } else if (ev.type === 'tool-call') {
          setAgentStatus(msg.agentId, 'tool');
          pushAgentEvent(msg.agentId, 'tool-call', '→ ' + ev.name + '(' + JSON.stringify(ev.args).substring(0, 80) + ')');
        } else if (ev.type === 'tool-result') {
          pushAgentEvent(msg.agentId, 'tool-result', '← ' + ev.name + ': ' + ev.result.substring(0, 80) + (ev.truncated ? '…' : ''));
        }
        break;
      }

      case 'wo-done':
        setAgentStatus(msg.agentId, msg.success ? 'done' : 'failed');
        totalCost += msg.cost || 0;
        statCost.textContent = '$' + totalCost.toFixed(4);
        const data = agents.get(msg.agentId);
        if (data) {
          pushAgentEvent(msg.agentId, 'thinking', '✓ done in ' + formatMs(msg.duration));
        }
        break;

      case 'mail':
        renderMail(msg.message);
        break;

      case 'wo-fallback': {
        const fb = el('div', { cls: 'security-block', html:
          '<strong>↻ Auto-fallback for ' + escapeHtml(msg.workOrderId) + '</strong>' +
          '<br><small>' + escapeHtml(msg.failedProvider) + ' failed (' + escapeHtml(msg.reason || '') + '), retrying with ' + escapeHtml(msg.nextProvider) + '</small>'
        });
        main.appendChild(fb);
        main.scrollTop = main.scrollHeight;
        break;
      }

      case 'security-start':
        addPhase('Phase 3 — Security Audit (' + msg.filesToReview.length + ' file' + (msg.filesToReview.length === 1 ? '' : 's') + ')');
        break;

      case 'security-done':
        // The full review object will arrive in 'final'
        break;

      case 'synthesize-start':
        addPhase('Phase 4 — Synthesizing final report');
        break;

      case 'final':
        if (msg.securityReview) renderSecurity(msg.securityReview);
        statTokens.textContent = (msg.totalTokens || 0).toLocaleString();
        statCost.textContent = '$' + (msg.totalCost || 0).toFixed(4);
        stopElapsed();

        addPhase('Final report');
        var reportText = msg.finalOutput || '(no report)';
        var report = el('div', { cls: 'final-report collapsed' });
        report.textContent = reportText;
        main.appendChild(report);

        var toggle = el('button', { cls: 'final-report-toggle', text: 'Show full report' });
        toggle.addEventListener('click', function () {
          if (report.classList.contains('collapsed')) {
            report.classList.remove('collapsed');
            toggle.textContent = 'Collapse';
          } else {
            report.classList.add('collapsed');
            toggle.textContent = 'Show full report';
          }
        });
        main.appendChild(toggle);
        main.scrollTop = main.scrollHeight;
        break;

      case 'budget-warning':
        const w = el('div', { cls: 'security-block', html: '<strong>⚠️ Budget warning</strong> — used $' + msg.used.toFixed(2) + ' of $' + msg.limit.toFixed(2) });
        main.appendChild(w);
        break;
    }
  });

  // --- UI buttons ---
  btnRun.addEventListener('click', () => vscode.postMessage({ type: 'execute' }));
  btnClear.addEventListener('click', () => clearMain());

  // Init
  showIdle();
})();
