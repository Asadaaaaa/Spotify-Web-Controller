document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const offlineScreen = document.getElementById('offline-screen');
    const ambientGlow = document.getElementById('ambient-glow');

    // Player Elements
    const albumArt = document.getElementById('album-art');
    const vinylRecord = document.getElementById('vinyl-record');
    const albumContainer = document.querySelector('.album-container');
    const trackTitle = document.getElementById('track-title');
    const trackArtist = document.getElementById('track-artist');
    const timeCurrent = document.getElementById('time-current');
    const timeDuration = document.getElementById('time-duration');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressHandle = document.getElementById('progress-handle');

    // Control Buttons
    const btnPlay = document.getElementById('btn-play');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnShuffle = document.getElementById('btn-shuffle');
    const btnRepeat = document.getElementById('btn-repeat');
    // const btnLike = document.getElementById('btn-like');

    // Volume Elements
    const btnMute = document.getElementById('btn-mute');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeFill = document.getElementById('volume-fill');
    const volumePercentage = document.getElementById('volume-percentage');

    // Search Elements
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const searchPlaceholder = document.getElementById('search-placeholder');
    const searchLoading = document.getElementById('search-loading');
    const searchNoResults = document.getElementById('search-no-results');
    const searchResultsList = document.getElementById('search-results-list');

    // Queue Elements (sidebar)
    const queueCurrentItem = document.getElementById('queue-current-item');
    const queueUserTitle = document.getElementById('queue-user-title');
    const queueUserList = document.getElementById('queue-user-list');
    const queueContextTitle = document.getElementById('queue-context-title');
    const queueContextList = document.getElementById('queue-context-list');
    const queueDrawer = document.getElementById('queue-drawer');

    // Queue Modal Elements (bottom-sheet for small screens)
    const queueModalOverlay = document.getElementById('queue-modal-overlay');
    const queueModalCurrentItem = document.getElementById('queue-modal-current-item');
    const queueModalUserTitle = document.getElementById('queue-modal-user-title');
    const queueModalUserList = document.getElementById('queue-modal-user-list');
    const queueModalContextTitle = document.getElementById('queue-modal-context-title');
    const queueModalContextList = document.getElementById('queue-modal-context-list');
    const btnQueueModal = document.getElementById('btn-queue-modal');
    const btnCloseQueueModal = document.getElementById('btn-close-queue-modal');
    const btnLyricsMobile = document.getElementById('btn-lyrics-mobile');

    // PiP Instructions Modal Elements
    const pipModalOverlay = document.getElementById('pip-modal-overlay');
    const btnClosePipModal = document.getElementById('btn-close-pip-modal');
    const pipHttpsLink = document.getElementById('pip-https-link');

    // Lyrics Elements
    const lyricsPlaceholder = document.getElementById('lyrics-placeholder');
    const lyricsLoading = document.getElementById('lyrics-loading');
    const lyricsEmpty = document.getElementById('lyrics-empty');
    const lyricsContent = document.getElementById('lyrics-content');
    const lyricsLines = document.getElementById('lyrics-lines');
    const mobileLyricsView = document.getElementById('mobile-lyrics-view');
    const mobileLyricsPlaceholder = document.getElementById('mobile-lyrics-placeholder');
    const mobileLyricsLoading = document.getElementById('mobile-lyrics-loading');
    const mobileLyricsEmpty = document.getElementById('mobile-lyrics-empty');
    const mobileLyricsContent = document.getElementById('mobile-lyrics-content');
    const mobileLyricsLines = document.getElementById('mobile-lyrics-lines');

    // Floating Lyrics Button
    const btnFloatingLyrics = document.getElementById('btn-floating-lyrics');

    // Connected Clients Elements
    const btnClientsToggle = document.getElementById('btn-clients-toggle');
    const clientsPopover = document.getElementById('clients-popover');
    const clientsCount = document.getElementById('clients-count');
    const inputMyName = document.getElementById('input-my-name');
    const btnSaveMyName = document.getElementById('btn-save-my-name');
    const clientsListContainer = document.getElementById('clients-list-container');

    // Search Results Overlay
    const searchResultsOverlay = document.getElementById('search-results-overlay');

    // Application State
    let socket = null;
    let isConnected = false;
    let myClientId = null;
    let myClientName = '';
    let playbackState = {
        track: null,
        progress: 0,
        duration: 0,
        isPlaying: false,
        volume: 0.5,
        shuffle: false,
        repeat: 0,
        heart: false
    };
    let localProgressTimer = null;
    let searchDebounceTimeout = null;
    let previousVolume = 0.5;
    let isDraggingVolume = false;
    let volumeCooldownTimer = null;
    let lyricsState = {
        trackKey: '',
        loading: false,
        source: '',
        synced: false,
        lines: [],
        rawText: '',
        activeIndex: -1
    };
    let isMobileLyricsOpen = false;

    // Blocked keywords filter state — populated from server on connect
    // Each keyword is a string; matching is case-insensitive, min 5 chars
    let blockedKeywords = [];
    let currentServerId = null;

    // Convert spotify image URIs to public HTTP URLs
    function getImageUrl(uri) {
        if (!uri) return '';
        if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
        if (uri.startsWith('spotify:image:')) {
            return 'https://i.scdn.co/image/' + uri.substring(14);
        }
        if (uri.startsWith('spotify:mosaic:')) {
            return 'https://mosaic.scdn.co/300/' + uri.substring(15);
        }
        if (/^[0-9a-fA-F]{40}$/.test(uri)) {
            return 'https://i.scdn.co/image/' + uri;
        }
        return uri;
    }

    // Close search suggestions when clicking outside
    document.addEventListener('click', (e) => {
        const searchContainer = document.querySelector('.search-bar-container');
        if (searchContainer && !searchContainer.contains(e.target)) {
            searchResultsOverlay.classList.remove('open');
        }
    });

    // --- Queue Modal Handlers ---
    function openQueueModal() {
        if (isMobileLyricsOpen) closeMobileLyricsView();
        queueModalOverlay.classList.add('open');
        btnQueueModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeQueueModal() {
        queueModalOverlay.classList.remove('open');
        btnQueueModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    btnQueueModal.addEventListener('click', openQueueModal);
    btnCloseQueueModal.addEventListener('click', closeQueueModal);

    function openMobileLyricsView() {
        queueModalOverlay.classList.remove('open');
        btnQueueModal.classList.remove('active');
        isMobileLyricsOpen = true;
        if (mobileLyricsView) mobileLyricsView.style.display = 'flex';
        if (albumContainer) albumContainer.style.display = 'none';
        if (btnLyricsMobile) btnLyricsMobile.classList.add('active');
    }

    function closeMobileLyricsView() {
        isMobileLyricsOpen = false;
        if (mobileLyricsView) mobileLyricsView.style.display = 'none';
        if (albumContainer) albumContainer.style.display = '';
        if (btnLyricsMobile) btnLyricsMobile.classList.remove('active');
    }

    btnLyricsMobile.addEventListener('click', () => {
        if (isMobileLyricsOpen) {
            closeMobileLyricsView();
        } else {
            openMobileLyricsView();
        }
    });

    // --- Floating Lyrics Handlers ---
    let pipWindow = null;

    async function toggleFloatingLyrics() {
        console.log('toggleFloatingLyrics called. documentPictureInPicture support:', 'documentPictureInPicture' in window);
        if ('documentPictureInPicture' in window) {
            if (pipWindow) {
                console.log('Closing existing PiP window');
                pipWindow.close();
                return;
            }

            try {
                console.log('Requesting Document PiP window...');
                pipWindow = await window.documentPictureInPicture.requestWindow({
                    width: 380,
                    height: 500
                });
                console.log('PiP Window object returned:', pipWindow);

                // Copy Google Font links explicitly to PiP window safely
                try {
                    const fontLinks = document.querySelectorAll('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"], link[href*="css2"]');
                    fontLinks.forEach(link => {
                        const clonedLink = pipWindow.document.createElement('link');
                        clonedLink.rel = link.rel || 'stylesheet';
                        clonedLink.href = link.href;
                        if (link.crossOrigin) clonedLink.crossOrigin = link.crossOrigin;
                        pipWindow.document.head.appendChild(clonedLink);
                    });
                } catch (e) {
                    console.warn('Failed to copy font links:', e);
                }

                // Copy styles to PiP window safely
                try {
                    [...document.styleSheets].forEach((styleSheet) => {
                        try {
                            if (styleSheet.cssRules) {
                                const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                                const style = pipWindow.document.createElement('style');
                                style.textContent = cssRules;
                                pipWindow.document.head.appendChild(style);
                            } else if (styleSheet.href) {
                                const link = pipWindow.document.createElement('link');
                                link.rel = 'stylesheet';
                                link.href = styleSheet.href;
                                pipWindow.document.head.appendChild(link);
                            }
                        } catch (e) {
                            if (styleSheet.href) {
                                const link = pipWindow.document.createElement('link');
                                link.rel = 'stylesheet';
                                link.href = styleSheet.href;
                                pipWindow.document.head.appendChild(link);
                            }
                        }
                    });
                } catch (e) {
                    console.warn('Failed to copy stylesheets:', e);
                }

                // Set body style
                pipWindow.document.body.style.background = '#07080a';
                pipWindow.document.body.style.margin = '0';
                pipWindow.document.body.style.padding = '20px';
                pipWindow.document.body.style.overflow = 'hidden';
                pipWindow.document.body.style.height = '100vh';
                pipWindow.document.body.style.display = 'flex';
                pipWindow.document.body.style.flexDirection = 'column';
                pipWindow.document.body.style.boxSizing = 'border-box';

                // Add container
                const wrapper = pipWindow.document.createElement('div');
                wrapper.className = 'lyrics-wrapper';
                wrapper.id = 'pip-lyrics-wrapper';
                wrapper.style.height = '100%';
                wrapper.style.overflowY = 'auto';
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';

                wrapper.innerHTML = `
                    <div class="lyrics-state" id="pip-lyrics-placeholder" style="display: flex;">
                        <i class="fa-solid fa-music"></i>
                        <h3>Lyrics will appear here</h3>
                        <p>Start playing a track to see synced or plain lyrics.</p>
                    </div>
                    <div class="lyrics-state" id="pip-lyrics-loading" style="display: none;">
                        <div class="spinner"></div>
                        <p>Loading lyrics...</p>
                    </div>
                    <div class="lyrics-state" id="pip-lyrics-empty" style="display: none;">
                        <i class="fa-regular fa-comment-dots"></i>
                        <h3>No lyrics found</h3>
                        <p>This track may not be available in the lyrics database.</p>
                    </div>
                    <div class="lyrics-content" id="pip-lyrics-content" style="display: none; flex-direction: column; min-height: 100%;">
                        <div class="lyrics-lines" id="pip-lyrics-lines"></div>
                    </div>
                `;

                pipWindow.document.body.appendChild(wrapper);

                if (btnFloatingLyrics) btnFloatingLyrics.classList.add('active');

                // Trigger initial sync
                updatePipLyricsUI();

                pipWindow.addEventListener('pagehide', (e) => {
                    console.log('PiP window closed (pagehide event triggered). Event:', e);
                    pipWindow = null;
                    if (btnFloatingLyrics) btnFloatingLyrics.classList.remove('active');
                });

            } catch (err) {
                console.error('Failed to open Document Picture-in-Picture window:', err);
                alert('Failed to open Picture-in-Picture window. Please verify permissions or try again.');
            }
        } else {
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                if (pipHttpsLink) {
                    const secureUrl = `https://${window.location.hostname}:8443`;
                    pipHttpsLink.href = secureUrl;
                    pipHttpsLink.textContent = secureUrl;
                }
                if (pipModalOverlay) {
                    pipModalOverlay.classList.add('open');
                }
            } else {
                alert('Document Picture-in-Picture is not supported in this browser. Please use Chrome, Edge, or Opera.');
            }
        }
    }

    if (btnFloatingLyrics) {
        btnFloatingLyrics.addEventListener('click', toggleFloatingLyrics);
    }

    if (btnClosePipModal) {
        btnClosePipModal.addEventListener('click', () => {
            if (pipModalOverlay) pipModalOverlay.classList.remove('open');
        });
    }

    if (pipModalOverlay) {
        pipModalOverlay.addEventListener('click', (e) => {
            if (e.target === pipModalOverlay) {
                pipModalOverlay.classList.remove('open');
            }
        });
    }

    function updatePipLyricsUI() {
        if (!pipWindow) return;
        const doc = pipWindow.document;
        const pipPlaceholder = doc.getElementById('pip-lyrics-placeholder');
        const pipLoading = doc.getElementById('pip-lyrics-loading');
        const pipEmpty = doc.getElementById('pip-lyrics-empty');
        const pipContent = doc.getElementById('pip-lyrics-content');
        const pipLines = doc.getElementById('pip-lyrics-lines');

        if (!playbackState.track) {
            if (pipPlaceholder) pipPlaceholder.style.display = 'flex';
            if (pipLoading) pipLoading.style.display = 'none';
            if (pipEmpty) pipEmpty.style.display = 'none';
            if (pipContent) pipContent.style.display = 'none';
            if (pipLines) pipLines.innerHTML = '';
            return;
        }

        if (lyricsState.loading) {
            if (pipPlaceholder) pipPlaceholder.style.display = 'none';
            if (pipEmpty) pipEmpty.style.display = 'none';
            if (pipLoading) pipLoading.style.display = 'flex';
            if (pipContent) pipContent.style.display = 'none';
            return;
        }

        if (lyricsState.lines.length === 0 && !lyricsState.rawText) {
            if (pipPlaceholder) pipPlaceholder.style.display = 'none';
            if (pipLoading) pipLoading.style.display = 'none';
            if (pipContent) pipContent.style.display = 'none';
            if (pipEmpty) pipEmpty.style.display = 'flex';
            return;
        }

        if (pipPlaceholder) pipPlaceholder.style.display = 'none';
        if (pipLoading) pipLoading.style.display = 'none';
        if (pipEmpty) pipEmpty.style.display = 'none';
        if (pipContent) pipContent.style.display = 'flex';

        // Render lines inside PiP
        if (pipLines) {
            pipLines.innerHTML = '';
            if (lyricsState.lines.length === 0) {
                const emptyLine = doc.createElement('div');
                emptyLine.className = 'lyrics-line empty';
                emptyLine.textContent = lyricsState.rawText || 'No lyrics available.';
                pipLines.appendChild(emptyLine);
            } else {
                lyricsState.lines.forEach((line, index) => {
                    const lineEl = doc.createElement('div');
                    lineEl.className = 'lyrics-line';
                    lineEl.dataset.index = String(index);
                    lineEl.dataset.time = String(typeof line.time === 'number' ? line.time : -1);

                    const textSpan = doc.createElement('span');
                    textSpan.textContent = line.text || '';
                    lineEl.appendChild(textSpan);

                    pipLines.appendChild(lineEl);
                });
            }
        }

        // Highlight
        updatePipLyricsHighlight(playbackState.progress);
    }

    function updatePipLyricsHighlight(progressMs) {
        if (!pipWindow) return;
        const doc = pipWindow.document;
        const pipLines = doc.getElementById('pip-lyrics-lines');
        if (!pipLines || lyricsState.lines.length === 0) return;

        let activeIndex = -1;
        for (let i = 0; i < lyricsState.lines.length; i++) {
            const lineTime = lyricsState.lines[i].time;
            if (typeof lineTime !== 'number') continue;
            if (progressMs >= lineTime) activeIndex = i;
            if (progressMs < lineTime) break;
        }

        const lineEls = pipLines.querySelectorAll('.lyrics-line');
        lineEls.forEach((el, index) => {
            el.classList.toggle('active', index === activeIndex);
            el.classList.toggle('upcoming', activeIndex >= 0 ? index > activeIndex : index > 0);
            el.classList.toggle('past', activeIndex >= 0 ? index < activeIndex : false);
        });

        const activeEl = pipLines.querySelector('.lyrics-line.active');
        if (activeEl) {
            pipWindow.requestAnimationFrame(() => {
                activeEl.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            });
        }
    }

    // Close modal when clicking on the overlay backdrop
    queueModalOverlay.addEventListener('click', (e) => {
        if (e.target === queueModalOverlay) closeQueueModal();
    });

    // --- WebSocket Connection ---
    function connectWS() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/client?deviceId=${getDeviceId()}`;

        console.log(`Connecting to WebSocket at ${wsUrl}`);
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('Connected to server!');
            isConnected = true;
        };

        socket.onclose = () => {
            console.log('Connection lost. Reconnecting in 3s...');
            isConnected = false;
            setOfflineState();
            setTimeout(connectWS, 3000);
        };

        socket.onerror = (err) => {
            console.error('WebSocket Error:', err);
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                const { type, data } = message;

                switch (type) {
                    case 'spotify_online':
                        if (data) {
                            offlineScreen.classList.remove('active');
                        } else {
                            setOfflineState();
                        }
                        break;
                    case 'client_registered':
                        if (data.serverId) {
                            if (currentServerId === null) {
                                currentServerId = data.serverId;
                            } else if (currentServerId !== data.serverId) {
                                console.log('Server updated/restarted. Reloading page...');
                                window.location.reload();
                                break;
                            }
                        }
                        myClientId = data.clientId;
                        myClientName = data.name || 'unknown';

                        // Clean up legacy localStorage client name
                        localStorage.removeItem('spotify_web_controller_device_name');

                        getDeviceDetails().then(deviceInfo => {
                            sendCommand('register_client', { 
                                name: myClientName, 
                                device: deviceInfo,
                                deviceId: getDeviceId()
                            });
                        });
                        break;
                    case 'reload_client':
                        console.log('Received reload signal from server. Reloading...');
                        window.location.reload();
                        break;
                    case 'client_list':
                        renderClientList(data);
                        break;
                    case 'device_history':
                        renderDeviceHistory(data);
                        break;
                    case 'state':
                        updatePlayerUI(data);
                        break;
                    case 'progress':
                        updateProgressUI(data.progress);
                        break;
                    case 'volume_change':
                        updateVolumeUI(data.volume);
                        break;
                    case 'queue':
                        updateQueueUI(data);
                        break;
                case 'search_results':
                    renderSearchResults(data);
                    break;
                case 'lyrics':
                    updateLyricsUI(data);
                    break;
                case 'blocked_keywords':
                    // Update the local blocked keywords list and refresh search results + badge
                    blockedKeywords = Array.isArray(data.keywords) ? data.keywords : [];
                    updateBlockedBadge();
                    // Re-apply blocking to search results currently displayed
                    reapplyBlockedState();
                    break;
            }
            } catch (err) {
                console.error('Error handling message:', err);
            }
        };
    }

    function setOfflineState() {
        offlineScreen.classList.add('active');
        stopProgressInterpolation();
        closeMobileLyricsView();
    }

    // --- GitHub Stars Fetch ---
    async function fetchGitHubStars() {
        const badgeRight = document.querySelector('#github-stars-badge .github-stars-right span');
        if (!badgeRight) return;
        try {
            const response = await fetch('https://api.github.com/repos/Asadaaaaa/Spotify-Web-Controller');
            if (response.ok) {
                const data = await response.json();
                if (data && typeof data.stargazers_count === 'number') {
                    // Format with commas, e.g., 193,734
                    badgeRight.textContent = data.stargazers_count.toLocaleString();
                }
            }
        } catch (error) {
            console.error('Failed to fetch GitHub stars:', error);
        }
    }
    fetchGitHubStars();

    // --- Send Command Helper ---
    function sendCommand(type, data = null) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, data, deviceId: getDeviceId() }));
        }
    }

    // --- Playback Controls Handlers ---
    btnPlay.addEventListener('click', () => sendCommand('togglePlay'));
    btnPrev.addEventListener('click', () => sendCommand('back'));
    btnNext.addEventListener('click', () => sendCommand('next'));

    btnShuffle.addEventListener('click', () => {
        sendCommand('shuffle', !playbackState.shuffle);
    });

    btnRepeat.addEventListener('click', () => {
        // Cycle: 0 (off) -> 1 (repeat context) -> 2 (repeat track)
        const nextRepeat = (playbackState.repeat + 1) % 3;
        sendCommand('repeat', nextRepeat);
    });

    // btnLike.addEventListener('click', () => sendCommand('toggleHeart'));

    // --- Seek / Progress Bar Handlers ---
    progressBarContainer.addEventListener('click', (e) => {
        if (!playbackState.duration) return;
        const rect = progressBarContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, clickX / rect.width));
        const seekMs = Math.round(percentage * playbackState.duration);

        // Optimistically update progress bar locally
        updateProgressUI(seekMs);

        sendCommand('seek', seekMs);
    });

    // --- Volume Handlers ---
    function startVolumeCooldown() {
        if (volumeCooldownTimer) clearTimeout(volumeCooldownTimer);
        volumeCooldownTimer = setTimeout(() => {
            volumeCooldownTimer = null;
        }, 1000);
    }

    volumeSlider.addEventListener('input', (e) => {
        isDraggingVolume = true;
        const val = parseInt(e.target.value);
        updateVolumeBarUI(val);
        sendCommand('volume', val / 100);
    });

    volumeSlider.addEventListener('mousedown', () => {
        isDraggingVolume = true;
        if (volumeCooldownTimer) {
            clearTimeout(volumeCooldownTimer);
            volumeCooldownTimer = null;
        }
    });

    volumeSlider.addEventListener('touchstart', () => {
        isDraggingVolume = true;
        if (volumeCooldownTimer) {
            clearTimeout(volumeCooldownTimer);
            volumeCooldownTimer = null;
        }
    }, { passive: true });

    // Handle mouse/touch release on document to make sure we catch it even if released outside slider
    const handleVolumeRelease = () => {
        if (isDraggingVolume) {
            isDraggingVolume = false;
            startVolumeCooldown();
        }
    };
    document.addEventListener('mouseup', handleVolumeRelease);
    document.addEventListener('touchend', handleVolumeRelease, { passive: true });

    btnMute.addEventListener('click', () => {
        const currentVal = parseInt(volumeSlider.value);
        if (currentVal > 0) {
            previousVolume = currentVal;
            updateVolumeBarUI(0);
            sendCommand('volume', 0);
        } else {
            updateVolumeBarUI(previousVolume);
            sendCommand('volume', previousVolume / 100);
        }
        // Also trigger a temporary cooldown when clicking mute/unmute to prevent race conditions
        isDraggingVolume = false;
        startVolumeCooldown();
    });

    function updateVolumeBarUI(percentage) {
        volumeSlider.value = percentage;
        volumeFill.style.width = `${percentage}%`;
        if (volumePercentage) {
            volumePercentage.textContent = `${percentage}%`;
        }

        const muteIcon = btnMute.querySelector('i');
        muteIcon.className = '';
        if (percentage === 0) {
            muteIcon.className = 'fa-solid fa-volume-xmark';
        } else if (percentage < 35) {
            muteIcon.className = 'fa-solid fa-volume-off';
        } else if (percentage < 70) {
            muteIcon.className = 'fa-solid fa-volume-low';
        } else {
            muteIcon.className = 'fa-solid fa-volume-high';
        }
    }

    function updateVolumeUI(volumeFloat) {
        if (isDraggingVolume || volumeCooldownTimer) return;
        playbackState.volume = volumeFloat;
        updateVolumeBarUI(Math.round(volumeFloat * 100));
    }

    // --- UI Update Operations ---
    function updatePlayerUI(state) {
        if (isDraggingVolume || volumeCooldownTimer) {
            delete state.volume;
        }
        playbackState = { ...playbackState, ...state };

        // 1. Text & Track Details
        if (playbackState.track) {
            trackTitle.textContent = playbackState.track.title;
            trackArtist.textContent = playbackState.track.artist;

            const reqEl = document.getElementById('track-request-by');
            if (reqEl) {
                if (playbackState.track.requestedBy) {
                    reqEl.innerHTML = `<i class="fa-solid fa-circle-user"></i> Requested by: <strong>${playbackState.track.requestedBy}</strong>`;
                    reqEl.style.display = 'block';
                } else {
                    reqEl.style.display = 'none';
                }
            }

            const artUrl = getImageUrl(playbackState.track.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=500';
            if (albumArt.src !== artUrl) {
                albumArt.src = artUrl;
                ambientGlow.style.backgroundImage = `url('${artUrl}')`;
            }
        } else {
            trackTitle.textContent = 'Not Playing';
            trackArtist.textContent = 'Connect your Spotify client';
            const reqEl = document.getElementById('track-request-by');
            if (reqEl) reqEl.style.display = 'none';
            albumArt.src = 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=500';
            ambientGlow.style.backgroundImage = 'none';
        }

        // 2. Play / Pause Button state
        const playIcon = btnPlay.querySelector('i');
        if (playbackState.isPlaying) {
            playIcon.className = 'fa-solid fa-pause';
            vinylRecord.classList.add('playing');
            startProgressInterpolation();
        } else {
            playIcon.className = 'fa-solid fa-play';
            vinylRecord.classList.remove('playing');
            stopProgressInterpolation();
        }

        // 3. Heart button state
        // const heartIcon = btnLike.querySelector('i');
        // if (playbackState.heart) {
        //     btnLike.classList.add('active');
        //     heartIcon.className = 'fa-solid fa-heart';
        // } else {
        //     btnLike.classList.remove('active');
        //     heartIcon.className = 'fa-regular fa-heart';
        // }

        // 4. Shuffle Button
        if (playbackState.shuffle) {
            btnShuffle.classList.add('active');
        } else {
            btnShuffle.classList.remove('active');
        }

        // 5. Repeat Button
        btnRepeat.className = 'btn-icon';
        const repeatIcon = btnRepeat.querySelector('i');
        if (playbackState.repeat === 1) {
            // Repeat context (album/playlist)
            btnRepeat.classList.add('active');
            repeatIcon.className = 'fa-solid fa-repeat';
            btnRepeat.title = "Repeat: Playlist";
        } else if (playbackState.repeat === 2) {
            // Repeat track (single)
            btnRepeat.classList.add('active');
            repeatIcon.className = 'fa-solid fa-repeat-1'; // FontAwesome repeat track icon
            // If fa-repeat-1 is not rendering or missing, style-based indicator:
            btnRepeat.title = "Repeat: Track";
        } else {
            // Repeat off
            repeatIcon.className = 'fa-solid fa-repeat';
            btnRepeat.title = "Repeat: Off";
        }

        // 6. Volume Slider
        updateVolumeUI(playbackState.volume);

        // 7. Track Duration & Progress
        timeDuration.textContent = formatTime(playbackState.duration);
        updateProgressUI(playbackState.progress);

        if (playbackState.track) {
            lyricsPlaceholder.style.display = 'none';
            lyricsEmpty.style.display = 'none';
            lyricsLoading.style.display = lyricsState.loading ? 'flex' : 'none';
            lyricsContent.style.display = lyricsState.lines.length > 0 || lyricsState.rawText ? 'flex' : 'none';
            updatePipLyricsUI();
        } else {
            showLyricsPlaceholder();
        }
    }

    function updateProgressUI(progressMs) {
        playbackState.progress = progressMs;
        timeCurrent.textContent = formatTime(progressMs);

        if (playbackState.duration > 0) {
            const percentage = (progressMs / playbackState.duration) * 100;
            progressBarFill.style.width = `${percentage}%`;
            progressHandle.style.left = `${percentage}%`;
        } else {
            progressBarFill.style.width = '0%';
            progressHandle.style.left = '0%';
        }

        updateLyricsHighlight(progressMs);
    }

    function showLyricsPlaceholder() {
        lyricsState = {
            trackKey: '',
            loading: false,
            source: '',
            synced: false,
            lines: [],
            rawText: '',
            activeIndex: -1
        };
        lyricsPlaceholder.style.display = 'flex';
        lyricsLoading.style.display = 'none';
        lyricsEmpty.style.display = 'none';
        lyricsContent.style.display = 'none';
        lyricsLines.innerHTML = '';

        mobileLyricsPlaceholder.style.display = 'flex';
        mobileLyricsLoading.style.display = 'none';
        mobileLyricsEmpty.style.display = 'none';
        mobileLyricsContent.style.display = 'none';
        mobileLyricsLines.innerHTML = '';

        updatePipLyricsUI();
    }

    function getCurrentTrackKey() {
        if (!playbackState.track) return '';
        return [
            playbackState.track.uri || '',
            playbackState.track.title || '',
            playbackState.track.artist || '',
            playbackState.track.album || '',
        ].join('|');
    }

    function updateLyricsUI(data) {
        if (!data) return;

        const trackKey = data.trackKey || '';
        if (trackKey && playbackState.track) {
            const currentKey = getCurrentTrackKey();
            if (trackKey !== currentKey) return;
        }

        lyricsState.trackKey = trackKey;
        lyricsState.loading = !!data.loading;
        lyricsState.source = data.source || '';
        lyricsState.synced = !!data.synced;
        lyricsState.lines = Array.isArray(data.lines) ? data.lines : [];
        lyricsState.rawText = data.rawText || '';
        lyricsState.activeIndex = -1;

        if (lyricsState.loading) {
            lyricsPlaceholder.style.display = 'none';
            lyricsEmpty.style.display = 'none';
            lyricsLoading.style.display = 'flex';
            lyricsContent.style.display = 'none';
            mobileLyricsPlaceholder.style.display = 'none';
            mobileLyricsEmpty.style.display = 'none';
            mobileLyricsLoading.style.display = 'flex';
            mobileLyricsContent.style.display = 'none';
            updatePipLyricsUI();
            return;
        }

        if (lyricsState.lines.length === 0 && !lyricsState.rawText) {
            lyricsPlaceholder.style.display = 'none';
            lyricsLoading.style.display = 'none';
            lyricsContent.style.display = 'none';
            lyricsEmpty.style.display = 'flex';
            mobileLyricsPlaceholder.style.display = 'none';
            mobileLyricsLoading.style.display = 'none';
            mobileLyricsContent.style.display = 'none';
            mobileLyricsEmpty.style.display = 'flex';
            updatePipLyricsUI();
            return;
        }

        lyricsPlaceholder.style.display = 'none';
        lyricsLoading.style.display = 'none';
        lyricsEmpty.style.display = 'none';
        lyricsContent.style.display = 'flex';
        mobileLyricsPlaceholder.style.display = 'none';
        mobileLyricsLoading.style.display = 'none';
        mobileLyricsEmpty.style.display = 'none';
        mobileLyricsContent.style.display = 'flex';

        renderLyricsLines();
        updateLyricsHighlight(playbackState.progress);
        updatePipLyricsUI();
    }

    function renderLyricsLines() {
        lyricsLines.innerHTML = '';
        mobileLyricsLines.innerHTML = '';

        if (lyricsState.lines.length === 0) {
            const emptyLine = document.createElement('div');
            emptyLine.className = 'lyrics-line empty';
            emptyLine.textContent = lyricsState.rawText || 'No lyrics available.';
            lyricsLines.appendChild(emptyLine);
            mobileLyricsLines.appendChild(emptyLine.cloneNode(true));
            return;
        }

        lyricsState.lines.forEach((line, index) => {
            const lineEl = document.createElement('div');
            lineEl.className = 'lyrics-line';
            lineEl.dataset.index = String(index);
            lineEl.dataset.time = String(typeof line.time === 'number' ? line.time : -1);

            const textSpan = document.createElement('span');
            textSpan.textContent = line.text || '';
            lineEl.appendChild(textSpan);

            lyricsLines.appendChild(lineEl);
            mobileLyricsLines.appendChild(lineEl.cloneNode(true));
        });

        updatePipLyricsUI();
    }

    function updateLyricsHighlight(progressMs) {
        if (!lyricsLines || lyricsState.lines.length === 0) return;

        let activeIndex = -1;
        for (let i = 0; i < lyricsState.lines.length; i++) {
            const lineTime = lyricsState.lines[i].time;
            if (typeof lineTime !== 'number') continue;
            if (progressMs >= lineTime) activeIndex = i;
            if (progressMs < lineTime) break;
        }

        if (activeIndex === lyricsState.activeIndex) return;
        lyricsState.activeIndex = activeIndex;

        const lineEls = lyricsLines.querySelectorAll('.lyrics-line');
        const mobileLineEls = mobileLyricsLines.querySelectorAll('.lyrics-line');
        
        lineEls.forEach((el, index) => {
            el.classList.toggle('active', index === activeIndex);
            el.classList.toggle('upcoming', activeIndex >= 0 ? index > activeIndex : index > 0);
            el.classList.toggle('past', activeIndex >= 0 ? index < activeIndex : false);
        });
        mobileLineEls.forEach((el, index) => {
            el.classList.toggle('active', index === activeIndex);
            el.classList.toggle('upcoming', activeIndex >= 0 ? index > activeIndex : index > 0);
            el.classList.toggle('past', activeIndex >= 0 ? index < activeIndex : false);
        });

        const activeEl = lyricsLines.querySelector('.lyrics-line.active');
        if (activeEl) {
            requestAnimationFrame(() => {
                activeEl.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            });
        }

        const mobileActiveEl = mobileLyricsLines.querySelector('.lyrics-line.active');
        if (mobileActiveEl) {
            requestAnimationFrame(() => {
                mobileActiveEl.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            });
        }

        updatePipLyricsHighlight(progressMs);
    }

    // --- Smooth Progress Bar Interpolation ---
    function startProgressInterpolation() {
        stopProgressInterpolation();

        let lastTimestamp = performance.now();

        function tick(timestamp) {
            if (!playbackState.isPlaying) return;

            const delta = timestamp - lastTimestamp;
            lastTimestamp = timestamp;

            // Increment progress
            let nextProgress = playbackState.progress + delta;

            if (nextProgress >= playbackState.duration) {
                nextProgress = playbackState.duration;
            }

            updateProgressUI(nextProgress);
            localProgressTimer = requestAnimationFrame(tick);
        }

        localProgressTimer = requestAnimationFrame(tick);
    }

    function stopProgressInterpolation() {
        if (localProgressTimer) {
            cancelAnimationFrame(localProgressTimer);
            localProgressTimer = null;
        }
    }

    function formatTime(ms) {
        if (isNaN(ms) || ms < 0) return '0:00';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    // --- Search Features ---
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        if (query.length > 0) {
            btnClearSearch.style.display = 'block';
            searchResultsOverlay.classList.add('open');
        } else {
            btnClearSearch.style.display = 'none';
            searchResultsOverlay.classList.remove('open');
            clearSearchState();
            return;
        }

        // Debounce search input — wait 600ms after last keystroke, and require at least 2 chars
        clearTimeout(searchDebounceTimeout);
        if (query.length < 2) return;
        searchDebounceTimeout = setTimeout(() => {
            performSearch(query);
        }, 600);
    });

    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length > 0) {
            searchResultsOverlay.classList.add('open');
        }
    });

    btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        btnClearSearch.style.display = 'none';
        searchResultsOverlay.classList.remove('open');
        clearSearchState();
        searchInput.focus();
    });

    function clearSearchState() {
        searchResultsList.innerHTML = '';
        searchPlaceholder.style.display = 'flex';
        searchLoading.style.display = 'none';
        searchNoResults.style.display = 'none';
    }

    function performSearch(query) {
        searchPlaceholder.style.display = 'none';
        searchNoResults.style.display = 'none';
        searchLoading.style.display = 'flex';
        searchResultsList.innerHTML = '';

        sendCommand('search', query);
    }

    function renderSearchResults(data) {
        searchLoading.style.display = 'none';

        // Helper to build a single track item DOM element
        function buildTrackItem(track) {
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            const artUrl = getImageUrl(track.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=50';
            trackItem.innerHTML = `
                <div class="track-item-left">
                    <img class="track-item-art" src="${artUrl}" alt="Album Art">
                    <div class="track-item-details">
                        <span class="track-item-title">${track.title}</span>
                        <span class="track-item-artist">${track.artist}</span>
                    </div>
                </div>
                <div class="track-item-right">
                    <span class="track-duration">${formatTime(track.duration)}</span>
                    <button class="btn-item-action btn-play-now" title="Play Now">
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button class="btn-item-action btn-add-queue" title="Add to Queue">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            `;
            trackItem.querySelector('.btn-play-now').addEventListener('click', (e) => {
                e.stopPropagation();
                // Blocked keyword guard — prevent playing songs that match the filter
                if (isTrackBlocked(track)) return;
                sendCommand('play_track', track.uri);
                searchResultsOverlay.classList.remove('open');
            });
            trackItem.querySelector('.btn-add-queue').addEventListener('click', (e) => {
                e.stopPropagation();
                // Blocked keyword guard — prevent queueing songs that match the filter
                if (isTrackBlocked(track)) return;
                sendCommand('add_queue', track.uri);
                const icon = e.currentTarget.querySelector('i');
                icon.className = 'fa-solid fa-check';
                icon.style.color = '#1ed760';
                setTimeout(() => {
                    icon.className = 'fa-solid fa-plus';
                    icon.style.color = '';
                }, 1500);
            });

            // Apply blocked state visual styling and disable interactions
            if (isTrackBlocked(track)) {
                trackItem.classList.add('blocked');
                const playBtn = trackItem.querySelector('.btn-play-now');
                const queueBtn = trackItem.querySelector('.btn-add-queue');
                if (playBtn) { playBtn.disabled = true; playBtn.title = 'Blocked by keyword filter'; }
                if (queueBtn) { queueBtn.disabled = true; queueBtn.title = 'Blocked by keyword filter'; }
            }
            return trackItem;
        }

        if (data.error) {
            searchResultsList.innerHTML = `<div class="search-state-message"><p>Error: ${data.error}</p></div>`;
            return;
        }
        if (!data.tracks || data.tracks.length === 0) {
            searchNoResults.style.display = 'flex';
            return;
        }
        searchResultsList.innerHTML = '';
        data.tracks.forEach(track => searchResultsList.appendChild(buildTrackItem(track)));
    }

    function getDraggingQueueItem() {
        return document.querySelector('.queue-item.dragging');
    }

    let touchDragState = {
        active: false,
        item: null,
        identifier: null,
        currentContainer: null
    };

    function getTouchPointById(touchList, identifier) {
        for (const touch of touchList) {
            if (touch.identifier === identifier) return touch;
        }
        return null;
    }

    function getQueueContainerFromPoint(x, y) {
        const element = document.elementFromPoint(x, y);
        return element ? element.closest('.queue-list') : null;
    }

    function beginTouchQueueDrag(trackItem, touch) {
        if (!trackItem || !touch || touchDragState.active) return;

        touchDragState.active = true;
        touchDragState.item = trackItem;
        touchDragState.identifier = touch.identifier;
        touchDragState.currentContainer = trackItem.closest('.queue-list');
        trackItem.classList.add('dragging');
    }

    function moveTouchQueueDrag(touch) {
        if (!touchDragState.active || !touchDragState.item || !touch) return;

        const targetContainer = getQueueContainerFromPoint(touch.clientX, touch.clientY) || touchDragState.currentContainer;
        if (!targetContainer) return;

        const afterElement = getDragAfterElement(targetContainer, touch.clientY);
        if (afterElement == null) {
            targetContainer.appendChild(touchDragState.item);
        } else {
            targetContainer.insertBefore(touchDragState.item, afterElement);
        }

        touchDragState.currentContainer = targetContainer;
    }

    function finishTouchQueueDrag() {
        if (!touchDragState.active || !touchDragState.item) return;

        const trackItem = touchDragState.item;
        trackItem.classList.remove('dragging');

        const parentContainer = trackItem.closest('.queue-list');
        const nextItem = trackItem.nextElementSibling;
        const contextContainer = parentContainer === queueModalUserList ? queueModalContextList : queueContextList;
        let insertBeforeTrack = null;

        if (nextItem) {
            insertBeforeTrack = {
                uri: nextItem.dataset.uri || "",
                uid: nextItem.dataset.uid
            };
        } else if (parentContainer === queueUserList || parentContainer === queueModalUserList) {
            const firstContextItem = contextContainer?.querySelector('.queue-item');
            if (firstContextItem && firstContextItem !== trackItem) {
                insertBeforeTrack = {
                    uri: firstContextItem.dataset.uri || "",
                    uid: firstContextItem.dataset.uid
                };
            }
        }

        sendCommand('reorder_queue', {
            track: { uri: trackItem.dataset.uri || "", uid: trackItem.dataset.uid || "" },
            insertBefore: insertBeforeTrack
        });

        touchDragState.active = false;
        touchDragState.item = null;
        touchDragState.identifier = null;
        touchDragState.currentContainer = null;
    }

    document.addEventListener('touchmove', (e) => {
        if (!touchDragState.active) return;
        const touch = getTouchPointById(e.changedTouches, touchDragState.identifier);
        if (!touch) return;
        moveTouchQueueDrag(touch);
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (!touchDragState.active) return;
        const touch = getTouchPointById(e.changedTouches, touchDragState.identifier);
        if (!touch) return;
        finishTouchQueueDrag();
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        if (!touchDragState.active || !touchDragState.item) return;
        touchDragState.item.classList.remove('dragging');
        touchDragState.active = false;
        touchDragState.item = null;
        touchDragState.identifier = null;
        touchDragState.currentContainer = null;
    }, { passive: true });

    function attachQueueDragHandlers(container, fallbackContainer = null) {
        if (!container || container.dataset.dragOverAttached) return;
        container.dataset.dragOverAttached = 'true';

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingItem = getDraggingQueueItem();
            if (!draggingItem) return;

            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement == null) {
                container.appendChild(draggingItem);
            } else {
                container.insertBefore(draggingItem, afterElement);
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
        });

        if (fallbackContainer) {
            fallbackContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingItem = getDraggingQueueItem();
                if (!draggingItem) return;

                const afterElement = getDragAfterElement(container, e.clientY);
                if (afterElement == null) {
                    container.appendChild(draggingItem);
                } else {
                    container.insertBefore(draggingItem, afterElement);
                }
            });
        }
    }

    // --- Queue Features ---
    function updateQueueUI(queueData) {
        if (!queueData) return;

        // Render current track in Queue tab
        if (queueData.current) {
            const artUrl = getImageUrl(queueData.current.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=50';
            const reqHTML = queueData.current.requestedBy ? `
                <span class="track-requested-by" style="font-size: 10px; color: var(--primary); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; margin-top: 2px;">
                    <i class="fa-solid fa-circle-user" style="font-size: 8px;"></i> ${queueData.current.requestedBy}
                </span>
            ` : '';
            queueCurrentItem.innerHTML = `
                <div class="track-item" style="background: rgba(30, 215, 96, 0.08); border-color: rgba(30, 215, 96, 0.2)">
                    <div class="track-item-left">
                        <img class="track-item-art" src="${artUrl}" alt="Album Art">
                        <div class="track-item-details">
                            <span class="track-item-title">${queueData.current.title}</span>
                            <span class="track-item-artist">${queueData.current.artist}</span>
                            ${reqHTML}
                        </div>
                    </div>
                    <div class="track-item-right">
                        <span class="track-duration" style="color: var(--primary)">Playing</span>
                    </div>
                </div>
            `;
        } else {
            queueCurrentItem.innerHTML = '<div class="search-state-message" style="padding:20px"><p>No track playing</p></div>';
        }

        // Helper to create a track element
        function createTrackItem(track, index, isUserQueue) {
            const trackItem = document.createElement('div');
            trackItem.className = 'queue-item';

            const artUrl = getImageUrl(track.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=50';

            const dragHandleHTML = `
                <div class="drag-handle" title="Drag to reorder">
                    <i class="fa-solid fa-grip-vertical"></i>
                </div>
            `;

            let rightPartHTML = '';
            if (isUserQueue) {
                rightPartHTML = `
                    <div class="track-item-right">
                        <button class="btn-item-action btn-remove-queue" title="Remove from Queue">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                `;
            } else {
                rightPartHTML = `
                    <div class="track-item-right">
                        <button class="btn-item-action btn-move-queue" title="Move to User Queue">
                            <i class="fa-solid fa-square-plus"></i>
                        </button>
                        <button class="btn-item-action btn-remove-queue" title="Remove from Queue">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                `;
            }

            const reqHTML = track.requestedBy ? `
                <span class="track-requested-by" style="font-size: 10px; color: var(--primary); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; margin-top: 2px;">
                    <i class="fa-solid fa-circle-user" style="font-size: 8px;"></i> ${track.requestedBy}
                </span>
            ` : '';

            trackItem.innerHTML = `
                <div class="track-item-left">
                    ${dragHandleHTML}
                    <img class="track-item-art" src="${artUrl}" alt="Album Art">
                    <div class="track-item-details">
                        <span class="track-item-title">${track.title}</span>
                        <span class="track-item-artist">${track.artist}</span>
                        ${reqHTML}
                    </div>
                </div>
                ${rightPartHTML}
            `;

            // Save track credentials to DOM
            trackItem.dataset.uid = track.uid;
            trackItem.dataset.uri = track.uri;

            // Make all queue items draggable (both User Queue and Context Queue)
            trackItem.setAttribute('draggable', 'true');

            trackItem.addEventListener('dragstart', (e) => {
                trackItem.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', track.uid);
            });

            trackItem.addEventListener('dragend', () => {
                trackItem.classList.remove('dragging');

                const parentContainer = trackItem.closest('.queue-list');
                const nextItem = trackItem.nextElementSibling;
                const contextContainer = parentContainer === queueModalUserList ? queueModalContextList : queueContextList;
                let insertBeforeTrack = null;

                if (nextItem) {
                    insertBeforeTrack = {
                        uri: nextItem.dataset.uri || "",
                        uid: nextItem.dataset.uid
                    };
                } else if (parentContainer === queueUserList || parentContainer === queueModalUserList) {
                    // Dropped at the end. Target the first context track if available.
                    const firstContextItem = contextContainer?.querySelector('.queue-item');
                    if (firstContextItem && firstContextItem !== trackItem) {
                        insertBeforeTrack = {
                            uri: firstContextItem.dataset.uri || "",
                            uid: firstContextItem.dataset.uid
                        };
                    }
                } else {
                    insertBeforeTrack = null;
                }

                sendCommand('reorder_queue', {
                    track: { uri: track.uri, uid: track.uid },
                    insertBefore: insertBeforeTrack
                });
            });

            const dragHandle = trackItem.querySelector('.drag-handle');
            if (dragHandle) {
                dragHandle.addEventListener('touchstart', (e) => {
                    if (e.touches.length !== 1) return;
                    beginTouchQueueDrag(trackItem, e.touches[0]);
                    e.preventDefault();
                }, { passive: false });
            }

            // Action Handlers
            const btnRemove = trackItem.querySelector('.btn-remove-queue');
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    sendCommand('remove_queue', { uri: track.uri, uid: track.uid });
                    trackItem.style.opacity = '0.3';
                    trackItem.style.pointerEvents = 'none';
                });
            }

            const btnMove = trackItem.querySelector('.btn-move-queue');
            if (btnMove) {
                btnMove.addEventListener('click', () => {
                    sendCommand('add_queue', track.uri);
                    
                    // Temporarily change icon to checkmark and fade out the item to show it's moved
                    const icon = btnMove.querySelector('i');
                    icon.className = 'fa-solid fa-circle-check';
                    icon.style.color = '#1ed760';
                    trackItem.style.opacity = '0.3';
                    trackItem.style.pointerEvents = 'none';

                    // Delay removing to let Spotify add the track first and avoid "can't play this right now" state conflict
                    setTimeout(() => {
                        sendCommand('remove_queue', { uri: track.uri, uid: track.uid });
                    }, 400);
                });
            }

            return trackItem;
        }

        const hasUserQueue = queueData.nextInQueue && queueData.nextInQueue.length > 0;
        const hasContextQueue = queueData.nextUp && queueData.nextUp.length > 0;

        // Render User Queue (Next In Queue)
        if (hasUserQueue) {
            queueUserTitle.style.display = 'block';
            queueUserList.style.display = 'flex';
            queueUserList.innerHTML = '';
            queueData.nextInQueue.forEach((track, index) => {
                queueUserList.appendChild(createTrackItem(track, index, true));
            });
        } else {
            queueUserTitle.style.display = 'none';
            queueUserList.style.display = 'none';
            queueUserList.innerHTML = '';
        }

        // Render Context Queue (Next Up)
        if (hasContextQueue) {
            queueContextTitle.style.display = 'block';
            queueContextList.style.display = 'flex';
            queueContextList.innerHTML = '';
            queueData.nextUp.forEach((track, index) => {
                queueContextList.appendChild(createTrackItem(track, index, false));
            });
        } else {
            queueContextTitle.style.display = 'none';
            queueContextList.style.display = 'none';
            queueContextList.innerHTML = '';
        }

        // If both queues are empty, show a placeholder
        if (!hasUserQueue && !hasContextQueue) {
            queueContextList.style.display = 'flex';
            queueContextList.innerHTML = '<div class="search-state-message" style="padding:40px"><p>Queue is empty</p></div>';
        }

        // --- Sync queue data to the modal (bottom-sheet) ---
        if (queueData.current) {
            const artUrl = getImageUrl(queueData.current.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=50';
            const reqHTML = queueData.current.requestedBy ? `
                <span class="track-requested-by" style="font-size: 10px; color: var(--primary); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; margin-top: 2px;">
                    <i class="fa-solid fa-circle-user" style="font-size: 8px;"></i> ${queueData.current.requestedBy}
                </span>
            ` : '';
            queueModalCurrentItem.innerHTML = `
                <div class="track-item" style="background: rgba(30, 215, 96, 0.08); border-color: rgba(30, 215, 96, 0.2)">
                    <div class="track-item-left">
                        <img class="track-item-art" src="${artUrl}" alt="Album Art">
                        <div class="track-item-details">
                            <span class="track-item-title">${queueData.current.title}</span>
                            <span class="track-item-artist">${queueData.current.artist}</span>
                            ${reqHTML}
                        </div>
                    </div>
                    <div class="track-item-right">
                        <span class="track-duration" style="color: var(--primary)">Playing</span>
                    </div>
                </div>
            `;
        } else {
            queueModalCurrentItem.innerHTML = '<div class="search-state-message" style="padding:20px"><p>No track playing</p></div>';
        }

        if (hasUserQueue) {
            queueModalUserTitle.style.display = 'block';
            queueModalUserList.style.display = 'flex';
            queueModalUserList.innerHTML = '';
            queueData.nextInQueue.forEach((track, index) => {
                queueModalUserList.appendChild(createTrackItem(track, index, true));
            });
        } else {
            queueModalUserTitle.style.display = 'none';
            queueModalUserList.style.display = 'none';
            queueModalUserList.innerHTML = '';
        }

        if (hasContextQueue) {
            queueModalContextTitle.style.display = 'block';
            queueModalContextList.style.display = 'flex';
            queueModalContextList.innerHTML = '';
            queueData.nextUp.forEach((track, index) => {
                queueModalContextList.appendChild(createTrackItem(track, index, false));
            });
        } else {
            queueModalContextTitle.style.display = 'none';
            queueModalContextList.style.display = 'none';
            queueModalContextList.innerHTML = '';
        }

        if (!hasUserQueue && !hasContextQueue) {
            queueModalContextList.style.display = 'flex';
            queueModalContextList.innerHTML = '<div class="search-state-message" style="padding:40px"><p>Queue is empty</p></div>';
        }

        attachQueueDragHandlers(queueUserList);
        attachQueueDragHandlers(queueContextList);
        attachQueueDragHandlers(queueModalUserList);
        attachQueueDragHandlers(queueModalContextList);
    }

    // Helper to calculate the element immediately below the cursor during drag
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.queue-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // --- Connected Clients Helpers & Listeners ---
    function getDeviceDetails() {
        const ua = navigator.userAgent;
        let device = 'Web Browser';
        if (/tablet|ipad|playbook|silk/i.test(ua)) {
            device = 'Tablet';
        } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle/i.test(ua)) {
            device = 'Mobile';
        } else {
            device = 'Desktop';
        }
        
        let os = '';
        if (ua.indexOf('Win') !== -1) os = 'Windows';
        else if (ua.indexOf('Mac') !== -1) os = 'macOS';
        else if (ua.indexOf('X11') !== -1) os = 'Linux';
        else if (ua.indexOf('Linux') !== -1) os = 'Linux';
        else if (/Android/i.test(ua)) os = 'Android';
        else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
        
        return os ? `${device} (${os})` : device;
    }

    // --- Connected Clients Helpers & Listeners ---
    function getBrowserName() {
        const ua = navigator.userAgent;
        if (ua.indexOf('Chrome') !== -1 && ua.indexOf('Chromium') === -1 && ua.indexOf('Edg') === -1 && ua.indexOf('OPR') === -1) return 'Chrome';
        if (ua.indexOf('Safari') !== -1 && ua.indexOf('Chrome') === -1 && ua.indexOf('Chromium') === -1) return 'Safari';
        if (ua.indexOf('Firefox') !== -1) return 'Firefox';
        if (ua.indexOf('Edg') !== -1) return 'Edge';
        if (ua.indexOf('OPR') !== -1 || ua.indexOf('Opera') !== -1) return 'Opera';
        return 'Web Browser';
    }

    function getDeviceOS() {
        const ua = navigator.userAgent;
        if (ua.indexOf('Win') !== -1) return 'Windows';
        if (ua.indexOf('Mac') !== -1) return 'macOS';
        if (/Android/i.test(ua)) return 'Android';
        if (ua.indexOf('X11') !== -1 || ua.indexOf('Linux') !== -1) return 'Linux';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
        return 'Unknown OS';
    }

    async function getDeviceDetails() {
        const ua = navigator.userAgent;
        let device = 'Web Browser';
        if (/tablet|ipad|playbook|silk/i.test(ua)) {
            device = 'Tablet';
        } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle/i.test(ua)) {
            device = 'Mobile';
        } else {
            device = 'Desktop';
        }
        
        let os = getDeviceOS();
        let baseDetails = os !== 'Unknown OS' ? `${device} (${os})` : device;

        // Fetch precise hardware model using User-Agent Client Hints API if supported
        if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
            try {
                const hints = await navigator.userAgentData.getHighEntropyValues(['model']);
                if (hints && hints.model) {
                    return `${baseDetails} - ${hints.model}`;
                }
            } catch (err) {
                console.warn('Failed to resolve precise device model:', err);
            }
        }
        
        return baseDetails;
    }

    // Detail view switching and back button event handlers
    const clientsViewList = document.getElementById('clients-view-list');
    const clientsViewDetails = document.getElementById('clients-view-details');
    const btnDetailsBack = document.getElementById('btn-details-back');
    const detailsDeviceName = document.getElementById('details-device-name');
    const detailsMetaDevice = document.getElementById('details-meta-device');
    const detailsMetaId = document.getElementById('details-meta-id');
    const detailsHistoryContainer = document.getElementById('details-history-container');

    if (btnDetailsBack) {
        btnDetailsBack.addEventListener('click', () => {
            clientsViewDetails.classList.remove('active');
            clientsViewList.classList.add('active');
        });
    }

    function renderClientList(list) {
        clientsCount.textContent = list.length;
        clientsCount.style.display = list.length > 1 ? 'flex' : 'none';

        clientsListContainer.innerHTML = '';
        
        // Sort client list so "Me" is always at the top
        const sortedList = [...list].sort((a, b) => {
            const aIsMe = a.clientId === myClientId;
            const bIsMe = b.clientId === myClientId;
            if (aIsMe && !bIsMe) return -1;
            if (!aIsMe && bIsMe) return 1;
            return 0;
        });

        sortedList.forEach(client => {
            const isMe = client.clientId === myClientId;
            const item = document.createElement('div');
            item.className = `client-item ${isMe ? 'is-me' : ''}`;
            
            // Determine icon based on device name
            let iconClass = 'fa-solid fa-laptop';
            if (client.device.toLowerCase().includes('mobile')) {
                iconClass = 'fa-solid fa-mobile-screen-button';
            } else if (client.device.toLowerCase().includes('tablet')) {
                iconClass = 'fa-solid fa-tablet-screen-button';
            }

            item.innerHTML = `
                <div class="client-icon">
                    <i class="${iconClass}"></i>
                </div>
                <div class="client-info">
                    <div class="client-name">${client.name}</div>
                    <div class="client-device">${client.device}</div>
                </div>
                ${isMe ? '<span class="client-tag-me">Me</span>' : ''}
                <button class="btn-client-detail">Detail</button>
            `;

            // Bind click to show details
            const btnDetail = item.querySelector('.btn-client-detail');
            if (btnDetail) {
                btnDetail.addEventListener('click', (e) => {
                    e.stopPropagation();
                    detailsDeviceName.textContent = client.name;
                    detailsMetaDevice.textContent = client.device;
                    detailsMetaId.textContent = client.deviceId || 'unknown';
                    
                    // Show rename button only if the CURRENT client is localhost/admin/HOST
                    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                    if (isLocalhost && btnRenameDevice) {
                        btnRenameDevice.style.display = 'inline-flex';
                    } else if (btnRenameDevice) {
                        btnRenameDevice.style.display = 'none';
                    }

                    // Clear history container and show loading state
                    detailsHistoryContainer.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 11px;">Loading history...</div>';
                    
                    // Switch view
                    clientsViewList.classList.remove('active');
                    clientsViewDetails.classList.add('active');

                    // Request history
                    sendCommand('get_history', { targetDeviceId: client.deviceId });
                });
            }

            clientsListContainer.appendChild(item);
        });
    }

    // Rename device functionality (only for localhost/admin/HOST)
    const btnRenameDevice = document.getElementById('btn-rename-device');
    if (btnRenameDevice) {
        btnRenameDevice.addEventListener('click', () => {
            const targetDeviceId = detailsMetaId.textContent;
            const currentName = detailsDeviceName.textContent;
            if (targetDeviceId === 'unknown') return;

            const newName = prompt(`Enter a new name for this device:`, currentName);
            if (newName && newName.trim() !== '') {
                const trimmed = newName.trim();
                detailsDeviceName.textContent = trimmed;
                
                // Send rename command to the server
                sendCommand('rename_device', {
                    deviceId: targetDeviceId,
                    name: trimmed
                });
            }
        });
    }

    function renderDeviceHistory(data) {
        if (!data || data.deviceId !== detailsMetaId.textContent) return;
        
        detailsHistoryContainer.innerHTML = '';
        const history = data.history || [];
        if (history.length === 0) {
            detailsHistoryContainer.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 11px;">No history records found.</div>';
            return;
        }

        history.forEach(item => {
            const date = new Date(item.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            
            let detailsText = '';
            if (item.action === 'connect') {
                detailsText = `Connected from ${item.details?.ip || 'unknown IP'}`;
            } else if (item.action === 'add_queue') {
                detailsText = `Added song to queue`;
            } else if (item.action === 'reorder_queue') {
                detailsText = `Reordered queue items`;
            } else if (item.action === 'next') {
                detailsText = `Skipped track (Next)`;
            } else if (item.action === 'back') {
                detailsText = `Went to previous track (Back)`;
            } else {
                detailsText = JSON.stringify(item.details) || '';
            }

            historyItem.innerHTML = `
                <span class="history-time">${timeStr}</span>
                <span class="history-action ${item.action}">${item.action.replace('_', ' ')}</span>
                <span class="history-details">${detailsText}</span>
            `;
            detailsHistoryContainer.appendChild(historyItem);
        });
    }

    // Toggle popover visibility — also close the blocked keywords popover if open
    btnClientsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (blockedPopover) blockedPopover.classList.remove('open');
        clientsPopover.classList.toggle('open');
    });

    // Close popover when clicking outside
    document.addEventListener('click', (e) => {
        if (clientsPopover.classList.contains('open') && !clientsPopover.contains(e.target) && e.target !== btnClientsToggle) {
            clientsPopover.classList.remove('open');
        }
    });

    function getDeviceId() {
        let id = localStorage.getItem('spotify_web_controller_device_id');
        if (!id) {
            id = 'dev-' + Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('spotify_web_controller_device_id', id);
        }
        return id;
    }

    // =========================================================================
    // BLOCKED KEYWORDS FILTER
    // =========================================================================

    /**
     * Check whether a track matches any blocked keyword.
     * Matching is case-insensitive and uses substring (wildcard-style) comparison.
     * Returns true if the track title OR artist name contains a blocked keyword of 5+ chars.
     */
    function isTrackBlocked(track) {
        if (!track || blockedKeywords.length === 0) return false;
        const fields = [track.title, track.artist].filter(Boolean).map(s => s.toLowerCase());
        return blockedKeywords.some(kw => {
            const needle = kw.toLowerCase();
            if (needle.length < 5) return false;
            return fields.some(field => field.includes(needle));
        });
    }

    /**
     * Update the badge count on the blocked keywords toggle button.
     * Badge shows the number of active blocked keywords.
     */
    function updateBlockedBadge() {
        const badge = document.getElementById('blocked-badge');
        if (!badge) return;
        if (blockedKeywords.length > 0) {
            badge.textContent = String(blockedKeywords.length);
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    /**
     * Re-apply the blocked visual state to visible search results.
     * Called when the blocked keywords list changes while results are shown.
     */
    function reapplyBlockedState() {
        const items = searchResultsList.querySelectorAll('.track-item');
        // Reset all first
        items.forEach(item => item.classList.remove('blocked'));
        // Re-render to apply up-to-date blocking
        // We iterate the original data tracks from the existing DOM (stored in data-track-id or re-trigger search)
        // Simplest approach: re-trigger search if input is active, otherwise do nothing
        const query = searchInput.value.trim();
        if (query.length >= 2) {
            performSearch(query);
        }
    }

    // --- Blocked Keywords Popover DOM References ---
    const btnBlockedToggle = document.getElementById('btn-blocked-toggle');
    const blockedPopover = document.getElementById('blocked-popover');
    const blockedTagsContainer = document.getElementById('blocked-tags-container');
    const blockedInput = document.getElementById('blocked-input');
    const btnBlockedAdd = document.getElementById('btn-blocked-add');
    const btnBlockedApply = document.getElementById('btn-blocked-apply');

    // Only show the blocked keywords controls if host is localhost or 127.0.0.1
    const blockedKeywordsContainer = document.querySelector('.blocked-keywords-container');
    if (blockedKeywordsContainer) {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocalhost) {
            blockedKeywordsContainer.style.display = 'inline-block';
        } else {
            blockedKeywordsContainer.style.display = 'none';
        }
    }

    /**
     * Render the tag chips inside the blocked keywords popover.
     * Each chip shows the keyword text and an X button to remove it.
     */
    function renderBlockedTags() {
        if (!blockedTagsContainer) return;
        blockedTagsContainer.innerHTML = '';
        if (blockedKeywords.length === 0) {
            // Show a subtle empty state message
            const emptyMsg = document.createElement('span');
            emptyMsg.className = 'blocked-hint';
            emptyMsg.style.width = '100%';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.padding = '8px 0';
            emptyMsg.textContent = 'No keywords added yet.';
            blockedTagsContainer.appendChild(emptyMsg);
            return;
        }
        blockedKeywords.forEach((kw, index) => {
            const chip = document.createElement('span');
            chip.className = 'blocked-tag';
            chip.innerHTML = `
                <span>${escapeHtml(kw)}</span>
                <button class="blocked-tag-remove" data-index="${index}" title="Remove keyword">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            // Bind remove action on the X button
            const removeBtn = chip.querySelector('.blocked-tag-remove');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                blockedKeywords.splice(index, 1);
                renderBlockedTags();
            });
            blockedTagsContainer.appendChild(chip);
        });
    }

    /**
     * Add one or more keywords from the input field.
     * Splits by comma, trims, filters to >= 5 chars, deduplicates, and re-renders.
     */
    function addKeywordsFromInput() {
        if (!blockedInput) return;
        const raw = blockedInput.value.trim();
        if (!raw) return;
        const newKeywords = raw.split(',')
            .map(s => s.trim())
            .filter(s => s.length >= 5 && !blockedKeywords.includes(s));
        if (newKeywords.length === 0) return;
        newKeywords.forEach(kw => blockedKeywords.push(kw));
        blockedInput.value = '';
        renderBlockedTags();
    }

    // Minimal HTML escaping utility for user-supplied keyword text shown in the UI
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Toggle blocked keywords popover on button click
    if (btnBlockedToggle && blockedPopover) {
        btnBlockedToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close the clients popover if open, to avoid overlapping popovers
            if (clientsPopover) clientsPopover.classList.remove('open');
            // Re-render tags from current state every time the popover opens
            renderBlockedTags();
            blockedPopover.classList.toggle('open');
        });
    }

    // Handle the Add button click on the input row
    if (btnBlockedAdd) {
        btnBlockedAdd.addEventListener('click', addKeywordsFromInput);
    }

    // Handle Enter key in the blocked keywords input
    if (blockedInput) {
        blockedInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addKeywordsFromInput();
            }
        });
    }

    // Handle the Apply Changes button: send updated list to server, close popover
    if (btnBlockedApply) {
        btnBlockedApply.addEventListener('click', () => {
            sendCommand('update_blocked_keywords', { keywords: blockedKeywords });
            if (blockedPopover) blockedPopover.classList.remove('open');
        });
    }

    // Close blocked keywords popover when clicking outside
    document.addEventListener('click', (e) => {
        if (blockedPopover && blockedPopover.classList.contains('open')) {
            const container = document.querySelector('.blocked-keywords-container');
            if (container && !container.contains(e.target)) {
                blockedPopover.classList.remove('open');
            }
        }
    });

    // Start WebSocket Connection
    connectWS();
});
