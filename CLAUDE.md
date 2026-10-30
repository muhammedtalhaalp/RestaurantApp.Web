# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Restaurant management web app (POS, kitchen display, table/floor plan, QR menu, admin reports). It runs on classic **ASP.NET MVC 5 on .NET Framework 4.7.2**, not ASP.NET Core. It uses Entity Framework 6 (database-first EDMX), SignalR 2 (OWIN) and jQuery/Bootstrap 5. UI text, comments, role names and status values are in **Turkish**.

The real project lives in `RestaurantApp.Web/`.

## Build & Run

- Open `RestaurantApp.Web.sln` in Visual Studio and run with IIS Express (`https://localhost:44309/`). The default route goes to `Auth/Login`.
- Command-line build (NuGet packages are restored into `packages/`):
  ```
  "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe" RestaurantApp.Web.sln /p:Configuration=Debug
  ```
- The database is SQL Server Express: `.\SQLEXPRESS`, catalog `RestaurantAppDB`, integrated security (connection string `RestaurantAppDBEntities` in `Web.config`).
- There are no test projects and no lint setup.
- Secrets (`JwtSecretKey`, `SmtpSenderEmail`, `SmtpSenderPassword`) live in `RestaurantApp.Web/Secrets.config`, which is gitignored and pulled in by `<appSettings file="Secrets.config">` in `Web.config`. Copy `Secrets.config.example` to create it. Never put secrets back into code or `Web.config`. The file is not in the `.csproj`, so it must be copied to the server by hand on deploy.

## Architecture

### Data layer (database-first)
- `Data/Model1.edmx` is the source of truth. `Model1.Context.cs`, `Model1.cs` and the entity classes (`AppUsers`, `AppOrders`, `AppOrderDetails`, `AppProducts`, `AppCategories`, `AppTables`, `Companies`, `HygieneViolations`, `ChannelSettings`, `UserDevices`) are **T4-generated**. Don't hand-edit them: change the DB, then use "Update Model from Database" in the EDMX designer.
- Controllers create the context directly (`private RestaurantAppDBEntities db = new RestaurantAppDBEntities();`). There is no repository or service layer, and the business logic lives in the controller actions.
- **Multi-tenant by `CompanyId`.** `AppUsers`, `AppProducts`, `AppCategories`, `AppTables`, `AppOrders` and `HygieneViolations` all carry a `CompanyId`.
  - The current company comes **only** from the JWT `CompanyId` claim (`JwtHelper.CompanyIdClaim`). Never read it from a request parameter, and never fall back to "first admin" or `1`.
  - Controllers for logged-in users inherit `Controllers/TenantController`, which provides `CurrentCompanyId` and `CurrentUserId`.
  - Every query against those tables must filter by company. When looking a record up by id, include the company in the same lookup (e.g. `p.ProductId == id && p.CompanyId == CurrentCompanyId`), so another restaurant's ids come back as "not found".
  - `AppOrderDetails` has no `CompanyId`. Reach it through a company-checked order.
  - The public QR menu (`MenuController`) finds the company from `?tableId=` or `?companyId=` in the URL.
- Status values are Turkish string literals compared directly in code:
  - Order statuses: `Hazırlanıyor`, `Hazır`, `Servis Edildi`, `Teslim Edildi`, `Yolda` (delivery only), `Tamamlandı`, `İptal`.
  - Table statuses: `Bos`, `Dolu`.
  - Keep these spellings exactly.
- Non-obvious column semantics. Read these before touching orders or payments:
  - **`AppOrderDetails.ReturnReason` doubles as the per-item kitchen status.** `null` means it is being prepared. `"Hazır"` means ready. `"Servis Edildi"` means served. Only when `IsReturned = true` does it hold an actual return reason. Kitchen, waiter and report queries all filter on these values.
  - **`AppOrders.TotalAmount` is the remaining unpaid balance, not the order total.** Amounts actually collected are in `CashAmount`, `CreditCardAmount`, `MealCardAmount` and, for prepaid delivery orders, `OnlineAmount`. Use `Helpers/OrderAmounts.Value(order)` (paid + remaining) for revenue and reports.
    - Always update `TotalAmount` **incrementally**: add the value of added items, and subtract returns, deletions and payments (`TableController.ApplyPayment`).
    - Never recompute it from `AppOrderDetails`. Doing so silently wipes out payments already taken, and older orders also have detail rows that were deleted by the previous item-payment code.
  - `AppOrderDetails.PaidQuantity` records how many units of a line have been paid by item-based payment. Paid lines are no longer deleted. A line with `PaidQuantity > 0` cannot be returned or reduced.
  - `AppOrderDetails.CreatedDate` is when the item was added. The kitchen waiting time is measured from it. `AppOrders.CreatedDate` is when the order was first opened and must not be reset when items are appended.
  - `CreateOrder` takes unit prices from the database (`AppProducts.Price`). It ignores any price sent by the client.
  - **Recipes are stored as JSON inside `AppProducts.Description`**, as `{hasRecipe, productDesc, cookTime, station, ingredients, instructions, chefTip}`; see `KitchenController.SaveRecipe`. Any code that shows a product description must handle both plain text and this JSON.
  - A table is meant to have one open order. "Open" means status is not `Tamamlandı` and not `İptal`, and `CreateOrder` appends items to the oldest open order. Existing data does contain tables with several open orders, so table-level code must sum and loop over all of them rather than taking `FirstOrDefault`.
