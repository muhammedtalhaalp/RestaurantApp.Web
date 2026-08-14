$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var currentTableTotal = 0;
var rawTableItems = [];
var selectedItemsForPay = {};
var currentPayTargetAmount = 0;
var allTargetTablesData = [];

$(document).ready(function () {
    console.log("Masa Kontrol JS Yüklendi.");
    loadOccupiedTables();

    // Dağılım inputları değiştikçe
    $(document).on("input", ".pay-input", function () {
        calculateRemainingDistribution();
    });

    // Serbest Tutar Inputu Değiştikçe
    $(document).on("input", "#txtCustomPayAmount", function () {
        var customVal = parseFloat($(this).val()) || 0;
        if (customVal > currentTableTotal) {
            customVal = currentTableTotal;
            $(this).val(customVal.toFixed(2));
        }
        currentPayTargetAmount = customVal;
        updatePayTargetDisplay();
    });

    // Sekmeler Arası Geçişte Sıfırlama
    $('#tabPayByItems').on('shown.bs.tab', function () {
        recalcItemsSelectionTotal();
    });

    $('#tabPayByAmount').on('shown.bs.tab', function () {
        var customVal = parseFloat($("#txtCustomPayAmount").val()) || 0;
        if (customVal === 0) {
            $("#txtCustomPayAmount").val(currentTableTotal.toFixed(2));
            customVal = currentTableTotal;
        }
        currentPayTargetAmount = customVal;
        updatePayTargetDisplay();
    });
});

