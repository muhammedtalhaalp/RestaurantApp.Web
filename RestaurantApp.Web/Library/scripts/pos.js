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
var cart = [];
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

    $("#orderType").on("change", function () {
        var selectedType = $(this).val();
        if (selectedType === "PaketServis") {
            $("#tableSelectGroup").slideUp();
            $("#deliveryGroup").slideDown(function () {
                if (map) {
                    google.maps.event.trigger(map, 'resize');
                    map.setCenter(marker.getPosition());
                }
            });
        } else {
            $("#deliveryGroup").slideUp();
            $("#tableSelectGroup").slideDown();
        }
    });

    $("#btnOpenTableModal").on("click", function () {
        renderPosTableCards("Hepsi");
        var myModal = new bootstrap.Modal(document.getElementById('posTableMapModal'));
        myModal.show();
    });

    $(document).on("click", "#posSectionTabs .nav-link", function () {
        $("#posSectionTabs .nav-link").removeClass("active");
        $(this).addClass("active");

        var selectedSection = $(this).data("section");
        renderPosTableCards(selectedSection);
    });

    $("#btn-submit-order").on("click", function () {
        if (cart.length === 0) {
            Swal.fire("Uyarı", "Sepetinizde ürün bulunmamaktadır.", "warning");
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

// ADIM 1: SİPARİŞ HEDEFİNİ ONAYLAMA VE MENÜYÜ AÇMA
function confirmTargetAndStartOrder() {
    var orderType = $("#orderType").val();
    var tableId = $("#tableId").val();
    var address = ($("#txtDeliveryAddress").val() || "").trim();
    var targetText = "";

    if (orderType === "Masa") {
        if (!tableId || tableId === "" || tableId === "0") {
            Swal.fire({
                title: "Masa Seçilmedi!",
                text: "Lütfen menüyü açmadan önce geçerli bir masa seçiniz.",
                icon: "warning",
                confirmButtonColor: "#4a154b"
            });
            return;
        }

        var selectedTable = posTablesData.find(t => t.tableId == tableId);
        targetText = selectedTable ? selectedTable.tableName : `Masa #${tableId}`;
    } else if (orderType === "PaketServis") {
        if (!address) {
            Swal.fire({
                title: "Teslimat Adresi Eksik!",
                text: "Lütfen paket servis için açık adresi giriniz.",
                icon: "warning",
                confirmButtonColor: "#4a154b"
            });
            return;
        }
        targetText = "Paket Servis (" + (address.length > 20 ? address.substring(0, 20) + "..." : address) + ")";
    }

    isTargetConfirmed = true;

    // Arayüz Kilidini Aç
    $("#menuCatalogContainer").removeClass("step-locked");
    $("#lblSelectedTargetName").text(targetText);
    $("#targetSelectedBadge").removeClass("d-none");

    // Sağ Paneli 2. Adıma Geçir
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

// SİPARİŞ HEDEFİNİ SIFIRLAMA / DEĞİŞTİRME
function resetTargetSelection() {
    if (cart.length > 0) {
        Swal.fire({
            title: "Masa / Adres Değiştirilsin mi?",
            text: "Hedef değiştirilirse sepetinizdeki ürünler temizlenecektir!",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "Evet, Değiştir",
            cancelButtonText: "Vazgeç"
        }).then((result) => {
            if (result.isConfirmed) {
                cart = [];
                renderCart();
                executeResetTargetUI();
            }
        });
    } else {
        executeResetTargetUI();
    }
}

function executeResetTargetUI() {
    isTargetConfirmed = false;
    $("#menuCatalogContainer").addClass("step-locked");
    $("#targetSelectedBadge").addClass("d-none");

    $("#stepCartPanel").slideUp(function () {
        $("#stepTargetSelectionPanel").slideDown();
    });
}

function executeSubmitOrder(orderType, tableId, address, lat, lng) {
    var orderData = {
        OrderType: orderType,
        TableId: orderType === "Masa" ? parseInt(tableId) : null,
        DeliveryAddress: orderType === "PaketServis" ? address : null,
        Latitude: orderType === "PaketServis" ? lat : null,
        Longitude: orderType === "PaketServis" ? lng : null,
        TotalAmount: calculateTotal(),
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
            $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-2"></i>Siparişi Onayla');
            if (response.success) {
                Swal.fire("Başarılı!", response.message, "success");
                cart = [];
                renderCart();
                $("#txtDeliveryAddress").val("");
                loadTables();

                // Oturumu tamamlandıktan sonra tekrar Adım 1'e döndür
                executeResetTargetUI();
            } else {
                Swal.fire("Hata", response.message, "error");
            }
        },
        error: function () {
            $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-2"></i>Siparişi Onayla');
            Swal.fire("Hata", "Sipariş gönderilirken sunucu hatası oluştu.", "error");
        }
    });
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
                    var amountVal = parseFloat(t.currentAmount || 0).toFixed(2);
                    var statusBadge = t.status === "Dolu" ? ` (Dolu - ${amountVal} ₺)` : " (Boş)";
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
        var isOccupied = t.status === "Dolu";
        var cardClass = isOccupied ? "table-card-occupied" : "table-card-empty";
        var badgeClass = isOccupied ? "bg-danger text-white" : "bg-success text-white";
        var amountVal = parseFloat(t.currentAmount || 0).toFixed(2);
        var statusText = isOccupied ? `Dolu (${amountVal} ₺)` : "Boş";

        var cardHtml = `
            <div class="col-md-3 col-sm-6">
                <div class="pos-table-card ${cardClass}" data-id="${t.tableId}" data-name="${t.tableNumber}">
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

            $("#tableId").val(selectedId);

            var modalElem = document.getElementById('posTableMapModal');
            var modalInstance = bootstrap.Modal.getInstance(modalElem);
            if (modalInstance) modalInstance.hide();

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: selectedName + ' seçildi!',
                showConfirmButton: false,
                timer: 1200
            });
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
                            
                            <button class="btn btn-sm btn-purple w-100 rounded-3 fw-semibold py-1 mt-auto" 
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
                        <button class="btn btn-sm btn-purple rounded-3 fw-semibold px-3" onclick="addToCart(${p.ProductId}, '${safeName}', ${p.Price})">
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

function addToCart(id, name, price) {
    if (!isTargetConfirmed) {
        Swal.fire("Uyarı", "Lütfen önce sağ taraftan sipariş hedefini seçip oturumu başlatınız.", "warning");
        return;
    }

    var item = cart.find(x => x.id === id);
    if (item) {
        item.quantity++;
    } else {
        cart.push({ id: id, name: name, price: price, quantity: 1 });
    }
    renderCart();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: name + ' sepete eklendi',
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
        html = '<tr><td colspan="4" class="text-center py-4 text-muted">Sepetiniz boş.</td></tr>';
    }

    $("#cart-items").html(html);
    $("#total-price").text(calculateTotal().toFixed(2) + " ₺");
}

function calculateTotal() {
    return cart.reduce((sum, x) => sum + (x.price * x.quantity), 0);
}