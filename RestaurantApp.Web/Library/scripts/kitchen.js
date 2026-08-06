// Global AJAX Ayarı (JWT Token Otomatik Eklenir)
$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var orderHubProxy = null;

$(document).ready(function () {
    console.log("Kitchen JS Yüklendi.");

    // SignalR Bağlantısını Kurma
    initKitchenSignalR();

    // Siparişleri İlk Kez Yükleme
    loadKitchenOrders();

    // Her 15 saniyede bir tedbiren siparişleri tazele
    setInterval(loadKitchenOrders, 15000);
});

function initKitchenSignalR() {
    if ($.connection && $.connection.orderHub) {
        orderHubProxy = $.connection.orderHub;

        // Yeni sipariş geldiğinde mutfak ekranı otomatik yenilensin
        orderHubProxy.client.onNewOrderCreated = function () {
            loadKitchenOrders();
        };

        $.connection.hub.start().done(function () {
            console.log("Mutfak SignalR Bağlantısı Başarılı.");
        }).fail(function (err) {
            console.error("SignalR Bağlantı Hatası: ", err);
        });
    }
}

function loadKitchenOrders() {
    $.ajax({
        url: "/Kitchen/GetActiveOrders",
        type: "GET",
        cache: false,
        success: function (res) {
            var $grid = $("#kitchen-orders-grid");
            $grid.empty();

            if (res.success && res.data && res.data.length > 0) {
                $.each(res.data, function (i, order) {
                    var isMasa = order.orderType === "Masa";
                    var headerBadge = isMasa ? "bg-primary" : "bg-warning text-dark";
                    var headerTitle = isMasa ? `Masa ${order.tableName}` : "Paket Servis";
                    var subInfo = isMasa ? "" : `<div class="small text-muted mb-2"><i class="fa-solid fa-location-dot me-1"></i>${order.deliveryAddress || 'Adres Girilmedi'}</div>`;

                    var itemsHtml = "";
                    $.each(order.items, function (j, item) {
                        itemsHtml += `
                            <li class="list-group-item d-flex justify-content-between align-items-center px-0 py-2 border-bottom-dashed">
                                <span class="fw-semibold text-dark">${item.productName}</span>
                                <span class="badge bg-secondary rounded-pill fs-6">x${item.quantity}</span>
                            </li>`;
                    });

                    var cardHtml = `
                        <div class="col-md-4 col-lg-3" id="order-card-${order.orderId}">
                            <div class="card h-100 shadow-sm border-0 rounded-4 overflow-hidden">
                                <div class="card-header ${headerBadge} text-white d-flex justify-content-between align-items-center py-3">
                                    <h6 class="mb-0 fw-bold"><i class="fa-solid ${isMasa ? 'fa-chair' : 'fa-motorcycle'} me-2"></i>${headerTitle}</h6>
                                    <span class="badge bg-white text-dark"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                </div>
                                <div class="card-body">
                                    ${subInfo}
                                    <ul class="list-group list-group-flush mb-3">
                                        ${itemsHtml}
                                    </ul>
                                </div>
                                <div class="card-footer bg-transparent border-0 pb-3">
                                    <button class="btn btn-success w-100 fw-bold py-2 rounded-3" onclick="markReady(${order.orderId}, '${order.tableName}', '${order.orderType}', '${order.deliveryAddress}')">
                                        <i class="fa-solid fa-check-double me-2"></i>Sipariş Hazır
                                    </button>
                                </div>
                            </div>
                        </div>`;

                    $grid.append(cardHtml);
                });
            } else {
                $grid.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-utensils fs-1 mb-3 opacity-25"></i>
                        <h5>Şu an bekleyen sipariş bulunmuyor.</h5>
                    </div>`);
            }
        },
        error: function () {
            $("#kitchen-orders-grid").html('<div class="col-12 text-center text-danger py-4">Siparişler yüklenirken bir sunucu hatası oluştu.</div>');
        }
    });
}

// "Sipariş Hazır" Butonuna Basıldığında Çalışacak Metot
function markReady(orderId, tableName, orderType, address) {
    Swal.fire({
        title: 'Sipariş Hazır mı?',
        text: "Sipariş hazırlandı olarak işaretlenecek ve garsona bildirim gönderilecek.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#198754',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Evet, Hazır!',
        cancelButtonText: 'Vazgeç'
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: "/Order/MarkOrderAsReady",
                type: "POST",
                data: { orderId: orderId },
                success: function (res) {
                    if (res.success) {
                        // SignalR üzerinden Garsonlara bildirim tetikle
                        if (orderHubProxy) {
                            orderHubProxy.server.sendOrderReadyNotification(orderId, tableName, orderType, address);
                        }

                        Swal.fire({
                            toast: true,
                            position: 'top-end',
                            icon: 'success',
                            title: 'Garsona bildirim gönderildi!',
                            showConfirmButton: false,
                            timer: 1500
                        });

                        // Ekranda hazırlanan kartı kaldır
                        $(`#order-card-${orderId}`).fadeOut(300, function () {
                            $(this).remove();
                            if ($("#kitchen-orders-grid").children().length === 0) {
                                loadKitchenOrders();
                            }
                        });
                    } else {
                        Swal.fire("Hata", res.message, "error");
                    }
                },
                error: function () {
                    Swal.fire("Hata", "İşlem sırasında bir hata oluştu.", "error");
                }
            });
        }
    });
}