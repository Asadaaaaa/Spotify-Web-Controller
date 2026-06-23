document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const statusBadge = document.getElementById('status-badge');
    const offlineScreen = document.getElementById('offline-screen');
    const ambientGlow = document.getElementById('ambient-glow');

    // Player Elements
    const albumArt = document.getElementById('album-art');
    const vinylRecord = document.getElementById('vinyl-record');
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




    // Search Results Overlay
    const searchResultsOverlay = document.getElementById('search-results-overlay');

    // Application State
    let socket = null;
    let isConnected = false;
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

    // Close modal when clicking on the overlay backdrop
    queueModalOverlay.addEventListener('click', (e) => {
        if (e.target === queueModalOverlay) closeQueueModal();
    });

    // --- WebSocket Connection ---
    function connectWS() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/client`;

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
                            statusBadge.className = 'connection-status online';
                            statusBadge.querySelector('.status-text').textContent = 'Spotify Connected';
                        } else {
                            setOfflineState();
                        }
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
                }
            } catch (err) {
                console.error('Error handling message:', err);
            }
        };
    }

    function setOfflineState() {
        offlineScreen.classList.add('active');
        statusBadge.className = 'connection-status offline';
        statusBadge.querySelector('.status-text').textContent = 'Spotify Offline';
        stopProgressInterpolation();
    }

    // --- Send Command Helper ---
    function sendCommand(type, data = null) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, data }));
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

            const artUrl = getImageUrl(playbackState.track.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=500';
            if (albumArt.src !== artUrl) {
                albumArt.src = artUrl;
                ambientGlow.style.backgroundImage = `url('${artUrl}')`;
            }
        } else {
            trackTitle.textContent = 'Not Playing';
            trackArtist.textContent = 'Connect your Spotify client';
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
                sendCommand('play_track', track.uri);
                searchResultsOverlay.classList.remove('open');
            });
            trackItem.querySelector('.btn-add-queue').addEventListener('click', (e) => {
                e.stopPropagation();
                sendCommand('add_queue', track.uri);
                const icon = e.currentTarget.querySelector('i');
                icon.className = 'fa-solid fa-check';
                icon.style.color = '#1ed760';
                setTimeout(() => {
                    icon.className = 'fa-solid fa-plus';
                    icon.style.color = '';
                }, 1500);
            });
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

    // --- Queue Features ---
    function updateQueueUI(queueData) {
        if (!queueData) return;

        // Render current track in Queue tab
        if (queueData.current) {
            const artUrl = getImageUrl(queueData.current.albumArt) || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=50';
            queueCurrentItem.innerHTML = `
                <div class="track-item" style="background: rgba(30, 215, 96, 0.08); border-color: rgba(30, 215, 96, 0.2)">
                    <div class="track-item-left">
                        <img class="track-item-art" src="${artUrl}" alt="Album Art">
                        <div class="track-item-details">
                            <span class="track-item-title">${queueData.current.title}</span>
                            <span class="track-item-artist">${queueData.current.artist}</span>
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

            trackItem.innerHTML = `
                <div class="track-item-left">
                    ${dragHandleHTML}
                    <span class="track-duration" style="width:20px">${index + 1}</span>
                    <img class="track-item-art" src="${artUrl}" alt="Album Art">
                    <div class="track-item-details">
                        <span class="track-item-title">${track.title}</span>
                        <span class="track-item-artist">${track.artist}</span>
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

                // Determine the item dropped before
                const nextItem = trackItem.nextElementSibling;
                let insertBeforeTrack = null;

                if (nextItem) {
                    insertBeforeTrack = {
                        uri: nextItem.dataset.uri || "",
                        uid: nextItem.dataset.uid
                    };
                } else {
                    // Dropped at the end. Target the first context track if available.
                    const firstContextItem = queueContextList.querySelector('.queue-item');
                    if (firstContextItem && firstContextItem !== trackItem) {
                        insertBeforeTrack = {
                            uri: firstContextItem.dataset.uri || "",
                            uid: firstContextItem.dataset.uid
                        };
                    }
                }

                sendCommand('reorder_queue', {
                    track: { uri: track.uri, uid: track.uid },
                    insertBefore: insertBeforeTrack
                });
            });

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
            queueModalCurrentItem.innerHTML = `
                <div class="track-item" style="background: rgba(30, 215, 96, 0.08); border-color: rgba(30, 215, 96, 0.2)">
                    <div class="track-item-left">
                        <img class="track-item-art" src="${artUrl}" alt="Album Art">
                        <div class="track-item-details">
                            <span class="track-item-title">${queueData.current.title}</span>
                            <span class="track-item-artist">${queueData.current.artist}</span>
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

        // Add dragover reordering on the queue wrapper
        const queueWrapper = document.querySelector('.queue-wrapper');
        if (queueWrapper && !queueWrapper.dataset.dragOverAttached) {
            queueWrapper.dataset.dragOverAttached = 'true';
            queueWrapper.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingItem = queueUserList.querySelector('.dragging');
                if (!draggingItem) return;
                const afterElement = getDragAfterElement(queueUserList, e.clientY);
                if (afterElement == null) {
                    queueUserList.appendChild(draggingItem);
                } else {
                    queueUserList.insertBefore(draggingItem, afterElement);
                }
            });
        }
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

    // Start WebSocket Connection
    connectWS();
});
