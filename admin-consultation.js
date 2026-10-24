(function (root) {
    'use strict';
    const ADMIN_UID = 'tdC9Bzxz7JRjpEceOLzpDCMKeBE2';
    const STATUSES = { pending: '접수', contacted: '연락', completed: '완료', cancelled: '취소' };
    const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    function millis(value) {
        if (value && typeof value.toMillis === 'function') return value.toMillis();
        if (value && typeof value.seconds === 'number') return value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    function filterReservations(records, { status = '', date = '', search = '' } = {}) {
        const text = search.trim().toLocaleLowerCase('ko-KR');
        return records.filter(record => (!status || record.status === status) && (!date || record.date === date)
            && (!text || [record.name, record.email].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(text))))
            .sort((a, b) => millis(b.createdAt) - millis(a.createdAt) || String(a.id).localeCompare(String(b.id)));
    }
    function statusPatch(record, next, expected, timestamp) {
        if (!record) throw new Error('예약이 삭제되었거나 존재하지 않습니다.');
        if (!Object.hasOwn(STATUSES, next)) throw new Error('변경할 상태를 선택해 주세요.');
        if (record.status !== expected) throw new Error('다른 창에서 예약 상태가 변경되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.');
        return record.status === next ? null : { status: next, updatedAt: timestamp };
    }
    function createController(env, onChange = () => {}) {
        let records = [], generation = 0, unsubscribe = null, uid = '', connected = false;
        let message = '관리자 Google 계정으로 로그인하면 예약 현황을 볼 수 있습니다.';
        const busy = new Set();
        const api = () => env.adminConsultationDb;
        const user = () => api()?.user();
        const allowed = () => user()?.uid === ADMIN_UID && env.adminDbReady;
        const snapshot = () => ({ records: [...records], connected, message, busy: new Set(busy) });
        const notify = () => onChange(snapshot());
        const current = (epoch, owner) => generation === epoch && allowed() && user()?.uid === owner;
        function stop() {
            generation++; unsubscribe?.(); unsubscribe = null; uid = ''; records = []; connected = false; busy.clear();
            message = '관리자 Google 계정으로 로그인하면 예약 현황을 볼 수 있습니다.'; notify();
        }
        function start() {
            if (!allowed()) { stop(); if (user()) { message = '상담 예약은 지정된 관리자 계정으로만 확인할 수 있습니다.'; notify(); } return; }
            if (unsubscribe && uid === user().uid) return;
            stop(); const epoch = generation, owner = user().uid; uid = owner;
            message = '예약 현황을 불러오는 중입니다.'; notify();
            try {
                unsubscribe = api().subscribe(data => {
                    if (!current(epoch, owner)) return;
                    records = [];
                    data.forEach(doc => records.push({ ...doc.data(), id: doc.id }));
                    connected = !data.metadata?.fromCache && !data.metadata?.hasPendingWrites;
                    message = connected ? '' : '저장된 예약을 표시하고 있습니다. 서버 연결 후 상태를 변경할 수 있습니다.';
                    notify();
                }, () => {
                    if (!current(epoch, owner)) return;
                    generation++; unsubscribe?.(); unsubscribe = null; records = []; connected = false;
                    message = '예약을 불러오지 못했습니다. 관리자 계정과 Firebase 보안 규칙을 확인하고 새로고침해 주세요.'; notify();
                });
            } catch (_) { connected = false; message = '예약 연결을 시작하지 못했습니다. 새로고침해 주세요.'; notify(); }
        }
        async function update(id, next) {
            if (busy.has(id)) return;
            if (!allowed() || !connected) throw new Error('관리자 로그인과 서버 연결을 확인해 주세요.');
            const record = records.find(entry => entry.id === id);
            if (!record) throw new Error('예약을 찾을 수 없습니다. 새로고침해 주세요.');
            const expected = record.status, epoch = generation, owner = uid, db = api();
            if (!statusPatch(record, next, expected, null)) return;
            busy.add(id); notify();
            try {
                const ref = db.doc('consultation_reservations', id);
                await db.transaction(async transaction => {
                    const data = await transaction.get(ref);
                    if (!current(epoch, owner)) throw new Error('로그인 정보가 변경되었습니다.');
                    const patch = statusPatch(data.exists() ? data.data() : null, next, expected, db.serverTimestamp());
                    if (patch) transaction.update(ref, patch);
                });
                // The live listener supplies the authoritative status and timestamp after the server commits.
                return current(epoch, owner);
            } finally { if (generation === epoch) { busy.delete(id); notify(); } }
        }
        return { start, stop, update, snapshot };
    }
    if (typeof module === 'object' && module.exports) module.exports = { ADMIN_UID, STATUSES, esc, millis, filterReservations, statusPatch, createController };
    if (!root?.document) return;
    const node = id => root.document.getElementById(id);
    const list = node('admin-consultation-list');
    if (!list) return;
    let notice = '';
    const timestampText = value => millis(value) ? new Date(millis(value)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }) : '확인 중';
    function render(state) {
        const filtered = filterReservations(state.records, { status: node('admin-consultation-filter').value, date: node('admin-consultation-date').value, search: node('admin-consultation-search').value });
        node('admin-consultation-counts').textContent = Object.entries(STATUSES).map(([key, label]) => label + ' ' + state.records.filter(record => record.status === key).length).join(' · ');
        node('admin-consultation-message').textContent = state.message || notice;
        node('admin-consultation-result-count').textContent = '총 ' + state.records.length + '건 · 표시 ' + filtered.length + '건';
        const selections = new Map(Array.from(list.querySelectorAll('select[data-reservation-status]'), select => [select.dataset.reservationStatus, { value: select.value, original: select.dataset.originalStatus }]));
        const focused = root.document.activeElement;
        const focusId = list.contains(focused) ? focused.dataset.reservationStatus || focused.dataset.saveReservation : '';
        const focusType = focused?.tagName;
        list.innerHTML = filtered.map(record => {
            const validStatus = Object.hasOwn(STATUSES, record.status) ? record.status : '';
            const old = selections.get(record.id);
            const value = old?.original === record.status && Object.hasOwn(STATUSES, old.value) ? old.value : validStatus;
            const weekdays = Array.isArray(record.weekdays) ? record.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6).map(day => WEEKDAYS[day]).join('·') : '';
            const disabled = !state.connected || state.busy.has(record.id);
            return `<article class="consultation-admin-card"><div class="consultation-admin-heading"><strong>${esc(record.name || '이름 미등록')}</strong><span class="consultation-admin-badge" data-status="${esc(validStatus)}">${esc(STATUSES[validStatus] || '상태 확인 필요')}</span></div>
                <p class="consultation-admin-email">${esc(record.email || '이메일 미등록')}</p>
                <dl><div><dt>희망 날짜</dt><dd>${esc(record.date || '미등록')}</dd></div><div><dt>상담 시간</dt><dd>${esc(record.time || record.startTime || '—')} <small>한국 시간</small></dd></div><div><dt>가능 요일</dt><dd>${esc(weekdays || '미등록')}</dd></div></dl>
                <div class="consultation-admin-purpose"><strong>상담 목적</strong><p>${esc(record.purpose || '작성하지 않음')}</p></div>
                <p class="consultation-admin-meta">접수 ${esc(timestampText(record.createdAt))}${record.updatedAt ? '<br>상태 변경 ' + esc(timestampText(record.updatedAt)) : ''}</p>
                <div class="consultation-admin-actions"><select data-reservation-status="${esc(record.id)}" data-original-status="${esc(record.status)}" aria-label="${esc(record.name || '신청자')} 예약 처리 상태" ${disabled ? 'disabled' : ''}>${value ? '' : '<option value="">상태 선택</option>'}${Object.entries(STATUSES).map(([key,label])=>`<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button type="button" data-save-reservation="${esc(record.id)}" ${disabled ? 'disabled' : ''}>${state.busy.has(record.id) ? '저장 중…' : '상태 저장'}</button></div></article>`;
        }).join('') || '<p class="consultation-admin-empty">' + esc(state.message || (state.records.length ? '선택한 조건에 맞는 예약이 없습니다.' : '접수된 상담 예약이 없습니다.')) + '</p>';
        if (focusId) Array.from(list.querySelectorAll(focusType === 'SELECT' ? 'select[data-reservation-status]' : 'button[data-save-reservation]')).find(element => (element.dataset.reservationStatus || element.dataset.saveReservation) === focusId)?.focus({preventScroll:true});
    }
    const controller = createController(root, render);
    root.renderAdminConsultation = () => render(controller.snapshot());
    root.startAdminConsultation = controller.start;
    root.stopAdminConsultation = () => { notice = ''; controller.stop(); };
    node('admin-consultation-refresh').addEventListener('click', () => { notice = ''; controller.stop(); controller.start(); });
    ['admin-consultation-filter', 'admin-consultation-date', 'admin-consultation-search'].forEach(id => node(id).addEventListener(id.endsWith('search') ? 'input' : 'change', root.renderAdminConsultation));
    list.addEventListener('click', async event => {
        const button = event.target.closest('[data-save-reservation]');
        if (!button || button.disabled) return;
        const id = button.dataset.saveReservation;
        const select = Array.from(list.querySelectorAll('select[data-reservation-status]')).find(element => element.dataset.reservationStatus === id);
        if (!select) return;
        notice = '';
        try { if (await controller.update(id, select.value)) notice = '예약 상태를 저장했습니다.'; }
        catch (failure) { notice = failure.code ? '상태를 저장하지 못했습니다. Firebase 권한과 인터넷 연결을 확인해 주세요.' : failure.message; }
        root.renderAdminConsultation();
    });
    root.renderAdminConsultation();
})(typeof window === 'object' ? window : null);
