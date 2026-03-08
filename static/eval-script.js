/* ────────────────────────────────────────────────────────────────────────────
   Local AI Eval Dashboard — eval-script.js
   Supports any model available in a locally running Ollama instance.
   ──────────────────────────────────────────────────────────────────────────── */

// ── State ────────────────────────────────────────────────────────────────────
let currentResults = {};
let chatHistory = [];
let progressTimer = null;

// ── Plotly theme helper — light palette matching style.css ────────────────────
function plotlyLayout(extras = {}) {
  // style.css is a light-first design system; always use its palette
  const bg = '#ffffff';           // --color-white
  const fg = '#2a3f54';           // --color-primary
  const grid = '#e0e0e0';           // --color-border
  return Object.assign({
    paper_bgcolor: bg,
    plot_bgcolor: bg,
    font: { color: fg, family: 'Roboto, sans-serif', size: 12 },
    margin: { t: 20, r: 10, b: 40, l: 50 },
    xaxis: { gridcolor: grid, zerolinecolor: grid },
    yaxis: { gridcolor: grid, zerolinecolor: grid },
    autosize: true,
  }, extras);
}

const PLOTLY_CONFIG = { responsive: true, displaylogo: false };

// ── Theme toggle ─────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('eval-theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    document.getElementById('theme-toggle').textContent = '☀️';
  }
})();

document.getElementById('theme-toggle').addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('theme-toggle').textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('eval-theme', isLight ? 'light' : 'dark');
  if (Object.keys(currentResults).length) renderDashboard();
});

// ── Model list ────────────────────────────────────────────────────────────────
async function loadModels() {
  const sel = document.getElementById('model-select');
  try {
    const resp = await fetch('/api/models');
    const data = await resp.json();

    if (data.error || !data.models || data.models.length === 0) {
      sel.innerHTML = '<option value="">⚠️ No models found — is Ollama running?</option>';
      return;
    }

    // Restore previously selected model if still available
    const saved = localStorage.getItem('eval-model') || '';
    sel.innerHTML = '';
    data.models.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === saved) opt.selected = true;
      sel.appendChild(opt);
    });

    // If nothing was restored, default to the first entry
    if (!sel.value && sel.options.length) sel.options[0].selected = true;

  } catch (_) {
    sel.innerHTML = '<option value="">⚠️ Could not reach Ollama</option>';
  }

  // Persist selection across page loads
  sel.addEventListener('change', () => localStorage.setItem('eval-model', sel.value));
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function startProgress(duration = 8000) {
  const section = document.getElementById('progress-section');
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  section.classList.add('visible');
  bar.style.width = '0%';

  const steps = [
    [10, 'Loading model weights…'],
    [30, 'Running benchmark tasks…'],
    [55, 'Scoring responses…'],
    [75, 'Computing metrics…'],
    [90, 'Aggregating results…'],
  ];
  let stepIdx = 0;
  const interval = duration / (steps.length + 2);

  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (stepIdx < steps.length) {
      bar.style.width = steps[stepIdx][0] + '%';
      label.textContent = steps[stepIdx][1];
      stepIdx++;
    }
  }, interval);
}

function finishProgress() {
  clearInterval(progressTimer);
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  bar.style.width = '100%';
  label.textContent = '✓ Evaluation complete';
  setTimeout(() => {
    document.getElementById('progress-section').classList.remove('visible');
    bar.style.width = '0%';
  }, 1200);
}

