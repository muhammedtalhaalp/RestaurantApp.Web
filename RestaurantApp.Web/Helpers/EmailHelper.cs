using System;
using System.Net;
using System.Net.Mail;

namespace RestaurantApp.Web.Helpers
{
    public static class EmailHelper
    {
        private static readonly string senderEmail = "halkaterzi4@gmail.com";
        private static readonly string senderPassword = "elil lrkf brjn xhjz";

        // 1. Şifre Sıfırlama Doğrulama Kodu Gönderimi
        public static bool SendVerificationCode(string toEmail, string code)
        {
            try
            {
                var mail = new MailMessage();
                mail.From = new MailAddress(senderEmail, "LezzetPOS Güvenlik");
                mail.To.Add(toEmail);
                mail.Subject = "LezzetPOS - Şifre Değiştirme Doğrulama Kodu";
                mail.Body = $@"
                    <div style='font-family: Arial, sans-serif; padding: 20px; color: #333;'>
                        <h2>Şifre Değiştirme Talebi</h2>
                        <p>Hesabınızın şifresini değiştirmek için aşağıdaki 4 haneli doğrulama kodunu kullanabilirsiniz:</p>
                        <h1 style='color: #4a154b; letter-spacing: 5px;'>{code}</h1>
                        <p style='font-size: 12px; color: #777;'>Bu talebi siz yapmadıysanız lütfen bu e-postayı dikkate almayın.</p>
                    </div>";
                mail.IsBodyHtml = true;

                using (var smtp = new SmtpClient("smtp.gmail.com", 587))
                {
                    smtp.Credentials = new NetworkCredential(senderEmail, senderPassword);
                    smtp.EnableSsl = true;
                    smtp.Send(mail);
                }
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        // 2. Yeni Eklenen Personel İçin Hoş Geldin & Giriş Şifresi E-postası
        public static bool SendWelcomeEmail(string toEmail, string fullName, string tempPassword, string role)
        {
            try
            {
                var mail = new MailMessage();
                mail.From = new MailAddress(senderEmail, "LezzetPOS Ekibi");
                mail.To.Add(toEmail);
                mail.Subject = "LezzetPOS Ailesine Hoş Geldiniz! Giriş Bilgileriniz";
                mail.Body = $@"
                    <div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;'>
                        <div style='text-align: center; margin-bottom: 20px;'>
                            <h2 style='color: #4a154b; margin: 0;'>LezzetPOS</h2>
                            <p style='color: #666; font-size: 14px;'>Restoran Otomasyon & Yönetim Sistemi</p>
                        </div>
                        <hr style='border: none; border-top: 1px solid #eee; margin: 20px 0;'>
                        <p>Sayın <strong>{fullName}</strong>,</p>
                        <p>LezzetPOS sistemine <strong>{role}</strong> rolüyle kaydınız başarıyla tamamlanmıştır. Aramıza hoş geldiniz!</p>
                        <p>Sisteme giriş yapabilmeniz için geçici şifreniz otomatik olarak oluşturulmuştur:</p>
                        
                        <div style='background-color: #fce7f3; border-left: 4px solid #d63384; padding: 15px; margin: 20px 0; border-radius: 6px;'>
                            <p style='margin: 0; font-size: 13px; color: #555;'><strong>Giriş E-Posta:</strong> {toEmail}</p>
                            <p style='margin: 5px 0 0 0; font-size: 18px; color: #4a154b; font-weight: bold;'><strong>Geçici Şifreniz:</strong> {tempPassword}</p>
                        </div>

                        <p>Sisteme giriş yaptıktan sonra profil ayarlarınızdan dilediğiniz zaman şifrenizi değiştirebilirsiniz.</p>
                        <p style='margin-top: 30px; font-size: 12px; color: #888;'>İyi çalışmalar dileriz,<br><strong>LezzetPOS Yönetimi</strong></p>
                    </div>";
                mail.IsBodyHtml = true;

                using (var smtp = new SmtpClient("smtp.gmail.com", 587))
                {
                    smtp.Credentials = new NetworkCredential(senderEmail, senderPassword);
                    smtp.EnableSsl = true;
                    smtp.Send(mail);
                }
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}