// DOLU MASALARI LİSTELEME
function loadOccupiedTables() {
    $.ajax({
        url: "/Table/GetOccupiedTables",
        type: "GET",
        cache: false,
        success: function (res) {
            var $container = $("#occupiedTablesContainer");
            var $badge = $("#occupiedCountBadge");

            if (res.success && res.data && res.data.length > 0) {
                $badge.text(`${res.data.length} Dolu Masa`);
                var html = "";

                $.each(res.data, function (i, table) {
                    var rawName = table.tableName || '';
                    var tableNameFormatted = rawName.toLowerCase().startsWith('masa') ? rawName : `Masa ${rawName}`;
                    var totalAmountFormatted = parseFloat(table.totalAmount || 0).toFixed(2);
                    var isPaid = table.isPaid || false;

                    var paidTagHtml = isPaid ? `<span class="badge-paid-tag ms-2"><i class="fa-solid fa-check-double me-1"></i>(Ödendi)</span>` : '';

                    html += `
                        <div class="col-md-4 col-lg-3" id="table-card-${table.tableId}">
                            <div class="card h-100 border-0 p-3 table-card-occupied shadow-sm d-flex flex-column">
                                
                                <div class="d-flex justify-content-between align-items-center mb-1">
                                    <h6 class="fw-bold mb-0 text-dark">
                                        <i class="fa-solid fa-chair me-2 text-danger"></i>${tableNameFormatted}
                                    </h6>
                                    <span class="badge bg-danger text-white px-2 py-1 rounded-2">Dolu</span>
                                </div>
                                <p class="text-muted small mb-3"><i class="fa-solid fa-layer-group me-1"></i>Bölüm: ${table.section || 'Salon'}</p>
                                
                                <div class="fs-5 fw-bold mb-3 style-purple-text d-flex align-items-center flex-wrap">
                                    Adisyon Tutarı: ${totalAmountFormatted} ₺ ${paidTagHtml}
                                </div>

                                <div class="mt-auto">
                                    <div class="row g-2 mb-2">
                                        <div class="col-6">
                                            <button class="btn btn-outline-purple w-100" onclick="openTransferModal(${table.tableId}, '${tableNameFormatted}')">
                                                <i class="fa-solid fa-arrow-right-long me-1"></i>Taşı
                                            </button>
                                        </div>
                                        <div class="col-6">
                                            <button class="btn btn-outline-purple w-100" onclick="openMergeModal(${table.tableId}, '${tableNameFormatted}')">
                                                <i class="fa-solid fa-code-merge me-1"></i>Birleştir
                                            </button>
                                        </div>
                                    </div>

                                    <div class="pt-2 border-top">
                                        <button class="btn btn-success w-100 py-2 fw-bold" onclick="openWaiterCheckoutModal(${table.tableId}, '${tableNameFormatted}', ${isPaid})">
                                            <i class="fa-solid fa-receipt me-2"></i>Adisyon & İade Detayı
                                        </button>
                                    </div>
                                </div>

                            </div>
                        </div>`;
                });

                $container.html(html);
            } else {
                $badge.text("0 Dolu Masa");
                $container.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an dolu olan masa bulunmamaktadır. Tüm masalar boş!</h5>
                    </div>`);
            }
        },
        error: function (xhr) {
            console.error("Dolu Masalar Çekilemedi:", xhr);
        }
    });
}

// ADİSYON DETAY MODALINI AÇMA
function openWaiterCheckoutModal(tableId, tableName, isPaid) {
    $("#waiterCheckoutTableId").val(tableId);
    $("#waiterIsPaidState").val(isPaid ? "true" : "false");
    $("#waiterCheckoutModalTitle").html(`<i class="fa-solid fa-receipt me-2" style="color: #4a154b;"></i>${tableName} - Adisyon & İade Detayı`);
    cancelWaiterReturnInput();

    if (isPaid) {
        $("#btnOpenPaymentModal").addClass("d-none");
        $("#btnVacateTableAction").removeClass("d-none");
        $("#waiterModalPaidStatusBadge").removeClass("d-none");
    } else {
        $("#btnOpenPaymentModal").removeClass("d-none");
        $("#btnVacateTableAction").addClass("d-none");
        $("#waiterModalPaidStatusBadge").addClass("d-none");
    }

    Swal.fire({ title: 'Adisyon Yükleniyor...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    $.ajax({
        url: "/Admin/GetActiveOrderByTableId",
        type: "GET",
        data: { tableId: tableId },
        success: function (res) {
            Swal.close();
            if (res.success && res.data) {
                rawTableItems = res.data;
                var remainingTotal = res.remainingTotal !== undefined ? res.remainingTotal : undefined;
                renderWaiterCheckoutItems(res.data, isPaid, remainingTotal);
                bootstrap.Modal.getOrCreateInstance(document.getElementById('waiterTableCheckoutModal')).show();
            } else {
                Swal.fire("Hata", res.message || "Adisyon detayları çekilemedi.", "error");
            }
        },
        error: function () {
            Swal.close();
            Swal.fire("Hata", "Adisyon çekilirken sunucu hatası oluştu.", "error");
        }
    });
}

function renderWaiterCheckoutItems(items, isPaid, remainingTotal) {
    var $tbody = $("#waiterCheckoutItemsBody");
    $tbody.empty();

    var calculatedItemsSum = 0;

    if (!items || items.length === 0) {
        $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted">Adisyonda ürün bulunamadı.</td></tr>');
        $("#waiterCheckoutGrandTotal").text("0.00 ₺");
        currentTableTotal = 0;
        return;
    }

    $.each(items, function (i, item) {
        var isReturned = item.isReturned || false;
        var lineTotal = item.unitPrice * item.quantity;

        if (!isReturned) {
            calculatedItemsSum += lineTotal;
        }

        var returnBtnHtml = "";
        if (isReturned) {
            returnBtnHtml = `<span class="badge bg-secondary opacity-75"><i class="fa-solid fa-rotate-left me-1"></i>İade Edildi</span>`;
        } else if (isPaid) {
            returnBtnHtml = `<span class="badge bg-light text-muted border">Ödeme Alındı</span>`;
        } else {
            returnBtnHtml = `<button class="btn btn-sm btn-outline-danger fw-bold rounded-3 px-2 py-1 btn-waiter-return-product" data-detailid="${item.orderDetailId}" data-name="${item.productName}"><i class="fa-solid fa-rotate-left me-1"></i>İade Et</button>`;
        }

        var rowStyle = isReturned ? 'style="opacity:0.5; text-decoration: line-through; background-color:#f8fafc;"' : '';

        var row = `
            <tr ${rowStyle}>
                <td class="fw-semibold text-dark">${item.productName} ${isReturned ? `<br><small class="text-danger fw-normal" style="text-decoration:none;">(İade Nedeni: ${item.returnReason})</small>` : ''}</td>
                <td class="text-center fw-bold">${item.quantity}</td>
                <td class="text-end">${parseFloat(item.unitPrice).toFixed(2)} ₺</td>
                <td class="text-end fw-bold text-dark">${lineTotal.toFixed(2)} ₺</td>
                <td class="text-center">${returnBtnHtml}</td>
            </tr>`;

        $tbody.append(row);
    });

    // Sunucudan gelen net kalan borç varsa onu kullan, yoksa hesaplanan toplamı al
    currentTableTotal = (remainingTotal !== undefined) ? remainingTotal : calculatedItemsSum;
    $("#waiterCheckoutGrandTotal").text(currentTableTotal.toFixed(2) + " ₺");
}

// 2. GELİŞMİŞ PARÇALI ÖDEME MODALINI HAZIRLAMA VE AÇMA
$(document).on("click", "#btnOpenPaymentModal", function () {
    bootstrap.Modal.getInstance(document.getElementById('waiterTableCheckoutModal')).hide();

    // Ürün seçim listesini doldur
    selectedItemsForPay = {};
    var $itemsTbody = $("#splitPayItemsTableBody").empty();

    var activeItems = rawTableItems.filter(x => !x.isReturned);
    $.each(activeItems, function (i, item) {
        var row = `
            <tr>
                <td class="fw-bold text-dark">${item.productName}</td>
                <td class="text-center fw-semibold">${item.quantity}</td>
                <td class="text-end">${parseFloat(item.unitPrice).toFixed(2)} ₺</td>
                <td class="text-center">
                    <div class="d-flex align-items-center justify-content-center gap-1">
                        <button type="button" class="btn btn-sm btn-outline-secondary qty-btn" onclick="changeItemPayQty(${item.orderDetailId}, -1, ${item.quantity}, ${item.unitPrice})">-</button>
                        <span id="lblPayQty-${item.orderDetailId}" class="fw-bold px-2">0</span>
                        <button type="button" class="btn btn-sm btn-outline-purple qty-btn" onclick="changeItemPayQty(${item.orderDetailId}, 1, ${item.quantity}, ${item.unitPrice})">+</button>
                    </div>
                </td>
            </tr>
        `;
        $itemsTbody.append(row);
    });

    // Serbest tutar sekmesini hazırla
    $("#lblFreePayTableTotal").text(currentTableTotal.toFixed(2) + " ₺");
    $("#txtCustomPayAmount").val(currentTableTotal.toFixed(2));

    // İlk açılışta ürünler sekmesi aktif
    bootstrap.Tab.getOrCreateInstance(document.getElementById('tabPayByItems')).show();
    recalcItemsSelectionTotal();

    bootstrap.Modal.getOrCreateInstance(document.getElementById('splitPaymentModal')).show();
});

// Ürün adedi artır / azalt
function changeItemPayQty(detailId, delta, maxQty, unitPrice) {
    if (!selectedItemsForPay[detailId]) {
        selectedItemsForPay[detailId] = { quantity: 0, unitPrice: unitPrice };
    }

    var currentQty = selectedItemsForPay[detailId].quantity;
    var newQty = currentQty + delta;

    if (newQty < 0) newQty = 0;
    if (newQty > maxQty) newQty = maxQty;

    selectedItemsForPay[detailId].quantity = newQty;
    $(`#lblPayQty-${detailId}`).text(newQty);

    recalcItemsSelectionTotal();
}

function recalcItemsSelectionTotal() {
    var total = 0;
    $.each(selectedItemsForPay, function (id, obj) {
        total += (obj.quantity * obj.unitPrice);
    });

    currentPayTargetAmount = total;
    updatePayTargetDisplay();
}

function updatePayTargetDisplay() {
    $("#lblTargetPayAmount").text(currentPayTargetAmount.toFixed(2) + " ₺");

    // Varsayılan olarak tüm tutarı nakite ata
    $("#numCashPay").val(currentPayTargetAmount.toFixed(2));
    $("#numCreditPay").val("");
    $("#numMealPay").val("");

    calculateRemainingDistribution();
}

function calculateRemainingDistribution() {
    var cash = parseFloat($("#numCashPay").val()) || 0;
    var credit = parseFloat($("#numCreditPay").val()) || 0;
    var meal = parseFloat($("#numMealPay").val()) || 0;

    var sum = cash + credit + meal;
    var diff = currentPayTargetAmount - sum;

    var $lbl = $("#lblPayRemaining");
    $lbl.text(diff.toFixed(2) + " ₺");

    if (currentPayTargetAmount > 0 && Math.abs(diff) < 0.01) {
        $lbl.removeClass("text-danger").addClass("text-success").text("Ödeme Dağılımı Doğrulandı (0.00 ₺)");
        $("#btnFinalizeSplitPayment").prop("disabled", false);
    } else {
        $lbl.removeClass("text-success").addClass("text-danger");
        $("#btnFinalizeSplitPayment").prop("disabled", true);
    }
}

// TAHSİLATI SUNUCUYA GÖNDERME
$(document).on("click", "#btnFinalizeSplitPayment", function () {
    var tableId = $("#waiterCheckoutTableId").val();
    var cash = parseFloat($("#numCashPay").val()) || 0;
    var credit = parseFloat($("#numCreditPay").val()) || 0;
    var meal = parseFloat($("#numMealPay").val()) || 0;

    var paymentType = "Parçalı Ödeme";
    if (cash === currentPayTargetAmount) paymentType = "Nakit";
    else if (credit === currentPayTargetAmount) paymentType = "Kredi Kartı";
    else if (meal === currentPayTargetAmount) paymentType = "Yemek Kartı";

    var isItemsMode = $("#panePayByItems").hasClass("active");

    if (isItemsMode) {
        var itemsList = [];
        $.each(selectedItemsForPay, function (id, obj) {
            if (obj.quantity > 0) {
                itemsList.push({ OrderDetailId: parseInt(id), Quantity: obj.quantity });
            }
        });

        if (itemsList.length === 0) {
            Swal.fire("Uyarı", "Lütfen ödenecek en az bir ürün seçiniz.", "warning");
            return;
        }

        $.ajax({
            url: "/Table/PayByItems",
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({
                tableId: tableId,
                paidItems: itemsList,
                cashAmount: cash,
                creditCardAmount: credit,
                mealCardAmount: meal,
                paymentType: paymentType
            }),
            success: function (res) {
                handlePaymentResult(res);
            }
        });
    } else {
        $.post("/Table/PayByAmount", {
            tableId: tableId,
            paidAmount: currentPayTargetAmount,
            cashAmount: cash,
            creditCardAmount: credit,
            mealCardAmount: meal,
            paymentType: paymentType
        }, function (res) {
            handlePaymentResult(res);
        });
    }
});

function handlePaymentResult(res) {
    if (res.success) {
        bootstrap.Modal.getInstance(document.getElementById('splitPaymentModal')).hide();
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: res.message,
            showConfirmButton: false,
            timer: 1500
        });
        loadOccupiedTables();
    } else {
        Swal.fire("Hata", res.message, "error");
    }
}

// MASAYI BOŞALTMA İŞLEMİ
$(document).on("click", "#btnVacateTableAction", function () {
    var tableId = $("#waiterCheckoutTableId").val();

    Swal.fire({
        title: "Masa Boşaltılsın mı?",
        text: "Masa fiziken temizlenecek ve yeni müşteriler için BOŞ durumuna getirilecektir.",
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#198754",
        cancelButtonColor: "#6c757d",
        confirmButtonText: "Evet, Masayı Boşalt",
        cancelButtonText: "İptal"
    }).then((result) => {
        if (result.isConfirmed) {
            $.post("/Table/VacateTable", { tableId: tableId }, function (res) {
                if (res.success) {
                    bootstrap.Modal.getInstance(document.getElementById('waiterTableCheckoutModal')).hide();
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Masa başarıyla boşaltıldı!', showConfirmButton: false, timer: 1500 });
                    loadOccupiedTables();
                } else {
                    Swal.fire("Hata", res.message, "error");
                }
            });
        }
    });
});

// İADE İŞLEMLERİ
$(document).on("click", ".btn-waiter-return-product", function () {
    $("#selectedWaiterReturnDetailId").val($(this).data("detailid"));
    $("#lblWaiterReturnProductName").text($(this).data("name"));
    $("#txtWaiterReturnReasonInput").val("");
    $("#waiterReturnReasonContainer").removeClass("d-none");
});

window.cancelWaiterReturnInput = function () {
    $("#waiterReturnReasonContainer").addClass("d-none");
};

$(document).on("click", "#btnConfirmWaiterReturnAction", function () {
    var detailId = $("#selectedWaiterReturnDetailId").val();
    var reason = $("#txtWaiterReturnReasonInput").val() ? $("#txtWaiterReturnReasonInput").val().trim() : "";

    if (!reason) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'İade sebebini yazınız!', showConfirmButton: false, timer: 1500 });
        return;
    }

    $.post("/Order/ReturnOrderItem", { orderDetailId: detailId, reason: reason }, function (res) {
        if (res.success) {
            cancelWaiterReturnInput();
            openWaiterCheckoutModal($("#waiterCheckoutTableId").val(), "Masa", false);
            loadOccupiedTables();
        } else {
            Swal.fire("Hata", res.message, "error");
        }
    });
});

