// Global AJAX Ayarı (JWT Token Otomatik Eklenir)
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
    setInterval(loadAdminPendingOrders, 10000); // 10 sn tedbir yenilemesi
    initAdminSignalR();
});

function initAdminSignalR() {
    if ($.connection && $.connection.orderHub) {
        var orderHubProxy = $.connection.orderHub;

        // Mutfak "Hazır" dediğinde yenile
        orderHubProxy.client.onOrderReady = function () {
            loadAdminPendingOrders();
        };

        // Garson "Teslim Aldım" dediğinde yenile
        orderHubProxy.client.onOrderDelivered = function () {
            loadAdminPendingOrders();
        };

        $.connection.hub.start().done(function () {
            console.log("Admin Sipariş Takip SignalR Başarılı.");
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
                $badge.text(`${res.data.length} Sipariş Bekliyor`)
                    .removeClass("bg-success text-white bg-warning text-dark")
                    .addClass("badge-purple-main");

                var html = "";

                $.each(res.data, function (i, order) {
                    var isMasa = order.orderType === "Masa";
                    var icon = isMasa ? "fa-chair" : "fa-motorcycle";

                    // Backend'den "Masa-1" veya "Masa 1" geliyorsa tekrar Masa eklemiyoruz
                    var rawTableName = order.tableName || '';
                    var title = isMasa
                        ? (rawTableName.toLowerCase().startsWith('masa') ? rawTableName : `Masa ${rawTableName}`)
                        : "Paket Servis";

                    var subText = isMasa ? "Garsonun teslim etmesi bekleniyor" : `Adres: ${order.deliveryAddress || 'Girilmedi'}`;

                    html += `
                        <div class="col-md-4 col-lg-3">
                            <div class="pending-order-card p-3 border">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="fw-bold mb-0 text-dark"><i class="fa-solid ${icon} me-2" style="color: #4a154b;"></i>${title}</h6>
                                    <span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                </div>
                                <p class="text-muted small mb-3">${subText}</p>
                                <div class="d-flex justify-content-between align-items-center pt-2 border-top mt-auto">
                                    <span class="fw-bold fs-6" style="color: #4a154b;">${parseFloat(order.totalAmount || 0).toFixed(2)} ₺</span>
                                    <span class="badge badge-purple-light"><i class="fa-solid fa-hourglass-half me-1"></i>Teslimat Bekliyor</span>
                                </div>
                            </div>
                        </div>`;
                });

                $container.html(html);
            } else {
                $badge.text("0 Sipariş Bekliyor")
                    .removeClass("badge-purple-main")
                    .addClass("bg-success text-white");

                $container.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an teslimat bekleyen hazır sipariş bulunmuyor.</h5>
                    </div>`);
            }
        }
    });
}