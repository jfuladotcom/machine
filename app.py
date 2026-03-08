import os
import re
import json
import textwrap
import requests
import pandas as pd
import numpy as np
from datetime import datetime
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
from markdown_it import MarkdownIt
from evals import run_model_eval

app = Flask(__name__)
md = MarkdownIt()

# Configuration
UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXTENSIONS = {'csv', 'pdf', 'xlsx', 'xls', 'txt', 'json'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 64 * 1024 * 1024  # 64MB max

# ── Eval / Ollama constants ───────────────────────────────────────────────────
RESULTS_DIR = os.path.join(os.path.dirname(__file__), 'static')
OLLAMA_BASE = "http://localhost:11434"
OLLAMA_CHAT = f"{OLLAMA_BASE}/api/chat"
OLLAMA_TAGS = f"{OLLAMA_BASE}/api/tags"

# Note: Ollama doesn't typically require a key for local use

# Storage for sessions
GLOBAL_DATA = {
    "df_json": None,
    "filename": None,
    "columns": [],
    "row_count": 0
}
OLLAMA_DATA_STORE = {}

# Global multi-file store: { filename: { path, size, type, df_json (for CSVs) } }
GLOBAL_FILES = {}

def get_file_icon(filename):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    icons = {'csv': 'fa-file-csv', 'pdf': 'fa-file-pdf', 'xlsx': 'fa-file-excel',
             'xls': 'fa-file-excel', 'txt': 'fa-file-alt', 'json': 'fa-file-code'}
    return icons.get(ext, 'fa-file')

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- FRONTEND ROUTES ---

@app.route('/')
def dashboard():
    return render_template('index.html', active_page='dashboard')

@app.route('/knowledge')
def knowledge():
    return render_template('knowledge.html', active_page='knowledge')

@app.route('/analysis')
def analysis():
    return render_template('datalabel.html', active_page='analysis')

@app.route('/tool')
def tool():
    return render_template('machine.html', active_page='knowledge')

@app.route('/insights')
def insights():
    return render_template('insights.html', active_page='insights')

@app.route('/eval')
def eval_dashboard():
    return render_template('eval.html', active_page='eval')

@app.route('/settings')
def settings():
    return "<h3>Settings Section</h3><p>Settings placeholder. Functional configuration will be added here soon.</p><a href='/'>Back to Dashboard</a>"

@app.route('/nav')
def nav():
    active_page = request.args.get('active_page', 'dashboard')
    return render_template('nav.html', active_page=active_page)

# --- FILE MANAGER API ENDPOINTS ---

@app.route('/upload-file', methods=['POST'])
def upload_file():
    """Universal file upload endpoint. Supports CSV, PDF, etc."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    files = request.files.getlist('file')
    results = []
    errors = []

    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    for file in files:
        if file.filename == '':
            continue
        if not allowed_file(file.filename):
            errors.append(f"'{file.filename}' — unsupported type (allowed: csv, pdf, xlsx, txt, json)")
            continue

        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        size = os.path.getsize(file_path)
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

        entry = {
            'filename': filename,
            'path': file_path,
            'size': size,
            'type': ext,
            'icon': get_file_icon(filename),
            'df_json': None,
            'columns': [],
            'row_count': 0,
        }

        # Parse CSV into global data store
        if ext == 'csv':
            try:
                df = pd.read_csv(file_path)
                entry['df_json'] = df.to_json(orient='split')
                entry['columns'] = df.columns.tolist()
                entry['row_count'] = len(df)

                # Make first CSV the active dataset automatically
                if GLOBAL_DATA['df_json'] is None or len(GLOBAL_FILES) == 0:
                    GLOBAL_DATA.update({
                        'df_json': entry['df_json'],
                        'filename': filename,
                        'columns': entry['columns'],
                        'row_count': entry['row_count']
                    })
            except Exception as e:
                errors.append(f"'{filename}' — CSV parse error: {str(e)}")
                continue

        GLOBAL_FILES[filename] = entry
        results.append({
            'filename': filename,
            'size': size,
            'type': ext,
            'icon': entry['icon'],
            'columns': entry['columns'],
            'row_count': entry['row_count'],
        })

    return jsonify({'uploaded': results, 'errors': errors, 'total_files': len(GLOBAL_FILES)})


@app.route('/list-files', methods=['GET'])
def list_files():
    """Returns the list of all uploaded files."""
    files = []
    active = GLOBAL_DATA.get('filename')
    for name, meta in GLOBAL_FILES.items():
        files.append({
            'filename': name,
            'size': meta['size'],
            'type': meta['type'],
            'icon': meta['icon'],
            'columns': meta['columns'],
            'row_count': meta['row_count'],
            'is_active': name == active,
        })
    return jsonify({'files': files, 'active_file': active})


@app.route('/remove-file', methods=['POST'])
def remove_file():
    """Removes a file from the global store (and disk)."""
    data = request.get_json()
    filename = data.get('filename')
    if not filename or filename not in GLOBAL_FILES:
        return jsonify({'error': 'File not found'}), 404

    meta = GLOBAL_FILES.pop(filename)
    try:
        if os.path.exists(meta['path']):
            os.remove(meta['path'])
    except Exception:
        pass

    # If we removed the active dataset, clear or reassign
    if GLOBAL_DATA['filename'] == filename:
        GLOBAL_DATA.update({'df_json': None, 'filename': None, 'columns': [], 'row_count': 0})
        # Auto-assign next available CSV
        for name, m in GLOBAL_FILES.items():
            if m['type'] == 'csv' and m['df_json']:
                GLOBAL_DATA.update({
                    'df_json': m['df_json'], 'filename': name,
                    'columns': m['columns'], 'row_count': m['row_count']
                })
                break

    return jsonify({'removed': filename, 'total_files': len(GLOBAL_FILES), 'active_file': GLOBAL_DATA['filename']})


@app.route('/set-active-file', methods=['POST'])
def set_active_file():
    """Sets a specific CSV file as the active global dataset."""
    data = request.get_json()
    filename = data.get('filename')
    if not filename or filename not in GLOBAL_FILES:
        return jsonify({'error': 'File not found'}), 404
    meta = GLOBAL_FILES[filename]
    if meta['type'] != 'csv' or not meta['df_json']:
        return jsonify({'error': 'Only CSV files can be set as active dataset'}), 400
    GLOBAL_DATA.update({
        'df_json': meta['df_json'], 'filename': filename,
        'columns': meta['columns'], 'row_count': meta['row_count']
    })
    return jsonify({'active_file': filename, 'columns': meta['columns'], 'row_count': meta['row_count']})


# --- LEGACY COMPATIBILITY WRAPPERS ---

@app.route('/upload-csv', methods=['POST'])
def upload_csv():
    """Legacy: delegates to /upload-file for backward compatibility."""
    return upload_file()

@app.route('/get-global-data-status')
def get_global_data_status():
    return jsonify({
        'filename': GLOBAL_DATA['filename'],
        'row_count': GLOBAL_DATA['row_count'],
        'columns': GLOBAL_DATA['columns'],
        'has_data': GLOBAL_DATA['df_json'] is not None,
        'total_files': len(GLOBAL_FILES)
    })

@app.route('/get-global-csv')
def get_global_csv():
    if not GLOBAL_DATA['df_json']:
        return jsonify({'error': 'No global data loaded'}), 404
    df = pd.read_json(GLOBAL_DATA['df_json'], orient='split')
    return df.to_csv(index=False)

@app.route('/get-csv-data')
def get_csv_data():
    key = request.args.get('key')
    if not key or key not in OLLAMA_DATA_STORE:
        return jsonify({'error': 'Invalid key'}), 404
    df = pd.read_json(OLLAMA_DATA_STORE[key]['df_json'], orient='split')
    return df.to_csv(index=False)

@app.route('/ai_prompt', methods=['POST'])
def ai_prompt():
    data = request.get_json()
    prompt = data.get('prompt', '')
    key = data.get('key', '')

    # Check session key first, then global data
    if key in OLLAMA_DATA_STORE:
        df_json = OLLAMA_DATA_STORE[key]['df_json']
    elif GLOBAL_DATA['df_json']:
        df_json = GLOBAL_DATA['df_json']
    else:
        return jsonify({'response': 'No data uploaded yet. Please upload a CSV on the dashboard.'})

    df = pd.read_json(df_json, orient='split')
    # Direct and concise data expert system prompt
    system_prompt = (
        "You are a data analyst. Provide direct, objective, and concise answers based on the provided CSV data sample. "
        "Do not use conversational filler, greetings, or elaborate introductions. Focus only on the facts and relevant patterns in the data "
        "that directly answer the user's question. Keep your response to 1-3 sentences."
    )
    
    # Reduce context to 100 rows to avoid overwhelming the model
    data_sample = df.head(100).to_csv(index=False)
    
    user_message = (
        f"Context (first 100 rows of CSV):\n{data_sample}\n\n"
        f"Columns: {', '.join(df.columns)}\n\n"
        f"User Question: {prompt}"
    )

    payload = {
        "model": "llama3",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "stream": False,
        "options": {
            "temperature": 0
        }
    }

    print(f"--- Sending Prompt to Ollama ---\n{user_message}\n-------------------------------")

    try:
        # Switching from /api/generate to /api/chat
        response = requests.post("http://127.0.0.1:11434/api/chat", json=payload)
        response.raise_for_status()
        
        # Chat API response structure: response.json()['message']['content']
        result_json = response.json()
        answer = result_json.get('message', {}).get('content', 'No response content from local model.')
        
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            answer = f"Error: Model 'llama3' or Chat endpoint not found. Available models: {', '.join([''])}"
        else:
            answer = f"Error communicating with local model: {str(e)}"
    except requests.exceptions.RequestException as e:
        answer = f"Error communicating with local model: {str(e)}. Make sure Ollama is running."
    return jsonify({'response': md.render(answer)})

# --- GEMINI / DATA LABELING API ENDPOINTS ---

@app.route('/upload-label-csv', methods=['POST'])
def upload_label_csv():
    # This specifically handles the CreativeDataLabeling upload flow
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type'}), 400

    filename = secure_filename(file.filename)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(file_path)

    try:
        df = pd.read_csv(file_path)
        df_json = df.to_json(orient='split')
        return jsonify({
            'columns': df.columns.tolist(),
            'row_count': len(df),
            'df_json': df_json
        })
    except Exception as e:
        return jsonify({'error': f'Failed to process CSV: {str(e)}'}), 400

@app.route('/label', methods=['POST'])
def label():
    try:
        data = request.get_json()
        df_json = data.get('df_json')
        column = data.get('column')
        prompt = data.get('prompt')
        match_type = data.get('match_type', 'ai') # 'ai' or 'literal'

        # Fallback to global data if df_json not provided in request
        if not df_json and GLOBAL_DATA['df_json']:
            df_json = GLOBAL_DATA['df_json']

        if not (df_json and column and prompt):
            return jsonify({'error': 'Missing data, column, or prompt.'}), 400

        df = pd.read_json(df_json, orient='split')
        
        # Determine the target data list
        if column == "All Columns":
            all_data = df.astype(str).agg(' '.join, axis=1).tolist()
        else:
            # We use the full index to ensure we maintain mapping, even with NAs
            all_data = df[column].astype(str).replace('nan', '').tolist()
        
        all_results = [0] * len(all_data)
        full_response_log = []

        if match_type == 'literal':
            # Case-insensitive literal match
            search_term = prompt.lower()
            for idx, text in enumerate(all_data):
                if search_term in text.lower():
                    all_results[idx] = 1
            full_response_log.append("Literal Match: Applied search for '" + prompt + "'")
        else:
            # AI Match with indices for robustness
            batch_size = 15 # Slightly smaller to account for index overhead
            for i in range(0, len(all_data), batch_size):
                batch = all_data[i:i + batch_size]
                # Format batch with indices: "1. Text", "2. Text", etc.
                batch_text = "\n".join(f"{idx+1}. {row}" for idx, row in enumerate(batch))
                
                system_prompt = (
                    "You are an expert data annotator. Apply the labeling rule to each example. "
                    "For each example, respond with the number followed by ': LABEL' or ': NO LABEL'. "
                    "Example:\n1: LABEL\n2: NO LABEL\n"
                    "Do NOT include any other text or explanation."
                )
                
                user_message = (
                    f"Labeling Rule: '{prompt}'\n"
                    f"Examples:\n{batch_text}"
                )

                payload = {
                    "model": "llama3",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
                    "stream": False,
                    "options": {"temperature": 0}
                }

                try:
                    response = requests.post("http://127.0.0.1:11434/api/chat", json=payload, timeout=30)
                    response.raise_for_status()
                    result_json = response.json()
                    answer = result_json.get('message', {}).get('content', '').strip()
                except Exception as e:
                    answer = f"Error in batch: {str(e)}"
                
                full_response_log.append(f"--- Batch {i//batch_size + 1} ---\n{answer}")

                # Robust parsing using regex: look for "Number: LABEL" or "Number: NO LABEL"
                # Matches patterns like "1: LABEL", "1. LABEL", "1 LABEL"
                matches = re.finditer(r'(\d+)[:.\s]+(LABEL|NO LABEL)', answer, re.IGNORECASE)
                for m in matches:
                    batch_idx = int(m.group(1)) - 1
                    label_str = m.group(2).upper()
                    if 0 <= batch_idx < len(batch):
                        global_idx = i + batch_idx
                        all_results[global_idx] = 1 if label_str == 'LABEL' else 0

        labeled = list(zip(all_data, all_results))
        return jsonify({
            'examples': labeled,
            'raw_response': "\n\n".join(full_response_log)
        })
    except Exception as e:
        return jsonify({'error': f'Ollama labeling failed: {str(e)}'}), 500

# ── Eval: model discovery ─────────────────────────────────────────────────────

@app.route('/api/models')
def get_models():
    """Return list of locally installed Ollama models."""
    try:
        resp = requests.get(OLLAMA_TAGS, timeout=5)
        resp.raise_for_status()
        models = [m['name'] for m in resp.json().get('models', [])]
        return jsonify({'models': models})
    except requests.exceptions.ConnectionError:
        return jsonify({'models': [], 'error': 'Ollama not running'})
    except Exception as e:
        return jsonify({'models': [], 'error': str(e)})


# ── Eval: run / results ───────────────────────────────────────────────────────

@app.route('/api/run-eval', methods=['POST'])
def run_eval():
    model     = request.json.get('model', 'llama3')
    benchmark = request.json.get('benchmark', 'all')
    results   = run_model_eval(model, benchmark)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename  = f"results_{timestamp}.json"
    filepath  = os.path.join(RESULTS_DIR, filename)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(filepath, 'w') as f:
        json.dump(results, f, indent=2)

    results['_filename'] = filename
    return jsonify(results)


@app.route('/api/results')
def get_results():
    """Return the most recently saved result file."""
    files = _list_result_files()
    if not files:
        return jsonify({})
    latest = files[-1]
    with open(os.path.join(RESULTS_DIR, latest), 'r') as f:
        data = json.load(f)
    data['_filename'] = latest
    return jsonify(data)


# ── Eval: save / load runs ────────────────────────────────────────────────────

@app.route('/api/save-run', methods=['POST'])
def save_run():
    """Explicitly save the current result state sent from the browser."""
    data      = request.json
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename  = f"results_{timestamp}.json"
    filepath  = os.path.join(RESULTS_DIR, filename)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)
    return jsonify({'filename': filename, 'ok': True})


@app.route('/api/load-runs')
def load_runs():
    """List all saved result files, newest first."""
    return jsonify(list(reversed(_list_result_files())))


@app.route('/api/load-run/<filename>')
def load_run(filename):
    """Return a specific saved run by filename."""
    if not filename.startswith('results_') or not filename.endswith('.json'):
        return jsonify({'error': 'Invalid filename'}), 400
    filepath = os.path.join(RESULTS_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    with open(filepath, 'r') as f:
        data = json.load(f)
    data['_filename'] = filename
    return jsonify(data)


# ── Eval: AI chat ─────────────────────────────────────────────────────────────

@app.route('/api/chat', methods=['POST'])
def eval_chat():
    """
    Proxies a chat request to Ollama using whichever model the user selected.
    Body: { message, model, history: [{role, content}], context: <eval results> }
    """
    body         = request.json or {}
    user_message = body.get('message', '').strip()
    history      = body.get('history', [])
    context      = body.get('context', {})
    chat_model   = body.get('model') or context.get('model', 'llama3')

    if not user_message:
        return jsonify({'error': 'Empty message'}), 400

    system_prompt = _build_system_prompt(context)
    messages = [{'role': 'system', 'content': system_prompt}]
    messages.extend(history)
    messages.append({'role': 'user', 'content': user_message})

    try:
        resp = requests.post(
            OLLAMA_CHAT,
            json={'model': chat_model, 'messages': messages, 'stream': False},
            timeout=60
        )
        resp.raise_for_status()
        reply = resp.json().get('message', {}).get('content', '(no response)')
        return jsonify({'reply': reply})
    except requests.exceptions.HTTPError as e:
        # If Ollama returns a 400 or 404, try to extract its specific JSON error message
        try:
            error_details = resp.json().get('error', str(e))
        except:
            error_details = str(e)
        return jsonify({'reply': f'⚠️ Error: {error_details}'})
    except requests.exceptions.ConnectionError:
        return jsonify({'reply': '⚠️ Ollama is not running. Start it with `ollama serve` and try again.'})
    except Exception as e:
        return jsonify({'reply': f'⚠️ Error: {str(e)}'})


# ── Eval: helpers ─────────────────────────────────────────────────────────────

def _list_result_files():
    """Return sorted list of result JSON filenames in RESULTS_DIR."""
    try:
        return sorted(
            f for f in os.listdir(RESULTS_DIR)
            if f.startswith('results_') and f.endswith('.json')
        )
    except FileNotFoundError:
        return []


def _build_system_prompt(context: dict) -> str:
    if not context or 'metrics' not in context:
        return textwrap.dedent("""\
            ## Your Role
            You are an insightful AI assistant embedded in the **Local AI Evaluation Dashboard**.
            No evaluation results are loaded yet — help the user understand how to run one.

            ## Response Format
            **Always reply using Markdown.** Use `##` / `###` headers, bullet lists, **bold**,
            _italic_, and fenced code blocks where they improve clarity.
            Never reply with plain, unformatted paragraphs.

            ## Responsibilities
            - Explain what each benchmark and metric measures.
            - Guide the user through running their first evaluation.
            - For topics outside the dashboard, answer helpfully while noting the response
              is not drawn from loaded results.

            ## Tone
            Professional, approachable, and concise.
        """)

    model      = context.get('model', 'unknown')
    summary    = context.get('summary', {})
    metrics    = context.get('metrics', {})
    task_block = "\n".join(
        f"  - **{name}**: pass@1={m.get('pass@1', '?')}, "
        f"latency={m.get('latency_ms', '?')} ms, tokens={m.get('tokens', '?')}"
        for name, m in metrics.items()
    )

    return textwrap.dedent(f"""\
        ## Your Role
        You are an insightful AI assistant embedded in the **Local AI Evaluation Dashboard**.
        The user just ran an evaluation for model **{model}**.

        ## Response Format
        **Always reply using Markdown.** Use `##` / `###` headers, bullet lists, **bold**,
        _italic_, and fenced code blocks where they improve clarity.
        Never reply with plain, unformatted paragraphs.

        ## Evaluation Summary
        | Metric | Value |
        |--------|-------|
        | Avg Pass@1 | {summary.get('avg_pass1', 'N/A')} |
        | Avg Latency | {summary.get('avg_latency', 'N/A')} ms |
        | Total Tasks | {summary.get('total_tasks', 'N/A')} |

        ## Per-Task Breakdown
        {task_block}

        ## Instructions
        - Answer questions about the results above concisely and helpfully.
        - Highlight notable strengths, weaknesses, or anomalies you spot.
        - For topics outside the evaluation data, provide general guidance while noting
          it is not based on the current results.
    """)


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    os.makedirs(RESULTS_DIR, exist_ok=True)
    app.run(debug=True, port=5000)
