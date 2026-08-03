window.toggleForm = function (target) {
    if (target === 'register') {
        $("#sectionLogin").addClass("d-none");
        $("#sectionRegister").removeClass("d-none");
    } else {
        $("#sectionRegister").addClass("d-none");
        $("#sectionLogin").removeClass("d-none");
    }
};

$(document).ready(function () {
    console.log("Login/Register JS başarıyla yüklendi.");

    // Form Geçiş Dinleyicileri
    $(document).on("click", ".btn-switch-to-register", function () {
        window.toggleForm('register');
    });

    $(document).on("click", ".btn-switch-to-login", function () {
        window.toggleForm('login');
    });

    // Şifre Göster/Gizle Butonu Fonksiyonu
    $('.btn-toggle-pw').on('mousedown touchstart', function (e) {
        e.preventDefault();
        var targetInput = $($(this).data('target'));
        targetInput.attr('type', 'text');
        $(this).find('i').removeClass('fa-eye').addClass('fa-eye-slash');
    });

    $('.btn-toggle-pw').on('mouseup mouseleave touchend touchcancel', function () {
        var targetInput = $($(this).data('target'));
        targetInput.attr('type', 'password');
        $(this).find('i').removeClass('fa-eye-slash').addClass('fa-eye');
    });

    if (window.loginConfig && window.loginConfig.successMessage) {
        Swal.fire({
            icon: 'success',
            title: 'Tebrikler!',
            text: window.loginConfig.successMessage,
            confirmButtonColor: '#d63384'
        });
    }

    // ==========================================
    // 1. KULLANICI GİRİŞ İŞLEMİ (LOGIN)
    // ==========================================
    $("#loginForm").on("submit", function (e) {
        e.preventDefault();

        var username = $("#txtUsername").val() ? $("#txtUsername").val().trim() : "";
        var password = $("#txtPassword").val() ? $("#txtPassword").val().trim() : "";

        if (!username || !password) {
            Swal.fire("Uyarı", "Lütfen tüm alanları doldurun.", "warning");
            return;
        }

        var $btn = $("#btnLogin");
        $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i>Giriş Yapılıyor...');

        $.ajax({
            url: window.loginConfig ? window.loginConfig.loginApiUrl : "/Auth/ApiLogin",
            type: "POST",
            data: {
                Username: username,
                Password: password
            },
            success: function (response) {
                $btn.prop("disabled", false).html("Devam Et");

                if (response.success) {
                    localStorage.setItem("JWToken", response.token);
                    localStorage.setItem("Username", response.username);
                    localStorage.setItem("FullName", response.fullName);
                    localStorage.setItem("Role", response.role);

                    Swal.fire({
                        icon: "success",
                        title: "Giriş Başarılı!",
                        text: "Yönlendiriliyorsunuz...",
                        timer: 1500,
                        showConfirmButton: false
                    }).then(function () {
                        window.location.href = response.redirectUrl;
                    });
                } else {
                    Swal.fire("Hata", response.message, "error");
                }
            },
            error: function () {
                $btn.prop("disabled", false).html("Devam Et");
                Swal.fire("Hata", "Sunucu ile iletişim kurulurken bir hata oluştu.", "error");
            }
        });
    });

    // ==========================================
    // 2. YÖNETİCİ KAYIT İŞLEMİ (REGISTER)
    // ==========================================
    $("#registerForm").on("submit", function (e) {
        e.preventDefault();

        var companyName = $("#txtCompanyName").val() ? $("#txtCompanyName").val().trim() : "";
        var fullName = $("#txtFullName").val() ? $("#txtFullName").val().trim() : "";
        var email = $("#txtEmail").val() ? $("#txtEmail").val().trim() : "";
        var password = $("#txtRegisterPassword").val() ? $("#txtRegisterPassword").val().trim() : "";

        if (!companyName || !fullName || !email || !password) {
            Swal.fire("Uyarı", "Lütfen tüm alanları eksiksiz doldurun.", "warning");
            return;
        }

        var $btn = $("#btnRegister");
        $btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i>Kayıt Yapılıyor...');

        $.ajax({
            url: window.loginConfig ? window.loginConfig.registerApiUrl : "/Auth/ApiRegister",
            type: "POST",
            data: {
                CompanyName: companyName,
                FullName: fullName,
                Username: email, // ViewModel Username [Required] hatasını engellemek için
                Email: email,
                Password: password
            },
            success: function (response) {
                $btn.prop("disabled", false).html("Şirketi & Admini Kaydet");

                if (response.success) {
                    Swal.fire({
                        icon: "success",
                        title: "Kayıt Başarılı!",
                        text: response.message,
                        confirmButtonColor: "#d63384"
                    }).then(function () {
                        $('#registerForm')[0].reset();
                        window.toggleForm('login');
                    });
                } else {
                    Swal.fire("Hata", response.message, "error");
                }
            },
            error: function () {
                $btn.prop("disabled", false).html("Şirketi & Admini Kaydet");
                Swal.fire("Hata", "Kayıt oluşturulurken sunucu hatası gerçekleşti.", "error");
            }
        });
    });
});