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
var currentActiveOrdersData = [];

$(document).ready(function () {
    console.log("Kitchen JS Yüklendi.");

    $(document).one("click keydown scroll mousemove", function () {
        getAudioContext();
    });

    initKitchenSignalR();
    loadKitchenOrders();

    setInterval(updateDelayedOrdersState, 15000);
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
            console.log("Yeni veya Acil sipariş düştü! Seçili zil çalınıyor...");
            playSelectedKitchenSound();
            loadKitchenOrders();
        };

        orderHubProxy.client.onOrderDelivered = function () {
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
                currentActiveOrdersData = res.data;

                $.each(res.data, function (i, order) {
                    var isMasa = order.orderType === "Masa";
                    var isPriority = order.isPriority === true;
                    var rawTableName = order.tableName || '';
                    var tableNameFormatted = rawTableName.toLowerCase().startsWith('masa') ? rawTableName : `Masa ${rawTableName}`;
                    var headerTitle = isMasa ? tableNameFormatted : "Paket Servis";
                    var subInfo = isMasa ? "" : `<div class="small text-muted mb-1 text-ellipsis-1"><i class="fa-solid fa-location-dot me-1"></i>${order.deliveryAddress || 'Adres Girilmedi'}</div>`;

                    var elapsedMinutes = calculateElapsedMinutes(order.orderDate);
                    var isOrderDelayed = elapsedMinutes >= 15;

                    var totalItemCount = 0;
                    $.each(order.items, function (j, item) {
                        totalItemCount += item.quantity;
                    });

                    var generalNoteHtml = order.orderNote
                        ? `<div class="kitchen-general-note-box text-ellipsis-1" title="Sipariş Notu: ${order.orderNote}"><i class="fa-solid fa-note-sticky me-1"></i>Not: "${order.orderNote}"</div>`
                        : '';

                    // ACİL / VIP VEYA GECİKME DURUMU
                    var cardClass = "";
                    if (isPriority) {
                        cardClass = "card-order-priority";
                    } else if (isOrderDelayed) {
                        cardClass = "card-order-delayed";
                    }

                    var badgeHtml = "";
                    if (isPriority) {
                        badgeHtml = `<span class="badge priority-flame-badge ms-1"><i class="fa-solid fa-fire me-1 text-danger"></i>ACİL / VIP</span>`;
                    } else if (isOrderDelayed) {
                        badgeHtml = `<span class="badge bg-danger text-white ms-1 delay-pulse-badge"><i class="fa-solid fa-triangle-exclamation me-1"></i>Gecikti (${elapsedMinutes} dk)</span>`;
                    } else {
                        badgeHtml = `<span class="badge bg-white text-dark elapsed-time-badge" data-time="${order.orderDate}"><i class="fa-regular fa-clock me-1"></i>${order.orderDate} (${elapsedMinutes} dk)</span>`;
                    }

                    var cardHtml = `
                        <div class="col-6 col-md-4 col-lg-3 kitchen-card-col mb-2" id="order-card-${order.orderId}" data-order-date="${order.orderDate}">
                            <div class="kitchen-fixed-card ${cardClass}" onclick="openKitchenOrderDetailModal(${order.orderId})">
                                <div class="kitchen-card-header d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0 fw-bold text-ellipsis-1">
                                        <i class="fa-solid ${isPriority ? 'fa-fire text-warning' : (isMasa ? 'fa-chair' : 'fa-motorcycle')} me-2"></i>${headerTitle}
                                    </h6>
                                    ${badgeHtml}
                                </div>
                                <div class="kitchen-card-body-fixed text-center">
                                    ${subInfo}
                                    ${generalNoteHtml}
                                    <div class="d-flex align-items-center justify-content-center gap-2 py-1">
                                        <span class="badge bg-light text-dark border px-3 py-1 fw-bold rounded-pill">
                                            <i class="fa-solid fa-layer-group me-1 text-purple-main"></i>${order.items.length} Kalem (${totalItemCount} Adet)
                                        </span>
                                    </div>
                                    <div class="mt-1">
                                        <span class="order-detail-link-text">Detaylar için tıklayınız</span>
                                    </div>
                                </div>
                                <div class="kitchen-card-footer">
                                    <button class="btn btn-success w-100 py-2 rounded-3 shadow-sm" onclick="event.stopPropagation(); markSingleOrderAllReady(${order.orderId})">
                                        <i class="fa-solid fa-check-double me-1"></i>Tümünü Hazırla
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
                        <h5>Şu an bekleyen mutfak siparişi bulunmuyor.</h5>
                    </div>`);
            }
        },
        error: function () {
            $("#kitchen-orders-grid").html('<div class="col-12 text-center text-danger py-4">Siparişler yüklenirken bir sunucu hatası oluştu.</div>');
        }
    });
}

