const currentCompanyId = 1;
const STATE_SAVE_KEY = 'lezzetpos_menu_filters';
let rawProductsList = [];
let rawCategoriesList = [];

$(document).ready(function () {
    restoreFilterState();

    loadCategories();
    loadProducts();

    $('#fileImage').on('change', function () {
        handleImagePreview(this, '#imgPreview', '#imgPreviewWrapper');
    });

    $('#editFileImage').on('change', function () {
        handleImagePreview(this, '#editImgPreview', '#editImgPreviewWrapper');
    });

    $('#filterSearch, #filterCategory, #filterStatus').on('input change', function () {
        saveFilterState();
        renderProductsTable();
    });

    $('#btnClearFilters').on('click', function () {
        clearFilterState();
    });
});

function saveFilterState() {
    let state = {
        search: $('#filterSearch').val() || '',
        category: $('#filterCategory').val() || '',
        status: $('#filterStatus').val() || ''
    };
    localStorage.setItem(STATE_SAVE_KEY, JSON.stringify(state));
}

function restoreFilterState() {
    let savedState = localStorage.getItem(STATE_SAVE_KEY);
    if (savedState) {
        try {
            let state = JSON.parse(savedState);
            $('#filterSearch').val(state.search || '');
            $('#filterCategory').val(state.category || '');
            $('#filterStatus').val(state.status || '');
        } catch (e) {
            console.log('State restore hatası:', e);
        }
    }
}

function clearFilterState() {
    localStorage.removeItem(STATE_SAVE_KEY);
    $('#filterSearch').val('');
    $('#filterCategory').val('');
    $('#filterStatus').val('');
    renderProductsTable();
}

function handleImagePreview(input, imgSelector, wrapperSelector) {
    if (input && input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function (e) {
            $(imgSelector).attr('src', e.target.result);
            $(wrapperSelector).removeClass('d-none');
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function openAddCategoryModal() {
    $('#txtCategoryNameModal').val('');
    var modalEl = document.getElementById('addCategoryModal');
    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();
}

function openAddProductModal() {
    $('#productForm')[0].reset();
    $('#imgPreviewWrapper').addClass('d-none');
    var modalEl = document.getElementById('addProductModal');
    var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();
}

function openCategoryManagementModal() {
    openCategoryModal();
}

function loadCategories() {
    $.get('/Category/GetCategories', function (res) {
        if (res && res.success) {
            rawCategoriesList = res.data || [];

            let ddlAdd = $('#ddlCategories');
            let ddlEdit = $('#editDdlCategories');
            let ddlFilter = $('#filterCategory');

            let savedCat = $('#filterCategory').val();

            ddlAdd.empty().append('<option value="">-- Kategori Seçin --</option>');
            ddlEdit.empty().append('<option value="">-- Kategori Seçin --</option>');
            ddlFilter.empty().append('<option value="">Tüm Kategoriler</option>');

            $.each(rawCategoriesList, function (i, cat) {
                let isPassive = !cat.IsActive;
                let statusTag = isPassive ? ' (Pasif)' : '';

                let opt = `<option value="${cat.CategoryId}">${cat.CategoryName}${statusTag}</option>`;

                ddlAdd.append(opt);
                ddlEdit.append(opt);
                ddlFilter.append(`<option value="${cat.CategoryId}">${cat.CategoryName}${statusTag}</option>`);
            });

            if (savedCat) {
                ddlFilter.val(savedCat);
            }
        }
    });
}

function openCategoryModal() {
    $.get('/Category/GetCategories', function (res) {
        if (res && res.success) {
            let tbody = $('#tblCategoryManagementList');
            tbody.empty();

            if (!res.data || res.data.length === 0) {
                tbody.append('<tr><td colspan="3" class="text-center text-muted py-3">Kategori bulunamadı.</td></tr>');
            } else {
                $.each(res.data, function (i, cat) {
                    let statusBadge = cat.IsActive
                        ? '<span class="badge bg-success px-2 py-1">Aktif</span>'
                        : '<span class="badge bg-secondary px-2 py-1"><i class="fa-solid fa-snowflake me-1"></i>Pasif</span>';

                    let btnText = cat.IsActive ? 'Pasife Al' : 'Aktif Et';
                    let btnClass = cat.IsActive ? 'btn-outline-warning' : 'btn-outline-success';
                    let btnIcon = cat.IsActive ? 'fa-snowflake' : 'fa-check';

                    let row = `
                        <tr>
                            <td class="fw-bold text-dark">${cat.CategoryName}</td>
                            <td>${statusBadge}</td>
                            <td class="text-end">
                                <button class="btn btn-sm ${btnClass} rounded-2 fw-semibold" onclick="toggleCategoryStatus(${cat.CategoryId})">
                                    <i class="fa-solid ${btnIcon} me-1"></i>${btnText}
                                </button>
                            </td>
                        </tr>
                    `;
                    tbody.append(row);
                });
            }

            var modalEl = document.getElementById('categoryManagementModal');
            var modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
            modalInstance.show();
        }
    });
}

function toggleCategoryStatus(categoryId) {
    $.post('/Category/ToggleCategoryStatus', { categoryId: categoryId }, function (res) {
        if (res && res.success) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: res.message,
                showConfirmButton: false,
                timer: 1500
            });

            openCategoryModal();
            loadCategories();
            loadProducts();
        } else {
            Swal.fire('Hata', res ? res.message : 'İşlem başarısız.', 'error');
        }
    });
}

