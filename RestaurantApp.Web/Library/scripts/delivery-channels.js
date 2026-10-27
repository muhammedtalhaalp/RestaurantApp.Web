// Paket servis kanalları ve ödeme planları (sunucudaki Helpers/DeliveryOptions ile aynı anahtarlar).
// POS, Paket Servis ve Mutfak ekranları aynı renk / ikon / etiketleri buradan kullanır.
// logo: platformların resmi logoları /Content/images/channels/ altına konur (bkz. oradaki BENIOKU.txt).
// Dosya yoksa veya yüklenemezse ikon gösterilmeye devam eder.
window.DeliveryChannels = {
    channels: {
        Telefon:     { label: "Telefon",        icon: "fa-phone",          color: "#4a154b", platform: false },
        GelAl:       { label: "Gel-Al",         icon: "fa-bag-shopping",   color: "#475569", platform: false },
        Yemeksepeti: { label: "Yemeksepeti",    icon: "fa-utensils",       color: "#ea004b", platform: true, logo: "/Content/images/channels/yemeksepeti.png" },
        Getir:       { label: "Getir",          icon: "fa-motorcycle",     color: "#5d3ebc", platform: true, logo: "/Content/images/channels/getir.png" },
        Trendyol:    { label: "Trendyol Yemek", icon: "fa-store",          color: "#f27a1a", platform: true, logo: "/Content/images/channels/trendyol.png" },
        Diger:       { label: "Diğer",          icon: "fa-ellipsis",       color: "#0e7490", platform: false }
    },

    // Kanalın simgesi: logo varsa logo, yoksa ikon. Logo yüklenene kadar ikon görünür; yüklenince ikon
    // kaldırılır, yüklenemezse logo kaldırılır (bozuk resim simgesi hiç görünmez).
    iconHtml: function (key, extraClass) {
        var c = this.get(key);
        var icon = `<i class="fa-solid ${c.icon} ${extraClass || ''}"></i>`;
        if (!c.logo) return icon;
        return `<img src="${c.logo}" alt="${c.label}" class="channel-logo ${extraClass || ''}" ` +
               `onload="this.classList.add('is-loaded'); if (this.nextElementSibling) this.nextElementSibling.remove();" ` +
               `onerror="this.remove();">${icon}`;
    },

    plans: {
        Online:      { label: "Ödendi (Online)", icon: "fa-circle-check" },
        KapidaNakit: { label: "Kapıda Nakit",    icon: "fa-money-bill-wave" },
        KapidaKart:  { label: "Kapıda Kart",     icon: "fa-credit-card" }
    },

    get: function (key) {
        return this.channels[key] || { label: "Paket Servis", icon: "fa-motorcycle", color: "#4a154b", platform: false };
    },

    // Gel-Al'da ödeme kapıda değil gişede alınır
    planLabel: function (planKey, channelKey) {
        var plan = this.plans[planKey];
        if (!plan) return "";
        return channelKey === "GelAl" && planKey !== "Online" ? plan.label.replace("Kapıda", "Gişede") : plan.label;
    },

    // Kanal rozeti (HTML). extraText kullanıcı girdisi olabileceği için kaçışlanır.
    badge: function (key, extraText) {
        var c = this.get(key);
        var extra = extraText ? ` <span class="opacity-75">#${$("<div>").text(extraText).html()}</span>` : "";
        return `<span class="channel-pill" style="--channel-color:${c.color}">${this.iconHtml(key)}${c.label}${extra}</span>`;
    }
};

window.formatMoney = function (value) {
    return (Number(value) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
};
