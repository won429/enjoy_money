(function (root) {
    'use strict';
    const periods = root?.EnjoyMeetingRecords || (typeof require === 'function' ? require('./meeting-records.js') : null);
    const names = ['홍박사', '류짱', '오스틴', '전시기', '이진누', '성원제'];
    const nameOf = name => name === '지노' ? '이진누' : name;
    const copy = value => {
        if (value == null || typeof value !== 'object' || typeof value.toDate === 'function') return value;
        if (value instanceof Date) return new Date(value);
        return Array.isArray(value) ? value.map(copy) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
    };
    function stable(value) {
        if (value == null || typeof value !== 'object') return JSON.stringify(value);
        if (typeof value.toMillis === 'function') return 'timestamp:' + value.toMillis();
        if (value instanceof Date) return 'date:' + value.getTime();
        return Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' :
            '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }
    const same = (a, b) => stable(a) === stable(b);
    const rowsOf = rows => rows.map(row => ({ ...copy(row), name: nameOf(row.name) }));
    const empty = () => names.map(name => ({ name, status: 'unpaid', amount: 0, isLeader: name === '전시기' }));
    const counts = data => {
        const result = {};
        Object.entries(data?.exemptions || { '류짱': 1, '성원제': 1, '전시기': 1 }).forEach(([name, count]) => {
            const key = nameOf(name); result[key] = (result[key] || 0) + Math.max(0, Math.floor(Number(count) || 0));
        });
        return result;
    };
    const field = (data, name) => name === 'notice' ? String(data?.notice || '') :
        name === 'expenses' ? data?.expenses || [] : Number(data?.totalBalance) || 0;
    const conflict = label => { throw new Error(label + ' 내역이 다른 화면에서 변경됐어요. 서버 내역을 다시 불러온 후 수정해 주세요.'); };
    function createEditor() {
        let base = null;
        const drafts = new Map();
        function load(data) { base = copy(data); drafts.clear(); }
        function draft(year, month) {
            const key = periods.key(year, month);
            if (!drafts.has(key)) {
                const source = rowsOf(periods.rowsAt(base || {}, year, month));
                const initial = source.length ? source : empty();
                drafts.set(key, { key, year: Number(year), month: Number(month), source, initial: copy(initial), rows: copy(initial) });
            }
            return drafts.get(key);
        }
        const changedMonths = () => [...drafts.values()].filter(d => !same(d.initial, d.rows));
        function hasChanges(local) {
            if (!base || !local) return false;
            return changedMonths().length > 0 || !same(counts(base), counts(local)) ||
                ['totalBalance', 'notice', 'expenses'].some(key => !same(field(base, key), field(local, key)));
        }
        function plan(local, current) {
            if (!base) throw new Error('회비 내역을 먼저 불러와 주세요.');
            const patch = {};
            const months = changedMonths();
            if (months.length) {
                const records = { ...(current.records || {}) };
                for (const d of months) {
                    if (!same(rowsOf(periods.rowsAt(current, d.year, d.month)), d.source)) conflict(`${d.year}년 ${d.month}월 회비`);
                    records[d.key] = copy(d.rows);
                }
                patch.records = records;
            }
            const before = counts(base), after = counts(local), actual = counts(current);
            for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
                if ((before[name] || 0) === (after[name] || 0)) continue;
                if ((actual[name] || 0) !== (before[name] || 0)) conflict(`${name}님의 면제권`);
                if (!patch.exemptions) patch.exemptions = { ...(current.exemptions || {}) };
                patch.exemptions[name] = after[name] || 0;
                if (name === '이진누') delete patch.exemptions['지노'];
            }
            for (const key of ['totalBalance', 'notice', 'expenses']) {
                if (same(field(base, key), field(local, key))) continue;
                if (!same(field(base, key), field(current, key))) conflict({ totalBalance: '회비 잔액', notice: '공지', expenses: '가계부' }[key]);
                patch[key] = copy(field(local, key));
            }
            return { patch, data: { ...copy(current), ...patch } };
        }
        function freeze(local) {
            const staged = createEditor(); staged.load(base);
            for (const d of drafts.values()) {
                const rows = staged.rows(d.year, d.month); rows.splice(0, rows.length, ...copy(d.rows));
            }
            const values = copy(local);
            return current => staged.plan(values, current);
        }
        function preview(local) {
            const data = copy(local);
            for (const d of changedMonths()) {
                if (!data.records) data.records = {};
                data.records[d.key] = copy(d.rows);
            }
            return data;
        }
        return { load, rows: (year, month) => draft(year, month).rows, hasChanges, plan, freeze, preview };
    }
    if (typeof module === 'object' && module.exports) module.exports = { createEditor };
    if (!root?.document) return;
    const editor = createEditor();
    let editing = null, invalid = false, saving = false;
    function capture() {
        if (!editing || !root.meetingData) return;
        invalid = false;
        const rows = editor.rows(editing.year, editing.month);
        let paymentDelta = 0;
        rows.forEach((row, index) => {
            const input = root.document.getElementById('edit-amt-' + index);
            if (!input) return;
            const value = Number(input.value);
            if (!Number.isSafeInteger(value) || value < 0 || input.validity?.badInput) { invalid = true; return; }
            if (row.status === 'paid') paymentDelta += value - (Number(row.amount) || 0);
            row.amount = value;
        });
        const balance = root.document.getElementById('admin-total-balance');
        if (balance) {
            const value = Number(balance.value);
            if (Number.isSafeInteger(value) && Number.isSafeInteger(value + paymentDelta)) {
                root.meetingData.totalBalance = value + paymentDelta;
                balance.value = String(root.meetingData.totalBalance);
            }
            else invalid = true;
        }
        const notice = root.document.getElementById('admin-notice-input');
        if (notice) root.meetingData.notice = notice.value;
    }
    function select(year, month) {
        if (saving) return;
        capture();
        const date = new Date(Number(year), Number(month) - 1, 1);
        root.currentDuesYear = Math.max(2025, date.getFullYear());
        root.currentDuesMonth = date.getMonth() + 1;
        if (root.currentDuesYear === 2025 && root.currentDuesMonth < 10) root.currentDuesMonth = 10;
        root.openAdminModalReal();
    }
    root.changeAdminMonth = delta => select(root.currentDuesYear, root.currentDuesMonth + Number(delta));
    root.changeAdminYear = year => select(Number(year), root.currentDuesMonth);
    root.adminDuesRecords = () => editor.rows(root.currentDuesYear, root.currentDuesMonth);
    root.adminDues = {
        capture,
        isSaving: () => saving,
        hasChanges: data => invalid || editor.hasChanges(data),
        load(data) { editor.load(data); editing = null; invalid = false; },
        preview(data) {
            if (invalid) throw new Error('회비 금액은 0 이상의 정수로 입력해 주세요.');
            return editor.preview(data);
        },
        renderPeriod() {
            editing = { year: root.currentDuesYear, month: root.currentDuesMonth };
            const select = root.document.getElementById('admin-dues-year');
            if (select) {
                const end = Math.max(new Date().getFullYear() + 1, root.currentDuesYear);
                select.innerHTML = Array.from({ length: end - 2024 }, (_, i) => '<option value="' + (2025 + i) + '">' + (2025 + i) + '년</option>').join('');
                select.value = String(root.currentDuesYear);
            }
        },
        async save(local) {
            if (saving) throw new Error('저장 중이에요. 잠시만 기다려 주세요.');
            if (invalid) throw new Error('회비 금액은 0 이상의 정수로 입력해 주세요.');
            const api = root.adminDuesDb, user = api?.user();
            if (!user || !root.adminDbReady) throw new Error('Google 로그인 후 다시 저장해 주세요.');
            const plan = editor.freeze(local);
            const screen = root.document.getElementById('admin-screen'), previousInert = screen?.inert;
            saving = true;
            if (screen) { screen.inert = true; screen.setAttribute('aria-busy', 'true'); }
            try {
                const result = await api.transaction(async tx => {
                    const reference = api.doc('meeting_account', 'dues_status');
                    const snap = await tx.get(reference);
                    if (!api.user() || api.user().uid !== user.uid) throw new Error('로그인 계정이 변경됐어요.');
                    if (!snap.exists()) throw new Error('서버에 회비 내역이 없어요. 연결을 확인해 주세요.');
                    const result = plan(snap.data());
                    if (Object.keys(result.patch).length) tx.update(reference, result.patch);
                    return result.data;
                });
                if (!api.user() || api.user().uid !== user.uid) throw new Error('로그인 계정이 변경됐어요.');
                editor.load(result); editing = null; invalid = false;
                return result;
            } finally {
                saving = false;
                if (screen) { screen.inert = previousInert; screen.removeAttribute('aria-busy'); }
            }
        },
        async reload() {
            if (saving) return;
            capture();
            if ((editor.hasChanges(root.meetingData) || root._ledgerDirty) && !root.confirm('저장하지 않은 수정을 취소하고 서버 내역을 다시 불러올까요?')) return;
            const api = root.adminDuesDb, user = api?.user();
            if (!user) return root.alert('Google 로그인 후 다시 불러와 주세요.');
            try {
                const snap = await api.read(api.doc('meeting_account', 'dues_status'));
                if (!api.user() || api.user().uid !== user.uid) return;
                if (!snap.exists()) throw new Error('서버에 회비 내역이 없어요.');
                root.meetingData = snap.data(); root.adminDues.load(root.meetingData);
                root._ledgerDirty = false; root._ledgerAppliedDelta = 0;
                root._savedExpenseNet = root.calculateExpenseNet(root.meetingData.expenses || []);
                root.openAdminModalReal();
            } catch (error) { root.alert(error.message || '다시 불러오지 못했어요.'); }
        }
    };
})(typeof window === 'object' ? window : null);
