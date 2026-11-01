// KROKİ YÖNETİMİ (Views/Admin/FloorPlanManagement.cshtml)
// Alan alan (Salon, Bahçe...) kroki çizimi: mimari öğeler (FloorPlanElements) ve masalar (AppTables).
// Çizim floor-plan-view.js ile yapılır; burada seçme, sürükleme, boyutlandırma ve kaydetme eklenir.
// Her değişiklik bırakıldığı anda taslak olarak kaydedilir (FloorPlanController.SaveElement / SaveTable).
// Kasada kullanılması için alan "Yayınla" ile yayınlanmalıdır (PublishSection); yayından sonraki
// değişiklikler tekrar yayınlanana kadar kasaya yansımaz.

var GRID = 10;
var plan = null;
var currentSection = null;
var selected = null;      // { kind: "element" | "table", id }
var view = null;          // FloorPlan.render dönüşü
var pendingSaves = 0;

$(document).ready(function () {
    renderPalette();
    loadPlan();

    $("#btnAddSection").on("click", addSection);
    $(document).on("click", "#sectionTabs .nav-link", function () {
        selectSection($(this).data("section"));
    });
    $(document).on("click", ".palette-item", function () {
        addElement($(this).data("type"));
    });
    $(document).on("keydown", onKeyDown);
});

// ---------- Veri ----------

function loadPlan(keepSection) {
    $.get("/FloorPlan/GetFloorPlan", function (res) {
        if (!res || !res.success) {
            Swal.fire("Hata", (res && res.message) || "Kroki yüklenemedi.", "error");
            return;
        }
        plan = res.data;
        var sections = FloorPlan.sections(plan);
        if (!sections.length) sections = ["Salon"];
        plan.sections = sections;
        plan.info = {};
        (plan.sectionInfo || []).forEach(function (i) { plan.info[i.section.toLowerCase()] = i; });
        currentSection = keepSection && sections.indexOf(keepSection) !== -1 ? keepSection : (currentSection || sections[0]);
        if (sections.indexOf(currentSection) === -1) currentSection = sections[0];
        renderTabs();
        draw();
    });
}

function findItem(kind, id) {
    var list = kind === "table" ? plan.tables : plan.elements;
    return list.find(function (x) { return (kind === "table" ? x.tableId : x.id) === id; });
}

function setSaving(delta) {
    pendingSaves += delta;
    var $s = $("#saveStatus");
    if (pendingSaves > 0) {
        $s.removeClass("is-error").addClass("is-saving").html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Kaydediliyor…');
    } else if (!$s.hasClass("is-error")) {
        $s.removeClass("is-saving").html('<i class="fa-solid fa-circle-check me-1"></i>Taslak kaydedildi');
    }
}

function saveItem(kind, item) {
    setSaving(1);
    var request = kind === "table"
        ? $.post("/FloorPlan/SaveTable", {
            tableId: item.tableId, section: item.section, shape: item.shape,
            posX: item.posX, posY: item.posY, width: item.width, height: item.height
        })
        : $.post("/FloorPlan/SaveElement", {
            id: item.id || "", section: item.section, elementType: item.type, label: item.label || "",
            posX: item.posX, posY: item.posY, width: item.width, height: item.height, rotation: item.rotation || 0
        });

    return request
        .done(function (res) {
            if (res && res.success) {
                if (kind === "element" && res.id) item.id = res.id;
                markChanged(item.section);
            } else {
                showSaveError((res && res.message) || "Kaydedilemedi.");
            }
        })
        .fail(function () { showSaveError("Sunucuya ulaşılamadı."); })
        .always(function () { setSaving(-1); });
}

function showSaveError(message) {
    $("#saveStatus").removeClass("is-saving").addClass("is-error").html('<i class="fa-solid fa-triangle-exclamation me-1"></i>' + FloorPlan.escapeHtml(message));
    setTimeout(function () { $("#saveStatus").removeClass("is-error"); setSaving(0); }, 4000);
}

