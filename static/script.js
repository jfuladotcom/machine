// script.js - Refactored for stability and dynamic navigation
let rawData = [];
let filteredData = [];
let filters = {};
let filterMeta = {};
let dataKey = "";

// Element definitions with null safety in mind
const getEl = (id) => document.getElementById(id);

// Sidebar Toggle & Global Navigation helper
function setupSidebarEvents() {
    const sideNav = getEl('sideNav');
    const navToggle = getEl('navToggle');

    if (navToggle && sideNav) {
        navToggle.onclick = () => {
            const isCollapsed = sideNav.classList.toggle('collapsed');
            document.body.classList.toggle('side-nav-collapsed', isCollapsed);
            localStorage.setItem('sideNavCollapsed', isCollapsed);
            if (typeof resizeCharts === 'function') setTimeout(resizeCharts, 305);
        };

        // Restore state
        if (localStorage.getItem('sideNavCollapsed') === 'true') {
            sideNav.classList.add('collapsed');
            document.body.classList.add('side-nav-collapsed');
        }
    }
}

// Initial setup for pages that might have hardcoded nav
setupSidebarEvents();

// // Navigation Fetch
// fetch('/nav')
//     .then(response => {
//         if (!response.ok) throw new Error("Navigation endpoint not responding");
//         return response.text();
//     })
//     .then(data => {
//         const sideNav = getEl('sideNav');
//         if (sideNav) {
//             sideNav.innerHTML = data;
//             setupSidebarEvents(); // Re-bind events to new DOM elements
//         }
//     })
//     .catch(err => console.error("Navigation Load Error:", err));


// Panel toggles (Insights/Knowledge pages)
const leftInfoPanel = getEl('leftInfoPanel');
const rightPanel = getEl('rightPanel');
const infoToggleBtn = getEl('infoToggleBtn');
const aiToggleBtn = getEl('aiToggleBtn');
const closeLeftPan = getEl('closeLeftPan');
const closeRightPan = getEl('closeRightPan');

if (leftInfoPanel) leftInfoPanel.classList.add('active');
if (rightPanel) rightPanel.classList.add('active');
if (infoToggleBtn) infoToggleBtn.setAttribute('aria-expanded', true);
if (aiToggleBtn) aiToggleBtn.setAttribute('aria-expanded', true);

if (infoToggleBtn && leftInfoPanel) {
    infoToggleBtn.onclick = () => {
        const expanded = leftInfoPanel.classList.toggle('active');
        infoToggleBtn.setAttribute('aria-expanded', expanded);
        infoToggleBtn.innerHTML = expanded ? '&#171;' : '&#187;';
        if (closeLeftPan) closeLeftPan.style.display = expanded ? "block" : "none";
        if (typeof resizeCharts === 'function') resizeCharts();
    };
}

if (aiToggleBtn && rightPanel) {
    aiToggleBtn.onclick = () => {
        const expanded = rightPanel.classList.toggle('active');
        aiToggleBtn.setAttribute('aria-expanded', expanded);
        aiToggleBtn.innerHTML = expanded ? '&#187;' : '&#171;';
        if (closeRightPan) closeRightPan.style.display = expanded ? "block" : "none";
        if (typeof resizeCharts === 'function') resizeCharts();
    };
}

// Responsive Resizing Logic
function resizeCharts() {
    if (typeof applyFilters === 'function') applyFilters();
}

window.addEventListener('resize', resizeCharts);

if (leftInfoPanel) {
    leftInfoPanel.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'width' || e.propertyName === 'flex-basis') resizeCharts();
    });
}
if (rightPanel) {
    rightPanel.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'width' || e.propertyName === 'flex-basis') resizeCharts();
    });
}

// Data Handling Logic
const csvFileInput = getEl('csvFile');
const fileUploadText = getEl('fileUploadText');
const uploadStatus = getEl('uploadStatus');
const overlay = getEl('overlay');

