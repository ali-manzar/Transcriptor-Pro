#!/usr/bin/env python3
"""
YouTube Multi-Transcript Extractor App (Pro Edition) - Backend Server
---------------------------------------------------------------------
A robust Python backend server serving API endpoints for metadata extraction,
fallback WebVTT parsing, context-length AI chunking, and SSE response streaming.

Requirements:
    pip install yt-dlp
    pip install google-generativeai (optional, for Gemini AI features)
"""

import os
import re
import sys
import json
import urllib.request
import concurrent.futures
import webbrowser
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import socketserver
from typing import List, Optional, Tuple, Dict, Any, Union
from urllib.parse import urlparse
def auto_install_dependencies() -> None:
    """Check for missing dependencies and programmatically install them via pip."""
    import subprocess
    
    packages = {
        "yt_dlp": "yt-dlp",
        "google.generativeai": "google-generativeai"
    }
    
    for module_name, pip_name in packages.items():
        try:
            __import__(module_name)
        except ImportError:
            print(f"Required package '{pip_name}' is missing. Auto-installing...", flush=True)
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", pip_name])
                print(f"Successfully installed '{pip_name}'!", flush=True)
            except Exception as e:
                print(f"Warning: Failed to auto-install '{pip_name}': {str(e)}", file=sys.stderr, flush=True)

# Execute dependency check before importing
auto_install_dependencies()

import yt_dlp

PORT = 8000

# Import google-generativeai for Gemini integration
try:
    import google.generativeai as genai
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

def sanitize_filename(filename: str) -> str:
    """Remove characters that are invalid in filenames."""
    return re.sub(r'[\\/*?:"<>|]', "", filename).strip()

def format_timestamp(ms: int) -> str:
    """Format milliseconds into a standard HH:MM:SS or MM:SS timestamp."""
    seconds = int((ms / 1000) % 60)
    minutes = int((ms / (1000 * 60)) % 60)
    hours = int((ms / (1000 * 60 * 60)) % 24)
    if hours > 0:
        return f"[{hours:02d}:{minutes:02d}:{seconds:02d}]"
    else:
        return f"[{minutes:02d}:{seconds:02d}]"

def format_views(view_count: Union[int, str, None]) -> str:
    """Format views count to a human-readable shorthand (e.g. 1.2M views)."""
    if not view_count:
        return "N/A"
    try:
        views = int(view_count)
        if views >= 1_000_000_000:
            return f"{views / 1_000_000_000:.1f}B views"
        elif views >= 1_000_000:
            return f"{views / 1_000_000:.1f}M views"
        elif views >= 1_000:
            return f"{views / 1_000:.1f}K views"
        else:
            return f"{views:,} views"
    except (ValueError, TypeError):
        return str(view_count)

def parse_vtt(vtt_text: str) -> Tuple[str, List[Dict[str, str]]]:
    """Parse WebVTT subtitle file into raw text and formatted timestamp segments."""
    lines = vtt_text.splitlines()
    raw_lines: List[str] = []
    ts_lines: List[Dict[str, str]] = []
    
    current_ts = "[00:00]"
    current_text_segments: List[str] = []
    
    # Match patterns for VTT timestamps
    time_pattern = re.compile(r'(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})')
    time_short_pattern = re.compile(r'(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})')
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('WEBVTT') or line.startswith('Kind:') or line.startswith('Language:'):
            continue
        
        # Check for timestamp lines
        match = time_pattern.search(line) or time_short_pattern.search(line)
        if match:
            # Flush accumulated text segments from the previous timestamp
            if current_text_segments:
                seg_text = " ".join(current_text_segments).strip()
                seg_text = re.sub(r'<[^>]*>', '', seg_text)  # Remove inline style tags
                seg_text = re.sub(r'\s+', ' ', seg_text)
                if seg_text:
                    raw_lines.append(seg_text)
                    ts_lines.append({"timestamp": current_ts, "text": seg_text})
                current_text_segments = []
            
            # Formulate timestamp representation (preserving milliseconds)
            start_time = match.group(1)
            if start_time.startswith("00:"):
                current_ts = f"[{start_time[3:]}]"
            else:
                current_ts = f"[{start_time}]"
        else:
            if line.startswith('NOTE') or line.startswith('STYLE') or '::cue' in line:
                continue
            clean_line = re.sub(r'<[^>]*>', '', line)
            if clean_line:
                current_text_segments.append(clean_line)
                
    # Flush trailing segment
    if current_text_segments:
        seg_text = " ".join(current_text_segments).strip()
        seg_text = re.sub(r'<[^>]*>', '', seg_text)
        seg_text = re.sub(r'\s+', ' ', seg_text)
        if seg_text:
            raw_lines.append(seg_text)
            ts_lines.append({"timestamp": current_ts, "text": seg_text})
            
    # Deduplicate rolling captions
    cleaned_ts_lines: List[Dict[str, str]] = []
    cleaned_raw_lines: List[str] = []
    for line in ts_lines:
        if cleaned_ts_lines and cleaned_ts_lines[-1]["text"] == line["text"]:
            continue
        cleaned_ts_lines.append(line)
        cleaned_raw_lines.append(line["text"])
        
    return " ".join(cleaned_raw_lines), cleaned_ts_lines

