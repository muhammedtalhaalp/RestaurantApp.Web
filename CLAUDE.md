# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Restaurant management web app (POS, kitchen display, table/floor plan, QR menu, admin reports). It runs on classic **ASP.NET MVC 5 on .NET Framework 4.7.2**, not ASP.NET Core. It uses Entity Framework 6 (database-first EDMX), SignalR 2 (OWIN) and jQuery/Bootstrap 5. UI text, comments, role names and status values are in **Turkish**.

The real project lives in `RestaurantApp.Web/`. The `Startup.cs` at the repo root is a stray empty class and is not part of the build.

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
- `Data/Model1.edmx` is the source of truth. `Model1.Context.cs`, `Model1.cs` and the entity classes (`AppUsers`, `AppOrders`, `AppOrderDetails`, `AppProducts`, `AppCategories`, `AppTables`, `Companies`, `HygieneViolations`) are **T4-generated**. Don't hand-edit them: change the DB, then use "Update Model from Database" in the EDMX designer.
- Controllers create the context directly (`private RestaurantAppDBEntities db = new RestaurantAppDBEntities();`). There is no repository or service layer, and the business logic lives in the controller actions.
- **Multi-tenant by `CompanyId`.** `AppUsers`, `AppProducts`, `AppCategories`, `AppTables` and `AppOrders` all carry a `CompanyId`.
  - The current company comes **only** from the JWT `CompanyId` claim (`JwtHelper.CompanyIdClaim`). Never read it from a request parameter, and never fall back to "first admin" or `1`.
  - Controllers for logged-in users inherit `Controllers/TenantController`, which provides `CurrentCompanyId` and `CurrentUserId`.
  - Every query against those tables must filter by company. When looking a record up by id, include the company in the same lookup (e.g. `p.ProductId == id && p.CompanyId == CurrentCompanyId`), so another restaurant's ids come back as "not found".
  - `AppOrderDetails` has no `CompanyId`. Reach it through a company-checked order.
  - The public QR menu (`MenuController`) finds the company from `?tableId=` or `?companyId=` in the URL.
- Status values are Turkish string literals compared directly in code:
  - Order statuses: `Hazırlanıyor`, `Hazır`, `Servis Edildi`, `Teslim Edildi`, `Tamamlandı`, `İptal`.
  - Table statuses: `Bos`, `Dolu`.
  - Keep these spellings exactly.
- Non-obvious column semantics. Read these before touching orders or payments:
  - **`AppOrderDetails.ReturnReason` doubles as the per-item kitchen status.** `null` means it is being prepared. `"Hazır"` means ready. `"Servis Edildi"` means served. Only when `IsReturned = true` does it hold an actual return reason. Kitchen, waiter and report queries all filter on these values.
  - **`AppOrders.TotalAmount` is the remaining unpaid balance, not the order total.** Amounts actually collected are in `CashAmount`, `CreditCardAmount` and `MealCardAmount`. Use `Helpers/OrderAmounts.Value(order)` (paid + remaining) for revenue and reports.
    - Always update `TotalAmount` **incrementally**: add the value of added items, and subtract returns, deletions and payments (`TableController.ApplyPayment`).
    - Never recompute it from `AppOrderDetails`. Doing so silently wipes out payments already taken, and older orders also have detail rows that were deleted by the previous item-payment code.
  - `AppOrderDetails.PaidQuantity` records how many units of a line have been paid by item-based payment. Paid lines are no longer deleted. A line with `PaidQuantity > 0` cannot be returned or reduced.
  - `AppOrderDetails.CreatedDate` is when the item was added. The kitchen waiting time is measured from it. `AppOrders.CreatedDate` is when the order was first opened and must not be reset when items are appended.
  - `CreateOrder` takes unit prices from the database (`AppProducts.Price`). It ignores any price sent by the client.
  - **Recipes are stored as JSON inside `AppProducts.Description`**, as `{hasRecipe, productDesc, cookTime, station, ingredients, instructions, chefTip}`; see `KitchenController.SaveRecipe`. Any code that shows a product description must handle both plain text and this JSON.
  - A table is meant to have one open order. "Open" means status is not `Tamamlandı` and not `İptal`, and `CreateOrder` appends items to the oldest open order. Existing data does contain tables with several open orders, so table-level code must sum and loop over all of them rather than taking `FirstOrDefault`.
