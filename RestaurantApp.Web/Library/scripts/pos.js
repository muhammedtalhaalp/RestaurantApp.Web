// Global AJAX Ayarı (JWT Token Otomatik Eklenir)
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
var defaultLat = 41.0082; // İstanbul Varsayılan Lat
var defaultLng = 28.9784; // İstanbul Varsayılan Lng
var posTablesData = [];
var currentRawProducts = [];

// GOOGLE MAPS İNİTİALİZE FONKSİYONU
function initGoogleMap() {
    var defaultLocation = { lat: defaultLat, lng: defaultLng };

    // 1. Haritayı Oluştur
    map = new google.maps.Map(document.getElementById('map'), {
        center: defaultLocation,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
    });

    // 2. Geocoder & Sürüklenip-Tıklanabilir Marker
    geocoder = new google.maps.Geocoder();
    marker = new google.maps.Marker({
        position: defaultLocation,
        map: map,
        draggable: true,
        animation: google.maps.Animation.DROP
    });

    updateCoordinates(defaultLat, defaultLng);

    // 3. Haritaya Tıklandığında Pini Oraya Taşı ve Onay Sor
    map.addListener('click', function (e) {
        var clickedLat = e.latLng.lat();
        var clickedLng = e.latLng.lng();

        marker.setPosition(e.latLng);
        updateCoordinates(clickedLat, clickedLng);
        askAndUpdateAddress(e.latLng);
    });

    // 4. Pin Sürüklendiğinde Bırakıldığı Yerin Adresi İçin Onay Sor
    marker.addListener('dragend', function () {
        var pos = marker.getPosition();
        updateCoordinates(pos.lat(), pos.lng());
        askAndUpdateAddress(pos);
    });

    // 5. Places Autocomplete (Üst Adres Kutusundan Seçim Yapılınca)
    var input = document.getElementById('txtDeliveryAddress');
    autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo('bounds', map);

    // Otomatik Adres Seçildiğinde Pini ve Haritayı Oraya Taşı
    autocomplete.addListener('place_changed', function () {
        var place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) {
            return;
        }

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

// ONAYLI ADRES GÜNCELLEME FONKSİYONU (Harita Tıklama/Sürükleme İçin)
function askAndUpdateAddress(latLng) {
    if (!geocoder) return;

    geocoder.geocode({ 'location': latLng }, function (results, status) {
        if (status === 'OK' && results[0]) {
            var fetchedAddress = results[0].formatted_address;
            var currentAddress = ($("#txtDeliveryAddress").val() || "").trim();

            // Kutudaki mevcut adres ile haritadan gelen adres farklıysa onay sor
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
                // Adres kutusu henüz boşsa direkt yaz
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

    // Sipariş Türü Değiştiğinde Alanları Göster/Gizle
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

    // SİPARİŞİ ONAYLA BUTONU
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

        if (orderType === "Masa") {
            if (!tableId || tableId === "" || tableId === "0") {
                Swal.fire({
                    title: "Masa Seçilmedi!",
                    text: "Lütfen siparişi onaylamadan önce bir masa seçiniz.",
                    icon: "warning",
                    confirmButtonColor: "#4a154b"
                });
                return;
            }
        }

        if (orderType === "PaketServis") {
            if (!address) {
                Swal.fire({
                    title: "Teslimat Adresi Eksik!",
                    text: "Lütfen paket servis için teslimat adresini giriniz.",
                    icon: "warning",
                    confirmButtonColor: "#4a154b"
                });
                return;
            }
        }

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

        var $btn = $(this);
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
                } else {
                    Swal.fire("Hata", response.message, "error");
                }
            },
            error: function () {
                $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-2"></i>Siparişi Onayla');
                Swal.fire("Hata", "Sipariş gönderilirken sunucu hatası oluştu.", "error");
            }
        });
    });
});

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
                    var statusBadge = t.status === "Dolu" ? " (Dolu)" : " (Boş)";
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
        var statusText = isOccupied ? "Dolu" : "Boş";

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
                timer: 1500
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
                        <button class="btn btn-outline-secondary category-btn opacity-50 position-relative" 
                                disabled 
                                style="cursor: not-allowed; border-style: dashed;" 
                                title="Bu kategori dondurulmuştur.">
                            ${item.CategoryName}
                            <span class="badge bg-info text-dark rounded-pill ms-1" style="font-size:0.65rem;"><i class="fa-solid fa-snowflake me-1"></i>Donduruldu</span>
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
    $.get("/Order/GetProducts?companyId=1", function (res) {
        if (res.success && res.data) {
            currentRawProducts = res.data;
            var availableProducts = res.data.filter(p => p.IsAvailable !== false);

            var filtered = categoryId == 0
                ? availableProducts
                : availableProducts.filter(p => p.CategoryId == categoryId);

            var html = "";
            if (filtered.length === 0) {
                html = '<div class="col-12 text-center py-4 text-muted"><i class="fa-solid fa-utensils me-2"></i>Bu kategoride gösterilecek ürün bulunamadı.</div>';
            } else {
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
            }
            $("#product-list").html(html);
        }
    });
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