def process_single_video(url: str, lang: str = 'en', prefer_manual: bool = True) -> Optional[Dict[str, Any]]:
    """Fetch video metadata and extract transcript using json3 primary API or vtt fallback."""
    url = url.strip()
    if not url:
        return None
        
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return {
            'url': url,
            'status': 'error',
            'error': f"Metadata extraction failed: {str(e)}"
        }
        
    title = info.get('title', 'Unknown Title')
    view_count = info.get('view_count')
    thumbnail = info.get('thumbnail')
    subtitles = info.get('subtitles', {})
    auto_subs = info.get('automatic_captions', {})
    
    selected_subs = None
    actual_lang = None
    
    # Dynamic selection based on user preference
    if prefer_manual:
        # Manual subtitles first
        if lang in subtitles:
            selected_subs = subtitles[lang]
            actual_lang = lang
        else:
            for k in subtitles.keys():
                if k.startswith(lang):
                    selected_subs = subtitles[k]
                    actual_lang = k
                    break
        # Auto captions fallback
        if not selected_subs:
            if lang in auto_subs:
                selected_subs = auto_subs[lang]
                actual_lang = lang
            else:
                for k in auto_subs.keys():
                    if k.startswith(lang):
                        selected_subs = auto_subs[k]
                        actual_lang = k
                        break
    else:
        # Auto captions first
        if lang in auto_subs:
            selected_subs = auto_subs[lang]
            actual_lang = lang
        else:
            for k in auto_subs.keys():
                if k.startswith(lang):
                    selected_subs = auto_subs[k]
                    actual_lang = k
                    break
        # Manual subtitles fallback
        if not selected_subs:
            if lang in subtitles:
                selected_subs = subtitles[lang]
                actual_lang = lang
            else:
                for k in subtitles.keys():
                    if k.startswith(lang):
                        selected_subs = subtitles[k]
                        actual_lang = k
                        break
                        
    if not selected_subs:
        available = list(set(list(subtitles.keys()) + list(auto_subs.keys())))[:15]
        return {
            'url': url,
            'title': title,
            'views': format_views(view_count),
            'thumbnail': thumbnail,
            'status': 'error',
            'error': f"No captions found for language '{lang}'. Available: {', '.join(available) or 'None'}"
        }
        
    # Attempt to locate JSON3 (primary) and VTT (fallback) formats
    json3_url = None
    vtt_url = None
    for sub in selected_subs:
        if sub.get('ext') == 'json3':
            json3_url = sub.get('url')
        elif sub.get('ext') == 'vtt':
            vtt_url = sub.get('url')
            
    # CASE 1: High-accuracy JSON3 is available
    if json3_url:
        try:
            req = urllib.request.Request(json3_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode('utf-8'))
            
            events = data.get('events', [])
            transcript_raw = []
            transcript_ts = []
            
            for event in events:
                if 'segs' in event:
                    seg_text = ''.join([seg.get('utf8', '') for seg in event['segs']]).strip()
                    seg_text = re.sub(r'\s+', ' ', seg_text)
                    if seg_text:
                        tStartMs = event.get('tStartMs', 0)
                        ts = format_timestamp(tStartMs)
                        transcript_raw.append(seg_text)
                        transcript_ts.append({
                            'timestamp': ts,
                            'text': seg_text
                        })
            return {
                'url': url,
                'title': title,
                'views': format_views(view_count),
                'thumbnail': thumbnail,
                'language': actual_lang,
                'status': 'success',
                'raw_transcript': ' '.join(transcript_raw),
                'ts_transcript': transcript_ts
            }
        except Exception as e:
            # Fall back to VTT if JSON3 download fails
            if not vtt_url:
                return {
                    'url': url,
                    'title': title,
                    'views': format_views(view_count),
                    'thumbnail': thumbnail,
                    'status': 'error',
                    'error': f"Failed to download JSON3 and no VTT fallback: {str(e)}"
                }
                
    # CASE 2: Fall back to parsing VTT captions
    if vtt_url:
        try:
            req = urllib.request.Request(vtt_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response:
                vtt_text = response.read().decode('utf-8')
            
            raw_text, ts_lines = parse_vtt(vtt_text)
            return {
                'url': url,
                'title': title,
                'views': format_views(view_count),
                'thumbnail': thumbnail,
                'language': actual_lang,
                'status': 'success',
                'raw_transcript': raw_text,
                'ts_transcript': ts_lines
            }
        except Exception as e:
            return {
                'url': url,
                'title': title,
                'views': format_views(view_count),
                'thumbnail': thumbnail,
                'status': 'error',
                'error': f"Failed to download and parse WebVTT fallback: {str(e)}"
            }
            
    return {
        'url': url,
        'title': title,
        'views': format_views(view_count),
        'thumbnail': thumbnail,
        'status': 'error',
        'error': "No supported captions formats (json3/vtt) could be loaded."
    }

def chunk_text(text: str, max_words: int = 4000) -> List[str]:
    """Split text into chunks of specified maximum word length."""
    words = text.split()
    chunks = []
    for i in range(0, len(words), max_words):
        chunks.append(" ".join(words[i:i+max_words]))
    return chunks

def get_prompt_text(prompt_type: str, text: str) -> str:
    """Retrieve formatted prompt templates for various processing tasks."""
    prompts = {
        'beautify': (
            "You are a professional editor. Please format the following raw speech-to-text transcript "
            "into clear, well-structured, and highly readable paragraphs.\n"
            "Instructions:\n"
            "1. Remove filler words (such as 'uh', 'um', 'like', 'you know', 'so', etc.).\n"
            "2. Fix spelling, punctuation, capitalization, and grammatical issues.\n"
            "3. Correct transcription mistakes based on context.\n"
            "4. Organize the text into logical paragraphs to make it highly readable.\n"
            "5. Do NOT summarize or omit core details; preserve the speaker's original meaning and style.\n"
            "6. Do NOT add any preamble, introduction, or concluding remarks. Return ONLY the polished transcript.\n\n"
        ),
        'summary': (
            "You are a skilled content summarizer. Create a comprehensive, well-structured summary "
            "of the following transcript using bullet points and clear headings.\n"
            "Instructions:\n"
            "1. Group information logically under main headings.\n"
            "2. Capture key arguments, facts, and conclusions.\n"
            "3. Do NOT add any preamble or meta-commentary. Return ONLY the markdown summary.\n\n"
        ),
        'action_items': (
            "You are an executive assistant. Analyze the following transcript and extract all "
            "action items, decisions made, follow-ups, and deliverables.\n"
            "Instructions:\n"
            "1. List all action items with clear bullet points.\n"
            "2. Group tasks by person/role if mentioned, or categorize them logically.\n"
            "3. Highlight key deadlines or dates mentioned.\n"
            "4. Do NOT add any preamble. Return ONLY the list.\n\n"
        ),
        'chapters': (
            "You are a video editor. Analyze the following transcript and generate clear, logical "
            "chapter markers with titles and start times.\n"
            "Instructions:\n"
            "1. Identify major topic transition points and partition the transcript.\n"
            "2. Format each marker as 'HH:MM:SS - Chapter Title' or 'MM:SS - Chapter Title'.\n"
            "3. Do NOT add any preamble. Return ONLY the list of chapter markers.\n\n"
        )
    }
    base_prompt = prompts.get(prompt_type, prompts['beautify'])
    return f"{base_prompt}Transcript:\n{text}"

def get_gemini_model(key: str) -> str:
    """List and choose a working text model dynamically or sequential fallback."""
    if not HAS_GEMINI:
        raise Exception("SDK 'google-generativeai' not installed.")
    
    genai.configure(api_key=key)
    candidate_models = []
    
    try:
        available_models = [
            m.name.replace("models/", "") 
            for m in genai.list_models() 
            if "generateContent" in m.supported_generation_methods
        ]
        prefer = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-pro"]
        for p in prefer:
            if p in available_models:
                candidate_models = [p] + [m for m in available_models if m != p]
                break
        else:
            candidate_models = available_models
    except Exception as e:
        print(f"Failed to query model list: {e}. Falling back to default list.", file=sys.stderr)
        
    if not candidate_models:
        candidate_models = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-2.5-flash", "gemini-pro"]
        
    return candidate_models[0]

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """Handle requests in a separate thread."""
    daemon_threads = True

class TranscriptRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        # Suppress logging every request to keep console output clean
        pass

    def do_GET(self) -> None:
        parsed_path = urlparse(self.path).path
        base_dir = os.path.dirname(os.path.abspath(__file__))
        static_dir = os.path.join(base_dir, 'static')
        
        # Routing static assets
        if parsed_path == '/' or parsed_path == '/index.html':
            self.serve_file(os.path.join(static_dir, 'index.html'), 'text/html')
        elif parsed_path == '/style.css':
            self.serve_file(os.path.join(static_dir, 'style.css'), 'text/css')
        elif parsed_path == '/app.js':
            self.serve_file(os.path.join(static_dir, 'app.js'), 'application/javascript')
        else:
            self.send_error(404, "File not found")

    def serve_file(self, filepath: str, content_type: str) -> None:
        if not os.path.exists(filepath):
            self.send_error(404, f"File {os.path.basename(filepath)} not found")
            return
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            if filepath.endswith('index.html'):
                status_js = 'true' if HAS_GEMINI else 'false'
                content = content.replace('__HAS_GEMINI_STATUS__', status_js)
            self.send_response(200)
            self.send_header('Content-Type', f'{content_type}; charset=utf-8')
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {str(e)}")

    def do_POST(self) -> None:
        parsed_path = urlparse(self.path).path
        if parsed_path == '/api/extract':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                params = json.loads(post_data.decode('utf-8'))
                urls = params.get('urls', [])
                lang = params.get('lang', 'en')
                prefer_manual = params.get('preferManual', True)
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': f'Invalid JSON data: {str(e)}'}).encode('utf-8'))
                return
            
            # Fetch videos concurrently
            results = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                future_to_url = {executor.submit(process_single_video, url, lang, prefer_manual): url for url in urls}
                for future in concurrent.futures.as_completed(future_to_url):
                    url = future_to_url[future]
                    try:
                        res = future.result()
                        if res:
                            results.append(res)
                    except Exception as exc:
                        results.append({
                            'url': url,
                            'status': 'error',
                            'error': str(exc)
                        })
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'results': results}).encode('utf-8'))
            
        elif parsed_path == '/api/beautify':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                params = json.loads(post_data.decode('utf-8'))
                text = params.get('text', '')
                api_key = params.get('apiKey', '')
                prompt_type = params.get('promptType', 'beautify')
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': f'Invalid JSON data: {str(e)}'}).encode('utf-8'))
                return
                
            if not text:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No text provided for beautification'}).encode('utf-8'))
                return
                
            if not HAS_GEMINI:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': "The Python library 'google-generativeai' is not installed. Please run 'pip install google-generativeai' in your console."
                }).encode('utf-8'))
                return
                
            key = api_key.strip() or os.environ.get("GEMINI_API_KEY", "")
            if not key:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': "Gemini API Key is missing. Please enter your API key in the configuration panel on the left."
                }).encode('utf-8'))
                return
            
            # Send Server-Sent Events headers for stream response
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            
            try:
                genai.configure(api_key=key)
                model_name = get_gemini_model(key)
                model = genai.GenerativeModel(model_name)
                
                # Context limit chunking
                chunks = chunk_text(text, max_words=4000)
                
                if len(chunks) == 1 or prompt_type == 'beautify':
                    for idx, chunk in enumerate(chunks):
                        prompt = get_prompt_text(prompt_type, chunk)
                        if len(chunks) > 1:
                            prompt = f"(Processing chunk {idx+1}/{len(chunks)})\n\n{prompt}"
                        
                        response = model.generate_content(prompt, stream=True)
                        for chunk_stream in response:
                            try:
                                val = chunk_stream.text
                                self.wfile.write(f"data: {json.dumps({'text': val})}\n\n".encode('utf-8'))
                                self.wfile.flush()
                            except Exception:
                                continue
                        if idx < len(chunks) - 1:
                            self.wfile.write(f"data: {json.dumps({'text': '\\n\\n'})}\n\n".encode('utf-8'))
                            self.wfile.flush()
                else:
                    # Map-Reduce Pattern for long-form Summary / Actions / Chapters
                    self.wfile.write(f"data: {json.dumps({'text': '*[AI is analyzing transcript sections in the background...]*\\n\\n'})}\n\n".encode('utf-8'))
                    self.wfile.flush()
                    
                    section_outputs = []
                    for idx, chunk in enumerate(chunks):
                        map_prompt = (
                            f"Summarize the key facts, points, and discussions in this transcript segment. "
                            f"Preserve all specific details, names, and key metrics. This is segment {idx+1} of {len(chunks)}.\n\n"
                            f"Transcript Segment:\n{chunk}"
                        )
                        res = model.generate_content(map_prompt)
                        section_outputs.append(res.text)
                        self.wfile.write(f"data: {json.dumps({'text': f'• Segment {idx+1}/{len(chunks)} processed...\\n'})}\n\n".encode('utf-8'))
                        self.wfile.flush()
                    
                    self.wfile.write(f"data: {json.dumps({'text': '\\n*[Generating final cohesive output...]*\\n\\n'})}\n\n".encode('utf-8'))
                    self.wfile.flush()
                    
                    combined_sections = "\n\n".join(section_outputs)
                    reduce_prompt = get_prompt_text(prompt_type, combined_sections)
                    
                    response = model.generate_content(reduce_prompt, stream=True)
                    for chunk_stream in response:
                        try:
                            val = chunk_stream.text
                            self.wfile.write(f"data: {json.dumps({'text': val})}\n\n".encode('utf-8'))
                            self.wfile.flush()
                        except Exception:
                            continue
                            
            except Exception as e:
                self.wfile.write(f"data: {json.dumps({'error': str(e)})}\n\n".encode('utf-8'))
                self.wfile.flush()
        else:
            self.send_error(404, "Not found")

