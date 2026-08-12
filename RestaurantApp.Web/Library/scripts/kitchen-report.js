// Global AJAX Ayarı (JWT Token Otomatik Eklenir)
$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var rawReportData = [];

$(document).ready(function () {
    console.log("Mutfak Raporu JS Yüklendi.");

    fetchKitchenReport();

    $("#txtReportDate").on("change", function () {
        fetchKitchenReport();
    });

    $("#filterSearchText").on("keyup search", function () {
        applyFilters();
    });

    $("#filterOrderType").on("change", function () {
        applyFilters();
    });

    // BİLGi KUTUCUKLARI (CHECKBOX) TIKLAMA FİLTRESİ
    $("#chkHasNote, #chkHasReturned").on("change", function () {
        applyFilters();
    });

    $("#btnClearFilters").on("click", function () {
        $("#filterSearchText").val("");
        $("#filterOrderType").val("");
        $("#chkHasNote").prop("checked", false);
        $("#chkHasReturned").prop("checked", false);
        applyFilters();
    });

    $("#btnExportExcel").on("click", function () {
        exportTableToExcel();
    });
});

function fetchKitchenReport() {
    var selectedDate = $("#txtReportDate").val();
    if (!selectedDate) return;

    var $tbody = $("#tblKitchenReportBody");
    $tbody.html(`
        <tr>
            <td colspan="5" class="text-center py-5 text-muted">
                <i class="fa-solid fa-spinner fa-spin fs-4 mb-2 d-block" style="color: #4a154b;"></i>
                <span>Sipariş verileri getiriliyor...</span>
            </td>
        </tr>`);

    $.ajax({
        url: "/Admin/GetKitchenReportByDate",
        type: "GET",
        data: { reportDate: selectedDate },
        cache: false,
        success: function (res) {
            if (res.success && res.data) {
                rawReportData = res.data;
                applyFilters();
            } else {
                rawReportData = [];
                renderReportTable([]);
            }
        },
        error: function (xhr) {
            console.error("Mutfak Raporu Çekme Hatası:", xhr);
            rawReportData = [];
            renderReportTable([]);
        }
    });
}

function applyFilters() {
    var searchText = ($("#filterSearchText").val() || "").toLowerCase().trim();
    var orderType = $("#filterOrderType").val();
    var onlyHasNote = $("#chkHasNote").is(":checked");
    var onlyHasReturned = $("#chkHasReturned").is(":checked");

    var filteredList = rawReportData.filter(function (item) {
        // 1. Sipariş Türü Filtresi
        if (orderType && item.orderType !== orderType) {
            return false;
        }

        // 2. Müşteri Notu Filtresi
        if (onlyHasNote && (!item.orderNote || item.orderNote.trim() === "")) {
            return false;
        }

        // 3. İade / İptal Filtresi
        if (onlyHasReturned) {
            var hasReturnedItem = item.items && item.items.some(function (p) { return p.isReturned === true; });
            if (!hasReturnedItem) {
                return false;
            }
        }

        // 4. Metin Arama Filtresi
        if (searchText) {
            var matchTitle = (item.title || "").toLowerCase().includes(searchText);
            var matchAddress = (item.deliveryAddress || "").toLowerCase().includes(searchText);
            var matchOrderId = (item.orderId || "").toString().includes(searchText);
            var matchOrderNote = (item.orderNote || "").toLowerCase().includes(searchText);

            var matchProduct = false;
            if (item.items && item.items.length > 0) {
                matchProduct = item.items.some(function (p) {
                    var matchName = (p.productName || "").toLowerCase().includes(searchText);
                    var matchReason = (p.returnReason || "").toLowerCase().includes(searchText);
                    return matchName || matchReason;
                });
            }

            return matchTitle || matchAddress || matchOrderId || matchOrderNote || matchProduct;
        }

        return true;
    });

    renderReportTable(filteredList);
}

