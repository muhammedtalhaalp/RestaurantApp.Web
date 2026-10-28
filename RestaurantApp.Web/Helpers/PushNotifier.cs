using System;
using System.Collections.Generic;
using System.Configuration;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Hosting;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Mobil uygulamalara Firebase Cloud Messaging (HTTP v1) ile bildirim gönderir.
    //
    // - Anahtar: Firebase hizmet hesabı dosyası (gizli). Varsayılan yeri ~/App_Data/firebase/service-account.json
    //   (gitignore'da); başka yer için Secrets.config'e "FirebaseServiceAccountPath" yazılabilir.
    //   Dosya yoksa bildirimler sessizce atlanır, uygulamanın geri kalanı etkilenmez.
    // - Google'dan erişim anahtarı almak için hizmet hesabının RSA anahtarıyla imzalı bir JWT gönderilir
    //   (ek NuGet paketi gerekmez). Erişim anahtarı 1 saat geçerlidir ve önbellekte tutulur.
    // - Gönderim isteği bekletmez: arka plan işi olarak kuyruğa alınır. Geçersiz olmuş telefon kayıtları silinir.
    public static class PushNotifier
    {
        // Flutter uygulamasında aynı kimlikle oluşturulan Android bildirim kanalı (önemli, sesli)
        public const string DeliveryChannelId = "deliveries";

        private const string DefaultKeyPath = "~/App_Data/firebase/service-account.json";
        private const string MessagingScope = "https://www.googleapis.com/auth/firebase.messaging";

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        private static readonly SemaphoreSlim TokenLock = new SemaphoreSlim(1, 1);
        private static readonly object AccountLock = new object();

        private static ServiceAccount account;
        private static bool accountChecked;
        private static string accessToken;
        private static DateTime accessTokenExpiresUtc;

        private class ServiceAccount
        {
            [JsonProperty("project_id")] public string ProjectId { get; set; }
            [JsonProperty("client_email")] public string ClientEmail { get; set; }
            [JsonProperty("private_key")] public string PrivateKey { get; set; }
            [JsonProperty("token_uri")] public string TokenUri { get; set; }
        }

        private enum SendResult { Sent, InvalidToken, Failed }

        public static bool IsConfigured => LoadAccount() != null;

        // Kullanıcının kayıtlı bütün telefonlarına bildirim gönderir (istek beklemez)
        public static void NotifyUser(int userId, string title, string body, IDictionary<string, string> data = null)
        {
            if (!IsConfigured) return;

            var payloadData = data != null ? new Dictionary<string, string>(data) : new Dictionary<string, string>();
            HostingEnvironment.QueueBackgroundWorkItem(ct => SendToUserAsync(userId, title, body, payloadData));
        }

        private static async Task SendToUserAsync(int userId, string title, string body, Dictionary<string, string> data)
        {
            try
            {
                List<string> tokens;
                using (var db = new RestaurantAppDBEntities())
                {
                    tokens = db.UserDevices.Where(d => d.UserId == userId).Select(d => d.Token).ToList();
                }

                var invalid = new List<string>();
                foreach (var token in tokens)
                {
                    if (await SendAsync(token, title, body, data) == SendResult.InvalidToken)
                        invalid.Add(token);
                }

                if (invalid.Any())
                {
                    using (var db = new RestaurantAppDBEntities())
                    {
                        db.UserDevices.RemoveRange(db.UserDevices.Where(d => invalid.Contains(d.Token)));
                        db.SaveChanges();
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Trace.TraceError("Bildirim gönderilemedi: " + ex.Message);
            }
        }

        private static async Task<SendResult> SendAsync(string token, string title, string body, Dictionary<string, string> data)
        {
            // Hedef, uygulamanın FirebaseMessaging.register() ile aldığı Firebase Installation ID'dir (FID).
            // Klasik "token" hedefi kullanımdan kalktı; yeni projelerde telefon artık token alamıyor.
            var payload = new
            {
                message = new
                {
                    fid = token,
                    notification = new { title = title, body = body },
                    data = data,
                    android = new
                    {
                        priority = "high",
                        notification = new { channel_id = DeliveryChannelId, sound = "default" }
                    }
                }
            };

            var request = new HttpRequestMessage(HttpMethod.Post,
                $"https://fcm.googleapis.com/v1/projects/{account.ProjectId}/messages:send");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetAccessTokenAsync());
            request.Content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");

            using (var response = await Http.SendAsync(request))
            {
                if (response.IsSuccessStatusCode) return SendResult.Sent;

                string error = await response.Content.ReadAsStringAsync();
                // Uygulama kaldırılmış / token yenilenmiş: kayıt artık işe yaramaz
                if (response.StatusCode == HttpStatusCode.NotFound || error.Contains("UNREGISTERED"))
                    return SendResult.InvalidToken;

                System.Diagnostics.Trace.TraceWarning($"FCM {(int)response.StatusCode}: {error}");
                return SendResult.Failed;
            }
        }

        private static async Task<string> GetAccessTokenAsync()
        {
            await TokenLock.WaitAsync();
            try
            {
                if (accessToken != null && DateTime.UtcNow < accessTokenExpiresUtc.AddMinutes(-2))
                    return accessToken;

                var form = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    { "grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer" },
                    { "assertion", CreateSignedAssertion() }
                });

                using (var response = await Http.PostAsync(account.TokenUri, form))
                {
                    string text = await response.Content.ReadAsStringAsync();
                    if (!response.IsSuccessStatusCode)
                        throw new InvalidOperationException($"Firebase erişim anahtarı alınamadı ({(int)response.StatusCode}): {text}");

                    var json = JObject.Parse(text);
                    accessToken = (string)json["access_token"];
                    accessTokenExpiresUtc = DateTime.UtcNow.AddSeconds((int?)json["expires_in"] ?? 3600);
                    return accessToken;
                }
            }
            finally
            {
                TokenLock.Release();
            }
        }

        // Google OAuth "JWT bearer" isteği: hizmet hesabının anahtarıyla RS256 imzalı kısa ömürlü JWT
        private static string CreateSignedAssertion()
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            string header = Base64Url(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { alg = "RS256", typ = "JWT" })));
            string claims = Base64Url(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new
            {
                iss = account.ClientEmail,
                scope = MessagingScope,
                aud = account.TokenUri,
                iat = now,
                exp = now + 3600
            })));

            string signingInput = header + "." + claims;
            byte[] signature;

            // Hizmet hesabı anahtarı PKCS#8 PEM biçimindedir; Windows CNG bunu doğrudan içe aktarabilir
            string base64 = account.PrivateKey
                .Replace("-----BEGIN PRIVATE KEY-----", "")
                .Replace("-----END PRIVATE KEY-----", "")
                .Replace("\r", "").Replace("\n", "").Trim();

            using (var key = CngKey.Import(Convert.FromBase64String(base64), CngKeyBlobFormat.Pkcs8PrivateBlob))
            using (var rsa = new RSACng(key))
            {
                signature = rsa.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            }

            return signingInput + "." + Base64Url(signature);
        }

        private static string Base64Url(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        private static ServiceAccount LoadAccount()
        {
            lock (AccountLock)
            {
                if (accountChecked) return account;
                accountChecked = true;

                string path = ConfigurationManager.AppSettings["FirebaseServiceAccountPath"];
                if (string.IsNullOrWhiteSpace(path)) path = DefaultKeyPath;
                if (path.StartsWith("~")) path = HostingEnvironment.MapPath(path);

                if (path == null || !File.Exists(path))
                {
                    System.Diagnostics.Trace.TraceWarning("Firebase hizmet hesabı dosyası bulunamadı; mobil bildirimler kapalı.");
                    return null;
                }

                var loaded = JsonConvert.DeserializeObject<ServiceAccount>(File.ReadAllText(path));
                if (string.IsNullOrEmpty(loaded?.ProjectId) || string.IsNullOrEmpty(loaded.PrivateKey) || string.IsNullOrEmpty(loaded.ClientEmail))
                {
                    System.Diagnostics.Trace.TraceWarning("Firebase hizmet hesabı dosyası eksik; mobil bildirimler kapalı.");
                    return null;
                }

                if (string.IsNullOrEmpty(loaded.TokenUri)) loaded.TokenUri = "https://oauth2.googleapis.com/token";
                account = loaded;
                return account;
            }
        }
    }
}
