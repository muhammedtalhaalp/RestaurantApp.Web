$(document).ready(function () {
    loadUserProfile();

    // 1. Profil Bilgilerini Kaydet
    $("#formProfileSettings").on("submit", function (e) {
        e.preventDefault();
        saveProfileInfo();
    });

    // 2. Şifre Değiştir: e-postaya kod gönderilir, doğrulama penceresi açılır (Library/scripts/lz-otp.js)
    $("#btnOpenOtpModal").on("click", function () {
        startPasswordChange();
    });
});

// ŞİFRE DEĞİŞTİRME: kod gönder → 4 haneli kodu doğrula (animasyon) → yeni şifre → güncellendi
function startPasswordChange() {
    var $btn = $("#btnOpenOtpModal");
    var original = $btn.html();
    $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Kod gönderiliyor...');

    LzOtp.post("/Auth/SendPasswordResetCode", {}).then(function (r) {
        $btn.prop("disabled", false).html(original);
        if (!r.success) {
            Swal.fire("Hata", r.message || "Kod gönderilemedi.", "error");
            return;
        }
        LzOtp.open(passwordCodeView());
    });
}

function passwordCodeView() {
    var email = ($("#txtEmail").val() || "").trim();
    return {
        icon: "fa-lock",
        title: "Kimlik doğrulama",
        subtitle: "4 haneli güvenlik kodunu e-postanıza gönderdik" + (email ? ":" : "."),
        subtitleStrong: email || null,
        length: 4,
        autoSubmit: true,
        submitText: "Kodu doğrula",
        onSubmit: function (code) {
            return LzOtp.post("/Auth/VerifyOtpCode", { code: code }).then(function (r) {
                if (!r.success) return r;
                return {
                    success: true,
                    successTitle: "Kod doğrulandı",
                    successText: "Şimdi yeni şifrenizi belirleyin.",
                    continueText: "Devam et",
                    onContinue: function (dialog) { dialog.setView(newPasswordView()); }
                };
            });
        },
        resend: {
            seconds: 60,
            onResend: function () { return LzOtp.post("/Auth/SendPasswordResetCode", {}); }
        }
    };
}

function newPasswordView() {
    return {
        icon: "fa-key",
        title: "Yeni şifre belirle",
        subtitle: "Doğrulama tamam. Yeni şifreniz en az 6 karakter olmalı.",
        length: 0,
        fields: [
            { name: "pass", type: "password", placeholder: "Yeni şifre", autocomplete: "new-password" },
            { name: "pass2", type: "password", placeholder: "Yeni şifre (tekrar)", autocomplete: "new-password" }
        ],
        validate: function (v) {
            if (v.pass.length < 6) return "Yeni şifre en az 6 karakter olmalı.";
            if (v.pass !== v.pass2) return "Şifreler birbirini tutmuyor.";
            return null;
        },
        submitText: "Şifreyi güncelle",
        busyText: "Güncelleniyor…",
        onSubmit: function (code, v) {
            return LzOtp.post("/Auth/ConfirmNewPassword", { newPassword: v.pass }).then(function (r) {
                if (!r.success) return r;
                return {
                    success: true,
                    successTitle: "Şifreniz güncellendi",
                    successText: "Bir sonraki girişte yeni şifrenizi kullanın.",
                    continueText: "Tamam"
                };
            });
        }
    };
}

// Kullanıcı Bilgilerini Çekme
function loadUserProfile() {
    $.ajax({
        url: "/Auth/GetUserProfile",
        type: "GET",
        success: function (response) {
            if (response.success && response.data) {
                var user = response.data;
                $("#txtFullName").val(user.fullName);
                $("#txtCompanyName").val(user.companyName);
                $("#txtEmail").val(user.email);
                $("#txtRole").val(user.role);

                $("#lblProfileName").text(user.fullName);
                $("#lblProfileRole").text(user.role + " - " + (user.companyName || "LezzetPOS"));

                // EKLENDİ: Rol bilgisini localStorage'a kaydediyoruz ki Layout doğru sidebar'ı çizebilsin
                if (user.role) {
                    localStorage.setItem("Role", user.role);
                }
            }
        }
    });
}
// Profil Ad/E-posta Güncelleme
function saveProfileInfo() {
    var fullName = $("#txtFullName").val().trim();
    var email = $("#txtEmail").val().trim();

    var $btn = $("#btnSaveProfile");
    $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Kaydediliyor...');

    $.ajax({
        url: "/Auth/UpdateUserProfile",
        type: "POST",
        data: { FullName: fullName, Email: email },
        success: function (response) {
            $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-1"></i>Değişiklikleri Kaydet');
            if (response.success) {
                Swal.fire("Başarılı", response.message, "success");
                $("#lblFullName").text(response.fullName);
                $("#lblProfileName").text(response.fullName);
                localStorage.setItem("FullName", response.fullName);
            } else {
                Swal.fire("Hata", response.message, "error");
            }
        },
        
        error: function () {
            $btn.prop("disabled", false).html('<i class="fa-solid fa-check me-1"></i>Değişiklikleri Kaydet');
            Swal.fire("Hata", "Güncelleme hatası.", "error");
        }
    });
}