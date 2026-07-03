// YouTube Transcript Hub Pro - Client Logic
let extractedVideos = [];

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Lucide Icons
    lucide.createIcons();
    
    // Check if SDK was loaded successfully
    updateSDKStatus();
    
    // Bind Action Buttons
    document.getElementById("extract-btn").addEventListener("click", handleExtraction);
    document.getElementById("open-help-btn").addEventListener("click", () => {
        document.getElementById("help-modal").style.display = "flex";
    });
    
    // Load previously cached Gemini Key
    const cachedKey = localStorage.getItem("gemini_api_key");
    if (cachedKey) {
        document.getElementById("gemini-key").value = cachedKey;
    }
    
    // First time visitor check
    const hasVisited = localStorage.getItem("has_visited_transcript_hub");
    if (!hasVisited) {
        document.getElementById("help-modal").style.display = "flex";
    }

    // Initialize Lite UI mode
    const liteModeToggle = document.getElementById("lite-mode-toggle");
    const isLite = localStorage.getItem("lite_ui_mode") === "true";
    if (isLite) {
        liteModeToggle.checked = true;
        document.body.classList.add("lite-mode");
    }
    liteModeToggle.addEventListener("change", (e) => {
        if (e.target.checked) {
            document.body.classList.add("lite-mode");
            localStorage.setItem("lite_ui_mode", "true");
            document.querySelectorAll(".card, .video-card, .stat-card, .skeleton-card").forEach(c => {
                c.style.transform = "none";
            });
        } else {
            document.body.classList.remove("lite-mode");
            localStorage.setItem("lite_ui_mode", "false");
        }
    });
    
    // Initialize 3D Tilt Effect
    apply3DTiltEffect();
});

function updateSDKStatus() {
    const statusText = document.getElementById("gemini-sdk-status");
    if (typeof HAS_GEMINI_SDK !== "undefined" && HAS_GEMINI_SDK) {
        statusText.innerHTML = '<span style="color:var(--success);"><i data-lucide="check-circle" size="12" style="display:inline-block; vertical-align:middle; margin-right:3px;"></i> Gemini SDK Ready</span>';
    } else {
        statusText.innerHTML = '<span style="color:var(--error);"><i data-lucide="alert-circle" size="12" style="display:inline-block; vertical-align:middle; margin-right:3px;"></i> SDK missing (genai needs pip install)</span>';
    }
    lucide.createIcons({ attrs: { class: "lucide-inline" } });
}

