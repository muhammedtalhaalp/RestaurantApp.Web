$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

$(document).ready(function () {
    console.log("Admin Sipariş Takip JS Yüklendi.");

    loadAdminPendingOrders();
    setInterval(loadAdminPendingOrders, 8000);
    initAdminSignalR();
});

function initAdminSignalR() {
    if ($.connection && $.connection.orderHub) {
        var orderHubProxy = $.connection.orderHub;

        orderHubProxy.client.onOrderReady = function () {
            loadAdminPendingOrders();
        };

        orderHubProxy.client.onOrderDelivered = function () {
            loadAdminPendingOrders();
        };

        orderHubProxy.client.onNewOrderCreated = function () {
            loadAdminPendingOrders();
        };

        $.connection.hub.start().done(function () {
            console.log("Admin Sipariş Takip SignalR Bağlantısı Başarılı.");
        }).fail(function (err) {
            console.error("SignalR Bağlantı Hatası: ", err);
        });
    }
}

function loadAdminPendingOrders() {
    $.ajax({
        url: "/Admin/GetPendingDeliveryOrders",
        type: "GET",
        cache: false,
        success: function (res) {
            var $container = $("#adminPendingOrdersContainer");
            var $badge = $("#pendingOrdersCountBadge");

            if (res.success && res.data && res.data.length > 0) {
                var readyCount = res.data.filter(o => o.status === "Hazır").length;

                $badge.text(`${res.data.length} Aktif Sipariş (${readyCount} Hazır)`)
                    .removeClass("bg-success text-white")
                    .addClass("badge-purple-main");

                var html = "";

                $.each(res.data, function (i, order) {
                    var isMasa = order.orderType === "Masa";
                    var isReady = order.status === "Hazır";
                    var icon = isMasa ? "fa-chair" : "fa-motorcycle";

                    var rawTableName = order.tableName || '';
                    var title = isMasa
                        ? (rawTableName.toLowerCase().startsWith('masa') ? rawTableName : `Masa ${rawTableName}`)
                        : "Paket Servis";

                    var subText = isReady
                        ? "<strong class='text-dark'><i class='fa-solid fa-circle-check me-1 text-success'></i>Mutfakta hazırlandı, teslimat bekleniyor.</strong>"
                        : "<span class='text-muted'><i class='fa-solid fa-spinner fa-spin me-1 text-info'></i>Mutfakta hazırlanıyor...</span>";

                    var statusBadge = isReady
                        ? `<span class="badge bg-warning text-dark"><i class="fa-solid fa-hourglass-half me-1"></i>Teslimat Bekliyor</span>`
                        : `<span class="badge bg-info text-dark"><i class="fa-solid fa-spinner fa-spin me-1"></i>Hazırlanıyor</span>`;

                    var buttonHtml = isReady
                        ? `<button class="btn btn-warning text-dark w-100 fw-bold py-2 rounded-3 border-0 shadow-sm mt-2" onclick="event.stopPropagation(); deliverAdminOrder(${order.orderId});">
                               <i class="fa-solid fa-circle-check me-2"></i>Teslim Aldım
                           </button>`
                        : `<button class="btn btn-light w-100 fw-bold py-2 rounded-3 text-muted border opacity-75 mt-2" disabled>
                               <i class="fa-solid fa-fire-burner me-2 text-info"></i>Hazırlanıyor...
                           </button>`;

                    var cardBorder = isReady ? "border-left: 5px solid #ffc107 !important;" : "border-left: 5px solid #0dcaf0 !important;";

                    html += `
                        <div class="col-md-4 col-lg-3 d-flex align-items-stretch">
                            <div class="pending-order-card p-3 border shadow-sm rounded-4 w-100 d-flex flex-column justify-content-between h-100 cursor-pointer" style="${cardBorder}" onclick="openOrderDetailsModal(${order.orderId})">
                                <div>
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <h6 class="fw-bold mb-0 text-dark"><i class="fa-solid ${icon} me-2" style="color: #4a154b;"></i>${title}</h6>
                                        <span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                    </div>
                                    <p class="text-muted small mb-2">${subText}</p>
                                </div>
                                <div class="mt-auto">
                                    <div class="d-flex justify-content-between align-items-center pt-2 border-top mb-1">
                                        <span class="fw-bold fs-6" style="color: #4a154b;">${parseFloat(order.totalAmount || 0).toFixed(2)} ₺</span>
                                        ${statusBadge}
                                    </div>
                                    ${buttonHtml}
                                </div>
                            </div>
                        </div>`;
                });

                $container.html(html);
            } else {
                $badge.text("0 Aktif Sipariş")
                    .removeClass("badge-purple-main")
                    .addClass("bg-success text-white");

                $container.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an aktif veya teslimat bekleyen sipariş bulunmuyor.</h5>
                    </div>`);
            }
        },
        error: function (xhr) {
            console.error("Admin Sipariş Takip Yükleme Hatası: ", xhr);
        }
    });
}

function openOrderDetailsModal(orderId) {
    $("#tblOrderItemsBody").html(`
        <tr>
            <td colspan="5" class="text-center py-4 text-muted">
                <i class="fa-solid fa-spinner fa-spin me-2"></i>Ürünler yükleniyor...
            </td>
        </tr>
    `);

    $("#modalFooterActions").empty();

    var modalEl = document.getElementById('orderDetailsModal');
    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();

    $.ajax({
        url: "/Admin/GetOrderDetails",
        type: "GET",
        data: { orderId: orderId },
        success: function (res) {
            if (res.success && res.data) {
                var d = res.data;

                $("#modalOrderTitle").html(`<i class="fa-solid fa-receipt me-2" style="color: #4a154b;"></i>${d.tableName} Detayı`);
                $("#lblOrderTime").text(d.orderTime);
                $("#lblOrderTotalAmount").text(parseFloat(d.totalAmount || 0).toFixed(2) + " ₺");

                var badgeClass = d.status === "Hazır" ? "bg-warning text-dark" : "bg-info text-dark";
                $("#lblOrderStatusBadge").attr("class", `badge ${badgeClass}`).text(d.status);

                var rowsHtml = "";
                if (d.items && d.items.length > 0) {
                    $.each(d.items, function (i, item) {
                        var deleteBtnHtml = d.status === "Hazırlanıyor"
                            ? `<button class="btn btn-sm btn-outline-danger rounded-circle border-0 py-1 px-2" onclick="deleteAdminOrderItem(${item.orderDetailId}, ${d.orderId})" title="Ürünü İptal Et/Sil">
                                   <i class="fa-solid fa-trash-can"></i>
                               </button>`
                            : `<span class="text-muted" title="Hazır/Teslimat aşamasında silinemez">-</span>`;

                        rowsHtml += `
                            <tr>
                                <td class="py-2 px-3 fw-semibold text-dark">${item.productName}</td>
                                <td class="py-2 px-3 text-center fw-bold">${item.quantity}</td>
                                <td class="py-2 px-3 text-end text-muted">${parseFloat(item.unitPrice || 0).toFixed(2)} ₺</td>
                                <td class="py-2 px-3 text-end fw-bold text-dark">${parseFloat(item.totalPrice || 0).toFixed(2)} ₺</td>
                                <td class="py-2 px-3 text-center">${deleteBtnHtml}</td>
                            </tr>
                        `;
                    });
                } else {
                    rowsHtml = `<tr><td colspan="5" class="text-center py-3 text-muted">Bu siparişte ürün bulunamadı.</td></tr>`;
                }

                $("#tblOrderItemsBody").html(rowsHtml);

                var footerBtns = `<button type="button" class="btn btn-light rounded-3 fw-bold" data-bs-dismiss="modal">Kapat</button>`;
                if (d.status === "Hazır") {
                    footerBtns += `
                        <button type="button" class="btn btn-warning text-dark fw-bold px-4" onclick="deliverAdminOrder(${d.orderId}); $('#orderDetailsModal').modal('hide');">
                            <i class="fa-solid fa-circle-check me-2"></i>Teslim Aldım
                        </button>`;
                }
                $("#modalFooterActions").html(footerBtns);
            } else {
                Swal.fire("Hata", res.message || "Sipariş detayları çekilemedi.", "error");
            }
        },
        error: function () {
            Swal.fire("Hata", "Sunucudan veriler çekilirken hata oluştu.", "error");
        }
    });
}

// Ürün Kalemini Direk 1 Eksiltme / Silme Fonksiyonu (Onay Penceresiz)
function deleteAdminOrderItem(orderDetailId, orderId) {
    $.ajax({
        url: "/Admin/DeleteOrderItem",
        type: "POST",
        data: { orderDetailId: orderDetailId },
        success: function (res) {
            if (res.success) {
                // Sağ üstte ufak toast bildirimi
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: res.message || 'Ürün 1 adet eksiltildi.',
                    showConfirmButton: false,
                    timer: 1200
                });

                if (res.isOrderCancelled) {
                    var modalEl = document.getElementById('orderDetailsModal');
                    var modalInstance = bootstrap.Modal.getInstance(modalEl);
                    if (modalInstance) modalInstance.hide();
                } else {
                    openOrderDetailsModal(orderId);
                }

                loadAdminPendingOrders();
            } else {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'error',
                    title: res.message || 'Hata oluştu.',
                    showConfirmButton: false,
                    timer: 2000
                });
            }
        },
        error: function () {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'error',
                title: 'Sunucu hatası oluştu.',
                showConfirmButton: false,
                timer: 2000
            });
        }
    });
}

function deliverAdminOrder(orderId) {
    Swal.fire({
        title: "Sipariş Teslim Edilsin mi?",
        text: "Bu siparişi teslim edilmiş olarak işaretliyorsunuz.",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#ffc107",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "Evet, Teslim Edildi",
        cancelButtonText: "Vazgeç"
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: "/Order/ApproveOrderDelivery",
                type: "POST",
                data: { orderId: orderId },
                success: function (res) {
                    if (res.success) {
                        Swal.fire({
                            icon: "success",
                            title: "Başarılı!",
                            text: "Sipariş teslim edildi olarak işaretlendi.",
                            timer: 1500,
                            showConfirmButton: false
                        });

                        loadAdminPendingOrders();
                    } else {
                        Swal.fire("Hata", res.message, "error");
                    }
                },
                error: function () {
                    Swal.fire("Hata", "İşlem gerçekleştirilirken sunucu hatası oluştu.", "error");
                }
            });
        }
    });
}