def find_available_port(start_port: int = 8000, max_attempts: int = 20) -> int:
    import socket
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('', port))
                return port
            except OSError:
                continue
    raise OSError("Could not find any available port in range.")

def open_browser() -> None:
    """Poll socket until server is accepting connections, then open standard browser."""
    import socket
    for _ in range(50):  # poll up to 5 seconds
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.1):
                break
        except OSError:
            time.sleep(0.1)
    webbrowser.open(f"http://localhost:{PORT}")

def main() -> None:
    global PORT
    try:
        PORT = find_available_port(8000)
    except OSError as e:
        print(f"Error starting server: {str(e)}", file=sys.stderr)
        sys.exit(1)
        
    print(f"==================================================")
    print(f" YouTube Multi-Transcript Extractor App (Pro) ")
    print(f"==================================================")
    print(f"Starting server on http://localhost:{PORT}...")
    
    server_address = ('', PORT)
    httpd = ThreadedHTTPServer(server_address, TranscriptRequestHandler)
    
    # Launch browser in a separate thread
    browser_thread = threading.Thread(target=open_browser)
    browser_thread.daemon = True
    browser_thread.start()
    
    print(f"Server is running! Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...", file=sys.stderr)
        httpd.server_close()
        print("Server stopped.")

if __name__ == '__main__':
    main()