- Schema changes are hand-written, idempotent SQL scripts in `Database/` (numbered, e.g. `001_...sql`), run against `.\SQLEXPRESS` with `sqlcmd -S .\SQLEXPRESS -E -I -i <file>`.
  - **Always pass `-I`** (QUOTED_IDENTIFIER ON). `AppOrders` has a filtered index (`IX_AppOrders_CourierId`), so without `-I` both its creation and any later ad-hoc `sqlcmd` UPDATE or DELETE on `AppOrders`/`AppUsers` fail. EF connections already have the setting on.
  - Make each step of a script check its own existence, so that a half-failed run can simply be re-run. After each script, update the EDMX by hand: SSDL, CSDL and mapping must all change together, along with the matching generated entity class. Alternatively, run "Update Model from Database" in Visual Studio.

### Auth
- Custom JWT, not ASP.NET Identity. `AuthController.ApiLogin` issues the token with `Helpers/JwtHelper` and stores `JWToken`, `UserId`, `UserRole` and `FullName` in **Session**. The client also keeps the token in `localStorage`, and every page JS sends it through `$.ajaxSetup`.
- `Filters/JwtAuthorizeAttribute` reads the token from Session, or from an `Authorization: Bearer` header, validates it with `JwtHelper.ValidateToken` (signature, expiry, and presence of the `CompanyId` claim) and checks `Roles`.
  - Browser requests (token in Session) are redirected to `Auth/Login` or `Error/AccessDenied`.
  - API clients (token in the `Authorization: Bearer` header, or an `X-Client-App` header, as the Flutter app and the hygiene camera send) get `401`/`403` with JSON `{ success:false, code:"unauthorized"|"forbidden", message }` instead of a redirect.
  - Leaving `Roles` empty means any logged-in user. On success it sets `HttpContext.User`. To find the current user, read the `ClaimTypes.NameIdentifier` claim (see `AuthController.GetCurrentUser`), and never fall back to "the first active user".
- Passwords are stored with `Helpers/PasswordHasher` (PBKDF2-SHA256, format `PBKDF2$iter$salt$hash`). Legacy plaintext passwords are still accepted and are re-hashed on the next successful login. Always use `PasswordHasher.Hash` and `Verify`, and never compare `PasswordHash` in a LINQ query.
- Roles (exact strings): `Admin`, `Garson`, `Kasiyer`, `Mutfak Şefi`, `Mutfak`, `Kurye`. A `Kurye` is sent to `/Courier/Index` after login. The old combined role `Garson/Kasiyer` was renamed to `Kasiyer` by `Database/007`; don't reintroduce it.
- Staff referenced by orders (`AppOrders.UserId` or `CourierId`) cannot be hard-deleted. `AdminController.DeleteStaff` sets `IsActive = false` instead, which blocks login and hides them from lists. Access is applied per controller and per action with `[JwtAuthorize(Roles = "...")]`. `_Layout.cshtml` builds the navigation from `Session["UserRole"]`.
- `JwtAuthorizeAttribute` honors `[AllowAnonymous]` on the action or the controller. The only public endpoints are `MenuController` (the QR menu for customers) and the `Auth` login actions.
- `AiVisionController` is called by the hygiene-camera program in `tools/hygiene-camera/`, not by page JS. See below.

