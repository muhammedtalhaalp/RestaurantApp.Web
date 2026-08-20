$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var currentFilter = "today";
var kitchenChartInstance = null;

$(document).ready(function () {
    console.log("Kitchen Performance JS Yüklendi.");
    loadKitchenPerformanceData();
});

function changePerformanceFilter(filterKey, btnEl) {
    currentFilter = filterKey;
    $(".btn-perf-filter").removeClass("active");
    $(btnEl).addClass("active");

    loadKitchenPerformanceData();
}

function loadKitchenPerformanceData() {
    $.ajax({
        url: "/Kitchen/GetKitchenPerformanceData",
        type: "GET",
        data: { filter: currentFilter },
        cache: false,
        success: function (res) {
            if (res.success && res.data) {
                renderKPIs(res.data);
                renderPerformanceChart(res.data.chartLabels, res.data.chartAvgTimes);
                renderTopProductsTable(res.data.topProducts);
            } else {
                Swal.fire("Uyarı", res.message || "Veriler alınamadı.", "warning");
            }
        },
        error: function () {
            Swal.fire("Hata", "Performans verileri yüklenirken sunucu hatası oluştu.", "error");
        }
    });
}

function renderKPIs(data) {
    $("#kpiAvgPrepTime").text(data.avgPrepTimeMinutes);
    $("#kpiTotalPortions").text(data.totalPortions);
    $("#kpiTotalOrders").text(data.totalOrders);
    $("#kpiOnTimeRate").text("%" + data.onTimeSuccessRate);
    $("#kpiDelayedOrders").text(data.delayedOrdersCount);
}

function renderPerformanceChart(labels, values) {
    var ctx = document.getElementById('hourlyKitchenPerformanceChart');
    if (!ctx) return;

    if (kitchenChartInstance) {
        kitchenChartInstance.destroy();
    }

    kitchenChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ortalama Hazırlık Süresi (Dk)',
                data: values,
                borderColor: '#4a154b',
                backgroundColor: 'rgba(74, 21, 75, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#4a154b',
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return ` Süre: ${context.parsed.y} Dakika`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#f1f5f9'
                    },
                    ticks: {
                        callback: function (val) {
                            return val + " dk";
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderTopProductsTable(products) {
    var $tbody = $("#topKitchenProductsBody").empty();

    if (!products || products.length === 0) {
        $tbody.html('<tr><td colspan="3" class="text-center py-4 text-muted small">Bu dönemde tamamlanan ürün bulunamadı.</td></tr>');
        return;
    }

    $.each(products, function (i, p) {
        var row = `
            <tr>
                <td class="fw-semibold text-dark text-ellipsis-1" style="max-width: 130px;" title="${p.productName}">
                    ${p.productName}
                </td>
                <td class="text-center">
                    <span class="badge bg-light text-dark border px-2 py-1 fw-bold">${p.totalCount} Adet</span>
                </td>
                <td class="text-end fw-bold text-success">
                    ${parseFloat(p.totalAmount).toFixed(2)} ₺
                </td>
            </tr>`;
        $tbody.append(row);
    });
}