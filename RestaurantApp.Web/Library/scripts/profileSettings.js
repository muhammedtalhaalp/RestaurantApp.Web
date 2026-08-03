var countdownTimer = null;
var timeLeft = 60;

$(document).ready(function () {
    loadUserProfile();

    // 1. Profil Bilgilerini Kaydet
    $("#formProfileSettings").on("submit", function (e) {
        e.preventDefault();
        saveProfileInfo();
    });

    // 2. Şifre Değiştir Butonuna Basınca Kodu Gönder ve Modalı Aç
    $("#btnOpenOtpModal").on("click", function () {
        sendOtpCode();
    });

    // 3. Klavye ile Otomatik Kutucuk Geçişleri
    setupOtpInputEvents();

    // 4. Kodu Doğrula
    $("#btnVerifyOtp").on("click", function () {
        verifyOtpCode();
    });

    // 5. Yeniden Kod Gönder
    $("#btnResendOtp").on("click", function () {
        sendOtpCode();
    });

    // 6. Yeni Şifreyi Kaydet
    $("#btnSaveNewPassword").on("click", function () {
        submitNewPassword();
    });
});

// Otomatik Klavye Geçişleri (4 Kutucuk)
function setupOtpInputEvents() {
    const inputs = document.querySelectorAll('.otp-field');

    inputs.forEach((input, index) => {
        input.addEventListener('keyup', (e) => {
            const currentInput = input,
                nextInput = input.nextElementSibling,
                prevInput = input.previousElementSibling;

            if (currentInput.value.length > 0) {
                if (nextInput) {
                    nextInput.focus();
                }
            }

            if (e.key === "Backspace") {
                if (prevInput) {
                    prevInput.focus();
                }
            }
        });
    });
}

// 60 Saniyelik Sayaç
function startTimer() {
    clearInterval(countdownTimer);
    timeLeft = 60;
    $("#countdown").text(timeLeft);
    $("#timerText").removeClass("d-none");
    $("#btnResendOtp").addClass("d-none");

    countdownTimer = setInterval(function () {
        timeLeft--;
        $("#countdown").text(timeLeft);

        if (timeLeft <= 0) {
            clearInterval(countdownTimer);
            $("#timerText").addClass("d-none");
            $("#btnResendOtp").removeClass("d-none");
        }
    }, 1000);
}

// OTP Kodu Gönderme
function sendOtpCode() {
    Swal.fire({
        title: 'Kod Gönderiliyor...',
        text: 'Lütfen e-posta adresinizi kontrol edin',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    $.ajax({
        url: "/Auth/SendPasswordResetCode",
        type: "POST",
        success: function (response) {
            Swal.close();
            if (response.success) {
                // Modalı ve alanları sıfırla
                $("#otpStep1").removeClass("d-none");
                $("#otpStep2").addClass("d-none");
                $("#otpFormContent").removeClass("d-none");
                $("#otpSuccessState").addClass("d-none");
                $("#otpInputsContainer").removeClass("morph-out");
                $(".otp-field").val('');
                $("#txtNewPasswordInput").val('');

                var myModal = new bootstrap.Modal(document.getElementById('otpModal'));
                myModal.show();

                startTimer();
                setTimeout(() => { $(".otp-field").first().focus(); }, 400);
            } else {
                Swal.fire("Hata", response.message, "error");
            }
        },
        error: function () {
            Swal.close();
            Swal.fire("Hata", "E-posta gönderilirken bir sunucu hatası oluştu.", "error");
        }
    });
}

// Kodu Doğrulama ve Animasyonlu Geçiş Mantığı
function verifyOtpCode() {
    var code = "";
    $(".otp-field").each(function () {
        code += $(this).val();
    });

    if (code.length < 4) {
        Swal.fire("Uyarı", "Lütfen 4 haneli doğrulama kodunu tam giriniz.", "warning");
        return;
    }

    var $btn = $("#btnVerifyOtp");
    $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Doğrulanıyor...');

    $.ajax({
        url: "/Auth/VerifyOtpCode",
        type: "POST",
        data: { code: code },
        success: function (response) {
            $btn.prop("disabled", false).html('Kodu Doğrula');

            if (response.success) {
                // 1. Kutucukları birleştirip küçülten efekti tetikle
                $("#otpInputsContainer").addClass("morph-out");

                // 2. Kısa süre sonra form içeriğini gizle, "Kod Doğrulandı!" yeşil tik animasyonunu göster
                setTimeout(function () {
                    $("#otpFormContent").addClass("d-none");
                    $("#otpSuccessState").removeClass("d-none");
                }, 300);

                // 3. Efekti izlettikten sonra Şifre Değiştirme adımına yumuşakça geç
                setTimeout(function () {
                    $("#otpStep1").addClass("d-none");
                    $("#otpStep2").removeClass("d-none");

                    // Bir sonraki açılış için sınıfları temizle
                    $("#otpInputsContainer").removeClass("morph-out");
                    $("#otpFormContent").removeClass("d-none");
                    $("#otpSuccessState").addClass("d-none");

                    $("#txtNewPasswordInput").focus();
                }, 1600);
            } else {
                Swal.fire("Hata", response.message, "error");
            }
        },
        error: function () {
            $btn.prop("disabled", false).html('Kodu Doğrula');
            Swal.fire("Hata", "Kod doğrulanırken hata oluştu.", "error");
        }
    });
}

// Yeni Şifreyi Kaydetme
function submitNewPassword() {
    var newPassword = $("#txtNewPasswordInput").val().trim();
    if (!newPassword) {
        Swal.fire("Uyarı", "Lütfen yeni şifrenizi giriniz.", "warning");
        return;
    }

    var $btn = $("#btnSaveNewPassword");
    $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i>Güncelleniyor...');

    $.ajax({
        url: "/Auth/ConfirmNewPassword",
        type: "POST",
        data: { newPassword: newPassword },
        success: function (response) {
            $btn.prop("disabled", false).html('Şifreyi Güncelle');

            if (response.success) {
                var modalEl = document.getElementById('otpModal');
                var modal = bootstrap.Modal.getInstance(modalEl);
                modal.hide();

                Swal.fire({
                    icon: 'success',
                    title: 'Tebrikler!',
                    text: 'Şifreniz başarıyla güncellendi.',
                    timer: 2000,
                    showConfirmButton: false
                });
            } else {
                Swal.fire("Hata", response.message, "error");
            }
        },
        error: function () {
            $btn.prop("disabled", false).html('Şifreyi Güncelle');
            Swal.fire("Hata", "Şifre güncellenirken sunucu hatası oluştu.", "error");
        }
    });
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