function toggleKeyVisibility() {
    const keyInput = document.getElementById("gemini-key");
    const eyeIcon = document.getElementById("toggle-key-visibility");
    if (keyInput.type === "password") {
        keyInput.type = "text";
        eyeIcon.setAttribute("data-lucide", "eye-off");
    } else {
        keyInput.type = "password";
        eyeIcon.setAttribute("data-lucide", "eye");
    }
    lucide.createIcons();
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(message, isError = false) {
    // Remove existing toast container if present
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.position = "fixed";
        container.style.bottom = "24px";
        container.style.right = "24px";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "10px";
        container.style.zIndex = "9999";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.style.background = isError ? "rgba(248, 113, 113, 0.95)" : "rgba(167, 139, 250, 0.95)";
    toast.style.color = "#fff";
    toast.style.padding = "12px 24px";
    toast.style.borderRadius = "10px";
    toast.style.fontSize = "0.9rem";
    toast.style.fontWeight = "600";
    toast.style.boxShadow = "0 8px 30px rgba(0,0,0,0.3)";
    toast.style.backdropFilter = "blur(10px)";
    toast.style.border = "1px solid rgba(255,255,255,0.1)";
    toast.style.transform = "translateY(50px)";
    toast.style.opacity = "0";
    toast.style.transition = "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    toast.textContent = message;

    container.appendChild(toast);
    
    // Animate In
    setTimeout(() => {
        toast.style.transform = "translateY(0)";
        toast.style.opacity = "1";
    }, 10);

    // Fade Out & Remove
    setTimeout(() => {
        toast.style.transform = "translateY(-20px)";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Convert MM:SS or HH:MM:SS format into seconds count
function timestampToSeconds(timestamp) {
    const clean = timestamp.replace(/[\[\]]/g, '');
    const parts = clean.split(':').map(Number);
    let sec = 0;
    if (parts.length === 3) {
        sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        sec = parts[0] * 60 + parts[1];
    }
    return sec;
}

// Format duration back to human readable
function parseTimestampToSRTTime(ts) {
    const clean = ts.replace(/[\[\]]/g, '');
    const [timeStr, msStr] = clean.split('.');
    const ms = msStr ? msStr.padEnd(3, '0').substring(0, 3) : '000';
    
    const parts = timeStr.split(':').map(Number);
    let h = 0, m = 0, s = 0;
    if (parts.length === 3) {
        h = parts[0];
        m = parts[1];
        s = parts[2];
    } else if (parts.length === 2) {
        m = parts[0];
        s = parts[1];
    }
    return `${padNum(h, 2)}:${padNum(m, 2)}:${padNum(s, 2)},${ms}`;
}

function offsetSRTTime(srtTime, offsetSec) {
    const timeAndMs = srtTime.split(',');
    const timePart = timeAndMs[0];
    const ms = timeAndMs[1] || '000';
    
    const parts = timePart.split(':').map(Number);
    let totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2] + offsetSec;
    if (totalSec < 0) totalSec = 0;
    
    const h = Math.floor(totalSec / 3600);
    totalSec %= 3600;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${padNum(h, 2)}:${padNum(m, 2)}:${padNum(s, 2)},${ms}`;
}

function padNum(num, size) {
    let s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

async function handleExtraction() {
    const urlsText = document.getElementById("urls").value;
    const lang = document.getElementById("lang").value;
    const preferManual = document.getElementById("prefer-manual").checked;
    
    const urls = urlsText.split("\n").map(u => u.trim()).filter(u => u.length > 0);
    
    if (urls.length === 0) {
        showToast("Please enter at least one YouTube URL.", true);
        return;
    }

    // Save key to local storage
    const key = document.getElementById("gemini-key").value.trim();
    if (key) {
        localStorage.setItem("gemini_api_key", key);
    } else {
        localStorage.removeItem("gemini_api_key");
    }

    const container = document.getElementById("results-container");
    container.innerHTML = "";
    document.getElementById("stats-dashboard").style.display = "none";
    
    // Inject Skeleton Cards
    urls.forEach(() => {
        container.innerHTML += `
            <div class="skeleton-card">
                <div class="skeleton-header">
                    <div class="skeleton-thumb skeleton"></div>
                    <div class="skeleton-info">
                        <div class="skeleton-title skeleton"></div>
                        <div class="skeleton-meta skeleton"></div>
                    </div>
                </div>
                <div class="skeleton-body skeleton"></div>
            </div>
        `;
    });

    try {
        const response = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls, lang, preferManual })
        });
        
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }

        const data = await response.json();
        extractedVideos = data.results || [];
        
        renderResults();
    } catch (e) {
        showToast(`Extraction error: ${e.message}`, true);
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="alert-triangle" size="48" style="color:var(--error);"></i>
                <p style="color:var(--error); font-weight:600;">Extraction Process Failed</p>
                <p style="font-size:0.9rem;">${escapeHTML(e.message)}</p>
            </div>
        `;
        lucide.createIcons();
    }
}

function renderResults() {
    const container = document.getElementById("results-container");
    container.innerHTML = "";

    if (extractedVideos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="youtube" size="48"></i>
                <p>No video information was loaded.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // Update statistics
    renderStatsDashboard();

    // Render Cards
    extractedVideos.forEach((video, index) => {
        if (video.status === "error") {
            container.appendChild(createErrorCard(video, index));
        } else {
            container.appendChild(createSuccessCard(video, index));
        }
    });

    lucide.createIcons();
    apply3DTiltEffect();
}

function renderStatsDashboard() {
    const dashboard = document.getElementById("stats-dashboard");
    const validVideos = extractedVideos.filter(v => v.status === "success");
    
    if (validVideos.length === 0) {
        dashboard.style.display = "none";
        return;
    }

    let totalWords = 0;
    validVideos.forEach(v => {
        totalWords += (v.raw_transcript || "").split(/\s+/).filter(w => w.length > 0).length;
    });

    const wordsPerMin = 150; // standard speaking/reading speed
    const estTime = Math.ceil(totalWords / wordsPerMin);

    dashboard.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Videos Extracted</div>
                <div class="stat-val">${validVideos.length} / ${extractedVideos.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Words</div>
                <div class="stat-val">${totalWords.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Est. Read Time</div>
                <div class="stat-val">${estTime} mins</div>
            </div>
            <div class="stat-card" style="cursor:pointer;" onclick="downloadAllCombinedTranscripts()">
                <div class="stat-label" style="color:var(--primary); font-weight:700;">Combine All</div>
                <div class="stat-val" style="display:flex; align-items:center; gap:6px; font-size:1.15rem; color:var(--primary);">
                    <i data-lucide="download" size="16"></i> Download All
                </div>
            </div>
        </div>
    `;
    dashboard.style.display = "block";
    lucide.createIcons();
}

function createErrorCard(video, index) {
    const card = document.createElement("div");
    card.className = "video-card";
    
    const escapedUrl = escapeHTML(video.url);
    const escapedTitle = escapeHTML(video.title || "Failed Extraction Target");
    const escapedError = escapeHTML(video.error || "An unknown retrieval error occurred.");
    
    card.innerHTML = `
        <div class="video-header" style="grid-template-columns: 1fr;">
            <div class="video-info">
                <div class="video-title-row">
                    <h3 class="video-title" style="color:var(--error);">${escapedTitle}</h3>
                </div>
                <div class="meta-row">
                    <span class="badge error"><i data-lucide="alert-triangle" size="12"></i> Extraction Error</span>
                    <span class="badge" style="font-size:0.75rem; font-family:'Fira Code', monospace;">${escapedUrl}</span>
                </div>
                <div style="background:rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.15); padding:16px; border-radius:12px; font-size:0.88rem; line-height:1.5; color:var(--error);">
                    ${escapedError}
                </div>
            </div>
        </div>
    `;
    return card;
}

function createSuccessCard(video, index) {
    const card = document.createElement("div");
    card.className = "video-card";
    card.id = `video-card-${index}`;

    const escapedTitle = escapeHTML(video.title);
    const escapedViews = escapeHTML(video.views);
    const escapedThumb = escapeHTML(video.thumbnail);
    const escapedLang = escapeHTML(video.language);

    card.innerHTML = `
        <div class="video-header">
            <div class="thumb-container">
                <img src="${escapedThumb}" alt="Thumbnail">
                <span class="views-badge">${escapedViews}</span>
            </div>
            <div class="video-info">
                <div class="video-title-row">
                    <h3 class="video-title">${escapedTitle}</h3>
                    <div class="audio-wave">
                        <div class="audio-wave-bar"></div>
                        <div class="audio-wave-bar"></div>
                        <div class="audio-wave-bar"></div>
                        <div class="audio-wave-bar"></div>
                    </div>
                </div>
                
                <div class="meta-row">
                    <span class="badge success"><i data-lucide="check-circle" size="12"></i> Active Transcript</span>
                    <span class="badge"><i data-lucide="globe" size="12"></i> Lang: ${escapedLang.toUpperCase()}</span>
                </div>

                <div class="video-actions">
                    <button class="action-btn" onclick="copyTranscriptToClipboard(${index})">
                        <i data-lucide="copy" size="14"></i> Copy Raw
                    </button>
                    <button class="action-btn" onclick="downloadTranscript(${index}, 'txt')">
                        <i data-lucide="download" size="14"></i> Export Text
                    </button>
                    <button class="action-btn" onclick="downloadSubtitleFile(${index}, 'srt')">
                        <i data-lucide="subtitles" size="14"></i> Export SRT
                    </button>
                    <button class="action-btn" onclick="downloadSubtitleFile(${index}, 'vtt')">
                        <i data-lucide="file-text" size="14"></i> Export VTT
                    </button>
                </div>
            </div>
        </div>

        <div class="transcript-container">
            <div class="tabs">
                <button class="tab-btn active" id="tab-ts-${index}" onclick="switchTab(${index}, 'ts')">
                    <i data-lucide="clock" size="14"></i> Timestamps
                </button>
                <button class="tab-btn" id="tab-raw-${index}" onclick="switchTab(${index}, 'raw')">
                    <i data-lucide="align-left" size="14"></i> Raw Text
                </button>
                <button class="tab-btn" id="tab-ai-${index}" onclick="switchTab(${index}, 'ai')">
                    <i data-lucide="sparkles" size="14"></i> AI Features
                </button>
            </div>

            <!-- Timestamps View -->
            <div id="panel-ts-${index}">
                <div class="controls-row" style="margin-bottom:12px;">
                    <div class="filter-wrapper">
                        <i data-lucide="search" size="14"></i>
                        <input type="text" id="filter-input-${index}" placeholder="Filter by text match..." oninput="handleSearchFilter(${index})">
                    </div>
                    <div class="match-count-badge" id="match-count-${index}" style="color:var(--text-muted);"></div>
                </div>

                <div class="transcript-box" id="box-ts-${index}">
                    ${renderTimestampedLines(video.ts_transcript, video.url)}
                </div>
            </div>

            <!-- Raw Text View -->
            <div id="panel-raw-${index}" style="display:none;">
                <div class="controls-row" style="margin-bottom: 12px; justify-content: flex-end;">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Fonts</span>
                        <div style="display:flex; background:rgba(0,0,0,0.2); padding:3px; border-radius:8px; border:1px solid var(--border-color);">
                            <button class="tab-btn" style="padding:4px 8px; font-size:0.72rem; border-radius:6px; background:rgba(192, 132, 252, 0.15); color:var(--primary);" id="font-sans-${index}" onclick="changeFont(${index}, 'sans')">Sans</button>
                            <button class="tab-btn" style="padding:4px 8px; font-size:0.72rem; border-radius:6px;" id="font-mono-${index}" onclick="changeFont(${index}, 'mono')">Mono</button>
                        </div>
                        <div style="display:flex; background:rgba(0,0,0,0.2); padding:3px; border-radius:8px; border:1px solid var(--border-color);">
                            <button class="tab-btn" style="padding:4px 8px; font-size:0.72rem; border-radius:6px;" onclick="changeFontSize(${index}, -1)"><i data-lucide="minus" size="10"></i></button>
                            <button class="tab-btn" style="padding:4px 8px; font-size:0.72rem; border-radius:6px; cursor:default;" id="size-indicator-${index}">100%</button>
                            <button class="tab-btn" style="padding:4px 8px; font-size:0.72rem; border-radius:6px;" onclick="changeFontSize(${index}, 1)"><i data-lucide="plus" size="10"></i></button>
                        </div>
                    </div>
                </div>
                <div class="transcript-box" id="box-raw-${index}" style="font-family:'Inter', sans-serif;">
                    ${escapeHTML(video.raw_transcript)}
                </div>
            </div>

            <!-- AI Features View -->
            <div id="panel-ai-${index}" style="display:none;">
                <div class="beautify-prompt-card" id="ai-intro-${index}">
                    <div style="display:flex; gap:12px; align-items:center; width:100%; justify-content:center;">
                        <div class="input-group" style="flex-grow:0; width:180px; text-align:left;">
                            <label for="ai-prompt-type-${index}">AI Tasks</label>
                            <select id="ai-prompt-type-${index}" style="margin-top:4px;">
                                <option value="beautify">Beautify Transcript</option>
                                <option value="summary">Generate Summary</option>
                                <option value="action_items">Extract Action Items</option>
                                <option value="chapters">Generate Chapters</option>
                            </select>
                        </div>
                        <button class="btn" style="align-self:flex-end; height:45px;" onclick="triggerStreamingBeautify(${index})">
                            <i data-lucide="sparkles"></i> Process with Gemini
                        </button>
                    </div>
                </div>

                <div id="ai-loading-${index}" style="display:none;">
                    <div class="beautify-prompt-card">
                        <div class="spinner"></div>
                        <p style="margin:0; font-size:0.9rem;">Receiving streaming AI output chunk-by-chunk...</p>
                    </div>
                </div>

                <div id="ai-result-panel-${index}" style="display:none; flex-direction:column; gap:12px;">
                    <div class="controls-row" style="justify-content: flex-end;">
                        <div style="display:flex; gap:6px;">
                            <button class="action-btn" onclick="copyAITextToClipboard(${index})">
                                <i data-lucide="copy" size="12"></i> Copy
                            </button>
                            <button class="action-btn" onclick="downloadAIText(${index}, 'md')">
                                <i data-lucide="download" size="12"></i> Export MD
                            </button>
                            <button class="action-btn" onclick="printAITranscript(${index})">
                                <i data-lucide="printer" size="12"></i> Print/PDF
                            </button>
                        </div>
                    </div>
                    <div class="transcript-box" id="box-ai-${index}" style="max-height:350px; font-family:'Inter', sans-serif; white-space:pre-wrap; line-height:1.75; font-size:0.98rem; background:rgba(192, 132, 252, 0.02); border-color:rgba(192, 132, 252, 0.15);"></div>
                </div>
            </div>
        </div>
    `;
    return card;
}

function renderTimestampedLines(tsLines, videoUrl) {
    if (!tsLines || tsLines.length === 0) {
        return `<p style="color:var(--text-muted); margin:0;">No timestamped transcript matches available.</p>`;
    }
    
    const vId = extractVideoId(videoUrl);
    
    return tsLines.map(line => {
        const secs = timestampToSeconds(line.timestamp);
        const jumpLink = vId ? `https://youtu.be/${vId}?t=${secs}` : `${videoUrl}&t=${secs}s`;
        
        return `
            <div class="transcript-line">
                <span class="line-ts" onclick="copyJumpLink('${escapeHTML(jumpLink)}')">${escapeHTML(line.timestamp)}</span>
                <span class="line-txt">${escapeHTML(line.text)}</span>
            </div>
        `;
    }).join("");
}

function copyJumpLink(link) {
    navigator.clipboard.writeText(link).then(() => {
        showToast("Copied jump link: " + link);
    }).catch(err => {
        showToast("Failed to copy link: " + err, true);
    });
}

function switchTab(index, tabType) {
    const videoCard = document.getElementById(`video-card-${index}`);
    
    // Deactivate all tabs and panels
    const tabs = ["ts", "raw", "ai"];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}-${index}`);
        const panel = document.getElementById(`panel-${t}-${index}`);
        if (btn) btn.classList.remove("active");
        if (panel) panel.style.display = "none";
    });

    // Activate the targeted tab and panel
    const activeBtn = document.getElementById(`tab-${tabType}-${index}`);
    const activePanel = document.getElementById(`panel-${tabType}-${index}`);
    if (activeBtn) activeBtn.classList.add("active");
    if (activePanel) {
        if (tabType === 'ai') {
            activePanel.style.display = "flex";
            activePanel.style.flexDirection = "column";
        } else {
            activePanel.style.display = "block";
        }
    }
}

function handleSearchFilter(index) {
    const query = document.getElementById(`filter-input-${index}`).value.toLowerCase().trim();
    const box = document.getElementById(`box-ts-${index}`);
    const matchBadge = document.getElementById(`match-count-${index}`);
    const video = extractedVideos[index];
    
    if (!video || !video.ts_transcript) return;
    
    const lines = box.getElementsByClassName("transcript-line");
    
    if (query === "") {
        // Reset view
        for (let i = 0; i < lines.length; i++) {
            lines[i].style.display = "flex";
            const textSpan = lines[i].getElementsByClassName("line-txt")[0];
            textSpan.innerHTML = escapeHTML(video.ts_transcript[i].text);
        }
        matchBadge.textContent = "";
        return;
    }

    let matchCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const rawText = video.ts_transcript[i].text;
        const lowerText = rawText.toLowerCase();
        
        if (lowerText.includes(query)) {
            lines[i].style.display = "flex";
            matchCount++;
            
            // Highlight matching parts securely
            const regex = new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
            const highlightedText = escapeHTML(rawText).replace(regex, '<mark>$1</mark>');
            const textSpan = lines[i].getElementsByClassName("line-txt")[0];
            textSpan.innerHTML = highlightedText;
        } else {
            lines[i].style.display = "none";
        }
    }
    
    matchBadge.textContent = `${matchCount} match${matchCount === 1 ? '' : 'es'} found`;
}

// Client Side Typography Toggles
const fontSizes = {}; // Keep sizes cached

function changeFont(index, type) {
    const boxRaw = document.getElementById(`box-raw-${index}`);
    const btnSans = document.getElementById(`font-sans-${index}`);
    const btnMono = document.getElementById(`font-mono-${index}`);
    
    if (type === 'mono') {
        boxRaw.style.fontFamily = "'Fira Code', monospace";
        btnMono.style.background = "rgba(192, 132, 252, 0.15)";
        btnMono.style.color = "var(--primary)";
        btnSans.style.background = "transparent";
        btnSans.style.color = "var(--text-muted)";
    } else {
        boxRaw.style.fontFamily = "'Inter', sans-serif";
        btnSans.style.background = "rgba(192, 132, 252, 0.15)";
        btnSans.style.color = "var(--primary)";
        btnMono.style.background = "transparent";
        btnMono.style.color = "var(--text-muted)";
    }
}

function changeFontSize(index, direction) {
    if (!fontSizes[index]) fontSizes[index] = 100;
    
    fontSizes[index] = Math.max(70, Math.min(180, fontSizes[index] + (direction * 15)));
    
    const boxRaw = document.getElementById(`box-raw-${index}`);
    const indicator = document.getElementById(`size-indicator-${index}`);
    
    boxRaw.style.fontSize = `${fontSizes[index] / 100}rem`;
    indicator.textContent = `${fontSizes[index]}%`;
}

// Streaming AI Processing
async function triggerStreamingBeautify(index) {
    const video = extractedVideos[index];
    if (!video || !video.raw_transcript) return;

    const apiKeyInput = document.getElementById("gemini-key").value.trim();
    
    const introCard = document.getElementById(`ai-intro-${index}`);
    const loadingCard = document.getElementById(`ai-loading-${index}`);
    const resultCard = document.getElementById(`ai-result-panel-${index}`);
    const resultBox = document.getElementById(`box-ai-${index}`);
    const promptSelect = document.getElementById(`ai-prompt-type-${index}`);
    const promptType = promptSelect.value;
    
    introCard.style.display = "none";
    loadingCard.style.display = "block";
    resultCard.style.display = "none";
    resultBox.textContent = "";

    try {
        const response = await fetch("/api/beautify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: video.raw_transcript,
                apiKey: apiKeyInput,
                promptType: promptType
            })
        });

        if (!response.ok) {
            // Handle JSON error body if available
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server HTTP ${response.status}`);
        }

        loadingCard.style.display = "none";
        resultCard.style.display = "flex";

        // Read Fetch ReadableStream for chunk-by-chunk SSE processing
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            
            // Keep incomplete last line in the buffer
            buffer = lines.pop();

            for (const line of lines) {
                const cleanLine = line.trim();
                if (cleanLine.startsWith("data: ")) {
                    const dataStr = cleanLine.substring(6);
                    try {
                        const payload = JSON.parse(dataStr);
                        if (payload.error) {
                            throw new Error(payload.error);
                        }
                        if (payload.text) {
                            // Append streamed text securely
                            resultBox.textContent += payload.text;
                        }
                    } catch (jsonErr) {
                        // Suppress JSON parse failures for partial segments
                    }
                }
            }
        }
    } catch (e) {
        showToast(e.message, true);
        introCard.style.display = "flex";
        loadingCard.style.display = "none";
        resultCard.style.display = "none";
        
        // Re-inject error warning message to panel
        introCard.innerHTML = `
            <div style="color:var(--error); font-weight:600; font-size:0.92rem; margin-bottom:10px;">
                Gemini API Error: ${escapeHTML(e.message)}
            </div>
            <div style="display:flex; gap:12px; align-items:center; width:100%; justify-content:center;">
                <div class="input-group" style="flex-grow:0; width:180px; text-align:left;">
                    <label for="ai-prompt-type-${index}">AI Tasks</label>
                    <select id="ai-prompt-type-${index}" style="margin-top:4px;">
                        <option value="beautify">Beautify Transcript</option>
                        <option value="summary">Generate Summary</option>
                        <option value="action_items">Extract Action Items</option>
                        <option value="chapters">Generate Chapters</option>
                    </select>
                </div>
                <button class="btn" style="align-self:flex-end; height:45px;" onclick="triggerStreamingBeautify(${index})">
                    <i data-lucide="refresh-cw"></i> Retry Process
                </button>
            </div>
        `;
        lucide.createIcons();
    }
}

