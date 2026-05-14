const HistoryActions = (() => {

    function openRowHistory(rowId, rows) {
        const row = rows.find(r => r.id === rowId);
        HistoryPanel.showRowLog(rowId, row);
    }

    function openCellHistory(rowId, colSlug, rows) {
        const row = rows.find(r => r.id === rowId);
        HistoryPanel.showCellLog(rowId, colSlug, row);
    }

    function openRangeHistory(ranges, filteredRows, columns) {
        HistoryPanel.showRangeLog(ranges, filteredRows, columns);
    }

    return { openRowHistory, openCellHistory, openRangeHistory };

})();
