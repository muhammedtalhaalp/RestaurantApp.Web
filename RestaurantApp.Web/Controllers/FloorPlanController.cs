using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Mvc;
using Newtonsoft.Json;
using RestaurantApp.Web.Data;
using RestaurantApp.Web.Filters;
using RestaurantApp.Web.Helpers;

namespace RestaurantApp.Web.Controllers
{
    // Restoran krokisi: her alan/kat (Salon, Alt Kat, Balkon...) için masalar (AppTables) ve mimari öğeler (FloorPlanElements).
    // Koordinatlar mantıksal tuvaldedir (CanvasWidth x CanvasHeight); ekranda Library/scripts/floor-plan-view.js ölçekler.
    //
    // Taslak / yayın: Admin krokiyi Kroki Yönetimi'nde çizer, her değişiklik taslak olarak anında kaydedilir.
    // "Yayınla" denince alanın o anki çizimi doğrulanıp FloorPlanSections.PublishedJson'a kopyalanır.
    // Masa seçim ekranları (POS) yalnızca GetPublishedPlan'ı kullanır; yayınlanmamış alan orada görünmez.
    // Yetki: sınıf ve metot öznitelikleri birlikte uygulanır, bu yüzden sınıfta en geniş izin, metotlarda kısıtlama vardır.
    [JwtAuthorize(Roles = "Admin, Garson, Kasiyer")]
    public class FloorPlanController : TenantController
    {
        public const int CanvasWidth = 1200;
        public const int CanvasHeight = 700;
        private const int MinSize = 10;
        private const string FloorType = "zemin";

        // floor-plan-view.js içindeki FloorPlan.TYPES ile aynı tutulmalı
        private static readonly HashSet<string> ElementTypes = new HashSet<string>
        {
            "zemin", "mutfak", "kasa", "firin", "bar", "wc", "depo", "merdiven",
            "kapi", "pencere", "duvar", "kolon", "bitki", "yazi"
        };

        private static readonly HashSet<string> TableShapes = new HashSet<string> { "Square", "Circle" };

        private RestaurantAppDBEntities db = new RestaurantAppDBEntities();

        // Yayınlanmış kopyanın biçimi
        private class Snapshot
        {
            public List<SnapshotTable> Tables { get; set; } = new List<SnapshotTable>();
            public List<SnapshotElement> Elements { get; set; } = new List<SnapshotElement>();
        }

        private class SnapshotTable
        {
            public int TableId { get; set; }
            public string Shape { get; set; }
            public int PosX { get; set; }
            public int PosY { get; set; }
            public int Width { get; set; }
            public int Height { get; set; }
        }

        private class SnapshotElement
        {
            public string Type { get; set; }
            public string Label { get; set; }
            public int PosX { get; set; }
            public int PosY { get; set; }
            public int Width { get; set; }
            public int Height { get; set; }
            public int Rotation { get; set; }
        }

        // ---------------- Kroki Yönetimi (taslak) ----------------

        [HttpGet]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult GetFloorPlan()
        {
            int companyId = CurrentCompanyId;
            var tables = ActiveTables(companyId);
            var elements = db.FloorPlanElements.Where(e => e.CompanyId == companyId).OrderBy(e => e.Id).ToList();
            var rows = db.FloorPlanSections.Where(s => s.CompanyId == companyId).OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToList();
            var occupancy = Occupancy(companyId);

            var sections = rows.Select(r => r.Section)
                .Concat(tables.Select(t => SectionName(t.Section)))
                .Concat(elements.Select(e => e.Section))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Json(new
            {
                success = true,
                data = new
                {
                    canvas = new { width = CanvasWidth, height = CanvasHeight },
                    sections = sections,
                    sectionInfo = sections.Select(name =>
                    {
                        var row = rows.FirstOrDefault(r => SameSection(r.Section, name));
                        bool published = row != null && row.IsPublished;
                        return new
                        {
                            section = name,
                            isPublished = published,
                            publishedDate = published && row.PublishedDate.HasValue ? row.PublishedDate.Value.ToString("dd.MM.yyyy HH:mm") : null,
                            hasChanges = published && HasUnpublishedChanges(row, tables)
                        };
                    }).ToList(),
                    tables = tables.Select(t => TableJson(t, SectionName(t.Section), t.Shape, t.PosX ?? 50, t.PosY ?? 50, t.Width ?? 75, t.Height ?? 75, occupancy)).ToList(),
                    elements = elements.Select(e => new
                    {
                        id = e.Id,
                        section = e.Section,
                        type = e.ElementType,
                        label = e.Label,
                        posX = e.PosX,
                        posY = e.PosY,
                        width = e.Width,
                        height = e.Height,
                        rotation = e.Rotation
                    }).ToList()
                }
            }, JsonRequestBehavior.AllowGet);
        }

