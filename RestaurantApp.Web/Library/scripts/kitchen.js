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
var kitchenStockProductsData = [];

$(document).ready(function () {
    console.log("Kitchen JS Yüklendi.");

    $(document).one("click keydown scroll mousemove", function () {
        getAudioContext();
    });

    initKitchenSignalR();
    loadKitchenOrders();
    loadHygieneViolations();

    setInterval(updateDelayedOrdersState, 15000);
    setInterval(loadKitchenOrders, 20000);
});

function escapeHtml(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
}

// Paket siparişin kart başlığı: kanal + platform sipariş no (ör. "Yemeksepeti #48213")
function kitchenDeliveryTitle(order) {
    var title = order.channelLabel || "Paket Servis";
    return escapeHtml(order.externalOrderNo ? `${title} #${order.externalOrderNo}` : title);
}

// ===================================================
// HİJYEN KAMERASI İHLAL GEÇMİŞİ
// ===================================================
var hygieneRange = "today";

function openHygieneViolationsModal() {
    loadHygieneViolations();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalHygieneViolations')).show();
}

function selectHygieneRange(range, btnEl) {
    hygieneRange = range;
    $("#hygieneRangeButtons .btn").removeClass("active");
    $(btnEl).addClass("active");
    loadHygieneViolations();
}

// Listeyi ve bugünkü çözülmemiş ihlal rozetini yeniler
function loadHygieneViolations() {
    $.ajax({
        url: "/AiVision/GetViolations",
        type: "GET",
        data: { range: hygieneRange },
        cache: false,
        success: function (res) {
            if (!res || !res.success) return;

            var $badge = $("#hygieneUnresolvedBadge");
            if (res.unresolvedTodayCount > 0) {
                $badge.text(res.unresolvedTodayCount).show();
            } else {
                $badge.hide();
            }

            renderHygieneViolations(res.data || []);
        }
    });
}

// Liste yeni ihlal geldiğinde yeniden çizilir; seçimler kaybolmasın diye kimlikler burada tutulur
var selectedViolationIds = new Set();

function renderHygieneViolations(list) {
    var canDelete = window.canDeleteHygieneViolations === true;
    $(".hygiene-delete-only").toggle(canDelete);

    var $tbody = $("#hygieneViolationsTableBody").empty();
    var unresolved = list.filter(v => !v.isResolved).length;
    $("#hygieneSummaryText").text(`${list.length} ihlal, ${unresolved} çözülmemiş`);

    // Listede artık olmayan (silinmiş / aralık dışı) kayıtlar seçimden çıkarılır
    var visibleIds = new Set(list.map(v => v.id));
    selectedViolationIds.forEach(id => { if (!visibleIds.has(id)) selectedViolationIds.delete(id); });

    if (list.length === 0) {
        $tbody.html(`<tr><td colspan="${canDelete ? 5 : 4}" class="text-center py-4 text-muted"><i class="fa-solid fa-circle-check text-success me-1"></i>Bu aralıkta hijyen ihlali yok.</td></tr>`);
        updateHygieneSelectionUI();
        return;
    }

    $.each(list, function (i, v) {
        var checkboxHtml = canDelete
            ? `<td><input type="checkbox" class="form-check-input hygiene-check chk-hygiene-violation" value="${v.id}" ${selectedViolationIds.has(v.id) ? 'checked' : ''} onchange="toggleHygieneViolation(${v.id}, this.checked)"></td>`
            : '';

        var photoHtml = v.imageUrl
            ? `<img src="${encodeURI(v.imageUrl)}" alt="İhlal fotoğrafı" class="rounded-2 border" style="width: 96px; height: 64px; object-fit: cover; cursor: zoom-in;" onclick="showHygienePhoto(${v.id})">`
            : '<span class="text-muted small">Fotoğraf yok</span>';

        var statusHtml = v.isResolved
            ? '<span class="badge bg-success"><i class="fa-solid fa-check me-1"></i>Çözüldü</span>'
            : `<button class="btn btn-sm btn-outline-success fw-semibold rounded-3" onclick="markHygieneViolationResolved(${v.id})"><i class="fa-solid fa-check me-1"></i>Çözüldü</button>`;

        $tbody.append(`
            <tr class="${v.isResolved ? 'opacity-50' : ''}" data-violation-id="${v.id}" data-image-url="${v.imageUrl ? encodeURI(v.imageUrl) : ''}" data-violation-type="${escapeHtml(v.violationType)}" data-time="${escapeHtml(v.detectedDate + ' ' + v.detectedTime)}">
                ${checkboxHtml}
                <td>${photoHtml}</td>
                <td class="small"><div class="fw-semibold">${escapeHtml(v.detectedTime)}</div><div class="text-muted">${escapeHtml(v.detectedDate)}</div></td>
                <td class="fw-semibold ${v.isResolved ? '' : 'text-danger'}">${escapeHtml(v.violationType)}</td>
                <td class="text-center">${statusHtml}</td>
            </tr>`);
    });

    updateHygieneSelectionUI();
}

