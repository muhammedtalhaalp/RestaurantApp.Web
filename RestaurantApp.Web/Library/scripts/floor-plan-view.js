// ORTAK KROKİ ÇİZİCİ
// Kroki Yönetimi (düzenleme) ve masa seçim ekranları (POS) aynı çiziciyi kullanır.
// Veri: /FloorPlan/GetFloorPlan → { canvas, sections, tables, elements }.
// Koordinatlar mantıksal tuvaldedir (canvas.width x canvas.height); tuval bulunduğu kutunun genişliğine ölçeklenir.

var FloorPlan = (function () {
    // Sunucudaki FloorPlanController.ElementTypes ile aynı tutulmalı
    var TYPES = {
        zemin: { label: "Zemin / Oda", icon: "fa-vector-square", w: 600, h: 400 },
        mutfak: { label: "Mutfak", icon: "fa-fire-burner", w: 240, h: 150 },
        kasa: { label: "Kasa", icon: "fa-cash-register", w: 130, h: 70 },
        firin: { label: "Fırın", icon: "fa-fire", w: 110, h: 80 },
        bar: { label: "Bar", icon: "fa-martini-glass-citrus", w: 220, h: 70 },
        wc: { label: "Tuvalet", icon: "fa-restroom", w: 120, h: 100 },
        depo: { label: "Depo", icon: "fa-boxes-stacked", w: 150, h: 110 },
        merdiven: { label: "Merdiven", icon: "fa-stairs", w: 90, h: 130 },
        kapi: { label: "Kapı", icon: "fa-door-open", w: 100, h: 24 },
        pencere: { label: "Pencere", icon: "", w: 160, h: 14 },
        duvar: { label: "Duvar", icon: "", w: 240, h: 12 },
        kolon: { label: "Kolon", icon: "", w: 30, h: 30 },
        bitki: { label: "Bitki", icon: "fa-seedling", w: 50, h: 50 },
        yazi: { label: "Yazı", icon: "", w: 180, h: 40 }
    };

    // İnce öğelerde (kapı, pencere, duvar) yazı gösterilmez
    var NO_TEXT = { pencere: true, duvar: true, kolon: true };

    function escapeHtml(text) {
        return $("<div>").text(text == null ? "" : String(text)).html();
    }

    function money(value) {
        return Number(value || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
    }

    function elementHtml(e) {
        var type = TYPES[e.type] || { label: e.type, icon: "" };
        var text = e.label || type.label;
        var inner = NO_TEXT[e.type] ? "" :
            (type.icon ? `<i class="fa-solid ${type.icon}"></i>` : "") + `<span>${escapeHtml(text)}</span>`;
        // Zemin büyük bir alandır: adı yalnızca köşede küçük yazılır, ortası boş kalır
        if (e.type === "zemin") inner = e.label ? `<span class="fp-floor-label">${escapeHtml(e.label)}</span>` : "";
        return `<div class="fp-item fp-el fp-el-${e.type}" data-kind="element" data-id="${e.id}"
                     style="left:${e.posX}px;top:${e.posY}px;width:${e.width}px;height:${e.height}px;transform:rotate(${e.rotation || 0}deg)"
                     title="${escapeHtml(text)}">${inner}</div>`;
    }

    // Masa doluluk kamerası (TableCameraController). cameraStatus yoksa kamera yok ya da kapalıdır.
    var CAMERA = {
        Bos: { label: "Boş", icon: "fa-chair" },
        Dolu: { label: "Dolu", icon: "fa-user-group" },
        Toplanacak: { label: "Toplanacak", icon: "fa-utensils" }
    };

    // Kameranın gördüğü ile sistemdeki durum çelişiyorsa (ya da masa toplanacaksa) kasiyere uyarı metni
    function cameraAlert(t) {
        if (!t.cameraStatus) return null;
        if (t.cameraStatus === "Dolu" && !t.isOccupied) return "Müşteri oturdu, sipariş açılmadı";
        if (t.cameraStatus !== "Dolu" && t.isOccupied) return "Masa boş görünüyor, hesap hâlâ açık";
        if (t.cameraStatus === "Toplanacak") return "Masa toplanacak";
        return null;
    }

    function cameraBadge(t) {
        var cam = CAMERA[t.cameraStatus];
        if (!cam) return "";
        return `<span class="fp-t-cam cam-${t.cameraStatus}" title="Kamera: ${cam.label}"><i class="fa-solid fa-video"></i>${cam.label}</span>`;
    }

    function tableHtml(t, opts) {
        var occupied = t.isOccupied;
        var classes = ["fp-item", "fp-table", t.shape === "Circle" ? "is-circle" : "is-square", occupied ? "is-occupied" : "is-empty"];
        if (t.isPriority) classes.push("is-priority");
        var alert = opts.showStatus ? cameraAlert(t) : null;
        if (alert) classes.push("has-camera-alert");
        var amount = occupied && t.remainingAmount > 0 ? `<span class="fp-t-amount">${money(t.remainingAmount)}</span>` : "";
        var status = opts.showStatus ? `<span class="fp-t-status">${occupied ? "Dolu" : "Boş"}</span>` : "";
        return `<div class="${classes.join(" ")}" data-kind="table" data-id="${t.tableId}"
                     style="left:${t.posX}px;top:${t.posY}px;width:${t.width}px;height:${t.height}px"
                     title="${escapeHtml(t.tableNumber + (alert ? " — " + alert : ""))}">
                    ${t.isPriority ? '<i class="fa-solid fa-fire fp-t-fire"></i>' : ""}${opts.showStatus ? cameraBadge(t) : ""}
                    <span class="fp-t-name">${escapeHtml(t.tableNumber)}</span>${amount}${status}
                </div>`;
    }

    // host içine verilen alanın krokisini çizer. opts: { editable, showStatus, onTableClick(table), selected: {kind, id} }
    function render(host, plan, section, opts) {
        opts = opts || {};
        var $host = $(host);
        var canvas = plan.canvas || { width: 1200, height: 700 };
        var tables = plan.tables.filter(function (t) { return t.section.toLowerCase() === (section || "").toLowerCase(); });
        // Zemin her zaman en altta çizilir; üstüne odalar, masalar gelir
        var elements = plan.elements
            .filter(function (e) { return e.section.toLowerCase() === (section || "").toLowerCase(); })
            .sort(function (a, b) { return (a.type === "zemin" ? 0 : 1) - (b.type === "zemin" ? 0 : 1); });
        var hasFloor = elements.some(function (e) { return e.type === "zemin"; });

        var items = elements.map(elementHtml).join("") + tables.map(function (t) { return tableHtml(t, opts); }).join("");
        var empty = !tables.length && !elements.length
            ? `<div class="fp-empty"><i class="fa-solid fa-map-location-dot"></i><span>${opts.editable ? "Bu alan boş. Önce “Zemin / Oda” ile binanın şeklini çizin, sonra masaları ve diğer öğeleri yerleştirin." : "Bu alanın krokisi henüz çizilmedi."}</span></div>`
            : "";

        $host.html(`
            <div class="fp-viewport ${opts.editable ? "is-editable" : ""} ${hasFloor ? "has-floor" : ""}" style="padding-top:${(canvas.height / canvas.width * 100).toFixed(3)}%">
                <div class="fp-stage" style="width:${canvas.width}px;height:${canvas.height}px">${items}${empty}</div>
            </div>`);

        var viewport = $host.find(".fp-viewport")[0];
        var stage = $host.find(".fp-stage")[0];
        var api = {
            stage: stage,
            scale: 1,
            canvas: canvas,
            tables: tables,
            elements: elements
        };

        function fit() {
            api.scale = viewport.clientWidth / canvas.width;
            stage.style.transform = "scale(" + api.scale + ")";
        }
        fit();
        if (window.ResizeObserver) {
            new ResizeObserver(fit).observe(viewport);
        } else {
            $(window).on("resize", fit);
        }

        if (opts.onTableClick && !opts.editable) {
            $(stage).on("click", ".fp-table", function () {
                var id = Number($(this).data("id"));
                var table = tables.find(function (t) { return t.tableId === id; });
                if (table) opts.onTableClick(table);
            });
        }

        if (opts.selected) {
            $(stage).find(`[data-kind="${opts.selected.kind}"][data-id="${opts.selected.id}"]`).addClass("is-selected");
        }

        return api;
    }

    // Alanların sırası: masası olan alanlar önce (sunucunun sırası), sonra yalnızca öğe içerenler
    function sections(plan) {
        return plan.sections.slice();
    }

    // Alanda başka bir masayla tamamen aynı yerde duran masa sayısı (yeni eklenen masalar
    // varsayılan konumda üst üste başlar; kroki düzenlenmeden bunlar seçilemez)
    function stackedTableCount(plan, section) {
        var seen = {}, stacked = 0;
        plan.tables.forEach(function (t) {
            if (t.section.toLowerCase() !== (section || "").toLowerCase()) return;
            var key = t.posX + ":" + t.posY;
            if (seen[key]) stacked += seen[key] === 1 ? 2 : 1;
            seen[key] = (seen[key] || 0) + 1;
        });
        return stacked;
    }

    return { TYPES: TYPES, render: render, sections: sections, stackedTableCount: stackedTableCount, cameraAlert: cameraAlert, escapeHtml: escapeHtml };
})();
