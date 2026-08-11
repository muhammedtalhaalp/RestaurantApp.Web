$(document).ready(function () {
    loadMenuData();
});

// 1. QR Menü Verilerini Yükle (Slider, Popüler Ürünler, Kategoriler)
function loadMenuData() {
    $.ajax({
        url: "/Menu/GetMenuData",
        type: "GET",
        cache: false,
        success: function (res) {
            if (res && res.success && res.data) {
                var d = res.data;

                renderSlider(d.sliderImages);
                renderPopularProducts(d.popularProducts);
                renderCategories(d.categories);
            } else {
                console.error("Menü verisi alınamadı:", res ? res.message : "Sunucu hatası");
            }
        },
        error: function (err) {
            console.error("AJAX Hatası:", err);
        }
    });
}

// 2. Üst Banner Carousel Slider Çizimi
function renderSlider(images) {
    var $container = $("#sliderContainer");
    $container.empty();

    if (!images || images.length === 0) {
        $container.html(`
            <div class="carousel-item active">
                <img src="/Content/images/default-food.png" class="d-block w-100 slider-img" alt="LezzetPOS">
            </div>
        `);
        return;
    }

    $.each(images, function (i, item) {
        var activeClass = i === 0 ? "active" : "";
        var html = `
            <div class="carousel-item ${activeClass}">
                <img src="${item.imageUrl}" class="d-block w-100 slider-img" alt="${item.productName || 'Menü'}">
            </div>
        `;
        $container.append(html);
    });
}

// 3. En Çok Tercih Edilenler Yatay Listesi
function renderPopularProducts(products) {
    var $container = $("#popularContainer");
    $container.empty();

    if (!products || products.length === 0) {
        $container.html('<div class="text-muted small py-2">Öne çıkan ürün bulunmuyor.</div>');
        return;
    }

    $.each(products, function (i, p) {
        var priceVal = parseFloat(p.price || 0).toFixed(2);
        var html = `
            <div class="popular-card">
                <img src="${p.imageUrl}" alt="${p.productName}">
                <div class="product-title">${p.productName}</div>
                <div class="product-price">${priceVal} ₺</div>
            </div>
        `;
        $container.append(html);
    });
}

// 4. Kategoriler (2'li Grid Kartlar)
function renderCategories(categories) {
    var $container = $("#categoriesContainer");
    $container.empty();

    if (!categories || categories.length === 0) {
        $container.html('<div class="col-12 text-center text-muted py-4">Henüz kayıtlı kategori bulunmuyor.</div>');
        return;
    }

    $.each(categories, function (i, c) {
        var html = `
            <div class="col-6">
                <div class="category-card" style="background-image: url('${c.imageUrl}');" onclick="openCategoryProducts(${c.categoryId}, '${c.categoryName.replace(/'/g, "\\'")}')">
                    <div class="category-card-overlay">
                        <span class="category-name">${c.categoryName}</span>
                    </div>
                </div>
            </div>
        `;
        $container.append(html);
    });
}

// 5. Kategoriye Tıklanınca Ürünleri Modal İçinde Açma
function openCategoryProducts(categoryId, categoryName) {
    $("#modalCategoryTitle").html(`<i class="fa-solid fa-utensils me-2" style="color: #4a154b;"></i>${categoryName}`);

    var $list = $("#categoryProductsList");
    $list.html(`
        <div class="text-center py-5 text-muted">
            <div class="spinner-border text-purple mb-2" role="status"></div>
            <div>Ürünler yükleniyor...</div>
        </div>
    `);

    // Modalı aç
    var modalEl = document.getElementById('categoryProductsModal');
    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();

    // Ürünleri Çek
    $.ajax({
        url: "/Menu/GetProductsByCategory",
        type: "GET",
        data: { categoryId: categoryId },
        success: function (res) {
            if (res && res.success && res.data) {
                renderCategoryProductItems(res.data);
            } else {
                $list.html('<div class="text-center py-4 text-muted">Bu kategoride henüz ürün bulunmuyor.</div>');
            }
        },
        error: function () {
            $list.html('<div class="text-center py-4 text-danger">Ürünler yüklenirken hata oluştu.</div>');
        }
    });
}

// 6. Modal İçindeki Ürün Listesi Çizimi
function renderCategoryProductItems(products) {
    var $list = $("#categoryProductsList");
    $list.empty();

    if (!products || products.length === 0) {
        $list.html('<div class="text-center py-4 text-muted">Bu kategoride henüz ürün bulunmuyor.</div>');
        return;
    }

    $.each(products, function (i, p) {
        var priceVal = parseFloat(p.price || 0).toFixed(2);
        var descHtml = p.description ? `<div class="menu-product-desc">${p.description}</div>` : '';
        var unavailableBadge = !p.isAvailable ? '<span class="badge bg-danger ms-1 extra-small">Tükendi</span>' : '';

        var html = `
            <div class="menu-product-item">
                <img src="${p.imageUrl}" class="menu-product-img" alt="${p.productName}">
                <div class="menu-product-info">
                    <div class="menu-product-name">${p.productName} ${unavailableBadge}</div>
                    ${descHtml}
                    <div class="menu-product-price">${priceVal} ₺</div>
                </div>
            </div>
        `;
        $list.append(html);
    });
}