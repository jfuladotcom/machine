# Machine
### Human-in-the-Loop AI Workspace for Data, Knowledge Graphs, and Local Model Evaluation

**Machine** is a lightweight Flask-based workspace for exploring structured data, organizing knowledge visually, labeling datasets, and testing local AI models in one browser-based environment.

Originally built as a simple human-in-the-loop data exploration tool, the project now includes a broader workflow:
- multi-file upload and file management
- CSV-based dataset analysis
- knowledge graph exploration
- AI-assisted insights using a local Ollama model
- data labeling workflows
- a local AI evaluation dashboard for comparing model behavior

This project is intentionally modular and designed for experimentation, rapid prototyping, and internal tooling.

---

## Overview

Modern AI systems need more than just model access. They need usable interfaces for:

- understanding datasets
- organizing information visually
- labeling and reviewing examples
- asking questions against data
- evaluating local models in a practical workflow

**Machine** is a browser-based workspace that brings those pieces together into a single lightweight app.

It is especially useful as a foundation for:
- internal AI tooling
- local-first AI workflows
- human-in-the-loop review systems
- experimental research interfaces
- dataset exploration environments

---

## Core Features

### 1. Multi-File Workspace
Upload and manage multiple files from the UI.

Supported file types:
- CSV
- PDF
- XLSX / XLS
- TXT
- JSON

Features include:
- file upload from the header
- active file switching
- file metadata display
- CSV parsing and global dataset state
- lightweight file manager for workspace control

---

### 2. Dashboard
The dashboard acts as the starting point for the workspace.

It includes:
- project overview
- quick start guidance
- file upload access
- AI-generated summary area
- direct navigation into graph, labeling, insights, and evaluation views

---

### 3. Knowledge Graph Exploration
Visualize relationships inside uploaded CSV data through an interactive graph interface.

Capabilities include:
- interactive graph rendering
- node exploration
- search across data
- filter controls
- pattern discovery through relationship mapping

This is useful for turning flat tabular data into something more explorable and spatial.

---

### 4. AI Insights Chat
Ask questions about the active dataset using a local Ollama model.

The app:
- reads the active CSV
- samples the dataset
- sends structured context to a local model
- returns concise answers inside the interface

Current default model behavior is optimized for:
- direct responses
- short analytical summaries
- practical dataset interpretation

---

### 5. Data Labeling Workflow
Run human-in-the-loop labeling against uploaded CSV data.

Includes support for:
- selecting a target column
- labeling with prompt-based logic
- applying literal or AI-assisted matching
- reviewing outputs inside the app

This makes the project useful as a lightweight annotation and classification workspace for structured data.

---

### 6. Analysis Toolkit
The toolkit view extends the graph experience with additional visual modes for exploring the active dataset.

It is designed to support:
- filtering
- graph-based exploration
- alternate visual views
- interactive analysis patterns

---

### 7. Local AI Evaluation Dashboard
A new part of the workspace is the **Local AI Eval Dashboard**, built for testing models running through Ollama.

Features include:
- automatic loading of installed local Ollama models
- benchmark category selection
- evaluation run tracking
- saved result loading
- dashboard visualizations
- follow-up chat grounded in eval results

Current benchmark categories include:
- math
- reasoning
- code
- safety

This makes **Machine** not just a data workspace, but also a lightweight local model testing environment.

---

## Tech Stack

- **Python**
- **Flask**
- **Pandas**
- **NumPy**
- **HTML / CSS / JavaScript**
- **Jinja Templates**
- **Markdown-it**
- **Ollama** for local model interaction

Frontend libraries used in the UI include:
- **D3.js**
- **Plotly**
- **Font Awesome**

---

## Project Structure

```bash
machine/
│
├── app.py
├── evals.py
│
├── templates/
│   ├── index.html
│   ├── knowledge.html
│   ├── datalabel.html
│   ├── insights.html
│   ├── machine.html
│   ├── eval.html
│   ├── nav.html
│   └── file_manager_widget.html
│
├── static/
│   ├── style.css
│   ├── script.js
│   ├── eval-script.js
│   └── uploads/
│
└── LICENSE
