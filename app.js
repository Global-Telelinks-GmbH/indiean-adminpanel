// ==========================================
// IndieAn Admin Panel
// ==========================================

const PRODUCTION_API_URL = 'https://indiean-backend-dev-215244286152.us-central1.run.app';

const state = {
    apiUrl: localStorage.getItem('apiUrl') || PRODUCTION_API_URL,
    token: localStorage.getItem('token') || '',
    refreshToken: localStorage.getItem('refreshToken') || '',
    modules: [],
    selectedModuleId: null,
    selectedModuleLessons: [],
};

// ==========================================
// API HELPERS
// ==========================================

async function api(method, path, body = null) {
    const url = `${state.apiUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    // Try token refresh on 401
    if (res.status === 401 && state.refreshToken) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
            headers['Authorization'] = `Bearer ${state.token}`;
            const retryRes = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null });
            if (!retryRes.ok) {
                const err = await retryRes.json().catch(() => ({ detail: retryRes.statusText }));
                throw new Error(err.detail || retryRes.statusText);
            }
            if (retryRes.status === 204) return null;
            return retryRes.json();
        }
        logout();
        throw new Error('Session expired. Please log in again.');
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || res.statusText);
    }

    if (res.status === 204) return null;
    return res.json();
}

async function tryRefreshToken() {
    try {
        const res = await fetch(`${state.apiUrl}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: state.refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        state.token = data.access_token;
        if (data.refresh_token) state.refreshToken = data.refresh_token;
        localStorage.setItem('token', state.token);
        localStorage.setItem('refreshToken', state.refreshToken);
        return true;
    } catch {
        return false;
    }
}

// ==========================================
// AUTH
// ==========================================

async function login(email, password) {
    const data = await api('POST', '/api/v1/auth/login', { email, password });
    state.token = data.access_token;
    state.refreshToken = data.refresh_token || '';
    localStorage.setItem('token', state.token);
    localStorage.setItem('refreshToken', state.refreshToken);
    return data;
}

function logout() {
    state.token = '';
    state.refreshToken = '';
    state.modules = [];
    state.selectedModuleId = null;
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
}

// ==========================================
// MODULES
// ==========================================

async function loadModules() {
    const filter = document.getElementById('instrument-filter').value;
    const query = filter ? `?instrument=${filter}` : '';
    state.modules = await api('GET', `/api/v1/admin/roadmap/modules${query}`);
    renderModuleList();
}

function renderModuleList() {
    const list = document.getElementById('module-list');
    if (!state.modules.length) {
        list.innerHTML = '<p style="padding:16px;color:var(--text-muted);font-size:0.85rem;">No modules yet. Create one to get started.</p>';
        return;
    }

    list.innerHTML = state.modules.map(m => `
        <div class="module-item ${m.id === state.selectedModuleId ? 'active' : ''}"
             data-id="${m.id}" onclick="selectModule('${m.id}')">
            <div class="module-item-title">Module ${m.number}: ${escHtml(m.title)}</div>
            <div class="module-item-meta">
                <span>${m.instrument}</span>
                <span class="badge ${m.is_published ? 'badge-published' : 'badge-draft'}">
                    ${m.is_published ? 'Published' : 'Draft'}
                </span>
            </div>
        </div>
    `).join('');
}

async function selectModule(moduleId) {
    state.selectedModuleId = moduleId;
    renderModuleList();

    const mod = state.modules.find(m => m.id === moduleId);
    if (!mod) return;

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('module-detail').classList.remove('hidden');

    document.getElementById('module-title').textContent = `Module ${mod.number}: ${mod.title}`;
    document.getElementById('module-meta').textContent = `${mod.instrument} | Created ${new Date(mod.created_at).toLocaleDateString()}`;

    const pubBtn = document.getElementById('toggle-publish-btn');
    if (mod.is_published) {
        pubBtn.textContent = 'Unpublish';
        pubBtn.className = 'btn btn-sm btn-unpublish';
    } else {
        pubBtn.textContent = 'Publish';
        pubBtn.className = 'btn btn-sm btn-publish';
    }

    await loadLessons(moduleId);
}

