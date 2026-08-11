$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

var revenueChartInstance = null;
var topProductsChartInstance = null;
var hourlyChartInstance = null;
var currentPeriod = "daily";

$(document).ready(function () {
    console.log("Financial Reports JS Yüklendi.");
    initEmptyCharts();
    loadFinancialData();
});

function initEmptyCharts() {
    // 1. Ciro Grafiği
    var ctxRevenue = document.getElementById('revenueChart').getContext('2d');
    revenueChartInstance = new Chart(ctxRevenue, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Ciro (₺)',
                data: [],
                backgroundColor: 'rgba(74, 21, 75, 0.85)',
                borderColor: '#4a154b',
                borderWidth: 1,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });

    // 2. Top 5 Ürün Grafiği (Yatay Bar)
    var ctxTop = document.getElementById('topProductsChart').getContext('2d');
    topProductsChartInstance = new Chart(ctxTop, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Satış Adedi',
                data: [],
                backgroundColor: 'rgba(25, 135, 84, 0.85)',
                borderColor: '#198754',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true } }
        }
    });

    // 3. Saatlik Yoğunluk Grafiği (Çizgi Grafik)
    var ctxHourly = document.getElementById('hourlyDensityChart').getContext('2d');
    hourlyChartInstance = new Chart(ctxHourly, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Sipariş Adedi',
                data: [],
                borderColor: '#0dcaf0',
                backgroundColor: 'rgba(13, 202, 240, 0.15)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function changeRevenuePeriod(period, btn) {
    $(".btn-time-filter").removeClass("active");
    $(btn).addClass("active");
    currentPeriod = period;
    loadFinancialData();
}

function loadFinancialData() {
    $.ajax({
        url: "/Admin/GetFinancialData",
        type: "GET",
        data: { period: currentPeriod },
        cache: false,
        success: function (res) {
            if (res.success && res.data) {
                var d = res.data;

                // 1. Özet Kartları Güncelle
                $("#lblTodayRevenue").text(parseFloat(d.todayRevenue || 0).toFixed(2) + " ₺");
                $("#lblTodayOrderCount").text(d.todayOrderCount || 0);
                $("#lblAvgOrderAmount").text(parseFloat(d.avgOrderAmount || 0).toFixed(2) + " ₺");
                $("#lblTopSellingProduct").text(d.topSellingProduct || "--");

                // 2. Ciro Grafiğini Güncelle
                if (revenueChartInstance && d.revenueChart) {
                    revenueChartInstance.data.labels = d.revenueChart.labels;
                    revenueChartInstance.data.datasets[0].data = d.revenueChart.data;
                    revenueChartInstance.update();
                }

                // 3. Top 5 Ürün Grafiğini Güncelle
                if (topProductsChartInstance && d.topProductsChart) {
                    topProductsChartInstance.data.labels = d.topProductsChart.labels;
                    topProductsChartInstance.data.datasets[0].data = d.topProductsChart.data;
                    topProductsChartInstance.update();
                }

                // 4. Saatlik Yoğunluk Grafiğini Güncelle
                if (hourlyChartInstance && d.hourlyChart) {
                    hourlyChartInstance.data.labels = d.hourlyChart.labels;
                    hourlyChartInstance.data.datasets[0].data = d.hourlyChart.data;
                    hourlyChartInstance.update();
                }
            } else {
                console.error("Finansal veriler çekilemedi:", res.message);
            }
        },
        error: function (xhr) {
            console.error("Finansal Veri Çekme Hatası:", xhr);
        }
    });
}