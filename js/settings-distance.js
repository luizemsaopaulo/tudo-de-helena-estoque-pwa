"use strict";
(() => {
  const KEY = "TudoDeHelenaSettingsV1";
  const $ = s => document.querySelector(s);
  const digits = v => String(v || "").replace(/\D/g, "").slice(0, 8);
  const formatCep = v => {
    const d = digits(v);
    return d.length > 5 ? d.slice(0, 5) + "-" + d.slice(5) : d;
  };

  let clientCoords = null;
  let clientCepData = null;
  let baseDraftCoords = null;
  let baseDraftState = "";
  let currentDistance = null;
  let clientTimer = 0;
  let baseTimer = 0;
  let clientSeq = 0;
  let baseSeq = 0;
  let lastGeoAt = 0;

  function setStatus(selector, message = "", type = "") {
    const el = $(selector);
    if (!el) return;
    el.textContent = message;
    el.className = "cep-status" + (type ? " " + type : "");
  }

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(KEY, JSON.stringify(settings));
    return settings;
  }

  async function fetchJson(url, timeout = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function parseCoords(data) {
    const c = data?.location?.coordinates;
    const lat = Number(c?.latitude);
    const lon = Number(c?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  async function lookupCepData(raw) {
    const cep = digits(raw);
    if (cep.length !== 8) throw new Error("CEP incompleto");

    let via = null;
    let brasil = null;
    try {
      via = await fetchJson("https://viacep.com.br/ws/" + cep + "/json/");
      if (via?.erro) via = null;
    } catch {}

    try {
      brasil = await fetchJson("https://brasilapi.com.br/api/cep/v2/" + cep);
    } catch {}

    if (!via && !brasil) throw new Error("CEP não encontrado");
    return {
      cep: formatCep(cep),
      street: via?.logradouro || brasil?.street || "",
      district: via?.bairro || brasil?.neighborhood || "",
      city: via?.localidade || brasil?.city || "",
      state: via?.uf || brasil?.state || "",
      cepCoords: parseCoords(brasil),
      source: via ? "ViaCEP" : "BrasilAPI"
    };
  }

  async function geocodeAddress({ address, number, district, city, state, cep }) {
    const query = [address, number, district, city, state, cep, "Brasil"].filter(Boolean).join(", ");
    if (!query.trim()) return null;

    const elapsed = Date.now() - lastGeoAt;
    if (elapsed < 1100) await new Promise(resolve => setTimeout(resolve, 1100 - elapsed));
    lastGeoAt = Date.now();

    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=" + encodeURIComponent(query);
    try {
      const data = await fetchJson(url, 10000);
      const first = Array.isArray(data) ? data[0] : null;
      const lat = Number(first?.lat);
      const lon = Number(first?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  async function routeDistance(base, destination) {
    const coords = base.lon + "," + base.lat + ";" + destination.lon + "," + destination.lat;
    const url = "https://router.project-osrm.org/route/v1/driving/" + coords + "?overview=false&steps=false";
    const data = await fetchJson(url, 12000);
    if (data?.code !== "Ok" || !data?.routes?.length) throw new Error("Rota indisponível");
    const route = data.routes[0];
    return {
      km: route.distance / 1000,
      roundTripKm: route.distance / 500,
      durationMin: route.duration / 60,
      provider: "OSRM / OpenStreetMap"
    };
  }

  function hideDistance() {
    const box = $("#distanceBox");
    if (box) box.classList.add("hidden");
    currentDistance = null;
  }

  function showDistance(title, detail, mode = "") {
    const box = $("#distanceBox");
    if (!box) return;
    box.classList.remove("hidden", "loading", "error");
    if (mode) box.classList.add(mode);
    $("#distanceKm").textContent = title;
    $("#distanceMeta").textContent = detail || "";
  }

  async function geocodeClientForm() {
    const cep = digits($("#cep")?.value);
    if (cep.length !== 8) return null;
    let data = clientCepData;
    if (!data || digits(data.cep) !== cep) {
      try {
        data = await lookupCepData(cep);
        clientCepData = data;
      } catch {
        data = null;
      }
    }

    const exact = await geocodeAddress({
      address: $("#address")?.value.trim() || data?.street || "",
      number: $("#number")?.value.trim() || "",
      district: $("#district")?.value.trim() || data?.district || "",
      city: $("#city")?.value.trim() || data?.city || "",
      state: data?.state || "",
      cep: formatCep(cep)
    });
    return exact || data?.cepCoords || null;
  }

  async function ensureBaseCoords(settings) {
    const exact = await geocodeAddress({
      address: settings.address,
      number: settings.number,
      district: settings.district,
      city: settings.city,
      state: settings.state,
      cep: settings.cep
    });
    if (exact) return exact;
    if (settings.coords) return settings.coords;

    try {
      const data = await lookupCepData(settings.cep);
      return data.cepCoords || null;
    } catch {
      return null;
    }
  }

  async function updateDistance() {
    const cep = digits($("#cep")?.value);
    if (cep.length !== 8) return hideDistance();

    const settings = loadSettings();
    if (!settings) {
      showDistance("Base não configurada", "Toque em ⚙ Configurações e salve o endereço fixo da Tudo de Helena.", "error");
      return null;
    }

    showDistance("Calculando…", "Buscando a rota de carro.", "loading");

    let base = settings.coords || null;
    if (!base) {
      base = await ensureBaseCoords(settings);
      if (base) {
        settings.coords = base;
        saveSettings(settings);
      }
    }

    let destination = clientCoords;
    if (!destination) {
      destination = await geocodeClientForm();
      clientCoords = destination;
    }

    if (!base || !destination) {
      showDistance("Distância indisponível", "Não foi possível localizar um dos endereços. Confira CEP, rua e número.", "error");
      currentDistance = null;
      return null;
    }

    try {
      currentDistance = await routeDistance(base, destination);
      const oneWay = currentDistance.km.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      const round = currentDistance.roundTripKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      const mins = Math.max(1, Math.round(currentDistance.durationMin));
      showDistance(oneWay + " km", "Só ida • ida e volta " + round + " km • cerca de " + mins + " min • rota aproximada");
      return currentDistance;
    } catch {
      showDistance("Rota indisponível", "Os endereços foram localizados, mas o serviço de rotas não respondeu. Tente novamente em instantes.", "error");
      currentDistance = null;
      return null;
    }
  }

  async function updateClientCoords(raw) {
    const cep = digits(raw);
    if (cep.length !== 8) {
      clientCoords = null;
      clientCepData = null;
      hideDistance();
      return;
    }

    const seq = ++clientSeq;
    try {
      const data = await lookupCepData(cep);
      if (seq !== clientSeq) return;
      clientCepData = data;
      clientCoords = await geocodeAddress({
        address: data.street,
        number: $("#number")?.value.trim() || "",
        district: data.district,
        city: data.city,
        state: data.state,
        cep: data.cep
      });
      if (!clientCoords) clientCoords = data.cepCoords;
    } catch {
      if (seq !== clientSeq) return;
      clientCepData = null;
      clientCoords = null;
    }
    await updateDistance();
  }

  async function refreshClientExactLocation() {
    const cep = digits($("#cep")?.value);
    if (cep.length !== 8) return;
    clientCoords = await geocodeClientForm();
    await updateDistance();
  }

  async function lookupBaseCep(raw) {
    const cep = digits(raw);
    if (cep.length !== 8) {
      setStatus("#baseCepStatus", cep.length ? "Digite os 8 números do CEP." : "");
      baseDraftCoords = null;
      baseDraftState = "";
      return;
    }

    const seq = ++baseSeq;
    setStatus("#baseCepStatus", "Buscando CEP…", "loading");
    try {
      const data = await lookupCepData(cep);
      if (seq !== baseSeq) return;
      $("#baseAddress").value = data.street;
      $("#baseDistrict").value = data.district;
      $("#baseCity").value = data.city;
      baseDraftCoords = data.cepCoords;
      baseDraftState = data.state;
      setStatus("#baseCepStatus", "Endereço encontrado pelo " + data.source + ".", "ok");
      $("#baseNumber").focus();
    } catch {
      if (seq !== baseSeq) return;
      baseDraftCoords = null;
      baseDraftState = "";
      setStatus("#baseCepStatus", "CEP não encontrado. Preencha o endereço manualmente.", "error");
    }
  }

  function renderSavedInfo(settings) {
    const box = $("#baseSavedInfo");
    if (!box) return;
    if (!settings) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    const text = [settings.address, settings.number, settings.district, settings.city].filter(Boolean).join(", ");
    box.textContent = "Base salva: " + text;
    box.classList.remove("hidden");
  }

  function openSettings() {
    const settings = loadSettings();
    $("#settingsForm").reset();
    setStatus("#baseCepStatus", "");
    baseDraftCoords = settings?.coords || null;
    baseDraftState = settings?.state || "";
    $("#baseCep").value = settings?.cep || "";
    $("#baseAddress").value = settings?.address || "";
    $("#baseNumber").value = settings?.number || "";
    $("#baseDistrict").value = settings?.district || "";
    $("#baseCity").value = settings?.city || "";
    $("#baseComplement").value = settings?.complement || "";
    renderSavedInfo(settings);
    $("#settingsDialog").showModal();
  }

  function resetForRental() {
    clientCoords = null;
    clientCepData = null;
    currentDistance = null;
    hideDistance();
  }

  function bind() {
    document.addEventListener("click", e => {
      const button = e.target.closest("[data-open-settings]");
      if (button) openSettings();
    });

    $("#baseCep")?.addEventListener("input", e => {
      const d = digits(e.target.value);
      e.target.value = formatCep(d);
      clearTimeout(baseTimer);
      baseSeq++;
      if (d.length < 8) {
        setStatus("#baseCepStatus", d.length ? "Digite os 8 números do CEP." : "");
        baseDraftCoords = null;
        baseDraftState = "";
        return;
      }
      baseTimer = setTimeout(() => lookupBaseCep(d), 320);
    });

    $("#baseCep")?.addEventListener("blur", e => {
      const d = digits(e.target.value);
      if (d.length === 8 && !$("#baseCepStatus")?.classList.contains("loading") && !$("#baseCepStatus")?.classList.contains("ok")) {
        lookupBaseCep(d);
      }
    });

    $("#cep")?.addEventListener("input", e => {
      const d = digits(e.target.value);
      clearTimeout(clientTimer);
      clientSeq++;
      clientCoords = null;
      clientCepData = null;
      currentDistance = null;
      if (d.length < 8) return hideDistance();
      clientTimer = setTimeout(() => updateClientCoords(d), 600);
    });

    ["#number", "#address", "#district", "#city"].forEach(selector => {
      $(selector)?.addEventListener("change", refreshClientExactLocation);
    });

    $("#settingsForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const cep = formatCep($("#baseCep").value);
      const previous = loadSettings();
      const draft = {
        cep,
        address: $("#baseAddress").value.trim(),
        number: $("#baseNumber").value.trim(),
        district: $("#baseDistrict").value.trim(),
        city: $("#baseCity").value.trim(),
        state: baseDraftState || previous?.state || "",
        complement: $("#baseComplement").value.trim()
      };

      let coords = await geocodeAddress(draft);
      if (!coords) coords = baseDraftCoords;
      if (!coords) {
        try {
          const data = await lookupCepData(cep);
          coords = data.cepCoords;
          draft.state = draft.state || data.state;
        } catch {}
      }

      const settings = { ...draft, coords, savedAt: new Date().toISOString() };
      saveSettings(settings);
      renderSavedInfo(settings);
      $("#settingsDialog").close();
      if (digits($("#cep")?.value).length === 8) await updateDistance();
      window.dispatchEvent(new CustomEvent("helena-settings-saved", { detail: settings }));
    });
  }

  window.HelenaDistance = {
    openSettings,
    resetForRental,
    updateDistance,
    current: () => currentDistance ? { ...currentDistance } : null,
    getSettings: loadSettings,
    exportSettings: loadSettings,
    importSettings: settings => {
      if (settings && typeof settings === "object") saveSettings(settings);
    }
  };

  bind();
})();