### Real-time (SignalR)
- `Startup.cs` (OWIN) calls `app.MapSignalR()`. `Hubs/OrderHub` (`orderHub`) sends `onNewOrderCreated`, `onOrderReady`, `onOrderDelivered` and `receiveHygieneAlert`.
- **Notifications are per company.** On connect, the hub validates the JWT passed as `access_token` in the query string and adds the connection to the group `OrderHub.CompanyGroup(companyId)`. Client JS must set `$.connection.hub.qs = { access_token: getAuthToken() }` before `hub.start()`. `getAuthToken()` is defined in `_Layout.cshtml` and returns the **Session** token rendered into the page (`window.lezzetAuthToken`). Don't rely on `localStorage` alone: it was never filled by the real login page, which once broke every live notification. Send to `Clients.Group(...)`, never `Clients.All`.
- Server code pushes through `GlobalHost.ConnectionManager.GetHubContext<OrderHub>()` (for example in `OrderController`). Client JS also calls hub methods directly, for example `kitchen.js` calls `sendOrderReadyNotification`.
- A page that needs SignalR includes `~/Scripts/jquery.signalR-2.4.3.min.js` and `~/signalr/hubs` in its `scripts` section.

### Front-end
- Each page is a Razor view plus its own JS/CSS pair: `Library/scripts/<page>.js` and `Library/styles/<page>.css`. The views load these through `@section styles` / `@section scripts` with a `?v=@DateTime.Now.Ticks` cache-buster, not through `BundleConfig`.
- **New pages must use `_Layout.cshtml`** and follow the existing look: an `h4` title with a purple icon plus a muted subtitle, white rounded cards, and the brand color `#4a154b`. Users expect the same sidebar, profile menu and logout on every role's screen.
- `_Layout.cshtml` is responsive.
  - Below 992px the sidebar slides off-canvas and is opened with the top-bar `#btnMobileMenu` (the `body.sidebar-open` class, with a backdrop).
  - The desktop collapse button is hidden there.
  - The "ready orders" bell is not rendered for `Kurye`.