// ---------- Çizim ----------

function renderPalette() {
    var html = Object.keys(FloorPlan.TYPES).map(function (key) {
        var t = FloorPlan.TYPES[key];
        return `<button type="button" class="palette-item" data-type="${key}">
                    <span class="swatch fp-el-${key}">${t.icon ? `<i class="fa-solid ${t.icon}"></i>` : ""}</span>${t.label}
                </button>`;
    }).join("");
    $("#palette").html(html);
}

function renderTabs() {
    var html = plan.sections.map(function (s) {
        var count = plan.tables.filter(function (t) { return t.section.toLowerCase() === s.toLowerCase(); }).length;
        var state = sectionState(s);
        return `<li class="nav-item"><button type="button" class="nav-link ${s === currentSection ? "active" : ""}" data-section="${FloorPlan.escapeHtml(s)}" title="${state.text}">
                    <span class="state-dot ${state.cls}"></span>${FloorPlan.escapeHtml(s)} <span class="tab-count">${count}</span></button></li>`;
    }).join("");
    $("#sectionTabs").html(html);
}

// ---------- Taslak / yayın ----------

function sectionInfo(section) {
    var key = (section || "").toLowerCase();
    if (!plan.info[key]) plan.info[key] = { section: section, isPublished: false, publishedDate: null, hasChanges: false };
    return plan.info[key];
}

function sectionState(section) {
    var info = sectionInfo(section);
    if (!info.isPublished) return { cls: "is-draft", text: "Taslak: kasada kullanılmıyor" };
    if (info.hasChanges) return { cls: "is-changed", text: "Yayında, yayınlanmamış değişiklikler var" };
    return { cls: "is-live", text: "Yayında" };
}

function markChanged(section) {
    var info = sectionInfo(section);
    if (info.isPublished && !info.hasChanges) {
        info.hasChanges = true;
        renderTabs();
        renderPublishBar();
    }
}

function renderPublishBar() {
    var info = sectionInfo(currentSection);
    var name = FloorPlan.escapeHtml(currentSection);
    var html;

    if (!info.isPublished) {
        html = `<div class="pb-text"><span class="state-dot is-draft"></span><b>${name}</b> taslak — kasada henüz kullanılmıyor.
                    <span class="text-muted">Binanın şeklini (zemin), masaları ve diğer öğeleri yerleştirip yayınlayın.</span></div>
                <button type="button" class="btn btn-purple btn-sm" id="btnPublish"><i class="fa-solid fa-cloud-arrow-up me-1"></i>Krokiyi Yayınla</button>`;
    } else if (info.hasChanges) {
        html = `<div class="pb-text"><span class="state-dot is-changed"></span><b>${name}</b> yayında (${info.publishedDate}).
                    <span class="text-muted">Yaptığınız değişiklikler yayınlanana kadar kasada görünmez.</span></div>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-light btn-sm" id="btnUnpublish">Yayından Kaldır</button>
                    <button type="button" class="btn btn-purple btn-sm" id="btnPublish"><i class="fa-solid fa-cloud-arrow-up me-1"></i>Değişiklikleri Yayınla</button>
                </div>`;
    } else {
        html = `<div class="pb-text"><span class="state-dot is-live"></span><b>${name}</b> yayında (${info.publishedDate}) — kasada krokiden masa seçilebilir.</div>
                <button type="button" class="btn btn-light btn-sm" id="btnUnpublish">Yayından Kaldır</button>`;
    }

    $("#publishBar").html(html);
    $("#btnPublish").on("click", publishSection);
    $("#btnUnpublish").on("click", unpublishSection);
}

