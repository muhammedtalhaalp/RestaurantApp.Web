// KURYE EKRANI: yalnızca kuryeye atanmış paket siparişleri (CourierController)
// Ortak şablon (_Layout) içinde çalışır: getAuthToken(), Swal ve profil/çıkış menüsü şablondan gelir.

$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var courierData = null;
var knownOrderIds = null; // Yeni atanan siparişleri fark edip uyarmak için
var expandedOrders = new Set();
var courierAudioCtx = null;

$(document).ready(function () {
    $(document).one("click touchstart", function () { getCourierAudioContext(); });

    loadMyOrders();
    initCourierSignalR();
    setInterval(loadMyOrders, 20000);
});

function escapeHtml(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
}

function initCourierSignalR() {
    if (!($.connection && $.connection.orderHub)) return;
    var hub = $.connection.orderHub;
    hub.client.onDeliveryUpdated = function () { loadMyOrders(); };
    hub.client.onOrderReady = function () { loadMyOrders(); };
    hub.client.onOrderDelivered = function () { };

    $.connection.hub.qs = { access_token: getAuthToken() };
    $.connection.hub.start()
        .done(function () { $("#courierLiveIndicator").addClass("is-live"); })
        .fail(function () { $("#courierLiveIndicator").removeClass("is-live"); });
    $.connection.hub.disconnected(function () { $("#courierLiveIndicator").removeClass("is-live"); });
}

function getCourierAudioContext() {
    if (!courierAudioCtx) courierAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (courierAudioCtx.state === "suspended") courierAudioCtx.resume();
    return courierAudioCtx;
}

// Yeni sipariş atandığında: kısa zil + titreşim (destekleyen telefonlarda)
function notifyNewAssignment(count) {
    try {
        var ctx = getCourierAudioContext();
        [[660, 0], [880, 0.15], [1100, 0.3]].forEach(function (t) {
            var osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.frequency.setValueAtTime(t[0], ctx.currentTime + t[1]);
            gain.gain.setValueAtTime(0.3, ctx.currentTime + t[1]);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t[1] + 0.3);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime + t[1]); osc.stop(ctx.currentTime + t[1] + 0.3);
        });
    } catch (e) { /* ses çalınamazsa sessizce devam */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    Swal.fire({ toast: true, position: 'top', icon: 'info', title: count > 1 ? `${count} yeni teslimat atandı` : 'Yeni teslimat atandı', showConfirmButton: false, timer: 3000 });
}

function loadMyOrders() {
    $.ajax({
        url: "/Courier/GetMyOrders",
        type: "GET",
        cache: false,
        success: function (res) {
            if (!res || !res.success) {
                $("#activeOrders").html(`<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml((res && res.message) || "Teslimatlar yüklenemedi.")}</div>`);
                return;
            }
            var ids = new Set(res.data.active.map(o => o.orderId));
            var newIds = knownOrderIds ? [...ids].filter(id => !knownOrderIds.has(id)) : [];
            if (newIds.length) notifyNewAssignment(newIds.length);
            knownOrderIds = ids;

            courierData = res.data;
            renderCourierScreen(newIds);
        }
    });
}

function renderCourierScreen(newIds) {
    var s = courierData.summary;
    $("#sumActive").text(courierData.active.length);
    $("#sumDelivered").text(s.deliveredTodayCount);
    $("#sumCash").text(formatMoney(s.cashOnHand));

    $("#activeOrders").html(courierData.active.length
        ? courierData.active.map(o => renderOrderCard(o, newIds.indexOf(o.orderId) !== -1)).join("")
        : '<div class="empty-state"><i class="fa-solid fa-mug-hot"></i>Şu an size atanmış teslimat yok.<br>Yeni sipariş atanınca burada görünecek.</div>');

    $("#recentOrders").html(courierData.recent.length
        ? courierData.recent.map(r => `
            <div class="recent-item">
                <div>
                    <div class="fw-semibold">#${r.orderId} ${escapeHtml(r.customerName || '')}</div>
                    <div class="small text-muted">${escapeHtml(r.completedTime)} · ${escapeHtml(r.paymentType || '')}</div>
                </div>
                <div class="fw-bold">${formatMoney(r.orderValue)}</div>
            </div>`).join("")
        : '<div class="recent-item text-muted justify-content-center">Bugün henüz teslimat yok.</div>');
}

