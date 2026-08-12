$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var map;
var marker;
var geocoder;
var autocomplete;
var cart = []; // Sadece YENİ EKLENECEK ürünler (Mutfağa gidecek olanlar)
var existingCart = []; // Masada ÖNCEDEN VAR OLAN ürünler (Salt okunur)
var defaultLat = 38.7205;
var defaultLng = 35.4826;
var posTablesData = [];
var currentRawProducts = [];
var currentViewMode = "grid";
var activeCategoryId = 0;
var isTargetConfirmed = false;

function initGoogleMap() {
    var defaultLocation = { lat: defaultLat, lng: defaultLng };

    map = new google.maps.Map(document.getElementById('map'), {
        center: defaultLocation,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
    });

    geocoder = new google.maps.Geocoder();
    marker = new google.maps.Marker({
        position: defaultLocation,
        map: map,
        draggable: true,
        animation: google.maps.Animation.DROP
    });

    updateCoordinates(defaultLat, defaultLng);

    map.addListener('click', function (e) {
        var clickedLat = e.latLng.lat();
        var clickedLng = e.latLng.lng();

        marker.setPosition(e.latLng);
        updateCoordinates(clickedLat, clickedLng);
        askAndUpdateAddress(e.latLng);
    });

    marker.addListener('dragend', function () {
        var pos = marker.getPosition();
        updateCoordinates(pos.lat(), pos.lng());
        askAndUpdateAddress(pos);
    });

    var input = document.getElementById('txtDeliveryAddress');
    autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', function () {
        var place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;

        if (place.geometry.viewport) {
            map.fitBounds(place.geometry.viewport);
        } else {
            map.setCenter(place.geometry.location);
            map.setZoom(17);
        }

        marker.setPosition(place.geometry.location);
        updateCoordinates(place.geometry.location.lat(), place.geometry.location.lng());
    });
}