// MASA TAŞIMA / BİRLEŞTİRME MODALLARI
function openTransferModal(sourceTableId, sourceTableName) {
    $("#tmSourceTableId").val(sourceTableId);
    $("#tmSelectedTargetTableId").val("");
    $("#tmActionType").val("transfer");
    $("#btnConfirmTransferMerge").prop("disabled", true);

    $("#transferMergeModalTitle").html(`<i class="fa-solid fa-arrow-right-long me-2" style="color:#4a154b;"></i>${sourceTableName} Taşıma`);
    $("#tmActionInfoAlert").text("Bu masadaki tüm siparişler seçeceğiniz BOŞ masaya aktarılacaktır.");

    Swal.fire({ title: 'Boş Masalar Yükleniyor...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    $.ajax({
        url: "/Table/GetEmptyTables",
        type: "GET",
        cache: false,
        success: function (res) {
            Swal.close();
            if (res.success && res.data && res.data.length > 0) {
                allTargetTablesData = res.data;
                buildSectionTabsAndGrid(sourceTableId);
                bootstrap.Modal.getOrCreateInstance(document.getElementById('transferMergeModal')).show();
            } else {
                Swal.fire("Uyarı", "Taşınabilecek boş masa bulunamadı.", "warning");
            }
        },
        error: function () {
            Swal.close();
            Swal.fire("Hata", "Boş masalar çekilirken sunucu hatası oluştu.", "error");
        }
    });
}

