$(document).ready(function () {
    var allTablesData = [];
    var currentSectionFilter = "Hepsi";
    var customSections = ["Salon", "Bahçe", "Balkon", "Teras", "Üst Kat"];

    // Kaydedilmiş özel alanları yükle
    var storedSections = localStorage.getItem("custom_restaurant_sections");
    if (storedSections) {
        try {
            customSections = JSON.parse(storedSections);
        } catch (e) {
            console.error("Custom sections parse hatası", e);
        }
    }

    loadTables();

    // Sekmeler (Tabs) arasında geçiş
    $(document).on("click", "#sectionTabs .nav-link", function () {
        $("#sectionTabs .nav-link").removeClass("active");
        $(this).addClass("active");

        currentSectionFilter = $(this).data("section");
        renderTableCards();
    });

    // Alan Yönetimi Modalı Açıldığında Listeyi Yenile
    $("#btnOpenManageSectionsModal").on("click", function () {
        renderSectionManageList();
    });

    function loadTables() {
        $.get("/Admin/GetTables", function (res) {
            if (res.success) {
                allTablesData = res.data;

                // Veritabanındaki masalarda kayıtlı olan farklı alan isimlerini de listeye dahil et
                $.each(allTablesData, function (i, t) {
                    if (t.section && !customSections.some(s => s.toLowerCase() === t.section.toLowerCase())) {
                        customSections.push(t.section);
                    }
                });

                saveCustomSections();
                renderSectionTabs();
                renderSectionSelectOptions();
                renderTableCards();
            } else {
                Swal.fire("Hata", "Masalar yüklenirken sorun oluştu: " + res.message, "error");
            }
        });
    }

    function saveCustomSections() {
        localStorage.setItem("custom_restaurant_sections", JSON.stringify(customSections));
    }

    // Dinamik Sekmeleri Çiz
    function renderSectionTabs() {
        var $tabs = $("#sectionTabs");
        var activeSection = currentSectionFilter;

        var html = `
            <li class="nav-item">
                <button class="nav-link ${activeSection === 'Hepsi' ? 'active' : ''} fw-bold py-2 rounded-3" data-section="Hepsi">Tümü</button>
            </li>
        `;

        $.each(customSections, function (i, secName) {
            var isActive = activeSection.toLowerCase() === secName.toLowerCase() ? "active" : "";
            html += `
                <li class="nav-item">
                    <button class="nav-link ${isActive} fw-bold py-2 rounded-3" data-section="${secName}">${secName}</button>
                </li>
            `;
        });

        $tabs.html(html);
    }

    // Select Opsiyonlarını Çiz
    function renderSectionSelectOptions() {
        var $select = $("#selectSection");
        var html = "";

        $.each(customSections, function (i, secName) {
            html += `<option value="${secName}">${secName}</option>`;
        });

        $select.html(html);
    }

    // Modal İçindeki Alan Silme/Listeleme Ekranını Çiz
    function renderSectionManageList() {
        var $list = $("#sectionListContainer");
        $list.empty();

        if (customSections.length === 0) {
            $list.html('<li class="list-group-item text-center text-muted py-3">Henüz tanımlı alan bulunmuyor.</li>');
            return;
        }

        $.each(customSections, function (i, secName) {
            // O alana ait bağlı aktif masa sayısını hesapla
            var countTables = allTablesData.filter(t => (t.section || "").toLowerCase() === secName.toLowerCase()).length;
            var badgeText = countTables > 0 ? `${countTables} Masa Var` : 'Masa Yok';
            var badgeClass = countTables > 0 ? 'bg-primary-subtle text-primary' : 'bg-light text-muted border';

            var itemHtml = `
                <li class="list-group-item d-flex justify-content-between align-items-center py-2 px-3">
                    <div>
                        <span class="fw-semibold text-dark">${secName}</span>
                        <span class="badge ${badgeClass} ms-2 extra-small">${badgeText}</span>
                    </div>
                    <button class="btn btn-sm btn-outline-danger border-0 rounded-circle py-1 px-2 btn-delete-section" data-name="${secName}" title="Alanı Sil">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </li>
            `;
            $list.append(itemHtml);
        });
    }

    // Özel Alan Ekleme
    $("#btnAddSectionCustom").on("click", function () {
        var newSec = $("#txtNewSectionName").val() ? $("#txtNewSectionName").val().trim() : "";

        if (!newSec) {
            Swal.fire("Uyarı", "Lütfen bir alan adı giriniz.", "warning");
            return;
        }

        if (customSections.some(s => s.toLowerCase() === newSec.toLowerCase())) {
            Swal.fire("Uyarı", "Bu alan adı zaten mevcut!", "warning");
            return;
        }

        customSections.push(newSec);
        saveCustomSections();
        renderSectionTabs();
        renderSectionSelectOptions();
        renderSectionManageList();

        $("#txtNewSectionName").val("");

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: "success",
            title: `"${newSec}" alanı eklendi!`,
            showConfirmButton: false,
            timer: 1500
        });
    });

    // Alan Silme Butonuna Tıklandığında
    $(document).on("click", ".btn-delete-section", function () {
        var secToDelete = $(this).data("name");

        // Kontrol: Bu alanda aktif masa var mı?
        var attachedTables = allTablesData.filter(t => (t.section || "").toLowerCase() === secToDelete.toLowerCase());

        if (attachedTables.length > 0) {
            Swal.fire({
                title: "Alan Silinemez!",
                text: `"${secToDelete}" alanında ${attachedTables.length} adet kayıtlı masa bulunmaktadır. Alanı silebilmek için önce bu masaları silmeli veya alanlarını değiştirmelisiniz.`,
                icon: "warning",
                confirmButtonColor: "#4a154b"
            });
            return;
        }

        Swal.fire({
            title: "Alan Silinsin mi?",
            text: `"${secToDelete}" alanını silmek istediğinize emin misiniz?`,
            icon: "question",
            showCancelButton: true,
            confirmButtonColor: "#d33",
            cancelButtonColor: "#6c757d",
            confirmButtonText: "Evet, Sil",
            cancelButtonText: "Vazgeç"
        }).then(function (result) {
            if (result.isConfirmed) {
                customSections = customSections.filter(s => s.toLowerCase() !== secToDelete.toLowerCase());
                saveCustomSections();

                if (currentSectionFilter.toLowerCase() === secToDelete.toLowerCase()) {
                    currentSectionFilter = "Hepsi";
                }

                renderSectionTabs();
                renderSectionSelectOptions();
                renderSectionManageList();
                renderTableCards();

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: "success",
                    title: `"${secToDelete}" alanı silindi!`,
                    showConfirmButton: false,
                    timer: 1500
                });
            }
        });
    });

    function renderTableCards() {
        var $container = $("#tableCardContainer");
        $container.empty();

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
            var rawStatus = (t.status || "").trim().toLowerCase();
            var amountVal = parseFloat(t.currentAmount || 0);

            var isOccupied = amountVal > 0 || (rawStatus !== "bos" && rawStatus !== "boş" && rawStatus !== "");

            var cardClass = isOccupied ? "table-occupied" : "table-empty";

            var badgeHtml = isOccupied
                ? '<span class="table-card-badge badge-paid" style="background-color: #ffffff; color: #dc2626; font-weight: 700;">AÇIK HESAP / DOLU</span>'
                : '<span class="table-card-badge badge-empty">BOŞ MASA</span>';

            var statusText = isOccupied ? "Adisyon Açık / Ödeme Bekliyor" : "Boş Masa";

            var priceHtml = isOccupied
                ? `<div class="table-card-price fw-bold fs-5 mt-2" style="color: #ffffff;">${amountVal.toFixed(2)} ₺</div>`
                : `<div class="table-card-price fw-bold fs-5 mt-2 opacity-50">0.00 ₺</div>`;

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

    // Yeni Masa Ekle
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

    // Masa Sil
    $(document).on("click", ".btn-delete-card-table", function (e) {
        e.stopPropagation();
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