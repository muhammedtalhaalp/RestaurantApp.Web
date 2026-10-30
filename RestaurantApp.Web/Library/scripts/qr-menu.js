// MÜŞTERİ QR MENÜSÜ (Views/Menu/Index.cshtml)
// Restoran, QR koddaki adresten bulunur: /Menu/Index?tableId=5 veya /Menu/Index?companyId=1.
// Bütün veri tek istekte gelir (MenuController.GetMenuData); arama ve kategori geçişi tarayıcıda yapılır.

var menuData = null;
var productsById = {};

$(document).ready(function () {
    loadMenuData();

    $("#menuSearch").on("input", function () {
        var query = $(this).val();
        $("#searchClear").toggleClass("d-none", !query);
        applySearch(query);
    });

    $("#searchClear").on("click", function () {
        $("#menuSearch").val("").trigger("input").focus();
    });

    $(document).on("click", "[data-product-id]", function () {
        openProduct(Number($(this).data("product-id")));
    });

    $(document).on("click", ".chip[data-target]", function () {
        var target = document.getElementById($(this).data("target"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Çubuk sayfanın üstüne yapışınca köşeleri düzleşir
    var toolbar = document.getElementById("menuToolbar");
    var observer = new IntersectionObserver(function (entries) {
        toolbar.classList.toggle("is-stuck", entries[0].intersectionRatio < 1);
    }, { threshold: [1], rootMargin: "-1px 0px 0px 0px" });
    observer.observe(toolbar);
});

function loadMenuData() {
    var urlParams = new URLSearchParams(window.location.search);
    var menuQuery = {};
    if (urlParams.get("tableId")) menuQuery.tableId = urlParams.get("tableId");
    if (urlParams.get("companyId")) menuQuery.companyId = urlParams.get("companyId");

    // Adreste restoran bilgisi yoksa (QR yerine adres elle açılmış) sunucuya gitmeye gerek yok
    if (!menuQuery.tableId && !menuQuery.companyId) {
        showMenuError("Menü bulunamadı. Lütfen masadaki QR kodu tekrar okutun.");
        return;
    }

    $.ajax({
        url: "/Menu/GetMenuData",
        type: "GET",
        data: menuQuery,
        cache: false,
        success: function (res) {
            if (res && res.success && res.data) {
                $("#menuSkeleton").remove();
                menuData = res.data;
                renderMenu(res.data);
            } else {
                showMenuError((res && res.message) || "Menü yüklenemedi. Lütfen QR kodu tekrar okutun.");
            }
        },
        error: function () {
            showMenuError("Menü şu an yüklenemedi. Lütfen biraz sonra tekrar deneyin.");
        }
    });
}

function renderMenu(d) {
    document.title = d.restaurantName + " · Menü";
    $("#restaurantName").text(d.restaurantName);
    if (d.tableName) {
        $("#tableName").text(d.tableName);
        $("#tableBadge").removeClass("d-none");
    }

    d.products.forEach(function (p) { productsById[p.productId] = p; });

    // Ürünü olmayan kategori gösterilmez
    var categories = d.categories.filter(function (c) {
        return d.products.some(function (p) { return p.categoryId === c.categoryId; });
    });

    renderPopular(d.popularProductIds.map(function (id) { return productsById[id]; }).filter(Boolean));
    renderCategories(categories, d.products);

    if (!categories.length) {
        showEmpty("Menüde henüz ürün bulunmuyor.");
    }
}

function renderPopular(products) {
    if (!products.length) return;

    var html = products.map(function (p) {
        return `
            <div class="popular-card" data-product-id="${p.productId}">
                <img src="${escapeAttr(p.imageUrl)}" alt="${escapeAttr(p.productName)}" loading="lazy" onerror="this.src='/Content/images/default-food.png'">
                <div class="info">
                    <div class="name">${escapeHtml(p.productName)}</div>
                    <div class="price">${formatPrice(p.price)}</div>
                </div>
            </div>`;
    }).join("");

    $("#popularContainer").html(html);
    $("#popularSection").removeClass("d-none");
}

function renderCategories(categories, products) {
    var chips = "";
    var sections = "";

    categories.forEach(function (c, index) {
        var items = products.filter(function (p) { return p.categoryId === c.categoryId; });
        var sectionId = "cat-" + c.categoryId;

        chips += `<button type="button" class="chip ${index === 0 ? "active" : ""}" data-target="${sectionId}">${escapeHtml(c.categoryName)}</button>`;

        sections += `
            <section class="category-section" id="${sectionId}" data-category-id="${c.categoryId}">
                <h2 class="section-title">${escapeHtml(c.categoryName)}<span class="count">${items.length} ürün</span></h2>
                ${items.map(productCardHtml).join("")}
            </section>`;
    });

    $("#categoryChips").html(chips);
    $("#categorySections").html(sections);
    watchActiveCategory();
}

function productCardHtml(p) {
    return `
        <article class="product-card ${p.isAvailable ? "" : "is-sold-out"}" data-product-id="${p.productId}" data-search="${escapeAttr(searchKey(p.productName + " " + (p.description || "")))}">
            <div class="body">
                <div class="name">${escapeHtml(p.productName)}</div>
                ${p.description ? `<div class="desc">${escapeHtml(p.description)}</div>` : ""}
                <div class="bottom">
                    <span class="price">${formatPrice(p.price)}</span>
                    ${p.isAvailable ? "" : '<span class="sold-out"><i class="fa-solid fa-ban me-1"></i>Tükendi</span>'}
                </div>
            </div>
            <div class="thumb">
                <img src="${escapeAttr(p.imageUrl)}" alt="${escapeAttr(p.productName)}" loading="lazy" onerror="this.src='/Content/images/default-food.png'">
            </div>
        </article>`;
}

// Kaydırırken ekrandaki kategorinin düğmesi vurgulanır ve görünür alana kaydırılır
function watchActiveCategory() {
    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var $chip = $('.chip[data-target="' + entry.target.id + '"]');
            if ($chip.hasClass("active")) return;
            $(".chip").removeClass("active");
            $chip.addClass("active");
            $chip[0].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        });
    }, { rootMargin: "-140px 0px -60% 0px" });

    document.querySelectorAll(".category-section").forEach(function (s) { observer.observe(s); });
}

