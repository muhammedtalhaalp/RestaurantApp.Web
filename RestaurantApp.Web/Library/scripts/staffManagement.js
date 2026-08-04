const STAFF_STATE_KEY = 'lezzetpos_staff_filters';
let rawStaffList = []; // Tüm personelleri saklayan ham dizi

$(document).ready(function () {
    console.log("Personel Yönetimi JS yüklendi.");

    // 1. Önce kaydedilmiş filtre durumunu yükle
    restoreStaffFilterState();

    // 2. Personel Listesini Yükle
    loadStaffList();

    // 3. Filtreleme Dinleyicileri (Yazıldıkça / Seçildikçe Anlık Çalışır)
    $('#filterStaffSearch, #filterStaffRole').on('input change', function () {
        saveStaffFilterState();
        renderStaffTable();
    });

    // 4. Filtreleri Temizle Butonu
    $('#btnClearStaffFilters').on('click', function () {
        clearStaffFilterState();
    });

    // 5. Excel'e Aktar (.xlsx)
    $('#btnExportStaffExcel').on('click', function () {
        exportStaffToExcel();
    });

    // 6. Yeni Personel Kayıt Formu Gönderimi
    $("#formAddStaff").on("submit", function (e) {
        e.preventDefault();

        var fullName = $("#txtStaffFullName").val().trim();
        var email = $("#txtStaffEmail").val().trim();
        var role = $("#ddlStaffRole").val();
        var password = $("#txtStaffPassword").val().trim();

        if (!fullName || !email || !role || !password) {
            Swal.fire("Uyarı", "Lütfen tüm alanları eksiksiz doldurun.", "warning");
            return;
        }

        var $btn = $(this).find("button[type='submit']");
        $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Kaydediliyor...');

        $.ajax({
            url: "/Admin/AddStaff",
            type: "POST",
            data: {
                FullName: fullName,
                Email: email,
                Role: role,
                Password: password
            },
            success: function (response) {
                $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-1"></i>Personeli Kaydet');

                if (response.success) {
                    Swal.fire({
                        icon: "success",
                        title: "Başarılı!",
                        text: response.message || "Personel başarıyla eklendi.",
                        timer: 1500,
                        showConfirmButton: false
                    });

                    $("#modalAddStaff").modal("hide");
                    $("#formAddStaff")[0].reset();
                    loadStaffList();
                } else {
                    Swal.fire("Hata", response.message, "error");
                }
            },
            error: function () {
                $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-1"></i>Personeli Kaydet');
                Swal.fire("Hata", "Personel eklenirken sunucu hatası gerçekleşti.", "error");
            }
        });
    });
});

// ----------------------------------------------------
// State Save (Filtreleri localStorage'a kaydetme)
// ----------------------------------------------------
function saveStaffFilterState() {
    let state = {
        search: $('#filterStaffSearch').val() || '',
        role: $('#filterStaffRole').val() || ''
    };
    localStorage.setItem(STAFF_STATE_KEY, JSON.stringify(state));
}

function restoreStaffFilterState() {
    let savedState = localStorage.getItem(STAFF_STATE_KEY);
    if (savedState) {
        try {
            let state = JSON.parse(savedState);
            $('#filterStaffSearch').val(state.search || '');
            $('#filterStaffRole').val(state.role || '');
        } catch (e) {
            console.log('Filtre okuma hatası:', e);
        }
    }
}

function clearStaffFilterState() {
    localStorage.removeItem(STAFF_STATE_KEY);
    $('#filterStaffSearch').val('');
    $('#filterStaffRole').val('');
    renderStaffTable();
}

// ----------------------------------------------------
// Personel Listesini Backend'den Çeken Fonksiyon
// ----------------------------------------------------
function loadStaffList() {
    var $tbody = $("#tblStaffList");
    $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted"><i class="fa-solid fa-spinner fa-spin me-2"></i>Personeller yükleniyor...</td></tr>');

    $.ajax({
        url: "/Admin/GetStaffList",
        type: "GET",
        success: function (response) {
            if (response.success && response.data) {
                rawStaffList = response.data;
                renderStaffTable();
            } else {
                $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted">Henüz kayıtlı personel bulunmuyor.</td></tr>');
            }
        },
        error: function () {
            $tbody.html('<tr><td colspan="5" class="text-center py-4 text-danger"><i class="fa-solid fa-triangle-exclamation me-2"></i>Personeller yüklenirken bir hata oluştu.</td></tr>');
        }
    });
}

