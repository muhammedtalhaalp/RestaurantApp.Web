$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var waiterReadyNotifications = [];

$(document).ready(function () {
    console.log("Garson Sipariş Takip JS Yüklendi.");

    loadWaiterReadyOrders();
    setInterval(loadWaiterReadyOrders, 10000);
    initWaiterSignalR();
});

function initWaiterSignalR() {
    if ($.connection && $.connection.orderHub) {
        var orderHubProxy = $.connection.orderHub;

        orderHubProxy.client.onOrderReady = function (orderId, tableName, orderType, address) {
            var isMasa = orderType === "Masa";
            var formattedTableName = isMasa
                ? (tableName.toLowerCase().startsWith('masa') ? tableName : `Masa ${tableName}`)
                : "Paket Servis";

            var notificationObj = {
                orderId: orderId,
                title: formattedTableName,
                subtitle: isMasa ? `Mutfakta Hazırlandı` : `Adres: ${address || 'Girilmedi'}`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            loadWaiterReadyOrders();
            showLeftToast(notificationObj);
        };

        $.connection.hub.start().done(function () {
            console.log("Garson SignalR Bağlantısı Başarılı.");
        });
    }
}

function loadWaiterReadyOrders() {
    $.ajax({
        url: "/Admin/GetPendingDeliveryOrders",
        type: "GET",
        cache: false,
        success: function (res) {
            var $grid = $("#waiterReadyOrdersGrid");
            var $badge = $("#waiterOrdersBadge");

            if (res.success && res.data && res.data.length > 0) {
                waiterReadyNotifications = res.data;
                $badge.text(`${res.data.length} Sipariş Hazır`)
                    .removeClass("bg-success text-white bg-warning text-dark")
                    .addClass("bg-warning text-dark");

                var html = "";
                $.each(res.data, function (i, order) {
                    var isMasa = order.orderType === "Masa";
                    var icon = isMasa ? "fa-chair" : "fa-motorcycle";

                    var rawTableName = order.tableName || '';
                    var title = isMasa
                        ? (rawTableName.toLowerCase().startsWith('masa') ? rawTableName : `Masa ${rawTableName}`)
                        : "Paket Servis";

                    var subText = isMasa ? "Mutfakta hazırlandı, servise hazır." : `Adres: ${order.deliveryAddress || 'Girilmedi'}`;

                    html += `
                        <div class="col-md-4 col-lg-3" id="waiter-card-${order.orderId}">
                            <div class="card h-100 border-0 shadow-sm rounded-4 p-3" style="border-left: 5px solid #4a154b !important;">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="fw-bold mb-0 text-dark"><i class="fa-solid ${icon} me-2" style="color: #4a154b;"></i>${title}</h6>
                                    <span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                </div>
                                <p class="text-muted small mb-3">${subText}</p>
                                <div class="pt-2 border-top mt-auto">
                                    <button class="btn btn-purple-main w-100 fw-bold py-2 rounded-3 text-white" style="background-color: #4a154b; border: none;" onclick="approveWaiterDelivery(${order.orderId})">
                                        <i class="fa-solid fa-circle-check me-2"></i>Teslim Aldım
                                    </button>
                                </div>
                            </div>
                        </div>`;
                });

                $grid.html(html);
            } else {
                $badge.text("0 Sipariş Hazır")
                    .removeClass("bg-warning text-dark")
                    .addClass("bg-success text-white");

                $grid.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an mutfaktan çıkan hazır sipariş bulunmuyor.</h5>
                    </div>`);
            }
        },
        error: function (xhr) {
            console.error("Garson Sipariş Çekme Hatası:", xhr);
        }
    });
}

function approveWaiterDelivery(orderId) {
    $.ajax({
        url: "/Order/ApproveOrderDelivery",
        type: "POST",
        data: { orderId: orderId },
        success: function (res) {
            if (res.success) {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Sipariş teslim alındı!',
                    showConfirmButton: false,
                    timer: 1500
                });

                closeToast("toast-order-" + orderId);
                loadWaiterReadyOrders();
            }
        }
    });
}

function showLeftToast(notif) {
    var toastId = "toast-order-" + notif.orderId;
    if ($("#" + toastId).length > 0) return;

    var html = `
        <div class="ready-toast p-3" id="${toastId}">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                    <i class="fa-solid fa-bell-concierge fs-4" style="color: #4a154b;"></i>
                    <div>
                        <h6 class="fw-bold mb-0 text-dark" style="font-size: 0.95rem;">${notif.title} Hazır!</h6>
                        <span class="text-muted extra-small" style="font-size: 0.75rem;">${notif.time}</span>
                    </div>
                </div>
                <button type="button" class="btn-close btn-close-sm" onclick="closeToast('${toastId}')"></button>
            </div>
            <p class="text-secondary small mb-2" style="font-size: 0.82rem;">${notif.subtitle}</p>
            <div class="d-flex justify-content-end gap-2">
                <button class="btn btn-sm text-white fw-bold py-1 px-3 rounded-pill" style="background-color: #4a154b; border: none;" onclick="approveWaiterDelivery(${notif.orderId})">
                    <i class="fa-solid fa-circle-check me-1"></i>Teslim Aldım
                </button>
            </div>
            <div class="toast-progress-bar mt-2" id="progress-${toastId}"></div>
        </div>`;

    $("#waiterToastContainer").append(html);

    var duration = 20000;
    var elapsed = 0;
    var intervalTime = 100;

    var timer = setInterval(function () {
        elapsed += intervalTime;
        var percentage = 100 - (elapsed / duration) * 100;
        $(`#progress-${toastId}`).css("width", percentage + "%");

        if (elapsed >= duration) {
            clearInterval(timer);
            closeToast(toastId);
        }
    }, intervalTime);
}

function closeToast(toastId) {
    $(`#${toastId}`).fadeOut(300, function () {
        $(this).remove();
    });
}