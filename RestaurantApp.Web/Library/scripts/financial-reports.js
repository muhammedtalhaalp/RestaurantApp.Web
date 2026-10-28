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
    loadChannelReport();
});

// ===================================================
// SATIŞ KANALLARI & PLATFORM KOMİSYONU
// ===================================================
var currentChannelPeriod = "today";

function changeChannelPeriod(period, btn) {
    $("#channelPeriodGroup .btn-time-filter").removeClass("active");
    $(btn).addClass("active");
    currentChannelPeriod = period;
    loadChannelReport();
}

function loadChannelReport() {
    $.ajax({
        url: "/Admin/GetChannelReport",
        type: "GET",
        data: { period: currentChannelPeriod },
        cache: false,
        success: function (res) {
            if (!res || !res.success) {
                $("#channelReportBody").html(`<tr><td colspan="6" class="text-center text-danger py-4">${(res && res.message) || "Kanal raporu yüklenemedi."}</td></tr>`);
                return;
            }
            renderChannelReport(res.data);
        }
    });
}

function channelMeta(row) {
    if (row.channel === "Masa") {
        return { html: '<span class="channel-pill" style="--channel-color:#0f766e"><i class="fa-solid fa-chair"></i>Salon (Masa)</span>', color: "#0f766e" };
    }
    var meta = DeliveryChannels.get(row.channel);
    return { html: DeliveryChannels.badge(row.channel), color: meta.color };
}

function renderChannelReport(d) {
    $("#channelTotalGross").text(formatMoney(d.totals.gross));
    $("#channelTotalCommission").text("- " + formatMoney(d.totals.commission));
    $("#channelTotalNet").text(formatMoney(d.totals.net));

    if (!d.rows.length) {
        $("#channelReportBody").html('<tr><td colspan="6" class="text-center text-muted py-4">Bu aralıkta sipariş yok.</td></tr>');
        return;
    }

    var total = d.totals.gross || 1;
    var html = d.rows.map(function (r) {
        var meta = channelMeta(r);
        var share = r.gross / total * 100;
        var commissionHtml = r.isPlatform
            ? `<span class="text-danger fw-semibold">- ${formatMoney(r.commission)}</span><div class="small text-muted">ort. %${r.averageRate}</div>`
            : '<span class="text-muted">—</span>';
        return `
            <tr>
                <td>${meta.html}</td>
                <td class="text-end">${r.orderCount}</td>
                <td class="text-end fw-semibold">${formatMoney(r.gross)}</td>
                <td class="text-end">${commissionHtml}</td>
                <td class="text-end fw-bold text-success">${formatMoney(r.net)}</td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="channel-share-bar flex-grow-1"><div style="width:${Math.max(2, share)}%; background:${meta.color}"></div></div>
                        <span class="small text-muted" style="min-width: 42px;">%${share.toFixed(1)}</span>
                    </div>
                </td>
            </tr>`;
    }).join("");

    html += `
        <tr class="channel-total-row">
            <td class="fw-bold">Toplam</td>
            <td class="text-end fw-bold">${d.totals.orderCount}</td>
            <td class="text-end fw-bold">${formatMoney(d.totals.gross)}</td>
            <td class="text-end fw-bold text-danger">- ${formatMoney(d.totals.commission)}</td>
            <td class="text-end fw-bold text-success">${formatMoney(d.totals.net)}</td>
            <td></td>
        </tr>`;

    $("#channelReportBody").html(html);
}

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