// ── Run eval ─────────────────────────────────────────────────────────────────
async function runEval() {
  const model = document.getElementById('model-select').value;
  const benchmark = document.getElementById('benchmark-select').value;
  const btn = document.getElementById('btn-run-eval');

  if (!model) {
    showToast('Please select a model first.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Running…';
  startProgress();

  try {
    const resp = await fetch('/api/run-eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, benchmark }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    currentResults = await resp.json();

    finishProgress();
    renderDashboard();
    refreshRunList();
    setRunBadge(currentResults._filename || '');
    updateChatStatus();

  } catch (e) {
    finishProgress();
    showToast('Eval failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Run Eval';
  }
}

// ── Load latest ───────────────────────────────────────────────────────────────
async function loadLatest() {
  try {
    const resp = await fetch('/api/results');
    if (!resp.ok) throw new Error('No results yet');
    currentResults = await resp.json();
    if (currentResults && currentResults.metrics) {
      renderDashboard();
      setRunBadge(currentResults._filename || '');
      updateChatStatus();
    }
  } catch (e) {
    showToast('No results found — run an eval first.', 'info');
  }
}

// ── Save / load runs ─────────────────────────────────────────────────────────
async function saveRun() {
  if (!currentResults || !currentResults.metrics) {
    showToast('Nothing to save — run an eval first.', 'info');
    return;
  }
  try {
    const resp = await fetch('/api/save-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentResults),
    });
    const data = await resp.json();
    await refreshRunList();
    showToast(`Saved as ${data.filename}`, 'success');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

async function refreshRunList() {
  try {
    const resp = await fetch('/api/load-runs');
    const files = await resp.json();
    const sel = document.getElementById('load-run-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">— Load run —</option>';
    sel.innerHTML = '<option value="">— Load saved run —</option>';
    files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      const match = f.match(/results_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
      opt.textContent = match
        ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
        : f;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  } catch (_) { }
}

async function loadSelectedRun() {
  const filename = document.getElementById('load-run-select').value;
  if (!filename) return;
  try {
    const resp = await fetch(`/api/load-run/${filename}`);
    if (!resp.ok) throw new Error('Not found');
    currentResults = await resp.json();
    renderDashboard();
    setRunBadge(filename);
    updateChatStatus();
  } catch (e) {
    showToast('Could not load run: ' + e.message, 'error');
  }
}

function setRunBadge(filename) {
  const badge = document.getElementById('run-badge');
  if (filename) {
    badge.textContent = `📄 ${filename}`;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ── Render dashboard ─────────────────────────────────────────────────────────
function renderDashboard() {
  if (!currentResults || !currentResults.metrics) return;

  const { summary, metrics, model } = currentResults;

  // Summary cards
  document.getElementById('pass1-score').textContent = summary.avg_pass1 ?? '--';
  document.getElementById('latency-score').textContent = summary.avg_latency ? `${summary.avg_latency}ms` : '--';
  document.getElementById('tasks-score').textContent = summary.total_tasks ?? '--';
  document.getElementById('model-score').textContent = model ?? '--';

  const labels = Object.keys(metrics);
  const pass1Data = labels.map(k => metrics[k]['pass@1']);
  const latencies = labels.map(k => metrics[k].latency_ms);
  const tokens = labels.map(k => metrics[k].tokens);

  // Derive categories from label prefix (e.g. "math_GSM8K" → "math")
  const catMap = {};
  labels.forEach(k => {
    const cat = k.split('_')[0];
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(metrics[k]['pass@1']);
  });
  const catLabels = Object.keys(catMap);
  const catAvgs = catLabels.map(c => {
    const vals = catMap[c];
    return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3);
  });

  renderHeatmap(labels, pass1Data, model);
  renderRadar(catLabels, catAvgs, model);
  renderBar(labels, pass1Data);
  renderScatter(tokens, latencies, labels);
}

// ─── Heatmap ────────────────────────────────────────────────────────────────
function renderHeatmap(labels, pass1Data, model) {
  const trace = {
    z: [pass1Data],
    x: labels,
    y: [model || 'model'],
    type: 'heatmap',
    colorscale: [
      [0, '#1a1a2e'],
      [0.4, '#00868a'],
      [1, '#00d4aa'],
    ],
    showscale: true,
    zmin: 0, zmax: 1,
    hovertemplate: '%{x}<br>Pass@1: %{z:.3f}<extra></extra>',
  };
  Plotly.react('heatmap-chart', [trace], plotlyLayout({
    margin: { t: 20, r: 60, b: 90, l: 60 },
    xaxis: { tickangle: -35 },
  }), PLOTLY_CONFIG);
}

// ─── Radar ──────────────────────────────────────────────────────────────────
function renderRadar(cats, avgs, model) {
  const thetaClosed = [...cats, cats[0]];
  const rClosed = [...avgs, avgs[0]];

  const trace = {
    type: 'scatterpolar',
    r: rClosed,
    theta: thetaClosed,
    fill: 'toself',
    name: model || 'Model',
    line: { color: '#7c3aed', width: 2 },
    fillcolor: 'rgba(124,58,237,0.2)',
    hovertemplate: '%{theta}: %{r:.3f}<extra></extra>',
  };
  Plotly.react('radar-chart', [trace], plotlyLayout({
    polar: {
      radialaxis: { visible: true, range: [0, 1], tickfont: { size: 10 } },
      angularaxis: { tickfont: { size: 11 } },
      bgcolor: 'rgba(0,0,0,0)',
    },
    showlegend: false,
    margin: { t: 20, r: 40, b: 20, l: 40 },
  }), PLOTLY_CONFIG);
}

// ─── Bar ────────────────────────────────────────────────────────────────────
function renderBar(labels, pass1Data) {
  const colors = pass1Data.map(v =>
    v >= 0.85 ? '#00d4aa' : v >= 0.75 ? '#7c3aed' : '#ff6b6b'
  );
  Plotly.react('pass1-chart', [{
    x: labels, y: pass1Data,
    type: 'bar',
    marker: { color: colors, line: { color: 'rgba(0,0,0,0.2)', width: 1 } },
    hovertemplate: '%{x}<br>Pass@1: %{y:.3f}<extra></extra>',
  }], plotlyLayout({
    yaxis: { range: [0, 1], title: 'Pass@1' },
    xaxis: { tickangle: -30 },
    margin: { t: 20, r: 10, b: 80, l: 50 },
  }), PLOTLY_CONFIG);
}

// ─── Scatter ─────────────────────────────────────────────────────────────────
function renderScatter(tokens, latencies, labels) {
  Plotly.react('latency-chart', [{
    x: tokens, y: latencies,
    mode: 'markers+text',
    type: 'scatter',
    text: labels.map(l => l.split('_')[1] || l),
    textposition: 'top center',
    textfont: { size: 9 },
    marker: {
      color: latencies,
      colorscale: 'Viridis',
      size: 10,
      line: { color: 'rgba(255,255,255,0.3)', width: 1 },
      showscale: true,
    },
    hovertemplate: '%{text}<br>Tokens: %{x}<br>Latency: %{y:.2f}ms<extra></extra>',
  }], plotlyLayout({
    xaxis: { title: 'Tokens' },
    yaxis: { title: 'Latency (ms)' },
    margin: { t: 20, r: 80, b: 50, l: 60 },
  }), PLOTLY_CONFIG);
}

// ── Export PDF (opens styled print window) ───────────────────────────────────
async function exportPDF() {
  if (!currentResults || !currentResults.metrics) {
    showToast('Run an eval first before exporting.', 'info');
    return;
  }
  const btn = document.getElementById('btn-export');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  try {
    const chartIds = [
      { id: 'heatmap-chart', title: 'Pass@1 Heatmap' },
      { id: 'radar-chart', title: 'Category Radar' },
      { id: 'pass1-chart', title: 'Pass@1 by Benchmark' },
      { id: 'latency-chart', title: 'Latency vs Tokens' },
    ];
    const images = await Promise.all(
      chartIds.map(({ id }) => Plotly.toImage(id, { format: 'png', width: 900, height: 420 }))
    );
    const { model, summary, metrics } = currentResults;
    const ts = new Date().toLocaleString();
    const metricRows = Object.entries(metrics || {}).map(([task, m]) =>
      `<tr><td>${task}</td><td>${m['pass@1'] ?? '--'}</td><td>${m.latency_ms ?? '--'} ms</td><td>${m.tokens ?? '--'}</td></tr>`
    ).join('');
    const chartSections = chartIds.map((c, i) =>
      `<section class="chart"><h2>${c.title}</h2><img src="${images[i]}" alt="${c.title}" /></section>`
    ).join('');
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>Eval Report — ${model}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:32px}
h1{font-size:1.8rem;margin-bottom:4px;color:#0f172a}
.meta{font-size:.85rem;color:#64748b;margin-bottom:24px}
h2{font-size:1.1rem;margin:20px 0 10px;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:.9rem}
th,td{text-align:left;padding:8px 12px;border:1px solid #e2e8f0}
th{background:#f8fafc;font-weight:600}
td:nth-child(n+2){text-align:center}
.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
.summary-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}
.summary-card .val{font-size:2rem;font-weight:700;color:#7c3aed}
.summary-card .lbl{font-size:.78rem;color:#64748b;margin-top:4px}
section.chart{margin-bottom:32px}
section.chart img{width:100%;border:1px solid #e2e8f0;border-radius:8px}
@media print{section.chart{page-break-inside:avoid}.no-print{display:none}}
button{padding:8px 18px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:.9rem;cursor:pointer;margin-bottom:20px}
button:hover{background:#6d28d9}
</style></head><body>
<div class="no-print"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
<h1>📊 Eval Report — ${model}</h1>
<div class="meta">Generated: ${ts}</div>
<div class="summary-grid">
  <div class="summary-card"><div class="val">${summary?.avg_pass1 ?? '--'}</div><div class="lbl">Avg Pass@1</div></div>
  <div class="summary-card"><div class="val">${summary?.avg_latency ?? '--'} ms</div><div class="lbl">Avg Latency</div></div>
  <div class="summary-card"><div class="val">${summary?.total_tasks ?? '--'}</div><div class="lbl">Total Tasks</div></div>
</div>
<h2>Per-Task Results</h2>
<table><thead><tr><th>Task</th><th>Pass@1</th><th>Latency</th><th>Tokens</th></tr></thead><tbody>${metricRows}</tbody></table>
${chartSections}
</body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  } catch (e) {
    showToast('PDF export failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↓ Export PDF';
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function updateChatStatus() {
  const el = document.getElementById('chat-status');
  if (currentResults && currentResults.model) {
    el.className = 'chat-status online';
    el.textContent = `Context: ${currentResults.model}`;
  } else {
    el.className = 'chat-status';
    el.textContent = 'Ask about your results';
  }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('btn-send');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  btn.disabled = true;

  appendMsg(text, 'user');

  const empty = document.querySelector('.chat-empty');
  if (empty) empty.remove();

  const typingEl = appendTyping();

  try {
    // Use the currently selected model for chat too
    const chatModel = document.getElementById('model-select').value
      || currentResults.model
      || '';

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        model: chatModel,
        history: chatHistory,
        context: currentResults,
      }),
    });
    const data = await resp.json();
    const reply = data.reply || '(empty response)';

    typingEl.remove();
    appendMsg(reply, 'ai', chatModel);

    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

  } catch (e) {
    typingEl.remove();
    appendMsg('❌ Could not reach server: ' + e.message, 'ai');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

// ── Simple markdown renderer ────────────────────────────────────────────────
function renderMarkdown(text) {
  let html = text
    // Escape HTML entities first
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Fenced code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers h2 / h3
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Tables (basic: | col | col |)
    .replace(/((?:^\|.+\|\r?\n)+)/gm, (block) => {
      const rows = block.trim().split('\n').filter(r => !/^\|[-| :]+\|/.test(r) && r.trim());
      const isHeader = true;
      return '<table>' + rows.map((r, i) => {
        const cells = r.split('|').slice(1, -1).map(c => c.trim());
        const tag = i === 0 ? 'th' : 'td';
        return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
      }).join('') + '</table>';
    })
    // Bullet lists
    .replace(/((?:^[ \t]*[-*] .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*[-*] /, '')}</li>`);
      return '<ul>' + items.join('') + '</ul>';
    })
    // Numbered lists
    .replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*\d+\. /, '')}</li>`);
      return '<ol>' + items.join('') + '</ol>';
    })
    // Paragraphs (wrap bare lines)
    .replace(/^(?!<[a-z]).+$/gm, '<p>$&</p>')
    // Clean double blank lines
    .replace(/\n{2,}/g, '\n');
  return html;
}

function appendMsg(text, role, modelName) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.classList.add('msg', role === 'user' ? 'msg-user' : 'msg-ai');

  const label = document.createElement('div');
  label.className = 'msg-label';
  // Show the actual model name for AI messages instead of hard-coding "Llama3"
  label.textContent = role === 'user'
    ? 'You'
    : `� ${modelName || currentResults.model || 'AI'}`;

  const body = document.createElement('div');
  body.className = 'msg-body';
  if (role === 'ai') {
    body.innerHTML = renderMarkdown(text);
  } else {
    body.textContent = text;
  }

  div.appendChild(label);
  div.appendChild(body);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function appendTyping() {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.classList.add('msg', 'msg-ai', 'msg-typing');
  div.innerHTML = '<span></span><span></span><span></span>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function clearChat() {
  chatHistory = [];
  const box = document.getElementById('chat-messages');
  box.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-icon">💬</div>
      Chat cleared. Run an eval then ask me anything!<br/>
      <em style="font-size:11px;opacity:0.7;">Requires Ollama running locally</em>
    </div>`;
  updateChatStatus();
}

// ── Toast notification ────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const colors = { success: '#00d4aa', error: '#ef4444', info: '#7c3aed' };
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '1.5rem',
    left: '50%',
    transform: 'translateX(-50%)',
    background: colors[type] || colors.info,
    color: '#fff',
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    zIndex: '9999',
    animation: 'msgIn 0.2s ease',
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadModels();   // populate model dropdown from Ollama first
  loadLatest();
  refreshRunList();
  updateChatStatus();
});
