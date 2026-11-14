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

// ===================================================
// GRAFİKLER (tema ve yardımcılar: lz-charts.js)
// ===================================================
var PERIOD_TEXT = {
    daily: { now: "şu anki 2 saatlik dilim", ref: "Önceki dilimler ort." },
    weekly: { now: "bugün", ref: "Önceki 6 gün ort." },
    monthly: { now: "bu ay", ref: "Önceki 5 ay ort." }
};

function initEmptyCharts() {
    var C = LzCharts.COLORS;

    // 1. Ciro: tek seri, güncel dönem vurgulu; önceki dönemlerin ortalaması ince çizgi
    revenueChartInstance = new Chart(document.getElementById("revenueChart"), {
        type: "bar",
        data: { labels: [], datasets: [{ label: "Ciro", data: [], backgroundColor: [], hoverBackgroundColor: C.accent }] },
        plugins: [LzCharts.referenceLine, LzCharts.valueLabels],
        options: {
            interaction: { mode: "index", intersect: false },
            plugins: {
                lzReference: {},
                lzValueLabels: { indices: [], format: function (v) { return LzCharts.moneyRound(v); } },
                tooltip: {
                    callbacks: {
                        title: function (items) { return LzCharts.money(items[0].parsed.y); },
                        label: function (item) { return item.label; }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, grace: "12%", ticks: { callback: function (v) { return LzCharts.moneyAxis(v, this.max); }, maxTicksLimit: 6 } },
                x: { grid: { display: false } }
            }
        }
    });

    // 2. En çok satan 5 ürün: yatay çubuk, adet çubuk ucunda (5 çubuk; eksen gerekmez)
    topProductsChartInstance = new Chart(document.getElementById("topProductsChart"), {
        type: "bar",
        data: { labels: [], datasets: [{ label: "Satış adedi", data: [], backgroundColor: C.accent }] },
        plugins: [LzCharts.valueLabels],
        options: {
            indexAxis: "y",
            layout: { padding: { right: 36 } },
            interaction: { mode: "index", intersect: false, axis: "y" },
            plugins: {
                lzValueLabels: { indices: [], format: function (v) { return LzCharts.count(v) + " adet"; } },
                tooltip: {
                    callbacks: {
                        title: function (items) { return LzCharts.count(items[0].parsed.x) + " adet"; },
                        label: function (item) { return item.label; }
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, display: false, grace: "18%" },
                y: { grid: { display: false }, ticks: { color: C.text, font: { weight: "600" } } }
            }
        }
    });

    // 3. Saatlik yoğunluk: saat saat sayım olduğu için sütun; en yoğun saat vurgulu
    hourlyChartInstance = new Chart(document.getElementById("hourlyDensityChart"), {
        type: "bar",
        data: { labels: [], datasets: [{ label: "Sipariş", data: [], backgroundColor: [], hoverBackgroundColor: C.accent }] },
        plugins: [LzCharts.valueLabels],
        options: {
            interaction: { mode: "index", intersect: false },
            plugins: {
                lzValueLabels: { indices: [], format: function (v) { return LzCharts.count(v); } },
                tooltip: {
                    callbacks: {
                        title: function (items) { return LzCharts.count(items[0].parsed.y) + " sipariş"; },
                        label: function (item) { return item.label + " – " + nextHour(item.label); }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, grace: "15%", ticks: { precision: 0, maxTicksLimit: 5 } },
                x: { grid: { display: false } }
            }
        }
    });
}

function nextHour(label) {
    var h = parseInt(label, 10);
    return (isNaN(h) ? "" : String((h + 1) % 24).padStart(2, "0") + ":00");
}

function changeRevenuePeriod(period, btn) {
    $("#timeFilterGroup .btn-time-filter").removeClass("active");
    $(btn).addClass("active");
    currentPeriod = period;
    loadFinancialData();
}

function renderStatTiles(d) {
    var cmp = d.comparison || {}, trend = d.trend || { labels: [], revenue: [], orderCount: [], avgOrderAmount: [] };
    var period = cmp.label || "dünün bu saatine göre";

    $("#lblTodayRevenue").text(LzCharts.money(d.todayRevenue));
    $("#lblTodayOrderCount").text(LzCharts.count(d.todayOrderCount));
    $("#lblAvgOrderAmount").text(LzCharts.money(d.avgOrderAmount));
    $("#lblTopSellingProduct").text(d.topSellingProduct || "–").attr("title", d.topSellingProduct || "");
    $("#lblTopSellingQuantity").text(d.topSellingQuantity ? "Bugün " + LzCharts.count(d.topSellingQuantity) + " adet satıldı" : "Bugün henüz satış yok");

    LzCharts.delta("#deltaRevenue", d.todayRevenue, cmp.revenue, period, true);
    LzCharts.delta("#deltaOrders", d.todayOrderCount, cmp.orderCount, period, true);
    LzCharts.delta("#deltaAvg", d.avgOrderAmount, cmp.avgOrderAmount, period, true);

    LzCharts.sparkline(document.getElementById("sparkRevenue"), trend.revenue, trend.labels, LzCharts.moneyRound);
    LzCharts.sparkline(document.getElementById("sparkOrders"), trend.orderCount, trend.labels, LzCharts.count);
    LzCharts.sparkline(document.getElementById("sparkAvg"), trend.avgOrderAmount, trend.labels, LzCharts.moneyRound);
}

function renderRevenueChart(chart) {
    var values = chart.data.map(function (v) { return v === null ? null : Number(v); });
    var current = LzCharts.lastIndexWithValue(values);
    var previous = values.filter(function (v, i) { return v !== null && i !== current; });
    var avg = previous.length ? previous.reduce(function (a, b) { return a + b; }, 0) / previous.length : null;
    var text = PERIOD_TEXT[currentPeriod] || PERIOD_TEXT.daily;

    var c = revenueChartInstance;
    c.data.labels = chart.labels;
    c.data.datasets[0].data = values;
    c.data.datasets[0].backgroundColor = LzCharts.emphasis(values, current);
    c.options.plugins.lzValueLabels.indices = current >= 0 ? [current] : [];
    c.options.plugins.lzReference = avg !== null && avg > 0 ? { value: avg, label: text.ref + " " + LzCharts.moneyRound(avg) } : {};
    c.update();

    $("#revenueCaption").text("Koyu mor: " + text.now + (avg ? " · ince çizgi: önceki dönemlerin ortalaması" : ""));
    $("#revenueChart").attr("aria-label", "Ciro grafiği: " + chart.labels.map(function (l, i) {
        return l + " " + (values[i] === null ? "henüz yok" : LzCharts.moneyRound(values[i]));
    }).join(", "));
}

function renderTopProducts(chart) {
    var c = topProductsChartInstance;
    c.data.labels = chart.labels;
    c.data.datasets[0].data = chart.data;
    c.options.plugins.lzValueLabels.indices = chart.data.map(function (_, i) { return i; });
    c.update();
    $("#topProductsChart").attr("aria-label", "En çok satan ürünler (son 30 gün): " + chart.labels.map(function (l, i) {
        return l + " " + chart.data[i] + " adet";
    }).join(", "));
}

function renderHourly(chart) {
    var values = chart.data.map(function (v) { return v === null ? null : Number(v); });
    var peak = LzCharts.maxIndex(values);
    var c = hourlyChartInstance;
    c.data.labels = chart.labels;
    c.data.datasets[0].data = values;
    c.data.datasets[0].backgroundColor = LzCharts.emphasis(values, peak);
    c.options.plugins.lzValueLabels.indices = peak >= 0 ? [peak] : [];
    c.update();
    $("#hourlyCaption").text(peak >= 0
        ? "Bugün, saat saat sipariş sayısı · en yoğun saat " + chart.labels[peak] + " – " + nextHour(chart.labels[peak]) + " (" + LzCharts.count(values[peak]) + " sipariş)"
        : "Bugün, saat saat sipariş sayısı · henüz sipariş yok");
    $("#hourlyDensityChart").attr("aria-label", "Saatlik sipariş yoğunluğu: " + chart.labels.map(function (l, i) {
        return l + " " + (values[i] === null ? "henüz yok" : values[i]);
    }).join(", "));
}

function loadFinancialData() {
    // Yenilenirken grafikler kaybolmaz, soluklaşır (sayfa zıplamaz)
    $("#statTiles, .chart-card").addClass("is-refreshing");
    $.ajax({
        url: "/Admin/GetFinancialData",
        type: "GET",
        data: { period: currentPeriod },
        cache: false,
        success: function (res) {
            if (res.success && res.data) {
                var d = res.data;
                renderStatTiles(d);
                if (revenueChartInstance && d.revenueChart) renderRevenueChart(d.revenueChart);
                if (topProductsChartInstance && d.topProductsChart) renderTopProducts(d.topProductsChart);
                if (hourlyChartInstance && d.hourlyChart) renderHourly(d.hourlyChart);
            } else {
                console.error("Finansal veriler çekilemedi:", res.message);
            }
        },
        error: function (xhr) {
            console.error("Finansal Veri Çekme Hatası:", xhr);
        },
        complete: function () {
            $("#statTiles, .chart-card").removeClass("is-refreshing");
        }
    });
}