// ----------------------------------------------------
// Filtrelere Göre Tabloyu Ekrana Çizen Fonksiyon (Render)
// ----------------------------------------------------
function getFilteredStaffList() {
    let searchText = ($('#filterStaffSearch').val() || '').toLowerCase().trim();
    let selectedRole = $('#filterStaffRole').val();

    return rawStaffList.filter(function (staff) {
        let matchesSearch = true;
        if (searchText) {
            let name = (staff.fullName || '').toLowerCase();
            let email = (staff.email || '').toLowerCase();
            matchesSearch = name.includes(searchText) || email.includes(searchText);
        }

        let matchesRole = true;
        if (selectedRole) {
            matchesRole = staff.role === selectedRole;
        }

        return matchesSearch && matchesRole;
    });
}

function renderStaffTable() {
    var $tbody = $("#tblStaffList");
    $tbody.empty();

    let filteredData = getFilteredStaffList();

    if (filteredData.length === 0) {
        $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted"><i class="fa-solid fa-magnifying-glass me-2"></i>Aramanıza uygun personel bulunamadı.</td></tr>');
        return;
    }

    var rows = "";
    $.each(filteredData, function (index, staff) {
        var badgeClass = "badge-garson";
        if (staff.role === "Mutfak Şefi" || staff.role === "Mutfak") {
            badgeClass = "badge-mutfak";
        } else if (staff.role === "Garson/Kasiyer" || staff.role === "Kasiyer") {
            badgeClass = "badge-kasiyer";
        }

        rows += `
            <tr>
                <td class="fw-bold text-secondary">${index + 1}</td>
                <td class="fw-semibold text-dark">${staff.fullName}</td>
                <td>${staff.email}</td>
                <td><span class="badge ${badgeClass} badge-role">${staff.role}</span></td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-danger border-0 rounded-2" onclick="deleteStaff(${staff.id})" title="Sil">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    $tbody.html(rows);
}

// ----------------------------------------------------
// Excel'e Aktar (.xlsx) Fonksiyonu (SheetJS)
// ----------------------------------------------------
function exportStaffToExcel() {
    let filteredData = getFilteredStaffList();

    if (filteredData.length === 0) {
        Swal.fire("Uyarı", "Dışa aktarılacak personel kaydı bulunamadı.", "warning");
        return;
    }

    // Excel sütun formatı hazırlama
    let excelRows = filteredData.map(function (staff, index) {
        return {
            "No": index + 1,
            "Ad Soyad": staff.fullName || "",
            "E-Posta / Kullanıcı Adı": staff.email || "",
            "Rol": staff.role || ""
        };
    });

    // SheetJS ile Workbook oluşturma
    let worksheet = XLSX.utils.json_to_sheet(excelRows);
    let workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Personel Listesi");

    // Sütun genişliklerini otomatik ayarla
    worksheet['!cols'] = [
        { wch: 6 },
        { wch: 25 },
        { wch: 30 },
        { wch: 20 }
    ];

    // İndirme işlemini başlat
    let fileName = `Personel_Listesi_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

// ----------------------------------------------------
// Personel Silme Fonksiyonu
// ----------------------------------------------------
function deleteStaff(staffId) {
    Swal.fire({
        title: "Emin misiniz?",
        text: "Bu personeli silmek istediğinize emin misiniz?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#e53e3e",
        cancelButtonColor: "#718096",
        confirmButtonText: "Evet, Sil",
        cancelButtonText: "Vazgeç"
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: "/Admin/DeleteStaff",
                type: "POST",
                data: { id: staffId },
                success: function (response) {
                    if (response.success) {
                        Swal.fire({
                            icon: "success",
                            title: "Silindi!",
                            text: response.message || "Personel başarıyla silindi.",
                            timer: 1500,
                            showConfirmButton: false
                        });
                        loadStaffList();
                    } else {
                        Swal.fire("Hata", response.message, "error");
                    }
                },
                error: function () {
                    Swal.fire("Hata", "Silme işlemi sırasında hata oluştu.", "error");
                }
            });
        }
    });
}