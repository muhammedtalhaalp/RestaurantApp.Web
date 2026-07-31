// ==========================================
// 🔑 GLOBAL AJAX AYARI (LOCALSTORAGE'DAN JWT TOKEN GÖNDERİMİ)
// ==========================================
$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

// ==========================================
// 🗺️ HARİTA İŞLEMLERİ (Leaflet.js - API Key Gerektirmez)
// ==========================================
var map;
var marker;
// Varsayılan Merkez: İstanbul (41.0082, 28.9784)
var defaultLat = 41.0082;
var defaultLng = 28.9784;

function initMap() {
    // 1. Haritayı belirtilen koordinat ve zoom seviyesiyle başlat
    map = L.map('map').setView([defaultLat, defaultLng], 13);

    // 2. Ücretsiz OpenStreetMap katmanını ekle
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // 3. Sürüklenebilir Kırmızı Pin'i haritaya yerleştir
    marker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(map);

    // Varsayılan koordinatları hidden input'lara yaz
    updateCoordinates(defaultLat, defaultLng);

    // Etkinlik 1: Haritada herhangi bir yere tıklandığında Pin'i oraya taşı
    map.on('click', function (e) {
        var lat = e.latlng.lat;
        var lng = e.latlng.lng;
        marker.setLatLng([lat, lng]);
        updateCoordinates(lat, lng);
    });

    // Etkinlik 2: Pin sürüklendiğinde yeni konumu yakala
    marker.on('dragend', function (e) {
        var position = marker.getLatLng();
        updateCoordinates(position.lat, position.lng);
    });
}

// Hidden Input'ları Güncelleyen Yardımcı Fonksiyon
function updateCoordinates(lat, lng) {
    $("#latitude").val(lat);
    $("#longitude").val(lng);
    console.log("Seçilen Konum -> Lat: " + lat + ", Lng: " + lng);
}


// ==========================================
// 🛒 POS SAYFA ETKİLEŞİMLERİ
// ==========================================
$(document).ready(function () {
    console.log("POS JS başarıyla yüklendi.");

    // Haritayı sayfa yüklendiğinde ilklendir
    if ($('#map').length) {
        initMap();
    }

    // Sipariş Türü Değiştiğinde (Masa / Paket Servis)
    $("#orderType").on("change", function () {
        var selectedType = $(this).val();

        if (selectedType === "PaketServis") {
            $("#tableSelectGroup").slideUp();
            $("#deliveryGroup").slideDown(function () {
                // Harita gizli bir div'den çıktığı için boyutunu yeniliyoruz (Leaflet çökmesini engeller)
                if (map) {
                    setTimeout(function () {
                        map.invalidateSize();
                    }, 200);
                }
            });
        } else {
            $("#deliveryGroup").slideUp();
            $("#tableSelectGroup").slideDown();
        }
    });

    // Siparişi Onayla Butonu Etkileşimi
    $("#btn-submit-order").on("click", function () {
        var orderType = $("#orderType").val();

        if (orderType === "PaketServis") {
            var address = $("#txtDeliveryAddress").val();
            var lat = $("#latitude").val();
            var lng = $("#longitude").val();

            if (!address || address.trim() === "") {
                Swal.fire("Eksik Bilgi", "Lütfen paket servis için açık adres giriniz.", "warning");
                return;
            }

            Swal.fire({
                icon: "success",
                title: "Paket Servis Konumu Başarıyla Alındı!",
                html: `<b>Adres:</b> ${address}<br><b>Enlem (Lat):</b> ${lat}<br><b>Boylam (Lng):</b> ${lng}`
            });
        } else {
            Swal.fire("Başarılı", "Masa siparişi işleme alındı.", "success");
        }
    });
});