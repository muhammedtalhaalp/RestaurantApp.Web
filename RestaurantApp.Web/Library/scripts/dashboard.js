const currentCompanyId = 1;

$(document).ready(function () {
    loadCategories();
    loadProducts();
});

// 1. Kategorileri Yükle
function loadCategories() {
    $.get('/Admin/GetCategories', { companyId: currentCompanyId }, function (res) {
        if (res.success) {
            let ddl = $('#ddlCategories');
            ddl.empty().append('<option value="">-- Kategori Seçin --</option>');
            $.each(res.data, function (i, cat) {
                ddl.append(`<option value="${cat.CategoryId}">${cat.CategoryName}</option>`);
            });
        }
    });
}

// 2. Kategori Ekle
function addCategory() {
    let catName = $('#txtCategoryName').val().trim();
    if (!catName) { alert('Kategori adı giriniz.'); return; }

    $.post('/Admin/AddCategory', { categoryName: catName, companyId: currentCompanyId }, function (res) {
        if (res.success) {
            alert(res.message);
            $('#txtCategoryName').val('');
            loadCategories();
        } else {
            alert(res.message);
        }
    });
}

// 3. Menüdeki Ürünleri Yükle
function loadProducts() {
    $.get('/Admin/GetProducts', { companyId: currentCompanyId }, function (res) {
        if (res.success) {
            let tbody = $('#tblProductList');
            tbody.empty();

            if (res.data.length === 0) {
                tbody.append('<tr><td colspan="6" class="text-center text-muted">Menüde henüz ürün yok.</td></tr>');
                return;
            }

            $.each(res.data, function (i, p) {
                let statusBadge = p.IsAvailable
                    ? '<span class="badge bg-success">Stokta Var</span>'
                    : '<span class="badge bg-danger">Tükendi</span>';

                let row = `
                    <tr>
                        <td><img src="${p.ImageUrl || '/Content/images/default-food.png'}" style="width: 45px; height: 45px; object-fit: cover;" class="rounded"></td>
                        <td>
                            <strong>${p.ProductName}</strong><br>
                            <small class="text-muted">${p.Description || ''}</small>
                        </td>
                        <td>${p.CategoryName}</td>
                        <td>${p.Price.toFixed(2)} ₺</td>
                        <td>${statusBadge}</td>
                        <td class="text-center">
                            <button class="btn btn-sm btn-outline-warning mr-1" onclick="toggleStatus(${p.ProductId})">
                                Status
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteProduct(${p.ProductId})">
                                Sil
                            </button>
                        </td>
                    </tr>`;
                tbody.append(row);
            });
        }
    });
}

// 4. Ürün Ekle
function addProduct() {
    let pData = {
        ProductName: $('#txtProductName').val().trim(),
        CategoryId: $('#ddlCategories').val(),
        Price: $('#txtPrice').val(),
        Description: $('#txtDescription').val().trim(),
        ImageUrl: $('#txtImageUrl').val().trim(),
        CompanyId: currentCompanyId,
        IsAvailable: true
    };

    if (!pData.ProductName || !pData.CategoryId || !pData.Price) {
        alert('Lütfen Ürün Adı, Kategori ve Fiyat alanlarını doldurun.');
        return;
    }

    $.post('/Admin/AddProduct', { product: pData }, function (res) {
        if (res.success) {
            alert(res.message);
            $('#productForm')[0].reset();
            loadProducts();
        } else {
            alert(res.message);
        }
    });
}

// 5. Ürün Sil
function deleteProduct(id) {
    if (confirm('Bu ürünü menüden çıkarmak istediğinize emin misiniz?')) {
        $.post('/Admin/DeleteProduct', { productId: id }, function (res) {
            if (res.success) {
                loadProducts();
            } else {
                alert(res.message);
            }
        });
    }
}

// 6. Stok Var/Yok Değiştir
function toggleStatus(id) {
    $.post('/Admin/ToggleProductStatus', { productId: id }, function (res) {
        if (res.success) {
            loadProducts();
        } else {
            alert(res.message);
        }
    });
}