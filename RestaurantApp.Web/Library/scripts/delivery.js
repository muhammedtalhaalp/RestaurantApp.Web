$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var deliveryBoardData = null;
var deliveryChannelFilter = "all";
var deliveryAudioCtx = null;
var expandedItemOrders = new Set();

var CANCEL_REASONS = ["Müşteri iptal etti", "Müşteriye ulaşılamadı", "Adres bulunamadı", "Ürün tükendi", "Platform iptal etti", "Diğer"];

$(document).ready(function () {
    $(document).one("click keydown", function () { getDeliveryAudioContext(); });

    $("#txtDeliverySearch").on("input", renderDeliveryBoard);

    loadDeliveryBoard();
    initDeliverySignalR();

    // Bekleme sürelerinin güncel kalması ve olası kaçan bildirimler için
    setInterval(loadDeliveryBoard, 30000);
});

function escapeHtml(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
}

// ===================================================
// CANLI BİLDİRİMLER
// ===================================================
function initDeliverySignalR() {
    if (!($.connection && $.connection.orderHub)) return;

    var hub = $.connection.orderHub;

    hub.client.onNewOrderCreated = function () { loadDeliveryBoard(); };
    hub.client.onOrderDelivered = function () { loadDeliveryBoard(); };
    hub.client.onDeliveryUpdated = function () { loadDeliveryBoard(); };

    // Mutfak bir siparişi hazırladığında: paket siparişse sesli uyarı
    hub.client.onOrderReady = function (orderId, tableName, orderType) {
        if (orderType === "PaketServis") {
            playDeliveryChime();
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `#${orderId} paket siparişi hazır!`, showConfirmButton: false, timer: 2500 });
        }
        loadDeliveryBoard();
    };

    $.connection.hub.qs = { access_token: getAuthToken() };
    $.connection.hub.start()
        .done(function () { $("#deliveryLiveIndicator").addClass("is-live"); })
        .fail(function () { $("#deliveryLiveIndicator").removeClass("is-live"); });
    $.connection.hub.disconnected(function () { $("#deliveryLiveIndicator").removeClass("is-live"); });
}

function getDeliveryAudioContext() {
    if (!deliveryAudioCtx) deliveryAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (deliveryAudioCtx.state === "suspended") deliveryAudioCtx.resume();
    return deliveryAudioCtx;
}

function playDeliveryChime() {
    try {
        var ctx = getDeliveryAudioContext();
        [[784, 0], [1047, 0.18]].forEach(function (tone) {
            var osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.frequency.setValueAtTime(tone[0], ctx.currentTime + tone[1]);
            gain.gain.setValueAtTime(0.25, ctx.currentTime + tone[1]);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + tone[1] + 0.35);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime + tone[1]); osc.stop(ctx.currentTime + tone[1] + 0.35);
        });
    } catch (e) { /* ses çalınamazsa sessizce devam */ }
}

// ===================================================
// PANO VERİSİ
// ===================================================
function loadDeliveryBoard() {
    $.ajax({
        url: "/Delivery/GetBoard",
        type: "GET",
        cache: false,
        success: function (res) {
            if (!res || !res.success) {
                Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: (res && res.message) || "Paket siparişleri yüklenemedi.", showConfirmButton: false, timer: 2500 });
                return;
            }
            deliveryBoardData = res.data;
            renderSummary(res.data.summary);
            renderChannelFilter(res.data.active);
            renderDeliveryBoard();
            renderChannelBreakdown(res.data.summary);
            renderRecentOrders(res.data.recent);
        }
    });
}

function renderSummary(s) {
    $("#kpiActive").text(s.activeCount);
    $("#kpiOnTheWay").text(s.onTheWayCount);
    $("#kpiDelivered").text(s.deliveredTodayCount);
    $("#kpiCancelled").text(s.cancelledTodayCount > 0 ? `· ${s.cancelledTodayCount} iptal` : "");
    $("#kpiRevenue").text(formatMoney(s.revenueToday));
    $("#kpiRevenueSplit").text(`Online ${formatMoney(s.onlineToday)} · Nakit ${formatMoney(s.cashToday)} · Kart ${formatMoney(s.cardToday)}`);
}

