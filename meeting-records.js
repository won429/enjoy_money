(function (root) {
    'use strict';
    function period(year, month) {
        year = Number(year); month = Number(month);
        if (!Number.isInteger(year) || year < 2025 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12)
            throw new Error('회비 내역의 연도와 월을 확인해 주세요.');
        return { year, month, key: `${year}-${month}` };
    }
    // The original twelve numeric keys cover Oct 2025 through Sep 2026 only.
    // A later year's payment must never be written back to these keys.
    function legacyKey(year, month) {
        const date = period(year, month);
        return (date.year === 2025 && date.month >= 10) || (date.year === 2026 && date.month <= 9) ? String(date.month) : null;
    }
    function read(data, year, month) {
        const date = period(year, month), records = data && data.records || {};
        const padded = `${date.year}-${String(date.month).padStart(2, '0')}`;
        const candidates = [...new Set([date.key, padded, legacyKey(date.year, date.month)].filter(Boolean))];
        for (const key of candidates) {
            if (!Object.prototype.hasOwnProperty.call(records, key)) continue;
            if (!Array.isArray(records[key])) throw new Error(`${date.year}년 ${date.month}월 납부 자료 형식을 확인해 주세요.`);
            return { ...date, rows: records[key], sourceKey: key, found: true };
        }
        return { ...date, rows: [], sourceKey: null, found: false };
    }
    const api = { key: (year, month) => period(year, month).key, legacyKey, read,
        rowsAt: (data, year, month) => read(data, year, month).rows,
        regularDues: year => Number(year) >= 2026 ? 20000 : 15000 };
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.EnjoyMeetingRecords = api;
})(typeof window === 'object' ? window : null);
