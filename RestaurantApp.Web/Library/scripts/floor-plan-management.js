$(document).ready(function () {
    loadFloorPlan();

    // Mimari Elemanları Sürükleme
    $(".architect-element").draggable({
        containment: "#floorPlanCanvas",
        grid: [10, 10],
        stop: function (event, ui) {
            var elemId = $(this).text().trim();
            localStorage.setItem("pos_elem_" + elemId, JSON.stringify({
                left: ui.position.left,
                top: ui.position.top
            }));
        }
    });

    // Kaydedilmiş Konumları Yükleme
    $(".architect-element").each(function () {
        var elemId = $(this).text().trim();
        var savedPos = localStorage.getItem("pos_elem_" + elemId);
        if (savedPos) {
            var pos = JSON.parse(savedPos);
            $(this).css({ left: pos.left + "px", top: pos.top + "px" });
        }
    });

    function loadFloorPlan() {
        $.get("/Admin/GetTables", function (res) {
            if (res.success) {
                $(".draggable-table").remove();

                $.each(res.data, function (i, t) {
                    var shapeClass = t.shape === "Circle" ? "circle" : "square";
                    var statusClass = t.status === "Bos" ? "bos" : "dolu";
                    var w = t.width || 75;
                    var h = t.height || 75;

                    var $table = $(`
                        <div class="draggable-table ${shapeClass}" id="table-${t.tableId}" data-id="${t.tableId}" data-number="${t.tableNumber}" data-section="${t.section}" data-shape="${t.shape}" style="left: ${t.posX}px; top: ${t.posY}px; width: ${w}px; height: ${h}px;">
                            <span class="status-dot ${statusClass}"></span>
                            <i class="fa-solid fa-chair table-icon"></i>
                            <span class="table-name">${t.tableNumber}</span>
                        </div>
                    `);

                    $("#floorPlanCanvas").append($table);
                });

                initDraggableAndResizable();
            }
        });
    }

    function initDraggableAndResizable() {
        $(".draggable-table")
            .draggable({
                containment: "#floorPlanCanvas",
                grid: [10, 10],
                stop: function (event, ui) {
                    saveTableLayoutData($(this), ui.position.left, ui.position.top, $(this).width(), $(this).height());
                }
            })
            .resizable({
                containment: "#floorPlanCanvas",
                minWidth: 50,
                minHeight: 50,
                handles: "n, e, s, w, ne, se, sw, nw",
                stop: function (event, ui) {
                    saveTableLayoutData($(this), ui.position.left, ui.position.top, ui.size.width, ui.size.height);
                }
            });
    }

    function saveTableLayoutData($elem, posX, posY, w, h) {
        var tableId = $elem.data("id");
        var tableNumber = $elem.data("number");
        var section = posY > 270 ? "Dışarı" : "İçeri";
        var shape = $elem.data("shape") || "Square";

        $.post("/Admin/SaveTableLayout", {
            tableId: tableId,
            tableNumber: tableNumber,
            section: section,
            shape: shape,
            posX: Math.round(posX),
            posY: Math.round(posY),
            width: Math.round(w),
            height: Math.round(h)
        }, function (res) {
            if (!res.success) {
                Swal.fire("Hata", res.message, "error");
            }
        });
    }
});