function renderChannelFilter(active) {
    var counts = {};
    active.forEach(o => { counts[o.channel] = (counts[o.channel] || 0) + 1; });

    var html = `<button type="button" class="channel-filter ${deliveryChannelFilter === 'all' ? 'active' : ''}" onclick="setChannelFilter('all')">
                    <i class="fa-solid fa-layer-group"></i>Tümü <span class="filter-count">${active.length}</span>
                </button>`;

    Object.keys(DeliveryChannels.channels).forEach(function (key) {
        var c = DeliveryChannels.channels[key];
        html += `<button type="button" class="channel-filter ${deliveryChannelFilter === key ? 'active' : ''}" style="--channel-color:${c.color}" onclick="setChannelFilter('${key}')">
                    ${DeliveryChannels.iconHtml(key)}${c.label} <span class="filter-count">${counts[key] || 0}</span>
                 </button>`;
    });
    $("#channelFilterBar").html(html);
}

function setChannelFilter(key) {
    deliveryChannelFilter = key;
    renderChannelFilter(deliveryBoardData ? deliveryBoardData.active : []);
    renderDeliveryBoard();
}

function matchesSearch(order, query) {
    if (!query) return true;
    var haystack = [order.orderId, order.externalOrderNo, order.customerName, order.customerPhone, order.address]
        .filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
    return haystack.indexOf(query) !== -1;
}

function renderDeliveryBoard() {
    if (!deliveryBoardData) return;

    var query = ($("#txtDeliverySearch").val() || "").trim().toLocaleLowerCase("tr-TR");
    var visible = deliveryBoardData.active.filter(o =>
        (deliveryChannelFilter === "all" || o.channel === deliveryChannelFilter) && matchesSearch(o, query));

    var columns = {
        kitchen: { el: "#columnKitchen", count: "#countKitchen", empty: '<i class="fa-solid fa-mug-hot"></i>Mutfakta bekleyen paket siparişi yok' },
        ready: { el: "#columnReady", count: "#countReady", empty: '<i class="fa-solid fa-check-double"></i>Teslim bekleyen sipariş yok' },
        onTheWay: { el: "#columnOnTheWay", count: "#countOnTheWay", empty: '<i class="fa-solid fa-motorcycle"></i>Yolda sipariş yok' }
    };

    Object.keys(columns).forEach(function (stage) {
        var col = columns[stage];
        var orders = visible.filter(o => o.stage === stage);
        $(col.count).text(orders.length);
        $(col.el).html(orders.length ? orders.map(renderDeliveryCard).join("") : `<div class="board-empty">${col.empty}</div>`);
    });
}