function openKitchenOrderDetailModal(orderId) {
    var order = currentActiveOrdersData.find(x => x.orderId === orderId);
    if (!order) return;

    var isMasa = order.orderType === "Masa";
    var isPriority = order.isPriority === true;
    var rawTableName = order.tableName || '';
    var tableNameFormatted = rawTableName.toLowerCase().startsWith('masa') ? rawTableName : `Masa ${rawTableName}`;
    var headerTitle = isMasa ? tableNameFormatted : "Paket Servis";

    if (isPriority) {
        $("#modalKitchenHeader").addClass("kitchen-modal-header-priority");
        $("#modalKitchenTitle").html(`<i class="fa-solid fa-fire me-2 text-warning"></i>${headerTitle} Ürün Detayı (ACİL / VIP)`);
    } else {
        $("#modalKitchenHeader").removeClass("kitchen-modal-header-priority");
        $("#modalKitchenTitle").html(`<i class="fa-solid ${isMasa ? 'fa-chair' : 'fa-motorcycle'} me-2"></i>${headerTitle} Ürün Detayı`);
    }

    var subInfoHtml = `
        <div class="d-flex justify-content-between text-muted small pb-2 border-bottom">
            <span>Sipariş Saati: <b>${order.orderDate}</b></span>
            <span>Tür: <b>${order.orderType}</b></span>
        </div>`;

    if (!isMasa && order.deliveryAddress) {
        subInfoHtml += `<div class="small text-muted mt-2"><i class="fa-solid fa-location-dot me-1 text-danger"></i><b>Adres:</b> ${order.deliveryAddress}</div>`;
    }

    $("#modalKitchenSubInfo").html(subInfoHtml);

    if (order.orderNote) {
        $("#modalKitchenNoteBox").html(`
            <div class="alert alert-warning border-warning p-2 rounded-3 mt-2 mb-3 extra-small">
                <i class="fa-solid fa-note-sticky me-1"></i><b>Sipariş Notu:</b> "${order.orderNote}"
            </div>
        `);
    } else {
        $("#modalKitchenNoteBox").empty();
    }

    var elapsedMinutes = calculateElapsedMinutes(order.orderDate);
    var isOrderDelayed = elapsedMinutes >= 15;

    var itemsHtml = "";
    $.each(order.items, function (i, item) {
        var itemDelayedClass = isOrderDelayed ? "kitchen-modal-item-delayed" : "";
        var delayBadgeHtml = isOrderDelayed ? `<span class="badge bg-danger ms-2 extra-small"><i class="fa-solid fa-triangle-exclamation me-1"></i>Gecikti</span>` : "";

        itemsHtml += `
            <li class="list-group-item d-flex justify-content-between align-items-center py-2 px-3 rounded-3 mb-2 kitchen-modal-item ${itemDelayedClass}">
                <div class="d-flex align-items-center">
                    <span class="fw-bold text-dark fs-6">${item.productName}</span>
                    <span class="badge rounded-pill item-qty-badge-purple ms-2">x${item.quantity}</span>
                    ${delayBadgeHtml}
                </div>
                <div>
                    <div class="form-check form-check-inline m-0 d-flex align-items-center gap-1">
                        <input class="form-check-input chk-ready-item chk-custom-ready" type="checkbox" value="${item.orderDetailId}" id="chkItem-${item.orderDetailId}">
                        <label class="form-check-label fw-bold text-success small user-select-none" for="chkItem-${item.orderDetailId}" style="cursor:pointer;">Hazır</label>
                    </div>
                </div>
            </li>`;
    });

    $("#modalKitchenItemsList").html(itemsHtml);

    var actionBtnHtml = `
        <button type="button" class="btn btn-purple-kitchen flex-grow-1 py-2 fw-bold rounded-3 shadow-sm" onclick="sendSelectedItemsToWaiter(${order.orderId})">
            <i class="fa-solid fa-paper-plane me-1"></i>Seçilenleri Garsona Gönder
        </button>
        <button type="button" class="btn btn-success flex-grow-1 py-2 fw-bold rounded-3 shadow-sm" onclick="markSingleOrderAllReady(${order.orderId}); bootstrap.Modal.getInstance(document.getElementById('modalKitchenOrderDetail')).hide();">
            <i class="fa-solid fa-check-double me-1"></i>Tümünü Hazırla
        </button>
    `;
    $("#modalKitchenFooterAction").html(actionBtnHtml);

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalKitchenOrderDetail')).show();
}

function sendSelectedItemsToWaiter(orderId) {
    var selectedDetailIds = [];
    $("#modalKitchenItemsList .chk-ready-item:checked").each(function () {
        selectedDetailIds.push(parseInt($(this).val()));
    });

    if (selectedDetailIds.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Ürün Seçilmedi',
            text: 'Lütfen hazır olan en az bir ürünün kutucuğunu işaretleyiniz.',
            confirmButtonColor: '#4a154b'
        });
        return;
    }

    $.ajax({
        url: "/Kitchen/MarkItemsAsReady",
        type: "POST",
        traditional: true,
        data: {
            orderId: orderId,
            orderDetailIds: selectedDetailIds
        },
        success: function (res) {
            if (res.success) {
                if (orderHubProxy) {
                    orderHubProxy.server.sendOrderReadyNotification(
                        res.orderId,
                        res.tableName,
                        res.orderType,
                        res.address,
                        res.readyItemsSummary
                    );
                }

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Seçilen ürünler garsona iletildi!',
                    showConfirmButton: false,
                    timer: 1500
                });

                var modalEl = document.getElementById('modalKitchenOrderDetail');
                var modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                loadKitchenOrders();
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        },
        error: function () {
            Swal.fire("Hata", "İşlem sırasında sunucu hatası oluştu.", "error");
        }
    });
}

function markSingleOrderAllReady(orderId) {
    $.ajax({
        url: "/Kitchen/MarkOrderAsReady",
        type: "POST",
        data: { orderId: orderId },
        success: function (res) {
            if (res.success) {
                if (orderHubProxy) {
                    orderHubProxy.server.sendOrderReadyNotification(
                        res.orderId,
                        res.tableName,
                        res.orderType,
                        res.address,
                        res.readyItemsSummary
                    );
                }

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Tüm sipariş hazırlandı!',
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
    loadKitchenOrders();
}