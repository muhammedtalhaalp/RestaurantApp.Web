const currentCompanyId = 1;
const STATE_SAVE_KEY = 'lezzetpos_menu_filters';
let rawProductsList = []; // Filtreleme için tüm ham veriyi saklar

$(document).ready(function () {
    // 1. Önce kaydedilmiş filtre değerlerini kutucuklara yükle
    restoreFilterState();

    loadCategories();
    loadProducts();

    // Event Listener'lar
    $('#fileImage').on('change', function () {
        handleImagePreview(this, '#imgPreview', '#imgPreviewWrapper');
    });

    $('#editFileImage').on('change', function () {
        handleImagePreview(this, '#editImgPreview', '#editImgPreviewWrapper');
    });

    // Filtreleme Dinleyicileri (Kullanıcı yazdığı/seçtiği an çalışır)
    $('#filterSearch, #filterCategory, #filterStatus').on('input change', function () {
        saveFilterState();
        renderProductsTable();
    });

    // Filtreleri Sıfırla Butonu
    $('#btnClearFilters').on('click', function () {
        clearFilterState();
    });
});

// State Save: Filtre Durumunu localStorage'a Kaydet
function saveFilterState() {
    let state = {
        search: $('#filterSearch').val() || '',
        category: $('#filterCategory').val() || '',
        status: $('#filterStatus').val() || ''
    };
    localStorage.setItem(STATE_SAVE_KEY, JSON.stringify(state));
}

// State Restore: localStorage'dan Yükle
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

// State Clear: Filtreleri Sıfırla
function clearFilterState() {
    localStorage.removeItem(STATE_SAVE_KEY);
    $('#filterSearch').val('');
    $('#filterCategory').val('');
    $('#filterStatus').val('');
    renderProductsTable();
}

// Güvenli Görsel Önizleme Fonksiyonu
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

// 1. Kategorileri Yükle
function loadCategories() {
    $.get('/Admin/GetCategories', { companyId: currentCompanyId }, function (res) {
        if (res && res.success) {
            let ddlAdd = $('#ddlCategories');
            let ddlEdit = $('#editDdlCategories');
            let ddlFilter = $('#filterCategory');

            let savedCat = $('#filterCategory').val(); // Önceden yüklenmiş state varsa koru

            ddlAdd.empty().append('<option value="">-- Kategori Seçin --</option>');
            ddlEdit.empty().append('<option value="">-- Kategori Seçin --</option>');
            ddlFilter.empty().append('<option value="">Tüm Kategoriler</option>');

            $.each(res.data || [], function (i, cat) {
                let opt = `<option value="${cat.CategoryId}">${cat.CategoryName}</option>`;
                ddlAdd.append(opt);
                ddlEdit.append(opt);
                ddlFilter.append(`<option value="${cat.CategoryId}">${cat.CategoryName}</option>`);
            });

            if (savedCat) {
                ddlFilter.val(savedCat);
            }
        }
    });
}

// 2. Kategori Ekle
function addCategory() {
    let catName = ($('#txtCategoryName').val() || '').trim();
    if (!catName) {
        Swal.fire('Uyarı', 'Lütfen kategori adı giriniz.', 'warning');
        return;
    }

    $.post('/Admin/AddCategory', { categoryName: catName, companyId: currentCompanyId }, function (res) {
        if (res && res.success) {
            Swal.fire('Başarılı', res.message, 'success');
            $('#txtCategoryName').val('');
            loadCategories();
        } else {
            Swal.fire('Hata', res ? res.message : 'Kategori eklenemedi.', 'error');
        }
    });
}

// 3. Menüdeki Ürünleri Getir
function loadProducts() {
    $.get('/Admin/GetProducts', { companyId: currentCompanyId }, function (res) {
        if (res && res.success) {
            rawProductsList = res.data || [];
            renderProductsTable();
        }
    });
}

// 4. Detaylı Canlı Filtreleme Ve Tabloyu Hazırlama (Render)
function renderProductsTable() {
    let tbody = $('#tblProductList');
    tbody.empty();

    let searchText = ($('#filterSearch').val() || '').toLowerCase().trim();
    let selectedCat = $('#filterCategory').val();
    let selectedStatus = $('#filterStatus').val();

    // Veriyi filtrelere tabi tut
    let filteredList = rawProductsList.filter(function (p) {
        // Arama (İsim veya Açıklamada)
        let matchesSearch = true;
        if (searchText) {
            let pName = (p.ProductName || '').toLowerCase();
            let pDesc = (p.Description || '').toLowerCase();
            matchesSearch = pName.includes(searchText) || pDesc.includes(searchText);
        }

        // Kategori Filtresi
        let matchesCategory = true;
        if (selectedCat) {
            matchesCategory = p.CategoryId == selectedCat;
        }

        // Stok Durumu Filtresi
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

    $.each(filteredList, function (i, p) {
        let statusBadge = p.IsAvailable
            ? '<span class="badge bg-success px-2 py-1">Stokta Var</span>'
            : '<span class="badge bg-danger px-2 py-1">Tükendi</span>';

        let priceVal = (p.Price != null && !isNaN(p.Price)) ? parseFloat(p.Price).toFixed(2) : '0.00';

        let row = `
            <tr>
                <td>
                    <img src="${p.ImageUrl || '/Content/images/default-food.png'}" style="width: 46px; height: 46px; object-fit: cover;" class="rounded-3 border shadow-sm">
                </td>
                <td>
                    <strong class="text-dark">${p.ProductName || ''}</strong><br>
                    <small class="text-muted" style="font-size: 0.8rem;">${p.Description || ''}</small>
                </td>
                <td><span class="badge bg-light text-dark border px-2 py-1">${p.CategoryName || 'Kategorisiz'}</span></td>
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

// 5. Yeni Ürün Ekle
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
    if ($btn.length === 0) {
        $btn = $('button[onclick="addProduct()"]');
    }

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
                    $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Ürünü Menüye Ekle');
                    Swal.fire('Hata', uploadRes ? uploadRes.message : 'Resim yüklenemedi.', 'error');
                }
            },
            error: function () {
                $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Ürünü Menüye Ekle');
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
        $btn.prop('disabled', false).html('<i class="fa-solid fa-check me-1"></i>Ürünü Menüye Ekle');
        if (res && res.success) {
            Swal.fire('Başarılı', res.message, 'success');
            $('#productForm')[0].reset();
            $('#imgPreviewWrapper').addClass('d-none');
            loadProducts();
        } else {
            Swal.fire('Hata', res ? res.message : 'Ekleme başarısız.', 'error');
        }
    });
}

// 6. Ürün Düzenleme Modalı Açma
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

// 7. Ürün Güncelleme Kaydı
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

// 8. Ürün Sil
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

// 9. Stok Var/Yok Değiştir
function toggleStatus(id) {
    $.post('/Admin/ToggleProductStatus', { productId: id }, function (res) {
        if (res && res.success) {
            loadProducts();
        } else {
            Swal.fire('Hata', res ? res.message : 'İşlem başarısız.', 'error');
        }
    });
}