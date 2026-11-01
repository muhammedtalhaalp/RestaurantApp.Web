// QR MENÜ (Views/Admin/QrMenu.cshtml): restoranın genel menü QR'ı ve her masanın QR'ı.
// Veri: /Admin/GetQrCodes. Müşteri tarafı sayfa: Views/Menu/Index.cshtml (qr-menu.js).

var qrData = null;
var qrSection = "Hepsi";

$(document).ready(function () {
    loadQrCodes();

    $(document).on("click", "#qrSectionTabs .nav-link", function () {
        qrSection = $(this).data("section");
        renderTables();
    });

    $("#btnCopyGeneral").on("click", function () { copyText(qrData.general.menuUrl); });
    $("#btnDownloadGeneral").on("click", function () {
        downloadQr(qrData.general.qrImageUrl, safeFileName(qrData.companyName) + "-menu-qr.png");
    });
    $("#btnPrintGeneral").on("click", function () {
        printLabels([{ title: "Menü", subtitle: qrData.companyName, qr: qrData.general.qrImageUrl }]);
    });
    $("#btnPrintAll").on("click", function () {
        if (!qrData || !qrData.tables.length) {
            Swal.fire("Masa yok", "Yazdırılacak masa bulunmuyor. Önce Masa Yönetimi'nden masa ekleyin.", "info");
            return;
        }
        printLabels(visibleTables().map(tableLabel));
    });

    $(document).on("click", "[data-action]", function () {
        var table = qrData.tables.find(function (t) { return t.tableId === Number($(this).closest("[data-table-id]").data("table-id")); }, this);
        if (!table) return;
        var action = $(this).data("action");
        if (action === "download") downloadQr(table.qrImageUrl, safeFileName(table.tableNumber) + "-qr.png");
        if (action === "print") printLabels([tableLabel(table)]);
        if (action === "copy") copyText(table.menuUrl);
    });
});

function loadQrCodes() {
    $.get("/Admin/GetQrCodes", function (res) {
        if (!res || !res.success) {
            Swal.fire("Hata", (res && res.message) || "QR kodları yüklenemedi.", "error");
            return;
        }
        qrData = res.data;

        $("#generalQr").attr("src", qrData.general.qrImageUrl).on("load", function () {
            $("#generalQrLoading").addClass("d-none");
            $(this).removeClass("d-none");
        });
        $("#generalUrl").text(qrData.general.menuUrl).attr("title", qrData.general.menuUrl);
        $("#btnPreviewMenu").attr("href", qrData.general.menuUrl);
        $("#tableCount").text(qrData.tables.length);

        renderSectionTabs();
        renderTables();
    });
}

function renderSectionTabs() {
    var sections = [];
    qrData.tables.forEach(function (t) {
        if (!sections.some(function (s) { return s.toLowerCase() === t.section.toLowerCase(); })) sections.push(t.section);
    });
    var html = ["Hepsi"].concat(sections).map(function (s) {
        return `<li class="nav-item"><button type="button" class="nav-link py-1 px-3 ${s === qrSection ? "active" : ""}" data-section="${escapeHtml(s)}">${s === "Hepsi" ? "Tümü" : escapeHtml(s)}</button></li>`;
    }).join("");
    $("#qrSectionTabs").html(sections.length > 1 ? html : "");
}

function visibleTables() {
    return qrSection === "Hepsi"
        ? qrData.tables
        : qrData.tables.filter(function (t) { return t.section.toLowerCase() === qrSection.toLowerCase(); });
}

function renderTables() {
    renderSectionTabs();
    var tables = visibleTables();
    if (!tables.length) {
        $("#tableQrGrid").html('<div class="col-12 text-center text-muted py-4">Henüz masa yok. Masaları <a href="/Admin/TableManagement">Masa Yönetimi</a>\'nden ekleyin.</div>');
        return;
    }

    var html = tables.map(function (t) {
        return `
            <div class="col-6 col-md-4 col-xl-3">
                <div class="table-qr-card" data-table-id="${t.tableId}">
                    <div class="tq-head">
                        <span class="tq-name">${escapeHtml(t.tableNumber)}</span>
                        <span class="tq-section">${escapeHtml(t.section)}</span>
                    </div>
                    <img src="${t.qrImageUrl}" alt="${escapeHtml(t.tableNumber)} QR kodu" loading="lazy" />
                    <div class="tq-actions">
                        <button type="button" class="btn btn-light btn-sm" data-action="download" title="İndir"><i class="fa-solid fa-download"></i></button>
                        <button type="button" class="btn btn-light btn-sm" data-action="print" title="Yazdır"><i class="fa-solid fa-print"></i></button>
                        <button type="button" class="btn btn-light btn-sm" data-action="copy" title="Bağlantıyı kopyala"><i class="fa-regular fa-copy"></i></button>
                        <a class="btn btn-light btn-sm" href="${t.menuUrl}" target="_blank" rel="noopener" title="Önizle"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                    </div>
                </div>
            </div>`;
    }).join("");
    $("#tableQrGrid").html(html);
}

function tableLabel(t) {
    return { title: t.tableNumber, subtitle: qrData.companyName, qr: t.qrImageUrl };
}

// Yazdırma: her etiket restoran adı, masa adı ve QR'dan oluşur; görseller yüklenince yazdırma penceresi açılır
function printLabels(labels) {
    var win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
        Swal.fire("Açılır pencere engellendi", "Yazdırmak için tarayıcınızda bu site için açılır pencerelere izin verin.", "warning");
        return;
    }

    var items = labels.map(function (l) {
        return `<div class="label">
                    <div class="brand">${escapeHtml(l.subtitle)}</div>
                    <img src="${l.qr}" alt="">
                    <div class="title">${escapeHtml(l.title)}</div>
                    <div class="hint">Menü için telefonunuzla okutun</div>
                </div>`;
    }).join("");

    win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>QR Etiketleri</title>
        <style>
            @page { size: A4; margin: 12mm; }
            body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8mm; }
            .label { border: 1.5px dashed #b9a6bf; border-radius: 10px; padding: 6mm 4mm; text-align: center; page-break-inside: avoid; }
            .brand { font-size: 11pt; font-weight: 700; color: #4a154b; letter-spacing: .04em; text-transform: uppercase; }
            img { width: 42mm; height: 42mm; margin: 3mm auto; display: block; }
            .title { font-size: 16pt; font-weight: 800; }
            .hint { font-size: 9pt; color: #6b6475; margin-top: 1mm; }
        </style></head><body><div class="grid">${items}</div></body></html>`);
    win.document.close();

    var images = Array.prototype.slice.call(win.document.images);
    Promise.all(images.map(function (img) {
        return img.complete ? Promise.resolve() : new Promise(function (r) { img.onload = img.onerror = r; });
    })).then(function () {
        win.focus();
        win.print();
    });
}

// QR görseli başka bir alan adında olduğu için önce indirilip dosya olarak kaydedilir
function downloadQr(url, fileName) {
    fetch(url).then(function (r) {
        if (!r.ok) throw new Error();
        return r.blob();
    }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }).catch(function () {
        window.open(url, "_blank");   // indirilemezse yeni sekmede açılır; sağ tık → farklı kaydet
    });
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(function () {
        Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Bağlantı kopyalandı", timer: 1800, showConfirmButton: false });
    }, function () {
        Swal.fire("Bağlantı", text, "info");
    });
}

function safeFileName(text) {
    return (text || "menu").toString().trim().replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, "-");
}

function escapeHtml(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
}