function publishSection() {
    if (pendingSaves > 0) {
        setTimeout(publishSection, 300);   // bekleyen kayıtlar bitsin, yayına en son hâli girsin
        return;
    }
    var $btn = $("#btnPublish").prop("disabled", true);
    $.post("/FloorPlan/PublishSection", { section: currentSection }, function (res) {
        if (res && res.success) {
            var info = sectionInfo(currentSection);
            info.isPublished = true;
            info.hasChanges = false;
            info.publishedDate = res.publishedDate;
            renderTabs();
            renderPublishBar();
            Swal.fire({ icon: "success", title: "Yayınlandı", text: res.message, timer: 2600, showConfirmButton: false });
        } else {
            var errors = (res && res.errors) || [];
            Swal.fire({
                icon: "warning",
                title: "Kroki yayınlanamadı",
                html: `<p class="mb-2">${FloorPlan.escapeHtml((res && res.message) || "Bir hata oluştu.")}</p>` +
                    (errors.length ? `<ul class="text-start small mb-0">${errors.map(function (e) { return "<li>" + FloorPlan.escapeHtml(e) + "</li>"; }).join("")}</ul>` : ""),
                confirmButtonText: "Tamam"
            });
        }
    }).fail(function () {
        Swal.fire("Hata", "Sunucuya ulaşılamadı.", "error");
    }).always(function () { $btn.prop("disabled", false); });
}

function unpublishSection() {
    Swal.fire({
        title: "Yayından kaldırılsın mı?",
        text: "“" + currentSection + "” krokisi kasada kullanılamayacak; çizim taslak olarak kalır.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yayından Kaldır",
        cancelButtonText: "Vazgeç"
    }).then(function (r) {
        if (!r.isConfirmed) return;
        $.post("/FloorPlan/UnpublishSection", { section: currentSection }, function (res) {
            if (res && res.success) {
                var info = sectionInfo(currentSection);
                info.isPublished = false;
                info.hasChanges = false;
                info.publishedDate = null;
                renderTabs();
                renderPublishBar();
            } else {
                Swal.fire("Hata", (res && res.message) || "Yayından kaldırılamadı.", "error");
            }
        });
    });
}

function selectSection(section) {
    currentSection = section;
    selected = null;
    renderTabs();
    draw();
}

function draw() {
    renderPublishBar();
    view = FloorPlan.render("#floorCanvas", plan, currentSection, { editable: true, showStatus: false, selected: selected });
    if (selected) {
        var $sel = $(view.stage).find(`[data-kind="${selected.kind}"][data-id="${selected.id}"]`);
        if ($sel.length) $sel.append('<span class="fp-handle"></span>');
        else selected = null;
    }
    bindPointer();
    renderInspector();
}

// ---------- Seçme, sürükleme, boyutlandırma ----------

function bindPointer() {
    var stage = view.stage;

    $(stage).on("pointerdown", function (ev) {
        var $target = $(ev.target);
        var $item = $target.closest(".fp-item");

        if (!$item.length) {
            if (selected) setSelection(null);
            return;
        }

        var kind = $item.data("kind");
        var id = Number($item.data("id"));
        var item = findItem(kind, id);
        if (!item) return;

        // Seçim krokiyi yeniden çizmeden değişir; böylece ilk tıklamayla sürükleme başlayabilir
        if (!selected || selected.kind !== kind || selected.id !== id) {
            setSelection({ kind: kind, id: id });
        }

        var resizing = $target.hasClass("fp-handle");
        var start = { x: ev.clientX, y: ev.clientY, posX: item.posX, posY: item.posY, width: item.width, height: item.height };
        var moved = false;
        var el = $item[0];
        try { el.setPointerCapture(ev.pointerId); } catch (err) { /* eski tarayıcı: yakalama olmadan da çalışır */ }
        ev.preventDefault();

        function onMove(e) {
            var dx = (e.clientX - start.x) / view.scale;
            var dy = (e.clientY - start.y) / view.scale;
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && !moved) return;
            moved = true;

            if (resizing) {
                item.width = clamp(snap(start.width + dx), 20, view.canvas.width - item.posX);
                item.height = clamp(snap(start.height + dy), 10, view.canvas.height - item.posY);
                el.style.width = item.width + "px";
                el.style.height = item.height + "px";
            } else {
                item.posX = clamp(snap(start.posX + dx), 0, view.canvas.width - item.width);
                item.posY = clamp(snap(start.posY + dy), 0, view.canvas.height - item.height);
                el.style.left = item.posX + "px";
                el.style.top = item.posY + "px";
            }
            updateInspectorGeometry(item);
        }

        function onUp() {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.removeEventListener("pointercancel", onUp);
            if (moved) saveItem(kind, item);
        }

        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
    });
}

