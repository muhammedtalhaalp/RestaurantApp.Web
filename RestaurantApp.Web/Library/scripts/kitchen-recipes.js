$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var allRecipesData = [];
var currentActiveCategoryId = 0;
var selectedRecipeForModal = null;

$(document).ready(function () {
    console.log("Kitchen Recipes JS Yüklendi.");
    loadRecipes(0);

    $("#btnOpenEditRecipeModal").on("click", function () {
        if (selectedRecipeForModal) {
            openEditRecipeModal(selectedRecipeForModal);
        }
    });
});

function selectRecipeCategory(catId, btnEl) {
    currentActiveCategoryId = catId;
    $(".btn-category-recipe").removeClass("active");
    $(btnEl).addClass("active");

    loadRecipes(catId);
}

function loadRecipes(categoryId) {
    $.ajax({
        url: "/Kitchen/GetRecipesData",
        type: "GET",
        data: { categoryId: categoryId },
        cache: false,
        success: function (res) {
            if (res.success && res.data) {
                allRecipesData = res.data.recipes || [];
                renderCategoriesBar(res.data.categories || []);
                renderRecipeCards(allRecipesData);
            } else {
                Swal.fire("Uyarı", res.message || "Reçeteler yüklenemedi.", "warning");
            }
        },
        error: function () {
            $("#recipesCardGrid").html('<div class="col-12 text-center text-danger py-5">Reçeteler yüklenirken sunucu hatası oluştu.</div>');
        }
    });
}

function renderCategoriesBar(categories) {
    var $bar = $("#recipeCategoriesBar");
    var currentActive = currentActiveCategoryId;

    var html = `
        <button class="btn btn-category-recipe ${currentActive === 0 ? 'active' : ''} shadow-sm" data-id="0" onclick="selectRecipeCategory(0, this)">
            <i class="fa-solid fa-layer-group me-1"></i>Tüm Menü
        </button>
    `;

    $.each(categories, function (i, cat) {
        var isActive = currentActive === cat.categoryId ? "active" : "";
        html += `
            <button class="btn btn-category-recipe ${isActive} shadow-sm" data-id="${cat.categoryId}" onclick="selectRecipeCategory(${cat.categoryId}, this)">
                ${cat.categoryName}
            </button>
        `;
    });

    $bar.html(html);
}