function openMergeModal(sourceTableId, sourceTableName) {
    $("#tmSourceTableId").val(sourceTableId);
    $("#tmSelectedTargetTableId").val("");
    $("#tmActionType").val("merge");
    $("#btnConfirmTransferMerge").prop("disabled", true);

    $("#transferMergeModalTitle").html(`<i class="fa-solid fa-code-merge me-2" style="color:#4a154b;"></i>${sourceTableName} Birleştirme`);
    $("#tmActionInfoAlert").text("Bu masadaki tüm adisyon seçeceğiniz DOLU masanın adisyonuna eklenecektir.");

    Swal.fire({ title: 'Dolu Masalar Yükleniyor...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    $.ajax({
        url: "/Table/GetOccupiedTables",
        type: "GET",
        cache: false,
        success: function (res) {
            Swal.close();
            if (res.success && res.data && res.data.length > 0) {
                allTargetTablesData = res.data.filter(t => t.tableId !== sourceTableId);
                if (allTargetTablesData.length > 0) {
                    buildSectionTabsAndGrid(sourceTableId);
                    bootstrap.Modal.getOrCreateInstance(document.getElementById('transferMergeModal')).show();
                } else {
                    Swal.fire("Uyarı", "Birleştirilebilecek başka dolu masa bulunamadı.", "warning");
                }
            } else {
                Swal.fire("Uyarı", "Dolu masa bulunamadı.", "warning");
            }
        },
        error: function () {
            Swal.close();
            Swal.fire("Hata", "Masalar çekilirken sunucu hatası oluştu.", "error");
        }
    });
}

