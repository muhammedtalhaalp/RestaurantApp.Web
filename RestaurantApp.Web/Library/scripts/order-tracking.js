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

                $badge.text(`${res.data.length} Aktif Sipariş (${readyCount} Servise Hazır)`)
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
                        ? "<strong class='text-success'><i class='fa-solid fa-circle-check me-1'></i>Hazır ürün(ler) var, servise çık!</strong>"
                        : "<span class='text-muted'><i class='fa-solid fa-fire-burner me-1 text-info'></i>Mutfakta hazırlanıyor...</span>";

                    var statusBadge = isReady
                        ? `<span class="badge bg-success text-white"><i class="fa-solid fa-bell-concierge me-1"></i>Servise Hazır</span>`
                        : `<span class="badge bg-info text-dark"><i class="fa-solid fa-spinner fa-spin me-1"></i>Hazırlanıyor</span>`;

                    var buttonHtml = isReady
                        ? `<button class="btn btn-success text-white w-100 fw-bold py-2 rounded-3 border-0 shadow-sm mt-2" onclick="event.stopPropagation(); deliverAdminOrder(${order.orderId});">
                               <i class="fa-solid fa-circle-check me-2"></i>Hazırları Teslim Aldım
                           </button>`
                        : `<button class="btn btn-light w-100 fw-bold py-2 rounded-3 text-muted border opacity-75 mt-2" onclick="event.stopPropagation(); openOrderDetailsModal(${order.orderId});">
                               <i class="fa-solid fa-eye me-2 text-info"></i>Sipariş Detayını Gör
                           </button>`;

                    var cardBorder = isReady ? "border-left: 5px solid #198754 !important;" : "border-left: 5px solid #0dcaf0 !important;";
                    var pulseClass = isReady ? "admin-card-pulse" : "";

                    html += `
                        <div class="col-md-4 col-lg-3 d-flex align-items-stretch">
                            <div class="pending-order-card p-3 border shadow-sm rounded-4 w-100 d-flex flex-column justify-content-between h-100 cursor-pointer ${pulseClass}" style="${cardBorder}" onclick="openOrderDetailsModal(${order.orderId})">
                                <div>
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <h6 class="fw-bold mb-0 text-dark"><i class="fa-solid ${icon} me-2" style="color: #4a154b;"></i>${title}</h6>
                                        <span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                    </div>
                                    <p class="small mb-2">${subText}</p>
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
            <td colspan="6" class="text-center py-4 text-muted">
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

                $("#modalOrderTitle").html(`<i class="fa-solid fa-receipt me-2"></i>${d.tableName} Detayı`);
                $("#lblOrderTime").text(d.orderTime);
                $("#lblOrderTotalAmount").text(parseFloat(d.totalAmount || 0).toFixed(2) + " ₺");

                var badgeClass = d.status === "Hazır" ? "bg-success text-white" : (d.status === "Servis Edildi" ? "bg-secondary text-white" : "bg-info text-dark");
                $("#lblOrderStatusBadge").attr("class", `badge ${badgeClass}`).text(d.status);

                var rowsHtml = "";
                var hasReadyItem = false;

                if (d.items && d.items.length > 0) {
                    $.each(d.items, function (i, item) {
                        var statusBadge = "";
                        if (item.itemStatus === "Hazır") {
                            hasReadyItem = true;
                            statusBadge = `<span class="badge badge-item-ready rounded-pill"><i class="fa-solid fa-circle-check me-1"></i>Hazırlandı / Servise Çık</span>`;
                        } else if (item.itemStatus === "Servis Edildi") {
                            statusBadge = `<span class="badge badge-item-delivered rounded-pill"><i class="fa-solid fa-check me-1"></i>Servis Edildi</span>`;
                        } else {
                            statusBadge = `<span class="badge badge-item-cooking rounded-pill"><i class="fa-solid fa-spinner fa-spin me-1"></i>Mutfakta Hazırlanıyor</span>`;
                        }

                        var deleteBtnHtml = item.itemStatus === "Hazırlanıyor"
                            ? `<button class="btn btn-sm btn-outline-danger rounded-circle border-0 py-1 px-2" onclick="deleteAdminOrderItem(${item.orderDetailId}, ${d.orderId})" title="Ürünü İptal Et/Sil">
                                   <i class="fa-solid fa-trash-can"></i>
                               </button>`
                            : `<span class="text-muted">-</span>`;

                        rowsHtml += `
                            <tr>
                                <td class="py-2 px-3 fw-semibold text-dark">${item.productName}</td>
                                <td class="py-2 px-3 text-center fw-bold">${item.quantity}</td>
                                <td class="py-2 px-3 text-center">${statusBadge}</td>
                                <td class="py-2 px-3 text-end text-muted">${parseFloat(item.unitPrice || 0).toFixed(2)} ₺</td>
                                <td class="py-2 px-3 text-end fw-bold text-dark">${parseFloat(item.totalPrice || 0).toFixed(2)} ₺</td>
                                <td class="py-2 px-3 text-center">${deleteBtnHtml}</td>
                            </tr>
                        `;
                    });
                } else {
                    rowsHtml = `<tr><td colspan="6" class="text-center py-3 text-muted">Bu siparişte ürün bulunamadı.</td></tr>`;
                }

                $("#tblOrderItemsBody").html(rowsHtml);

                var footerBtns = `<button type="button" class="btn btn-secondary rounded-3 fw-bold px-4" data-bs-dismiss="modal">Kapat</button>`;
                if (hasReadyItem) {
                    footerBtns += `
                        <button type="button" class="btn btn-success text-white fw-bold px-4 shadow-sm" onclick="deliverAdminOrder(${d.orderId}); $('#orderDetailsModal').modal('hide');">
                            <i class="fa-solid fa-circle-check me-2"></i>Hazır Ürünleri Teslim Aldım
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

function deleteAdminOrderItem(orderDetailId, orderId) {
    $.ajax({
        url: "/Admin/DeleteOrderItem",
        type: "POST",
        data: { orderDetailId: orderDetailId },
        success: function (res) {
            if (res.success) {
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
    $.ajax({
        url: "/Order/ApproveOrderDelivery",
        type: "POST",
        data: { orderId: orderId },
        success: function (res) {
            if (res.success) {
                if ($.connection && $.connection.orderHub) {
                    $.connection.orderHub.server.sendOrderDeliveredNotification(orderId);
                }

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Hazır ürünlerin teslimatı onaylandı!',
                    showConfirmButton: false,
                    timer: 1500
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