function toggleHygieneViolation(violationId, isChecked) {
    if (isChecked) selectedViolationIds.add(violationId);
    else selectedViolationIds.delete(violationId);
    updateHygieneSelectionUI();
}

function toggleAllHygieneViolations(isChecked) {
    $("#hygieneViolationsTableBody .chk-hygiene-violation").each(function () {
        this.checked = isChecked;
        toggleHygieneViolation(parseInt(this.value), isChecked);
    });
}

function updateHygieneSelectionUI() {
    var total = $("#hygieneViolationsTableBody .chk-hygiene-violation").length;
    var selected = selectedViolationIds.size;

    $("#hygieneSelectedCount").text(selected);
    $("#btnDeleteSelectedViolations").prop("disabled", selected === 0);

    var selectAll = document.getElementById("chkSelectAllViolations");
    if (selectAll) {
        selectAll.checked = total > 0 && selected === total;
        selectAll.indeterminate = selected > 0 && selected < total;
    }
}

function deleteSelectedHygieneViolations() {
    var ids = Array.from(selectedViolationIds);
    if (ids.length === 0) return;

    Swal.fire({
        title: `${ids.length} ihlal kaydı silinsin mi?`,
        text: "Kayıtlar ve fotoğrafları kalıcı olarak silinir, geri alınamaz.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "Evet, Sil",
        cancelButtonText: "Vazgeç"
    }).then((result) => {
        if (!result.isConfirmed) return;

        $.ajax({
            url: "/AiVision/DeleteViolations",
            type: "POST",
            traditional: true,
            data: { ids: ids },
            success: function (res) {
                if (res && res.success) {
                    selectedViolationIds.clear();
                    loadHygieneViolations();
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, showConfirmButton: false, timer: 1500 });
                } else {
                    Swal.fire("Hata", (res && res.message) || "Silme yetkiniz yok veya işlem yapılamadı.", "error");
                }
            },
            error: function () {
                Swal.fire("Hata", "Silme sırasında sunucu hatası oluştu.", "error");
            }
        });
    });
}

function showHygienePhoto(violationId) {
    var $row = $(`#hygieneViolationsTableBody tr[data-violation-id="${violationId}"]`);
    // attr() kaçışı geri çözer: başlık titleText ile düz metin olarak, zaman yeniden kaçışlanarak basılır
    Swal.fire({
        titleText: $row.attr("data-violation-type"),
        html: `<img src="${$row.attr("data-image-url")}" alt="İhlal fotoğrafı" class="img-fluid rounded-3 border"><div class="small text-muted mt-2">${escapeHtml($row.attr("data-time"))}</div>`,
        width: 760,
        confirmButtonText: 'Kapat',
        confirmButtonColor: '#4a154b'
    });
}