function elapsedChip(minutes, label) {
    var cls = minutes >= 45 ? "is-late" : (minutes >= 25 ? "is-warning" : "");
    var text = minutes >= 1440
        ? `${Math.floor(minutes / 1440)} gün`
        : (minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${minutes} dk`);
    return `<span class="elapsed-chip ${cls}" title="${label}"><i class="fa-regular fa-clock me-1"></i>${text}</span>`;
}

function renderDeliveryCard(o) {
    var channel = DeliveryChannels.get(o.channel);
    var isPaid = o.dueAmount <= 0;

    var timeChip = o.stage === "onTheWay"
        ? elapsedChip(o.minutesOnTheWay || 0, `${o.outForDeliveryTime} saatinde yola çıktı`)
        : elapsedChip(o.minutesSinceCreated, `${o.createdDate} ${o.createdTime} saatinde alındı`);

    var customerHtml = (o.customerName || o.customerPhone)
        ? `<div class="mt-2">
               ${o.customerName ? `<div class="card-customer"><i class="fa-regular fa-user me-1 text-muted"></i>${escapeHtml(o.customerName)}</div>` : ''}
               ${o.customerPhone ? `<div class="card-phone"><i class="fa-solid fa-phone me-1"></i>${escapeHtml(o.customerPhone)}</div>` : ''}
           </div>` : '';

    var mapUrl = o.latitude && o.longitude
        ? `https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`
        : (o.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}` : null);

    var addressHtml = o.isPickup
        ? `<div class="card-address mt-2"><i class="fa-solid fa-store me-1"></i>Müşteri restorandan teslim alacak</div>`
        : `<div class="card-address mt-2"><i class="fa-solid fa-location-dot me-1 text-danger"></i>${escapeHtml(o.address || 'Adres yok')}</div>
           ${mapUrl ? `<a class="card-map-link" href="${mapUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-map-location-dot me-1"></i>Haritada aç</a>` : ''}`;

    var noteHtml = o.note ? `<div class="card-note mt-2"><i class="fa-solid fa-note-sticky me-1"></i>${escapeHtml(o.note)}</div>` : '';

    var progress = o.itemCount ? Math.round(o.readyItemCount / o.itemCount * 100) : 0;
    var isExpanded = expandedItemOrders.has(o.orderId);
    var itemsHtml = `
        <div class="mt-2">
            <div class="d-flex justify-content-between align-items-center">
                <button type="button" class="card-items-toggle" onclick="toggleCardItems(${o.orderId})">
                    <i class="fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} me-1"></i>${o.itemCount} ürün
                </button>
                ${o.stage === "kitchen" ? `<span class="small text-muted">${o.readyItemCount}/${o.itemCount} hazır</span>` : ''}
            </div>
            ${o.stage === "kitchen" ? `<div class="kitchen-progress mt-1"><div style="width:${progress}%"></div></div>` : ''}
            ${isExpanded ? `<ul class="card-items-list">${o.items.map(i => `
                <li><span>${i.quantity}× ${escapeHtml(i.name)}</span>
                    <span class="${i.isReady ? 'item-ready' : 'item-cooking'}"><i class="fa-solid ${i.isReady ? 'fa-check' : 'fa-fire-burner'}"></i></span></li>`).join("")}</ul>` : ''}
        </div>`;

    var changeHint = (!isPaid && o.changeFor)
        ? `<div class="change-hint mt-1"><i class="fa-solid fa-coins me-1"></i>${formatMoney(o.changeFor)} verecek → para üstü <b>${formatMoney(o.changeFor - o.dueAmount)}</b></div>`
        : '';

    var paymentHtml = isPaid
        ? `<div class="payment-box is-paid mt-2"><span><i class="fa-solid fa-circle-check me-1"></i>${escapeHtml(o.paymentPlanLabel || 'Ödendi')}</span><span class="payment-amount">${formatMoney(o.orderValue)}</span></div>`
        : `<div class="payment-box is-due mt-2"><span><i class="fa-solid ${o.paymentPlan === 'KapidaKart' ? 'fa-credit-card' : 'fa-money-bill-wave'} me-1"></i>${escapeHtml(o.paymentPlanLabel || 'Tahsil edilecek')}</span><span class="payment-amount">${formatMoney(o.dueAmount)}</span></div>${changeHint}`;

    var primaryAction = "";
    if (o.stage === "kitchen") {
        primaryAction = `<button class="btn btn-light border flex-grow-1" disabled><i class="fa-solid fa-fire-burner me-1"></i>Mutfakta hazırlanıyor</button>`;
    } else if (o.stage === "ready" && !o.isPickup) {
        primaryAction = `<button class="btn btn-stage-road flex-grow-1" onclick="markOutForDelivery(${o.orderId})"><i class="fa-solid fa-motorcycle me-1"></i>Yola Çıktı</button>`;
    } else {
        primaryAction = `<button class="btn btn-stage-ready flex-grow-1" onclick="openCompleteDialog(${o.orderId})"><i class="fa-solid fa-circle-check me-1"></i>${o.isPickup ? 'Müşteriye Teslim Et' : 'Teslim Edildi'}</button>`;
    }

    return `
        <div class="delivery-card ${o.isPriority ? 'is-priority' : ''}" style="--channel-color:${channel.color}">
            <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="min-w-0">
                    <div class="card-order-no">${o.isPriority ? '<i class="fa-solid fa-fire text-danger me-1" title="Acil"></i>' : ''}#${o.orderId}</div>
                    <div class="mt-1">${DeliveryChannels.badge(o.channel, o.externalOrderNo)}</div>
                </div>
                ${timeChip}
            </div>
            ${customerHtml}
            ${addressHtml}
            ${noteHtml}
            ${itemsHtml}
            ${paymentHtml}
            <div class="card-actions">
                ${primaryAction}
                <button class="btn btn-cancel-order" title="Siparişi iptal et" onclick="openCancelDialog(${o.orderId})"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>`;
}

