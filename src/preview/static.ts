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
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

    let currentSource = null;
    let currentPlanId = null;

    async function loadDiagrams() {
      const res = await fetch('/diagrams');
      const data = await res.json();
      const list = document.getElementById('diagram-list');
      list.innerHTML = '';
      for (const d of data.diagrams) {
        const btn = document.createElement('button');
        btn.textContent = d.planId;
        btn.className = 'diagram-btn';
        btn.onclick = () => selectDiagram(d.planId);
        list.appendChild(btn);
      }
      if (data.diagrams.length > 0) {
        selectDiagram(data.diagrams[0].planId);
      } else {
        document.getElementById('diagram-container').innerHTML =
          '<p class="empty-state">No diagrams found. Create a .diagram.mmd file in your plans directory.</p>';
      }
    }

    let eventSource = null;

    async function selectDiagram(planId) {
      if (eventSource) { eventSource.close(); eventSource = null; }
      currentPlanId = planId;

      // Highlight active button
      document.querySelectorAll('.diagram-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.diagram-btn').forEach(b => {
        if (b.textContent === planId) b.classList.add('active');
      });

      const res = await fetch('/diagram/' + planId);
      const data = await res.json();
      renderDiagram(data.content, data.updatedAt);

      // Subscribe to SSE
      eventSource = new EventSource('/events/' + planId);
      eventSource.onmessage = (e) => {
        const payload = JSON.parse(e.data);
        renderDiagram(payload.content, payload.updatedAt);
        pulseGlow();
      };
      eventSource.onerror = () => {
        document.getElementById('live-status').classList.add('disconnected');
      };
      document.getElementById('live-status').classList.remove('disconnected');
    }

    async function renderDiagram(source, updatedAt) {
      currentSource = source;
      const container = document.getElementById('diagram-container');
      const meta = document.getElementById('metadata');
      meta.textContent = 'Updated: ' + new Date(updatedAt).toLocaleString();

      try {
        const { svg } = await mermaid.render('mermaid-svg', source);
        container.innerHTML = svg;
        container.classList.remove('error');
      } catch (err) {
        container.innerHTML = '<pre class="raw-source">' + escapeHtml(source) + '</pre>' +
          '<div class="error-panel">Render error: ' + escapeHtml(err.message || String(err)) + '</div>';
        container.classList.add('error');
      }
    }

    function pulseGlow() {
      const el = document.getElementById('diagram-container');
      el.classList.add('glow');
      setTimeout(() => el.classList.remove('glow'), 600);
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    loadDiagrams();
  </script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
      min-height: 100vh;
      padding: 2rem;
      color: #2d3748;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; }
    #live-status {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      background: #c6f6d5;
      color: #276749;
      font-size: 0.75rem;
      font-weight: 500;
    }
    #live-status::before {
      content: '';
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #38a169;
      animation: pulse 1.5s infinite;
    }
    #live-status.disconnected { background: #fed7d7; color: #9b2c2c; }
    #live-status.disconnected::before { background: #e53e3e; animation: none; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .layout {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 1.5rem;
    }
    #diagram-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .diagram-btn {
      padding: 0.5rem 1rem;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: white;
      cursor: pointer;
      text-align: left;
      font-size: 0.875rem;
      transition: all 0.15s;
    }
    .diagram-btn:hover { border-color: #4299e1; }
    .diagram-btn.active { background: #ebf8ff; border-color: #4299e1; font-weight: 500; }
    .main-panel {
      background: white;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      min-height: 400px;
    }
    #diagram-container {
      transition: box-shadow 0.3s;
      border-radius: 8px;
      padding: 1rem;
    }
    #diagram-container.glow {
      box-shadow: 0 0 20px rgba(66, 153, 225, 0.4);
    }
    #diagram-container svg { max-width: 100%; height: auto; }
    #metadata {
      margin-top: 1rem;
      font-size: 0.75rem;
      color: #718096;
    }
    .empty-state { color: #a0aec0; font-style: italic; padding: 2rem; text-align: center; }
    .raw-source {
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 1rem;
      font-size: 0.8rem;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .error-panel {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background: #fff5f5;
      border: 1px solid #fed7d7;
      border-radius: 8px;
      color: #c53030;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>SPOC Diagram Preview</h1>
    <span id="live-status">Live</span>
  </div>
  <div class="layout">
    <div id="diagram-list"></div>
    <div class="main-panel">
      <div id="diagram-container">
        <p class="empty-state">Loading...</p>
      </div>
      <div id="metadata"></div>
    </div>
  </div>
</body>
</html>`;
}
