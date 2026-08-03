$(document).ready(function () {
    console.log("Personel Yönetimi JS yüklendi.");

    // 1. Sayfa Açıldığında Personel Listesini Yükle
    loadStaffList();

    // 2. Yeni Personel Kayıt Formu Gönderimi
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
            url: "/Admin/AddStaff", // Backend Controller metod adresi
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

                    // Modal'ı Kapat ve Formu Sıfırla
                    $("#modalAddStaff").modal("hide");
                    $("#formAddStaff")[0].reset();

                    // Tabloyu Yenile
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
// Personel Listesini AJAX ile Getiren Fonksiyon
// ----------------------------------------------------
function loadStaffList() {
    var $tbody = $("#tblStaffList");
    $tbody.html('<tr><td colspan="5" class="text-center py-4 text-muted"><i class="fa-solid fa-spinner fa-spin me-2"></i>Personeller yükleniyor...</td></tr>');

    $.ajax({
        url: "/Admin/GetStaffList", // Backend Controller metod adresi
        type: "GET",
        success: function (response) {
            if (response.success && response.data && response.data.length > 0) {
                var rows = "";
                $.each(response.data, function (index, staff) {
                    // Mutfak Şefi ve Garson/Kasiyer için rozet sınıfı seçimi
                    var badgeClass = "badge-garson";
                    if (staff.role === "Mutfak Şefi") {
                        badgeClass = "badge-mutfak";
                    } else if (staff.role === "Garson/Kasiyer") {
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