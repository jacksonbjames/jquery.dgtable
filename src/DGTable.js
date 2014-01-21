/*
 The MIT License (MIT)

 Copyright (c) 2014 Daniel Cohen Gindi (danielgindi@gmail.com)

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */
(function () {
    "use strict";

    // TODO: Allow non-virtual tables
    // TODO: Variable row height?

    var userAgent = navigator.userAgent;
    var ieVersion = userAgent.indexOf('MSIE ') != -1 ? parseFloat(userAgent.substr(userAgent.indexOf('MSIE ') + 5)) : null;
    var hasIeTableDisplayBlockBug = ieVersion && ieVersion < 10;
    var hasIeDragAndDropBug = ieVersion && ieVersion < 10;

    /**
     * @class DGTable
     * @extends Backbone.View
     */
    var DGTable = Backbone.View.extend(
        /** @lends DGTable.prototype */
        {
            className: 'dgtable-wrapper',
            tagName: 'div',

            /**
             * @constructs
             * @expose
             * @param {DGTable_InitOptions?} options initialization options
             */
            initialize: function (options) {

                options = options || {};

                if (options.columns !== null && options.columns.length === 0) return null;

                this._onMouseMoveResizeAreaBound = _.bind(this._onMouseMoveResizeArea, this);
                this._onEndDragColumnHeaderBound = _.bind(this._onEndDragColumnHeader, this);

                this.$el.on('dragend', this._onEndDragColumnHeaderBound);

                /**
                 * @private
                 * @field {boolean} _tableSkeletonNeedsRendering */
                this._tableSkeletonNeedsRendering = true;

                /**
                 * @private
                 * @field {boolean} _dataAppended */
                this._dataAppended = false;

                /**
                 * @private
                 * @field {boolean} _virtualTable */
                this._virtualTable = options._virtualTable == undefined ? true : !!options.virtualTable;


                /**
                 * @private
                 * @field {int} _rowsBufferSize */
                this._rowsBufferSize = options.rowsBufferSize || 10;

                /**
                 * @private
                 * @field {int} _minColumnWidth */
                this._minColumnWidth = options.minColumnWidth || 35;

                /**
                 * @private
                 * @field {int} _resizeAreaWidth */
                this._resizeAreaWidth = options.resizeAreaWidth || 8;

                /**
                 * @private
                 * @field {boolean} _resizableColumns */
                this._resizableColumns = options.resizableColumns == undefined ? true : !!options.resizableColumns;

                /**
                 * @private
                 * @field {boolean} _movableColumns */
                this._movableColumns = options.movableColumns == undefined ? true : !!options.movableColumns;

                /**
                 * @private
                 * @field {int} _sortableColumns */
                this._sortableColumns = options.sortableColumns == undefined ? 1 : (parseInt(options.sortableColumns, 10) || 1);

                /**
                 * @private
                 * @field {String} _cellClasses */
                this._cellClasses = options.cellClasses == undefined ? '' : options.cellClasses;

                /**
                 * @private
                 * @field {String} _resizerClassName */
                this._resizerClassName = options.resizerClassName == undefined ? 'dgtable-resize' : options.resizerClassName;

                /**
                 * @private
                 * @field {String} _tableClassName */
                this._tableClassName = options.tableClassName == undefined ? 'dgtable' : options.tableClassName;

                /**
                 * @private
                 * @field {Function(string,boolean)} _comparatorCallback */
                this._comparatorCallback = options.comparatorCallback == undefined ? null : options.comparatorCallback;

                /**
                 * @private
                 * @field {Function} _formatter */
                this._formatter = options.formatter || function (val) {
                    return val;
                };

                // Prepare columns
                var columns = new DGTable.ColumnCollection();
                for (var i = 0, column, columnData, order = 0; i < options.columns.length; i++) {
                    columnData = options.columns[i];
                    column = this._initColumnFromData(columnData);
                    if (columnData.order != undefined) {
                        if (columnData.order > order) order = columnData.order + 1;
                        column.order = columnData.order;
                    } else {
                        column.order = order++;
                    }
                    columns.push(column);
                }
                columns.normalizeOrder();

                this._columns = columns;
                this._visibleColumns = columns.getVisibleColumns();

                if (options.sortColumn == undefined) {
                    options.sortColumn = null;
                } else {
                    if (typeof options.sortColumn == 'string') {
                        if (!this._columns.get(options.sortColumn)) {
                            options.sortColumn = null;
                        } else {
                            options.sortColumn = [{ column: options.sortColumn, descending: false }];
                        }
                    } else if (options.sortColumn instanceof Array) {
                        var cols = [];
                        for (var i = 0, len = options.sortColumn.length, col, column; i < len; i++) {
                            col = options.sortColumn[i];
                            col = col.column != undefined ? col : { column: col, descending: false };
                            column = this._columns.get(col.column);
                            if (column && !_.contains(cols, column.name)) {
                                cols.push(column.name)
                            }
                            if (cols.length == this._sortableColumns || cols.length == this._visibleColumns.length) break;
                        }
                        options.sortColumn = cols;
                    } else if (typeof options.sortColumn == 'object') {
                        if (!this._columns.get(options.sortColumn.column)) {
                            options.sortColumn = null;
                        }
                    } else {
                        options.sortColumn = null;
                    }
                }

                /** @private
                 * @field {DGTable.RowCollection} _rows */
                this._rows = new DGTable.RowCollection({ sortColumn: options.sortColumn, columns: this.columns });
                this.listenTo(this._rows, 'sort', this.render)
                    .listenTo(this._rows, 'requiresComparatorForColumn', _.bind(function(returnVal, column, descending){
                        if (this._comparatorCallback) {
                            returnVal.comparator = this._comparatorCallback(column, descending);
                        }
                    }, this));

                /** @private
                 * @field {DGTable.RowCollection} _filteredRows */
                this._filteredRows = null;

                this._height = options.height;
                this._prevScrollTop = 0;
            },

            /**
             * @private
             * @param {DGTable_ColumnOptions} columnData
             */
            _initColumnFromData: (function () {

                var getTextWidth = function(text) {
                    var table = $('<table><thead><tr><th>' + text + '</th></tr></thead></table>')
                            .css({'position': 'absolute', top: '-9999px', 'visibility': 'hidden'}).addClass(this._tableClassName),
                        th = table.find('>thead>tr>th');
                    th.css({'position': 'absolute', 'float': 'left', 'white-space': 'nowrap', 'visibility': 'hidden'});
                    table.appendTo(document.body);
                    var width = th.width();
                    table.remove();
                    return width;
                };

                /**
                 * @private
                 * @param {DGTable_ColumnOptions} columnData
                 */
                return function(columnData) {
                    return {
                        name: columnData.name,
                        label: columnData.label == undefined ? columnData.name : columnData.label,
                        width: columnData.width == undefined ? _.bind(getTextWidth, this)(columnData.label) + 20 : columnData.width,
                        resizable: columnData.resizable == undefined ? true : columnData.resizable,
                        sortable: columnData.sortable == undefined ? true : columnData.sortable,
                        movable: columnData.movable == undefined ? true : columnData.movable,
                        visible: columnData.visible == undefined ? true : columnData.visible,
                        cellClasses: columnData.cellClasses == undefined ? this._cellClasses : columnData.cellClasses
                    };
                };
            })(),

            /**
             * Destroy, releasing all memory, events and DOM elements
             * @public
             * @expose
             */
            close: function () {
                if (this._$resizer) {
                    this._$resizer.remove();
                    this._$resizer = null;
                }
                this._virtualScrollTopRow = null;
                this._virtualScrollBottomRow = null;
                this._unbindHeaderEvents();
                this._onMouseMoveResizeAreaBound = this._onEndDragColumnHeaderBound = null;
                this._$tbody.off('scroll');
                this.$el.off('dragend');
                this.remove();
                this.unbind();
                if (this.workerListeners) {
                    for (var j = 0, worker; j < this.workerListeners.length; j++) {
                        worker = this.workerListeners[j];
                        worker.worker.removeEventListener('message', worker.listener, false);
                    }
                    this.workerListeners.length = 0;
                }
            },

            /**
             * @public
             * @expose
             * @returns {DGTable} self
             */
            render: function () {
                if (this._tableSkeletonNeedsRendering === true) {
                    this._tableSkeletonNeedsRendering = false;

                    if (this._$tbody) {
                        this._prevScrollTop = this._$tbody[0].scrollTop;
                    }

                    this._clearSortArrows() // We need to do this to return to the specified widths instead. The arrows added to the column widths...
                        ._renderSkeleton();

                    var maxScrollTop = this._$tbody[0].scrollHeight - this._$tbody.height();
                    if (this._prevScrollTop > maxScrollTop) {
                        this._prevScrollTop = maxScrollTop;
                    }

                    this._$tbody[0].scrollTop = this._prevScrollTop;
                    this._$tbody.on('scroll', _.bind(this._onTableScrolled, this));

                    this._onTableScrolled(true);

                    this._updateTableWidth();

                    // Show sort arrows
                    for (var i = 0; i < this._rows.sortColumn.length; i++) {
                        this._showSortArrow(this._rows.sortColumn[i].column, this._rows.sortColumn[i].descending);
                    }

                    this._dataAppended = false;

                    this.trigger('renderSkeleton');
                } else {
                    this._renderRows(this._prevScrollTop, this._$tbody[0].scrollTop);
                }
                this.trigger('render');
                return this;
            },

            /**
             * Add a column to the table
             * @public
             * @expose
             * @param {DGTable_ColumnOptions} columnData column properties
             * @param {String|int} [before=-1] column name or order to be inserted before
             * @returns {DGTable} self
             */
            addColumn: function (columnData, before) {
                if (!columnData || this._columns.get(columnData.name)) return this;

                var beforeColumn = null;
                if (before != undefined) {
                    beforeColumn = this._columns.get(before) || this._columns.getByOrder(before);
                }

                var column = this._initColumnFromData(columnData);
                column.order = beforeColumn ? beforeColumn.order : (this._columns.getMaxOrder() + 1);

                for (var i = this._columns.getMaxOrder(), to = column.order, col; i >= to ; i--) {
                    col = this._columns.getByOrder(i);
                    if (col) col.order++;
                }

                this._columns.push(column);
                this._columns.normalizeOrder();

                this._tableSkeletonNeedsRendering = true;
                this._visibleColumns = this._columns.getVisibleColumns();
                this.render();

                this.trigger('addColumn', column.name);

                return this;
            },

            /**
             * Remove a column from the table
             * @public
             * @expose
             * @param {String} column column name
             * @returns {DGTable} self
             */
            removeColumn: function (column) {
                var colIdx = this._columns.indexOf(column);
                if (colIdx > -1) {
                    this._columns.splice(colIdx, 1);
                    this._columns.normalizeOrder();

                    this._tableSkeletonNeedsRendering = true;
                    this._visibleColumns = this._columns.getVisibleColumns();
                    this.render();

                    this.trigger('removeColumn', column);
                }
                return this;
            },

            /**
             * @public
             * @expose
             * @param {String} column name of the column to filter on
             * @param {String} filter check specified column for existence of this string
             * @param {boolean=false} caseSensitive use caseSensitive filtering
             * @returns {DGTable} self
             */
            filter: function (column, filter, caseSensitive) {
                var col = this._columns.get(column);
                if (col) {
                    var hasFilter = !!this._filteredRows;
                    if (this._filteredRows) {
                        this._filteredRows = null; // Release array memory
                    }
                    this._filteredRows = this._rows.filteredCollection(column, filter, caseSensitive);
                    if (!hasFilter && !this._filteredRows) return this;

                    this._tableSkeletonNeedsRendering = true;
                    this.render();
                    this.trigger("filter", column, filter, caseSensitive);
                }
                return this;
            },

            /**
             * @private
             * @returns {DGTable} self
             */
            _refilter: function() {
                if (this._filteredRows) {
                    this._filteredRows = null; // Release memory
                    this._filteredRows = this._rows.filteredCollection(this._rows.filterColumn, this._rows.filterString, this._rows.filterCaseSensitive);
                }
                return this;
            },

            /**
             * Set a new label to a column
             * @public
             * @expose
             * @param {String} column name of the column
             * @param {String} label new label for the column
             * @returns {DGTable} self
             */
            setColumnLabel: function (column, label) {
                var col = this._columns.get(column);
                if (!col) throw "Invalid column name";
                col.label = label == undefined ? col.name : label;

                if (col.element) {
                    for (var i = 0; i < col.element[0].firstChild.childNodes.length; i++) {
                        var node = col.element[0].firstChild.childNodes[i];
                        if(node.nodeType === 3) {
                            node.textContent = col.label;
                            break;
                        }
                    }
                }

                return this;
            },

            /**
             * Move a column to a new position
             * @public
             * @expose
             * @param {String|int} src name or position of the column to be moved
             * @param {String|int} dest name of the column currently in the desired position, or the position itself
             * @returns {DGTable} self
             */
            moveColumn: function (src, dest) {
                var col, destCol;
                if (typeof src === "string") {
                    col = this._columns.get(src);
                } else if (typeof src === "number") {
                    col = this._visibleColumns[src]
                }
                if (typeof dest === "string") {
                    destCol = this._columns.get(dest);
                } else if (typeof dest === "number") {
                    destCol = this._visibleColumns[dest];
                }

                if (!col) throw "Invalid source column: " + src;
                if (!destCol) throw "Invalid dest column: " + dest;
                if (src === dest) return this;

                var srcOrder = col.order, destOrder = destCol.order; // Keep for the event trigger

                this._tableSkeletonNeedsRendering = true;
                this._visibleColumns = this._columns.moveColumn(col, destCol).getVisibleColumns();
                this.render();

                this.trigger("moveColumn", col.name, srcOrder, destOrder);

                return this;
            },

            /**
             * Set a new width to a column
             * @public
             * @expose
             * @param {String} column name of the column to resize
             * @param {int} width new column width in pixels
             * @returns {DGTable} self
             */
            setColumnWidth: function (column, width) {
                var col = this._columns.get(column);
                if (col) {
                    if (width < this._minColumnWidth) width = this._minColumnWidth;
                    var oldWidth = col.width;
                    col.width = width;
                    this._resizeColumnElements(col.element[0].cellIndex, width);
                    this.trigger("setColumnWidth", col.name, oldWidth, width);
                }
                return this;
            },

            /**
             * Re-sort the table
             * @public
             * @expose
             * @param {String} column name of the column to sort on
             * @param {boolean=} descending sort in descending order
             * @param {boolean=false} add should this sort be on top of the existing sort?
             * @returns {DGTable} self
             */
            sort: function (column, descending, add) {
                var col = this._columns.get(column);
                if (col) {
                    var currentSort = this._rows.sortColumn;

                    if (currentSort.length && currentSort[currentSort.length - 1].column == column) {
                        // Recognize current descending mode, if currently sorting by this column
                        descending = descending == undefined ? !currentSort[currentSort.length - 1].descending : descending;
                    }

                    if (add) { // Add the sort to current sort stack

                        for (var i = 0; i < currentSort.length; i++) {
                            if (currentSort[i].column == col.name) {
                                if (i < currentSort.length - 1) {
                                    currentSort.length = 0;
                                } else {
                                    currentSort.splice(currentSort.length - 1, 1);
                                }
                                break;
                            }
                        }
                        if ((this._sortableColumns > 0 /* allow manual sort when disabled */ && currentSort.length >= this._sortableColumns) || currentSort.length >= this._visibleColumns.length) {
                            currentSort.length = 0;
                        }

                    } else { // Sort only by this column
                        currentSort.length = 0;
                    }

                    // Default to ascending
                    descending = descending == undefined ? false : descending;

                    // Set the required column in the front of the stack
                    currentSort.push({ column: col.name, descending: !!descending });

                    this._rows.sortColumn = currentSort;

                    this._clearSortArrows();
                    for (var i = 0; i < currentSort.length; i++) {
                        this._showSortArrow(currentSort[i].column, currentSort[i].descending);
                    }

                    this._rows.sort(!!this._filteredRows);
                    this._refilter();
                    if (this._filteredRows) {
                        this.render();
                    }

                    // Build output for event, with option names that will survive compilers
                    var sorts = [];
                    for (var i = 0; i < currentSort.length; i++) {
                        sorts.push({ 'column': currentSort[i].column, 'descending': currentSort[i].descending });
                    }
                    this.trigger("sort", sorts);
                }
                return this;
            },

            /**
             * Show a column which is currently invisible
             * @public
             * @expose
             * @param {String} column unique column name
             * @returns {DGTable} self
             */
            showColumn: function (column) {
                var col = this._columns.get(column);
                if (col) {
                    if (col.visible) return this;
                    col.visible = true;
                    this._tableSkeletonNeedsRendering = true;
                    this._visibleColumns = this._columns.getVisibleColumns();
                    this.render();
                    this.trigger("showColumn", column);
                }
                return this;
            },

            /**
             * Hide a column which is currently visible
             * @public
             * @expose
             * @param {String} column column name
             * @returns {DGTable} self
             */
            hideColumn: function (column) {
                var col = this._columns.get(column);
                if (col) {
                    if (!col.visible) return this;
                    col.visible = false;
                    this._tableSkeletonNeedsRendering = true;
                    this._visibleColumns = this._columns.getVisibleColumns();
                    this.render();
                    this.trigger("hideColumn", column);
                }
                return this;
            },

            /**
             * @public
             * @expose
             * @param {int} minColumnWidth minimum column width
             * @returns {DGTable} self
             */
            setMinColumnWidth: function (minColumnWidth) {
                this._minColumnWidth = minColumnWidth;
                return this;
            },

            /**
             * @public
             * @expose
             * @returns {int} minimum column width
             */
            getMinColumnWidth: function () {
                return this._minColumnWidth;
            },

            /**
             * @public
             * @expose
             * @param {int} sortableColumns how many sortable columns to allow?
             * @returns {DGTable} self
             */
            setSortableColumns: function (sortableColumns) {
                if (this._sortableColumns != sortableColumns) {
                    this._sortableColumns = sortableColumns;
                    if (this._$table) {
                        var th = this._$table.find('thead>tr>th');
                        for (var i = 0; i < th.length; i++) {
                            $(th[0])[(this._sortableColumns > 0 && this._visibleColumns[i].sortable) ? 'addClass' : 'removeClass']('sortable');
                        }
                    }
                }
                return this;
            },

            /**
             * @public
             * @expose
             * @returns {int} how many sortable columns to allow?
             */
            getSortableColumns: function () {
                return this._sortableColumns;
            },

            /**
             * @public
             * @expose
             * @param {boolean} movableColumns are the columns movable?
             * @returns {DGTable} self
             */
            setMovableColumns: function (movableColumns) {
                movableColumns = !!movableColumns;
                if (this._movableColumns != movableColumns) {
                    this._movableColumns = movableColumns;
                }
                return this;
            },

            /**
             * @public
             * @expose
             * @returns {boolean} are the columns movable?
             */
            getMovableColumns: function () {
                return this._movableColumns;
            },

            /**
             * @public
             * @expose
             * @param {boolean} resizableColumns are the columns resizable?
             * @returns {DGTable} self
             */
            setResizableColumns: function (resizableColumns) {
                resizableColumns = !!resizableColumns;
                if (this._resizableColumns != resizableColumns) {
                    this._resizableColumns = resizableColumns;
                }
                return this;
            },

            /**
             * @public
             * @expose
             * @returns {boolean} are the columns resizable?
             */
            getResizableColumns: function () {
                return this._resizableColumns;
            },

            /**
             * @public
             * @expose
             * @param {Function(string,boolean)} comparatorCallback a callback function that returns the comparator for a specific column
             * @returns {DGTable} self
             */
            setComparatorCallback: function (comparatorCallback) {
                if (this._comparatorCallback != comparatorCallback) {
                    this._comparatorCallback = comparatorCallback;
                }
                return this;
            },

            /**
             * @public
             * @expose
             * @returns {Function(string,boolean)} a callback function that returns the comparator for a specific column
             */
            getComparatorCallback: function () {
                return this._comparatorCallback;
            },

            /**
             * Add rows to the table
             * @public
             * @expose
             * @param {Object[]} data array of rows to add to the table
             * @returns {DGTable} self
             */
            addRows: function (data) {
                this.scrollTop = this.$el.find(".table").scrollTop();
                var oldRowCount = this._rows.length;
                this._dataAppended = true;
                this._rows.add(data);
                this._refilter();
                if (oldRowCount == 0 && (this._filteredRows || this._rows).length) {
                    this._tableSkeletonNeedsRendering = true;
                }
                this.render().trigger('addRows', data.length, false);
                return this;
            },

            /**
             * Replace the whole dataset
             * @public
             * @expose
             * @param {Object[]} data array of rows to add to the table
             * @returns {DGTable} self
             */
            setRows: function (data) {
                this.scrollTop = this.$el.find(".table").scrollTop();
                this._rows.reset(data);
                this._refilter();
                this._tableSkeletonNeedsRendering = true;
                this.render().trigger('addRows', data.length, true);
                return this;
            },

            /**
             * Creates a URL representing the data in the specified element.
             * This uses the Blob or BlobBuilder of the modern browsers.
             * The url can be used for a Web Worker.
             * @public
             * @expose
             * @param {string} id Id of the element containing your data
             * @returns {string?} the url, or null if not supported
             */
            getUrlForElementContent: function (id) {
                var blob;
                var el = document.getElementById(id);
                if (!el) return null;
                var data = el.textContent;
                if (typeof Blob === "function") {
                    blob = new Blob([data]);
                } else {
                    var BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
                    if (!BlobBuilder) return null;
                    var builder = new BlobBuilder();
                    builder.append(data);
                    blob = builder.getBlob();
                }
                return (window.URL || window.webkitURL).createObjectURL(blob);
            },

            /**
             * @public
             * @expose
             * @returns {boolean} A value indicating whether Web Workers are supported
             */
            isWorkerSupported: function() {
                return window['Worker'] instanceof Function;
            },

            /**
             * Creates a Web Worker for updating the table.
             * @public
             * @expose
             * @param {string} url Url to the script for the Web Worker
             * @returns {Worker?} the Web Worker, or null if not supported
             * @param {boolean=true} start if true, starts the Worker immediately
             */
            createWebWorker: function (url, start) {
                if (!this.isWorkerSupported()) return null;
                var self = this;
                var worker = new Worker(url);
                var listener = function (evt) {
                    self.addRows(evt.data.rows, evt.data.append);
                };
                worker.addEventListener('message', listener, false);
                if (!this.workerListeners) this.workerListeners = [];
                this.workerListeners.push({worker: worker, listener: listener});
                if (start || start == undefined) {
                    worker.postMessage(null);
                }
                return worker;
            },

            /**
             * Unbinds a Web Worker from the table, stopping updates.
             * @public
             * @expose
             * @param {Worker} worker the Web Worker
             * @returns {DGTable} self
             */
            unbindWebWorker: function (worker) {
                if (this.workerListeners) {
                    for (var j = 0; j < this.workerListeners.length; j++) {
                        if (this.workerListeners[j].worker == worker) {
                            worker.removeEventListener('message', this.workerListeners[j].listener, false);
                            this.workerListeners.splice(j, 1);
                            j--;
                        }
                    }
                }
                return this;
            },

            /**
             * @param {boolean?} forceUpdate
             */
            _onTableScrolled: function (forceUpdate) {
                if (forceUpdate || this._prevScrollTop !== this._$tbody[0].scrollTop) {
                    var firstVisibleRow = parseInt(this._$tbody[0].scrollTop / this._virtualRowHeight, 10);
                    var firstRenderedRow = firstVisibleRow - this._rowsBufferSize;
                    if (firstRenderedRow < 0) firstRenderedRow = 0;
                    this._virtualRowRange.prevFirst = this._virtualRowRange.first;
                    this._virtualRowRange.prevLast = this._virtualRowRange.last;
                    this._virtualRowRange.first = firstRenderedRow;
                    this._virtualRowRange.last = firstVisibleRow + this._virtualVisibleRows + this._rowsBufferSize;
                    var rows = this._filteredRows || this._rows;
                    if (this._virtualRowRange.last > rows.length) {
                        this._virtualRowRange.last = rows.length;
                        this._virtualRowRange.first = Math.max(0, this._virtualRowRange.last - this._virtualVisibleRows - this._rowsBufferSize);
                    }
                    this._renderRows(this._prevScrollTop, this._$tbody[0].scrollTop);
                }
            },

            /**previousElementSibling
             * Reverse-calculate the column to resize from mouse position
             * @private
             * @param {jQuery.Event} e jQuery mouse event
             * @returns {String} name of the column which the mouse is over, or null if the mouse is not in resize position
             */
            _getResizeColumn: function (e) {

                var rtl = this._$table.css('direction') == 'rtl';

                var $th = $(this._ieBugDragStart || e.target).closest("th"), th = $th[0];

                var previousElementSibling = $th[0].previousSibling;
                while (previousElementSibling && previousElementSibling.nodeType == Element.TEXT_NODE) {
                    previousElementSibling = previousElementSibling.previousSibling;
                }

                var firstCol = !previousElementSibling;

                var mouseX = (e.originalEvent.pageX || e.originalEvent.clientX) - $th.offset().left;

                if (rtl) {
                    if (!firstCol && $th.outerWidth() - mouseX <= this._resizeAreaWidth / 2) {
                        return previousElementSibling.columnName;
                    } else if (mouseX <= this._resizeAreaWidth / 2) {
                        return th.columnName;
                    }
                } else {
                    if (!firstCol && mouseX <= this._resizeAreaWidth / 2) {
                        return previousElementSibling.columnName;
                    } else if ($th.outerWidth() - mouseX <= this._resizeAreaWidth / 2) {
                        return th.columnName;
                    }
                }

                return null;
            },

            /**
             * @param {jQuery.Event} e event
             */
            _onMouseMoveColumnHeader: function (e) {
                if (!this._resizableColumns) return;

                var rtl = this._$table.css('direction') == 'rtl';

                var col = this._getResizeColumn(e);
                var th = $(e.target).closest("th")[0];
                if (!col || !this._columns.get(col).resizable) {
                    th.style.cursor = '';
                } else {
                    th.style.cursor = 'e-resize';
                }
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onMouseLeaveColumnHeader: function (e) {
                var th = $(e.target).closest("th")[0];
                th.style.cursor = '';
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onClickColumnHeader: function (e) {
                if (!this._getResizeColumn(e)) {
                    var th = $(e.target).closest("th")[0];
                    if (this._sortableColumns) {
                        var column = this._columns.get(th.columnName);
                        if (column && column.sortable) {
                            this.sort(th.columnName, undefined, true);
                        }
                    }
                }
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onStartDragColumnHeader: function (e) {
                var col = this._getResizeColumn(e);
                if (col) {
                    var column = this._columns.get(col);
                    if (!this._resizableColumns || !column || !column.resizable) {
                        e.preventDefault();
                        return false;
                    }

                    var rtl = this._$table.css('direction') == 'rtl';

                    if (this._$resizer) $(this._$resizer).remove();
                    this._$resizer = $('<div></div>')
                        .addClass(this._resizerClassName)
                        .css({
                            'position': 'absolute',
                            'display': 'block',
                            'z-index': -1,
                            'visibility': 'hidden',
                            'width': '2px',
                            'background': '#000',
                            'opacity': 0.7
                        })
                        .appendTo(this.$el);

                    var selectedTh = column.element,
                        commonAncestor = this._$resizer.parent();

                    var posCol = selectedTh.offset(), posRelative = commonAncestor.offset();
                    if (ieVersion == 8) {
                        posCol = selectedTh.offset(); // IE8 bug, first time it receives zeros...
                    }
                    posRelative.left += parseFloat(commonAncestor.css('border-left-width')) || 0;
                    posRelative.top += parseFloat(commonAncestor.css('border-top-width')) || 0;
                    posCol.left -= posRelative.left;
                    posCol.top -= posRelative.top;
                    posCol.top -= parseFloat(selectedTh.css('border-top-width')) || 0;
                    var resizerWidth = this._$resizer.outerWidth()
                    if (rtl) {
                        posCol.left -= Math.ceil((parseFloat(selectedTh.css('border-left-width')) || 0) / 2);
                        posCol.left -= Math.ceil(resizerWidth / 2);
                    } else {
                        posCol.left += selectedTh.outerWidth();
                        posCol.left += Math.ceil((parseFloat(selectedTh.css('border-right-width')) || 0) / 2);
                        posCol.left -= Math.ceil(resizerWidth / 2);
                    }
                    var height = this._$table.height() - (this._$table.offset().top - selectedTh.offset().top);

                    this._$resizer
                        .css({
                            'z-index': '10',
                            'visibility': 'visible',
                            'left': posCol.left,
                            'top': posCol.top,
                            'height': height
                        })
                        [0].columnName = selectedTh[0].columnName;
                    try { this._$resizer[0].style.zIndex = ''; } catch (e) { }

                    $(document).on('mousemove', this._onMouseMoveResizeAreaBound);
                    $(document).on('mouseup', this._onEndDragColumnHeaderBound);

                    e.preventDefault();

                } else if (this._movableColumns) {

                    var th = $(this._ieBugDragStart || e.target).closest('th');
                    var column = this._columns.get(th[0].columnName);
                    if (column && column.movable) {
                        th[0].style.opacity = 0.35;
                        this._dragId = Math.random() * 0x9999999; // Recognize this ID on drop
                        e.originalEvent.dataTransfer.setData("text", JSON.stringify({dragId: this._dragId, column: column.name}));
                    } else {
                        e.preventDefault();
                    }

                } else {

                    e.preventDefault();

                }
            },

            /**
             * @private
             * @param {MouseEvent} e event
             */
            _onMouseMoveResizeArea: function (e) {
                var column = this._columns.get(this._$resizer[0].columnName);
                var rtl = this._$table.css('direction') == 'rtl';

                var selectedTh = column.element,
                    commonAncestor = this._$resizer.parent();
                var posCol = selectedTh.offset(), posRelative = commonAncestor.offset();
                posRelative.left += parseFloat(commonAncestor.css('border-left-width')) || 0;
                posCol.left -= posRelative.left;
                var resizerWidth = this._$resizer.outerWidth()

                var actualX = e.pageX - posRelative.left;
                var minX = posCol.left;
                if (rtl) {
                    minX += selectedTh.outerWidth();
                    minX -= Math.ceil((parseFloat(selectedTh.css('border-right-width')) || 0) / 2);
                    minX -= Math.ceil(resizerWidth / 2);
                    minX -= this._minColumnWidth;
                    minX -= (parseFloat(selectedTh.css('padding-left')) || 0) + (parseFloat(selectedTh.css('padding-right')) || 0);
                    if (actualX > minX) actualX = minX;
                } else {
                    minX += Math.ceil((parseFloat(selectedTh.css('border-right-width')) || 0) / 2);
                    minX -= Math.ceil(resizerWidth / 2);
                    minX += this._minColumnWidth;
                    minX += (parseFloat(selectedTh.css('padding-left')) || 0) + (parseFloat(selectedTh.css('padding-right')) || 0);
                    if (actualX < minX) actualX = minX;
                }

                this._$resizer.css('left', actualX + "px")
            },

            /**
             * @private
             * @param {Event} e event
             */
            _onEndDragColumnHeader: function (e) {
                if (!this._$resizer) {
                    e.target.style.opacity = null;
                } else {
                    $(document).off('mousemove', this._onMouseMoveResizeAreaBound);
                    $(document).off('mouseup', this._onEndDragColumnHeaderBound);

                    var column = this._columns.get(this._$resizer[0].columnName);
                    var rtl = this._$table.css('direction') == 'rtl';

                    var selectedTh = column.element,
                        commonAncestor = this._$resizer.parent();
                    var posCol = selectedTh.offset(), posRelative = commonAncestor.offset();
                    posRelative.left += parseFloat(commonAncestor.css('border-left-width')) || 0;
                    posCol.left -= posRelative.left;
                    var resizerWidth = this._$resizer.outerWidth()

                    var actualX = e.pageX - posRelative.left;
                    var baseX = posCol.left, minX = posCol.left;
                    var width = 0;
                    if (rtl) {
                        actualX += (parseFloat(selectedTh.css('padding-left')) || 0) + (parseFloat(selectedTh.css('padding-right')) || 0);
                        baseX += selectedTh.outerWidth();
                        baseX -= Math.ceil((parseFloat(selectedTh.css('border-right-width')) || 0) / 2);
                        baseX -= Math.ceil(resizerWidth / 2);
                        minX = baseX;
                        minX -= this._minColumnWidth;
                        if (actualX > minX) actualX = minX;
                        width = baseX - actualX;
                    } else {
                        actualX -= (parseFloat(selectedTh.css('padding-left')) || 0) + (parseFloat(selectedTh.css('padding-right')) || 0);
                        baseX += Math.ceil((parseFloat(selectedTh.css('border-right-width')) || 0) / 2);
                        baseX -= Math.ceil(resizerWidth / 2);
                        minX = baseX;
                        minX += this._minColumnWidth;
                        if (actualX < minX) actualX = minX;
                        width = actualX - baseX;
                    }

                    this._$resizer.remove();
                    this._$resizer = null;
                    this.setColumnWidth(column.name, width);
                }
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onDragEnterColumnHeader: function (e) {
                if (!this._movableColumns) return;

                var dataTransferred = e.originalEvent.dataTransfer.getData('text');
                if (dataTransferred) dataTransferred = JSON.parse(dataTransferred);
                else dataTransferred = null; // WebKit does not provide the dataTransfer on dragenter?..

                var th = $(e.target).closest('th');
                if (!dataTransferred ||
                    (this._dragId == dataTransferred.dragId && th.columnName !== dataTransferred.column)) {

                    var column = this._columns.get(th[0].columnName);
                    if (column && (column.movable || column != this._visibleColumns[0])) {
                        $(th).addClass('drag-over');
                    }
                }
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onDragOverColumnHeader: function (e) {
                e.preventDefault();
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onDragLeaveColumnHeader: function (e) {
                var th = $(e.target).closest('th');
                if ($(th[0].firstChild).has(e.originalEvent.relatedTarget).length) return;
                th.removeClass('drag-over');
            },

            /**
             * @private
             * @param {jQuery.Event} e event
             */
            _onDropColumnHeader: function (e) {
                e.preventDefault();
                var dataTransferred = JSON.parse(e.originalEvent.dataTransfer.getData("text"));
                var th = $(e.target).closest('th');
                if (this._movableColumns && dataTransferred.dragId == this._dragId) {
                    var srcColName = dataTransferred.column,
                        destColName = th[0].columnName,
                        srcCol = this._columns.get(srcColName),
                        destCol = this._columns.get(destColName);
                    if (srcCol && destCol && srcCol.movable && (destCol.movable || destCol != this._visibleColumns[0])) {
                        this.moveColumn(srcColName, destColName);
                    }
                }
                $(th).removeClass('drag-over');
            },

            /**
             * @private
             * @returns {DGTable} self
             */
            _clearSortArrows: function () {
                if (!this._$table) return this;
                var sortedColumns = this._$table.find('>thead>tr>th.sorted');
                var arrows = sortedColumns.find('>div>.sort-arrow');
                _.forEach(arrows, _.bind(function(arrow){
                    var divWidth = arrow.parentNode.scrollWidth;
                    var arrowProposedWidth = arrow.scrollWidth + (parseFloat($(arrow).css('margin-right')) || 0) + (parseFloat($(arrow).css('margin-left')) || 0);
                    this._resizeColumnElements(arrow.parentNode.parentNode.cellIndex, divWidth - arrowProposedWidth);
                    arrow.parentNode.removeChild(arrow);
                }, this));
                sortedColumns.removeClass('sorted').removeClass('desc');
                return this;
            },

            /**
             * @private
             * @param {String} column the name of the sort column
             * @param {boolean} descending table is sorted descending
             * @returns {DGTable} self
             */
            _showSortArrow: function (column, descending) {

                var arrow = document.createElement("span");
                arrow.className = "sort-arrow";

                var col = this._columns.get(column).element;
                col.addClass('sorted');
                if (descending) col.addClass('desc');
                col[0].firstChild.insertBefore(arrow, col[0].firstChild.firstChild);
                var arrowProposedWidth = arrow.scrollWidth + (parseFloat($(arrow).css('margin-right')) || 0) + (parseFloat($(arrow).css('margin-left')) || 0);
                this._resizeColumnElements(col[0].cellIndex, col[0].firstChild.scrollWidth + arrowProposedWidth);

                return this;
            },

            /**
             * @private
             * @param {int} cellIndex index of the column in the DOM
             * @param {int} width width in pixels
             * @returns {DGTable} self
             */
            _resizeColumnElements: function (cellIndex, width) {
                var headers = this._$table.find(">thead>tr>th");
                headers[cellIndex].firstChild.style.width = width + "px";
                var col = this._columns.get(headers[cellIndex].columnName);
                col.width = width;
                if (cellIndex === headers.length - 1) {
                    width -= this.scrollbarWidth;
                }
                this._$tbody.find('td:nth-child(' + (cellIndex + 1) + ')>div').each(function () {
                    this.style.width = width + "px";
                });
                this._updateTableWidth();
                return this;
            },

            /**
             * @returns {DGTable} self
             * */
            _unbindHeaderEvents: function() {
                if (this._$table) {
                    this._$table.find('>thead>tr>th')
                        .off('mousemove')
                        .off('mouseleave')
                        .off('dragstart')
                        .off('selectstart')
                        .off('click')
                        .find('>div')
                        .off('dragenter')
                        .off('dragover')
                        .off('dragleave')
                        .off('drop');
                }
                return this;
            },

            /**
             * @private
             * @returns {DGTable} self
             */
            _renderSkeleton: function () {
                var self = this;
                var topRowHeight = 0;
                var lastCol;

                if (this._virtualScrollTopRow) {
                    topRowHeight = parseFloat(this._virtualScrollTopRow.style.height);
                }

                this._unbindHeaderEvents();

                var headerRow = document.createElement('tr');
                for (var i = 0, column, th, div; i < this._visibleColumns.length; i++) {
                    column = this._visibleColumns[i];
                    if (column.visible) {
                        lastCol = column;
                        div = document.createElement('div');
                        div.style.width = column.width + 'px';
                        div.innerHTML = column.label;
                        th = document.createElement('th');
                        th.draggable = true;
                        if (this._sortableColumns && column.sortable) th.className = 'sortable';
                        th.columnName = column.name;
                        th.appendChild(div);
                        headerRow.appendChild(th);

                        this._visibleColumns[i].element = $(th);

                        $(th).on('mousemove', _.bind(this._onMouseMoveColumnHeader, this))
                            .on('mouseleave', _.bind(this._onMouseLeaveColumnHeader, this))
                            .on('dragstart', _.bind(this._onStartDragColumnHeader, this))
                            .on('click', _.bind(this._onClickColumnHeader, this));
                        $(div).on('dragenter', _.bind(this._onDragEnterColumnHeader, this))
                            .on('dragover', _.bind(this._onDragOverColumnHeader, this))
                            .on('dragleave', _.bind(this._onDragLeaveColumnHeader, this))
                            .on('drop', _.bind(this._onDropColumnHeader, this));

                        if (hasIeDragAndDropBug) {
                            $(th).on('selectstart', _.bind(function(evt) {
                                evt.preventDefault();
                                self._ieBugDragStart = this.firstChild;
                                th.dragDrop();
                                self._ieBugDragStart = null;
                                return false;
                            }, th));
                        }
                    }
                }

                if (this._$table) {
                    this._$tbody.off('scroll');
                    this._$table.remove();
                }

                if (this.$el.css('position') == 'static') {
                    this.$el.css('position', 'relative');
                }

                var fragment = document.createDocumentFragment();

                var table = document.createElement("table");
                table.className = this._tableClassName;
                fragment.appendChild(table);

                var thead = document.createElement("thead");
                thead.style.display = 'block';
                if (hasIeTableDisplayBlockBug) {
                    $(thead).css({
                        'float': this.$el.css('direction') == 'rtl' ? 'right' : 'left',
                        'clear': 'both'
                    });
                }
                table.appendChild(thead);

                var tbody = document.createElement("tbody");
                tbody.style.maxHeight = this._height + "px";
                tbody.style.display = 'block';
                tbody.style.overflowY = 'auto';
                tbody.style.overflowX = 'hidden';
                if (hasIeTableDisplayBlockBug) {
                    $(tbody).css({
                        'float': this.$el.css('direction') == 'rtl' ? 'right' : 'left',
                        'clear': 'both'
                    });
                }
                table.appendChild(tbody);

                this.el.appendChild(fragment);

                this._$table = $(table);
                this._$tbody = $(tbody);

                if (!this._virtualRowHeight) {
                    var tr = document.createElement("tr"),
                        td = document.createElement("td");
                    td.innerHTML = '0';
                    tr.appendChild(td);
                    tr.style.visibility = "hidden";
                    tr.style.position = "absolute";
                    tbody.appendChild(tr);
                    this._virtualRowHeight = $(tr).outerHeight();
                    tbody.removeChild(tr);
                    this._virtualVisibleRows = parseInt(this._height / this._virtualRowHeight, 10);
                }

                var rows = this._filteredRows || this._rows;

                var last = this._virtualVisibleRows + this._rowsBufferSize;
                if (last > rows.length) {
                    last = rows.length;
                }
                this._virtualRowRange = {
                    first: 0,
                    last: last,
                    prevFirst: 0,
                    prevLast: last
                };

                var bodyFragment = document.createDocumentFragment(),
                    tr, td, div;

                // Build first row (for virtual table top scroll offset)
                tr = this._virtualScrollTopRow = document.createElement('tr')
                tr.style.height = topRowHeight + 'px';
                bodyFragment.appendChild(tr);

                // Build visible rows
                var displayCount = 0;
                for (var j = this._virtualRowRange.first, row, colIndex, column, colCount = this._visibleColumns.length;
                     j < rows.length && displayCount < this._virtualRowRange.last;
                     j++) {
                    row = rows[j];
                    tr = document.createElement('tr');
                    tr.setAttribute('data-row', j);
                    for (colIndex = 0; colIndex < colCount; colIndex++) {
                        column = this._visibleColumns[colIndex];
                        div = document.createElement('div');
                        div.style.width = column.width + 'px';
                        div.innerHTML = this._formatter(row[column.name], column.name);
                        td = document.createElement('td');
                        if (column.cellClasses) td.className = column.cellClasses;
                        td.appendChild(div);
                        tr.appendChild(td);
                    }
                    bodyFragment.appendChild(tr);
                    displayCount++;
                }

                // Build last row (for virtual table bottom scroll offset)
                tr = this._virtualScrollBottomRow = document.createElement('tr');
                tr.style.height = (this._virtualRowHeight * Math.max(0, rows.length - this._virtualVisibleRows - this._rowsBufferSize) - topRowHeight) + 'px';
                bodyFragment.appendChild(tr);

                // Populate THEAD
                try { thead.innerHTML = ''; } catch (e) { /* IE8 */ thead.textContent = ''; }
                thead.appendChild(headerRow);

                // Populate TBODY
                try { tbody.innerHTML = ''; } catch (e) { /* IE8 */ tbody.textContent = ''; }
                tbody.appendChild(bodyFragment);

                // Calculate scrollbar's width and reduce from lat column's width
                this.scrollbarWidth = tbody.offsetWidth - tbody.clientWidth;
                if (this.scrollbarWidth > 0) {
                    var lastColWidth = lastCol.width;
                    $(tbody).find('td:last-child>div').width(lastColWidth - this.scrollbarWidth);
                }

                this._adjustVirtualTableScrollHeight();

                return this;
            },

            /**
             * Add/remove rows from the DOM, or replace data in the current rows
             * @private
             * @param {int} prevScrollTop previous scrollTop value in pixels
             * @param {int} scrollTop current scrollTop value in pixels
             */
            _renderRows: function (prevScrollTop, scrollTop) {
                var first, last;
                var addedRows = (this._virtualRowRange.last - this._virtualRowRange.first) - (this._virtualRowRange.prevLast - this._virtualRowRange.prevFirst);
                var max = this._virtualVisibleRows + this._rowsBufferSize;
                if (scrollTop < prevScrollTop) {
                    first = this._virtualRowRange.first;
                    last = this._virtualRowRange.prevFirst;
                    if (this._virtualRowRange.last <= this._virtualRowRange.prevFirst) {
                        first = this._virtualRowRange.first;
                        last = this._virtualRowRange.last;
                    }
                    this._removeRows(last - first - addedRows, false);
                    this._addRows(first, last, true);
                    this._adjustVirtualTableScrollHeight();
                } else if (scrollTop > prevScrollTop) {
                    first = this._virtualRowRange.prevLast;
                    last = this._virtualRowRange.last;

                    if (this._virtualRowRange.first >= this._virtualRowRange.prevLast) {
                        first = this._virtualRowRange.first;
                        last = this._virtualRowRange.last;
                    }
                    this._removeRows(last - first - addedRows, true);
                    this._addRows(first, last, false);
                    this._adjustVirtualTableScrollHeight();
                } else if (this._dataAppended) {
                    this._dataAppended = false;
                    var rows = this._filteredRows || this._rows;
                    if (this._virtualRowRange.last < rows.length && this._virtualRowRange.last < max) {
                        first = this._virtualRowRange.last;
                        last = rows.length;
                        if (last > max) last = max;
                        this._addRows(first, last, false);
                        this._virtualRowRange.last = last;
                    }
                    this._adjustVirtualTableScrollHeight();
                } else {
                    this._adjustVirtualTableScrollHeight();
                    this._refreshRows(this._virtualRowRange.first);
                    return;
                }
                this.scrollbarWidth = this._$tbody[0].offsetWidth - this._$tbody[0].clientWidth;
                if (this.scrollbarWidth > 0) {
                    var cols = this._$table.find('>thead>tr>th');
                    var lastColWidth = this._columns.get(cols[cols.length - 1].columnName).width;
                    this._resizeColumnElements(cols.length - 1, lastColWidth);
                }
                this._prevScrollTop = this._$tbody[0].scrollTop;
            },

            /**
             * Adjusts the virtual table's scroll height
             * @private
             */
            _adjustVirtualTableScrollHeight: function () {
                var domRowCount = this._$tbody[0].childNodes.length - 2;
                var rows = this._filteredRows || this._rows;
                var bufferHeight = (rows.length - domRowCount) * this._virtualRowHeight;
                if (bufferHeight < 0) {
                    this._virtualScrollTopRow.style.height = 0;
                    this._virtualScrollBottomRow.style.height = 0;
                } else {
                    var topHeight = this._virtualRowRange.first * this._virtualRowHeight;
                    var bottomHeight = bufferHeight - topHeight;
                    this._virtualScrollTopRow.style.height = topHeight + "px";
                    this._virtualScrollBottomRow.style.height = bottomHeight + "px";
                }
            },

            /**
             * Append or prepend table rows to the DOM
             * @private
             * @param {int} start index in the row data collection of the first row to add
             * @param {int} end index in the row data collection of the last row to add
             * @param {boolean} prepend add rows to the beginning of the table
             */
            _addRows: function (start, end, prepend) {
                var rowToInsertBefore;
                if (prepend) {
                    var nextElementSibling = this._virtualScrollTopRow.nextSibling;
                    while (nextElementSibling && nextElementSibling.nodeType == Element.TEXT_NODE) {
                        nextElementSibling = nextElementSibling.nextSibling;
                    }
                    rowToInsertBefore = nextElementSibling;
                } else {
                    rowToInsertBefore = this._virtualScrollBottomRow;
                }
                for (var i = start; i < end; i++) {
                    this._addRow(i, rowToInsertBefore);
                }
            },

            /**
             * Add a new row to the DOM
             * @private
             * @param {int} index which row in the RowCollection to add to the DOM
             * @param {HTMLRowElement} rowToInsertBefore DOM row that the new row will precede
             */
            _addRow: function (index, rowToInsertBefore) {
                var tr = document.createElement("tr");
                tr.setAttribute("data-row", index);
                var rows = this._filteredRows || this._rows;
                for (var i = 0, col, div, td; i < this._visibleColumns.length; i++) {
                    col = this._visibleColumns[i];
                    div = document.createElement("div");
                    div.style.width = col.width + "px";
                    div.innerHTML = this._formatter(rows[index][col.name], col.name);
                    td = document.createElement("td");
                    if (col.cellClasses) td.className = col.cellClasses;
                    td.appendChild(div);
                    tr.appendChild(td);
                }
                this._$tbody[0].insertBefore(tr, rowToInsertBefore);
            },

            /**
             * Remove table rows from the DOM
             * @private
             * @param {int} numRows number of rows to remove
             * @param {boolean} removeFromBeginning remove rows from the beginning of the table
             */
            _removeRows: function (numRows, removeFromBeginning) {
                var start, end;
                if (numRows > this._virtualVisibleRows + this._rowsBufferSize * 2) {
                    numRows = this._virtualVisibleRows + this._rowsBufferSize * 2;
                }

                var tbody = this._$tbody[0],
                    trs = tbody.childNodes,
                    count = this._$tbody[0].childNodes.length - 2;

                if (removeFromBeginning) {
                    start = 1;
                    end = Math.min(numRows + 1, count + 1);
                } else {
                    start = count + 1 - numRows;
                    end = count + 1;
                }
                for (var i = start; i < end; end--) {
                    tbody.removeChild(trs[start]);
                }
            },

            /**
             * Refresh the data in the rendered table rows with what is currently in the row data collection
             * @private
             * @param {int} firstRow index of the first row rendered
             */
            _refreshRows: function (firstRow) {
                var trs = this._$tbody[0].getElementsByTagName("tr");
                var rows = this._filteredRows || this._rows;
                for (var i = 1, tr, tdList, j, div, col, colName; i < trs.length - 1; i++) {
                    tr = trs[i];
                    tr.setAttribute("data-row", firstRow + i - 1);
                    tdList = $("td>div", tr);
                    for (j = 0; j < tdList.length; j++) {
                        div = tdList[j];
                        col = this._visibleColumns[j];
                        colName = col.name;
                        div.innerHTML = this._formatter(rows[firstRow + i - 1][colName], colName);
                    }
                }
            },

            /**
             * Explicitly set the width of the table based on the sum of the column widths
             * @private
             */
            _updateTableWidth: function () {
                var cols = this._$table.find(">thead>tr>th");
                var newWidth = 0;
                for (var i = 0; i < cols.length; i++) {
                    newWidth += $(cols[i])[0].offsetWidth;
                }
                this._$table.width(newWidth);
                this.$el.width(newWidth);
            }

        }
    );

    /**
     * @typedef
     * @param {String} column
     * @param {boolean=false} descending
     * */
    var DGTable_ColumnSortOptions = {
        /** @expose */ column: null,
        /** @expose */ descending: null
    };

    /**
     * @typedef
     * @param {String} name
     * @param {String=name} label
     * @param {int} width
     * @param {boolean=true} resizable
     * @param {boolean=true} sortable
     * @param {boolean=true} visible
     * @param {String} cellClasses
     * */
    var DGTable_ColumnOptions = {
        /** @expose */ name: null,
        /** @expose */ label: null,
        /** @expose */ width: null,
        /** @expose */ resizable: null,
        /** @expose */ sortable: null,
        /** @expose */ visible: null,
        /** @expose */ cellClasses: null
    };

    /**
     * @typedef
     * @param {DGTable.ColumnOptions[]} columns
     * @param {int} height
     * @param {boolean=true} virtualTable
     * @param {boolean=true} resizableColumns
     * @param {boolean=true} movableColumns
     * @param {int=1} sortableColumns
     * @param {String} cellClasses
     * @param {String|String[]|DGTable_ColumnSortOptions|DGTable_ColumnSortOptions[]} sortColumn
     * @param {Function?} formatter
     * @param {int=10} rowsBufferSize
     * @param {int=35} minColumnWidth
     * @param {int=8} resizeAreaWidth
     * @param {Function(string}boolean)} comparatorCallback
     * @param {String?} resizerClassName
     * @param {String?} tableClassName
     * @param {String?} className
     * @param {String?} tagName
     * */
    var DGTable_InitOptions = {
        /** @expose */ columns: null,
        /** @expose */ height: null,
        /** @expose */ virtualTable: null,
        /** @expose */ resizableColumns: null,
        /** @expose */ movableColumns: null,
        /** @expose */ sortableColumns: null,
        /** @expose */ cellClasses: null,
        /** @expose */ sortColumn: null,
        /** @expose */ rowsBufferSize: null,
        /** @expose */ minColumnWidth: null,
        /** @expose */ resizeAreaWidth: null,
        /** @expose */ comparatorCallback: null,
        /** @expose */ resizerClassName: null,
        /** @expose */ tableClassName: null,
        /** @expose */ className: null,
        /** @expose */ tagName: null
    };

    /** @expose */ window.DGTable = DGTable;

})();