function buildSectionTabsAndGrid(sourceTableId) {
    var sections = ["Tümü"];
    $.each(allTargetTablesData, function (i, t) {
        var sec = t.section || "Salon";
        if (!sections.includes(sec)) sections.push(sec);
    });

    var $tabs = $("#tmSectionTabs").empty();
    $.each(sections, function (i, sec) {
        var activeClass = i === 0 ? "active" : "";
        $tabs.append(`<button class="btn btn-sm btn-purple-tab ${activeClass} px-3 rounded-pill fw-bold" onclick="filterTargetTablesBySection('${sec}', this)">${sec}</button>`);
    });

    renderTargetGrid(allTargetTablesData, sourceTableId);
}

function filterTargetTablesBySection(section, btnEl) {
    if (btnEl) {
        $("#tmSectionTabs .btn-purple-tab").removeClass("active");
        $(btnEl).addClass("active");
    }

    var sourceTableId = parseInt($("#tmSourceTableId").val());
    var filtered = section === "Tümü"
        ? allTargetTablesData
        : allTargetTablesData.filter(x => (x.section || "Salon") === section);

    renderTargetGrid(filtered, sourceTableId);
}

function renderTargetGrid(tablesList, sourceTableId) {
    var $grid = $("#targetTablesCardGrid").empty();

    if (!tablesList || tablesList.length === 0) {
        $grid.html('<div class="col-12 text-center py-4 text-muted">Bu bölümde masa bulunmuyor.</div>');
        return;
    }

    $.each(tablesList, function (i, t) {
        if (t.tableId === sourceTableId) return;

        var rawName = t.tableName || t.tableNameFormatted || `Masa ${t.tableId}`;
        var tableNameFormatted = rawName.toLowerCase().startsWith('masa') ? rawName : `Masa ${rawName}`;
        var subText = t.totalAmount ? `${parseFloat(t.totalAmount).toFixed(2)} ₺` : 'Boş Masa';

        var cardHtml = `
            <div class="col-4 col-md-3">
                <div class="target-table-card" onclick="selectTargetTableCard(${t.tableId}, this)">
                    <i class="fa-solid fa-chair fs-4 mb-1 style-purple-text"></i>
                    <div class="fw-bold text-dark small">${tableNameFormatted}</div>
                    <div class="extra-small text-muted">${subText}</div>
                </div>
            </div>`;

        $grid.append(cardHtml);
    });
}

function selectTargetTableCard(tableId, cardEl) {
    $(".target-table-card").removeClass("selected");
    $(cardEl).addClass("selected");

    $("#tmSelectedTargetTableId").val(tableId);
    $("#btnConfirmTransferMerge").prop("disabled", false);
}

$(document).on("click", "#btnConfirmTransferMerge", function () {
    var sourceId = $("#tmSourceTableId").val();
    var targetId = $("#tmSelectedTargetTableId").val();
    var actionType = $("#tmActionType").val();

    if (!targetId) {
        Swal.fire("Uyarı", "Lütfen hedef masayı seçiniz.", "warning");
        return;
    }

    var url = actionType === "transfer" ? "/Table/TransferTable" : "/Table/MergeTables";

    $.post(url, { sourceTableId: sourceId, targetTableId: targetId }, function (res) {
        if (res.success) {
            bootstrap.Modal.getInstance(document.getElementById('transferMergeModal')).hide();
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, showConfirmButton: false, timer: 1500 });
            loadOccupiedTables();
        } else {
            Swal.fire("Hata", res.message, "error");
        }
    });
});