        // Boş alan/kat da kalıcı olsun diye alan ayrıca kaydedilir
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult AddSection(string section)
        {
            section = CleanSection(section);
            if (section == null)
                return Json(new { success = false, message = "Alan adı 1-50 karakter olmalıdır." });

            if (db.FloorPlanSections.Any(s => s.CompanyId == CurrentCompanyId && s.Section == section))
                return Json(new { success = false, message = "Bu alan zaten var." });

            EnsureSection(section);
            db.SaveChanges();
            return Json(new { success = true });
        }

        // Yeni öğe ekler (id boş) ya da mevcut öğeyi günceller
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult SaveElement(int? id, string section, string elementType, string label, int posX, int posY, int width, int height, int rotation = 0)
        {
            section = CleanSection(section);
            if (section == null)
                return Json(new { success = false, message = "Alan adı geçersiz." });

            if (!ElementTypes.Contains(elementType ?? ""))
                return Json(new { success = false, message = "Geçersiz kroki öğesi." });

            FloorPlanElements element;
            if (id.HasValue && id.Value > 0)
            {
                element = db.FloorPlanElements.FirstOrDefault(e => e.Id == id.Value && e.CompanyId == CurrentCompanyId);
                if (element == null)
                    return Json(new { success = false, message = "Kroki öğesi bulunamadı." });
                MarkChanged(element.Section);
            }
            else
            {
                element = new FloorPlanElements { CompanyId = CurrentCompanyId, CreatedDate = DateTime.Now };
                db.FloorPlanElements.Add(element);
            }

            label = string.IsNullOrWhiteSpace(label) ? null : label.Trim();
            if (label != null && label.Length > 60) label = label.Substring(0, 60);

            element.Section = section;
            element.ElementType = elementType;
            element.Label = label;
            ApplyGeometry(posX, posY, width, height, out int x, out int y, out int w, out int h);
            element.PosX = x;
            element.PosY = y;
            element.Width = w;
            element.Height = h;
            element.Rotation = ((rotation % 360) + 360) % 360;
            MarkChanged(section);

            db.SaveChanges();
            return Json(new { success = true, id = element.Id });
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult DeleteElement(int id)
        {
            var element = db.FloorPlanElements.FirstOrDefault(e => e.Id == id && e.CompanyId == CurrentCompanyId);
            if (element == null)
                return Json(new { success = false, message = "Kroki öğesi bulunamadı." });

            MarkChanged(element.Section);
            db.FloorPlanElements.Remove(element);
            db.SaveChanges();
            return Json(new { success = true });
        }

        // Masanın krokideki yeri, boyutu, şekli ve alanı (masa adı / durumu Masa Yönetimi'nde değişir)
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult SaveTable(int tableId, string section, string shape, int posX, int posY, int width, int height)
        {
            var table = db.AppTables.FirstOrDefault(t => t.TableId == tableId && t.CompanyId == CurrentCompanyId && t.IsActive);
            if (table == null)
                return Json(new { success = false, message = "Masa bulunamadı." });

            section = CleanSection(section);
            if (section == null)
                return Json(new { success = false, message = "Alan adı geçersiz." });

            MarkChanged(SectionName(table.Section));
            MarkChanged(section);

            ApplyGeometry(posX, posY, width, height, out int x, out int y, out int w, out int h);
            table.Section = section;
            table.Shape = TableShapes.Contains(shape ?? "") ? shape : "Square";
            table.PosX = x;
            table.PosY = y;
            table.Width = w;
            table.Height = h;

            db.SaveChanges();
            return Json(new { success = true });
        }

        // Alanın o anki çizimini doğrular ve masa seçim ekranlarına açar
        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult PublishSection(string section)
        {
            section = CleanSection(section);
            if (section == null)
                return Json(new { success = false, message = "Alan adı geçersiz." });

            int companyId = CurrentCompanyId;
            var tables = ActiveTables(companyId).Where(t => SameSection(SectionName(t.Section), section)).ToList();
            var elements = db.FloorPlanElements.Where(e => e.CompanyId == companyId && e.Section == section).ToList();

            var errors = ValidateForPublish(tables, elements);
            if (errors.Any())
            {
                return Json(new
                {
                    success = false,
                    message = "Kroki yayınlanamadı. Aşağıdakileri düzeltip tekrar deneyin.",
                    errors = errors
                });
            }

            var snapshot = new Snapshot
            {
                Tables = tables.Select(t => new SnapshotTable
                {
                    TableId = t.TableId,
                    Shape = TableShapes.Contains(t.Shape ?? "") ? t.Shape : "Square",
                    PosX = t.PosX ?? 50,
                    PosY = t.PosY ?? 50,
                    Width = t.Width ?? 75,
                    Height = t.Height ?? 75
                }).ToList(),
                Elements = elements.OrderBy(e => e.Id).Select(e => new SnapshotElement
                {
                    Type = e.ElementType,
                    Label = e.Label,
                    PosX = e.PosX,
                    PosY = e.PosY,
                    Width = e.Width,
                    Height = e.Height,
                    Rotation = e.Rotation
                }).ToList()
            };

            var row = EnsureSection(section);
            DateTime now = DateTime.Now;
            row.PublishedJson = JsonConvert.SerializeObject(snapshot);
            row.IsPublished = true;
            row.PublishedDate = now;
            row.UpdatedDate = now;
            db.SaveChanges();

            return Json(new { success = true, message = $"“{section}” krokisi yayınlandı; masa seçim ekranlarında kullanılabilir.", publishedDate = now.ToString("dd.MM.yyyy HH:mm") });
        }

        [HttpPost]
        [JwtAuthorize(Roles = "Admin")]
        public JsonResult UnpublishSection(string section)
        {
            section = CleanSection(section);
            var row = section == null ? null : db.FloorPlanSections.FirstOrDefault(s => s.CompanyId == CurrentCompanyId && s.Section == section);
            if (row == null || !row.IsPublished)
                return Json(new { success = false, message = "Bu alan yayında değil." });

            row.IsPublished = false;
            row.PublishedJson = null;
            row.PublishedDate = null;
            db.SaveChanges();
            return Json(new { success = true });
        }

        // ---------------- Masa seçim ekranları (yayınlanmış kroki) ----------------

        [HttpGet]
        public JsonResult GetPublishedPlan()
        {
            int companyId = CurrentCompanyId;
            var liveTables = ActiveTables(companyId).ToDictionary(t => t.TableId);
            var occupancy = Occupancy(companyId);
            var rows = db.FloorPlanSections.Where(s => s.CompanyId == companyId).OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToList();
            var published = rows.Where(r => r.IsPublished && r.PublishedJson != null).ToList();

            var tables = new List<object>();
            var elements = new List<object>();
            foreach (var row in published)
            {
                var snapshot = JsonConvert.DeserializeObject<Snapshot>(row.PublishedJson) ?? new Snapshot();

                // Masa adı ve doluluk canlıdır; yeri yayınlanan kopyadan gelir. Silinmiş masa gösterilmez.
                foreach (var st in snapshot.Tables)
                {
                    if (!liveTables.TryGetValue(st.TableId, out var live)) continue;
                    tables.Add(TableJson(live, row.Section, st.Shape, st.PosX, st.PosY, st.Width, st.Height, occupancy));
                }

                elements.AddRange(snapshot.Elements.Select((e, i) => (object)new
                {
                    id = row.Id * 10000 + i,
                    section = row.Section,
                    type = e.Type,
                    label = e.Label,
                    posX = e.PosX,
                    posY = e.PosY,
                    width = e.Width,
                    height = e.Height,
                    rotation = e.Rotation
                }));
            }

            // Masası olan ama henüz yayınlanmamış alanlar (kasada "krokiyi tamamlayın" uyarısı için)
            var unpublished = liveTables.Values.Select(t => SectionName(t.Section))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(s => !published.Any(p => SameSection(p.Section, s)))
                .ToList();

            return Json(new
            {
                success = true,
                data = new
                {
                    canvas = new { width = CanvasWidth, height = CanvasHeight },
                    sections = published.Select(p => p.Section).ToList(),
                    unpublishedSections = unpublished,
                    tables = tables,
                    elements = elements
                }
            }, JsonRequestBehavior.AllowGet);
        }

        // ---------------- Yardımcılar ----------------

        private List<AppTables> ActiveTables(int companyId)
        {
            return db.AppTables.Where(t => t.CompanyId == companyId && t.IsActive).OrderBy(t => t.TableId).ToList();
        }

        private class TableOccupancy
        {
            public decimal Amount { get; set; }
            public bool Priority { get; set; }
        }

        // Masadaki açık siparişlerin kalan tutarı (TotalAmount kalan borçtur)
        private Dictionary<int, TableOccupancy> Occupancy(int companyId)
        {
            return db.AppOrders
                .Where(o => o.CompanyId == companyId && o.TableId != null && o.Status != "Tamamlandı" && o.Status != "İptal")
                .GroupBy(o => o.TableId.Value)
                .Select(g => new { TableId = g.Key, Amount = g.Sum(o => o.TotalAmount), Priority = g.Any(o => o.IsPriority) })
                .ToDictionary(x => x.TableId, x => new TableOccupancy { Amount = x.Amount, Priority = x.Priority });
        }

        private static object TableJson(AppTables t, string section, string shape, int x, int y, int w, int h, Dictionary<int, TableOccupancy> occupancy)
        {
            occupancy.TryGetValue(t.TableId, out var open);
            return new
            {
                tableId = t.TableId,
                tableNumber = t.TableNumber,
                section = section,
                shape = TableShapes.Contains(shape ?? "") ? shape : "Square",
                posX = x,
                posY = y,
                width = w,
                height = h,
                isOccupied = t.Status == "Dolu" || open != null,
                remainingAmount = open?.Amount ?? 0,
                isPriority = open?.Priority ?? false,
                cameraStatus = TableCameraStatus.Current(t, DateTime.Now)   // kamera yoksa null
            };
        }

        // Yayından sonra çizim değiştiyse ya da alana masa eklenip çıkarıldıysa true
        private bool HasUnpublishedChanges(FloorPlanSections row, List<AppTables> liveTables)
        {
            if (row.PublishedDate.HasValue && row.UpdatedDate > row.PublishedDate.Value) return true;

            var snapshot = JsonConvert.DeserializeObject<Snapshot>(row.PublishedJson ?? "{}") ?? new Snapshot();
            var published = new HashSet<int>(snapshot.Tables.Select(t => t.TableId));
            var current = new HashSet<int>(liveTables.Where(t => SameSection(SectionName(t.Section), row.Section)).Select(t => t.TableId));
            return !published.SetEquals(current);
        }

        private List<string> ValidateForPublish(List<AppTables> tables, List<FloorPlanElements> elements)
        {
            var errors = new List<string>();
            if (!tables.Any() && !elements.Any())
            {
                errors.Add("Bu alan boş. Önce zemini, masaları ve diğer öğeleri yerleştirin.");
                return errors;
            }

            var rects = tables.Select(t => new { t.TableNumber, R = new Rect(t.PosX ?? 50, t.PosY ?? 50, t.Width ?? 75, t.Height ?? 75) }).ToList();

            for (int i = 0; i < rects.Count; i++)
                for (int j = i + 1; j < rects.Count; j++)
                    if (rects[i].R.Intersects(rects[j].R))
                        errors.Add($"“{rects[i].TableNumber}” ile “{rects[j].TableNumber}” üst üste duruyor.");

            // Zemin çizildiyse masalar binanın içinde olmalı (L şekli gibi birden fazla zemin parçası olabilir)
            var floors = elements.Where(e => e.ElementType == FloorType).Select(e => Rect.Rotated(e.PosX, e.PosY, e.Width, e.Height, e.Rotation)).ToList();
            if (floors.Any())
            {
                foreach (var t in rects)
                {
                    bool inside = t.R.Corners().All(c => floors.Any(f => f.Contains(c.Item1, c.Item2)));
                    if (!inside) errors.Add($"“{t.TableNumber}” zeminin (binanın) dışına taşıyor.");
                }
            }

            return errors;
        }

        private struct Rect
        {
            public readonly double X, Y, W, H;
            public Rect(double x, double y, double w, double h) { X = x; Y = y; W = w; H = h; }

            // 90° / 270° döndürülmüş öğe merkezi etrafında döner: genişlik ve yükseklik yer değiştirir
            public static Rect Rotated(int x, int y, int w, int h, int rotation)
            {
                if (rotation % 180 == 0) return new Rect(x, y, w, h);
                double cx = x + w / 2.0, cy = y + h / 2.0;
                return new Rect(cx - h / 2.0, cy - w / 2.0, h, w);
            }

            public bool Intersects(Rect o) => X < o.X + o.W && o.X < X + W && Y < o.Y + o.H && o.Y < Y + H;

            public bool Contains(double px, double py) => px >= X && px <= X + W && py >= Y && py <= Y + H;

            // Köşeler 1 birim içeriden alınır: zemin kenarına tam oturan masa içeride sayılır
            public IEnumerable<Tuple<double, double>> Corners()
            {
                yield return Tuple.Create(X + 1, Y + 1);
                yield return Tuple.Create(X + W - 1, Y + 1);
                yield return Tuple.Create(X + 1, Y + H - 1);
                yield return Tuple.Create(X + W - 1, Y + H - 1);
            }
        }

        private FloorPlanSections EnsureSection(string section)
        {
            int companyId = CurrentCompanyId;
            var row = db.FloorPlanSections.Local.FirstOrDefault(s => s.CompanyId == companyId && SameSection(s.Section, section))
                      ?? db.FloorPlanSections.FirstOrDefault(s => s.CompanyId == companyId && s.Section == section);
            if (row != null) return row;

            int nextOrder = (db.FloorPlanSections.Where(s => s.CompanyId == companyId).Max(s => (int?)s.SortOrder) ?? 0) + 1;
            row = new FloorPlanSections { CompanyId = companyId, Section = section, SortOrder = nextOrder, UpdatedDate = DateTime.Now };
            db.FloorPlanSections.Add(row);
            return row;
        }

        // Taslak değişti: yayındaki alan "yayınlanmamış değişiklik var" olarak görünür
        private void MarkChanged(string section)
        {
            if (string.IsNullOrWhiteSpace(section)) return;
            EnsureSection(section).UpdatedDate = DateTime.Now;
        }

        private static bool SameSection(string a, string b)
        {
            return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        }

        private static string SectionName(string section)
        {
            return string.IsNullOrWhiteSpace(section) ? "Salon" : section.Trim();
        }

        private static string CleanSection(string section)
        {
            if (string.IsNullOrWhiteSpace(section)) return null;
            section = section.Trim();
            return section.Length > 50 ? null : section;
        }

        // Öğe tuvalin dışına taşmaz; boyutlar makul sınırlarda tutulur
        private static void ApplyGeometry(int posX, int posY, int width, int height, out int x, out int y, out int w, out int h)
        {
            w = Math.Max(MinSize, Math.Min(width, CanvasWidth));
            h = Math.Max(MinSize, Math.Min(height, CanvasHeight));
            x = Math.Max(0, Math.Min(posX, CanvasWidth - w));
            y = Math.Max(0, Math.Min(posY, CanvasHeight - h));
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) db.Dispose();
            base.Dispose(disposing);
        }
    }
}
