$(document).ready(function () {
    var allTablesData = [];
    var currentSectionFilter = "Hepsi";

    // Sayfa yüklenince masaları getir
    loadTables();

    // Sekmeler (Tabs) arasında geçiş yapıldığında filtreleme
    $(document).on("click", "#sectionTabs .nav-link", function () {
        $("#sectionTabs .nav-link").removeClass("active");
        $(this).addClass("active");

        currentSectionFilter = $(this).data("section");
        renderTableCards();
    });

    // Masaları Backend'den Çekme
    function loadTables() {
        $.get("/Admin/GetTables", function (res) {
            if (res.success) {
                allTablesData = res.data;
                renderTableCards();
            } else {
                Swal.fire("Hata", "Masalar yüklenirken sorun oluştu: " + res.message, "error");
            }
        });
    }

    // Masa Kartlarını Ekrana Çizme Mantığı
    function renderTableCards() {
        var $container = $("#tableCardContainer");
        $container.empty();

        // Seçili sekmedeki alana göre filtrele
        var filteredTables = allTablesData.filter(function (t) {
            if (currentSectionFilter === "Hepsi") return true;
            return (t.section || "Salon").toLowerCase() === currentSectionFilter.toLowerCase();
        });

        if (filteredTables.length === 0) {
            $container.html(`
                <div class="col-12 text-center py-5">
                    <p class="text-muted fw-semibold">Bu alanda (${currentSectionFilter}) henüz kayıtlı bir masa bulunmuyor.</p>
                </div>
            `);
            return;
        }

        $.each(filteredTables, function (i, t) {
            var isOccupied = t.status !== "Bos";
            var cardClass = isOccupied ? "table-occupied" : "table-empty";
            var badgeHtml = isOccupied ? '<span class="table-card-badge badge-paid">ÖDENDİ / DOLU</span>' : '';
            var statusText = isOccupied ? "Ödeme alındı / Sipariş var" : "Boş Masa";
            var priceHtml = isOccupied ? '<div class="table-card-price">0.00 TL</div>' : '';

            var cardHtml = `
                <div class="col-12 col-sm-6 col-md-4 col-lg-3">
                    <div class="table-card ${cardClass} p-3" data-id="${t.tableId}">
                        <button class="btn btn-sm btn-danger btn-delete-card-table rounded-circle" data-id="${t.tableId}" title="Masayı Sil">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                        <div class="table-card-header">
                            <span class="table-card-number">${t.tableNumber}</span>
                            ${badgeHtml}
                        </div>
                        <div class="table-card-body">
                            <span class="table-card-status-text">${statusText}</span>
                            ${priceHtml}
                        </div>
                    </div>
                </div>
            `;

            $container.append(cardHtml);
        });
    }

    // Modal Üzerinden Yeni Masa Ekleme
    $("#btnSaveTable").on("click", function () {
        var tableNum = $("#txtTableNumber").val() ? $("#txtTableNumber").val().trim() : "";
        var section = $("#selectSection").val();

        if (!tableNum) {
            Swal.fire("Uyarı", "Lütfen masa adı/numarası giriniz.", "warning");
            return;
        }

        $.post("/Admin/AddTable", {
            tableNumber: tableNum,
            section: section
        }, function (res) {
            if (res.success) {
                $("#addTableModal").modal("hide");
                $("#txtTableNumber").val("");
                Swal.fire({
                    icon: "success",
                    title: "Başarılı!",
                    text: res.message,
                    timer: 1500,
                    showConfirmButton: false
                });
                loadTables();
            } else {
                Swal.fire("Hata", res.message, "error");
            }
        });
    });

    // Kart Üzerinden Masa Silme İşlemi
    $(document).on("click", ".btn-delete-card-table", function (e) {
        e.stopPropagation(); // Kart tıklama olayını engeller
        var id = $(this).data("id");

        Swal.fire({
            title: "Masa Silinsin mi?",
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
                        loadTables();
                    } else {
                        Swal.fire("Hata", res.message, "error");
                    }
                });
            }
        });
    });
});