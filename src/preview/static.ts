/**
 * Renders the diagram live preview dashboard HTML.
 */
export function renderPreviewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SPOC Diagram Preview</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        background: 'transparent',
        primaryColor: 'rgba(255,255,255,0.06)',
        primaryBorderColor: 'rgba(255,255,255,0.15)',
        primaryTextColor: '#e2e8f0',
        secondaryColor: 'rgba(167,139,250,0.1)',
        secondaryBorderColor: 'rgba(167,139,250,0.3)',
        secondaryTextColor: '#e2e8f0',
        tertiaryColor: 'rgba(6,182,212,0.08)',
        tertiaryBorderColor: 'rgba(6,182,212,0.3)',
        tertiaryTextColor: '#e2e8f0',
        lineColor: '#334155',
        textColor: '#e2e8f0',
        mainBkg: 'rgba(255,255,255,0.06)',
        nodeBorder: 'rgba(255,255,255,0.15)',
        clusterBkg: 'rgba(255,255,255,0.03)',
        clusterBorder: 'rgba(255,255,255,0.08)',
        edgeLabelBackground: 'rgba(10,14,23,0.9)',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '13px',
      },
    });

    let currentSource = null;
    let currentPlanId = null;
    let currentMeta = null;
    let currentUpdatedAt = null;
    let relativeTimeInterval = null;

    async function loadDiagrams() {
      const res = await fetch('/diagrams');
      const data = await res.json();
      const list = document.getElementById('diagram-list');
      list.innerHTML = '';

      // Build sidebar stats
      let totalPlans = data.diagrams.length;
      let donePlans = 0, activePlans = 0;
      for (const d of data.diagrams) {
        if (d.meta?.status === 'done') donePlans++;
        else if (d.meta?.status === 'in_progress') activePlans++;
      }
      const statsEl = document.querySelector('.left-sidebar-stats');
      if (statsEl) {
        statsEl.innerHTML = \`
          <div class="stat-item"><span class="stat-value accent">\${totalPlans}</span><span class="stat-label">plans</span></div>
          <div class="stat-item"><span class="stat-value amber">\${activePlans}</span><span class="stat-label">active</span></div>
          <div class="stat-item"><span class="stat-value green">\${donePlans}</span><span class="stat-label">done</span></div>
        \`;
      }

      for (const d of data.diagrams) {
        const btn = document.createElement('button');
        const title = d.meta?.title || d.planId;
        const status = d.meta?.status || 'proposed';
        // Count nodes from source for mini progress bar
        const src = d.content || '';
        let doneCount = 0, totalNodes = 0;
        const srcLines = src.split('\\n');
        for (const line of srcLines) {
          if (line.includes(':::done')) { doneCount++; totalNodes++; }
          else if (line.includes(':::inProgress') || line.includes(':::blocked') || line.includes(':::backlog')) { totalNodes++; }
        }
        const pct = totalNodes > 0 ? Math.round((doneCount / totalNodes) * 100) : 0;

        btn.innerHTML = \`
          <div class="btn-top">
            <span class="btn-marker">▸</span>
            <span class="btn-label">\${escapeHtml(title)}</span>
          </div>
          <div class="btn-meta">
            <span class="btn-status-chip s-\${status}">\${status}</span>
            <div class="btn-mini-bar"><div class="mini-bar-fill" style="width:\${pct}%"></div></div>
            <span class="btn-count">\${doneCount}/\${totalNodes}</span>
          </div>
        \`;
        btn.className = 'diagram-btn';
        btn.dataset.planId = d.planId;
        btn.onclick = () => selectDiagram(d.planId);
        list.appendChild(btn);
      }
      if (data.diagrams.length > 0) {
        selectDiagram(data.diagrams[0].planId);
      } else {
        document.getElementById('diagram-container').innerHTML =
          '<p class="empty-state">No diagrams found.<br>Create a .diagram.mmd file in your plans directory.</p>';
      }
    }

    let eventSource = null;

    async function selectDiagram(planId) {
      if (eventSource) { eventSource.close(); eventSource = null; }
      currentPlanId = planId;

      document.querySelectorAll('.diagram-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.diagram-btn').forEach(b => {
        if (b.dataset.planId === planId) b.classList.add('active');
      });

      const res = await fetch('/diagram/' + planId);
      const data = await res.json();
      currentMeta = data.meta || null;
      renderDiagram(data.content, data.updatedAt, data.meta);

      eventSource = new EventSource('/events/' + planId);
      eventSource.onmessage = (e) => {
        const payload = JSON.parse(e.data);
        currentMeta = payload.meta || null;
        renderDiagram(payload.content, payload.updatedAt, payload.meta);
        pulseGlow();
      };
      eventSource.onerror = () => {
        document.getElementById('live-status').classList.add('disconnected');
      };
      document.getElementById('live-status').classList.remove('disconnected');
    }

    async function renderDiagram(source, updatedAt, meta) {
      currentSource = source;
      currentUpdatedAt = updatedAt;

      // T001: Plan title and summary
      const titleEl = document.getElementById('plan-title');
      const summaryEl = document.getElementById('plan-summary');
      titleEl.textContent = meta?.title || currentPlanId || '';
      summaryEl.textContent = meta?.summary || '';

      // T002: Status badge
      const badgeEl = document.getElementById('plan-status-badge');
      if (meta?.status) {
        badgeEl.textContent = '[' + meta.status + ']';
        badgeEl.className = 'status-badge status-' + meta.status;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }

      // T003: Progress indicator
      updateProgress(source);

      // T004: Relative time
      updateRelativeTime();

      // T006: Ready-next callout
      updateReadyCallout(source);

      // Render SVG
      const container = document.getElementById('diagram-container');
      try {
        const { svg } = await mermaid.render('mermaid-svg', source);
        container.innerHTML = svg;
        container.classList.remove('error');
        // T007: Attach click handlers to nodes
        attachNodeClickHandlers(container, source);
      } catch (err) {
        container.innerHTML = '<pre class="raw-source">' + escapeHtml(source) + '</pre>' +
          '<div class="error-panel">Render error: ' + escapeHtml(err.message || String(err)) + '</div>';
        container.classList.add('error');
      }
    }

    // T003: Progress
    function updateProgress(source) {
      const bar = document.getElementById('progress-bar');
      const text = document.getElementById('progress-text');
      const counts = { done: 0, inProgress: 0, blocked: 0, backlog: 0 };
      const lines = source.split('\\n');
      for (const line of lines) {
        if (line.includes(':::done')) counts.done++;
        else if (line.includes(':::inProgress')) counts.inProgress++;
        else if (line.includes(':::blocked')) counts.blocked++;
        else if (line.includes(':::backlog')) counts.backlog++;
      }
      const total = counts.done + counts.inProgress + counts.blocked + counts.backlog;
      if (total === 0) {
        document.getElementById('progress-section').style.display = 'none';
        return;
      }
      document.getElementById('progress-section').style.display = 'block';
      const pct = Math.round((counts.done / total) * 100);
      bar.style.width = pct + '%';
      const filled = Math.round((counts.done / total) * 12);
      const empty = 12 - filled;
      text.textContent = '\\u2588'.repeat(filled) + '\\u2591'.repeat(empty) + ' ' + counts.done + '/' + total;
    }

    // T004: Relative time
    function updateRelativeTime() {
      if (!currentUpdatedAt) return;
      const metaEl = document.getElementById('metadata');
      const diff = Date.now() - new Date(currentUpdatedAt).getTime();
      const seconds = Math.floor(diff / 1000);
      let label;
      if (seconds < 60) label = 'Updated just now';
      else if (seconds < 3600) label = 'Updated ' + Math.floor(seconds / 60) + 'm ago';
      else if (seconds < 86400) label = 'Updated ' + Math.floor(seconds / 3600) + 'h ago';
      else label = 'Updated ' + Math.floor(seconds / 86400) + 'd ago';
      metaEl.textContent = label;
      metaEl.title = new Date(currentUpdatedAt).toISOString();
    }

    // T006: Ready callout
    function updateReadyCallout(source) {
      const callout = document.getElementById('ready-callout');
      const match = source.match(/^%%\\s*ready:\\s*(.+)$/m);
      if (match) {
        const tasks = match[1].trim().split(',').map(t => t.trim());
        callout.innerHTML = tasks.map(t => '<div class="ready-item">▸ ' + escapeHtml(t) + '</div>').join('');
        callout.style.display = 'block';
      } else {
        callout.style.display = 'none';
      }
    }

    // T007: Node detail panel
    function parseNodeMetadata(source) {
      const nodes = {};
      const blocks = source.split(/^%%\\s*node:\\s*/m).slice(1);
      for (const block of blocks) {
        const lines = block.split('\\n');
        const nodeId = lines[0].trim();
        const meta = {};
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('%%')) {
            const m = line.match(/^%%\\s*(\\w[\\w-]*):\\s*(.+)$/);
            if (m) meta[m[1]] = m[2].trim();
            else break;
          } else break;
        }
        nodes[nodeId] = meta;
      }
      return nodes;
    }

    function attachNodeClickHandlers(container, source) {
      const nodeMeta = parseNodeMetadata(source);
      const svgNodes = container.querySelectorAll('g.node');
      for (const g of svgNodes) {
        const id = g.id || '';
        // Mermaid IDs: flowchart-TXXX-NNN
        const match = id.match(/flowchart-(T\\d+)/);
        if (match && nodeMeta[match[1]]) {
          g.style.cursor = 'pointer';
          g.addEventListener('click', (e) => {
            e.stopPropagation();
            showNodePanel(match[1], nodeMeta[match[1]]);
          });
        }
      }
    }

    function showNodePanel(nodeId, meta) {
      dismissPanel();
      const panel = document.getElementById('node-detail-section');
      let html = '<div class="section-header">\\u250C\\u2500 Node Detail \\u2500\\u2510</div>';
      html += '<div class="node-detail-id">' + nodeId + '</div>';
      if (meta.title) html += '<div class="node-detail-title">' + escapeHtml(meta.title) + '</div>';
      if (meta.status) html += '<span class="status-badge status-' + meta.status + '">[' + meta.status + ']</span>';
      if (meta.skill) html += '<div class="node-detail-field"><span class="field-key">skill</span> <span class="field-val">' + escapeHtml(meta.skill) + '</span></div>';
      if (meta.scope) html += '<div class="node-detail-field"><span class="field-key">scope</span> <span class="field-val">' + escapeHtml(meta.scope) + '</span></div>';
      if (meta.acceptance) html += '<div class="node-detail-field"><span class="field-key">accept</span> <span class="field-val">' + escapeHtml(meta.acceptance) + '</span></div>';
      if (meta.verify) html += '<div class="node-detail-field"><span class="field-key">verify</span> <code>' + escapeHtml(meta.verify) + '</code></div>';
      html += '<button class="dismiss-btn" onclick="dismissPanel()">\\u2715 close</button>';
      panel.innerHTML = html;
      panel.style.display = 'block';
      setTimeout(() => panel.classList.add('visible'), 10);
    }

    function onOutsideClick(e) {
      const panel = document.getElementById('node-detail-section');
      if (panel && !panel.contains(e.target)) dismissPanel();
    }

    window.dismissPanel = function() {
      const panel = document.getElementById('node-detail-section');
      if (panel) {
        panel.classList.remove('visible');
        panel.style.display = 'none';
        panel.innerHTML = '';
      }
    };

    function pulseGlow() {
      const el = document.getElementById('diagram-container');
      el.classList.add('glow');
      setTimeout(() => el.classList.remove('glow'), 600);
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // T004: Update relative time every 30s
    setInterval(updateRelativeTime, 30000);

    loadDiagrams();
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-deep: #0a0e17;
      --bg-surface: rgba(255,255,255,0.04);
      --bg-glass: rgba(255,255,255,0.06);
      --border-subtle: rgba(255,255,255,0.08);
      --border-glow: rgba(6,182,212,0.4);
      --accent: #06b6d4;
      --accent-glow: rgba(6,182,212,0.3);
      --accent-secondary: #a78bfa;
      --text-primary: #e2e8f0;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --glass-blur: blur(16px);
      --radius: 8px;
    }
    body {
      font-family: var(--font-sans);
      background: var(--bg-deep);
      min-height: 100vh;
      color: var(--text-primary);
      overflow: hidden;
    }
    /* Noise overlay */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.02'/%3E%3C/svg%3E");
      pointer-events: none;
      z-index: 9999;
    }

    /* Layout: 3-column */
    .app {
      display: grid;
      grid-template-columns: 320px 1fr 360px;
      grid-template-rows: auto 1fr;
      height: 100vh;
      gap: 1px;
      background: var(--border-subtle);
    }

    /* Header */
    .header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1.5rem;
      background: var(--bg-deep);
      border-bottom: 1px solid var(--border-subtle);
    }
    .header-title {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-secondary);
      letter-spacing: 0.05em;
    }
    .header-title span { color: var(--accent); }
    #live-status {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--accent);
      letter-spacing: 0.03em;
    }
    #live-status::before {
      content: '';
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 6px var(--accent);
      animation: pulse 2s infinite;
    }
    #live-status.disconnected { color: #f87171; }
    #live-status.disconnected::before { background: #f87171; box-shadow: 0 0 6px #f87171; animation: none; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* Left sidebar */
    .left-sidebar {
      background: var(--bg-deep);
      padding: 1rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .left-sidebar-label {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 0 0.5rem;
      margin-bottom: 0.25rem;
    }
    .left-sidebar-stats {
      display: flex;
      gap: 0.75rem;
      padding: 0.5rem 0.6rem;
      margin-bottom: 0.5rem;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      background: var(--bg-glass);
      backdrop-filter: blur(12px);
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
    }
    .stat-value {
      font-family: var(--font-mono);
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .stat-value.accent { color: var(--accent); }
    .stat-value.green { color: #4ade80; }
    .stat-value.amber { color: #fbbf24; }
    .stat-value.red { color: #f87171; }
    .stat-label {
      font-family: var(--font-mono);
      font-size: 0.55rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    #diagram-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .diagram-btn {
      padding: 0.6rem 0.75rem;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--text-secondary);
      transition: all 0.15s;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      overflow: hidden;
    }
    .diagram-btn .btn-top {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      white-space: normal;
      word-wrap: break-word;
    }
    .diagram-btn .btn-marker { color: transparent; font-size: 0.6rem; flex-shrink: 0; margin-top: 0.15rem; }
    .diagram-btn .btn-label {
      word-wrap: break-word;
      overflow-wrap: break-word;
      white-space: normal;
      line-height: 1.4;
    }
    .diagram-btn .btn-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-left: 1.1rem;
    }
    .diagram-btn .btn-status-chip {
      font-size: 0.58rem;
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      background: rgba(255,255,255,0.06);
      color: var(--text-muted);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .diagram-btn .btn-status-chip.s-done { color: #4ade80; border-color: rgba(74,222,128,0.2); }
    .diagram-btn .btn-status-chip.s-in_progress { color: #fbbf24; border-color: rgba(251,191,36,0.2); }
    .diagram-btn .btn-status-chip.s-planned { color: #60a5fa; border-color: rgba(96,165,250,0.2); }
    .diagram-btn .btn-status-chip.s-proposed { color: #94a3b8; border-color: rgba(148,163,184,0.2); }
    .diagram-btn .btn-mini-bar {
      display: flex;
      height: 4px;
      border-radius: 2px;
      overflow: hidden;
      flex: 1;
      max-width: 80px;
      background: rgba(255,255,255,0.05);
    }
    .diagram-btn .mini-bar-fill {
      height: 100%;
      background: #4ade80;
      transition: width 0.3s;
    }
    .diagram-btn .btn-count {
      font-size: 0.55rem;
      color: var(--text-muted);
    }
    .diagram-btn:hover {
      background: var(--bg-glass);
      color: var(--text-primary);
    }
    .diagram-btn.active {
      background: var(--bg-glass);
      border-color: var(--border-glow);
      color: var(--accent);
      box-shadow: 0 0 12px var(--accent-glow), inset 0 0 12px rgba(6,182,212,0.05);
    }
    .diagram-btn.active .btn-marker { color: var(--accent); }
    .diagram-btn.active .btn-label { color: var(--accent); }

    /* Main diagram panel */
    .main-panel {
      background: var(--bg-deep);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      overflow: auto;
      position: relative;
      max-width: 100%;
    }
    #diagram-container {
      transition: box-shadow 0.4s;
      border-radius: var(--radius);
      padding: 1.5rem;
      max-width: 70%;
      width: 100%;
      max-width: 100%;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #diagram-container.glow {
      box-shadow: 0 0 30px var(--accent-glow), 0 0 60px rgba(6,182,212,0.1);
    }

    /* Diagram grid background */
    .main-panel::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
    }
    .main-panel::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, transparent 40%, var(--bg-deep) 100%);
      pointer-events: none;
    }

    /* Mermaid SVG global overrides */
    #diagram-container svg {
      max-width: 100%;
      height: auto;
      filter: drop-shadow(0 0 40px rgba(6,182,212,0.04));
    }

    /* Node shapes — frosted glass cards */
    #diagram-container svg g.node rect,
    #diagram-container svg g.node polygon,
    #diagram-container svg g.node circle {
      rx: 6;
      ry: 6;
      stroke-width: 1.2;
      transition: filter 0.2s, stroke 0.2s;
    }

    /* Node text — monospace */
    #diagram-container svg g.node .nodeLabel,
    #diagram-container svg g.node foreignObject div {
      font-family: 'JetBrains Mono', monospace !important;
      font-size: 12px !important;
      color: #e2e8f0 !important;
      fill: #e2e8f0 !important;
    }

    /* Edge paths — muted with subtle glow */
    #diagram-container svg .edgePath path.path {
      stroke: #334155 !important;
      stroke-width: 1.5 !important;
      filter: drop-shadow(0 0 2px rgba(51,65,85,0.5));
    }
    #diagram-container svg .edgePath defs marker path {
      fill: #475569 !important;
      stroke: #475569 !important;
    }

    /* Edge labels */
    #diagram-container svg .edgeLabel {
      font-family: 'JetBrains Mono', monospace !important;
      font-size: 11px !important;
      color: #94a3b8 !important;
      fill: #94a3b8 !important;
    }
    #diagram-container svg .edgeLabel rect {
      fill: rgba(10,14,23,0.9) !important;
      stroke: rgba(255,255,255,0.06) !important;
      rx: 4;
      ry: 4;
    }

    /* Cluster/subgraph */
    #diagram-container svg .cluster rect {
      fill: rgba(255,255,255,0.02) !important;
      stroke: rgba(255,255,255,0.06) !important;
      rx: 8;
      ry: 8;
    }
    #diagram-container svg .cluster .nodeLabel {
      font-family: 'JetBrains Mono', monospace !important;
      color: #64748b !important;
      fill: #64748b !important;
    }

    /* Status class overrides — luminous neon colors */
    #diagram-container svg g.node.done rect,
    #diagram-container svg g.node.done polygon {
      fill: rgba(34,197,94,0.12) !important;
      stroke: rgba(74,222,128,0.6) !important;
      filter: drop-shadow(0 0 6px rgba(74,222,128,0.25));
    }
    #diagram-container svg g.node.inProgress rect,
    #diagram-container svg g.node.inProgress polygon {
      fill: rgba(217,119,6,0.12) !important;
      stroke: rgba(251,191,36,0.6) !important;
      filter: drop-shadow(0 0 6px rgba(251,191,36,0.25));
      animation: inProgressPulse 3s ease-in-out infinite;
    }
    #diagram-container svg g.node.blocked rect,
    #diagram-container svg g.node.blocked polygon {
      fill: rgba(239,68,68,0.12) !important;
      stroke: rgba(248,113,113,0.6) !important;
      filter: drop-shadow(0 0 6px rgba(248,113,113,0.25));
    }
    #diagram-container svg g.node.backlog rect,
    #diagram-container svg g.node.backlog polygon {
      fill: rgba(100,116,139,0.1) !important;
      stroke: rgba(100,116,139,0.4) !important;
    }

    /* In-progress pulse animation */
    @keyframes inProgressPulse {
      0%, 100% { filter: drop-shadow(0 0 6px rgba(251,191,36,0.25)); }
      50% { filter: drop-shadow(0 0 12px rgba(251,191,36,0.45)); }
    }

    /* Mermaid node hover glow */
    #diagram-container svg g.node:hover rect,
    #diagram-container svg g.node:hover polygon,
    #diagram-container svg g.node:hover circle {
      filter: drop-shadow(0 0 10px var(--accent-glow));
      stroke: var(--accent) !important;
    }

    /* Right sidebar */
    .right-sidebar {
      background: var(--bg-deep);
      padding: 1.25rem 1rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      border-left: 1px solid var(--border-subtle);
    }
    .glass-card {
      background: var(--bg-glass);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 1rem;
    }
    .section-header {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--text-muted);
      letter-spacing: 0.08em;
      margin-bottom: 0.6rem;
    }

    /* Plan info card */
    #plan-title {
      font-family: var(--font-sans);
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.3;
    }
    #plan-summary {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.3rem;
      line-height: 1.4;
    }

    /* Status badge - TUI style */
    .status-badge {
      display: inline-block;
      padding: 0.1rem 0.5rem;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 0.65rem;
      font-weight: 500;
      margin-top: 0.5rem;
    }
    .status-proposed { background: rgba(100,116,139,0.2); color: #94a3b8; border: 1px solid rgba(100,116,139,0.3); }
    .status-planned { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
    .status-in_progress { background: rgba(217,119,6,0.15); color: #fbbf24; border: 1px solid rgba(217,119,6,0.3); }
    .status-done { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
    .status-blocked { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
    .status-archived { background: rgba(100,116,139,0.15); color: #64748b; border: 1px solid rgba(100,116,139,0.2); }

    /* Progress - TUI block chars */
    #progress-section {
      display: none;
      margin-top: 0.75rem;
    }
    #progress-text {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--accent);
      letter-spacing: 0.02em;
    }
    .progress-bar-track {
      width: 100%;
      height: 3px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 0.4rem;
    }
    #progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), #22d3ee);
      box-shadow: 0 0 8px var(--accent-glow);
      border-radius: 2px;
      transition: width 0.4s ease;
      width: 0%;
    }

    /* Timestamp */
    #metadata {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    /* Divider */
    .tui-divider {
      font-family: var(--font-mono);
      font-size: 0.6rem;
      color: var(--border-subtle);
      text-align: center;
      overflow: hidden;
      user-select: none;
    }

    /* Legend */
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-family: var(--font-mono);
      font-size: 0.62rem;
      color: var(--text-muted);
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .legend-dot.done { background: #4ade80; box-shadow: 0 0 4px rgba(74,222,128,0.4); }
    .legend-dot.in-progress { background: #fbbf24; box-shadow: 0 0 4px rgba(251,191,36,0.4); }
    .legend-dot.blocked { background: #f87171; box-shadow: 0 0 4px rgba(248,113,113,0.4); }
    .legend-dot.backlog { background: #64748b; }

    /* Ready callout */
    #ready-callout {
      display: none;
    }
    .ready-item {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--accent);
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .ready-item:last-child { border-bottom: none; }

    /* Node detail in right sidebar */
    #node-detail-section {
      display: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.2s, transform 0.2s;
    }
    #node-detail-section.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .node-detail-id {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--accent-secondary);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.3rem;
    }
    .node-detail-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.4rem;
    }
    .node-detail-field {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--text-secondary);
      margin-top: 0.3rem;
      display: flex;
      gap: 0.5rem;
    }
    .field-key {
      color: var(--text-muted);
      min-width: 50px;
    }
    .field-val { color: var(--text-primary); }
    .node-detail-field code {
      background: rgba(255,255,255,0.06);
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-size: 0.65rem;
      color: var(--accent);
    }
    .dismiss-btn {
      margin-top: 0.75rem;
      background: none;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 0.6rem;
      padding: 0.25rem 0.6rem;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .dismiss-btn:hover { color: var(--text-primary); border-color: var(--accent); }

    .empty-state {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 0.8rem;
      text-align: center;
      line-height: 1.6;
    }
    .raw-source {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-secondary);
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .error-panel {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: var(--radius);
      color: #f87171;
      font-family: var(--font-mono);
      font-size: 0.75rem;
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

    /* Fade-in animation */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .glass-card { animation: fadeIn 0.3s ease both; }
    .glass-card:nth-child(2) { animation-delay: 0.05s; }
    .glass-card:nth-child(3) { animation-delay: 0.1s; }
    .glass-card:nth-child(4) { animation-delay: 0.15s; }
    .glass-card:nth-child(5) { animation-delay: 0.2s; }
  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <div class="header-title"><span>\u2554\u2550\u2550\u2550</span> SPOC Diagram Preview <span>\u2550\u2550\u2550\u2557</span></div>
      <span id="live-status">CONNECTED</span>
    </div>
    <div class="left-sidebar">
      <div class="left-sidebar-label">\u250C\u2500 Plans \u2500\u2510</div>
      <div class="left-sidebar-stats"></div>
      <div id="diagram-list"></div>
    </div>
    <div class="main-panel">
      <div id="diagram-container">
        <p class="empty-state">Loading...</p>
      </div>
    </div>
    <div class="right-sidebar">
      <div class="glass-card">
        <div class="section-header">\u250C\u2500 Plan Info \u2500\u2510</div>
        <div id="plan-title"></div>
        <span id="plan-status-badge" class="status-badge" style="display:none"></span>
        <div id="plan-summary"></div>
        <div id="progress-section">
          <div id="progress-text"></div>
          <div class="progress-bar-track"><div id="progress-bar"></div></div>
        </div>
        <div id="metadata"></div>
      </div>
      <div class="glass-card">
        <div class="section-header">\u250C\u2500 Legend \u2500\u2510</div>
        <div class="legend">
          <div class="legend-item"><span class="legend-dot done"></span>done</div>
          <div class="legend-item"><span class="legend-dot in-progress"></span>in_progress</div>
          <div class="legend-item"><span class="legend-dot blocked"></span>blocked</div>
          <div class="legend-item"><span class="legend-dot backlog"></span>backlog</div>
        </div>
      </div>
      <div class="glass-card">
        <div class="section-header">\u250C\u2500 Ready Next \u2500\u2510</div>
        <div id="ready-callout"></div>
      </div>
      <div class="glass-card" id="node-detail-section"></div>
    </div>
  </div>
</body>
</html>`;
}