if (csvFileInput) {
    csvFileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        if (fileUploadText) fileUploadText.textContent = file.name;
        const formData = new FormData();
        formData.append('file', file);

        if (uploadStatus) uploadStatus.textContent = "Uploading...";
        fetch('/upload-file', { method: 'POST', body: formData })
            .then(resp => resp.json())
            .then(res => {
                if (res.uploaded && res.uploaded.length) {
                    const f = res.uploaded[0];
                    dataKey = 'global';
                    handleSuccessfulDataLoad('global', f.filename);
                    if (typeof fmRefresh === 'function') fmRefresh();
                } else {
                    const errMsg = (res.errors || []).join('; ') || 'Upload failed.';
                    if (uploadStatus) uploadStatus.textContent = errMsg;
                }
            })
            .catch(() => {
                if (uploadStatus) uploadStatus.textContent = "Upload failed.";
            });
    });
}

function handleSuccessfulDataLoad(key, filename) {
    dataKey = key;
    if (fileUploadText) fileUploadText.textContent = filename;
    if (uploadStatus) uploadStatus.textContent = "";
    if (overlay) {
        overlay.style.width = '200px';
        overlay.style.height = '100px';
        overlay.style.top = '-18px';
        overlay.style.left = '45%';
        overlay.style.background = 'rgba(0,0,0,0)';
    }
    fetchDataAndRenderCharts(dataKey);
    fetchAiInsight(dataKey);
}

async function checkGlobalData() {
    try {
        const resp = await fetch('/get-global-data-status');
        const data = await resp.json();
        if (data.has_data) {
            handleSuccessfulDataLoad("global", data.filename);
        }
    } catch (err) {
        console.error("Global data check failed:", err);
    }
}

window.addEventListener('load', checkGlobalData);
window.addEventListener('fm:filesChanged', checkGlobalData);

function fetchAiInsight(key) {
    const insightDiv = getEl('insight');
    if (insightDiv) insightDiv.textContent = "Analyzing data and generating insights...";

    fetch('/ai_prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: "Please provide a concise summary and key insights about this dataset.",
            key: key
        })
    })
        .then(resp => resp.json())
        .then(res => {
            const insightDiv = getEl('insight');
            if (insightDiv) insightDiv.innerHTML = res.response || "No insight generated.";
        })
        .catch(() => {
            const insightDiv = getEl('insight');
            if (insightDiv) insightDiv.textContent = "Failed to get AI insight.";
        });
}

function fetchDataAndRenderCharts(key) {
    const url = key === "global" ? '/get-global-csv' : `/get-csv-data?key=${encodeURIComponent(key)}`;
    fetch(url)
        .then(async resp => {
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`Server error (${resp.status}): ${text}`);
            }
            return resp.text();
        })
        .then(csvText => {
            if (typeof d3 === 'undefined') return;
            const data = d3.csvParse(csvText);
            if (Array.isArray(data) && data.length) {
                rawData = data;
                try {
                    setupFilters(rawData);
                    applyFilters();
                } catch (e) {
                    console.error("Filter/Graph Render Error:", e);
                }
            } else {
                if (uploadStatus) uploadStatus.textContent = "CSV data error: Data is empty or invalid format.";
            }
        })
        .catch(e => {
            console.error("Load Data Error:", e);
            if (uploadStatus) uploadStatus.textContent = "Error loading data: " + e.message;
        });
}

function setupFilters(data) {
    filterMeta = {};
    filters = {};
    if (!data.length) return;
    const columns = Object.keys(data[0]);
    columns.forEach(field => {
        const vals = Array.from(new Set(data.map(d => d[field])));
        filterMeta[field] = vals;
        filters[field] = [...vals];
    });
    renderFilterControls();
}

