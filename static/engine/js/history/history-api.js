const HistoryApi = (() => {

    async function getAudit(params) {
        return ApiClient.getAudit(params);
    }

    async function rollbackCell(rowId, colSlug, entryId) {
        return ApiClient.rollbackCell(rowId, colSlug, entryId);
    }

    return { getAudit, rollbackCell };

})();
