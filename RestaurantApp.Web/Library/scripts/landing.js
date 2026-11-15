// Tanıtım sayfası: kaydırınca koyulaşan üst menü, telefonda açılır menü, görünür olunca beliren bölümler.
(function () {
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

    var items = document.querySelectorAll(".lp-reveal");
    if (!("IntersectionObserver" in window)) {
        items.forEach(function (el) { el.classList.add("is-visible"); });
        return;
    }
    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            // Aynı sıradaki kartlar art arda belirsin
            var siblings = Array.prototype.indexOf.call(entry.target.parentNode.children, entry.target);
            entry.target.style.transitionDelay = Math.min(siblings, 6) * 60 + "ms";
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
        });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) { observer.observe(el); });
})();
