$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

$(document).ready(function () {
    console.log("Masa Kontrol JS Yüklendi.");
    loadOccupiedTables();
});

function loadOccupiedTables() {
    $.ajax({
        url: "/Table/GetOccupiedTables",
        type: "GET",
        cache: false,
        success: function (res) {
            var $container = $("#occupiedTablesContainer");
            var $badge = $("#occupiedCountBadge");

            if (res.success && res.data && res.data.length > 0) {
                $badge.text(`${res.data.length} Dolu Masa`);
                var html = "";

                $.each(res.data, function (i, table) {
                    var rawName = table.tableName || '';
                    var tableNameFormatted = rawName.toLowerCase().startsWith('masa') ? rawName : `Masa ${rawName}`;
                    var totalAmountFormatted = parseFloat(table.totalAmount || 0).toFixed(2);

                    html += `
                        <div class="col-md-4 col-lg-3" id="table-card-${table.tableId}">
                            <div class="card h-100 border-0 p-3 table-card-occupied shadow-sm">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="fw-bold mb-0 text-dark">
                                        <i class="fa-solid fa-chair me-2 text-danger"></i>${tableNameFormatted}
                                    </h6>
                                    <span class="badge bg-danger text-white px-2 py-1 rounded-2">Dolu</span>
                                </div>
                                <p class="text-muted small mb-1"><i class="fa-solid fa-layer-group me-1"></i>Bölüm: ${table.section || 'Salon'}</p>
                                <div class="fs-5 fw-bold mb-3" style="color: #4a154b;">
                                    Adisyon Tutarı: ${totalAmountFormatted} ₺
                                </div>
                                <div class="pt-2 border-top mt-auto">
                                    <button class="btn btn-success w-100 py-2 fw-bold" onclick="openWaiterCheckoutModal(${table.tableId}, '${tableNameFormatted}')">
                                        <i class="fa-solid fa-credit-card me-2"></i>Ödeme/ İptal & Masayı Temizle
                                    </button>
                                </div>
                            </div>
                        </div>`;
                });

                $container.html(html);
            } else {
                $badge.text("0 Dolu Masa");
                $container.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an dolu olan masa bulunmamaktadır. Tüm masalar boş!</h5>
                    </div>`);
            }
        },
        error: function (xhr) {
            console.error("Dolu Masalar Çekilemedi:", xhr);
        }
    });
}

// MASA ADİSYON DETAYINI ÇEKİP MODALA ÇİZME
function openWaiterCheckoutModal(tableId, tableName) {
    $("#waiterCheckoutTableId").val(tableId);
    $("#waiterCheckoutModalTitle").html(`<i class="fa-solid fa-receipt me-2" style="color: #4a154b;"></i>${tableName} - Adisyon & İade Detayı`);
    cancelWaiterReturnInput();

    Swal.fire({
        title: 'Adisyon Yükleniyor...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    $.ajax({
        url: "/Admin/GetActiveOrderByTableId",
        type: "GET",
        data: { tableId: tableId },
        success: function (res) {
            Swal.close();
            if (res.success && res.data) {
                renderWaiterCheckoutItems(res.data);
                var modalEl = document.getElementById('waiterTableCheckoutModal');
                var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                modalInstance.show();
            } else {
                Swal.fire("Hata", res.message || "Adisyon detayları çekilemedi.", "error");
            }
        },
        error: function () {
            Swal.close();
            Swal.fire("Hata", "Adisyon çekilirken sunucu hatası oluştu.", "error");
        }
    });
}

// ADİSYON TABLOSUNU ÇİZME & İADE BUTTONUNU EKLEME
function renderWaiterCheckoutItems(items) {
    var $tbody = $("#waiterCheckoutItemsBody");
    $tbody.empty();
    var grandTotal = 0;

    if (!items || items.length === 0) {
        $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted">Adisyonda ürün bulunamadı.</td></tr>');
        $("#waiterCheckoutGrandTotal").text("0.00 ₺");
        return;
    }

    $.each(items, function (i, item) {
        var isReturned = item.isReturned || false;
        var lineTotal = item.unitPrice * item.quantity;

        if (!isReturned) {
            grandTotal += lineTotal;
        }

        var returnBtnHtml = "";
        if (isReturned) {
            returnBtnHtml = `<span class="badge bg-secondary opacity-75" title="${item.returnReason || 'Neden belirtilmedi'}"><i class="fa-solid fa-rotate-left me-1"></i>İade Edildi</span>`;
        } else {
            returnBtnHtml = `
                <button class="btn btn-sm btn-outline-danger fw-bold rounded-3 px-2 py-1 btn-waiter-return-product" 
                        data-detailid="${item.orderDetailId}" 
                        data-name="${item.productName}">
                    <i class="fa-solid fa-rotate-left me-1"></i>İade Et
                </button>`;
        }

        var rowStyle = isReturned ? 'style="opacity:0.5; text-decoration: line-through; background-color:#f8fafc;"' : '';

        var row = `
            <tr ${rowStyle}>
                <td class="fw-semibold text-dark">
                    ${item.productName}
                    ${isReturned ? `<br><small class="text-danger fw-normal" style="text-decoration:none !important;">(İade Nedeni: ${item.returnReason})</small>` : ''}
                </td>
                <td class="text-center fw-bold">${item.quantity}</td>
                <td class="text-end">${parseFloat(item.unitPrice).toFixed(2)} ₺</td>
                <td class="text-end fw-bold text-dark">${lineTotal.toFixed(2)} ₺</td>
                <td class="text-center">${returnBtnHtml}</td>
            </tr>`;

        $tbody.append(row);
    });

    $("#waiterCheckoutGrandTotal").text(grandTotal.toFixed(2) + " ₺");
}

// İADE ET BUTONUNA BASILDIĞINDA MODAL İÇİNDEKİ KUTUYU AÇMA
$(document).on("click", ".btn-waiter-return-product", function (e) {
    e.stopPropagation();
    var detailId = $(this).data("detailid");
    var productName = $(this).data("name");

    $("#selectedWaiterReturnDetailId").val(detailId);
    $("#lblWaiterReturnProductName").text(productName);
    $("#txtWaiterReturnReasonInput").val("");

    $("#waiterReturnReasonContainer").removeClass("d-none");

    setTimeout(function () {
        $("#txtWaiterReturnReasonInput").focus();
    }, 100);
});

// İADE KUTUSUNU İPTAL ETME
window.cancelWaiterReturnInput = function () {
    $("#waiterReturnReasonContainer").addClass("d-none");
    $("#selectedWaiterReturnDetailId").val("");
    $("#txtWaiterReturnReasonInput").val("");
};

// İADEYİ ONAYLAMA VE SUNUCUYA GÖNDERME
$(document).on("click", "#btnConfirmWaiterReturnAction", function () {
    var detailId = $("#selectedWaiterReturnDetailId").val();
    var reason = $("#txtWaiterReturnReasonInput").val() ? $("#txtWaiterReturnReasonInput").val().trim() : "";

    if (!reason) {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'warning',
            title: 'Lütfen iade sebebini yazınız!',
            showConfirmButton: false,
            timer: 1500
        });
        $("#txtWaiterReturnReasonInput").focus();
        return;
    }

    $.post("/Order/ReturnOrderItem", {
        orderDetailId: detailId,
        reason: reason
    }, function (res) {
        if (res.success) {
            cancelWaiterReturnInput();

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: res.message,
                showConfirmButton: false,
                timer: 1500
            });

            var tableId = $("#waiterCheckoutTableId").val();
            openWaiterCheckoutModal(tableId, "Masa");
            loadOccupiedTables();
        } else {
            Swal.fire("Hata", res.message, "error");
        }
    });
});

// MASAYI KAPATMA VE ÖDEME ALMA İŞLEMİ
$(document).on("click", "#btnWaiterCloseTableOrder", function () {
    var tableId = $("#waiterCheckoutTableId").val();

    Swal.fire({
        title: "Ödeme Alındı mı?",
        text: "Hesap kapatılacak ve masa BOŞ durumuna getirilecektir.",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#198754",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "<i class='fa-solid fa-check me-1'></i>Evet, Masayı Kapat",
        cancelButtonText: "Vazgeç"
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: "/Table/CloseTableAndPay",
                type: "POST",
                data: { tableId: tableId },
                success: function (res) {
                    if (res.success) {
                        var modalEl = document.getElementById('waiterTableCheckoutModal');
                        var modalInstance = bootstrap.Modal.getInstance(modalEl);
                        if (modalInstance) modalInstance.hide();

                        Swal.fire({
                            toast: true,
                            position: 'top-end',
                            icon: 'success',
                            title: 'Masa kapatıldı ve ödeme tamamlandı!',
                            showConfirmButton: false,
                            timer: 1500
                        });

                        loadOccupiedTables();
                    } else {
                        Swal.fire('Hata!', res.message, 'error');
                    }
                }
            });
        }
    });
});