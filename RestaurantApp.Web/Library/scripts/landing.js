// Tanıtım sayfası: kaydırınca koyulaşan üst menü, telefonda açılır menü, görünür olunca beliren bölümler
// ve görsel efektler (başlıkta değişen kelime, canlı uygulama görseli, eğilen görsel, rakam bandı,
// kart ışığı, canlı kamera kutusu, dolan adım çizgisi).
// "Hareketi azalt" tercihinde efektler çalışmaz; sayfa durağan hâliyle kalır.
(function () {
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    var hasIO = "IntersectionObserver" in window;

    // ---------- Üst menü ----------
    var nav = document.getElementById("lpNav");
    var links = document.getElementById("lpLinks");
    var menuBtn = document.getElementById("lpMenuBtn");

    function onScroll() { nav.classList.toggle("is-scrolled", window.scrollY > 8); }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (menuBtn) {
        menuBtn.addEventListener("click", function () {
            var open = links.classList.toggle("is-open");
            menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
            menuBtn.innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
        });
        links.addEventListener("click", function (e) {
            if (e.target.closest("a")) {
                links.classList.remove("is-open");
                menuBtn.setAttribute("aria-expanded", "false");
                menuBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
            }
        });
    }

    // ---------- Görünür olunca beliren içerik ----------
    var items = document.querySelectorAll(".lp-reveal");
    if (!hasIO) {
        items.forEach(function (el) { el.classList.add("is-visible"); });
    } else {
        var revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                // Aynı sıradaki kartlar art arda belirsin
                var index = Array.prototype.indexOf.call(el.parentNode.children, el);
                el.style.transitionDelay = Math.min(index, 7) * 70 + "ms";
                el.classList.add("is-visible");
                // Gecikme yalnızca belirirken; sonra kartın üzerine gelince oluşan geçişleri geciktirmesin
                setTimeout(function () { el.style.transitionDelay = ""; }, 1200);
                revealObserver.unobserve(el);
            });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
        items.forEach(function (el) { revealObserver.observe(el); });
    }

    var steps = document.getElementById("lpSteps");
    if (reduceMotion) {
        if (steps) steps.classList.add("no-track");
        return;
    }

    // ---------- Yardımcılar ----------
    function fmt(n) { return Math.round(n).toLocaleString("tr-TR") + " ₺"; }
    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

    function restartAnim(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;   // animasyon baştan başlasın
        el.classList.add(cls);
    }

    // Bir öğe ekrandayken ve sekme açıkken belli aralıklarla çalışan döngü
    function visibleLoop(el, intervalMs, tick) {
        var visible = !hasIO, timer = null;
        function start() { if (!timer && visible && !document.hidden) timer = setInterval(tick, intervalMs); }
        function stop() { clearInterval(timer); timer = null; }
        if (hasIO) {
            new IntersectionObserver(function (entries) {
                visible = entries[0].isIntersecting;
                visible ? start() : stop();
            }, { threshold: 0.15 }).observe(el);
        }
        document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
        start();
    }

    // Sayıyı yumuşakça artırır/azaltır
    function tween(from, to, ms, onStep, onDone) {
        var t0 = performance.now();
        function frame(now) {
            var k = Math.min(1, (now - t0) / ms);
            var eased = 1 - Math.pow(1 - k, 3);
            onStep(from + (to - from) * eased);
            if (k < 1) requestAnimationFrame(frame); else if (onDone) onDone();
        }
        requestAnimationFrame(frame);
    }

    // ---------- Başlıkta değişen kelime ----------
    var rotator = document.querySelector(".lp-rotator");
    if (rotator) {
        var words = rotator.children, current = 0;
        visibleLoop(rotator, 2800, function () {
            var old = words[current];
            current = (current + 1) % words.length;
            old.classList.remove("is-active");
            old.classList.add("is-leaving");
            words[current].classList.remove("is-leaving");
            words[current].classList.add("is-active");
            setTimeout(function () { old.classList.remove("is-leaving"); }, 600);
        });
    }

    // ---------- Canlı uygulama görseli ----------
    var mockTables = document.getElementById("lpMockTables");
    var ticket = document.getElementById("lpMockTicket");
    if (mockTables && ticket) {
        var rowsBox = ticket.querySelector(".rows");
        var totalEl = ticket.querySelector(".tot b");
        var payBtn = ticket.querySelector(".pay");
        var mainTable = mockTables.querySelector('[data-main="1"]');
        var otherTables = Array.prototype.filter.call(mockTables.children, function (t) { return t !== mainTable; });
        var floatKitchen = document.getElementById("lpFloatKitchen");
        var floatReady = document.getElementById("lpFloatReady");
        var floatCourier = document.getElementById("lpFloatCourier");
        var menu = [["2× Izgara Köfte", 640], ["1× Mercimek Çorbası", 120], ["2× Ayran", 90], ["1× Künefe", 395]];

        // Satırlar eklenirken görsel uzayıp sayfayı kaydırmasın: tam adisyonun yüksekliği baştan ayrılır
        rowsBox.style.minHeight = rowsBox.offsetHeight + "px";

        var step = 0, shown = 0, total = 1245, courierNo = 128;

        function setTable(t, state, text) {
            t.classList.remove("is-busy", "is-ready");
            if (state) t.classList.add(state);
            t.querySelector("small").textContent = text;
            restartAnim(t, "is-flash");
        }

        function ping(el) { if (el) restartAnim(el, "is-ping"); }

        function setTotal(to) {
            var from = total;
            total = to;
            tween(from, to, 500, function (v) { totalEl.textContent = fmt(v); });
        }

        // Ana masa (M1): adisyon satır satır dolar, ödenir, masa boşalır, yeniden başlar.
        // Bir sahne adımı her ~1,5 sn'de bir ilerler.
        function scene() {
            if (step === 0) {                      // ödeme
                payBtn.classList.add("is-press");
                totalEl.classList.add("is-paid");
                totalEl.textContent = "Ödendi ✓";
                setTimeout(function () { payBtn.classList.remove("is-press"); }, 400);
            } else if (step === 1) {               // masa boşaldı, adisyon temizlendi
                setTable(mainTable, null, "Boş");
                rowsBox.innerHTML = "";
                shown = 0;
                total = 0;
                totalEl.classList.remove("is-paid");
                totalEl.textContent = fmt(0);
            } else if (step >= 2 && step <= 5) {   // yeni sipariş, ürünler tek tek
                var item = menu[shown++];
                var row = document.createElement("div");
                row.className = "r is-new";
                row.innerHTML = "<span></span><b></b>";
                row.firstChild.textContent = item[0];
                row.lastChild.textContent = fmt(item[1]);
                rowsBox.appendChild(row);
                setTotal(total + item[1]);
                setTable(mainTable, "is-busy", fmt(total));
                if (shown === 2) {
                    floatKitchen.querySelector("small").textContent = "Masa 1 · 2 ürün";
                    ping(floatKitchen);
                }
            }
            // 6-8: bekleme (dolu adisyon bir süre görünsün)
            step = (step + 1) % 9;
        }

        // Diğer masalar ara ara dolup boşalır; hazır olan masa garsona bildirimi tetikler
        function ambient() {
            var t = pick(otherTables);
            if (t.classList.contains("is-ready")) {
                setTable(t, "is-busy", fmt(pick([215, 380, 540, 760, 925])));
            } else if (t.classList.contains("is-busy")) {
                if (Math.random() < 0.5) {
                    setTable(t, "is-ready", "Hazır");
                    floatReady.querySelector("small").textContent = t.querySelector("b").textContent + " · garsona bildirim gitti";
                    ping(floatReady);
                } else {
                    setTable(t, null, "Boş");
                }
            } else {
                setTable(t, "is-busy", fmt(pick([120, 215, 380, 460, 610])));
            }
        }

        var visual = document.getElementById("lpHeroVisual");
        visibleLoop(visual, 1500, scene);
        visibleLoop(visual, 2600, ambient);
        visibleLoop(visual, 7000, function () {
            courierNo++;
            floatCourier.querySelector("small").textContent = "Paket #" + courierNo;
            ping(floatCourier);
        });
    }

    // ---------- Fareyle eğilen görsel (yalnız fare olan geniş ekranlarda) ----------
    var mock = document.getElementById("lpMock");
    var heroVisual = document.getElementById("lpHeroVisual");
    if (mock && heroVisual && finePointer) {
        var raf = null, lastEvent = null;
        heroVisual.addEventListener("pointermove", function (e) {
            if (window.innerWidth <= 900) return;
            lastEvent = e;
            if (raf) return;
            raf = requestAnimationFrame(function () {
                raf = null;
                var r = mock.getBoundingClientRect();
                var x = (lastEvent.clientX - r.left) / r.width;    // 0..1
                var y = (lastEvent.clientY - r.top) / r.height;
                x = Math.max(0, Math.min(1, x));
                y = Math.max(0, Math.min(1, y));
                mock.classList.add("is-tilting");
                mock.style.setProperty("--ry", ((x - 0.5) * 12).toFixed(2) + "deg");
                mock.style.setProperty("--rx", ((0.5 - y) * 9).toFixed(2) + "deg");
                mock.style.setProperty("--gx", (x * 100).toFixed(1) + "%");
                mock.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
            });
        });
        heroVisual.addEventListener("pointerleave", function () {
            mock.classList.remove("is-tilting");
            mock.style.setProperty("--ry", "0deg");
            mock.style.setProperty("--rx", "0deg");
        });
    }

    // ---------- Rakam bandı: görününce sayarak artar ----------
    var counters = document.querySelectorAll(".lp-stats [data-count]");
    if (counters.length && hasIO) {
        var countObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target, target = parseInt(el.getAttribute("data-count"), 10) || 0;
                countObserver.unobserve(el);
                tween(0, target, 1300, function (v) { el.textContent = Math.round(v); });
            });
        }, { threshold: 0.6 });
        counters.forEach(function (el) { countObserver.observe(el); });
    }

    // ---------- Özellik kartlarında imleci izleyen ışık ----------
    if (finePointer) {
        document.querySelectorAll(".lp-feature").forEach(function (card) {
            card.addEventListener("pointermove", function (e) {
                var r = card.getBoundingClientRect();
                card.style.setProperty("--mx", (e.clientX - r.left) + "px");
                card.style.setProperty("--my", (e.clientY - r.top) + "px");
            });
        });
    }

    // ---------- Canlı kamera kutusu ----------
    var cam = document.getElementById("lpCam");
    if (cam) {
        var zones = cam.querySelectorAll(".lp-cam-grid .z");
        var alertBox = cam.querySelector(".lp-cam-alert");
        var alertText = alertBox.querySelector("span");
        var CAM_STATE = { B: [null, "Boş"], D: ["is-busy", "Dolu"], T: ["is-clear", "Toplanacak"] };
        // Gerçekçi bir akış: masalar dolar, kalkar, toplanır; sistemle çelişen durumda uyarı çıkar
        var camScenes = [
            { z: "DBTD", alert: "M4: müşteri oturdu, sipariş açılmadı" },
            { z: "DBBD", alert: null },
            { z: "DDBD", alert: "M2: müşteri oturdu, sipariş açılmadı" },
            { z: "TDBD", alert: "M1: masa toplanacak" },
            { z: "BDBD", alert: null },
            { z: "BDDT", alert: "M4: masa toplanacak" },
            { z: "BDDB", alert: null },
            { z: "DDDB", alert: "M1: müşteri oturdu, sipariş açılmadı" },
            { z: "DBDB", alert: null },
            { z: "DBTD", alert: "M4: müşteri oturdu, sipariş açılmadı" }
        ];
        var camIndex = 0;

        visibleLoop(cam, 2600, function () {
            camIndex = (camIndex + 1) % camScenes.length;
            var s = camScenes[camIndex];
            Array.prototype.forEach.call(zones, function (z, i) {
                var st = CAM_STATE[s.z[i]];
                var small = z.querySelector("small");
                if (small.textContent === st[1]) return;
                z.classList.remove("is-busy", "is-clear");
                if (st[0]) z.classList.add(st[0]);
                small.textContent = st[1];
                restartAnim(z, "is-detect");
            });
            // Uyarı kutusunun yeri hep ayrılı kalır; yalnızca görünürlüğü değişir (sayfa kaymaz)
            if (s.alert) {
                alertBox.classList.add("is-hidden");
                setTimeout(function () {
                    alertText.textContent = s.alert;
                    alertBox.classList.remove("is-hidden");
                }, 350);
            } else {
                alertBox.classList.add("is-hidden");
            }
        });
    }

    // ---------- Kaydırdıkça dolan adım çizgisi ----------
    if (steps) {
        var track = steps.querySelector(".lp-steps-track");
        var stepItems = Array.prototype.filter.call(steps.children, function (li) { return li !== track; });
        var badges = stepItems.map(function (li) { return li.querySelector(".n"); });

        // Çizgi ilk ve son adımın numara kutularının ortasını birleştirir (yatay ya da alt alta dizilişte)
        function layoutTrack() {
            var base = steps.getBoundingClientRect();
            var a = badges[0].getBoundingClientRect(), b = badges[badges.length - 1].getBoundingClientRect();
            var ax = a.left + a.width / 2 - base.left, ay = a.top + a.height / 2 - base.top;
            var bx = b.left + b.width / 2 - base.left, by = b.top + b.height / 2 - base.top;
            // Alt alta dizilişte (telefon) çizgi metnin üstünden geçerdi: çizilmez, numaralar yine sırayla yanar
            var vertical = Math.abs(by - ay) > Math.abs(bx - ax);
            if (!vertical) {
                track.style.cssText = "left:" + ax + "px;top:" + (ay - 1) + "px;height:2px;width:" + (bx - ax) + "px";
            }
            track.classList.toggle("is-ready", !vertical);
            updateTrack();
        }

        function updateTrack() {
            var r = steps.getBoundingClientRect(), vh = window.innerHeight;
            // Bölüm ekranın alt kısmına girince dolmaya başlar, ortasına gelince tamamlanır
            var p = (vh * 0.85 - r.top) / (vh * 0.85 - vh * 0.35 + r.height * 0.3);
            p = Math.max(0, Math.min(1, p));
            track.style.setProperty("--p", p.toFixed(3));
            stepItems.forEach(function (li, i) {
                li.classList.toggle("is-lit", p > 0 && p >= i / Math.max(1, stepItems.length - 1) - 0.001);
            });
        }

        var trackRaf = null;
        window.addEventListener("scroll", function () {
            if (trackRaf) return;
            trackRaf = requestAnimationFrame(function () { trackRaf = null; updateTrack(); });
        }, { passive: true });
        window.addEventListener("resize", layoutTrack);
        // Kartlar belirirken aşağıdan kayarak gelir; yerlerine oturunca çizgi yeniden hizalanır
        stepItems.forEach(function (li) {
            li.addEventListener("transitionend", function (e) { if (e.target === li && e.propertyName === "transform") layoutTrack(); });
        });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutTrack);
        layoutTrack();
    }
})();