var STAGES = {
    kitchen: { color: "#d97706", icon: "fa-fire-burner", text: "Mutfakta hazırlanıyor" },
    ready: { color: "#16a34a", icon: "fa-bag-shopping", text: "Hazır · Restorandan alın" },
    onTheWay: { color: "#2563eb", icon: "fa-route", text: "Yolda" }
};

function minutesText(m) {
    if (m == null) return "";
    if (m >= 1440) return `${Math.floor(m / 1440)} gün`;
    return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`;
}

function renderOrderCard(o, isNew) {
    var stage = STAGES[o.stage];
    var elapsed = o.stage === "onTheWay" ? minutesText(o.minutesOnTheWay) : minutesText(o.minutesSinceCreated);

    var phoneDigits = (o.customerPhone || "").replace(/[^\d+]/g, "");
    var routeUrl = o.latitude && o.longitude
        ? `https://www.google.com/maps/dir/?api=1&destination=${o.latitude},${o.longitude}`
        : (o.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.address)}` : null);

    var actions = `
        <div class="action-row">
            ${phoneDigits ? `<a class="btn-round is-call" href="tel:${phoneDigits}"><i class="fa-solid fa-phone"></i>Ara</a>` : '<span class="btn-round text-muted"><i class="fa-solid fa-phone-slash"></i>Telefon yok</span>'}
            ${routeUrl ? `<a class="btn-round is-route" href="${routeUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-diamond-turn-right"></i>Yol Tarifi</a>` : '<span class="btn-round text-muted"><i class="fa-solid fa-map"></i>Konum yok</span>'}
        </div>`;

    var isExpanded = expandedOrders.has(o.orderId);
    var itemsHtml = `
        <button type="button" class="items-toggle" onclick="toggleItems(${o.orderId})">
            <i class="fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} me-1"></i>${o.itemCount} ürün
        </button>
        ${isExpanded ? `<ul class="items-list">${o.items.map(i => `<li>${i.quantity}× ${escapeHtml(i.name)}</li>`).join("")}</ul>` : ''}`;

    var payHtml = o.dueAmount > 0
        ? `<div class="pay-box is-due">
               <div class="small fw-semibold"><i class="fa-solid ${o.paymentPlan === 'KapidaKart' ? 'fa-credit-card' : 'fa-money-bill-wave'} me-1"></i>Tahsil edilecek · ${escapeHtml(o.paymentPlanLabel)}</div>
               <div class="pay-amount">${formatMoney(o.dueAmount)}</div>
               ${o.changeFor ? `<div class="pay-change"><i class="fa-solid fa-coins me-1"></i>Müşteri ${formatMoney(o.changeFor)} verecek → para üstü <b>${formatMoney(o.changeFor - o.dueAmount)}</b></div>` : ''}
           </div>`
        : `<div class="pay-box is-paid">
               <div class="fw-semibold"><i class="fa-solid fa-circle-check me-1"></i>Ödendi · Tahsilat yok</div>
               <div class="small">${escapeHtml(o.paymentPlanLabel)} · ${formatMoney(o.orderValue)}</div>
           </div>`;

    var mainAction = o.stage === "kitchen"
        ? `<button class="main-action" disabled><i class="fa-solid fa-hourglass-half me-2"></i>Mutfağın hazırlamasını bekleyin</button>`
        : (o.stage === "ready"
            ? `<button class="main-action is-road" onclick="courierOutForDelivery(${o.orderId})"><i class="fa-solid fa-motorcycle me-2"></i>Siparişi Aldım, Yola Çıktım</button>`
            : `<button class="main-action is-done" onclick="courierComplete(${o.orderId})"><i class="fa-solid fa-circle-check me-2"></i>Teslim Ettim</button>`);

    return `
        <div class="courier-card ${isNew ? 'is-new' : ''}">
            <div class="stage-banner" style="--stage-color:${stage.color}">
                <span><i class="fa-solid ${stage.icon} me-2"></i>${stage.text}</span>
                <span><i class="fa-regular fa-clock me-1"></i>${elapsed}</span>
            </div>
            <div class="courier-card-body">
                <div class="order-head">
                    <div class="order-no">${o.isPriority ? '<i class="fa-solid fa-fire text-danger me-1"></i>' : ''}#${o.orderId}</div>
                    ${DeliveryChannels.badge(o.channel, o.externalOrderNo)}
                </div>
                <div class="customer-row">
                    <div>
                        <div class="customer-name">${escapeHtml(o.customerName || 'Müşteri')}</div>
                        ${o.customerPhone ? `<div class="customer-phone">${escapeHtml(o.customerPhone)}</div>` : ''}
                    </div>
                </div>
                <div class="address-box"><i class="fa-solid fa-location-dot text-danger me-1"></i>${escapeHtml(o.address || 'Adres yok')}</div>
                ${actions}
                ${o.note ? `<div class="note-box"><i class="fa-solid fa-note-sticky me-1"></i>${escapeHtml(o.note)}</div>` : ''}
                ${itemsHtml}
                ${payHtml}
                ${mainAction}
            </div>
        </div>`;
}

function toggleItems(orderId) {
    if (expandedOrders.has(orderId)) expandedOrders.delete(orderId);
    else expandedOrders.add(orderId);
    renderCourierScreen([]);
}

function findMyOrder(orderId) {
    return courierData ? courierData.active.find(o => o.orderId === orderId) : null;
}

function postCourierAction(url, data) {
    $.post(url, data, function (res) {
        if (res && res.success) {
            Swal.fire({ toast: true, position: 'top', icon: 'success', title: res.message, showConfirmButton: false, timer: 2000 });
        } else {
            Swal.fire("İşlem yapılamadı", (res && res.message) || "Bilinmeyen hata.", "error");
        }
        loadMyOrders();
    }).fail(function () {
        Swal.fire("Bağlantı hatası", "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.", "error");
    });
}

function courierOutForDelivery(orderId) {
    postCourierAction("/Courier/MarkOutForDelivery", { orderId: orderId });
}

function courierComplete(orderId) {
    var o = findMyOrder(orderId);
    if (!o) return;

    if (o.dueAmount <= 0) {
        Swal.fire({
            title: `#${o.orderId} teslim edildi mi?`,
            text: "Ödeme alınmış, tahsilat yok.",
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Evet, Teslim Ettim",
            cancelButtonText: "Vazgeç",
            confirmButtonColor: "#16a34a"
        }).then(r => { if (r.isConfirmed) postCourierAction("/Courier/CompleteDelivery", { orderId: orderId }); });
        return;
    }

    var defaultMethod = o.paymentPlan === "KapidaKart" ? "Kart" : "Nakit";
    Swal.fire({
        title: "Tahsilat",
        html: `
            <div class="text-muted small mb-1">#${o.orderId} · ${escapeHtml(o.customerName || '')}</div>
            <div class="collect-amount mb-3">${formatMoney(o.dueAmount)}</div>
            <div class="pay-method-group">
                <div class="pay-method-option">
                    <input type="radio" name="courierCollect" id="courierCash" value="Nakit" ${defaultMethod === 'Nakit' ? 'checked' : ''}>
                    <label for="courierCash"><i class="fa-solid fa-money-bill-wave"></i>Nakit</label>
                </div>
                <div class="pay-method-option">
                    <input type="radio" name="courierCollect" id="courierCard" value="Kart" ${defaultMethod === 'Kart' ? 'checked' : ''}>
                    <label for="courierCard"><i class="fa-solid fa-credit-card"></i>Kart</label>
                </div>
            </div>
            ${o.changeFor ? `<div class="alert alert-warning py-2 small mt-3 mb-0">Para üstü: <b>${formatMoney(o.changeFor - o.dueAmount)}</b></div>` : ''}`,
        showCancelButton: true,
        confirmButtonText: "Tahsil Ettim, Teslim Edildi",
        cancelButtonText: "Vazgeç",
        confirmButtonColor: "#16a34a",
        preConfirm: () => $("input[name='courierCollect']:checked").val()
    }).then(r => {
        if (r.isConfirmed) postCourierAction("/Courier/CompleteDelivery", { orderId: orderId, paymentMethod: r.value });
    });
}
