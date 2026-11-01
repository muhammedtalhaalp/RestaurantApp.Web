using System;
using System.Collections.Generic;
using RestaurantApp.Web.Data;

namespace RestaurantApp.Web.Helpers
{
    // Masa doluluk kamerasının (tools/table-camera) bildirdiği durumlar. Yalnızca uyarı amaçlıdır;
    // siparişlere ve AppTables.Status'a dokunmaz. Kasada kroki üzerinde gösterilir.
    public static class TableCameraStatus
    {
        public const string Empty = "Bos";
        public const string Occupied = "Dolu";
        public const string NeedsClearing = "Toplanacak";   // kimse yok ama masada tabak/bardak kalmış

        public static readonly HashSet<string> All = new HashSet<string> { Empty, Occupied, NeedsClearing };

        // Kamera bu süre boyunca bildirim göndermediyse (kapalı / bağlantı yok) durum yok sayılır.
        // Kamera programı değişmeyen durumları da en geç heartbeat_seconds'ta bir yeniden gönderir.
        public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(2);

        // Güncel kamera durumu; kamera yoksa veya bilgi eskiyse null
        public static string Current(AppTables table, DateTime now)
        {
            if (string.IsNullOrEmpty(table.CameraStatus) || !table.CameraStatusDate.HasValue) return null;
            return now - table.CameraStatusDate.Value > StaleAfter ? null : table.CameraStatus;
        }
    }
}
