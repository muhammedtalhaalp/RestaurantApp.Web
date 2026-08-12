$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var orderHubProxy = null;
var audioCtx = null;
var selectedKitchenSound = localStorage.getItem("KitchenSelectedSound") || "chime";

$(document).ready(function () {
    console.log("Kitchen JS Yüklendi.");

    $(document).one("click keydown scroll mousemove", function () {
        getAudioContext();
    });

    initKitchenSignalR();
    loadKitchenOrders();

    setInterval(updateDelayedOrdersState, 30000);
    setInterval(loadKitchenOrders, 20000);
});

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    return audioCtx;
}

function selectKitchenSound(soundKey, playTest) {
    selectedKitchenSound = soundKey;
    localStorage.setItem("KitchenSelectedSound", soundKey);

    if (playTest) {
        playSelectedKitchenSound(soundKey);
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Bildirim sesi kaydedildi!',
            showConfirmButton: false,
            timer: 1200
        });
    }
}

function playSelectedKitchenSound(soundKey) {
    try {
        var ctx = getAudioContext();
        var key = soundKey || selectedKitchenSound;

        if (key === "chime") {
            playTone(ctx, 880, 0, 0.3, 0.3);
            playTone(ctx, 1046, 0.2, 0.4, 0.4);
        } else if (key === "double-beep") {
            playTone(ctx, 750, 0, 0.15, 0.3);
            playTone(ctx, 750, 0.2, 0.15, 0.3);
        } else if (key === "melody") {
            playTone(ctx, 523, 0, 0.15, 0.2);
            playTone(ctx, 659, 0.15, 0.15, 0.2);
            playTone(ctx, 783, 0.3, 0.25, 0.3);
        } else if (key === "alarm") {
            playTone(ctx, 1200, 0, 0.2, 0.5, "sawtooth");
            playTone(ctx, 1200, 0.25, 0.2, 0.5, "sawtooth");
        } else if (key === "whistle") {
            playTone(ctx, 1500, 0, 0.4, 0.2, "triangle");
        } else if (key === "digital") {
            playTone(ctx, 950, 0, 0.1, 0.2, "square");
            playTone(ctx, 1400, 0.12, 0.15, 0.2, "square");
        } else {
            playTone(ctx, 880, 0, 0.3, 0.3);
        }
    } catch (e) {
        console.error("Ses üretme hatası: ", e);
    }
}

function playTone(ctx, freq, startTime, duration, vol, type) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
    gain.gain.setValueAtTime(vol || 0.2, ctx.currentTime + startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration);
}

function initKitchenSignalR() {
    if ($.connection && $.connection.orderHub) {
        orderHubProxy = $.connection.orderHub;

        orderHubProxy.client.onNewOrderCreated = function () {
            console.log("Yeni sipariş düştü! Seçili zil çalınıyor...");
            playSelectedKitchenSound();
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
                    var rawTableName = order.tableName || '';
                    var tableNameFormatted = rawTableName.toLowerCase().startsWith('masa') ? rawTableName : `Masa ${rawTableName}`;
                    var headerTitle = isMasa ? tableNameFormatted : "Paket Servis";
                    var subInfo = isMasa ? "" : `<div class="small text-muted mb-2"><i class="fa-solid fa-location-dot me-1"></i>${order.deliveryAddress || 'Adres Girilmedi'}</div>`;

                    var elapsedMinutes = calculateElapsedMinutes(order.orderDate);
                    var isDelayed = elapsedMinutes >= 15;

                    var itemsHtml = "";
                    $.each(order.items, function (j, item) {
                        itemsHtml += `
                            <li class="list-group-item px-0 py-2 border-bottom-dashed">
                                <div class="d-flex justify-content-between align-items-center">
                                    <span class="fw-semibold text-dark">${item.productName}</span>
                                    <span class="badge rounded-pill fs-6">x${item.quantity}</span>
                                </div>
                            </li>`;
                    });

                    // BEYAZ ARKA PLAN VE MOR ÇERÇOVELİ GENEL NOT KUTUSU
                    var generalNoteHtml = order.orderNote
                        ? `<div class="kitchen-general-note-box"><i></i>Sipariş Notu: "${order.orderNote}"</div>`
                        : '';

                    var delayClass = isDelayed ? "card-order-delayed" : "";
                    var delayBadge = isDelayed
                        ? `<span class="badge bg-danger text-white ms-1 delay-pulse-badge"><i class="fa-solid fa-triangle-exclamation me-1"></i>Gecikti (${elapsedMinutes} dk)</span>`
                        : `<span class="badge bg-white text-dark elapsed-time-badge" data-time="${order.orderDate}"><i class="fa-regular fa-clock me-1"></i>${order.orderDate} (${elapsedMinutes} dk)</span>`;

                    var cardHtml = `
                        <div class="col-md-4 col-lg-3" id="order-card-${order.orderId}" data-order-date="${order.orderDate}">
                            <div class="card h-100 shadow-sm rounded-4 overflow-hidden ${delayClass}">
                                <div class="kitchen-card-header d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0 fw-bold"><i class="fa-solid ${isMasa ? 'fa-chair' : 'fa-motorcycle'} me-2"></i>${headerTitle}</h6>
                                    ${delayBadge}
                                </div>
                                <div class="card-body">
                                    ${subInfo}
                                    ${generalNoteHtml}
                                    <ul class="list-group list-group-flush mb-3">
                                        ${itemsHtml}
                                    </ul>
                                </div>
                                <div class="card-footer bg-transparent border-0 pb-3">
                                    <button class="btn btn-success w-100 py-2 rounded-3" onclick="markReady(${order.orderId}, '${order.tableName}', '${order.orderType}', '${order.deliveryAddress}')">
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

function calculateElapsedMinutes(timeStr) {
    if (!timeStr) return 0;
    var parts = timeStr.split(":");
    if (parts.length < 2) return 0;

    var now = new Date();
    var orderTime = new Date();
    orderTime.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);

    if (now < orderTime) {
        orderTime.setDate(orderTime.getDate() - 1);
    }

    var diffMs = now - orderTime;
    return Math.floor(diffMs / 60000);
}

function updateDelayedOrdersState() {
    $("#kitchen-orders-grid [id^='order-card-']").each(function () {
        var $cardCol = $(this);
        var orderDate = $cardCol.data("order-date");
        var elapsed = calculateElapsedMinutes(orderDate);

        if (elapsed >= 15) {
            var $card = $cardCol.find(".card");
            if (!$card.hasClass("card-order-delayed")) {
                $card.addClass("card-order-delayed");
                var $header = $card.find(".kitchen-card-header");
                $header.find(".elapsed-time-badge").remove();
                if ($header.find(".delay-pulse-badge").length === 0) {
                    $header.append(`<span class="badge bg-danger text-white ms-1 delay-pulse-badge"><i class="fa-solid fa-triangle-exclamation me-1"></i>Gecikti (${elapsed} dk)</span>`);
                }
            }
        }
    });
}

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
                url: "/Kitchen/MarkOrderAsReady",
                type: "POST",
                data: { orderId: orderId },
                success: function (res) {
                    if (res.success) {
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