// Copy utilities
function copyTranscriptToClipboard(index) {
    const video = extractedVideos[index];
    if (!video) return;
    navigator.clipboard.writeText(video.raw_transcript).then(() => {
        showToast("Raw transcript copied to clipboard!");
    });
}

function copyAITextToClipboard(index) {
    const box = document.getElementById(`box-ai-${index}`);
    if (!box) return;
    navigator.clipboard.writeText(box.textContent).then(() => {
        showToast("AI output copied to clipboard!");
    });
}

// Exporters
function downloadTranscript(index) {
    const video = extractedVideos[index];
    if (!video) return;
    const blob = new Blob([video.raw_transcript], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${sanitizeFilename(video.title)}_transcript.txt`;
    link.click();
    showToast("Downloaded text transcript!");
}

function downloadSubtitleFile(index, type) {
    const video = extractedVideos[index];
    if (!video || !video.ts_transcript) return;
    
    let content = "";
    if (type === "vtt") {
        content = "WEBVTT\n\n";
        video.ts_transcript.forEach((line, i) => {
            const start = parseTimestampToSRTTime(line.timestamp).replace(',', '.');
            let end;
            if (i < video.ts_transcript.length - 1) {
                end = parseTimestampToSRTTime(video.ts_transcript[i+1].timestamp).replace(',', '.');
            } else {
                end = offsetSRTTime(parseTimestampToSRTTime(line.timestamp), 5).replace(',', '.');
            }
            content += `${start} --> ${end}\n${line.text}\n\n`;
        });
    } else {
        // SRT format
        video.ts_transcript.forEach((line, i) => {
            const start = parseTimestampToSRTTime(line.timestamp);
            let end;
            if (i < video.ts_transcript.length - 1) {
                end = parseTimestampToSRTTime(video.ts_transcript[i+1].timestamp);
            } else {
                end = offsetSRTTime(start, 5);
            }
            content += `${i + 1}\n${start} --> ${end}\n${line.text}\n\n`;
        });
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${sanitizeFilename(video.title)}.${type}`;
    link.click();
    showToast(`Downloaded ${type.toUpperCase()} subtitle file!`);
}

function downloadAIText(index) {
    const video = extractedVideos[index];
    const box = document.getElementById(`box-ai-${index}`);
    if (!video || !box) return;
    
    const content = box.textContent;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${sanitizeFilename(video.title)}_ai_processed.md`;
    link.click();
    showToast("Downloaded AI Markdown file!");
}

function downloadAllCombinedTranscripts() {
    const validVideos = extractedVideos.filter(v => v.status === "success");
    if (validVideos.length === 0) return;

    let combinedText = "YOUTUBE TRANSCRIPTS COMPILATION\n";
    combinedText += `Generated on: ${new Date().toLocaleString()}\n`;
    combinedText += `Total Videos: ${validVideos.length}\n`;
    combinedText += `========================================================\n\n`;

    validVideos.forEach((v, index) => {
        combinedText += `[${index + 1}] TITLE: ${v.title}\n`;
        combinedText += `URL: ${v.url}\n`;
        combinedText += `VIEWS: ${v.views}\n`;
        combinedText += `--------------------------------------------------------\n`;
        combinedText += `${v.raw_transcript}\n\n\n`;
    });

    const blob = new Blob([combinedText], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `combined_youtube_transcripts.txt`;
    link.click();
    showToast("Downloaded compiled transcripts!");
}

function sanitizeFilename(filename) {
    return filename.replace(/[\\/*?:"<>|]/g, "").trim();
}

function printAITranscript(index) {
    const video = extractedVideos[index];
    const box = document.getElementById(`box-ai-${index}`);
    if (!video || !box) return;

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
        <html>
        <head>
            <title>${escapeHTML(video.title)} - AI Processed Output</title>
            <style>
                body {
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    line-height: 1.65;
                    color: #111827;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 40px 20px;
                }
                h1 {
                    font-size: 2.2rem;
                    border-bottom: 2px solid #e5e7eb;
                    padding-bottom: 12px;
                    margin-bottom: 8px;
                }
                .meta {
                    color: #6b7280;
                    font-size: 0.9rem;
                    margin-bottom: 30px;
                }
                .content {
                    font-size: 1.1rem;
                    white-space: pre-wrap;
                }
                @media print {
                    body {
                        padding: 0;
                    }
                    button {
                        display: none;
                    }
                }
            </style>
        </head>
        <body>
            <h1>${escapeHTML(video.title)}</h1>
            <div class="meta">
                Source: <a href="${escapeHTML(video.url)}" target="_blank">${escapeHTML(video.url)}</a> | Views: ${escapeHTML(video.views)}
            </div>
            <div class="content">${escapeHTML(box.textContent)}</div>
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function apply3DTiltEffect() {
    document.querySelectorAll(".card, .video-card, .stat-card, .skeleton-card").forEach(card => {
        // Reset transform to let CSS transitions work properly
        card.style.transition = "transform 0.15s ease, box-shadow 0.15s ease";
        
        card.addEventListener("mousemove", e => {
            if (document.body.classList.contains("lite-mode")) return;
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const offsetRefX = (x - centerX) / centerX;
            const offsetRefY = (y - centerY) / centerY;
            
            const maxTiltAngle = 6;
            const tiltX = -offsetRefY * maxTiltAngle;
            const tiltY = offsetRefX * maxTiltAngle;
            
            card.style.transform = `perspective(1000px) translateY(-5px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) scale(1.008)`;
        });
        
        card.addEventListener("mouseleave", () => {
            card.style.transform = "none";
        });
    });
}

function closeHelpModal() {
    document.getElementById("help-modal").style.display = "none";
    localStorage.setItem("has_visited_transcript_hub", "true");
}