function askAndUpdateAddress(latLng) {
    if (!geocoder) return;

    geocoder.geocode({ 'location': latLng }, function (results, status) {
        if (status === 'OK' && results[0]) {
            var fetchedAddress = results[0].formatted_address;
            var currentAddress = ($("#txtDeliveryAddress").val() || "").trim();

            if (currentAddress !== "" && currentAddress !== fetchedAddress) {
                Swal.fire({
                    title: 'Adres Güncellensin mi?',
                    text: `Haritada seçtiğiniz yeni adres:\n"${fetchedAddress}"\n\nMevcut açık adresiniz değiştirilsin mi?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#4a154b',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: 'Evet, Güncelle',
                    cancelButtonText: 'Hayır, Kalsın'
                }).then((result) => {
                    if (result.isConfirmed) {
                        $("#txtDeliveryAddress").val(fetchedAddress);
                    }
                });
            } else if (currentAddress === "") {
                $("#txtDeliveryAddress").val(fetchedAddress);
            }
        }
    });
}

function updateCoordinates(lat, lng) {
    $("#latitude").val(lat);
    $("#longitude").val(lng);
}

$(document).ready(function () {
    console.log("POS JS Yüklendi.");

    loadCategories();
    loadProducts(0);
    loadTables();

    openInitialModal();

    $("#btnGridView").on("click", function () {
        currentViewMode = "grid";
        $("#btnTableView").removeClass("active btn-purple-main text-white").addClass("btn-outline-secondary");
        $(this).removeClass("btn-outline-secondary").addClass("active btn-purple-main text-white");
        renderProductsView();
    });

    $("#btnTableView").on("click", function () {
        currentViewMode = "table";
        $("#btnGridView").removeClass("active btn-purple-main text-white").addClass("btn-outline-secondary");
        $(this).removeClass("btn-outline-secondary").addClass("active btn-purple-main text-white");
        renderProductsView();
    });

    $(document).on("click", "#posSectionTabs .nav-link", function () {
        $("#posSectionTabs .nav-link").removeClass("active");
        $(this).addClass("active");

        var selectedSection = $(this).data("section");
        renderPosTableCards(selectedSection);
    });

    $("#btn-submit-order").on("click", function () {
        if (cart.length === 0) {
            Swal.fire("Uyarı", "Yeni eklenecek ürün bulunmamaktadır.", "warning");
            return;
        }

        var orderType = $("#orderType").val();
        var tableId = $("#tableId").val();
        var address = ($("#txtDeliveryAddress").val() || "").trim();
        var lat = parseFloat($("#latitude").val());
        var lng = parseFloat($("#longitude").val());

        executeSubmitOrder(orderType, tableId, address, lat, lng);
    });
});

function openInitialModal() {
    var initModalElem = document.getElementById('initialOrderTypeModal');
    if (initModalElem) {
        var initModal = bootstrap.Modal.getOrCreateInstance(initModalElem);
        initModal.show();
    }
}

function selectInitialOrderType(type) {
    var initModalElem = document.getElementById('initialOrderTypeModal');
    var initModalInstance = bootstrap.Modal.getInstance(initModalElem);
    if (initModalInstance) initModalInstance.hide();

    if (type === "Masa") {
        $("#orderType").val("Masa");
        renderPosTableCards("Hepsi");
        var tableModal = new bootstrap.Modal(document.getElementById('posTableMapModal'));
        tableModal.show();
    } else if (type === "PaketServis") {
        $("#orderType").val("PaketServis");
        $("#tableId").val("");
        var paketModal = new bootstrap.Modal(document.getElementById('posPaketModal'));
        paketModal.show();

        setTimeout(function () {
            if (map && marker) {
                google.maps.event.trigger(map, 'resize');
                map.setCenter(marker.getPosition());
            }
        }, 300);
    }
}

function confirmPaketServisModal() {
    var address = ($("#txtDeliveryAddress").val() || "").trim();
    if (!address) {
        Swal.fire({
            title: "Teslimat Adresi Eksik!",
            text: "Lütfen paket servis için açık adresi giriniz.",
            icon: "warning",
            confirmButtonColor: "#4a154b"
        });
        return;
    }

    var paketModalElem = document.getElementById('posPaketModal');
    var paketModalInstance = bootstrap.Modal.getInstance(paketModalElem);
    if (paketModalInstance) paketModalInstance.hide();

    var targetText = "Paket Servis (" + (address.length > 20 ? address.substring(0, 20) + "..." : address) + ")";
    cart = [];
    existingCart = [];
    confirmTargetSession(targetText);
}

function confirmTargetSession(targetText) {
    isTargetConfirmed = true;

    $("#lblSelectedTargetName").text(targetText);
    $("#targetSelectedBadge").removeClass("d-none");

    $("#stepTargetSelectionPanel").slideUp();
    $("#stepCartPanel").attr("style", "display: flex !important;").hide().slideDown();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: targetText + ' için sipariş oturumu açıldı.',
        showConfirmButton: false,
        timer: 1500
    });
}

// DOLU MASANIN ÖNCEDEN VERİLMİŞ SİPARİŞLERİNİ ÇEKİP SALT OKUNUR GÖSTERME
function loadTableActiveOrder(tableId) {
    $.ajax({
        url: "/Admin/GetActiveOrderByTableId",
        type: "GET",
        data: { tableId: tableId },
        cache: false,
        success: function (res) {
            cart = [];
            existingCart = [];
            if (res.success && res.data && res.data.length > 0) {
                existingCart = res.data.map(item => ({
                    id: item.productId,
                    name: item.productName,
                    price: item.unitPrice,
                    quantity: item.quantity
                }));
            }
            renderExistingOrders();
            renderCart();
        },
        error: function () {
            cart = [];
            existingCart = [];
            renderExistingOrders();
            renderCart();
        }
    });
}

// ÖNCEDEN VERİLMİŞ SİPARİŞLERİ EKRANA SALT OKUNUR ÇİZME
function renderExistingOrders() {
    var $wrapper = $("#existingOrdersWrapper");
    var $tbody = $("#existing-items-body");
    $tbody.empty();

    if (!existingCart || existingCart.length === 0) {
        $wrapper.addClass("d-none");
        return;
    }

    $wrapper.removeClass("d-none");
    var existingTotal = 0;

    $.each(existingCart, function (i, item) {
        var lineTotal = item.price * item.quantity;
        existingTotal += lineTotal;

        var row = `
            <tr>
                <td class="text-dark fw-semibold">${item.name}</td>
                <td class="text-center text-muted fw-bold">${item.quantity} Adet</td>
                <td class="text-end text-secondary fw-bold">${lineTotal.toFixed(2)} ₺</td>
            </tr>`;
        $tbody.append(row);
    });

    $("#lblExistingTotal").text(existingTotal.toFixed(2) + " ₺");
}

function resetTargetSelection() {
    if (cart.length > 0 || existingCart.length > 0) {
        Swal.fire({
            title: "Masa / Adres Değiştirilsin mi?",
            text: "Hedef değiştirilirse sepetinizdeki yeni ürünler temizlenecektir!",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "Evet, Değiştir",
            cancelButtonText: "Vazgeç"
        }).then((result) => {
            if (result.isConfirmed) {
                cart = [];
                existingCart = [];
                $("#txtOrderGeneralNote").val("");
                renderExistingOrders();
                renderCart();
                executeResetTargetUI();
                openInitialModal();
            }
        });
    } else {
        executeResetTargetUI();
        openInitialModal();
    }
}

function executeResetTargetUI() {
    isTargetConfirmed = false;
    $("#targetSelectedBadge").addClass("d-none");

    $("#stepCartPanel").slideUp(function () {
        $("#stepTargetSelectionPanel").slideDown();
    });

    if (typeof renderRoleSidebar === "function") {
        renderRoleSidebar();
    }
}

// GENEL SİPARİŞ NOTUNU MUTFAĞA VE BACKEND'E GÖNDERME
function executeSubmitOrder(orderType, tableId, address, lat, lng) {
    var generalNote = ($("#txtOrderGeneralNote").val() || "").trim();

    var orderData = {
        OrderType: orderType,
        TableId: orderType === "Masa" ? parseInt(tableId) : null,
        DeliveryAddress: orderType === "PaketServis" ? address : null,
        Latitude: orderType === "PaketServis" ? lat : null,
        Longitude: orderType === "PaketServis" ? lng : null,
        TotalAmount: calculateTotal(),
        OrderNote: generalNote || null, // GENEL SİPARİŞ NOTU
        Items: cart.map(item => ({
            ProductId: item.id,
            Quantity: item.quantity,
            UnitPrice: item.price
        }))
    };

    var $btn = $("#btn-submit-order");
    $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i>Gönderiliyor...');

    $.ajax({
        url: "/Order/CreateOrder",
        type: "POST",
        data: JSON.stringify(orderData),
        contentType: "application/json",
        success: function (response) {
            $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-2"></i>Siparişi Onayla & Mutfağa Gönder');
            if (response.success) {
                Swal.fire({
                    title: 'Sipariş Mutfağa İletildi!',
                    text: 'Sipariş fişi yazdırılsın mı?',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#4a154b',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: '<i class="fa-solid fa-print me-1"></i>Evet, Yazdır',
                    cancelButtonText: 'Hayır, Devam Et'
                }).then((result) => {
                    if (result.isConfirmed) {
                        printOrderReceipt(orderType, tableId, address, generalNote);
                    }

                    cart = [];
                    existingCart = [];
                    $("#txtOrderGeneralNote").val("");
                    renderExistingOrders();
                    renderCart();
                    $("#txtDeliveryAddress").val("");
                    loadTables();
                    executeResetTargetUI();
                });
            } else {
                Swal.fire("Hata", response.message, "error");
            }
        },
        error: function () {
            $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-2"></i>Siparişi Onayla & Mutfağa Gönder');
            Swal.fire("Hata", "Sipariş gönderilirken sunucu hatası oluştu.", "error");
        }
    });
}

function printOrderReceipt(orderType, tableId, address, generalNote) {
    var nowStr = new Date().toLocaleString('tr-TR');

    var targetTitle = "Paket Servis";
    if (orderType === "Masa") {
        var selectedTable = posTablesData.find(t => t.tableId == tableId);
        targetTitle = selectedTable ? selectedTable.tableName : `Masa #${tableId}`;
    }

    var itemsHtml = "";
    $.each(cart, function (i, item) {
        var lineTotal = (item.price * item.quantity).toFixed(2);
        itemsHtml += `
            <tr style="border-bottom: 1px dashed #ccc;">
                <td style="text-align:center; padding: 4px 0; font-weight:bold;">${item.quantity}</td>
                <td style="text-align:left; padding: 4px 5px; word-break: break-word;">${item.name}</td>
                <td style="text-align:right; padding: 4px 0;">${lineTotal} ₺</td>
            </tr>`;
    });

    var noteSectionHtml = generalNote ? `
        <div class="divider"></div>
        <div class="info-block" style="background-color: #f8f9fa; padding: 4px; border-radius: 4px;">
            <strong>Sipariş Notu:</strong> ${generalNote}
        </div>` : '';

    var receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sipariş Fişi</title>
            <style>
                @page { size: 80mm 200mm; margin: 0; }
                body { font-family: 'Courier New', Courier, monospace; font-size: 11px; width: 72mm; margin: 0 auto; padding: 5px; color: #000; background-color: #fff; }
                .text-center { text-align: center; }
                .receipt-header { text-align: center; margin-bottom: 6px; }
                .receipt-logo { font-size: 18px; font-weight: bold; color: #000; margin: 0; text-transform: uppercase; }
                .divider { border-bottom: 1px dashed #000; margin: 5px 0; }
                .info-block { font-size: 11px; margin-bottom: 4px; line-height: 1.3; }
                table { width: 100%; border-collapse: collapse; margin: 6px 0; }
                th { font-size: 10px; border-bottom: 1px solid #000; border-top: 1px solid #000; padding: 3px 0; }
                .total-box { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 0; font-size: 13px; font-weight: bold; margin-top: 6px; }
                .footer-note { text-align: center; font-size: 10px; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="receipt-header">
                <h1 class="receipt-logo">LezzetPOS</h1>
                <div class="receipt-sub">Yeni Sipariş Fişi</div>
            </div>
            <div class="divider"></div>
            <div class="info-block">
                <div><strong>Tarih:</strong> ${nowStr}</div>
                <div><strong>Hedef:</strong> ${targetTitle}</div>
                ${orderType === "PaketServis" && address ? `<div style="margin-top:2px;"><strong>Adres:</strong> ${address}</div>` : ''}
            </div>
            ${noteSectionHtml}
            <div class="divider"></div>
            <table>
                <thead>
                    <tr>
                        <th style="text-align:center; width: 15%;">Adet</th>
                        <th style="text-align:left; width: 55%;">Ürün</th>
                        <th style="text-align:right; width: 30%;">Tutar</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
            <div class="total-box">
                <div style="display:flex; justify-content:space-between;">
                    <span>YENİ SİPARİŞ TUTARI:</span>
                    <span>${calculateNewCartTotal().toFixed(2)} ₺</span>
                </div>
            </div>
            <div class="footer-note">
                <p style="margin:0; font-weight:bold;">Afiyet Olsun!</p>
            </div>
        </body>
        </html>
    `;

    var printWin = window.open('', '_blank', 'width=380,height=600,scrollbars=no,menubar=no,toolbar=no,location=no,status=no');
    if (printWin) {
        printWin.document.open();
        printWin.document.write(receiptHtml);
        printWin.document.close();

        setTimeout(function () {
            printWin.focus();
            printWin.print();
            printWin.close();
        }, 300);
    }
}

function loadTables() {
    $.ajax({
        url: "/Order/GetTables",
        type: "GET",
        cache: false,
        success: function (res) {
            if (res.success && res.data && res.data.length > 0) {
                posTablesData = res.data;
                var html = '<option value="">Masa Seçiniz...</option>';
                $.each(res.data, function (i, t) {
                    var currentAmt = parseFloat(t.currentAmount || 0);
                    var isOccupied = (t.status && t.status.toLowerCase() === "dolu") || currentAmt > 0;
                    var amountVal = currentAmt.toFixed(2);
                    var statusBadge = isOccupied ? ` (Dolu - ${amountVal} ₺)` : " (Boş)";
                    html += `<option value="${t.tableId}">${t.tableName}${statusBadge}</option>`;
                });
                $("#tableId").html(html);
            } else {
                posTablesData = [];
                $("#tableId").html('<option value="">Kayıtlı Aktif Masa Bulunamadı</option>');
            }
        },
        error: function () {
            posTablesData = [];
            $("#tableId").html('<option value="">Masa Yükleme Hatası</option>');
        }
    });
}

function renderPosTableCards(sectionFilter) {
    var $grid = $("#posTableCardGrid");
    $grid.empty();

    if (!posTablesData || posTablesData.length === 0) {
        $grid.html('<div class="col-12 text-center py-4 text-muted">Kayıtlı masa bulunamadı.</div>');
        return;
    }

    var filtered = sectionFilter === "Hepsi"
        ? posTablesData
        : posTablesData.filter(t => (t.section || "Salon").toLowerCase() === sectionFilter.toLowerCase());

    if (filtered.length === 0) {
        $grid.html('<div class="col-12 text-center py-4 text-muted">Bu alanda masa bulunmamaktadır.</div>');
        return;
    }

    $.each(filtered, function (i, t) {
        var currentAmt = parseFloat(t.currentAmount || 0);
        var isOccupied = (t.status && t.status.toLowerCase() === "dolu") || currentAmt > 0;
        var cardClass = isOccupied ? "table-card-occupied" : "table-card-empty";
        var badgeClass = isOccupied ? "bg-danger text-white" : "bg-success text-white";
        var amountVal = currentAmt.toFixed(2);
        var statusText = isOccupied ? `Dolu (${amountVal} ₺)` : "Boş";

        var cardHtml = `
            <div class="col-md-3 col-sm-6">
                <div class="pos-table-card ${cardClass}" data-id="${t.tableId}" data-name="${t.tableNumber}" data-status="${isOccupied ? 'Dolu' : 'Bos'}">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="fw-bold fs-6">${t.tableNumber}</span>
                        <span class="badge ${badgeClass} rounded-pill">${statusText}</span>
                    </div>
                    <div class="small text-muted mb-2"><i class="fa-solid fa-location-dot me-1"></i>${t.section || 'Salon'}</div>
                    <div class="text-end">
                        <i class="fa-solid fa-chair fs-4 opacity-50"></i>
                    </div>
                </div>
            </div>
        `;

        var $card = $(cardHtml);

        $card.find(".pos-table-card").on("click", function () {
            var selectedId = $(this).data("id");
            var selectedName = $(this).data("name");
            var status = $(this).data("status");

            $("#tableId").val(selectedId);

            var modalElem = document.getElementById('posTableMapModal');
            var modalInstance = bootstrap.Modal.getInstance(modalElem);
            if (modalInstance) modalInstance.hide();

            confirmTargetSession(selectedName);

            if (status === "Dolu") {
                loadTableActiveOrder(selectedId);
            } else {
                cart = [];
                existingCart = [];
                $("#txtOrderGeneralNote").val("");
                renderExistingOrders();
                renderCart();
            }
        });

        $grid.append($card);
    });
}

function loadCategories() {
    $.get("/Category/GetCategories?companyId=1", function (res) {
        if (res.success && res.data) {
            var html = `<button class="btn btn-primary category-btn active" onclick="filterCategory(0, this)">Tüm Ürünler</button>`;

            $.each(res.data, function (i, item) {
                var isFrozen = !item.IsActive;

                if (isFrozen) {
                    html += `
                        <button class="btn btn-outline-secondary category-btn opacity-50" 
                                disabled 
                                style="cursor: not-allowed;" 
                                title="Bu kategori dondurulmuştur.">
                            ${item.CategoryName} (Pasif)
                        </button>`;
                } else {
                    html += `
                        <button class="btn btn-outline-primary category-btn" 
                                onclick="filterCategory(${item.CategoryId}, this)">
                            ${item.CategoryName}
                        </button>`;
                }
            });

            $("#category-list").html(html);
        }
    });
}

function loadProducts(categoryId) {
    activeCategoryId = categoryId;
    $.get("/Order/GetProducts?companyId=1", function (res) {
        if (res.success && res.data) {
            currentRawProducts = res.data;
            renderProductsView();
        }
    });
}

function renderProductsView() {
    if (!currentRawProducts || currentRawProducts.length === 0) return;

    var availableProducts = currentRawProducts.filter(p => p.IsAvailable !== false && p.IsCategoryActive !== false);

    var filtered = activeCategoryId == 0
        ? availableProducts
        : availableProducts.filter(p => p.CategoryId == activeCategoryId);

    var $container = $("#product-list");
    $container.empty();

    if (filtered.length === 0) {
        $container.html('<div class="col-12 text-center py-4 text-muted"><i class="fa-solid fa-utensils me-2"></i>Bu kategoride gösterilecek ürün bulunamadı.</div>');
        return;
    }

    if (currentViewMode === "grid") {
        var html = "";
        $.each(filtered, function (i, p) {
            var imgUrl = p.ImageUrl || '/Content/images/default-food.png';
            var safeName = p.ProductName.replace(/'/g, "\\'");

            html += `
                <div class="col-md-4 mb-3">
                    <div class="card product-card p-2 shadow-sm border-0 h-100 position-relative">
                        <button class="btn btn-sm btn-light position-absolute top-0 end-0 m-2 rounded-circle shadow-sm p-1" 
                                style="width: 30px; height: 30px; z-index: 5;" 
                                onclick="openProductDetailModal(${p.ProductId})" 
                                title="Ayrıntıları Gör">
                            <i class="fa-solid fa-circle-info text-secondary"></i>
                        </button>

                        <img src="${imgUrl}" class="card-img-top rounded-3 mb-2" style="height: 105px; object-fit: cover;">
                        
                        <div class="card-body p-1 d-flex flex-column justify-content-between">
                            <div class="text-center mb-2">
                                <h6 class="fw-bold mb-1 text-dark" style="font-size: 0.88rem;">${p.ProductName}</h6>
                                <span class="fw-bold fs-6" style="color: #4a154b;">${parseFloat(p.Price).toFixed(2)} ₺</span>
                            </div>
                            
                            <button class="btn btn-sm btn-add-product w-100 rounded-3 fw-semibold py-1.5 mt-auto" 
                                    onclick="addToCart(${p.ProductId}, '${safeName}', ${p.Price})">
                                <i class="fa-solid fa-plus me-1"></i>Ekle
                            </button>
                        </div>
                    </div>
                </div>`;
        });
        $container.html(html);
    } else {
        var tableHtml = `
            <div class="col-12">
                <div class="card border-0 shadow-sm rounded-4 overflow-hidden">
                    <div class="table-responsive">
                        <table class="table table-hover align-middle mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th class="ps-3">Ürün Adı</th>
                                    <th>Kategori</th>
                                    <th class="text-end">Fiyat</th>
                                    <th class="text-end pe-3" style="width: 120px;">İşlem</th>
                                </tr>
                            </thead>
                            <tbody>`;

        $.each(filtered, function (i, p) {
            var safeName = p.ProductName.replace(/'/g, "\\'");
            tableHtml += `
                <tr>
                    <td class="ps-3 fw-semibold text-dark">
                        ${p.ProductName}
                        <i class="fa-solid fa-circle-info ms-1 text-muted cursor-pointer" style="font-size: 0.8rem;" onclick="openProductDetailModal(${p.ProductId})" title="Detay"></i>
                    </td>
                    <td><span class="badge bg-light text-dark border">${p.CategoryName || 'Genel'}</span></td>
                    <td class="text-end fw-bold" style="color: #4a154b;">${parseFloat(p.Price).toFixed(2)} ₺</td>
                    <td class="text-end pe-3">
                        <button class="btn btn-sm btn-add-product rounded-3 fw-semibold px-3" onclick="addToCart(${p.ProductId}, '${safeName}', ${p.Price})">
                            <i class="fa-solid fa-plus me-1"></i>Ekle
                        </button>
                    </td>
                </tr>`;
        });

        tableHtml += `
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`;
        $container.html(tableHtml);
    }
}

function openProductDetailModal(productId) {
    var product = currentRawProducts.find(p => p.ProductId == productId);
    if (product) {
        var safeName = product.ProductName.replace(/'/g, "\\'");

        $("#modalProductName").text(product.ProductName);
        $("#modalProductImage").attr("src", product.ImageUrl || '/Content/images/default-food.png');
        $("#modalProductCategory").text(product.CategoryName || 'Genel');
        $("#modalProductDescription").text(product.Description && product.Description.trim() !== "" ? product.Description : 'Bu ürün için detaylı açıklama girilmemiştir.');
        $("#modalProductPrice").text(parseFloat(product.Price).toFixed(2) + " ₺");

        $("#btnModalAddToCart").off("click").on("click", function () {
            addToCart(product.ProductId, safeName, product.Price);
            var modalElem = document.getElementById('productDetailModal');
            var modalInstance = bootstrap.Modal.getInstance(modalElem);
            if (modalInstance) modalInstance.hide();
        });

        var modal = new bootstrap.Modal(document.getElementById('productDetailModal'));
        modal.show();
    }
}

function filterCategory(catId, btn) {
    $(".category-btn").removeClass("active btn-primary").addClass("btn-outline-primary");
    $(btn).removeClass("btn-outline-primary").addClass("active btn-primary");
    loadProducts(catId);
}

// MENÜDEN TIKLANAN YENİ ÜRÜNÜ SADECE SIFIR SEPETE EKLEME
function addToCart(id, name, price) {
    if (!isTargetConfirmed) {
        openInitialModal();
        return;
    }

    var item = cart.find(x => x.id === id);
    if (item) {
        item.quantity += 1;
    } else {
        cart.push({ id: id, name: name, price: price, quantity: 1 });
    }
    renderCart();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: name + ' eklendi',
        showConfirmButton: false,
        timer: 1000
    });
}

function updateQuantity(id, change) {
    var item = cart.find(x => x.id === id);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            removeFromCart(id);
            return;
        }
    }
    renderCart();
}

function removeFromCart(id) {
    cart = cart.filter(x => x.id !== id);
    renderCart();
}

function renderCart() {
    var html = "";
    $.each(cart, function (i, item) {
        html += `
            <tr>
                <td class="fw-semibold text-dark small">${item.name}</td>
                <td>
                    <div class="d-flex align-items-center gap-1">
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="updateQuantity(${item.id}, -1)">-</button>
                        <span class="fw-bold px-1 small">${item.quantity}</span>
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="updateQuantity(${item.id}, 1)">+</button>
                    </div>
                </td>
                <td class="fw-bold text-end small">${(item.price * item.quantity).toFixed(2)} ₺</td>
                <td class="text-center">
                    <button class="btn btn-sm text-danger p-0 border-0" onclick="removeFromCart(${item.id})" title="Sepetten Çıkar">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>`;
    });

    if (cart.length === 0) {
        html = '<tr><td colspan="4" class="text-center py-4 text-muted">Henüz yeni ürün eklenmedi.</td></tr>';
    }

    $("#cart-items").html(html);

    var grandTotal = calculateExistingTotal() + calculateNewCartTotal();
    $("#total-price").text(grandTotal.toFixed(2) + " ₺");
}

function calculateExistingTotal() {
    return existingCart.reduce((sum, x) => sum + (x.price * x.quantity), 0);
}

function calculateNewCartTotal() {
    return cart.reduce((sum, x) => sum + (x.price * x.quantity), 0);
}

function calculateTotal() {
    return calculateNewCartTotal();
}