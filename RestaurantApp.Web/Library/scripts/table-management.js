$(document).ready(function () {
    // Masa Ekleme İşlemi
    $("#btnSaveTable").on("click", function () {
        var tableNum = $("#txtTableNumber").val() ? $("#txtTableNumber").val().trim() : "";

        if (!tableNum) {
            Swal.fire("Uyarı", "Lütfen masa numarası giriniz.", "warning");
            return;
        }

        $.post("/Admin/AddTable", { tableNumber: tableNum }, function (res) {
            if (res.success) {
                Swal.fire("Başarılı!", res.message, "success").then(function () {
                    location.reload();
                });
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        });
    });

    // Masa Silme İşlemi
    $(".btn-delete-table").on("click", function () {
        var id = $(this).data("id");

        Swal.fire({
            title: "Emin misiniz?",
            text: "Bu masayı silmek istediğinize emin misiniz?",
            icon: "warning",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#3085d6",
            confirmButtonText: "Evet, Sil!",
            cancelButtonText: "İptal"
        }).then(function (result) {
            if (result.isConfirmed) {
                $.post("/Admin/DeleteTable", { id: id }, function (res) {
                    if (res.success) {
                        Swal.fire("Silindi!", res.message, "success").then(function () {
                            location.reload();
                        });
                    } else {
                        Swal.fire("Hata", res.message, "error");
                    }
                });
            }
        });
    });
});