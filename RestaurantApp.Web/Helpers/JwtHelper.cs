using System;
using System.Configuration;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace RestaurantApp.Web.Helpers
{
    public static class JwtHelper
    {
        // Token imzalama anahtarı Secrets.config içindeki "JwtSecretKey" ayarından okunur
        internal static byte[] GetSigningKey()
        {
            string secretKey = ConfigurationManager.AppSettings["JwtSecretKey"];
            if (string.IsNullOrWhiteSpace(secretKey) || secretKey.Length < 32)
            {
                throw new ConfigurationErrorsException("JwtSecretKey ayarı bulunamadı veya 32 karakterden kısa. Secrets.config dosyasını kontrol edin (bkz. Secrets.config.example).");
            }
            return Encoding.UTF8.GetBytes(secretKey);
        }

        public static string GenerateToken(int userId, string username, string role)
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = GetSigningKey();

            var tokenDescriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim(ClaimTypes.Name, username),
                    new Claim(ClaimTypes.Role, role)
                }),
                Expires = DateTime.UtcNow.AddHours(8), // Token 8 saat geçerli olsun
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
            };

            var token = tokenHandler.CreateToken(tokenDescriptor);
            return tokenHandler.WriteToken(token);
        }
    }
}