function renderReportTable(dataList) {
    var $tbody = $("#tblKitchenReportBody");
    var dayTotal = 0;

    if (!dataList || dataList.length === 0) {
        $tbody.html(`
            <tr>
                <td colspan="5" class="text-center py-5 text-muted">
                    <i class="fa-solid fa-folder-open fs-2 mb-2 d-block opacity-50"></i>
                    <span>Seçilen tarihte ve filtrede mutfak sipariş kaydı bulunamadı.</span>
                </td>
            </tr>`);
        $("#lblReportSummary").text("Toplam 0 sipariş gösteriliyor.");
        $("#lblDayTotalAmount").text("0.00 ₺");
        return;
    }

    var html = "";
    $.each(dataList, function (i, order) {
        dayTotal += (order.totalAmount || 0);

        var isMasa = order.orderType === "Masa";

        var typeBadge = isMasa
            ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 rounded-3"><i class="fa-solid fa-chair me-1"></i>${order.title}</span>`
            : `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-3 py-2 rounded-3"><i class="fa-solid fa-motorcycle me-1"></i>Paket Servis</span>`;

        var subInfo = isMasa ? "" : `<div class="extra-small text-muted mt-1"><i class="fa-solid fa-location-dot me-1"></i>${order.deliveryAddress || 'Adres Girilmedi'}</div>`;

        html += `
            <tr>
                <td class="fw-bold text-secondary">#${order.orderId}</td>
                <td>
                    <span class="fw-semibold text-dark"><i class="fa-regular fa-clock me-1 text-muted"></i>${order.orderTime}</span>
                </td>
                <td class="text-start">
                    ${typeBadge}
                    ${subInfo}
                </td>
                <td>
                    <button type="button" class="btn btn-sm btn-light border text-dark rounded-pill px-3 shadow-sm" onclick="showOrderDetailsModal(${order.orderId})" title="İçeriği Göster">
                        <i class="fa-solid fa-circle-info me-1" style="color: #4a154b;"></i>İçeriği Gör
                    </button>
                </td>
                <td class="text-end pe-4 fw-bold" style="color: #4a154b; font-size: 0.98rem;">
                    ${parseFloat(order.totalAmount || 0).toFixed(2)} ₺
                </td>
            </tr>`;
    });

    $tbody.html(html);
    $("#lblReportSummary").text(`Toplam ${dataList.length} sipariş gösteriliyor.`);
    $("#lblDayTotalAmount").text(dayTotal.toFixed(2) + " ₺");
}