function toggleCardItems(orderId) {
    if (expandedItemOrders.has(orderId)) expandedItemOrders.delete(orderId);
    else expandedItemOrders.add(orderId);
    renderDeliveryBoard();
}

function renderChannelBreakdown(s) {
    if (!s.byChannel.length) {
        $("#channelBreakdown").html('<div class="text-muted small text-center py-4">Bugün henüz paket siparişi yok.</div>');
        return;
    }
    var max = Math.max.apply(null, s.byChannel.map(c => c.amount)) || 1;
    $("#channelBreakdown").html(s.byChannel.map(function (c) {
        var meta = DeliveryChannels.get(c.channel);
        return `
            <div class="channel-row" style="--channel-color:${meta.color}">
                <div class="d-flex justify-content-between small">
                    <span class="fw-semibold channel-row-title" style="color:${meta.color}">${DeliveryChannels.iconHtml(c.channel)}<span class="text-dark">${meta.label}</span> <span class="text-muted fw-normal">· ${c.count} sipariş</span></span>
                    <span class="fw-bold">${formatMoney(c.amount)}</span>
                </div>
                <div class="channel-bar"><div style="width:${Math.max(4, c.amount / max * 100)}%"></div></div>
            </div>`;
    }).join(""));
}

function renderRecentOrders(list) {
    if (!list.length) {
        $("#recentOrdersBody").html('<tr><td colspan="5" class="text-center text-muted py-4">Bugün kapanan paket siparişi yok.</td></tr>');
        return;
    }
    $("#recentOrdersBody").html(list.map(o => `
        <tr class="${o.isCancelled ? 'is-cancelled' : ''}">
            <td>${escapeHtml(o.completedTime)}</td>
            <td><span class="fw-semibold">#${o.orderId}</span> ${DeliveryChannels.badge(o.channel, o.externalOrderNo)}</td>
            <td>${escapeHtml(o.customerName || '-')}</td>
            <td>${o.isCancelled
                ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle">İptal</span> <span class="small">${escapeHtml(o.cancelReason || '')}</span>`
                : escapeHtml(o.paymentType || '')}</td>
            <td class="text-end fw-semibold">${o.isCancelled ? `<s>${formatMoney(o.orderValue)}</s>` : formatMoney(o.orderValue)}</td>
        </tr>`).join(""));
}

function findActiveOrder(orderId) {
    return deliveryBoardData ? deliveryBoardData.active.find(o => o.orderId === orderId) : null;
}

// ===================================================
// İŞLEMLER
// ===================================================
function postDeliveryAction(url, data) {
    $.post(url, data, function (res) {
        if (res && res.success) {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, showConfirmButton: false, timer: 2000 });
            loadDeliveryBoard();
        } else {
            Swal.fire("İşlem yapılamadı", (res && res.message) || "Bilinmeyen hata.", "error");
            loadDeliveryBoard();
        }
    }).fail(function () {
        Swal.fire("Hata", "Sunucuya ulaşılamadı.", "error");
    });
}

function markOutForDelivery(orderId) {
    postDeliveryAction("/Delivery/MarkOutForDelivery", { orderId: orderId });
}

function openCompleteDialog(orderId) {
    var o = findActiveOrder(orderId);
    if (!o) return;

    if (o.dueAmount <= 0) {
        Swal.fire({
            title: `#${o.orderId} teslim edildi mi?`,
            html: `Ödeme <b>${escapeHtml(o.paymentPlanLabel)}</b> olarak alınmış. Sipariş kapatılacak.`,
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Evet, Teslim Edildi",
            cancelButtonText: "Vazgeç",
            confirmButtonColor: "#16a34a"
        }).then(r => { if (r.isConfirmed) postDeliveryAction("/Delivery/CompleteDelivery", { orderId: orderId }); });
        return;
    }

    var defaultMethod = o.paymentPlan === "KapidaKart" ? "Kart" : "Nakit";
    var changeHtml = o.changeFor
        ? `<div class="alert alert-warning py-2 small mt-3 mb-0"><i class="fa-solid fa-coins me-1"></i>Müşteri <b>${formatMoney(o.changeFor)}</b> verecek → para üstü <b>${formatMoney(o.changeFor - o.dueAmount)}</b></div>`
        : '';

    Swal.fire({
        title: o.isPickup ? "Gişede Tahsilat" : "Kapıda Tahsilat",
        html: `
            <div class="text-muted small mb-1">#${o.orderId} · ${escapeHtml(o.customerName || DeliveryChannels.get(o.channel).label)}</div>
            <div class="collect-amount mb-3">${formatMoney(o.dueAmount)}</div>
            <div class="pay-method-group">
                <div class="pay-method-option">
                    <input type="radio" name="collectMethod" id="collectCash" value="Nakit" ${defaultMethod === 'Nakit' ? 'checked' : ''}>
                    <label for="collectCash"><i class="fa-solid fa-money-bill-wave"></i>Nakit</label>
                </div>
                <div class="pay-method-option">
                    <input type="radio" name="collectMethod" id="collectCard" value="Kart" ${defaultMethod === 'Kart' ? 'checked' : ''}>
                    <label for="collectCard"><i class="fa-solid fa-credit-card"></i>Kart</label>
                </div>
            </div>
            ${changeHtml}`,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-check me-1"></i>Tahsil Et ve Kapat',
        cancelButtonText: "Vazgeç",
        confirmButtonColor: "#16a34a",
        preConfirm: () => $("input[name='collectMethod']:checked").val()
    }).then(r => {
        if (r.isConfirmed) postDeliveryAction("/Delivery/CompleteDelivery", { orderId: orderId, paymentMethod: r.value });
    });
}

