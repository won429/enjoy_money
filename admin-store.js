(function (root) {
    'use strict';
    const names = ['홍박사', '류짱', '오스틴', '전시기', '이진누', '성원제'];
    const titles = { waiver: '부과금 면제권', dues: '모임비 차감권', baemin: '배달의 민족 5천원 상품권' };
    function completionPlan(order, member, adminUid, now = Date.now()) {
        if (!order || order.productId !== 'baemin') throw new Error('배민 상품권 구매 신청을 확인해 주세요.');
        if (order.status === 'fulfilled') return null;
        if (order.status !== 'pending') throw new Error('지급 대기 중인 신청만 완료할 수 있습니다.');
        const limits = member && member.storePurchaseLimits;
        return {
            orderPatch: { status: 'fulfilled', fulfilledAt: now, fulfilledBy: adminUid },
            memberPatch: limits && limits.baemin && limits.baemin.pendingOrderId === order.id
                ? { storePurchaseLimits: { ...limits, baemin: null } } : null
        };
    }
    if (typeof module === 'object' && module.exports) module.exports = { completionPlan };
    if (!root || !root.document) return;
    let orders = [], unsubscribe = null, epoch = 0, subscriptionUid = '', state = '로그인 후 구매 내역을 불러옵니다.';
    const busy = new Set();
    const node = id => root.document.getElementById(id);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const format = value => Number(value || 0).toLocaleString('ko-KR');
    const nameOf = value => value === '지노' ? '이진누' : value || '이름 미등록';
    const date = value => Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '날짜 미등록';
    const status = order => order.productId === 'baemin' ? order.status === 'fulfilled' ? '지급 완료' : order.status === 'cancelled' ? '취소' : '지급 대기'
        : order.productId === 'dues' ? `${order.appliedMonth || ''} 모임비 차감 완료` : '면제권 지급 완료';
    function memberList() {
        const result = new Map();
        (root.adminScratchMembers || []).filter(member => names.includes(nameOf(member.name))).forEach(member => result.set(member.uid, { uid: member.uid, name: nameOf(member.name) }));
        orders.forEach(order => { if (!result.has(order.uid)) result.set(order.uid, { uid: order.uid, name: nameOf(order.memberName) }); });
        return [...result.values()].sort((a, b) => {
            const ai = names.indexOf(a.name), bi = names.indexOf(b.name);
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
        });
    }
    root.renderAdminStore = function () {
        const pendingNode = node('admin-store-pending'), historyNode = node('admin-store-history'), select = node('admin-store-member');
        if (!pendingNode || !historyNode || !select) return;
        const members = memberList(), selected = select.value || '';
        const expanded = new Set(historyNode.querySelectorAll ? [...historyNode.querySelectorAll('details[open]')].map(detail => detail.dataset.memberUid) : []);
        select.innerHTML = '<option value="">전체 멤버</option>' + members.map(member => `<option value="${esc(member.uid)}">${esc(member.name)}</option>`).join('');
        select.value = members.some(member => member.uid === selected) ? selected : '';
        const pending = orders.filter(order => order.productId === 'baemin' && order.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
        const count = node('admin-store-pending-count');
        if (count) count.textContent = `${pending.length}건`;
        pendingNode.innerHTML = pending.length ? pending.map(order => `<article class="admin-store-card"><div class="admin-store-card-heading"><strong>${esc(nameOf(order.memberName))}</strong><span class="admin-store-badge">지급 대기</span></div><p>배달의 민족 5천원 상품권</p><small>${date(order.createdAt)} · ${format(order.pointsSpent)} P</small><button type="button" data-complete-order="${esc(order.id)}" ${busy.has(order.id) || !!state || !root.adminDbReady ? 'disabled' : ''}>${busy.has(order.id) ? '저장 중…' : '완료'}</button></article>`).join('')
            : `<p class="admin-store-empty">${esc(state || '지급 대기 중인 배민 상품권이 없습니다.')}</p>`;
        historyNode.innerHTML = members.filter(member => !select.value || member.uid === select.value).map(member => {
            const history = orders.filter(order => order.uid === member.uid).sort((a, b) => b.createdAt - a.createdAt);
            return `<details class="admin-store-member" data-member-uid="${esc(member.uid)}" ${select.value || expanded.has(member.uid) ? 'open' : ''}><summary><strong>${esc(member.name)}</strong><span>${history.length}건 <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></span></summary><div>${history.length ? history.map(order => `<div class="admin-store-order"><strong>${esc(titles[order.productId] || order.productTitle)}</strong><span>${date(order.createdAt)}</span><span>${format(order.pointsSpent)} P · ${format(order.amount)}원</span><small class="${order.status === 'pending' ? 'is-pending' : ''}">${esc(status(order))}</small>${order.fulfilledAt ? `<span>지급 완료 · ${date(order.fulfilledAt)}</span>` : ''}</div>`).join('') : '<p class="admin-store-empty">구매 내역이 없습니다.</p>'}</div></details>`;
        }).join('') || `<p class="admin-store-empty">${esc(state || '구매 내역이 없습니다.')}</p>`;
        const statusNode = node('admin-store-status');
        if (statusNode) statusNode.textContent = state;
    };
    root.stopAdminStore = function () {
        epoch++;
        if (unsubscribe) unsubscribe();
        unsubscribe = null; subscriptionUid = ''; orders = []; state = '로그인 후 구매 내역을 불러옵니다.';
        root.renderAdminStore();
    };
    root.startAdminStore = function () {
        const api = root.adminStoreDb, user = api && api.user();
        if (!user || !root.adminDbReady) return;
        if (unsubscribe && subscriptionUid === user.uid) return;
        root.stopAdminStore();
        const currentEpoch = ++epoch;
        subscriptionUid = user.uid; state = '구매 내역을 불러오는 중입니다.'; root.renderAdminStore();
        unsubscribe = api.subscribe(snapshot => {
            if (currentEpoch !== epoch || !api.user() || api.user().uid !== subscriptionUid) return;
            orders = [];
            snapshot.forEach(entry => orders.push({ ...entry.data(), id: entry.id }));
            state = ''; root.renderAdminStore();
        }, () => {
            if (currentEpoch !== epoch) return;
            if (unsubscribe) unsubscribe();
            unsubscribe = null; state = '구매 내역을 불러오지 못했습니다. DB 연결 버튼을 눌러 권한을 확인해 주세요.';
            root.renderAdminStore();
        });
    };
    root.completeAdminStoreOrder = async function (id) {
        if (busy.has(id)) return;
        if (!root.adminDbReady && root.adminFirebaseLogin) await root.adminFirebaseLogin();
        const api = root.adminStoreDb, user = api && api.user();
        if (!user || !root.adminDbReady) return root.alert('Google 로그인 후 다시 시도해 주세요.');
        busy.add(id); root.renderAdminStore();
        try {
            const result = await api.transaction(async transaction => {
                const orderRef = api.doc('store_orders', id), snapshot = await transaction.get(orderRef);
                if (!snapshot.exists()) throw new Error('구매 신청이 없습니다.');
                const order = { ...snapshot.data(), id }, memberRef = api.doc('members', order.uid);
                const person = await transaction.get(memberRef);
                if (!api.user() || api.user().uid !== user.uid || !root.adminDbReady) throw new Error('로그인 정보가 변경되었습니다. 다시 시도해 주세요.');
                const plan = completionPlan(order, person.exists() ? person.data() : null, user.uid);
                if (!plan) return order;
                transaction.update(orderRef, plan.orderPatch);
                if (plan.memberPatch) transaction.update(memberRef, plan.memberPatch);
                return { ...order, ...plan.orderPatch };
            });
            if (api.user() && api.user().uid === user.uid) {
                orders = orders.map(order => order.id === id ? result : order);
                root.alert('지급 완료로 표시했습니다. 해당 멤버는 배민 상품권을 다시 구매할 수 있습니다.');
            }
        } catch (failure) {
            root.alert(`완료 처리하지 못했습니다. ${failure.code ? 'Firebase 권한과 연결을 확인한 후 다시 시도해 주세요.' : failure.message}`);
        } finally { busy.delete(id); root.renderAdminStore(); }
    };
    const pendingNode = node('admin-store-pending');
    if (pendingNode) pendingNode.addEventListener('click', event => {
        const button = event.target.closest('[data-complete-order]');
        if (button && !button.disabled) root.completeAdminStoreOrder(button.dataset.completeOrder);
    });
    root.renderAdminStore();
})(typeof window === 'object' ? window : null);
