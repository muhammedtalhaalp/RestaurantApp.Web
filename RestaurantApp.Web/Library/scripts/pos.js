// Global AJAX Ayarı (JWT Token Otomatik Eklenir)
$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

// HARİTA VE SEPET DEĞİŞKENLERİ
var map;
var marker;
var cart = [];
var defaultLat = 41.0082;
var defaultLng = 28.9784;

// 1. Leaflet.js Harita Başlatma (Görev 3.3)
function initMap() {
    map = L.map('map').setView([defaultLat, defaultLng], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Sürüklenebilir Pin
    marker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(map);
    updateCoordinates(defaultLat, defaultLng);

    // Tıklanan yere pini taşı
    map.on('click', function (e) {
        var lat = e.latlng.lat;
        var lng = e.latlng.lng;
        marker.setLatLng([lat, lng]);
        updateCoordinates(lat, lng);
    });

    // Pin sürüklendiğinde koordinatları al
    marker.on('dragend', function () {
        var position = marker.getLatLng();
        updateCoordinates(position.lat, position.lng);
    });
}

function updateCoordinates(lat, lng) {
    $("#latitude").val(lat);
    $("#longitude").val(lng);
}

$(document).ready(function () {
    console.log("POS JS Yüklendi.");

    if ($('#map').length) {
        initMap();
    }

    loadCategories();
    loadProducts(0);
    loadTables();

    // Sipariş Türü Değişimi
    $("#orderType").on("change", function () {
        var selectedType = $(this).val();
        if (selectedType === "PaketServis") {
            $("#tableSelectGroup").slideUp();
            $("#deliveryGroup").slideDown(function () {
                if (map) {
                    setTimeout(function () { map.invalidateSize(); }, 200);
                }
            });
        } else {
            $("#deliveryGroup").slideUp();
            $("#tableSelectGroup").slideDown();
        }
    });

    // Siparişi Onayla Butonu (Görev 3.4 - API Gönderimi)
    $("#btn-submit-order").on("click", function () {
        if (cart.length === 0) {
            Swal.fire("Uyarı", "Sepetinizde ürün bulunmamaktadır.", "warning");
            return;
        }

        var orderType = $("#orderType").val();
        var tableId = $("#tableId").val();
        var address = $("#txtDeliveryAddress").val();
        var lat = parseFloat($("#latitude").val());
        var lng = parseFloat($("#longitude").val());

        if (orderType === "PaketServis" && (!address || address.trim() === "")) {
            Swal.fire("Eksik Bilgi", "Lütfen teslimat adresi giriniz.", "warning");
            return;
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

// Yardımcı Yükleme Fonksiyonları
function loadCategories() {
    $.get("/Admin/GetCategories?companyId=1", function (res) {
        if (res.success && res.data) {
            var html = `<button class="btn btn-primary category-btn active" onclick="filterCategory(0, this)">Tüm Ürünler</button>`;
            $.each(res.data, function (i, item) {
                html += `<button class="btn btn-outline-primary category-btn" onclick="filterCategory(${item.CategoryId}, this)">${item.CategoryName}</button>`;
            });
            $("#category-list").html(html);
        }
    });
}

function loadProducts(categoryId) {
    $.get("/Admin/GetProducts?companyId=1", function (res) {
        if (res.success && res.data) {
            var filtered = categoryId === 0 ? res.data : res.data.filter(p => p.CategoryId === categoryId);
            var html = "";
            $.each(filtered, function (i, p) {
                html += `
                    <div class="col-md-4">
                        <div class="card product-card p-3 shadow-sm border-0" onclick="addToCart(${p.ProductId}, '${p.ProductName}', ${p.Price})">
                            <h6 class="fw-bold mb-1">${p.ProductName}</h6>
                            <span class="text-success fw-semibold">${p.Price} ₺</span>
                        </div>
                    </div>`;
            });
            $("#product-list").html(html);
        }
    });
}

$(document).ready(function () {
    console.log("POS JS Yüklendi.");

    if ($('#map').length) {
        initMap();
    }

    // Masaları en başta, bağımsız olarak çağırıyoruz
    loadTables();
    loadCategories();
    loadProducts(0);

    // Sipariş Türü Değişimi
    $("#orderType").on("change", function () {
        var selectedType = $(this).val();
        if (selectedType === "PaketServis") {
            $("#tableSelectGroup").slideUp();
            $("#deliveryGroup").slideDown(function () {
                if (map) {
                    setTimeout(function () { map.invalidateSize(); }, 200);
                }
            });
        } else {
            $("#deliveryGroup").slideUp();
            $("#tableSelectGroup").slideDown();
        }
    });
});

function loadTables() {
    console.log("loadTables() tetiklendi, istek atılıyor...");
    $.ajax({
        url: "/Order/GetTables",
        type: "GET",
        cache: false,
        success: function (res) {
            console.log("GetTables Cevabı:", res);
            if (res.success && res.data && res.data.length > 0) {
                var html = '<option value="">Masa Seçiniz...</option>';
                $.each(res.data, function (i, t) {
                    html += `<option value="${t.tableId}">${t.tableName}</option>`;
                });
                $("#tableId").html(html);
            } else {
                $("#tableId").html('<option value="">Kayıtlı Aktif Masa Bulunamadı</option>');
            }
        },
        error: function (xhr, status, error) {
            console.error("Masa Yükleme AJAX Hatası:", status, error, xhr.responseText);
            $("#tableId").html('<option value="">Masa Yükleme Hatası</option>');
        }
    });
}

function filterCategory(catId, btn) {
    $(".category-btn").removeClass("active btn-primary").addClass("btn-outline-primary");
    $(btn).removeClass("btn-outline-primary").addClass("active btn-primary");
    loadProducts(catId);
}

// Sepet Yöneticisi
function addToCart(id, name, price) {
    var item = cart.find(x => x.id === id);
    if (item) {
        item.quantity++;
    } else {
        cart.push({ id: id, name: name, price: price, quantity: 1 });
    }
    renderCart();
}

function updateQuantity(id, change) {
    var item = cart.find(x => x.id === id);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            cart = cart.filter(x => x.id !== id);
        }
    }
    renderCart();
}

function renderCart() {
    var html = "";
    $.each(cart, function (i, item) {
        html += `
            <tr>
                <td>${item.name}</td>
                <td>
                    <button class="btn btn-sm btn-light py-0 px-2" onclick="updateQuantity(${item.id}, -1)">-</button>
                    <span class="mx-1">${item.quantity}</span>
                    <button class="btn btn-sm btn-light py-0 px-2" onclick="updateQuantity(${item.id}, 1)">+</button>
                </td>
                <td>${(item.price * item.quantity).toFixed(2)} ₺</td>
            </tr>`;
    });
    $("#cart-items").html(html);
    $("#total-price").text(calculateTotal().toFixed(2) + " ₺");
}

function calculateTotal() {
    return cart.reduce((sum, x) => sum + (x.price * x.quantity), 0);
}