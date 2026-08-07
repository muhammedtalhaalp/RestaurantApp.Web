// Global AJAX Ayarı (JWT Token Otomatik Eklenir)
$.ajaxSetup({
    beforeSend: function (xhr) {
        var token = localStorage.getItem("JWToken");
        if (token) {
            xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
    }
});

$(document).ready(function () {
    console.log("Garson Ana Sayfa JS Yüklendi.");

    // Giriş yapan kullanıcının adını alma (Varsa karşılama kartına yazma)
    let fullName = localStorage.getItem("FullName");
    if (fullName) {
        $(".welcome-card h4").text(`Hoş Geldiniz, ${fullName}!`);
    }
});