function renderRecipeCards(recipes) {
    var $grid = $("#recipesCardGrid").empty();

    if (!recipes || recipes.length === 0) {
        $grid.html('<div class="col-12 text-center py-5 text-muted"><i class="fa-solid fa-book-open fs-1 opacity-25 mb-3"></i><h5>Bu kategoride ürün bulunamadı.</h5></div>');
        return;
    }

    $.each(recipes, function (i, r) {
        var imgUrl = r.imageUrl || '/Content/images/default-food.png';
        var parsedRecipe = tryParseRecipeJson(r.description);
        var hasRecipe = parsedRecipe && parsedRecipe.hasRecipe === true;

        var statusBadge = hasRecipe
            ? `<span class="badge bg-success bg-opacity-75 position-absolute bottom-0 start-0 m-2 extra-small rounded-pill"><i class="fa-solid fa-check me-1"></i>${parsedRecipe.cookTime || 'Reçeteli'}</span>`
            : `<span class="badge bg-secondary bg-opacity-75 position-absolute bottom-0 start-0 m-2 extra-small rounded-pill"><i class="fa-solid fa-circle-question me-1"></i>Reçete Yok</span>`;

        var cardHtml = `
            <div class="col-6 col-md-4 col-lg-3 col-xl-2.4 recipe-item-col mb-3" data-name="${r.productName.toLowerCase()}">
                <div class="card recipe-card h-100 shadow-sm" onclick="openRecipeDetailModal(${r.productId})">
                    <div class="position-relative">
                        <img src="${imgUrl}" class="recipe-card-img" onerror="this.src='/Content/images/default-food.png'">
                        ${statusBadge}
                    </div>
                    <div class="card-body p-2.5 d-flex flex-column justify-content-between">
                        <div>
                            <span class="badge bg-purple-light text-purple-main extra-small mb-1">${r.categoryName}</span>
                            <h6 class="fw-bold text-dark mb-1 text-ellipsis-1" title="${r.productName}">${r.productName}</h6>
                        </div>
                        <div class="pt-2 border-top d-flex justify-content-between align-items-center mt-2">
                            <span class="text-purple-main fw-bold extra-small"><i class="fa-solid fa-book-bookmark me-1"></i>${hasRecipe ? 'Reçete İncele' : 'Reçete Ekle'}</span>
                            <i class="fa-solid fa-chevron-right text-muted extra-small"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
        $grid.append(cardHtml);
    });
}

function openRecipeDetailModal(productId) {
    var recipe = allRecipesData.find(x => x.productId === productId);
    if (!recipe) return;

    selectedRecipeForModal = recipe;
    var parsed = tryParseRecipeJson(recipe.description);
    var hasRecipe = parsed && parsed.hasRecipe === true;

    $("#modalRecipeTitle").html(`<i class="fa-solid fa-utensils me-2"></i>${recipe.productName} Standart Hazırlık `);

    var $body = $("#modalRecipeBodyContent").empty();

    if (!hasRecipe) {
        // HENÜZ REÇETE HAZIRLANMAMIŞ BOŞ DURUM
        var emptyHtml = `
            <div class="text-center py-5">
                <div class="mb-3">
                    <i class="fa-solid fa-book-skull fs-1 text-muted opacity-50"></i>
                </div>
                <h5 class="fw-bold text-dark mb-2">Bu Ürün İçin Henüz Reçete Hazırlanmadı</h5>
                <p class="text-muted small mb-4">Şef veya mutfak yöneticisi bu ürün için standart gramaj ve hazırlık kurallarını henüz girmedi.</p>
                <button type="button" class="btn btn-purple-main fw-bold px-4 py-2 rounded-3 shadow-sm" onclick="openEditRecipeModal(selectedRecipeForModal)">
                    <i class="fa-solid fa-plus me-2"></i>Reçete Ekle
                </button>
            </div>
        `;
        $body.html(emptyHtml);
    } else {
        // ŞEFİN GİRDİĞİ DOLU REÇETE GÖRÜNÜMÜ
        var ingredientsArr = (parsed.ingredients || '').split('\n').filter(x => x.trim() !== '');
        var ingHtml = "";

        if (ingredientsArr.length > 0) {
            $.each(ingredientsArr, function (i, ing) {
                ingHtml += `
                    <li class="list-group-item d-flex justify-content-between align-items-center recipe-ingredient-item">
                        <span class="text-dark fw-medium"><i class="fa-solid fa-circle-dot me-2 text-purple-main extra-small"></i>${ing}</span>
                    </li>
                `;
            });
        } else {
            ingHtml = '<li class="list-group-item text-muted small">Malzeme bilgisi girilmemiş.</li>';
        }

        var instructionsFormatted = (parsed.instructions || 'Hazırlık adımı girilmemiş.').replace(/\n/g, '<br>');
        var chefTipText = parsed.chefTip && parsed.chefTip.trim() !== "" ? parsed.chefTip : "Standart reçete kurallarına ve hijyen standartlarına uyunuz.";

        var fullHtml = `
            <div class="row g-4">
                <div class="col-md-5 text-center">
                    <img src="${recipe.imageUrl || '/Content/images/default-food.png'}" class="img-fluid rounded-4 shadow-sm mb-3 w-100 object-fit-cover recipe-modal-main-img" onerror="this.src='/Content/images/default-food.png'">
                    <div class="p-3 bg-light rounded-3 border text-start">
                        <div class="d-flex justify-content-between mb-2">
                            <span class="text-muted small fw-bold"><i class="fa-solid fa-tags me-1 text-purple-main"></i>Kategori:</span>
                            <span class="badge bg-purple-light text-purple-main fw-bold">${recipe.categoryName}</span>
                        </div>
                        <div class="d-flex justify-content-between mb-2">
                            <span class="text-muted small fw-bold"><i class="fa-solid fa-clock me-1 text-warning"></i>Pişirme Süresi:</span>
                            <span class="fw-bold text-dark small">${parsed.cookTime || '-'}</span>
                        </div>
                        <div class="d-flex justify-content-between">
                            <span class="text-muted small fw-bold"><i class="fa-solid fa-temperature-three-quarters me-1 text-danger"></i>Mutfak İstasyonu:</span>
                            <span class="fw-bold text-dark small">${parsed.station || '-'}</span>
                        </div>
                    </div>
                </div>

                <div class="col-md-7">
                    <h6 class="fw-bold text-dark border-bottom pb-2 mb-3">
                        <i class="fa-solid fa-scale-balanced me-2 text-purple-main"></i>Standart Porsiyon Malzemeleri
                    </h6>
                    <ul class="list-group list-group-flush mb-4 recipe-ingredients-list">
                        ${ingHtml}
                    </ul>

                    <h6 class="fw-bold text-dark border-bottom pb-2 mb-3">
                        <i class="fa-solid fa-list-check me-2 text-purple-main"></i>Hazırlık & Tabaklama Adımları 
                    </h6>
                    <div class="p-3 bg-light rounded-3 border mb-3">
                        <p class="text-secondary small mb-0" style="line-height: 1.6;">
                            ${instructionsFormatted}
                        </p>
                    </div>

                    <div class="alert alert-warning border-warning p-2.5 rounded-3 mb-0 d-flex align-items-start gap-2">
                        <i class="fa-solid fa-fire text-warning fs-5 flex-shrink-0 mt-0.5"></i>
                        <div class="extra-small">
                            <strong class="d-block text-dark fw-bold mb-0.5">Şefin Püf Noktası:</strong>
                            <span class="text-secondary">${chefTipText}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        $body.html(fullHtml);
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalRecipeDetail')).show();
}

function openEditRecipeModal(recipe) {
    if (!recipe) return;

    var detailModalInstance = bootstrap.Modal.getInstance(document.getElementById('modalRecipeDetail'));
    if (detailModalInstance) {
        detailModalInstance.hide();
    }

    var parsed = tryParseRecipeJson(recipe.description) || {};

    $("#editRecipeProductId").val(recipe.productId);
    $("#modalEditRecipeTitle").html(`<i class="fa-solid fa-pen-to-square me-2"></i>${recipe.productName} - Reçete Düzenle`);
    $("#txtEditCookTime").val(parsed.cookTime || "");
    $("#txtEditStation").val(parsed.station || "");
    $("#txtEditIngredients").val(parsed.ingredients || "");
    $("#txtEditInstructions").val(parsed.instructions || "");
    $("#txtEditChefTip").val(parsed.chefTip || "");

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditRecipe')).show();
}

function submitRecipeForm() {
    var productId = parseInt($("#editRecipeProductId").val());
    var cookTime = $("#txtEditCookTime").val().trim();
    var station = $("#txtEditStation").val().trim();
    var ingredients = $("#txtEditIngredients").val().trim();
    var instructions = $("#txtEditInstructions").val().trim();
    var chefTip = $("#txtEditChefTip").val().trim();

    if (!ingredients && !instructions) {
        Swal.fire("Uyarı", "Lütfen en azından malzeme listesi veya hazırlık adımlarını doldurunuz.", "warning");
        return;
    }

    var payload = {
        ProductId: productId,
        CookTime: cookTime,
        Station: station,
        Ingredients: ingredients,
        Instructions: instructions,
        ChefTip: chefTip
    };

    $.ajax({
        url: "/Kitchen/SaveRecipe",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify(payload),
        success: function (res) {
            if (res.success) {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: res.message || 'Reçete başarıyla kaydedildi!',
                    showConfirmButton: false,
                    timer: 1500
                });

                var editModalInstance = bootstrap.Modal.getInstance(document.getElementById('modalEditRecipe'));
                if (editModalInstance) editModalInstance.hide();

                loadRecipes(currentActiveCategoryId);
            } else {
                Swal.fire("Hata", res.message || "Reçete kaydedilemedi.", "error");
            }
        },
        error: function () {
            Swal.fire("Hata", "Reçete kaydedilirken sunucu hatası oluştu.", "error");
        }
    });
}

function tryParseRecipeJson(jsonString) {
    if (!jsonString) return null;
    try {
        var obj = JSON.parse(jsonString);
        if (obj && typeof obj === "object" && obj.hasRecipe) {
            return obj;
        }
        return null;
    } catch (e) {
        return null;
    }
}

function filterRecipesBySearch() {
    var query = $("#txtSearchRecipe").val().toLowerCase().trim();
    $("#recipesCardGrid .recipe-item-col").each(function () {
        var name = $(this).data("name") || "";
        if (name.includes(query)) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
}