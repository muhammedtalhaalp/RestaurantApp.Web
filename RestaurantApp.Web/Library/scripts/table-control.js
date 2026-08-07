$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

$(document).ready(function () {
    console.log("Masa Kontrol JS Yüklendi.");
    loadOccupiedTables();
});

function loadOccupiedTables() {
    $.ajax({
        url: "/Table/GetOccupiedTables",
        type: "GET",
        cache: false,
        success: function (res) {
            var $container = $("#occupiedTablesContainer");
            var $badge = $("#occupiedCountBadge");

            if (res.success && res.data && res.data.length > 0) {
                $badge.text(`${res.data.length} Dolu Masa`);
                var html = "";

                $.each(res.data, function (i, table) {
                    var rawName = table.tableName || '';
                    var tableNameFormatted = rawName.toLowerCase().startsWith('masa') ? rawName : `Masa ${rawName}`;
                    var totalAmountFormatted = parseFloat(table.totalAmount || 0).toFixed(2);

                    html += `
                        <div class="col-md-4 col-lg-3" id="table-card-${table.tableId}">
                            <div class="card h-100 border-0 p-3 table-card-occupied shadow-sm">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="fw-bold mb-0 text-dark">
                                        <i class="fa-solid fa-chair me-2 text-danger"></i>${tableNameFormatted}
                                    </h6>
                                    <span class="badge bg-danger text-white px-2 py-1 rounded-2">Dolu</span>
                                </div>
                                <p class="text-muted small mb-1"><i class="fa-solid fa-layer-group me-1"></i>Bölüm: ${table.section || 'Salon'}</p>
                                <div class="fs-5 fw-bold mb-3" style="color: #4a154b;">
                                    Adisyon Tutarı: ${totalAmountFormatted} ₺
                                </div>
                                <div class="pt-2 border-top mt-auto">
                                    <button class="btn btn-success w-100 py-2 fw-bold" onclick="closeAndPayTable(${table.tableId}, '${tableNameFormatted}', ${totalAmountFormatted})">
                                        <i class="fa-solid fa-credit-card me-2"></i>Ödeme Al & Masayı Boşalt
                                    </button>
                                </div>
                            </div>
                        </div>`;
                });

                $container.html(html);
            } else {
                $badge.text("0 Dolu Masa");
                $container.html(`
                    <div class="col-12 text-center py-5 text-muted">
                        <i class="fa-solid fa-circle-check text-success fs-1 mb-3 opacity-50 d-block"></i>
                        <h5>Şu an dolu olan masa bulunmamaktadır. Tüm masalar boş!</h5>
                    </div>`);
            }
        },
        error: function (xhr) {
            console.error("Dolu Masalar Çekilemedi:", xhr);
        }
    });
}

function closeAndPayTable(tableId, tableName, amount) {
    Swal.fire({
        title: 'Ödeme Alınsın mı?',
        text: `${tableName} için toplam ${amount} ₺ ödeme alındı olarak işaretlenip masa boşaltılacak.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#198754',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Evet, Ödeme Alındı & Kapat',
        cancelButtonText: 'Vazgeç'
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: "/Table/CloseTableAndPay",
                type: "POST",
                data: { tableId: tableId },
                success: function (res) {
                    if (res.success) {
                        Swal.fire({
                            toast: true,
                            position: 'top-end',
                            icon: 'success',
                            title: 'Masa kapatıldı ve ödeme tamamlandı!',
                            showConfirmButton: false,
                            timer: 1500
                        });

                        loadOccupiedTables();
                    } else {
                        Swal.fire('Hata!', res.message, 'error');
                    }
                }
            });
        }
    });
}