function renderFilterControls() {
    const container = getEl('filterControls');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(filterMeta).forEach(field => {
        const checkboxes = filterMeta[field].map(opt => {
            const checked = filters[field].includes(opt) ? 'checked' : '';
            const checkboxId = `chk_${field.replace(/\s/g, '_')}_${String(opt).replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '')}`;
            return `<label><input type="checkbox" id="${checkboxId}" value="${opt}" ${checked}>${opt}</label>`;
        }).join('');
        const html = `
          <div class="filter-group" data-field="${field}">
            <div class="filter-title" tabindex="0">${field}</div>
            <div class="filter-group-controls">
                <button type="button" class="select-all-btn">Select All</button>
                <button type="button" class="deselect-all-btn">Deselect All</button>
            </div>
            <div class="filter-checkbox-list" id="chklist_${field.replace(/\s/g, '_')}">
              ${checkboxes}
            </div>
          </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        setTimeout(() => {
            const groupDiv = container.querySelector(`.filter-group[data-field="${field}"]`);
            const titleDiv = groupDiv.querySelector('.filter-title');
            if (titleDiv) {
                titleDiv.onclick = () => groupDiv.classList.toggle('collapsed');
                titleDiv.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        groupDiv.classList.toggle('collapsed');
                    }
                };
            }
            const listDiv = getEl(`chklist_${field.replace(/\s/g, '_')}`);
            if (listDiv) {
                listDiv.querySelectorAll('input[type=checkbox]').forEach(box => {
                    box.onchange = () => {
                        filters[field] = Array.from(listDiv.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
                        applyFilters();
                    };
                });
                const selAll = groupDiv.querySelector('.select-all-btn');
                const dselAll = groupDiv.querySelector('.deselect-all-btn');
                if (selAll) selAll.onclick = () => {
                    listDiv.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
                    filters[field] = filterMeta[field].slice();
                    applyFilters();
                };
                if (dselAll) dselAll.onclick = () => {
                    listDiv.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
                    filters[field] = [];
                    applyFilters();
                };
            }
        }, 0);
    });
}

const toggleAllBtn = getEl('toggleAllFilters');
if (toggleAllBtn) {
    toggleAllBtn.textContent = 'Collapse All Filters';
    toggleAllBtn.onclick = function () {
        const groups = document.querySelectorAll('.filter-group');
        const anyExpanded = Array.from(groups).some(group => !group.classList.contains('collapsed'));
        if (anyExpanded) {
            groups.forEach(group => group.classList.add('collapsed'));
            toggleAllBtn.textContent = 'Expand All Filters';
        } else {
            groups.forEach(group => group.classList.remove('collapsed'));
            toggleAllBtn.textContent = 'Collapse All Filters';
        }
    };
}

const resetBtn = getEl('resetFilters');
if (resetBtn) {
    resetBtn.onclick = () => {
        setupFilters(rawData);
        applyFilters();
    };
}

let currentView = 'graph';
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

    const graphCont = getEl('graphContainer');
    const bubbleCont = getEl('bubbleChartContainer');

    if (view === 'graph') {
        const graphBtn = document.querySelector('button[onclick*="graph"]');
        if (graphBtn) graphBtn.classList.add('active');
        if (graphCont) graphCont.style.display = 'flex';
        if (bubbleCont) bubbleCont.style.display = 'none';
    } else {
        const bubbleBtn = document.querySelector('button[onclick*="bubble"]');
        if (bubbleBtn) bubbleBtn.classList.add('active');
        if (graphCont) graphCont.style.display = 'none';
        if (bubbleCont) bubbleCont.style.display = 'flex';
    }
    applyFilters();
}

const globalSearch = getEl('globalSearch');
if (globalSearch) {
    globalSearch.addEventListener('input', applyFilters);
}

function applyFilters() {
    const searchTerm = globalSearch ? globalSearch.value.toLowerCase() : "";
    filteredData = rawData.filter(d => {
        const matchesFilters = Object.keys(filters).every(field => filters[field].includes(d[field]));
        if (!matchesFilters) return false;
        if (!searchTerm) return true;
        return Object.values(d).some(val => String(val).toLowerCase().includes(searchTerm));
    });

    if (currentView === 'graph') {
        renderKnowledgeGraph(filteredData);
    } else {
        renderBubbleChart(filteredData);
    }
}

function renderBubbleChart(data) {
    try {
        if (typeof d3 === 'undefined') return;
        const container = getEl('bubbleChartContainer');
        const svgEl = getEl('bubbleChart');
        if (!container || !svgEl) return;

        const width = container.clientWidth;
        const height = container.clientHeight;
        const svg = d3.select("#bubbleChart")
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", `-${width / 2} -${height / 2} ${width} ${height}`)
            .style("display", "block")
            .style("background", "white");

        svg.selectAll("*").remove();
        if (!data.length) return;

        const columns = Object.keys(data[0]);
        let groupCol = columns.find(c => isNaN(data[0][c])) || columns[0];
        let sizeCol = columns.find(c => !isNaN(data[0][c]) && parseFloat(data[0][c]) !== 0);

        const root = d3.pack()
            .size([width, height])
            .padding(3)
            (d3.hierarchy({ children: data })
                .sum(d => sizeCol ? (parseFloat(d[sizeCol]) || 1) : 1)
                .sort((a, b) => b.value - a.value));

        const node = svg.append("g")
            .selectAll("circle")
            .data(root.leaves())
            .join("circle")
            .attr("r", d => d.r)
            .attr("cx", d => d.x - width / 2)
            .attr("cy", d => d.y - height / 2)
            .attr("fill", d => d3.schemeCategory10[Math.abs(hashCode(String(d.data[groupCol]))) % 10])
            .attr("fill-opacity", 0.7)
            .on("click", (event, d) => {
                const row = d.data;
                let content = `<strong>${groupCol}: ${row[groupCol]}</strong><br>`;
                content += Object.entries(row).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join("<br>");
                const infoContentEl = getEl('infoContent');
                if (infoContentEl) infoContentEl.innerHTML = content;
                if (leftInfoPanel && !leftInfoPanel.classList.contains('active')) {
                    leftInfoPanel.classList.add('active');
                    if (infoToggleBtn) {
                        infoToggleBtn.setAttribute('aria-expanded', 'true');
                        infoToggleBtn.innerHTML = '&#171;';
                    }
                    resizeCharts();
                }
            });

        node.append("title")
            .text(d => `${d.data[groupCol]}\n${sizeCol ? sizeCol + ': ' + d.data[sizeCol] : ''}`);

        svg.append("g")
            .selectAll("text")
            .data(root.leaves())
            .join("text")
            .attr("x", d => d.x - width / 2)
            .attr("y", d => d.y - height / 2)
            .attr("dy", ".3em")
            .style("text-anchor", "middle")
            .style("font-size", d => Math.min(2 * d.r, (2 * d.r - 8) / Math.max(1, (d.data[groupCol] || "").toString().length / 2)) + "px")
            .style("pointer-events", "none")
            .style("fill", "#fff")
            .style("text-shadow", "1px 1px 2px #000")
            .text(d => d.r > 10 ? (d.data[groupCol] || "").toString().substring(0, 15) : "");
    } catch (e) { console.error("Bubble Chart Error:", e); }
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return hash;
}

function renderKnowledgeGraph(data) {
    try {
        if (typeof d3 === 'undefined') return;
        const container = getEl('graphContainer');
        const svgEl = getEl('knowledgeGraph');
        if (!container || !svgEl) return;

        const width = container.clientWidth;
        const height = container.clientHeight;
        const svg = d3.select("#knowledgeGraph").attr("width", width).attr("height", height);
        svg.selectAll("*").remove();
        if (!data.length) return;

        const columns = Object.keys(data[0]);
        const valueNodes = {};
        const nodes = [];
        const links = [];

        columns.forEach(col => {
            const uniqueVals = Array.from(new Set(data.map(d => d[col])));
            uniqueVals.forEach(val => {
                const id = `${col}:${val}`;
                if (!valueNodes[id]) {
                    valueNodes[id] = { id, label: val, group: col, type: 'value' };
                    nodes.push(valueNodes[id]);
                }
            });
        });

        data.forEach((row, i) => {
            const rowNode = { id: `Row:${i + 1}`, label: `Row ${i + 1}`, type: 'row', index: i + 1 };
            nodes.push(rowNode);
            columns.forEach(col => {
                const val = row[col];
                const valueNodeId = `${col}:${val}`;
                if (valueNodes[valueNodeId]) links.push({ source: rowNode.id, target: valueNodeId, label: col });
            });
        });

        let selectedNodeId = null;
        let neighborSet = new Set();

        const zoom = d3.zoom().scaleExtent([0.2, 2]).on("zoom", (e) => g.attr("transform", e.transform));
        svg.call(zoom);
        const g = svg.append("g");

        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(80))
            .force("charge", d3.forceManyBody().strength(-120))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(30));

        const link = g.append("g").attr("stroke", "#333").attr("stroke-opacity", 0.6)
            .selectAll("line").data(links).join("line").attr("stroke-width", 1)
            .attr("class", "link");

        const node = g.append("g").attr("stroke", "#fff").attr("stroke-width", 1.5)
            .selectAll("g").data(nodes).join("g")
            .attr("class", "node")
            .call(d3.drag()
                .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
                .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

        node.append("circle").attr("r", d => d.type === "row" ? 10 : 7)
            .attr("fill", d => d.type === "row" ? "#e66f52" : d3.schemeCategory10[columns.indexOf(d.group) % 10])
            .on("click", (event, d) => {
                const connectedLinks = links.filter(l => l.source.id === d.id || l.target.id === d.id);
                let content = "";
                if (d.type === "row") {
                    const rowData = data[d.index - 1];
                    content += `<strong>Row: ${d.index}</strong><br>`;
                    content += Object.entries(rowData).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join("<br>");
                } else {
                    content += `<strong>${d.group}: ${d.label}</strong><br>`;
                }
                const infoContentEl = getEl('infoContent');
                if (infoContentEl) infoContentEl.innerHTML = content;

                selectedNodeId = (selectedNodeId === d.id) ? null : d.id;
                neighborSet = new Set();
                if (selectedNodeId) connectedLinks.forEach(l => neighborSet.add(l.source.id === d.id ? l.target.id : l.source.id));
                highlightNodes(d, !!selectedNodeId);
            });

        // Add text labels next to nodes
        node.append("text")
            .attr("dy", 3)
            .attr("x", d => d.type === "row" ? 14 : 10)
            .text(d => d.label)
            .style("font-size", "12px")
            .style("fill", "black")
            .style("stroke", "none")
            .style("pointer-events", "none");

        simulation.on("tick", () => {
            link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
            node.attr("transform", d => `translate(${d.x},${d.y})`);
        });

        function highlightNodes(d, highlight) {
            if (!highlight) {
                node.classed("highlighted", false).classed("faded", false);
                link.classed("highlighted", false).classed("faded", false);
                return;
            }

            // HIGHLIGHT: clicked node + its direct connections ONLY
            node.classed("highlighted", n => n.id === d.id || neighborSet.has(n.id));
            node.classed("faded", n => n.id !== d.id && !neighborSet.has(n.id));

            link.classed("highlighted", l => l.source.id === d.id || l.target.id === d.id);
            link.classed("faded", l => !(l.source.id === d.id || l.target.id === d.id));
        }
    } catch (e) { console.error("Graph Error:", e); }
}

const promptForm = getEl('promptForm');
if (promptForm) {
    promptForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const promptInput = getEl('promptInput');
        const aiResponse = getEl('aiResponse');
        if (!dataKey || !promptInput || !aiResponse) return;

        const promptText = promptInput.value.trim();
        if (!promptText) return;

        aiResponse.textContent = "Thinking...";
        fetch('/ai_prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptText, key: dataKey })
        })
            .then(resp => resp.json())
            .then(res => {
                aiResponse.innerHTML = res.response || "No answer.";
                promptInput.value = "";
            })
            .catch(() => { aiResponse.textContent = "Error contacting local model."; });
    });
}