- `Views/Auth/Login.cshtml` has no layout. Its login and register AJAX are **inline scripts in the view**; there is no separate login JS file.
- The page JS talks to controller actions returning `JsonResult` through `$.ajax` with hard-coded URLs (for example `/Kitchen/GetActiveOrders`). Responses are usually `{ success, message, data }`-style objects.
- **The server culture is tr-TR**, where the decimal separator is a comma, while JS sends `125.5`. `Helpers/InvariantDecimalModelBinder`, registered for `decimal` and `decimal?` in `Global.asax.cs`, binds form and query values with InvariantCulture. Don't remove it, and don't parse money strings with the current culture.
- The project uses the old-style `.csproj`, so new files (views, JS, CSS, C#) must be added to `RestaurantApp.Web.csproj` as `Content`/`Compile` items, or they won't deploy or compile.
- **New `.cshtml` files must be saved as UTF-8 *with BOM*.** Without a BOM, Razor reads the file with the Windows Turkish code page, and every Turkish character in the view's own text shows up garbled (e.g. "ÅŸ" instead of "ş"). All existing views start with `EF BB BF`. Check with `head -c3 file | od -An -tx1`.

### Delivery orders (Paket Servis)
- A delivery order is an `AppOrders` row with `OrderType = "PaketServis"`.
  - `OrderChannel` is one of `Telefon`, `GelAl`, `Yemeksepeti`, `Getir`, `Trendyol`, `Diger`.
  - `DeliveryPaymentPlan` is one of `Online`, `KapidaNakit`, `KapidaKart`.
  - Keys and labels live in `Helpers/DeliveryOptions.cs` (server) and `Library/scripts/delivery-channels.js` (client). Keep the two in sync.
  - Platform logos are optional PNG files in `Content/images/channels/` (`yemeksepeti.png`, `getir.png`, `trendyol.png`). `DeliveryChannels.iconHtml` shows the logo once it loads and falls back to the Font Awesome icon if it is missing.
- Lifecycle, managed only by `DeliveryController` / the `/Delivery/Index` board:
  - `Hazırlanıyor` → kitchen marks all items ready → `Yolda` (`MarkOutForDelivery`, sets `OutForDeliveryDate`) → `Tamamlandı` (`CompleteDelivery`). `GelAl` skips `Yolda`.
  - `CancelOrder` sets `İptal` and requires a `CancelReason`.
  - The board's "ready" stage is computed from the items (`DeliveryOptions.IsKitchenReady`), not stored.
- Payment:
  - **`Online`**: `CreateOrder` moves the whole amount into **`OnlineAmount`** (platform-collected money that never enters the till) and leaves `TotalAmount = 0`.
  - **`KapidaNakit` / `KapidaKart`**: the amount stays in `TotalAmount` until `CompleteDelivery(paymentMethod: "Nakit"|"Kart")` books it to `CashAmount` / `CreditCardAmount`.
  - `OrderAmounts.Paid` includes `OnlineAmount`. Use `OrderAmounts.PaidAtRestaurant` for anything about cash in the till.
- The step rules ("out for delivery" and "complete + collect payment") live in **`Helpers/DeliveryWorkflow`**, shared by `DeliveryController` (cashier board) and `CourierController` (courier phone screen). Change the rules there, not in either controller.
- Couriers:
  - `AppOrders.CourierId` holds the assigned `Kurye` user, set on the board with `AssignCourier`. Assignment is company-checked, and `GelAl` orders cannot get a courier.
  - `CourierController` (role `Kurye`) serves `Views/Courier/Index.cshtml`, which uses the shared `_Layout`, so profile settings and logout come from the layout like every other role. A courier only sees and acts on orders where `CourierId == CurrentUserId`.
  - End-of-day courier cash: completed orders with a courier and `CourierSettledDate == null` are the cash the courier still holds. `SettleCourier(courierId, expectedCash)` stamps `CourierSettledDate`, and refuses if the amount has changed since it was shown.
- Platform commission:
  - Rates are stored per company and channel in **`ChannelSettings`** (Admin only: `GetChannelSettings` / `SaveChannelSettings`).
  - `CreateOrder` snapshots the rate into **`AppOrders.CommissionRate`**, so later rate changes don't rewrite history.
  - `DeliveryOptions.CommissionAmount(order)` = order value × that rate. `AdminController.GetChannelReport` shows gross, commission and net per channel, with dine-in orders as a "Masa" row, on the "Ciro ve Grafikler" page.
- Delivery orders are excluded from the waiter/admin "Sipariş Takip" lists (`GetPendingDeliveryOrders`), and `ApproveOrderDelivery` rejects them. Don't push them through the table/"Servis Edildi" flow.
- The POS opens the delivery modal directly with `/Order/POS?paket=1`.

### Mobile staff app (`mobile/lezzet_kurye/`, Flutter)
- One Android app, labeled "LezzetPOS", for the `Garson` and `Kurye` roles. Other roles are refused at login. It is a separate client of the same server and is not part of the .NET build.
- After login, `screens/home_for_role.dart` picks the home screen by role. The role is stored with the token; older courier-only installs default to `Kurye`.
- **Courier screens** match the web courier page: "Teslimatlarım" and the collect-payment sheet.
- **Waiter screens** live in `screens/waiter/`.
  - Masalar: section chips and table cards, from `/Order/GetTables`.
  - Table detail: items with kitchen status (`/Admin/GetActiveOrderByTableId`, which also returns each item's `orderId`), plus "servis ettim" (`/Order/ApproveOrderDelivery`).
  - Menu and cart: `/Category/GetCategories` and `/Order/GetProducts`. "Mutfağa Gönder" posts **JSON** to `/Order/CreateOrder` (`OrderType: "Masa"`), so the order reaches the kitchen exactly as from the web POS.
  - Hazır Siparişler: `/Admin/GetPendingDeliveryOrders` and `/Admin/GetOrderDetails`.
  - The waiter does **not** use the table QR. The QR stays the customer-facing web menu.
- Both roles share the profile screen: name/e-mail, password change by e-mail code, logout.
- It talks to the server through `lib/core/api_client.dart`:
  - Every request carries the JWT as `Authorization: Bearer` plus the header `X-Client-App: lezzet-kurye`, so the server answers with 401/403 JSON instead of redirects.
  - POST bodies are form-encoded, as the MVC actions expect. `postJson` is used only where the action binds nested data (`CreateOrder`).
  - It keeps the `ASP.NET_SessionId` cookie because the password-change OTP lives in Session.
  - It uses only the same endpoints as the web pages (listed above plus `/Auth/*`, `/Courier/*` and `/Device/*`). Don't add mobile-only copies of business rules; change the shared controller action or `DeliveryWorkflow` instead.
- Development connection:
  - The phone reaches Visual Studio's IIS Express over USB with `adb reverse tcp:50693 tcp:50693`; the app's default server is `http://localhost:50693`.
  - The address can be changed on the login screen.
  - Cleartext HTTP is allowed only in the debug manifest.
- Toolchain: Flutter SDK lives in `C:\src\flutter_windows_3.47.8-stable\flutter`. `flutter build apk --debug`, then `flutter install -d <device>`. `flutter analyze` must be clean.
- Channel keys, labels and colors in `lib/widgets/channel_badge.dart` mirror `delivery-channels.js`; the logos are copied into `assets/channels/`.

### Push notifications (Firebase Cloud Messaging)
- Devices are identified by their **Firebase Installation ID (FID)**, not the classic FCM token.
  - The classic `getToken()` fails on this new Firebase project with "FCM Registration failed".
  - The app calls `FirebaseMessaging.register()` and receives the FID through `onRegistered`. The Android manifest needs `firebase_messaging_installation_id_enabled=true`.
  - The server targets the message with `"fid"` instead of `"token"`.
- `UserDevices` (`Database/008`) stores the FIDs; its column is still named `Token`. `DeviceController.RegisterToken` / `UnregisterToken` manage them. An FID registered by another user moves to that user.
- `Helpers/PushNotifier` sends through FCM HTTP v1.
  - It signs the Google OAuth JWT itself with `CngKey`/`RSACng`, so no NuGet package is needed.
  - It queues the send with `HostingEnvironment.QueueBackgroundWorkItem` and deletes tokens FCM reports as unregistered.
  - If the key file is missing, pushes are silently skipped.
- **The service-account key is a secret.** It lives in `App_Data/firebase/service-account.json`, which is gitignored and must be copied to the server by hand. `FirebaseServiceAccountPath` in `Secrets.config` can override the location. Never print it or commit it. `mobile/lezzet_kurye/android/app/google-services.json` is not secret.
- `Helpers/CourierNotifications` holds the texts:
  - `Assigned` and `Unassigned`, sent from `DeliveryController.AssignCourier`.
  - `Ready`, sent from the `KitchenController` ready actions when a delivery order becomes fully ready.
  - `Cancelled`, sent from `DeliveryController.CancelOrder`.
- `Helpers/WaiterNotifications.ItemsReady` runs when the kitchen marks items of a dine-in (`Masa`) order ready. It notifies **every active `Garson` of the company** with "<masa>: sipariş hazır", like the web bell.
- Android channel ids are `deliveries` (courier) and `tables` (waiter), passed as `NotifyUser(..., channelId)`. Test a send without a phone through FCM HTTP v1 with `validate_only: true`: a fake FID returns 404 UNREGISTERED, which means the server credentials are fine.

### Hygiene camera (`tools/hygiene-camera/`)
- `hygiene_camera.py` is a standalone Python program (OpenCV + Roboflow hosted detection API). It runs on the PC the kitchen camera is attached to. It is not part of the .NET build.
- How it works:
  - It logs in through `/Auth/ApiLogin` with a `Mutfak` account and calls `/AiVision/ReportHygieneViolation` with `Authorization: Bearer <token>`, sending `violationType` and an optional `image` file (JPEG/PNG, up to 2 MB).
  - Model classes listed in `violation_classes` (e.g. `bonesiz`, `no-hairnet`) count as violations. A violation is reported only after it has been seen in M of the last N checks, and then not again until a cooldown has passed.
- Setup and the Roboflow training guide are in its `README.md`.
- The program's settings live in `config.json`, which is gitignored (it holds the password and API key). Its virtualenv `.venv/` is also gitignored.
- Violation photos are employee images. They are stored in `App_Data/hygiene/<CompanyId>/`, which is not web-accessible and is gitignored, and they are served only through `AiVisionController.GetViolationImage` after a company check. Never move them under `Content/`.
- The kitchen screen (`kitchen.js`, `receiveHygieneAlert(violationType, timeStr, imageUrl)`) shows the photo. `violationType` comes from outside the app, so it is HTML-escaped (`escapeHtml`) before being shown.
- The kitchen screen also has a "Hijyen İhlalleri" history modal: `AiVision/GetViolations?range=today|week` lists the violations and returns `unresolvedTodayCount` for the button badge, and `AiVision/MarkViolationResolved` sets `IsResolved`. Both are company-scoped. A new alert refreshes the badge.
  - `AiVision/DeleteViolations` bulk-deletes records together with their photo files. It is restricted to **Admin and Mutfak Şefi**, so kitchen staff and the camera account cannot erase their own violations. The view hides the checkboxes through `window.canDeleteHygieneViolations`.
  - The camera program sends one merged report per trigger (e.g. `"Bone takılmamış, Önlük giyilmemiş"`). When any violation passes `detections_required`, every violation seen at least `detections_to_include` times in the same window is added to that report. Per-class thresholds can be set with `roboflow.class_confidence`.
  - The recommended model is `chef-dataset/1` (classes `without_apron`, `without_cap`). The README has a benchmark on the user's own webcam photos. CCTV-trained models such as `kitchenhygiene/2` could not see aprons at close range.

### Helpers
- `CacheHelper` is a `MemoryCache` wrapper. Cached keys such as `Company_Products_{companyId}` and `AllCategories` must be invalidated with `CacheHelper.Remove(...)` after any write to products or categories. Existing write actions already do this.
- `EmailHelper` sends mail over Gmail SMTP (OTP codes for password reset and profile changes; the OTP is held in Session).
- Uploaded product images are saved to `Content/images/products/` with GUID file names.
