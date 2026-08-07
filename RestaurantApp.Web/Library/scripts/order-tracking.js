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
                        ? "Mutfakta hazırlandı, garsonun teslim etmesi bekleniyor."
                        : "Mutfakta hazırlanıyor...";

                    var statusBadge = isReady
                        ? `<span class="badge bg-warning text-dark"><i class="fa-solid fa-hourglass-half me-1"></i>Teslimat Bekliyor</span>`
                        : `<span class="badge bg-info text-dark"><i class="fa-solid fa-spinner fa-spin me-1"></i>Hazırlanıyor</span>`;

                    var cardBorder = isReady ? "border-left: 5px solid #ffc107 !important;" : "border-left: 5px solid #0dcaf0 !important;";

                    // h-100 ve d-flex flex-column ile kart boyutları tamamen eşitlendi
                    html += `
                        <div class="col-md-4 col-lg-3 d-flex align-items-stretch">
                            <div class="pending-order-card p-3 border shadow-sm rounded-4 w-100 d-flex flex-column justify-content-between h-100" style="${cardBorder}">
                                <div>
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <h6 class="fw-bold mb-0 text-dark"><i class="fa-solid ${icon} me-2" style="color: #4a154b;"></i>${title}</h6>
                                        <span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                    </div>
                                    <p class="text-muted small mb-3">${subText}</p>
                                </div>
                                <div class="d-flex justify-content-between align-items-center pt-2 border-top mt-auto">
                                    <span class="fw-bold fs-6" style="color: #4a154b;">${parseFloat(order.totalAmount || 0).toFixed(2)} ₺</span>
                                    ${statusBadge}
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