async function loadLessons(moduleId) {
    try {
        // Fetch lessons for this module
        const lessons = await api('GET', `/api/v1/admin/roadmap/lessons?module_id=${moduleId}`);

        // Fetch components for each lesson in parallel
        const lessonsWithComponents = await Promise.all(
            lessons.map(async (lesson) => {
                const components = await api('GET', `/api/v1/admin/roadmap/components?lesson_id=${lesson.id}`);
                return { ...lesson, components };
            })
        );

        state.selectedModuleLessons = lessonsWithComponents;
    } catch (err) {
        toast(err.message, 'error');
        state.selectedModuleLessons = [];
    }

    renderLessons();
}

function renderLessons() {
    const container = document.getElementById('lessons-list');

    if (!state.selectedModuleLessons || !state.selectedModuleLessons.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:16px;">No lessons yet. Click "+ Lesson" to add one.</p>';
        return;
    }

    container.innerHTML = state.selectedModuleLessons
        .sort((a, b) => a.number - b.number)
        .map(lesson => `
            <div class="lesson-card" data-lesson-id="${lesson.id}">
                <div class="lesson-header" onclick="toggleLesson('${lesson.id}')">
                    <div class="lesson-header-left">
                        <span class="lesson-number">${getModuleNumber()}.${lesson.number}</span>
                        <span class="lesson-title">${escHtml(lesson.title)}</span>
                    </div>
                    <div class="lesson-actions">
                        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); showAddComponentModal('${lesson.id}')">+ Component</button>
                        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); showEditLessonModal('${lesson.id}')">Edit</button>
                        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteLesson('${lesson.id}')">Delete</button>
                    </div>
                </div>
                <div class="components-list" id="components-${lesson.id}">
                    ${renderComponents(lesson)}
                </div>
            </div>
        `).join('');
}

function renderComponents(lesson) {
    if (!lesson.components || !lesson.components.length) {
        return '<p style="color:var(--text-muted);font-size:0.8rem;padding:8px 0;">No components. Add a video, practice, challenge, or game.</p>';
    }

    return lesson.components
        .sort((a, b) => a.order - b.order)
        .map(comp => `
            <div class="component-row">
                <div class="component-left">
                    <span class="component-order">${comp.order}</span>
                    <span class="component-type-badge type-${comp.type}">${comp.type}</span>
                    <span class="component-title">${escHtml(comp.title)}</span>
                    ${comp.exercise_type ? `<span class="component-special">${escHtml(comp.exercise_type)}</span>` : ''}
                    ${comp.special_feature ? `<span class="component-special">${escHtml(comp.special_feature)}</span>` : ''}
                </div>
                <div class="component-actions">
                    <button class="btn btn-sm btn-ghost" onclick="showEditComponentModal('${comp.id}', '${lesson.id}')">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteComponent('${comp.id}', '${lesson.id}')">Del</button>
                </div>
            </div>
        `).join('');
}

function getModuleNumber() {
    const mod = state.modules.find(m => m.id === state.selectedModuleId);
    return mod ? mod.number : '?';
}

function toggleLesson(lessonId) {
    const el = document.getElementById(`components-${lessonId}`);
    if (el) el.classList.toggle('hidden');
}

// ==========================================
// MODAL SYSTEM
// ==========================================