function openCancelDialog(orderId) {
    var o = findActiveOrder(orderId);
    if (!o) return;

    var options = CANCEL_REASONS.map(r => `<option value="${r}">${r}</option>`).join("");
    var paidWarning = o.dueAmount <= 0 && o.isPlatform
        ? `<div class="alert alert-info py-2 small text-start mb-3"><i class="fa-solid fa-circle-info me-1"></i>Ödeme ${escapeHtml(o.channel ? DeliveryChannels.get(o.channel).label : 'platform')} üzerinden alınmış; iadeyi platform yapar.</div>`
        : '';

    Swal.fire({
        title: `#${o.orderId} iptal edilsin mi?`,
        html: `
            ${paidWarning}
            <select id="cancelReasonSelect" class="form-select mb-2">${options}</select>
            <textarea id="cancelReasonText" class="form-control d-none" rows="2" placeholder="İptal sebebini yazın..."></textarea>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Siparişi İptal Et",
        cancelButtonText: "Vazgeç",
        confirmButtonColor: "#dc2626",
        didOpen: () => {
            $("#cancelReasonSelect").on("change", function () {
                $("#cancelReasonText").toggleClass("d-none", this.value !== "Diğer");
            });
        },
        preConfirm: () => {
            var reason = $("#cancelReasonSelect").val();
            if (reason === "Diğer") {
                reason = ($("#cancelReasonText").val() || "").trim();
                if (!reason) { Swal.showValidationMessage("Lütfen iptal sebebini yazın."); return false; }
            }
            return reason;
        }
    }).then(r => {
        if (r.isConfirmed) postDeliveryAction("/Delivery/CancelOrder", { orderId: orderId, reason: r.value });
    });
}
