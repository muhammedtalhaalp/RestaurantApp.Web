$(document).ready(function () {
    var allTablesData = [];
    var currentSectionFilter = "Hepsi";
    var customSections = ["Salon", "Bahçe", "Balkon", "Teras", "Üst Kat"];

    var storedSections = localStorage.getItem("custom_restaurant_sections");
    if (storedSections) {
        try {
            customSections = JSON.parse(storedSections);
        } catch (e) {
            console.error("Custom sections parse hatası", e);
        }
    }

    loadTables();

    // Genel Restoran Menü QR Kodunu Aç
    $("#btnShowGeneralQr").on("click", function () {
        openQrModal(null, "Genel Restoran Menü QR Kodu");
    });

    // Sekmeye tıklandığında aktif yap, ortala ve masaları filtrele
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

    $("#btnAddSectionCustom").on("click", function () {
        var newSec = $("#txtNewSectionName").val() ? $("#txtNewSectionName").val().trim() : "";

        if (!newSec) {
            Swal.fire("Uyarı", "Lütfen bir alan adı giriniz.", "warning");
            return;
        }

        if (customSections.some(s => s.toLowerCase() === newSec.toLowerCase())) {
            Swal.fire("Uyarı", "Bu alan adı zaten mevcut!", "warning");
            return;
        }

        customSections.push(newSec);
        saveCustomSections();
        renderSectionTabs();
        renderSectionSelectOptions();
        renderSectionManageList();

        $("#txtNewSectionName").val("");

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: "success",
            title: `"${newSec}" alanı eklendi!`,
            showConfirmButton: false,
            timer: 1500
        });
    });

    $(document).on("click", ".btn-delete-section", function () {
        var secToDelete = $(this).data("name");
        var attachedTables = allTablesData.filter(t => (t.section || "").toLowerCase() === secToDelete.toLowerCase());

        if (attachedTables.length > 0) {
            Swal.fire({
                title: "Alan Silinemez!",
                text: `"${secToDelete}" alanında ${attachedTables.length} adet kayıtlı masa bulunmaktadır. Alanı silebilmek için önce bu masaları silmeli veya alanlarını değiştirmelisiniz.`,
                icon: "warning",
                confirmButtonColor: "#4a154b"
            });
            return;
        }

        Swal.fire({
            title: "Alan Silinsin mi?",
            text: `"${secToDelete}" alanını silmek istediğinize emin misiniz?`,
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "Evet, Sil",
            cancelButtonText: "Vazgeç"
        }).then(function (result) {
            if (result.isConfirmed) {
                customSections = customSections.filter(s => s.toLowerCase() !== secToDelete.toLowerCase());
                saveCustomSections();

                if (currentSectionFilter.toLowerCase() === secToDelete.toLowerCase()) {
                    currentSectionFilter = "Hepsi";
                }

                renderSectionTabs();
                renderSectionSelectOptions();
                renderSectionManageList();
                renderTableCards();

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: "success",
                    title: `"${secToDelete}" alanı silindi!`,
                    showConfirmButton: false,
                    timer: 1500
                });
            }
        });
    });

    function renderTableCards() {
        var $container = $("#tableCardContainer");
        $container.empty();

        var filteredTables = allTablesData.filter(function (t) {
            if (currentSectionFilter === "Hepsi") return true;
            return (t.section || "Salon").toLowerCase() === currentSectionFilter.toLowerCase();
        });

        if (filteredTables.length === 0) {
            $container.html(`
                <div class="col-12 text-center py-5">
                    <p class="text-muted fw-semibold">Bu alanda (${currentSectionFilter}) henüz kayıtlı bir masa bulunmuyor.</p>
                </div>
            `);
            return;
        }

        $.each(filteredTables, function (i, t) {
            var rawStatus = (t.status || "").trim().toLowerCase();
            var amountVal = parseFloat(t.currentAmount || 0);

            var isOccupied = amountVal > 0 || (rawStatus !== "bos" && rawStatus !== "boş" && rawStatus !== "");
            var cardClass = isOccupied ? "table-occupied" : "table-empty";

            var badgeHtml = isOccupied
                ? '<span class="table-card-badge badge-paid" style="background-color: #ffffff; color: #dc2626; font-weight: 700;">AÇIK HESAP / DOLU</span>'
                : '<span class="table-card-badge badge-empty">BOŞ MASA</span>';

            var statusText = isOccupied ? "Adisyon Açık / Ödeme Bekliyor" : "Boş Masa";

            var priceHtml = isOccupied
                ? `<div class="table-card-price fw-bold fs-5 mt-1" style="color: #ffffff;">${amountVal.toFixed(2)} ₺</div>`
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
                    <div class="table-card ${cardClass} p-3" data-id="${t.tableId}" data-number="${t.tableNumber}" data-occupied="${isOccupied}">
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

    // MASA KARTINA TIKLANDIĞINDA ADİSYON / ÖDEME VE İADE MODALINI AÇMA
    $(document).on("click", ".table-card", function () {
        var tableId = $(this).data("id");
        var tableNumber = $(this).data("number");
        var isOccupied = $(this).data("occupied");

        if (!isOccupied) {
            Swal.fire("Bilgi", `"${tableNumber}" numaralı masa boştur. Sipariş eklemek için POS ekranını kullanabilirsiniz.`, "info");
            return;
        }

        $("#checkoutTableId").val(tableId);
        $("#checkoutModalTitle").html(`<i class="fa-solid fa-receipt me-2" style="color: #4a154b;"></i>${tableNumber} - Adisyon & İade Detayı`);

        cancelReturnInput();
        openCheckoutModal(tableId);
    });

    // MASA ADİSYON DETAYINI ÇEKİP MODALA ÇİZME
    function openCheckoutModal(tableId) {
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
                    renderCheckoutItems(res.data);
                    var modalEl = document.getElementById('tableCheckoutModal');
                    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                    modalInstance.show();
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

    // ADİSYON TABLOSUNU ÇİZME & İADE BUTONUNU EKLEME
    function renderCheckoutItems(items) {
        var $tbody = $("#checkoutItemsBody");
        $tbody.empty();
        var grandTotal = 0;

        if (!items || items.length === 0) {
            $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted">Adisyonda ürün bulunamadı.</td></tr>');
            $("#checkoutGrandTotal").text("0.00 ₺");
            return;
        }

        $.each(items, function (i, item) {
            var isReturned = item.isReturned || false;
            var lineTotal = item.unitPrice * item.quantity;

            if (!isReturned) {
                grandTotal += lineTotal;
            }

            var returnBtnHtml = "";
            if (isReturned) {
                returnBtnHtml = `<span class="badge bg-secondary opacity-75" title="${item.returnReason || 'Neden belirtilmedi'}"><i class="fa-solid fa-rotate-left me-1"></i>İade Edildi</span>`;
            } else {
                returnBtnHtml = `
                    <button class="btn btn-sm btn-outline-danger fw-bold rounded-3 px-2 py-1 btn-return-product" 
                            data-detailid="${item.orderDetailId}" 
                            data-name="${item.productName}">
                        <i class="fa-solid fa-rotate-left me-1"></i>İade Et
                    </button>`;
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

        $("#checkoutGrandTotal").text(grandTotal.toFixed(2) + " ₺");
    }

    // İADE ET BUTONUNA BASILDIĞINDA MODAL İÇİNDEKİ KUTUYU AÇMA (FOCUS PROBLEMİ ÇÖZÜLDÜ)
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

    // İADE KUTUSUNU İPTAL ETME
    window.cancelReturnInput = function () {
        $("#returnReasonContainer").addClass("d-none");
        $("#selectedReturnDetailId").val("");
        $("#txtReturnReasonInput").val("");
    };

    // İADEYİ ONAYLAMA VE SUNUCUYA GÖNDERME
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

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: res.message,
                    showConfirmButton: false,
                    timer: 1500
                });

                var tableId = $("#checkoutTableId").val();
                openCheckoutModal(tableId);
                loadTables();
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        });
    });

    // MASAYI KAPATMA VE ÖDEME ALMA İŞLEMİ
    $("#btnCloseTableOrder").on("click", function () {
        var tableId = $("#checkoutTableId").val();

        Swal.fire({
            title: "Ödeme Alındı mı?",
            text: "Hesap kapatılacak ve masa BOŞ durumuna getirilecektir.",
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#28a745",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "<i class='fa-solid fa-check me-1'></i>Evet, Masayı Kapat",
            cancelButtonText: "Vazgeç"
        }).then((result) => {
            if (result.isConfirmed) {
                $.post("/Admin/CloseTableOrder", { tableId: tableId }, function (res) {
                    if (res.success) {
                        var modalEl = document.getElementById('tableCheckoutModal');
                        var modalInstance = bootstrap.Modal.getInstance(modalEl);
                        if (modalInstance) modalInstance.hide();

                        Swal.fire({
                            icon: 'success',
                            title: 'Masa Kapatıldı!',
                            text: res.message,
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
                Swal.fire({
                    icon: "success",
                    title: "Başarılı!",
                    text: res.message,
                    timer: 1500,
                    showConfirmButton: false
                });
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
                    if (title) $("#qrModalSubTitle").text(title);

                    var modalEl = document.getElementById('qrCodeModal');
                    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                    modalInstance.show();
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