function setSelection(next) {
    selected = next;
    var $stage = $(view.stage);
    $stage.find(".is-selected").removeClass("is-selected");
    $stage.find(".fp-handle").remove();
    if (selected) {
        $stage.find(`[data-kind="${selected.kind}"][data-id="${selected.id}"]`)
            .addClass("is-selected")
            .append('<span class="fp-handle"></span>');
    }
    renderInspector();
}

function onKeyDown(e) {
    if (!selected || $(e.target).is("input, select, textarea")) return;
    var item = findItem(selected.kind, selected.id);
    if (!item) return;

    var step = e.shiftKey ? 1 : GRID;
    var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };

    if (moves[e.key]) {
        e.preventDefault();
        item.posX = clamp(item.posX + moves[e.key][0], 0, view.canvas.width - item.width);
        item.posY = clamp(item.posY + moves[e.key][1], 0, view.canvas.height - item.height);
        draw();
        debounceSave(selected.kind, item);
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected.kind === "element") {
        e.preventDefault();
        deleteSelectedElement();
    } else if (e.key === "Escape") {
        setSelection(null);
    }
}

var saveTimer = null;
function debounceSave(kind, item) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveItem(kind, item); }, 400);
}

function snap(v) { return Math.round(v / GRID) * GRID; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ---------- Ekleme / silme ----------

function addElement(type) {
    var def = FloorPlan.TYPES[type];
    var item = {
        id: 0, section: currentSection, type: type, label: "",
        width: def.w, height: def.h, rotation: 0,
        posX: snap((plan.canvas.width - def.w) / 2), posY: snap((plan.canvas.height - def.h) / 2)
    };
    plan.elements.push(item);
    saveItem("element", item).done(function (res) {
        if (res && res.success) {
            selected = { kind: "element", id: item.id };
            draw();
        } else {
            plan.elements.splice(plan.elements.indexOf(item), 1);
            draw();
        }
    });
}

function deleteSelectedElement() {
    var item = findItem("element", selected.id);
    if (!item) return;
    var name = item.label || FloorPlan.TYPES[item.type].label;

    Swal.fire({
        title: "Öğe silinsin mi?",
        text: "“" + name + "” krokiden kaldırılacak.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Sil",
        cancelButtonText: "Vazgeç"
    }).then(function (r) {
        if (!r.isConfirmed) return;
        setSaving(1);
        $.post("/FloorPlan/DeleteElement", { id: item.id }, function (res) {
            if (res && res.success) {
                plan.elements.splice(plan.elements.indexOf(item), 1);
                markChanged(item.section);
                selected = null;
                draw();
            } else {
                showSaveError((res && res.message) || "Silinemedi.");
            }
        }).always(function () { setSaving(-1); });
    });
}

function addSection() {
    Swal.fire({
        title: "Yeni Alan",
        input: "text",
        inputLabel: "Alan / kat adı (ör. Alt Kat, 1. Kat, Balkon)",
        inputAttributes: { maxlength: 50 },
        showCancelButton: true,
        confirmButtonText: "Ekle",
        cancelButtonText: "Vazgeç",
        inputValidator: function (v) {
            v = (v || "").trim();
            if (!v) return "Alan adı yazın.";
            if (plan.sections.some(function (s) { return s.toLowerCase() === v.toLowerCase(); })) return "Bu alan zaten var.";
        }
    }).then(function (r) {
        if (!r.isConfirmed) return;
        var name = r.value.trim();
        $.post("/FloorPlan/AddSection", { section: name }, function (res) {
            if (res && res.success) {
                plan.sections.push(name);
                selectSection(name);
                Swal.fire({ toast: true, position: "top-end", timer: 3500, showConfirmButton: false, icon: "success",
                    title: "“" + name + "” eklendi. Önce “Zemin / Oda” ile şeklini çizin." });
            } else {
                Swal.fire("Hata", (res && res.message) || "Alan eklenemedi.", "error");
            }
        });
    });
}

// Alandaki masaları satır satır, aralarında boşluk bırakarak dizer
function autoArrangeTables() {
    var tables = plan.tables.filter(function (t) { return t.section.toLowerCase() === currentSection.toLowerCase(); });
    if (!tables.length) return;

    var x = 40, y = 40, rowHeight = 0, gap = 50;
    tables.forEach(function (t) {
        if (x + t.width > plan.canvas.width - 40) { x = 40; y += rowHeight + gap; rowHeight = 0; }
        t.posX = x;
        t.posY = Math.min(y, plan.canvas.height - t.height);
        x += t.width + gap;
        rowHeight = Math.max(rowHeight, t.height);
        saveItem("table", t);
    });
    draw();
}

// ---------- Özellikler paneli ----------

function renderInspector() {
    var $p = $("#inspector");
    var sectionOptions = function (current) {
        return plan.sections.map(function (s) {
            return `<option value="${FloorPlan.escapeHtml(s)}" ${s === current ? "selected" : ""}>${FloorPlan.escapeHtml(s)}</option>`;
        }).join("");
    };

    if (!selected) {
        var tables = plan.tables.filter(function (t) { return t.section.toLowerCase() === currentSection.toLowerCase(); });
        $p.html(`
            <div class="panel-title"><i class="fa-solid fa-sliders me-2"></i>${FloorPlan.escapeHtml(currentSection)}</div>
            <p class="text-muted small">Düzenlemek için krokiden bir masa ya da öğe seçin.</p>
            <div class="stat-row"><span>Masa</span><b>${tables.length}</b></div>
            <div class="stat-row"><span>Öğe</span><b>${plan.elements.filter(function (e) { return e.section.toLowerCase() === currentSection.toLowerCase(); }).length}</b></div>
            ${stackedWarning()}
            ${tables.length ? `<button type="button" class="btn btn-outline-brand btn-sm w-100 mt-3" id="btnAutoArrange"><i class="fa-solid fa-table-cells me-1"></i>Masaları otomatik diz</button>` : ""}
            <div class="tip mt-3"><i class="fa-solid fa-lightbulb me-1"></i>Yeni masa eklemek ve masa adlarını değiştirmek için <a href="/Admin/TableManagement">Masa Yönetimi</a>'ni kullanın; masalar burada otomatik görünür.</div>`);
        $("#btnAutoArrange").on("click", autoArrangeTables);
        return;
    }

    var item = findItem(selected.kind, selected.id);

    if (selected.kind === "table") {
        $p.html(`
            <div class="panel-title"><i class="fa-solid fa-chair me-2"></i>Masa · ${FloorPlan.escapeHtml(item.tableNumber)}</div>
            <div class="mb-2"><span class="badge ${item.isOccupied ? "bg-danger" : "bg-success"}">${item.isOccupied ? "Dolu" : "Boş"}</span></div>
            <label class="form-label">Şekil</label>
            <div class="btn-group w-100 mb-3" role="group">
                <button type="button" class="btn btn-sm ${item.shape !== "Circle" ? "btn-purple" : "btn-light"}" data-shape="Square"><i class="fa-regular fa-square me-1"></i>Köşeli</button>
                <button type="button" class="btn btn-sm ${item.shape === "Circle" ? "btn-purple" : "btn-light"}" data-shape="Circle"><i class="fa-regular fa-circle me-1"></i>Yuvarlak</button>
            </div>
            ${geometryInputs(item)}
            <label class="form-label mt-3">Alan</label>
            <select class="form-select form-select-sm" id="inpSection">${sectionOptions(item.section)}</select>
            <p class="text-muted small mt-2 mb-0">Masa başka alana taşınınca o alanın krokisinde görünür.</p>`);

        $p.find("[data-shape]").on("click", function () {
            item.shape = $(this).data("shape");
            if (item.shape === "Circle") item.height = item.width;   // yuvarlak masa daire olur
            draw();
            saveItem("table", item);
        });
    } else {
        var def = FloorPlan.TYPES[item.type];
        $p.html(`
            <div class="panel-title"><i class="fa-solid ${def.icon || "fa-shapes"} me-2"></i>${def.label}</div>
            <label class="form-label">Görünen ad</label>
            <input type="text" class="form-control form-control-sm mb-3" id="inpLabel" maxlength="60" placeholder="${def.label}" value="${FloorPlan.escapeHtml(item.label || "")}">
            ${geometryInputs(item)}
            <label class="form-label mt-3">Döndür</label>
            <div class="d-flex gap-2 mb-3">
                <button type="button" class="btn btn-light btn-sm flex-fill" data-rotate="-90"><i class="fa-solid fa-rotate-left me-1"></i>90°</button>
                <button type="button" class="btn btn-light btn-sm flex-fill" data-rotate="90"><i class="fa-solid fa-rotate-right me-1"></i>90°</button>
                <span class="rotation-value">${item.rotation || 0}°</span>
            </div>
            <label class="form-label">Alan</label>
            <select class="form-select form-select-sm mb-3" id="inpSection">${sectionOptions(item.section)}</select>
            <button type="button" class="btn btn-outline-danger btn-sm w-100" id="btnDeleteElement"><i class="fa-solid fa-trash me-1"></i>Öğeyi sil</button>`);

        $("#inpLabel").on("input", function () {
            item.label = $(this).val();
            var $span = $(view.stage).find(`[data-kind="element"][data-id="${item.id}"] span`);
            $span.text(item.label || def.label);
            debounceSave("element", item);
        });
        $p.find("[data-rotate]").on("click", function () {
            item.rotation = (((item.rotation || 0) + Number($(this).data("rotate"))) % 360 + 360) % 360;
            draw();
            saveItem("element", item);
        });
        $("#btnDeleteElement").on("click", deleteSelectedElement);
    }

    $("#inpWidth, #inpHeight").on("change", function () {
        item.width = clamp(snap(Number($("#inpWidth").val()) || item.width), 20, view.canvas.width - item.posX);
        item.height = clamp(snap(Number($("#inpHeight").val()) || item.height), 10, view.canvas.height - item.posY);
        draw();
        saveItem(selected.kind, item);
    });

    $("#inpSection").on("change", function () {
        markChanged(item.section);   // eski alandan da bir şey çıktı
        item.section = $(this).val();
        var kind = selected.kind;
        selected = null;
        saveItem(kind, item);
        renderTabs();
        draw();
    });
}

function stackedWarning() {
    var stacked = FloorPlan.stackedTableCount(plan, currentSection);
    return stacked
        ? `<div class="overlap-warning mt-3"><i class="fa-solid fa-triangle-exclamation me-1"></i><b>${stacked} masa üst üste duruyor.</b> Yeni eklenen masalar aynı noktada başlar; “Masaları otomatik diz” ile ayırıp sonra sürükleyerek yerleştirin.</div>`
        : "";
}

function geometryInputs(item) {
    return `<div class="row g-2">
                <div class="col-6"><label class="form-label">Genişlik</label><input type="number" class="form-control form-control-sm" id="inpWidth" step="10" min="20" value="${item.width}"></div>
                <div class="col-6"><label class="form-label">Yükseklik</label><input type="number" class="form-control form-control-sm" id="inpHeight" step="10" min="10" value="${item.height}"></div>
            </div>`;
}

function updateInspectorGeometry(item) {
    $("#inpWidth").val(item.width);
    $("#inpHeight").val(item.height);
}
