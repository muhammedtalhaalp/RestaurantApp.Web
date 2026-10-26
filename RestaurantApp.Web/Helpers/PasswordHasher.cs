using System;
using System.Security.Cryptography;
using System.Text;

namespace RestaurantApp.Web.Helpers
{
    // PBKDF2-SHA256 şifre hash'leme. Saklama formatı: PBKDF2$<iterasyon>$<salt base64>$<hash base64>
    public static class PasswordHasher
    {
        private const string Prefix = "PBKDF2";
        private const int Iterations = 100000;
        private const int SaltSize = 16;
        private const int HashSize = 32;

        public static string Hash(string password)
        {
            if (password == null) throw new ArgumentNullException(nameof(password));

            byte[] salt = new byte[SaltSize];
            using (var rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(salt);
            }

            byte[] hash = Derive(password, salt, Iterations);
            return $"{Prefix}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
        }

        // needsUpgrade: kayıt eski düz metin formatındaysa true döner, çağıran yeni hash ile güncellemelidir
        public static bool Verify(string password, string storedValue, out bool needsUpgrade)
        {
            needsUpgrade = false;
            if (password == null || string.IsNullOrEmpty(storedValue)) return false;

            string[] parts = storedValue.Split('$');
            if (parts.Length == 4 && parts[0] == Prefix)
            {
                int iterations;
                if (!int.TryParse(parts[1], out iterations)) return false;

                byte[] salt, expected;
                try
                {
                    salt = Convert.FromBase64String(parts[2]);
                    expected = Convert.FromBase64String(parts[3]);
                }
                catch (FormatException)
                {
                    return false;
                }

                byte[] actual = Derive(password, salt, iterations);
                return FixedTimeEquals(actual, expected);
            }

            // Eski kayıt: şifre düz metin saklanmış
            bool matches = FixedTimeEquals(Encoding.UTF8.GetBytes(password), Encoding.UTF8.GetBytes(storedValue));
            needsUpgrade = matches;
            return matches;
        }

        private static byte[] Derive(string password, byte[] salt, int iterations)
        {
            using (var pbkdf2 = new Rfc2898DeriveBytes(password, salt, iterations, HashAlgorithmName.SHA256))
            {
                return pbkdf2.GetBytes(HashSize);
            }
        }

        private static bool FixedTimeEquals(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;

            int diff = 0;
            for (int i = 0; i < a.Length; i++)
            {
                diff |= a[i] ^ b[i];
            }
            return diff == 0;
        }
    }
}