function applySearch(query) {
    if (!menuData) return; // menü yüklenmeden arama yapılmaz (hata mesajının üzerine yazmasın)
    var key = searchKey(query.trim());
    var anyVisible = false;

    $(".category-section").each(function () {
        var visibleInSection = 0;
        $(this).find(".product-card").each(function () {
            var match = !key || $(this).data("search").indexOf(key) !== -1;
            $(this).toggleClass("d-none", !match);
            if (match) visibleInSection++;
        });
        $(this).toggleClass("d-none", visibleInSection === 0);
        if (visibleInSection) anyVisible = true;
    });

    // Arama yapılırken öne çıkanlar ve kategori düğmeleri gizlenir
    $("#popularSection").toggleClass("d-none", !!key || !$("#popularContainer").children().length);
    $("#categoryChips").toggleClass("d-none", !!key);

    if (anyVisible) {
        $("#menuEmpty").addClass("d-none");
    } else {
        showEmpty("“" + query.trim() + "” için ürün bulunamadı.");
    }
}

function openProduct(productId) {
    var p = productsById[productId];
    if (!p) return;

    var category = menuData.categories.find(function (c) { return c.categoryId === p.categoryId; });
    $("#sheetImage").attr({ src: p.imageUrl, alt: p.productName }).off("error").on("error", function () {
        this.src = "/Content/images/default-food.png";
    });
    $("#sheetCategory").text(category ? category.categoryName : "");
    $("#sheetTitle").text(p.productName);
    $("#sheetDesc").text(p.description || "");
    $("#sheetPrice").text(formatPrice(p.price));
    $("#sheetSoldOut").toggleClass("d-none", p.isAvailable);

    bootstrap.Modal.getOrCreateInstance(document.getElementById("productModal")).show();
}

// Menü hiç yüklenemediğinde: arama çubuğu gizlenir, yalnızca açıklayıcı mesaj kalır
function showMenuError(message) {
    $("#menuSkeleton").remove();
    $("#restaurantName").text("Menü");
    $("#menuToolbar").addClass("d-none");
    showEmpty(message);
}

function showEmpty(message) {
    $("#menuEmptyText").text(message);
    $("#menuEmpty").removeClass("d-none");
}

function formatPrice(value) {
    return Number(value || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
}

// Türkçe büyük/küçük harf ve noktalı/noktasız i farkı aramayı etkilemesin
function searchKey(text) {
    return (text || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escapeHtml(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
}

function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, "&quot;");
}
