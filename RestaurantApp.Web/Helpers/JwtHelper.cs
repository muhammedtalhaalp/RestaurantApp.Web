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
        // Kullanıcının bağlı olduğu şirket (çoklu restoran). Tüm veri sorguları bu claim ile sınırlanır.
        public const string CompanyIdClaim = "CompanyId";

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

        // Token'ın imzasını, süresini ve şirket bilgisini doğrular. Geçersizse SecurityTokenException fırlatır.
        public static ClaimsPrincipal ValidateToken(string token)
        {
            var validationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(GetSigningKey()),
                ValidateIssuer = false,
                ValidateAudience = false,
                ClockSkew = TimeSpan.Zero
            };

            SecurityToken validatedToken;
            ClaimsPrincipal principal = new JwtSecurityTokenHandler().ValidateToken(token, validationParameters, out validatedToken);

            // Şirket bilgisi olmayan (eski sürümde üretilmiş) token kabul edilmez
            int companyId;
            if (!int.TryParse(principal.FindFirst(CompanyIdClaim)?.Value, out companyId))
            {
                throw new SecurityTokenException("Token'da şirket bilgisi yok.");
            }

            return principal;
        }

        public static string GenerateToken(int userId, string username, string role, int companyId)
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = GetSigningKey();

            var tokenDescriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim(ClaimTypes.Name, username),
                    new Claim(ClaimTypes.Role, role),
                    new Claim(CompanyIdClaim, companyId.ToString())
                }),
                Expires = DateTime.UtcNow.AddHours(8), // Token 8 saat geçerli olsun
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
            };

            var token = tokenHandler.CreateToken(tokenDescriptor);
            return tokenHandler.WriteToken(token);
        }
    }
}
