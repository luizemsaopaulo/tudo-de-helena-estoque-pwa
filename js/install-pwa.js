"use strict";
(() => {
  let deferredPrompt = null;
  const btn = document.getElementById("installPwaBtn");
  const phone = btn?.querySelector(".install-phone");
  const label = btn?.querySelector(".install-label");

  function standalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function message(text) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = text;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 3200);
    } else {
      alert(text);
    }
  }

  function markInstalled() {
    if (!btn) return;
    btn.classList.add("installed");
    btn.classList.remove("ready");
    btn.setAttribute("aria-label", "Tudo de Helena já está instalado");
    if (phone) phone.textContent = "✓";
    if (label) label.textContent = "Instalado";
  }

  function markReady() {
    if (!btn || standalone()) return markInstalled();
    btn.classList.add("ready");
    btn.classList.remove("installed");
    if (phone) phone.textContent = "📱";
    if (label) label.textContent = "Instalar app";
  }

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
    markReady();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    markInstalled();
    message("Tudo de Helena foi instalado no celular.");
  });

  btn?.addEventListener("click", async () => {
    if (standalone()) {
      markInstalled();
      return message("O Tudo de Helena já está instalado.");
    }

    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled();
      } else {
        markReady();
      }
      return;
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      message("No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.");
    } else {
      message("No Chrome: toque no menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.");
    }
  });

  if (standalone()) markInstalled();
  else markReady();
})();