function showOrderDetailsModal(orderId) {
    var order = rawReportData.find(function (x) { return x.orderId === orderId; });
    if (!order) return;

    var isMasa = order.orderType === "Masa";

    var firstTime = order.firstOrderTime || order.orderTime || "--:--";
    var deliveryTime = order.lastDeliveryTime || "--:--";
    var closedTime = order.tableClosedTime || "--:--";

    var infoText = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="fw-bold text-dark fs-6"><i class="fa-solid ${isMasa ? 'fa-chair' : 'fa-motorcycle'} me-2" style="color:#4a154b;"></i>${order.title}</span>
            <span class="badge bg-secondary-subtle text-dark border px-2 py-1 fw-bold">Sipariş #${order.orderId}</span>
        </div>
        <div class="row g-2 text-center pt-2 border-top extra-small">
            <div class="col-4">
                <div class="p-2 bg-white rounded border h-100 d-flex flex-column justify-content-center align-items-center">
                    <span class="text-muted d-block mb-1">İlk Sipariş</span>
                    <strong class="text-dark fs-6">${firstTime}</strong>
                </div>
            </div>
            <div class="col-4">
                <div class="p-2 bg-white rounded border h-100 d-flex flex-column justify-content-center align-items-center">
                    <span class="text-muted d-block mb-1">Teslimat Saati</span>
                    <strong class="text-dark fs-6">${deliveryTime}</strong>
                </div>
            </div>
            <div class="col-4">
                <div class="p-2 bg-white rounded border h-100 d-flex flex-column justify-content-center align-items-center">
                    <span class="text-muted d-block mb-1">Masa Boşalma</span>
                    <strong class="text-dark fs-6">${closedTime}</strong>
                </div>
            </div>
        </div>
    `;

    if (!isMasa && order.deliveryAddress) {
        infoText += `<div class="mt-2 pt-2 border-top extra-small text-muted"><i class="fa-solid fa-location-dot me-1"></i>Adres: ${order.deliveryAddress}</div>`;
    }

    if (order.orderNote) {
        infoText += `<div class="mt-2 pt-2 border-top extra-small text-dark fw-bold bg-warning-subtle p-2 rounded"><i class="fa-solid fa-note-sticky me-1 text-warning-emphasis"></i>Sipariş Notu: "${order.orderNote}"</div>`;
    }

    $("#modalOrderInfoBar").html(infoText);
    $("#modalTotalAmount").text(parseFloat(order.totalAmount || 0).toFixed(2) + " ₺");

    var containerHtml = "";
    if (order.items && order.items.length > 0) {
        $.each(order.items, function (idx, item) {
            var isRet = item.isReturned || false;
            var titleStyle = isRet ? 'text-decoration: line-through; color: #dc2626 !important;' : 'color: #212529;';
            var bgStyle = isRet ? 'background-color: #fef2f2; border-left: 4px solid #dc2626;' : 'background-color: #ffffff;';

            var returnedBadge = isRet
                ? `<span class="badge bg-danger text-white ms-2 extra-small"><i class="fa-solid fa-rotate-left me-1"></i>İADE EDİLDİ</span>`
                : ``;

            var reasonHtml = isRet
                ? `<div class="text-danger extra-small fw-bold mt-1"><i class="fa-solid fa-circle-exclamation me-1"></i>İade Sebebi: "${item.returnReason || 'Belirtilmedi'}"</div>`
                : ``;

            containerHtml += `
                <div class="modal-product-item p-2 mb-2 rounded border ${isRet ? 'border-danger-subtle' : ''}" style="${bgStyle}">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="fw-bold mb-0" style="${titleStyle}">
                                ${item.productName}
                                ${returnedBadge}
                            </h6>
                            <span class="text-muted extra-small">${item.quantity} Adet x ${parseFloat(item.unitPrice || 0).toFixed(2)} ₺</span>
                        </div>
                        <span class="fw-bold ${isRet ? 'text-decoration-line-through text-muted' : ''}" style="${isRet ? '' : 'color: #4a154b;'}">
                            ${parseFloat(item.totalLinePrice || 0).toFixed(2)} ₺
                        </span>
                    </div>
                    ${reasonHtml}
                </div>`;
        });
    } else {
        containerHtml = `<div class="text-center text-muted py-3">Ürün detay bilgisi bulunamadı.</div>`;
    }

    $("#modalProductsContainer").html(containerHtml);

    var bsModal = new bootstrap.Modal(document.getElementById('modalOrderItems'));
    bsModal.show();
}

function exportTableToExcel() {
    if (!rawReportData || rawReportData.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Aktarılacak Veri Yok',
            text: 'Seçilen tarihte dışa aktarılacak mutfak sipariş verisi bulunmuyor.',
            confirmButtonColor: '#4a154b'
        });
        return;
    }

    var exportData = [];
    $.each(rawReportData, function (i, item) {
        var itemsSummary = item.items ? item.items.map(function (p) {
            var retStr = p.isReturned ? ` [İADE EDİLDİ: ${p.returnReason || ''}]` : '';
            return `${p.productName} (${p.quantity} Adet)${retStr}`;
        }).join(', ') : '';

        exportData.push({
            "Sipariş No": "#" + item.orderId,
            "Sipariş Saati": item.orderTime,
            "İlk Sipariş Saati": item.firstOrderTime || item.orderTime,
            "Son Teslimat Saati": item.lastDeliveryTime || "--:--",
            "Masa Boşalma Saati": item.tableClosedTime || "--:--",
            "Sipariş Türü": item.orderType,
            "Masa / Adres": item.title + (item.deliveryAddress ? " - " + item.deliveryAddress : ""),
            "Sipariş Notu": item.orderNote || "-",
            "Ürün İçeriği": itemsSummary,
            "Sipariş Fiyatı (TL)": parseFloat(item.totalAmount || 0).toFixed(2)
        });
    });

    var ws = XLSX.utils.json_to_sheet(exportData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mutfak Raporu");

    var reportDate = $("#txtReportDate").val() || "Tarihsiz";
    XLSX.writeFile(wb, `Mutfak_Raporu_${reportDate}.xlsx`);
}