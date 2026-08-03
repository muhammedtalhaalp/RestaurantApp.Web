using System;
using System.Net;
using System.Net.Mail;

namespace RestaurantApp.Web.Helpers
{
    public static class EmailHelper
    {
        public static bool SendVerificationCode(string toEmail, string code)
        {
            try
            {
                // ⚠️ Kendi SMTP bilgilerinizi (örneğin Gmail App Password) buraya girin:
                string senderEmail = "halkaterzi4@gmail.com";
                string senderPassword = "elil lrkf brjn xhjz";

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
    }
}