- Schema changes are hand-written, idempotent SQL scripts in `Database/` (numbered, e.g. `001_...sql`), run against `.\SQLEXPRESS` with `sqlcmd -S .\SQLEXPRESS -E -i <file>`. After each script, update the EDMX by hand: SSDL, CSDL and mapping must all change together, along with the matching generated entity class. Alternatively, run "Update Model from Database" in Visual Studio.

### Auth
- Custom JWT, not ASP.NET Identity. `AuthController.ApiLogin` issues the token with `Helpers/JwtHelper` and stores `JWToken`, `UserId`, `UserRole` and `FullName` in **Session**. The client also keeps the token in `localStorage`, and every page JS sends it through `$.ajaxSetup`.
- `Filters/JwtAuthorizeAttribute` reads the token from Session, or from an `Authorization: Bearer` header, validates it with `JwtHelper.ValidateToken` (signature, expiry, and presence of the `CompanyId` claim) and checks `Roles`. It redirects to `Auth/Login` or to `Error/AccessDenied`. Leaving `Roles` empty means any logged-in user. On success it sets `HttpContext.User`. To find the current user, read the `ClaimTypes.NameIdentifier` claim (see `AuthController.GetCurrentUser`), and never fall back to "the first active user".
- Passwords are stored with `Helpers/PasswordHasher` (PBKDF2-SHA256, format `PBKDF2$iter$salt$hash`). Legacy plaintext passwords are still accepted and are re-hashed on the next successful login. Always use `PasswordHasher.Hash` and `Verify`, and never compare `PasswordHash` in a LINQ query.
- Roles (exact strings): `Admin`, `Garson`, `Kasiyer`, `Garson/Kasiyer`, `Mutfak Şefi`, `Mutfak`. Access is applied per controller and per action with `[JwtAuthorize(Roles = "...")]`. `_Layout.cshtml` builds the navigation from `Session["UserRole"]`.
- Public endpoints: `MenuController` (QR menu for customers), `AiVisionController`, and the `[AllowAnonymous]` actions on `OrderController`.

### Real-time (SignalR)
- `Startup.cs` (OWIN) calls `app.MapSignalR()`. `Hubs/OrderHub` (`orderHub`) sends `onNewOrderCreated`, `onOrderReady`, `onOrderDelivered` and `receiveHygieneAlert`.
- **Notifications are per company.** On connect, the hub validates the JWT passed as `access_token` in the query string and adds the connection to the group `OrderHub.CompanyGroup(companyId)`. Client JS must set `$.connection.hub.qs = { access_token: localStorage.getItem("JWToken") }` before `hub.start()`. Send to `Clients.Group(...)`, never `Clients.All`.
- Server code pushes through `GlobalHost.ConnectionManager.GetHubContext<OrderHub>()` (for example in `OrderController`). Client JS also calls hub methods directly, for example `kitchen.js` calls `sendOrderReadyNotification`.
- A page that needs SignalR includes `~/Scripts/jquery.signalR-2.4.3.min.js` and `~/signalr/hubs` in its `scripts` section.

### Front-end
- Each page is a Razor view plus its own JS/CSS pair: `Library/scripts/<page>.js` and `Library/styles/<page>.css`. The views load these through `@section styles` / `@section scripts` with a `?v=@DateTime.Now.Ticks` cache-buster, not through `BundleConfig`.
- The page JS talks to controller actions returning `JsonResult` through `$.ajax` with hard-coded URLs (for example `/Kitchen/GetActiveOrders`). Responses are usually `{ success, message, data }`-style objects.
- The project uses the old-style `.csproj`, so new files (views, JS, CSS, C#) must be added to `RestaurantApp.Web.csproj` as `Content`/`Compile` items, or they won't deploy or compile.

### Helpers
- `CacheHelper` is a `MemoryCache` wrapper. Cached keys such as `Company_Products_{companyId}` and `AllCategories` must be invalidated with `CacheHelper.Remove(...)` after any write to products or categories. Existing write actions already do this.
- `EmailHelper` sends mail over Gmail SMTP (OTP codes for password reset and profile changes; the OTP is held in Session).
- Uploaded product images are saved to `Content/images/products/` with GUID file names.