function showModal(title, fields, onSubmit) {
    document.getElementById('modal-title').textContent = title;
    const form = document.getElementById('modal-form');

    form.innerHTML = fields.map(f => {
        if (f.type === 'select') {
            return `
                <div class="form-group">
                    <label>${f.label}</label>
                    <select name="${f.name}" ${f.required ? 'required' : ''}>
                        ${f.options.map(o => `<option value="${o.value}" ${o.value === f.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                    </select>
                </div>`;
        }
        if (f.type === 'textarea') {
            return `
                <div class="form-group">
                    <label>${f.label}</label>
                    <textarea name="${f.name}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}>${f.value || ''}</textarea>
                </div>`;
        }
        if (f.type === 'checkbox') {
            return `
                <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''} style="width:auto;">
                    <label style="margin-bottom:0;">${f.label}</label>
                </div>`;
        }
        return `
            <div class="form-group">
                <label>${f.label}</label>
                <input type="${f.type || 'text'}" name="${f.name}" value="${f.value || ''}"
                       placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}
                       ${f.min !== undefined ? `min="${f.min}"` : ''}>
            </div>`;
    }).join('') + `
        <div class="modal-footer">
            <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
        </div>
    `;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const data = {};
        for (const [key, val] of formData.entries()) {
            data[key] = val;
        }
        // Handle checkboxes (unchecked ones don't appear in FormData)
        fields.filter(f => f.type === 'checkbox').forEach(f => {
            data[f.name] = form.querySelector(`[name="${f.name}"]`).checked;
        });

        try {
            await onSubmit(data);
            closeModal();
        } catch (err) {
            toast(err.message, 'error');
        }
    };

    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

// ==========================================
// MODULE CRUD MODALS
// ==========================================

function showAddModuleModal() {
    showModal('Create Module', [
        { name: 'number', label: 'Module Number', type: 'number', min: 1, required: true, placeholder: '1' },
        { name: 'title', label: 'Title', required: true, placeholder: 'e.g., Staff & Note Foundations' },
        {
            name: 'instrument', label: 'Instrument', type: 'select', required: true,
            options: [
                { value: 'piano', label: 'Piano' },
                { value: 'guitar', label: 'Guitar' },
                { value: 'drums', label: 'Drums' },
                { value: 'vocals', label: 'Vocals' },
            ]
        },
        { name: 'is_published', label: 'Published', type: 'checkbox', value: false },
    ], async (data) => {
        await api('POST', '/api/v1/admin/roadmap/modules', {
            number: parseInt(data.number),
            title: data.title,
            instrument: data.instrument,
            is_published: data.is_published,
        });
        toast('Module created');
        await loadModules();
    });
}

function showEditModuleModal() {
    const mod = state.modules.find(m => m.id === state.selectedModuleId);
    if (!mod) return;

    showModal('Edit Module', [
        { name: 'number', label: 'Module Number', type: 'number', min: 1, value: mod.number },
        { name: 'title', label: 'Title', value: mod.title },
        { name: 'is_published', label: 'Published', type: 'checkbox', value: mod.is_published },
    ], async (data) => {
        const payload = {};
        if (data.number && parseInt(data.number) !== mod.number) payload.number = parseInt(data.number);
        if (data.title && data.title !== mod.title) payload.title = data.title;
        if (data.is_published !== mod.is_published) payload.is_published = data.is_published;

        await api('PATCH', `/api/v1/admin/roadmap/modules/${mod.id}`, payload);
        toast('Module updated');
        await loadModules();
        await selectModule(mod.id);
    });
}

async function togglePublish() {
    const mod = state.modules.find(m => m.id === state.selectedModuleId);
    if (!mod) return;

    await api('PATCH', `/api/v1/admin/roadmap/modules/${mod.id}`, {
        is_published: !mod.is_published,
    });
    toast(mod.is_published ? 'Module unpublished' : 'Module published');
    await loadModules();
    await selectModule(mod.id);
}

async function deleteModuleAction() {
    const mod = state.modules.find(m => m.id === state.selectedModuleId);
    if (!mod) return;
    if (!confirm(`Delete Module ${mod.number}: "${mod.title}"?\nThis will delete ALL lessons and components inside it.`)) return;

    await api('DELETE', `/api/v1/admin/roadmap/modules/${mod.id}`);
    state.selectedModuleId = null;
    state.selectedModuleLessons = [];
    document.getElementById('module-detail').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    toast('Module deleted');
    await loadModules();
}

// ==========================================
// LESSON CRUD MODALS
// ==========================================

function showAddLessonModal() {
    const modNum = getModuleNumber();
    const nextNum = state.selectedModuleLessons.length
        ? Math.max(...state.selectedModuleLessons.map(l => l.number)) + 1
        : 1;

    showModal('Create Lesson', [
        { name: 'number', label: 'Lesson Number', type: 'number', min: 1, required: true, value: nextNum, placeholder: `${nextNum}` },
        { name: 'title', label: 'Title', required: true, placeholder: `e.g., What Is the Staff?` },
    ], async (data) => {
        const lesson = await api('POST', '/api/v1/admin/roadmap/lessons', {
            module_id: state.selectedModuleId,
            number: parseInt(data.number),
            title: data.title,
        });
        lesson.components = [];
        state.selectedModuleLessons.push(lesson);
        toast('Lesson created');
        renderLessons();
    });
}

function showEditLessonModal(lessonId) {
    const lesson = state.selectedModuleLessons.find(l => l.id === lessonId);
    if (!lesson) return;

    showModal('Edit Lesson', [
        { name: 'number', label: 'Lesson Number', type: 'number', min: 1, value: lesson.number },
        { name: 'title', label: 'Title', value: lesson.title },
    ], async (data) => {
        const payload = {};
        if (data.number && parseInt(data.number) !== lesson.number) payload.number = parseInt(data.number);
        if (data.title && data.title !== lesson.title) payload.title = data.title;

        const updated = await api('PATCH', `/api/v1/admin/roadmap/lessons/${lessonId}`, payload);
        const idx = state.selectedModuleLessons.findIndex(l => l.id === lessonId);
        if (idx !== -1) {
            state.selectedModuleLessons[idx] = { ...state.selectedModuleLessons[idx], ...updated };
        }
        toast('Lesson updated');
        renderLessons();
    });
}

async function deleteLesson(lessonId) {
    const lesson = state.selectedModuleLessons.find(l => l.id === lessonId);
    if (!lesson) return;
    if (!confirm(`Delete Lesson "${lesson.title}"?\nAll components inside will be deleted.`)) return;

    await api('DELETE', `/api/v1/admin/roadmap/lessons/${lessonId}`);
    state.selectedModuleLessons = state.selectedModuleLessons.filter(l => l.id !== lessonId);
    toast('Lesson deleted');
    renderLessons();
}

// ==========================================
// COMPONENT CRUD MODALS
// ==========================================

function showAddComponentModal(lessonId) {
    const lesson = state.selectedModuleLessons.find(l => l.id === lessonId);
    const nextOrder = lesson && lesson.components.length
        ? Math.max(...lesson.components.map(c => c.order)) + 1
        : 1;

    showModal('Add Component', [
        { name: 'order', label: 'Order', type: 'number', min: 1, required: true, value: nextOrder },
        {
            name: 'type', label: 'Type', type: 'select', required: true,
            options: [
                { value: 'video', label: 'Video' },
                { value: 'practice', label: 'Practice' },
                { value: 'challenge', label: 'Challenge' },
                { value: 'game', label: 'Game' },
            ]
        },
        { name: 'title', label: 'Title', required: true, placeholder: 'e.g., 5 lines + 4 spaces explained visually' },
        { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Activity description (optional)' },
        { name: 'content_ref', label: 'Content Reference', placeholder: 'Video URL or asset key (optional)' },
        { name: 'special_feature', label: 'Special Feature', placeholder: 'e.g., Indie Runner Game (optional)' },
        { name: 'exercise_type', label: 'Exercise Type', placeholder: 'e.g., note_select, note_tap, playback (optional)' },
        { name: 'exercise_params', label: 'Exercise Params (JSON)', type: 'textarea', placeholder: '{"line_space_type":"lines","quiz_type":"line_space_select","clef":"treble"}' },
        { name: 'points', label: 'Points', type: 'number', min: 0, placeholder: '20' },
        { name: 'gems', label: 'Gems', type: 'number', min: 0, placeholder: '30' },
        { name: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 0, placeholder: '20' },
    ], async (data) => {
        let exerciseParams = null;
        if (data.exercise_params && data.exercise_params.trim()) {
            try { exerciseParams = JSON.parse(data.exercise_params); }
            catch { throw new Error('Exercise Params must be valid JSON'); }
        }
        const comp = await api('POST', '/api/v1/admin/roadmap/components', {
            lesson_id: lessonId,
            order: parseInt(data.order),
            type: data.type,
            title: data.title,
            description: data.description || null,
            content_ref: data.content_ref || null,
            special_feature: data.special_feature || null,
            exercise_type: data.exercise_type || null,
            exercise_params: exerciseParams,
            points: data.points ? parseInt(data.points) : null,
            gems: data.gems ? parseInt(data.gems) : null,
            timeout_seconds: data.timeout_seconds ? parseInt(data.timeout_seconds) : null,
        });
        const lesson = state.selectedModuleLessons.find(l => l.id === lessonId);
        if (lesson) lesson.components.push(comp);
        toast('Component added');
        renderLessons();
    });
}

function showEditComponentModal(componentId, lessonId) {
    const lesson = state.selectedModuleLessons.find(l => l.id === lessonId);
    if (!lesson) return;
    const comp = lesson.components.find(c => c.id === componentId);
    if (!comp) return;

    showModal('Edit Component', [
        { name: 'order', label: 'Order', type: 'number', min: 1, value: comp.order },
        {
            name: 'type', label: 'Type', type: 'select', value: comp.type,
            options: [
                { value: 'video', label: 'Video' },
                { value: 'practice', label: 'Practice' },
                { value: 'challenge', label: 'Challenge' },
                { value: 'game', label: 'Game' },
            ]
        },
        { name: 'title', label: 'Title', value: comp.title },
        { name: 'description', label: 'Description', type: 'textarea', value: comp.description || '' },
        { name: 'content_ref', label: 'Content Reference', value: comp.content_ref || '' },
        { name: 'special_feature', label: 'Special Feature', value: comp.special_feature || '' },
        { name: 'exercise_type', label: 'Exercise Type', value: comp.exercise_type || '', placeholder: 'e.g., note_select, note_tap, playback' },
        { name: 'exercise_params', label: 'Exercise Params (JSON)', type: 'textarea', value: comp.exercise_params ? JSON.stringify(comp.exercise_params, null, 2) : '' },
        { name: 'points', label: 'Points', type: 'number', min: 0, value: comp.points ?? '' },
        { name: 'gems', label: 'Gems', type: 'number', min: 0, value: comp.gems ?? '' },
        { name: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 0, value: comp.timeout_seconds ?? '' },
    ], async (data) => {
        let exerciseParams = undefined;
        if (data.exercise_params && data.exercise_params.trim()) {
            try { exerciseParams = JSON.parse(data.exercise_params); }
            catch { throw new Error('Exercise Params must be valid JSON'); }
        } else {
            exerciseParams = null;
        }

        const payload = {};
        if (parseInt(data.order) !== comp.order) payload.order = parseInt(data.order);
        if (data.type !== comp.type) payload.type = data.type;
        if (data.title !== comp.title) payload.title = data.title;
        if ((data.description || null) !== (comp.description || null)) payload.description = data.description || null;
        if ((data.content_ref || null) !== (comp.content_ref || null)) payload.content_ref = data.content_ref || null;
        if ((data.special_feature || null) !== (comp.special_feature || null)) payload.special_feature = data.special_feature || null;
        if ((data.exercise_type || null) !== (comp.exercise_type || null)) payload.exercise_type = data.exercise_type || null;
        if (JSON.stringify(exerciseParams) !== JSON.stringify(comp.exercise_params || null)) payload.exercise_params = exerciseParams;
        if ((data.points ? parseInt(data.points) : null) !== (comp.points ?? null)) payload.points = data.points ? parseInt(data.points) : null;
        if ((data.gems ? parseInt(data.gems) : null) !== (comp.gems ?? null)) payload.gems = data.gems ? parseInt(data.gems) : null;
        if ((data.timeout_seconds ? parseInt(data.timeout_seconds) : null) !== (comp.timeout_seconds ?? null)) payload.timeout_seconds = data.timeout_seconds ? parseInt(data.timeout_seconds) : null;

        const updated = await api('PATCH', `/api/v1/admin/roadmap/components/${componentId}`, payload);
        const idx = lesson.components.findIndex(c => c.id === componentId);
        if (idx !== -1) lesson.components[idx] = { ...lesson.components[idx], ...updated };
        toast('Component updated');
        renderLessons();
    });
}

async function deleteComponent(componentId, lessonId) {
    if (!confirm('Delete this component?')) return;

    await api('DELETE', `/api/v1/admin/roadmap/components/${componentId}`);
    const lesson = state.selectedModuleLessons.find(l => l.id === lessonId);
    if (lesson) lesson.components = lesson.components.filter(c => c.id !== componentId);
    toast('Component deleted');
    renderLessons();
}

// ==========================================
// UTILS
// ==========================================

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ==========================================
// NOTIFICATIONS
// ==========================================

function showRoadmapView() {
    document.getElementById('roadmap-view').classList.remove('hidden');
    document.getElementById('notifications-view').classList.add('hidden');
    document.getElementById('user-progress-view').classList.add('hidden');
    document.getElementById('leaderboard-view').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
}

function showNotificationsView() {
    document.getElementById('roadmap-view').classList.add('hidden');
    document.getElementById('notifications-view').classList.remove('hidden');
    document.getElementById('user-progress-view').classList.add('hidden');
    document.getElementById('leaderboard-view').classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
}

function showUserProgressView() {
    document.getElementById('roadmap-view').classList.add('hidden');
    document.getElementById('notifications-view').classList.add('hidden');
    document.getElementById('user-progress-view').classList.remove('hidden');
    document.getElementById('leaderboard-view').classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
}

function showLeaderboardView() {
    document.getElementById('roadmap-view').classList.add('hidden');
    document.getElementById('notifications-view').classList.add('hidden');
    document.getElementById('user-progress-view').classList.add('hidden');
    document.getElementById('leaderboard-view').classList.remove('hidden');
    document.getElementById('sidebar').classList.add('hidden');
    // Default week-start to current Monday
    const weekInput = document.getElementById('lb-week-start');
    if (!weekInput.value) {
        const today = new Date();
        const day = today.getDay(); // 0=Sun
        const diff = (day === 0 ? -6 : 1 - day);
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        weekInput.value = monday.toISOString().slice(0, 10);
    }
}

// ==========================================
// USER PROGRESS
// ==========================================

async function loadUserProgress(userId) {
    const errorEl = document.getElementById('up-error');
    const resultsEl = document.getElementById('up-results');
    errorEl.classList.add('hidden');
    resultsEl.classList.add('hidden');

    const data = await api('GET', `/api/v1/admin/roadmap/users/${userId.trim()}/progress`);

    // User info
    document.getElementById('up-email').textContent = data.email;
    const tier = data.subscription_tier || 'free';
    const status = data.subscription_status || 'none';
    const instrText = data.instrument ? `${data.instrument.charAt(0).toUpperCase() + data.instrument.slice(1)}` : 'No instrument';
    document.getElementById('up-meta').textContent = `${instrText} · ${tier.charAt(0).toUpperCase() + tier.slice(1)} (${status})`;

    // Stats
    document.getElementById('up-streak').textContent = data.streak;
    document.getElementById('up-gems').textContent = data.gems;
    document.getElementById('up-hearts').textContent = data.hearts;
    document.getElementById('up-completed').textContent = data.components_completed;

    // Current position
    const posEl = document.getElementById('up-position');
    if (data.current_module) {
        posEl.innerHTML = `<span class="up-position-label">Currently on:</span> ${escHtml(data.current_module)} › ${escHtml(data.current_lesson || '—')} › ${escHtml(data.current_component || '—')}`;
        posEl.classList.remove('hidden');
    } else {
        posEl.classList.add('hidden');
    }

    // Video progress
    const videoCount = data.video_progress.length;
    document.getElementById('up-video-count').textContent = videoCount;
    if (videoCount === 0) {
        document.getElementById('up-video-empty').classList.remove('hidden');
        document.getElementById('up-video-table').classList.add('hidden');
    } else {
        document.getElementById('up-video-empty').classList.add('hidden');
        document.getElementById('up-video-table').classList.remove('hidden');
        document.getElementById('up-video-tbody').innerHTML = data.video_progress.map(v => `
            <tr>
                <td>
                    <span class="component-type-badge type-${v.component_type}">${v.component_type}</span>
                    ${escHtml(v.component_title)}
                </td>
                <td>
                    <div class="up-progress-bar-wrap">
                        <div class="up-progress-bar" style="width:${Math.round(v.watch_percentage * 100)}%"></div>
                    </div>
                    <span class="up-pct">${Math.round(v.watch_percentage * 100)}%</span>
                </td>
                <td>${formatSeconds(v.total_watch_time_seconds)}</td>
                <td>${v.total_replay_count}</td>
                <td>${v.completed ? '<span class="up-badge-done">Done</span>' : '<span class="up-badge-pending">In Progress</span>'}</td>
                <td class="up-date">${v.last_watched_at ? formatDate(v.last_watched_at) : '—'}</td>
            </tr>
        `).join('');
    }

    // Exercise progress
    const exCount = data.exercise_progress.length;
    document.getElementById('up-exercise-count').textContent = exCount;
    if (exCount === 0) {
        document.getElementById('up-exercise-empty').classList.remove('hidden');
        document.getElementById('up-exercise-table').classList.add('hidden');
    } else {
        document.getElementById('up-exercise-empty').classList.add('hidden');
        document.getElementById('up-exercise-table').classList.remove('hidden');
        document.getElementById('up-exercise-tbody').innerHTML = data.exercise_progress.map(e => `
            <tr>
                <td>
                    <span class="component-type-badge type-${e.component_type}">${e.component_type}</span>
                    ${escHtml(e.component_title)}
                </td>
                <td>${e.best_score != null ? Math.round(e.best_score * 100) + '%' : '—'}</td>
                <td>${e.best_stars != null ? '⭐'.repeat(e.best_stars) || '0' : '—'}</td>
                <td>${e.attempt_count}</td>
                <td>${e.completion_count}</td>
                <td>${e.best_time_taken_seconds != null ? formatSeconds(e.best_time_taken_seconds) : '—'}</td>
                <td class="up-date">${e.last_attempted_at ? formatDate(e.last_attempted_at) : '—'}</td>
            </tr>
        `).join('');
    }

    resultsEl.classList.remove('hidden');
}

function formatSeconds(secs) {
    if (secs == null) return '—';
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDate(iso) {
    try {
        return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

async function sendNotification(title, body, userId = null) {
    const payload = { title, body, data: {} };
    if (userId && userId.trim()) {
        payload.user_id = userId;
    }

    const result = await api('POST', '/api/v1/notifications/admin/send', payload);
    return result;
}

// ==========================================
// LEADERBOARD
// ==========================================

async function refreshLeaderboard() {
    const instrument = document.getElementById('lb-instrument').value;
    const weekStart = document.getElementById('lb-week-start').value;
    const statusEl = document.getElementById('lb-status');
    const errorEl = document.getElementById('lb-error');

    statusEl.classList.add('hidden');
    errorEl.classList.add('hidden');

    const btn = document.getElementById('lb-refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Computing…';

    try {
        const params = `instrument=${instrument}&week_start=${weekStart}`;
        const result = await api('POST', `/api/v1/leaderboard/admin/refresh?${params}`);
        statusEl.textContent = `✓ Done — ${result.rows_updated} user(s) ranked for ${result.instrument} · week of ${result.week_start}`;
        statusEl.classList.remove('hidden');
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Compute / Refresh';
    }
}

async function viewLeaderboard() {
    const instrument = document.getElementById('lb-instrument').value;
    const weekStart = document.getElementById('lb-week-start').value;
    const errorEl = document.getElementById('lb-error');
    const resultsEl = document.getElementById('lb-results');
    const emptyEl = document.getElementById('lb-empty');
    const tableEl = document.getElementById('lb-table');

    errorEl.classList.add('hidden');
    resultsEl.classList.add('hidden');

    try {
        const params = `instrument=${instrument}&week_start=${weekStart}`;
        const data = await api('GET', `/api/v1/leaderboard/weekly?${params}`);

        const metaEl = document.getElementById('lb-meta');
        if (data.computed_at) {
            metaEl.textContent = `Snapshot computed at ${formatDate(data.computed_at)} · ${data.entries.length} user(s) ranked`;
        } else {
            metaEl.textContent = 'No snapshot yet for this week. Click "Compute / Refresh" to generate.';
        }

        if (!data.entries.length) {
            emptyEl.classList.remove('hidden');
            tableEl.classList.add('hidden');
        } else {
            emptyEl.classList.add('hidden');
            tableEl.classList.remove('hidden');
            document.getElementById('lb-tbody').innerHTML = data.entries.map(e => `
                <tr class="${data.current_user_entry && e.user_id === data.current_user_entry.user_id ? 'lb-current-user' : ''}">
                    <td><span class="lb-rank lb-rank-${e.rank <= 3 ? e.rank : 'other'}">#${e.rank}</span></td>
                    <td>${escHtml(e.full_name || 'Unknown')}</td>
                    <td>${e.total_components}</td>
                    <td>${e.practice_components}</td>
                    <td>${e.weekly_streak} day${e.weekly_streak !== 1 ? 's' : ''}</td>
                </tr>
            `).join('');
        }

        resultsEl.classList.remove('hidden');
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');

    const apiUrl = document.getElementById('api-url').value.replace(/\/$/, '');
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    state.apiUrl = apiUrl;
    localStorage.setItem('apiUrl', apiUrl);

    try {
        await login(email, password);
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        await loadModules();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    }
});

document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('add-module-btn').addEventListener('click', showAddModuleModal);
document.getElementById('add-lesson-btn').addEventListener('click', showAddLessonModal);
document.getElementById('edit-module-btn').addEventListener('click', showEditModuleModal);
document.getElementById('delete-module-btn').addEventListener('click', deleteModuleAction);
document.getElementById('toggle-publish-btn').addEventListener('click', togglePublish);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});
document.getElementById('instrument-filter').addEventListener('change', loadModules);

// Navigation buttons
document.getElementById('roadmap-nav-btn').addEventListener('click', showRoadmapView);
document.getElementById('notifications-nav-btn').addEventListener('click', showNotificationsView);
document.getElementById('user-progress-nav-btn').addEventListener('click', showUserProgressView);
document.getElementById('leaderboard-nav-btn').addEventListener('click', showLeaderboardView);

// Leaderboard
document.getElementById('lb-refresh-btn').addEventListener('click', refreshLeaderboard);
document.getElementById('lb-view-btn').addEventListener('click', viewLeaderboard);

// User Progress search
document.getElementById('up-search-btn').addEventListener('click', async () => {
    const userId = document.getElementById('up-user-id-input').value.trim();
    const errorEl = document.getElementById('up-error');
    if (!userId) {
        errorEl.textContent = 'Please enter a User ID';
        errorEl.classList.remove('hidden');
        return;
    }
    try {
        await loadUserProgress(userId);
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    }
});

document.getElementById('up-user-id-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') document.getElementById('up-search-btn').click();
});

// Notifications form
document.getElementById('send-notification-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('send-notif-error');
    errorEl.classList.add('hidden');

    const title = document.getElementById('notif-title').value.trim();
    const body = document.getElementById('notif-body').value.trim();
    const userId = document.getElementById('notif-user-id').value.trim();

    if (!title || !body) {
        errorEl.textContent = 'Title and message are required';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const result = await sendNotification(title, body, userId);
        toast(`Notification sent successfully (${result.success} delivered)`);

        // Clear form
        document.getElementById('send-notification-form').reset();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    }
});

// Pre-fill saved API URL (or production default)
document.getElementById('api-url').value = state.apiUrl;

// Auto-login if token exists
if (state.token) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    loadModules().catch(() => {
        logout();
    });
}
