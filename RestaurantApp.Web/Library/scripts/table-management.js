$(document).ready(function () {
    var allTablesData = [];
    var currentSectionFilter = "Hepsi";
    var customSections = ["Salon", "Bahçe", "Balkon", "Teras", "Üst Kat"];
    var currentAdminTableTotal = 0;
    var rawAdminTableItems = [];
    var selectedAdminItemsForPay = {};
    var currentAdminPayTargetAmount = 0;

    var storedSections = localStorage.getItem("custom_restaurant_sections");
    if (storedSections) {
        try {
            customSections = JSON.parse(storedSections);
        } catch (e) {
            console.error("Custom sections parse hatası", e);
        }
    }

    loadTables();

    // Dağılım inputları kontrolü
    $(document).on("input", ".admin-pay-input", function () {
        calculateAdminRemainingPayment();
    });

    // Serbest Tutar Inputu Kontrolü
    $(document).on("input", "#txtAdminCustomPayAmount", function () {
        var customVal = parseFloat($(this).val()) || 0;
        if (customVal > currentAdminTableTotal) {
            customVal = currentAdminTableTotal;
            $(this).val(customVal.toFixed(2));
        }
        currentAdminPayTargetAmount = customVal;
        updateAdminPayTargetDisplay();
    });

    // Sekmeler Arası Geçiş
    $('#tabAdminPayByItems').on('shown.bs.tab', function () {
        recalcAdminItemsSelectionTotal();
    });

    $('#tabAdminPayByAmount').on('shown.bs.tab', function () {
        var customVal = parseFloat($("#txtAdminCustomPayAmount").val()) || 0;
        if (customVal === 0) {
            $("#txtAdminCustomPayAmount").val(currentAdminTableTotal.toFixed(2));
            customVal = currentAdminTableTotal;
        }
        currentAdminPayTargetAmount = customVal;
        updateAdminPayTargetDisplay();
    });

    $("#btnShowGeneralQr").on("click", function () {
        openQrModal(null);
    });

    $(document).on("click", "#sectionTabs .nav-link", function () {
        $("#sectionTabs .nav-link").removeClass("active");
        $(this).addClass("active");
        currentSectionFilter = $(this).data("section");
        this.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        renderTableCards();
    });

    $("#btnOpenManageSectionsModal").on("click", function () {
        renderSectionManageList();
    });

    function checkUrlModalTrigger() {
        var urlParams = new URLSearchParams(window.location.search);
        var modalParam = urlParams.get('modal');

        if (modalParam === 'qr') {
            openQrModal(null);
        } else if (modalParam === 'sections') {
            renderSectionManageList();
            bootstrap.Modal.getOrCreateInstance(document.getElementById('manageSectionsModal')).show();
        } else if (modalParam === 'addtable') {
            bootstrap.Modal.getOrCreateInstance(document.getElementById('addTableModal')).show();
        }
    }

    function loadTables() {
        $.get("/Admin/GetTables", function (res) {
            if (res.success) {
                allTablesData = res.data;
                $.each(allTablesData, function (i, t) {
                    if (t.section && !customSections.some(s => s.toLowerCase() === t.section.toLowerCase())) {
                        customSections.push(t.section);
                    }
                });
                saveCustomSections();
                renderSectionTabs();
                renderSectionSelectOptions();
                renderTableCards();
                checkUrlModalTrigger();
            } else {
                Swal.fire("Hata", "Masalar yüklenirken sorun oluştu: " + res.message, "error");
            }
        });
    }

    function saveCustomSections() {
        localStorage.setItem("custom_restaurant_sections", JSON.stringify(customSections));
    }

    function renderSectionTabs() {
        var $tabs = $("#sectionTabs");
        var activeSection = currentSectionFilter;

        var html = `
            <li class="nav-item">
                <button class="nav-link ${activeSection === 'Hepsi' ? 'active' : ''} fw-bold py-2 px-3 rounded-3" data-section="Hepsi">Tümü</button>
            </li>
        `;

        $.each(customSections, function (i, secName) {
            var isActive = activeSection.toLowerCase() === secName.toLowerCase() ? "active" : "";
            html += `
                <li class="nav-item">
                    <button class="nav-link ${isActive} fw-bold py-2 px-3 rounded-3" data-section="${secName}">${secName}</button>
                </li>
            `;
        });

        $tabs.html(html);
        var activeTab = $tabs.find(".nav-link.active")[0];
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
        }
    }

    function renderSectionSelectOptions() {
        var $select = $("#selectSection");
        var html = "";
        $.each(customSections, function (i, secName) {
            html += `<option value="${secName}">${secName}</option>`;
        });
        $select.html(html);
    }

    function renderSectionManageList() {
        var $list = $("#sectionListContainer");
        $list.empty();

        if (customSections.length === 0) {
            $list.html('<li class="list-group-item text-center text-muted py-3">Henüz tanımlı alan bulunmuyor.</li>');
            return;
        }

        $.each(customSections, function (i, secName) {
            var countTables = allTablesData.filter(t => (t.section || "").toLowerCase() === secName.toLowerCase()).length;
            var badgeText = countTables > 0 ? `${countTables} Masa Var` : 'Masa Yok';
            var badgeClass = countTables > 0 ? 'bg-primary-subtle text-primary' : 'bg-light text-muted border';

            var itemHtml = `
                <li class="list-group-item d-flex justify-content-between align-items-center py-2 px-3">
                    <div>
                        <span class="fw-semibold text-dark">${secName}</span>
                        <span class="badge ${badgeClass} ms-2 extra-small">${badgeText}</span>
                    </div>
                    <button class="btn btn-sm btn-outline-danger border-0 rounded-circle py-1 px-2 btn-delete-section" data-name="${secName}" title="Alanı Sil">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </li>
            `;
            $list.append(itemHtml);
        });
    }

    function renderTableCards() {
        var $container = $("#tableCardContainer");
        $container.empty();

        var filteredTables = allTablesData.filter(function (t) {
            if (currentSectionFilter === "Hepsi") return true;
            return (t.section || "Salon").toLowerCase() === currentSectionFilter.toLowerCase();
        });

        if (filteredTables.length === 0) {
            $container.html(`<div class="col-12 text-center py-5"><p class="text-muted fw-semibold">Bu alanda (${currentSectionFilter}) henüz kayıtlı bir masa bulunmuyor.</p></div>`);
            return;
        }

        $.each(filteredTables, function (i, t) {
            var rawStatus = (t.status || "").trim().toLowerCase();
            var amountVal = parseFloat(t.currentAmount || 0);
            var isPaid = t.isPaid || false;

            var isOccupied = amountVal > 0 || (rawStatus !== "bos" && rawStatus !== "boş" && rawStatus !== "");
            var cardClass = isOccupied ? "table-occupied" : "table-empty";

            var badgeHtml = "";
            if (isOccupied) {
                badgeHtml = isPaid
                    ? '<span class="table-card-badge badge-payment-completed"><i class="fa-solid fa-circle-check me-1"></i>ÖDEME ALINDI / DOLU</span>'
                    : '<span class="table-card-badge badge-paid">AÇIK HESAP / DOLU</span>';
            } else {
                badgeHtml = '<span class="table-card-badge badge-empty">BOŞ MASA</span>';
            }

            var statusText = isOccupied
                ? (isPaid ? "Adisyon Ödendi / Müşteri Masada" : "Adisyon Açık / Ödeme Bekliyor")
                : "Boş Masa";

            var priceHtml = isOccupied
                ? `<div class="table-card-price fw-bold fs-5 mt-1">${amountVal.toFixed(2)} ₺</div>`
                : `<div class="table-card-price fw-bold fs-5 mt-1 opacity-50">0.00 ₺</div>`;

            var timeDetailHtml = "";
            if (isOccupied) {
                var idleMinutes = t.idleMinutes !== undefined ? t.idleMinutes : 0;
                var idleBadgeText = idleMinutes > 0 ? `${idleMinutes} dk'dır yeni sipariş yok` : "Yeni sipariş verildi";

                timeDetailHtml = `
                    <div class="idle-time-badge mt-3 text-center">
                        <span class="badge bg-white text-dark w-100 fw-bold py-2 shadow-sm" style="font-size:0.75rem;">
                            <i class="fa-solid fa-hourglass-half me-1 text-danger"></i>${idleBadgeText}
                        </span>
                    </div>
                `;
            }

            var cardHtml = `
                <div class="col-12 col-sm-6 col-md-4 col-lg-3">
                    <div class="table-card ${cardClass} p-3" data-id="${t.tableId}" data-number="${t.tableNumber}" data-occupied="${isOccupied}" data-ispaid="${isPaid}">
                        <button class="btn btn-sm btn-danger btn-delete-card-table rounded-circle" data-id="${t.tableId}" title="Masayı Sil">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                        <div class="table-card-header">
                            <span class="table-card-number">${t.tableNumber}</span>
                            ${badgeHtml}
                        </div>
                        <div class="table-card-body">
                            <span class="table-card-status-text">${statusText}</span>
                            ${priceHtml}
                            ${timeDetailHtml}
                        </div>
                    </div>
                </div>
            `;

            $container.append(cardHtml);
        });
    }

    $(document).on("click", ".table-card", function () {
        var tableId = $(this).data("id");
        var tableNumber = $(this).data("number");
        var isOccupied = $(this).data("occupied");
        var isPaid = $(this).data("ispaid");

        if (!isOccupied) {
            Swal.fire("Bilgi", `"${tableNumber}" numaralı masa boştur. Sipariş eklemek için POS ekranını kullanabilirsiniz.`, "info");
            return;
        }

        $("#checkoutTableId").val(tableId);
        $("#checkoutModalTitle").html(`<i class="fa-solid fa-receipt me-2" style="color: #4a154b;"></i>${tableNumber} - Adisyon & İade Detayı`);

        if (isPaid) {
            $("#btnOpenAdminPaymentModal").addClass("d-none");
            $("#btnVacateAdminTable").removeClass("d-none");
        } else {
            $("#btnOpenAdminPaymentModal").removeClass("d-none");
            $("#btnVacateAdminTable").addClass("d-none");
        }

        cancelReturnInput();
        openCheckoutModal(tableId, isPaid);
    });

    function openCheckoutModal(tableId, isPaid) {
        Swal.fire({
            title: 'Adisyon Yükleniyor...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        $.ajax({
            url: "/Admin/GetActiveOrderByTableId",
            type: "GET",
            data: { tableId: tableId },
            success: function (res) {
                Swal.close();
                if (res.success && res.data) {
                    rawAdminTableItems = res.data;
                    renderCheckoutItems(res.data, isPaid);
                    var modalEl = document.getElementById('tableCheckoutModal');
                    bootstrap.Modal.getOrCreateInstance(modalEl).show();
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

    function renderCheckoutItems(items, isPaid) {
        var $tbody = $("#checkoutItemsBody");
        $tbody.empty();
        currentAdminTableTotal = 0;

        if (!items || items.length === 0) {
            $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted">Adisyonda ürün bulunamadı.</td></tr>');
            $("#checkoutGrandTotal").text("0.00 ₺");
            return;
        }

        $.each(items, function (i, item) {
            var isReturned = item.isReturned || false;
            var lineTotal = item.unitPrice * item.quantity;

            if (!isReturned) {
                currentAdminTableTotal += lineTotal;
            }

            var returnBtnHtml = "";
            if (isReturned) {
                returnBtnHtml = `<span class="badge bg-secondary opacity-75" title="${item.returnReason || 'Neden belirtilmedi'}"><i class="fa-solid fa-rotate-left me-1"></i>İade Edildi</span>`;
            } else if (isPaid) {
                returnBtnHtml = `<span class="badge bg-light text-muted border">Ödeme Alındı</span>`;
            } else {
                returnBtnHtml = `<button class="btn btn-sm btn-outline-danger fw-bold rounded-3 px-2 py-1 btn-return-product" data-detailid="${item.orderDetailId}" data-name="${item.productName}"><i class="fa-solid fa-rotate-left me-1"></i>İade Et</button>`;
            }

            var rowStyle = isReturned ? 'style="opacity:0.5; text-decoration: line-through; background-color:#f8fafc;"' : '';

            var row = `
                <tr ${rowStyle}>
                    <td class="fw-semibold text-dark">
                        ${item.productName}
                        ${isReturned ? `<br><small class="text-danger fw-normal" style="text-decoration:none !important;">(İade Nedeni: ${item.returnReason})</small>` : ''}
                    </td>
                    <td class="text-center fw-bold">${item.quantity}</td>
                    <td class="text-end">${parseFloat(item.unitPrice).toFixed(2)} ₺</td>
                    <td class="text-end fw-bold text-dark">${lineTotal.toFixed(2)} ₺</td>
                    <td class="text-center">${returnBtnHtml}</td>
                </tr>`;

            $tbody.append(row);
        });

        $("#checkoutGrandTotal").text(currentAdminTableTotal.toFixed(2) + " ₺");
    }

    // GELİŞMİŞ PARÇALI ÖDEME MODALINI AÇMA
    $(document).on("click", "#btnOpenAdminPaymentModal", function () {
        bootstrap.Modal.getInstance(document.getElementById('tableCheckoutModal')).hide();

        selectedAdminItemsForPay = {};
        var $itemsTbody = $("#adminSplitPayItemsTableBody").empty();

        var activeItems = rawAdminTableItems.filter(x => !x.isReturned);
        $.each(activeItems, function (i, item) {
            var row = `
                <tr>
                    <td class="fw-bold text-dark">${item.productName}</td>
                    <td class="text-center fw-semibold">${item.quantity}</td>
                    <td class="text-end">${parseFloat(item.unitPrice).toFixed(2)} ₺</td>
                    <td class="text-center">
                        <div class="d-flex align-items-center justify-content-center gap-1">
                            <button type="button" class="btn btn-sm btn-outline-secondary qty-btn" onclick="changeAdminItemPayQty(${item.orderDetailId}, -1, ${item.quantity}, ${item.unitPrice})">-</button>
                            <span id="lblAdminPayQty-${item.orderDetailId}" class="fw-bold px-2">0</span>
                            <button type="button" class="btn btn-sm btn-outline-purple qty-btn" onclick="changeAdminItemPayQty(${item.orderDetailId}, 1, ${item.quantity}, ${item.unitPrice})">+</button>
                        </div>
                    </td>
                </tr>
            `;
            $itemsTbody.append(row);
        });

        $("#lblAdminFreePayTableTotal").text(currentAdminTableTotal.toFixed(2) + " ₺");
        $("#txtAdminCustomPayAmount").val(currentAdminTableTotal.toFixed(2));

        bootstrap.Tab.getOrCreateInstance(document.getElementById('tabAdminPayByItems')).show();
        recalcAdminItemsSelectionTotal();

        bootstrap.Modal.getOrCreateInstance(document.getElementById('adminSplitPaymentModal')).show();
    });

    window.changeAdminItemPayQty = function (detailId, delta, maxQty, unitPrice) {
        if (!selectedAdminItemsForPay[detailId]) {
            selectedAdminItemsForPay[detailId] = { quantity: 0, unitPrice: unitPrice };
        }

        var currentQty = selectedAdminItemsForPay[detailId].quantity;
        var newQty = currentQty + delta;

        if (newQty < 0) newQty = 0;
        if (newQty > maxQty) newQty = maxQty;

        selectedAdminItemsForPay[detailId].quantity = newQty;
        $(`#lblAdminPayQty-${detailId}`).text(newQty);

        recalcAdminItemsSelectionTotal();
    };

    function recalcAdminItemsSelectionTotal() {
        var total = 0;
        $.each(selectedAdminItemsForPay, function (id, obj) {
            total += (obj.quantity * obj.unitPrice);
        });

        currentAdminPayTargetAmount = total;
        updateAdminPayTargetDisplay();
    }

    function updateAdminPayTargetDisplay() {
        $("#lblAdminTargetPayAmount").text(currentAdminPayTargetAmount.toFixed(2) + " ₺");
        $("#numAdminCashPay").val(currentAdminPayTargetAmount.toFixed(2));
        $("#numAdminCreditPay").val("");
        $("#numAdminMealPay").val("");

        calculateAdminRemainingPayment();
    }

    function calculateAdminRemainingPayment() {
        var cash = parseFloat($("#numAdminCashPay").val()) || 0;
        var credit = parseFloat($("#numAdminCreditPay").val()) || 0;
        var meal = parseFloat($("#numAdminMealPay").val()) || 0;

        var paidSum = cash + credit + meal;
        var diff = currentAdminPayTargetAmount - paidSum;

        var $lbl = $("#lblAdminPayRemaining");
        $lbl.text(diff.toFixed(2) + " ₺");

        if (currentAdminPayTargetAmount > 0 && Math.abs(diff) < 0.01) {
            $lbl.removeClass("text-danger").addClass("text-success").text("Ödeme Dağılımı Doğrulandı (0.00 ₺)");
            $("#btnFinalizeAdminSplitPayment").prop("disabled", false);
        } else {
            $lbl.removeClass("text-success").addClass("text-danger");
            $("#btnFinalizeAdminSplitPayment").prop("disabled", true);
        }
    }

    // PARÇALI TAHSİLAT GÖNDERME
    $(document).on("click", "#btnFinalizeAdminSplitPayment", function () {
        var tableId = $("#checkoutTableId").val();
        var cash = parseFloat($("#numAdminCashPay").val()) || 0;
        var credit = parseFloat($("#numAdminCreditPay").val()) || 0;
        var meal = parseFloat($("#numAdminMealPay").val()) || 0;

        var paymentType = "Parçalı Ödeme";
        if (cash === currentAdminPayTargetAmount) paymentType = "Nakit";
        else if (credit === currentAdminPayTargetAmount) paymentType = "Kredi Kartı";
        else if (meal === currentAdminPayTargetAmount) paymentType = "Yemek Kartı";

        var isItemsMode = $("#paneAdminPayByItems").hasClass("active");

        if (isItemsMode) {
            var itemsList = [];
            $.each(selectedAdminItemsForPay, function (id, obj) {
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
                    handleAdminPaymentResult(res);
                }
            });
        } else {
            $.post("/Table/PayByAmount", {
                tableId: tableId,
                paidAmount: currentAdminPayTargetAmount,
                cashAmount: cash,
                creditCardAmount: credit,
                mealCardAmount: meal,
                paymentType: paymentType
            }, function (res) {
                handleAdminPaymentResult(res);
            });
        }
    });

    function handleAdminPaymentResult(res) {
        if (res.success) {
            bootstrap.Modal.getInstance(document.getElementById('adminSplitPaymentModal')).hide();
            Swal.fire({
                icon: 'success',
                title: 'Ödeme Alındı!',
                text: res.message,
                timer: 1500,
                showConfirmButton: false
            });
            loadTables();
        } else {
            Swal.fire("Hata", res.message, "error");
        }
    }

    $(document).on("click", "#btnVacateAdminTable", function () {
        var tableId = $("#checkoutTableId").val();

        Swal.fire({
            title: "Masa Boşaltılsın mı?",
            text: "Masa fiziken temizlenecek ve yeni müşteriler için BOŞ durumuna getirilecektir.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#10b981",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "Evet, Masayı Boşalt",
            cancelButtonText: "İptal"
        }).then((result) => {
            if (result.isConfirmed) {
                $.post("/Table/VacateTable", { tableId: tableId }, function (res) {
                    if (res.success) {
                        bootstrap.Modal.getInstance(document.getElementById('tableCheckoutModal')).hide();
                        Swal.fire({
                            icon: 'success',
                            title: 'Masa Boşaltıldı!',
                            text: 'Masa başarıyla boşaltıldı.',
                            timer: 1500,
                            showConfirmButton: false
                        });
                        loadTables();
                    } else {
                        Swal.fire("Hata", res.message, "error");
                    }
                });
            }
        });
    });

    $(document).on("click", ".btn-return-product", function (e) {
        e.stopPropagation();
        var detailId = $(this).data("detailid");
        var productName = $(this).data("name");

        $("#selectedReturnDetailId").val(detailId);
        $("#lblReturnProductName").text(productName);
        $("#txtReturnReasonInput").val("");
        $("#returnReasonContainer").removeClass("d-none");

        setTimeout(function () {
            $("#txtReturnReasonInput").focus();
        }, 100);
    });

    window.cancelReturnInput = function () {
        $("#returnReasonContainer").addClass("d-none");
        $("#selectedReturnDetailId").val("");
        $("#txtReturnReasonInput").val("");
    };

    $(document).on("click", "#btnConfirmReturnAction", function () {
        var detailId = $("#selectedReturnDetailId").val();
        var reason = $("#txtReturnReasonInput").val() ? $("#txtReturnReasonInput").val().trim() : "";

        if (!reason) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'warning',
                title: 'Lütfen iade sebebini yazınız!',
                showConfirmButton: false,
                timer: 1500
            });
            $("#txtReturnReasonInput").focus();
            return;
        }

        $.post("/Order/ReturnOrderItem", {
            orderDetailId: detailId,
            reason: reason
        }, function (res) {
            if (res.success) {
                cancelReturnInput();
                openCheckoutModal($("#checkoutTableId").val(), false);
                loadTables();
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        });
    });

    $("#btnSaveTable").on("click", function () {
        var tableNum = $("#txtTableNumber").val() ? $("#txtTableNumber").val().trim() : "";
        var section = $("#selectSection").val();

        if (!tableNum) {
            Swal.fire("Uyarı", "Lütfen masa adı/numarası giriniz.", "warning");
            return;
        }

        $.post("/Admin/AddTable", {
            tableNumber: tableNum,
            section: section
        }, function (res) {
            if (res.success) {
                $("#addTableModal").modal("hide");
                $("#txtTableNumber").val("");
                loadTables();
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        });
    });

    $(document).on("click", ".btn-delete-card-table", function (e) {
        e.stopPropagation();
        var id = $(this).data("id");

        Swal.fire({
            title: "Masa Silinsin mi?",
            text: "Bu masayı silmek istediğinize emin misiniz?",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#3085d6",
            confirmButtonText: "Evet, Sil!",
            cancelButtonText: "İptal"
        }).then(function (result) {
            if (result.isConfirmed) {
                $.post("/Admin/DeleteTable", { id: id }, function (res) {
                    if (res.success) {
                        loadTables();
                    } else {
                        Swal.fire("Hata", res.message, "error");
                    }
                });
            }
        });
    });

    function openQrModal(tableId, title) {
        Swal.fire({
            title: 'QR Kod Hazırlanıyor...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        $.ajax({
            url: "/Admin/GenerateQrCodeUrl",
            type: "GET",
            data: { tableId: tableId },
            success: function (res) {
                Swal.close();
                if (res && res.success) {
                    $("#imgQrCode").attr("src", res.qrImageUrl);
                    $("#btnDownloadQr").attr("href", res.qrImageUrl);
                    $("#txtQrTargetUrl").text(res.targetUrl);

                    var dynamicTitle = title || (res.companyName ? `${res.companyName} Menü QR Kodu` : "Menü QR Kodu");
                    $("#qrModalSubTitle").text(dynamicTitle);

                    var modalEl = document.getElementById('qrCodeModal');
                    bootstrap.Modal.getOrCreateInstance(modalEl).show();
                } else {
                    Swal.fire("Hata", res ? res.message : "QR Kod oluşturulamadı.", "error");
                }
            },
            error: function () {
                Swal.close();
                Swal.fire("Hata", "QR Kod oluşturulurken sunucu hatası oluştu.", "error");
            }
        });
    }
});