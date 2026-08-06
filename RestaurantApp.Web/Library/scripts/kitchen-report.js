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

    $("#btnClearFilters").on("click", function () {
        $("#filterSearchText").val("");
        $("#filterOrderType").val("");
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

    var filteredList = rawReportData.filter(function (item) {
        if (orderType && item.orderType !== orderType) {
            return false;
        }

        if (searchText) {
            var matchTitle = (item.title || "").toLowerCase().includes(searchText);
            var matchAddress = (item.deliveryAddress || "").toLowerCase().includes(searchText);
            var matchOrderId = (item.orderId || "").toString().includes(searchText);

            var matchProduct = false;
            if (item.items && item.items.length > 0) {
                matchProduct = item.items.some(function (p) {
                    return (p.productName || "").toLowerCase().includes(searchText);
                });
            }

            return matchTitle || matchAddress || matchOrderId || matchProduct;
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

        // Sipariş Türü Görünümü
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
    var infoText = isMasa
        ? `<strong>${order.title}</strong> — Saat: ${order.orderTime}`
        : `<strong>Paket Servis</strong> — Adres: ${order.deliveryAddress || 'Girilmedi'} — Saat: ${order.orderTime}`;

    $("#modalOrderInfoBar").html(infoText);
    $("#modalTotalAmount").text(parseFloat(order.totalAmount || 0).toFixed(2) + " ₺");

    var containerHtml = "";
    if (order.items && order.items.length > 0) {
        $.each(order.items, function (idx, item) {
            containerHtml += `
                <div class="modal-product-item d-flex justify-content-between align-items-center p-2 mb-2 border-bottom">
                    <div>
                        <h6 class="fw-bold text-dark mb-0">${item.productName}</h6>
                        <span class="text-muted extra-small">${item.quantity} Adet x ${parseFloat(item.unitPrice || 0).toFixed(2)} ₺</span>
                    </div>
                    <span class="fw-bold" style="color: #4a154b;">${parseFloat(item.totalLinePrice || 0).toFixed(2)} ₺</span>
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
        var itemsSummary = item.items ? item.items.map(function (p) { return `${p.productName} (${p.quantity} Adet)`; }).join(', ') : '';

        exportData.push({
            "Sipariş No": "#" + item.orderId,
            "Sipariş Saati": item.orderTime,
            "Sipariş Türü": item.orderType,
            "Masa / Adres": item.title + (item.deliveryAddress ? " - " + item.deliveryAddress : ""),
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