function markHygieneViolationResolved(violationId) {
    $.post("/AiVision/MarkViolationResolved", { id: violationId }, function (res) {
        if (res && res.success) {
            loadHygieneViolations();
        } else {
            Swal.fire("Hata", (res && res.message) || "İşlem yapılamadı.", "error");
        }
    });
}

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

        // ==========================================
        // YENİ EKLENEN: HİJYEN İHLALİ SİNYALİ DİNLEYİCİSİ
        // ==========================================
        // imageUrl: ihlal anındaki kamera karesi (/AiVision/GetViolationImage/..), fotoğraf yoksa null
        orderHubProxy.client.receiveHygieneAlert = function (violationType, timeStr, imageUrl) {
            console.warn("⚠️ HİJYEN İHLALİ TESPİT EDİLDİ: " + violationType);

            // Dikkat çekmek için "alarm" sesini çal
            playSelectedKitchenSound("alarm");

            // Geçmiş listesinin rozetini (ve açıksa listeyi) güncelle
            loadHygieneViolations();

            // İhlal türü kamera programından gelir; HTML olarak yorumlanmaması için kaçışlanır
            var safeViolationType = escapeHtml(violationType);
            var safeTimeStr = escapeHtml(timeStr);

            var imageHtml = imageUrl
                ? `<img src="${encodeURI(imageUrl)}" alt="İhlal fotoğrafı" class="img-fluid rounded-3 border mb-3" style="max-height: 320px;">`
                : '';

            // Ekranda büyük ve kırmızı bir uyarı patlat
            Swal.fire({
                icon: imageUrl ? undefined : 'error',
                title: '🚨 Mutfak Hijyen İhlali!',
                width: imageUrl ? 640 : undefined,
                html: `${imageHtml}<div>Kamerada kurallara uymayan personel tespit edildi!</div><br><b>İhlal Türü:</b> <span class="text-danger fw-bold fs-5">${safeViolationType}</span><br><small class="text-muted">Tespit Saati: ${safeTimeStr}</small>`,
                confirmButtonColor: '#d33',
                confirmButtonText: 'Anladım / Uyarıyı Kapat',
                timer: 10000, // 10 saniye sonra otomatik kapanır
                timerProgressBar: true
            });
        };
        // ==========================================

        // Token, bağlantının restoranın bildirim grubuna eklenmesi için gönderilir
        $.connection.hub.qs = { access_token: getAuthToken() };
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
                    var headerTitle = isMasa ? tableNameFormatted : kitchenDeliveryTitle(order);
                    var subInfo = isMasa ? "" : (order.channel === "GelAl"
                        ? `<div class="small text-muted mb-1 text-ellipsis-1"><i class="fa-solid fa-bag-shopping me-1"></i>Gel-Al (restorandan teslim)</div>`
                        : `<div class="small text-muted mb-1 text-ellipsis-1"><i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(order.deliveryAddress || 'Adres Girilmedi')}</div>`);

                    var elapsedMinutes = calculateElapsedMinutes(order.orderFullDate);
                    var isOrderDelayed = elapsedMinutes >= 15;

                    var totalItemCount = 0;
                    $.each(order.items, function (j, item) {
                        totalItemCount += item.quantity;
                    });

                    var generalNoteHtml = order.orderNote
                        ? `<div class="kitchen-general-note-box text-ellipsis-1" title="Sipariş Notu: ${order.orderNote}"><i class="fa-solid fa-note-sticky me-1"></i>Not: "${order.orderNote}"</div>`
                        : '';

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
    var headerTitle = isMasa ? tableNameFormatted : kitchenDeliveryTitle(order);

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
            <span>Tür: <b>${order.orderType === "PaketServis" ? escapeHtml(order.channelLabel || "Paket Servis") : "Masa"}</b></span>
        </div>`;

    if (!isMasa && order.deliveryAddress) {
        subInfoHtml += `<div class="small text-muted mt-2"><i class="fa-solid fa-location-dot me-1 text-danger"></i><b>Adres:</b> ${escapeHtml(order.deliveryAddress)}</div>`;
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

    var elapsedMinutes = calculateElapsedMinutes(order.orderFullDate);
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

// fullDateStr: sunucudan gelen "yyyy-MM-ddTHH:mm:ss" (yerel saat)
function calculateElapsedMinutes(fullDateStr) {
    if (!fullDateStr) return 0;

    var orderTime = new Date(fullDateStr);
    if (isNaN(orderTime.getTime())) return 0;

    var diffMs = new Date() - orderTime;
    return diffMs > 0 ? Math.floor(diffMs / 60000) : 0;
}

function updateDelayedOrdersState() {
    loadKitchenOrders();
}

// ===================================================
// 86 LIST & STOK YÖNETİMİ JS METOTLARI
// ===================================================
function openKitchenStockModal() {
    Swal.fire({ title: 'Stoklar Yükleniyor...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    $.ajax({
        url: "/Kitchen/GetKitchenProductsStock",
        type: "GET",
        cache: false,
        success: function (res) {
            Swal.close();
            if (res.success && res.data) {
                kitchenStockProductsData = res.data;
                renderKitchenStockTable(kitchenStockProductsData);
                bootstrap.Modal.getOrCreateInstance(document.getElementById('modalKitchenStock')).show();
            } else {
                Swal.fire("Hata", res.message || "Stok verileri çekilemedi.", "error");
            }
        },
        error: function () {
            Swal.close();
            Swal.fire("Hata", "Stok verileri alınırken sunucu hatası oluştu.", "error");
        }
    });
}

function renderKitchenStockTable(products) {
    var $tbody = $("#kitchenStockTableBody").empty();

    if (!products || products.length === 0) {
        $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted">Ürün bulunamadı.</td></tr>');
        return;
    }

    $.each(products, function (i, p) {
        var isAvail = p.isAvailable === true;
        var statusBadge = isAvail
            ? `<span class="badge bg-success stock-status-badge" id="stockBadge-${p.productId}"><i class="fa-solid fa-circle-check me-1"></i>Mevcut</span>`
            : `<span class="badge bg-danger stock-status-badge" id="stockBadge-${p.productId}"><i class="fa-solid fa-ban me-1"></i>Tükendi</span>`;

        var checkedAttr = isAvail ? 'checked' : '';

        var row = `
            <tr class="stock-row-item" data-name="${p.productName.toLowerCase()}">
                <td>
                    <img src="${p.imageUrl || '/Content/images/default-food.png'}" class="stock-product-img" onerror="this.src='/Content/images/default-food.png'" />
                </td>
                <td class="fw-bold text-dark">${p.productName}</td>
                <td><span class="badge bg-light text-dark border">${p.categoryName}</span></td>
                <td class="text-center">${statusBadge}</td>
                <td class="text-center">
                    <div class="form-check form-switch d-inline-block m-0">
                        <input class="form-check-input stock-switch" type="checkbox" role="switch" id="switchStock-${p.productId}" ${checkedAttr} onchange="toggleProductStock(${p.productId})">
                    </div>
                </td>
            </tr>
        `;
        $tbody.append(row);
    });
}

function toggleProductStock(productId) {
    $.ajax({
        url: "/Kitchen/ToggleProductStockAvailability",
        type: "POST",
        data: { productId: productId },
        success: function (res) {
            if (res.success) {
                var $badge = $(`#stockBadge-${productId}`);
                if (res.isAvailable) {
                    $badge.removeClass("bg-danger").addClass("bg-success").html('<i class="fa-solid fa-circle-check me-1"></i>Mevcut');
                } else {
                    $badge.removeClass("bg-success").addClass("bg-danger").html('<i class="fa-solid fa-ban me-1"></i>Tükendi');
                }

                // Global listedeki durumu da güncelle
                var item = kitchenStockProductsData.find(x => x.productId === productId);
                if (item) item.isAvailable = res.isAvailable;

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: res.isAvailable ? 'success' : 'warning',
                    title: res.message,
                    showConfirmButton: false,
                    timer: 1500
                });
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        },
        error: function () {
            Swal.fire("Hata", "Durum güncellenirken sunucu hatası oluştu.", "error");
        }
    });
}

function filterKitchenStockList() {
    var query = $("#txtKitchenSearchStock").val().toLowerCase().trim();
    $("#kitchenStockTableBody .stock-row-item").each(function () {
        var name = $(this).data("name") || "";
        if (name.includes(query)) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
}