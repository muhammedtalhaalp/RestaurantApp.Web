$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var waiterReadyNotifications = [];
var waiterAudioCtx = null;
var selectedWaiterSound = localStorage.getItem("WaiterSelectedSound") || "chime";

$(document).ready(function () {
    console.log("Garson Sipariş Takip JS Yüklendi.");

    $(document).one("click keydown scroll mousemove", function () {
        getWaiterAudioContext();
    });

    loadWaiterOrders();
    setInterval(loadWaiterOrders, 8000);
    initWaiterSignalR();
});

function getWaiterAudioContext() {
    if (!waiterAudioCtx) {
        waiterAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (waiterAudioCtx.state === "suspended") {
        waiterAudioCtx.resume();
    }
    return waiterAudioCtx;
}

function selectWaiterSound(soundKey, playTest) {
    selectedWaiterSound = soundKey;
    localStorage.setItem("KitchenSelectedSound", soundKey);

    if (playTest) {
        playSelectedWaiterSound(soundKey);
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

function playSelectedWaiterSound(soundKey) {
    try {
        var ctx = getWaiterAudioContext();
        var key = soundKey || selectedWaiterSound;

        if (key === "chime") {
            playWaiterTone(ctx, 900, 0, 0.3, 0.3);
            playWaiterTone(ctx, 1200, 0.2, 0.4, 0.4);
        } else if (key === "double-beep") {
            playWaiterTone(ctx, 800, 0, 0.15, 0.3);
            playWaiterTone(ctx, 800, 0.2, 0.15, 0.3);
        } else if (key === "melody") {
            playWaiterTone(ctx, 587, 0, 0.15, 0.2);
            playWaiterTone(ctx, 659, 0.15, 0.15, 0.2);
            playWaiterTone(ctx, 880, 0.3, 0.25, 0.3);
        } else if (key === "alarm") {
            playWaiterTone(ctx, 1300, 0, 0.2, 0.5, "sawtooth");
            playWaiterTone(ctx, 1300, 0.25, 0.2, 0.5, "sawtooth");
        } else if (key === "whistle") {
            playWaiterTone(ctx, 1500, 0, 0.4, 0.2, "triangle");
        } else if (key === "digital") {
            playWaiterTone(ctx, 1000, 0, 0.1, 0.2, "square");
            playWaiterTone(ctx, 1500, 0.12, 0.15, 0.2, "square");
        } else {
            playWaiterTone(ctx, 900, 0, 0.3, 0.3);
        }
    } catch (e) {
        console.error("Ses üretme hatası: ", e);
    }
}

function playWaiterTone(ctx, freq, startTime, duration, vol, type) {
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

function initWaiterSignalR() {
    if ($.connection && $.connection.orderHub) {
        var orderHubProxy = $.connection.orderHub;

        // Mutfaktan ürün hazır bildirimi geldiğinde çalışır
        orderHubProxy.client.onOrderReady = function (orderId, tableName, orderType, address, readyItemsSummary) {
            console.log("Mutfaktan ürün hazır bildirimi geldi!");
            playSelectedWaiterSound();

            var isMasa = orderType === "Masa";
            var formattedTableName = isMasa
                ? (tableName.toLowerCase().startsWith('masa') ? tableName : `Masa ${tableName}`)
                : "Paket Servis";

            var itemNotice = readyItemsSummary ? `<b>Hazır Çıkanlar:</b> ${readyItemsSummary}` : "Mutfakta ürün hazırlandı, servise hazır!";

            var notificationObj = {
                orderId: orderId,
                title: formattedTableName,
                subtitle: itemNotice,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            loadWaiterOrders();
            showLeftToast(notificationObj);
        };

        orderHubProxy.client.onOrderDelivered = function () {
            loadWaiterOrders();
        };

        $.connection.hub.start().done(function () {
            console.log("Garson SignalR Bağlantısı Başarılı.");
        });
    }
}

function loadWaiterOrders() {
    $.ajax({
        url: "/Admin/GetPendingDeliveryOrders",
        type: "GET",
        cache: false,
        success: function (res) {
            var $grid = $("#waiterReadyOrdersGrid");
            var $badge = $("#waiterOrdersBadge");

            if (res.success && res.data && res.data.length > 0) {
                waiterReadyNotifications = res.data;

                var readyCount = res.data.filter(o => o.status === "Hazır").length;
                $badge.text(`${res.data.length} Aktif Sipariş (${readyCount} Servise Hazır)`)
                    .removeClass("bg-success text-white")
                    .addClass("bg-warning text-dark");

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

                    var buttonHtml = isReady
                        ? `<button class="btn btn-success text-white w-100 fw-bold py-2 rounded-3 border-0 shadow-sm" onclick="event.stopPropagation(); approveWaiterDelivery(${order.orderId});">
                               <i class="fa-solid fa-circle-check me-2"></i>Hazırları Teslim Aldım
                           </button>`
                        : `<button class="btn btn-light w-100 fw-bold py-2 rounded-3 text-muted border opacity-75" onclick="event.stopPropagation(); openWaiterOrderDetailsModal(${order.orderId});">
                               <i class="fa-solid fa-eye me-2 text-info"></i>Sipariş Detayını Gör
                           </button>`;

                    var borderColor = isReady ? '#198754' : '#0dcaf0';
                    var pulseClass = isReady ? 'waiter-card-pulse' : '';

                    html += `
                        <div class="col-md-4 col-lg-3" id="waiter-card-${order.orderId}">
                            <div class="card h-100 border-0 shadow-sm rounded-4 p-3 cursor-pointer ${pulseClass}" style="border-left: 5px solid ${borderColor} !important;" onclick="openWaiterOrderDetailsModal(${order.orderId})">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="fw-bold mb-0 text-dark"><i class="fa-solid ${icon} me-2" style="color: #4a154b;"></i>${title}</h6>
                                    <span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>${order.orderDate}</span>
                                </div>
                                <p class="small mb-3">${subText}</p>
                                <div class="pt-2 border-top mt-auto">
                                    ${buttonHtml}
                                </div>
                            </div>
                        </div>`;
                });

                $grid.html(html);
            } else {
                $badge.text("0 Aktif Sipariş")
                    .removeClass("bg-warning text-dark")
                    .addClass("bg-success text-white");

                $grid.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an aktif takip edilen sipariş bulunmuyor.</h5>
                    </div>`);
            }
        },
        error: function (xhr) {
            console.error("Garson Sipariş Çekme Hatası:", xhr);
        }
    });
}

function openWaiterOrderDetailsModal(orderId) {
    $("#waiterTblOrderItemsBody").html(`
        <tr>
            <td colspan="6" class="text-center py-4 text-muted">
                <i class="fa-solid fa-spinner fa-spin me-2"></i>Ürünler yükleniyor...
            </td>
        </tr>
    `);

    $("#waiterModalFooterActions").empty();

    var modalEl = document.getElementById('waiterOrderDetailsModal');
    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();

    $.ajax({
        url: "/Admin/GetOrderDetails",
        type: "GET",
        data: { orderId: orderId },
        success: function (res) {
            if (res.success && res.data) {
                var d = res.data;

                $("#waiterModalOrderTitle").html(`<i class="fa-solid fa-receipt me-2"></i>${d.tableName} Detayı`);
                $("#waiterLblOrderTime").text(d.orderTime);
                $("#waiterLblOrderTotalAmount").text(parseFloat(d.totalAmount || 0).toFixed(2) + " ₺");

                var badgeClass = d.status === "Hazır" ? "bg-success text-white" : (d.status === "Servis Edildi" ? "bg-secondary text-white" : "bg-info text-dark");
                $("#waiterLblOrderStatusBadge").attr("class", `badge ${badgeClass}`).text(d.status);

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
                            ? `<button class="btn btn-sm btn-outline-danger rounded-circle border-0 py-1 px-2" onclick="deleteWaiterOrderItem(${item.orderDetailId}, ${d.orderId})" title="Ürünü İptal Et/Sil">
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

                $("#waiterTblOrderItemsBody").html(rowsHtml);

                var footerBtns = `<button type="button" class="btn btn-secondary rounded-3 fw-bold px-4" data-bs-dismiss="modal">Kapat</button>`;
                if (hasReadyItem) {
                    footerBtns += `
                        <button type="button" class="btn btn-success text-white fw-bold px-4 shadow-sm" onclick="approveWaiterDelivery(${d.orderId}); $('#waiterOrderDetailsModal').modal('hide');">
                            <i class="fa-solid fa-circle-check me-2"></i>Hazır Ürünleri Teslim Aldım
                        </button>`;
                }
                $("#waiterModalFooterActions").html(footerBtns);
            } else {
                Swal.fire("Hata", res.message || "Sipariş detayları çekilemedi.", "error");
            }
        },
        error: function () {
            Swal.fire("Hata", "Sunucudan veriler çekilirken hata oluştu.", "error");
        }
    });
}

function deleteWaiterOrderItem(orderDetailId, orderId) {
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
                    var modalEl = document.getElementById('waiterOrderDetailsModal');
                    var modalInstance = bootstrap.Modal.getInstance(modalEl);
                    if (modalInstance) modalInstance.hide();
                } else {
                    openWaiterOrderDetailsModal(orderId);
                }

                loadWaiterOrders();
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

function approveWaiterDelivery(orderId) {
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

                closeToast("toast-order-" + orderId);
                loadWaiterOrders();
            }
        }
    });
}

function showLeftToast(notif) {
    var toastId = "toast-order-" + notif.orderId;
    if ($("#" + toastId).length > 0) {
        $("#" + toastId).remove();
    }

    var html = `
        <div class="ready-toast p-3 shadow" id="${toastId}">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                    <i class="fa-solid fa-bell-concierge fs-4 text-success"></i>
                    <div>
                        <h6 class="fw-bold mb-0 text-dark" style="font-size: 0.95rem;">${notif.title} Ürünleri Hazır!</h6>
                        <span class="text-muted extra-small" style="font-size: 0.75rem;">${notif.time}</span>
                    </div>
                </div>
                <button type="button" class="btn-close btn-close-sm" onclick="closeToast('${toastId}')"></button>
            </div>
            <p class="text-secondary small mb-2" style="font-size: 0.82rem;">${notif.subtitle}</p>
            <div class="d-flex justify-content-end gap-2">
                <button class="btn btn-sm btn-success text-white fw-bold py-1 px-3 rounded-pill shadow-sm" onclick="approveWaiterDelivery(${notif.orderId})">
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