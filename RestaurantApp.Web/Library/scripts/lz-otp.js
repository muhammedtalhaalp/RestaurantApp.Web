// LezzetPOS doğrulama kodu penceresi (görünüm: Library/styles/lz-otp.css). jQuery gerekmez.
//
//   var dialog = LzOtp.open(view);   dialog.setView(view);   dialog.close();
//
// view = {
//   icon: "fa-lock", title, subtitle, subtitleStrong (vurgulu kısım, ör. e-posta),
//   length: 4 | 6 | 0 (0: kod kutusu yok, ör. yalnızca e-posta sorulan adım),
//   fields: [{ name, type, placeholder, autocomplete, value }],   // kodun altındaki ek alanlar
//   validate(values) -> hata metni ya da null,
//   submitText, busyText, autoSubmit (kod tamamlanınca kendiliğinden gönder; ek alan yoksa),
//   onSubmit(code, values) -> Promise<sonuç>,
//   resend: { seconds: 60, onResend() -> Promise<{ success, message }> }
// }
// sonuç = { success:false, message, clearCode }                     → hata gösterilir
//       | { success:true, next: view }                              → sonraki adıma geçilir
//       | { success:true, successTitle, successText, continueText, onContinue(dialog) }
//                                                                    → doğrulandı animasyonu + "Devam et"
var LzOtp = (function () {
    var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function wait(ms) { return new Promise(function (r) { setTimeout(r, reduceMotion ? Math.min(ms, 120) : ms); }); }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.textContent = text;
        return e;
    }

    function swapText(node, text) {
        node.classList.remove("is-swap");
        void node.offsetWidth;                 // animasyonu yeniden başlat
        node.classList.add("is-swap");
        if (typeof text === "function") text(node); else node.textContent = text;
    }

    function open(firstView) {
        var overlay = el("div", "lz-otp-overlay");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        var card = el("div", "lz-otp-card");
        var titleId = "lzOtpTitle" + Date.now();
        overlay.appendChild(card);

        var closeBtn = el("button", "lz-otp-close");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Kapat");
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        var grabber = el("div", "lz-otp-grabber");
        var icon = el("div", "lz-otp-icon");
        var title = el("h3", "lz-otp-title");
        title.id = titleId;
        overlay.setAttribute("aria-labelledby", titleId);
        var subtitle = el("p", "lz-otp-subtitle");
        var stage = el("div", "lz-otp-stage");
        var boxesWrap = el("div", "lz-otp-boxes");
        var badge = el("div", "lz-otp-badge");
        badge.innerHTML = CHECK_SVG + '<span class="lz-otp-ring"></span>';
        stage.appendChild(boxesWrap);
        stage.appendChild(badge);
        var fieldsWrap = el("div", "lz-otp-fields");
        var msg = el("p", "lz-otp-msg");
        msg.setAttribute("role", "alert");
        var button = el("button", "lz-otp-btn");
        button.type = "button";
        var resendRow = el("p", "lz-otp-resend");

        [closeBtn, grabber, icon, title, subtitle, stage, fieldsWrap, msg, button, resendRow].forEach(function (n) { card.appendChild(n); });

        var state = { view: null, inputs: [], fields: {}, busy: false, done: false, timer: null };
        var lastFocus = document.activeElement;

        // ---------- Kod kutuları ----------
        function buildBoxes(length) {
            boxesWrap.innerHTML = "";
            boxesWrap.className = "lz-otp-boxes";
            stage.classList.remove("is-done");
            state.inputs = [];
            stage.style.display = length ? "" : "none";
            overlay.setAttribute("data-length", String(length || 0));
            for (var i = 0; i < length; i++) {
                var box = el("label", "lz-otp-box");
                box.style.setProperty("--i", i);
                var input = el("input");
                input.type = "text";
                input.inputMode = "numeric";
                input.maxLength = i === 0 ? length : 1;      // ilk kutu SMS/e-posta otomatik doldurmayı alabilsin
                input.autocomplete = i === 0 ? "one-time-code" : "off";
                input.setAttribute("aria-label", "Kodun " + (i + 1) + ". hanesi / " + length);
                box.appendChild(input);
                boxesWrap.appendChild(box);
                state.inputs.push(input);
                bindInput(input, i);
            }
            refreshActive();
        }

        function code() { return state.inputs.map(function (i) { return i.value; }).join(""); }

        function refreshActive() {
            var firstEmpty = state.inputs.findIndex(function (i) { return !i.value; });
            state.inputs.forEach(function (input, idx) {
                var box = input.parentNode;
                box.classList.toggle("is-filled", !!input.value);
                box.classList.toggle("is-active", !state.busy && !state.done && (document.activeElement === input || (firstEmpty === idx && !state.inputs.some(function (x) { return x === document.activeElement; }))));
            });
        }

        function putDigit(idx, digit, animate) {
            var input = state.inputs[idx];
            if (!input) return;
            input.value = digit;
            if (animate !== false) {
                input.classList.remove("is-pop");
                input.parentNode.classList.remove("is-tracing");
                void input.offsetWidth;
                input.classList.add("is-pop");
                input.parentNode.classList.add("is-tracing");
            }
        }

        // Yapıştırılan / otomatik doldurulan kodu kutulara sırayla, tek tek yazar (videodaki "Fill" etkisi)
        function fillSequential(digits, startIdx) {
            digits = digits.replace(/\D/g, "").slice(0, state.inputs.length - startIdx);
            if (!digits) return;
            var i = 0;
            (function next() {
                if (i >= digits.length) { afterChange(); return; }
                putDigit(startIdx + i, digits[i]);
                var target = state.inputs[Math.min(startIdx + i + 1, state.inputs.length - 1)];
                target.focus();
                i++;
                setTimeout(next, reduceMotion ? 0 : 90);
            })();
        }

        function afterChange() {
            clearError();
            refreshActive();
            if (code().length === state.inputs.length && state.inputs.length) {
                boxesWrap.classList.remove("is-shimmer");
                void boxesWrap.offsetWidth;
                boxesWrap.classList.add("is-shimmer");
                if (state.view.autoSubmit && !(state.view.fields || []).length) setTimeout(submit, reduceMotion ? 0 : 450);
            }
        }

        function bindInput(input, idx) {
            input.addEventListener("focus", function () { setTimeout(function () { input.select(); }, 0); refreshActive(); });
            input.addEventListener("blur", function () { setTimeout(refreshActive, 0); });
            input.addEventListener("input", function () {
                var v = input.value.replace(/\D/g, "");
                if (v.length > 1) { input.value = ""; fillSequential(v, idx); return; }
                input.value = v;
                if (v) {
                    putDigit(idx, v);
                    if (idx < state.inputs.length - 1) state.inputs[idx + 1].focus();
                }
                afterChange();
            });
            input.addEventListener("keydown", function (e) {
                if (e.key === "Backspace" && !input.value && idx > 0) {
                    e.preventDefault();
                    state.inputs[idx - 1].value = "";
                    state.inputs[idx - 1].focus();
                    afterChange();
                } else if (e.key === "ArrowLeft" && idx > 0) {
                    e.preventDefault(); state.inputs[idx - 1].focus();
                } else if (e.key === "ArrowRight" && idx < state.inputs.length - 1) {
                    e.preventDefault(); state.inputs[idx + 1].focus();
                } else if (e.key === "Enter") {
                    e.preventDefault(); submit();
                }
            });
            input.addEventListener("paste", function (e) {
                var text = (e.clipboardData || window.clipboardData).getData("text") || "";
                if (/\d/.test(text)) { e.preventDefault(); fillSequential(text, idx); }
            });
        }

        // ---------- Görünüm ----------
        function setView(view) {
            state.view = view;
            state.done = false;
            state.busy = false;
            clearInterval(state.timer);
            card.classList.remove("is-success");
            icon.innerHTML = '<i class="fa-solid ' + (view.icon || "fa-shield-halved") + '"></i>';
            swapText(title, view.title || "");
            swapText(subtitle, function (node) {
                node.textContent = view.subtitle || "";
                if (view.subtitleStrong) {
                    node.appendChild(document.createTextNode(" "));
                    node.appendChild(el("b", null, view.subtitleStrong));
                }
            });
            buildBoxes(view.length || 0);

            fieldsWrap.innerHTML = "";
            state.fields = {};
            (view.fields || []).forEach(function (f) {
                var input = el("input", "lz-otp-field");
                input.type = f.type || "text";
                input.placeholder = f.placeholder || "";
                input.autocomplete = f.autocomplete || "off";
                input.value = f.value || "";
                input.setAttribute("aria-label", f.placeholder || f.name);
                input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
                input.addEventListener("input", clearError);
                fieldsWrap.appendChild(input);
                state.fields[f.name] = input;
            });
            fieldsWrap.style.display = (view.fields || []).length ? "" : "none";

            clearError();
            button.className = "lz-otp-btn";
            button.disabled = false;
            button.textContent = view.submitText || "Doğrula";
            button.onclick = submit;
            setupResend(view.resend);

            setTimeout(function () {
                var first = state.inputs[0] || fieldsWrap.querySelector("input");
                if (first) first.focus();
            }, 60);
        }

        function setupResend(resend) {
            resendRow.innerHTML = "";
            resendRow.style.display = resend ? "" : "none";
            if (!resend) return;
            resendRow.appendChild(document.createTextNode("Kod gelmedi mi? "));
            var btn = el("button");
            btn.type = "button";
            resendRow.appendChild(btn);
            var seconds = resend.seconds || 60;

            function tick() {
                btn.disabled = seconds > 0;
                btn.textContent = seconds > 0 ? "Yeniden gönder (" + seconds + " sn)" : "Yeniden gönder";
                if (seconds <= 0) clearInterval(state.timer);
                seconds--;
            }
            clearInterval(state.timer);
            tick();
            state.timer = setInterval(tick, 1000);

            btn.onclick = function () {
                if (btn.disabled) return;
                btn.disabled = true;
                btn.textContent = "Gönderiliyor…";
                Promise.resolve(resend.onResend()).then(function (r) {
                    showMessage(r && r.message ? r.message : "", !(r && r.success) ? "error" : "info");
                    if (r && r.success) {
                        state.inputs.forEach(function (i) { i.value = ""; });
                        refreshActive();
                        if (state.inputs[0]) state.inputs[0].focus();
                        setupResend(resend);
                    } else {
                        btn.disabled = false;
                        btn.textContent = "Yeniden gönder";
                    }
                }, function () {
                    showMessage("Sunucuya bağlanırken bir sorun oluştu.", "error");
                    btn.disabled = false;
                    btn.textContent = "Yeniden gönder";
                });
            };
        }

        function showMessage(text, kind) {
            msg.textContent = text || "";
            msg.classList.toggle("is-info", kind === "info");
        }

        function clearError() {
            if (msg.classList.contains("is-info")) return;
            msg.textContent = "";
            boxesWrap.classList.remove("is-error");
        }

        function fail(message, clearCode) {
            showMessage(message || "İşlem tamamlanamadı.", "error");
            boxesWrap.classList.remove("is-error", "is-busy", "is-shimmer");
            void boxesWrap.offsetWidth;
            if (state.inputs.length && clearCode !== false) {
                boxesWrap.classList.add("is-error");
                setTimeout(function () {
                    state.inputs.forEach(function (i) { i.value = ""; });
                    boxesWrap.classList.remove("is-error");
                    refreshActive();
                    state.inputs[0].focus();
                }, 450);
            }
        }

        function values() {
            var out = {};
            Object.keys(state.fields).forEach(function (k) { out[k] = state.fields[k].value; });
            return out;
        }

        // ---------- Gönderme ----------
        function submit() {
            if (state.busy || state.done) return;
            var view = state.view, c = code(), v = values();
            if (state.inputs.length && c.length < state.inputs.length) {
                fail(state.inputs.length + " haneli kodu eksiksiz girin.", false);
                var empty = state.inputs.find(function (i) { return !i.value; });
                if (empty) empty.focus();
                return;
            }
            var problem = view.validate ? view.validate(v) : null;
            if (problem) { fail(problem, false); return; }

            state.busy = true;
            showMessage("");
            button.disabled = true;
            button.textContent = view.busyText || "Doğrulanıyor…";
            boxesWrap.classList.add("is-busy");
            refreshActive();

            Promise.resolve(view.onSubmit(c, v)).then(function (r) {
                state.busy = false;
                boxesWrap.classList.remove("is-busy");
                button.disabled = false;
                button.textContent = view.submitText || "Doğrula";
                if (!r || !r.success) { fail(r && r.message, r ? r.clearCode : true); return; }
                if (r.next) { setView(r.next); return; }
                playSuccess(r);
            }, function () {
                state.busy = false;
                boxesWrap.classList.remove("is-busy");
                button.disabled = false;
                button.textContent = view.submitText || "Doğrula";
                fail("Sunucuya bağlanırken bir sorun oluştu.", false);
            });
        }

        // Doğrulandı: turkuaz ışık, başlık değişir, kutular merkezde birleşip onay rozetine dönüşür, "Devam et" belirir
        function playSuccess(r) {
            state.done = true;
            clearInterval(state.timer);
            resendRow.style.display = "none";
            fieldsWrap.style.display = "none";
            showMessage("");
            button.style.visibility = "hidden";
            card.classList.add("is-success");
            swapText(title, r.successTitle || "Doğrulandı");
            swapText(subtitle, r.successText || "");
            refreshActive();

            var hasBoxes = state.inputs.length > 0;
            if (!hasBoxes) {
                stage.style.display = "";
                boxesWrap.style.display = "none";
                stage.style.height = "84px";
            }
            var center = stage.getBoundingClientRect();
            var cx = center.left + center.width / 2;
            state.inputs.forEach(function (input) {
                var b = input.parentNode.getBoundingClientRect();
                input.parentNode.style.setProperty("--dx", (cx - (b.left + b.width / 2)) + "px");
            });

            (hasBoxes ? wait(60) : Promise.resolve())
                .then(function () { if (hasBoxes) boxesWrap.classList.add("is-merging"); return wait(hasBoxes ? 470 : 0); })
                .then(function () { boxesWrap.classList.add("is-merged"); stage.classList.add("is-done"); return wait(750); })
                .then(function () {
                    button.style.visibility = "";
                    button.className = "lz-otp-btn is-success";
                    button.textContent = r.continueText || "Devam et";
                    button.onclick = function () {
                        if (r.onContinue) r.onContinue(dialog); else dialog.close();
                    };
                    button.focus();
                });
        }

        // ---------- Açma / kapatma ----------
        function close() {
            clearInterval(state.timer);
            document.removeEventListener("keydown", onKey, true);
            overlay.classList.add("is-closing");
            setTimeout(function () {
                overlay.remove();
                document.body.classList.remove("lz-otp-open");
                if (lastFocus && lastFocus.focus) lastFocus.focus();
            }, reduceMotion ? 0 : 170);
        }

        function onKey(e) {
            if (e.key === "Escape" && !state.busy) { e.preventDefault(); close(); }
            if (e.key === "Tab") {                    // odak pencerenin içinde kalsın
                var items = Array.prototype.filter.call(card.querySelectorAll("button, input"), function (n) {
                    return !n.disabled && n.offsetParent !== null && getComputedStyle(n).visibility !== "hidden";
                });
                if (!items.length) return;
                var first = items[0], last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }

        closeBtn.onclick = function () { if (!state.busy) close(); };
        document.addEventListener("keydown", onKey, true);
        document.body.appendChild(overlay);
        document.body.classList.add("lz-otp-open");

        var dialog = { setView: setView, close: close, element: overlay };
        setView(firstView);
        return dialog;
    }

    // Form gönderimi (MVC actions form-encoded bekler); { success, message } döner, ağ hatasında da.
    // Kimlik oturum çerezinden (Session) gelir; doğrulama kodu da Session'da tutulduğu için çerez şarttır.
    function post(url, data) {
        var body = new URLSearchParams();
        Object.keys(data || {}).forEach(function (k) { body.append(k, data[k] === undefined || data[k] === null ? "" : data[k]); });
        var headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" };
        return fetch(url, { method: "POST", headers: headers, body: body.toString(), credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .catch(function () { return { success: false, message: "Sunucuya bağlanırken bir sorun oluştu." }; });
    }

    return { open: open, post: post };
})();