function addCategoryFromModal() {
    let catName = ($('#txtCategoryNameModal').val() || '').trim();
    if (!catName) {
        Swal.fire('Uyarı', 'Lütfen kategori adı giriniz.', 'warning');
        return;
    }

    $.post('/Category/Create', { categoryName: catName, companyId: currentCompanyId }, function (res) {
        if (res && res.success) {
            Swal.fire('Başarılı', res.message, 'success');
            $('#txtCategoryNameModal').val('');

            var modalEl = document.getElementById('addCategoryModal');
            var modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

            loadCategories();
        } else {
            Swal.fire('Hata', res ? res.message : 'Kategori eklenemedi.', 'error');
        }
    });
}

function loadProducts() {
    $.get('/Admin/GetProducts', { companyId: currentCompanyId }, function (res) {
        if (res && res.success) {
            rawProductsList = res.data || [];
            renderProductsTable();
        }
    });
}

function renderProductsTable() {
    let tbody = $('#tblProductList');
    tbody.empty();

    let searchText = ($('#filterSearch').val() || '').toLowerCase().trim();
    let selectedCat = $('#filterCategory').val();
    let selectedStatus = $('#filterStatus').val();

    let filteredList = rawProductsList.filter(function (p) {
        let matchesSearch = true;
        if (searchText) {
            let pName = (p.ProductName || '').toLowerCase();
            let pDesc = (p.Description || '').toLowerCase();
            matchesSearch = pName.includes(searchText) || pDesc.includes(searchText);
        }

        let matchesCategory = true;
        if (selectedCat) {
            matchesCategory = p.CategoryId == selectedCat;
        }

        let matchesStatus = true;
        if (selectedStatus === 'available') {
            matchesStatus = p.IsAvailable === true;
        } else if (selectedStatus === 'out') {
            matchesStatus = p.IsAvailable === false;
        }

        return matchesSearch && matchesCategory && matchesStatus;
    });

    if (filteredList.length === 0) {
        tbody.append('<tr><td colspan="6" class="text-center py-4 text-muted"><i class="fa-solid fa-magnifying-glass me-2"></i>Aramanıza uygun ürün bulunamadı.</td></tr>');
        return;
    }

    // SIRALAMA ALGORİTMASI:
    // 1. Kategorisi pasif veya stokta tükenmiş olanlar tablonun EN ALTINA atılır.
    // 2. Aktif olanlar kategorilerine göre alfabetik gruplanır ve kendi içinde isme göre dizilir.
    filteredList.sort(function (a, b) {
        let parentCatA = rawCategoriesList.find(c => c.CategoryId === a.CategoryId);
        let parentCatB = rawCategoriesList.find(c => c.CategoryId === b.CategoryId);

        let isAInactive = (parentCatA && !parentCatA.IsActive) || a.IsAvailable === false;
        let isBInactive = (parentCatB && !parentCatB.IsActive) || b.IsAvailable === false;

        // Pasif/Tükenmiş ürünleri en alta taşı
        if (isAInactive !== isBInactive) {
            return isAInactive ? 1 : -1;
        }

        // Kategori isimlerine göre alfabetik grupla
        let catNameA = (a.CategoryName || '').toLowerCase();
        let catNameB = (b.CategoryName || '').toLowerCase();

        if (catNameA !== catNameB) {
            return catNameA.localeCompare(catNameB, 'tr');
        }

        // Kategori içi ürün adlarına göre sırala
        return (a.ProductName || '').toLowerCase().localeCompare((b.ProductName || '').toLowerCase(), 'tr');
    });

    $.each(filteredList, function (i, p) {
        let parentCat = rawCategoriesList.find(c => c.CategoryId === p.CategoryId);
        let isCategoryPassive = parentCat ? !parentCat.IsActive : false;
        let isOutOfStock = p.IsAvailable === false;

        let isRowPassive = isCategoryPassive || isOutOfStock;

        let statusBadge = p.IsAvailable
            ? '<span class="badge bg-success px-2 py-1">Stokta Var</span>'
            : '<span class="badge bg-danger px-2 py-1">Tükendi</span>';

        let categoryBadge = isCategoryPassive
            ? `<span class="badge bg-secondary text-white border px-2 py-1"><i class="fa-solid fa-snowflake me-1"></i>${p.CategoryName || 'Kategorisiz'} (Pasif)</span>`
            : `<span class="badge bg-light text-dark border px-2 py-1">${p.CategoryName || 'Kategorisiz'}</span>`;

        // Pasif veya Tükenmiş ürün satırına silikleşme sınıfı atanır
        let rowClass = isRowPassive ? 'table-passive-row' : '';

        let priceVal = (p.Price != null && !isNaN(p.Price)) ? parseFloat(p.Price).toFixed(2) : '0.00';

        let row = `
            <tr class="${rowClass}">
                <td>
                    <img src="${p.ImageUrl || '/Content/images/default-food.png'}" style="width: 46px; height: 46px; object-fit: cover;" class="rounded-3 border shadow-sm">
                </td>
                <td style="max-width: 280px;">
                    <strong class="text-dark d-block mb-1">${p.ProductName || ''}</strong>
                    <small class="text-muted text-truncate-2" style="font-size: 0.8rem;" title="${p.Description || ''}">${p.Description || ''}</small>
                </td>
                <td>${categoryBadge}</td>
                <td class="fw-bold text-dark">${priceVal} ₺</td>
                <td>${statusBadge}</td>
                <td class="text-center">
                    <div class="d-flex justify-content-center gap-2">
                        <button class="btn-action-icon btn-action-edit" title="Düzenle" onclick="openEditModal(${p.ProductId})">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="btn-action-icon btn-action-status" title="Stok Durumunu Değiştir" onclick="toggleStatus(${p.ProductId})">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </button>
                        <button class="btn-action-icon btn-action-delete" title="Sil" onclick="deleteProduct(${p.ProductId})">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        tbody.append(row);
    });
}

function addProduct() {
    let name = ($('#txtProductName').val() || '').trim();
    let catId = $('#ddlCategories').val();
    let price = $('#txtPrice').val();
    let desc = ($('#txtDescription').val() || '').trim();
    let fileInput = $('#fileImage')[0];

    if (!name || !catId || !price) {
        Swal.fire('Uyarı', 'Lütfen Ürün Adı, Kategori ve Fiyat alanlarını doldurun.', 'warning');
        return;
    }

    let $btn = $('#btnAddProductBtn');
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Kaydediliyor...');

    if (fileInput && fileInput.files && fileInput.files[0]) {
        let formData = new FormData();
        formData.append("imageFile", fileInput.files[0]);

        $.ajax({
            url: '/Admin/UploadProductImage',
            type: 'POST',
            data: formData,
            contentType: false,
            processData: false,
            success: function (uploadRes) {
                if (uploadRes && uploadRes.success) {
                    saveProductToDb(name, catId, price, desc, uploadRes.imageUrl, $btn);
                } else {
                    $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Ürünü Kaydet');
                    Swal.fire('Hata', uploadRes ? uploadRes.message : 'Resim yüklenemedi.', 'error');
                }
            },
            error: function () {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Ürünü Kaydet');
                Swal.fire('Hata', 'Resim yükleme hatası oluştu.', 'error');
            }
        });
    } else {
        saveProductToDb(name, catId, price, desc, '/Content/images/default-food.png', $btn);
    }
}

function saveProductToDb(name, catId, price, desc, imageUrl, $btn) {
    let pData = {
        ProductName: name,
        CategoryId: parseInt(catId),
        Price: parseFloat(price),
        Description: desc,
        ImageUrl: imageUrl,
        CompanyId: currentCompanyId,
        IsAvailable: true
    };

    $.post('/Admin/AddProduct', { product: pData }, function (res) {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Ürünü Kaydet');
        if (res && res.success) {
            Swal.fire('Başarılı', res.message, 'success');

            var modalEl = document.getElementById('addProductModal');
            var modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

            loadProducts();
        } else {
            Swal.fire('Hata', res ? res.message : 'Ekleme başarısız.', 'error');
        }
    });
}

function openEditModal(productId) {
    $.get('/Admin/GetProductById', { productId: productId }, function (res) {
        if (res && res.success && res.data) {
            let p = res.data;
            $('#editProductId').val(p.ProductId);
            $('#editProductName').val(p.ProductName);
            $('#editDdlCategories').val(p.CategoryId);
            $('#editPrice').val(p.Price);
            $('#editDescription').val(p.Description);
            $('#editExistingImageUrl').val(p.ImageUrl);

            $('#editImgPreview').attr('src', p.ImageUrl || '/Content/images/default-food.png');
            $('#editImgPreviewWrapper').removeClass('d-none');
            $('#editFileImage').val('');

            var modal = new bootstrap.Modal(document.getElementById('editProductModal'));
            modal.show();
        } else {
            Swal.fire('Hata', res ? res.message : 'Ürün verisi alınamadı.', 'error');
        }
    });
}

function updateProduct() {
    let id = $('#editProductId').val();
    let name = ($('#editProductName').val() || '').trim();
    let catId = $('#editDdlCategories').val();
    let price = $('#editPrice').val();
    let desc = ($('#editDescription').val() || '').trim();
    let existingImg = $('#editExistingImageUrl').val();
    let fileInput = $('#editFileImage')[0];

    if (!name || !catId || !price) {
        Swal.fire('Uyarı', 'Lütfen gerekli alanları doldurun.', 'warning');
        return;
    }

    let $btn = $('#btnUpdateProductBtn');
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Güncelleniyor...');

    if (fileInput && fileInput.files && fileInput.files[0]) {
        let formData = new FormData();
        formData.append("imageFile", fileInput.files[0]);

        $.ajax({
            url: '/Admin/UploadProductImage',
            type: 'POST',
            data: formData,
            contentType: false,
            processData: false,
            success: function (uploadRes) {
                if (uploadRes && uploadRes.success) {
                    saveProductUpdateToDb(id, name, catId, price, desc, uploadRes.imageUrl, $btn);
                } else {
                    $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Değişiklikleri Kaydet');
                    Swal.fire('Hata', uploadRes ? uploadRes.message : 'Resim yüklenemedi.', 'error');
                }
            }
        });
    } else {
        saveProductUpdateToDb(id, name, catId, price, desc, existingImg, $btn);
    }
}

function saveProductUpdateToDb(id, name, catId, price, desc, imageUrl, $btn) {
    let pData = {
        ProductId: parseInt(id),
        ProductName: name,
        CategoryId: parseInt(catId),
        Price: parseFloat(price),
        Description: desc,
        ImageUrl: imageUrl,
        IsAvailable: true
    };

    $.post('/Admin/UpdateProduct', { updatedProduct: pData }, function (res) {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Değişiklikleri Kaydet');
        if (res && res.success) {
            var modalEl = document.getElementById('editProductModal');
            var modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            Swal.fire('Başarılı', res.message, 'success');
            loadProducts();
        } else {
            Swal.fire('Hata', res ? res.message : 'Güncelleme başarısız.', 'error');
        }
    });
}

function deleteProduct(id) {
    Swal.fire({
        title: 'Emin misiniz?',
        text: "Bu ürün restoran menüsünden çıkarılacaktır!",
        icon: 'warning',
        showCancelButton: true,
        confirmColor: '#4a154b',
        cancelColor: '#6c757d',
        confirmButtonText: 'Evet, Sil!',
        cancelButtonText: 'İptal'
    }).then((result) => {
        if (result.isConfirmed) {
            $.post('/Admin/DeleteProduct', { productId: id }, function (res) {
                if (res && res.success) {
                    Swal.fire('Silindi!', res.message, 'success');
                    loadProducts();
                } else {
                    Swal.fire('Hata', res ? res.message : 'Silinemedi.', 'error');
                }
            });
        }
    });
}

function toggleStatus(id) {
    $.post('/Admin/ToggleProductStatus', { productId: id }, function (res) {
        if (res && res.success) {
            loadProducts();
        } else {
            Swal.fire('Hata', res ? res.message : 'İşlem başarısız.', 'error');
        }
    });
}