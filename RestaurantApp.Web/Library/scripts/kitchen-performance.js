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

    // Tema ve biçim: lz-charts.js. Tek seri çizgi: 2px, soluk alan, son nokta vurgulu; ipucunda önce değer
    var C = LzCharts.COLORS;
    var lastIndex = values.length - 1;
    kitchenChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ortalama hazırlık süresi',
                data: values,
                borderColor: C.accent,
                backgroundColor: C.area,
                fill: true,
                tension: 0.35,
                pointRadius: values.map(function (_, i) { return i === lastIndex ? 4 : 0; }),
                pointBackgroundColor: C.accent,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointHoverRadius: 5
            }]
        },
        options: {
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: function (items) { return items[0].parsed.y + ' dk'; },
                        label: function (item) { return item.label + ' · ortalama hazırlık'; }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        maxTicksLimit: 6,
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