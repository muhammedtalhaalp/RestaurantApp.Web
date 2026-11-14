// LezzetPOS grafik teması ve yardımcıları (Chart.js 4).
// Ciro ve Grafikler ile Mutfak Performans sayfaları kullanır. Kurallar:
//  - Tek seri grafiklerde "vurgu": önemli olan (bugün, en yoğun saat) marka moru, diğerleri soluk mor.
//  - Çubuklar en fazla 24px kalın, veri ucu 4px yuvarlak, taban düz; çizgiler 2px; ızgara ince ve düz.
//  - Her noktaya sayı yazılmaz: yalnızca vurgulanan çubuğa / sıralı az sayıda çubuğun ucuna.
//  - Yazılar seri renginde değil, metin renginde. Para Türkçe biçimde: 1.234,50 ₺.
var LzCharts = (function () {
    var COLORS = {
        accent: "#7b2d7e",            // vurgulanan veri
        muted: "#c4a6c7",             // bağlam (vurgulanmayan) veri
        area: "rgba(123, 45, 126, 0.10)",
        grid: "#efeaf2",
        axis: "#6b6475",
        text: "#1d1525",
        up: "#15803d",
        down: "#c81e1e"
    };

    var moneyFmt = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var moneyRoundFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
    var shortFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
    var countFmt = new Intl.NumberFormat("tr-TR");

    function money(v) { return moneyFmt.format(Number(v) || 0) + " ₺"; }
    function moneyRound(v) { return moneyRoundFmt.format(Number(v) || 0) + " ₺"; }
    // Eksen: bir eksende tek biçim. En büyük değer 10.000'in altındaysa tam (5.000 ₺),
    // üstündeyse kısa (5 bin ₺, 1,2 Mn ₺). axisMax verilmezse değerin kendisine bakılır.
    function moneyAxis(v, axisMax) {
        var ref = Math.abs(axisMax !== undefined ? axisMax : v);
        if (v === 0) return "0 ₺";
        if (ref >= 1e6) return shortFmt.format(v / 1e6) + " Mn ₺";
        if (ref >= 1e4) return shortFmt.format(v / 1e3) + " bin ₺";
        return moneyRoundFmt.format(v) + " ₺";
    }
    function count(v) { return countFmt.format(Number(v) || 0); }

    function applyDefaults() {
        if (!window.Chart) return;
        var d = Chart.defaults;
        d.font.family = getComputedStyle(document.body).fontFamily;
        d.font.size = 12;
        d.color = COLORS.axis;
        d.borderColor = COLORS.grid;
        d.maintainAspectRatio = false;
        d.plugins.legend.display = false;
        d.animation.duration = 450;

        var t = d.plugins.tooltip;
        t.backgroundColor = COLORS.text;
        t.padding = 10;
        t.cornerRadius = 10;
        t.displayColors = false;
        t.titleFont = { weight: "700", size: 13 };
        t.bodyFont = { size: 12 };
        t.titleColor = "#ffffff";
        t.bodyColor = "rgba(255, 255, 255, 0.78)";
        t.caretSize = 5;

        d.elements.bar.borderRadius = 4;
        d.elements.bar.borderSkipped = "start";     // taban düz, veri ucu yuvarlak
        d.datasets.bar.maxBarThickness = 24;
        d.elements.line.borderWidth = 2;
        d.elements.line.borderCapStyle = "round";
        d.elements.line.borderJoinStyle = "round";
        d.elements.point.radius = 0;
        d.elements.point.hoverRadius = 5;
        d.elements.point.hoverBorderWidth = 2;
        d.elements.point.hoverBorderColor = "#ffffff";

        d.scale.grid.color = COLORS.grid;
        d.scale.grid.drawTicks = false;
        d.scale.border.display = false;
        d.scale.ticks.padding = 8;
    }

    // Vurgu: index'teki çubuk accent, diğerleri muted
    function emphasis(values, index) {
        return values.map(function (_, i) { return i === index ? COLORS.accent : COLORS.muted; });
    }

    function lastIndexWithValue(values) {
        for (var i = values.length - 1; i >= 0; i--) if (values[i] !== null && values[i] !== undefined) return i;
        return -1;
    }

    function maxIndex(values) {
        var best = -1;
        values.forEach(function (v, i) { if (v !== null && v !== undefined && (best < 0 || v > values[best])) best = i; });
        return best >= 0 && values[best] > 0 ? best : -1;
    }

    // Grafik eklentisi: yatay referans çizgisi (ör. önceki dönemlerin ortalaması). İnce, düz, soluk; sağda etiket.
    var referenceLine = {
        id: "lzReference",
        afterDatasetsDraw: function (chart, args, opts) {
            if (!opts || opts.value === null || opts.value === undefined || !isFinite(opts.value)) return;
            var y = chart.scales.y, area = chart.chartArea, ctx = chart.ctx;
            if (!y || opts.value < y.min || opts.value > y.max) return;
            var py = Math.round(y.getPixelForValue(opts.value)) + 0.5;
            ctx.save();
            ctx.strokeStyle = COLORS.axis;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(area.left, py);
            ctx.lineTo(area.right, py);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.font = "600 11px " + Chart.defaults.font.family;
            ctx.fillStyle = COLORS.axis;
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            var text = opts.label || "";
            var w = ctx.measureText(text).width;
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.fillRect(area.right - w - 6, py - 17, w + 6, 15);
            ctx.fillStyle = COLORS.axis;
            ctx.fillText(text, area.right - 3, py - 3);
            ctx.restore();
        }
    };

    // Grafik eklentisi: seçili çubukların ucuna değer yazar (metin renginde, çubuğun dışında)
    var valueLabels = {
        id: "lzValueLabels",
        afterDatasetsDraw: function (chart, args, opts) {
            if (!opts || !opts.indices || !opts.indices.length) return;
            var meta = chart.getDatasetMeta(0), data = chart.data.datasets[0].data, ctx = chart.ctx;
            var horizontal = chart.options.indexAxis === "y";
            ctx.save();
            ctx.font = "700 11.5px " + Chart.defaults.font.family;
            ctx.fillStyle = COLORS.text;
            opts.indices.forEach(function (i) {
                var bar = meta.data[i], v = data[i];
                if (!bar || v === null || v === undefined) return;
                var text = opts.format ? opts.format(v, i) : String(v);
                if (horizontal) {
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillText(text, bar.x + 6, bar.y);
                } else {
                    ctx.textAlign = "center";
                    ctx.textBaseline = "bottom";
                    ctx.fillText(text, bar.x, bar.y - 5);
                }
            });
            ctx.restore();
        }
    };

    // Özet kartı eğilim çizgisi (SVG): soluk çizgi, son nokta (bugün) vurgu renginde
    function sparkline(el, values, labels, describe) {
        var w = 120, h = 34, pad = 4;
        var nums = values.map(function (v) { return Number(v) || 0; });
        var max = Math.max.apply(null, nums), min = Math.min.apply(null, nums);
        var span = max - min || 1;
        var pts = nums.map(function (v, i) {
            var x = pad + i * (w - 2 * pad) / Math.max(nums.length - 1, 1);
            var y = h - pad - (v - min) / span * (h - 2 * pad);
            return [x, y];
        });
        var line = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
        var last = pts[pts.length - 1];
        var area = "M" + pts[0][0].toFixed(1) + "," + (h - pad) + " L" + line.replace(/ /g, " L") + " L" + last[0].toFixed(1) + "," + (h - pad) + " Z";
        var summary = (labels && labels.length ? labels[0] + " – " + labels[labels.length - 1] + ": " : "")
            + nums.map(describe || String).join(", ");
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", "Son " + nums.length + " gün (bugün devam ediyor). " + summary);
        el.setAttribute("title", "Son " + nums.length + " gün");
        el.innerHTML =
            '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
            '<path d="' + area + '" fill="' + COLORS.area + '"></path>' +
            '<polyline points="' + line + '" fill="none" stroke="' + COLORS.muted + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
            '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4" fill="' + COLORS.accent + '" stroke="#ffffff" stroke-width="2"></circle>' +
            '</svg>';
    }

    // Karşılaştırma satırı: yön oku + yüzde + hangi dönemle karşılaştırıldığı. Artış iyiyse yeşil.
    function delta(el, current, previous, periodText, goodWhenUp) {
        current = Number(current) || 0;
        previous = Number(previous) || 0;
        var $el = $(el).removeClass("is-up is-down is-flat").empty();
        if (previous === 0) {
            $el.addClass("is-flat").append($("<span>").text(current === 0 ? "Dün bu saatte de veri yoktu" : "Dün bu saatte veri yoktu"));
            return;
        }
        var pct = (current - previous) / previous * 100;
        var up = pct >= 0.05, down = pct <= -0.05;
        var good = up ? goodWhenUp !== false : (down ? goodWhenUp === false : null);
        $el.addClass(up || down ? (good ? "is-up" : "is-down") : "is-flat");
        var icon = up ? "fa-arrow-trend-up" : (down ? "fa-arrow-trend-down" : "fa-minus");
        var text = (up ? "+" : (down ? "−" : "")) + "%" + Math.abs(pct).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
        $el.append($("<i>").addClass("fa-solid " + icon), $("<b>").text(text), $("<span>").text(" " + periodText));
    }

    applyDefaults();

    return {
        COLORS: COLORS, money: money, moneyRound: moneyRound, moneyAxis: moneyAxis, count: count,
        emphasis: emphasis, lastIndexWithValue: lastIndexWithValue, maxIndex: maxIndex,
        referenceLine: referenceLine, valueLabels: valueLabels, sparkline: sparkline, delta: delta
    };
})();
