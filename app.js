  const STORAGE_KEY = "rito-os-v1";

  const SUPABASE_URL = "https://soarinrvuvnqabtyyrta.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qsbL0lRuMR1eZAKp0vcscg_5PfVxGHo";
  const REMOTE_REQUEST_TIMEOUT_MS = 5000;

  if (!window.supabase) {
    throw new Error("SDK do Supabase não carregou.");
  }

  const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  window.__PORTAL_RECOVERY_DIAGNOSTICS__ = window.__PORTAL_RECOVERY_DIAGNOSTICS__ || {
    source: "boot",
    remoteScore: 0,
    recoveredScore: 0,
    finalScore: 0,
    counts: {
      ritoDeals: 0,
      fastTasks: 0,
      aticaDeals: 0
    },
    notes: []
  };

  let currentSessionAccessToken = "";
  const PORTAL_MEDIA_BUCKET = "portal-media";
  const PORTAL_DOCUMENTS_BUCKET = "portal-documents";
  let cachedSharedPortalStateRow = null;
  let _cachedStateLoadedAt = 0;
  let lastLoadedPortalSource = "boot";
  const STATE_CACHE_TTL_MS = 20_000;

  function withTimeout(promise, ms, label = "Operacao remota") {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(`${label} excedeu ${Math.round(ms / 1000)}s.`));
      }, ms);
      Promise.resolve(promise)
        .then((value) => {
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  // =======================
  // BANCO DE DADOS GLOBAL
  // =======================

  async function loadSharedPortalState({ useCache = false } = {}) {
    if (useCache && cachedSharedPortalStateRow && (Date.now() - _cachedStateLoadedAt) < STATE_CACHE_TTL_MS) {
      return cachedSharedPortalStateRow;
    }
    console.info("[portal-db] GET /shared_portal_state", {
      method: "SELECT",
      table: "shared_portal_state",
      id: 1
    });
    const { data, error } = await withTimeout(
      supabaseClient
        .from("shared_portal_state")
        .select("id, data, updated_at")
        .eq("id", 1)
        .single(),
      REMOTE_REQUEST_TIMEOUT_MS,
      "Leitura do estado remoto do portal"
    );

    if (error) {
      console.error("[portal-db] Falha ao carregar shared_portal_state", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      throw error;
    }

    cachedSharedPortalStateRow = {
      id: data?.id ?? 1,
      data: data?.data && typeof data.data === "object" ? data.data : {},
      updated_at: data?.updated_at || null
    };
    _cachedStateLoadedAt = Date.now();
    return cachedSharedPortalStateRow;
  }

  async function saveSharedPortalState(state) {
    const updatedAt = new Date().toISOString();
    const payload = {
      id: 1,
      data: state,
      updated_at: updatedAt
    };

    console.info("[portal-db] POST /shared_portal_state?on_conflict=id", {
      method: "UPSERT",
      table: "shared_portal_state",
      id: payload.id,
      lastSavedAt: state?.lastSavedAt || null
    });

    const { error } = await withTimeout(
      supabaseClient
        .from("shared_portal_state")
        .upsert(payload, { onConflict: "id" }),
      REMOTE_REQUEST_TIMEOUT_MS,
      "Gravacao do estado remoto do portal"
    );

    if (error) {
      console.error("[portal-db] Falha ao salvar shared_portal_state", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        payloadSummary: {
          id: payload.id,
          lastSavedAt: state?.lastSavedAt || null
        }
      });
      throw error;
    }

    cachedSharedPortalStateRow = {
      id: payload.id,
      data: payload.data,
      updated_at: updatedAt
    };
    _cachedStateLoadedAt = Date.now();
    return cachedSharedPortalStateRow;
  }

  async function refreshSessionAccessToken() {
    try {
      const { data } = await supabaseClient.auth.getSession();
      currentSessionAccessToken = data.session?.access_token || "";
    } catch (error) {
      currentSessionAccessToken = "";
      console.warn("Não foi possível atualizar o token da sessão.", error);
    }
    return currentSessionAccessToken;
  }

  function triggerKeepalivePortalSave(snapshot = state) {
    if (typeof fetch !== "function") return;
    if (!currentSessionAccessToken) return;
    const payload = {
      id: 1,
      data: clonePortalState(snapshot),
      updated_at: new Date().toISOString()
    };
    fetch(`${SUPABASE_URL}/rest/v1/shared_portal_state?on_conflict=id`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${currentSessionAccessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(payload)
    }).catch((error) => {
      console.warn("Falha ao disparar o salvamento keepalive do portal.", error);
    });
  }

  function slugifyStorageSegment(value, fallback = "arquivo") {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || fallback;
  }

  function fileExtensionFromName(name = "", fallback = "bin") {
    const match = String(name || "").match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : fallback;
  }

  async function uploadFileToStorage(file, bucket, folder, options = {}) {
    if (!file) return { path: "", publicUrl: "" };
    const extension = fileExtensionFromName(file.name, options.defaultExtension || "bin");
    const safeFolder = slugifyStorageSegment(folder, "workspace");
    const safeName = slugifyStorageSegment(options.baseName || file.name.replace(/\.[^.]+$/, ""), options.prefix || "arquivo");
    const filePath = `${safeFolder}/${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const contentType = options.contentType || file.type || "application/octet-stream";
    const { error } = await withTimeout(
      supabaseClient.storage
        .from(bucket)
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType
        }),
      REMOTE_REQUEST_TIMEOUT_MS,
      "Upload de arquivo"
    );
    if (error) throw error;
    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(filePath);
    return {
      path: filePath,
      publicUrl: data?.publicUrl || ""
    };
  }

  async function removeFileFromStorage(bucket, path) {
    const target = String(path || "").trim();
    if (!target) return;
    const { error } = await withTimeout(
      supabaseClient.storage.from(bucket).remove([target]),
      REMOTE_REQUEST_TIMEOUT_MS,
      "Remocao de arquivo"
    );
    if (error) console.warn("Não foi possível remover o arquivo do storage.", error);
  }

  function resolveDocumentUrl(doc = {}) {
    return String(doc.fileUrl || doc.publicUrl || doc.filePath || "").trim();
  }

  // =======================
  // AUTO SAVE
  // =======================

  let pendingRemoteSave = Promise.resolve();
  let queuedSaveVersion = 0;
  let activeProjectTagPickerKey = "";
  let _debouncedSaveTimer = null;
  let _lastRenderedSidebarKey = "";
  let _lastRenderedTabsKey = "";
  const SAVE_DEBOUNCE_MS = 1500;
  const RITO_LOGO_LIGHT_GITHUB_URL = "https://raw.githubusercontent.com/brunasantos-rito/rito-portal/main/Logo-Rito-Light.png";
  const RITO_LOGO_DARK_GITHUB_URL = "https://raw.githubusercontent.com/brunasantos-rito/rito-portal/main/Logo-Rito-Dark.png";
  const RITO_MARK_LIGHT_GITHUB_URL = "https://raw.githubusercontent.com/brunasantos-rito/rito-portal/main/rito-mark-light.png";
  const RITO_MARK_DARK_GITHUB_URL = "https://raw.githubusercontent.com/brunasantos-rito/rito-portal/main/rito-mark-dark.png";
  const RITO_ROXA_LOGO_GITHUB_URL = "data:image/png;base64,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";
  const LOGIN_COVER_GITHUB_URL = "https://raw.githubusercontent.com/brunasantos-rito/rito-portal/main/Backgroud-Capa-1.png";
  const LOGIN_COVER_PATH = "./Backgroud-Capa-1.png";
  const LOGIN_INTRO_VIDEO_PATH = "/rito-intro.mp4";
  const LOGIN_INTRO_WAIT_TIMEOUT_MS = 8000;
  const LOGIN_INTRO_FAIL_FAST_MS = 1500;
  const LOGIN_INTRO_MAX_PLAY_MS = 30000;

  function clonePortalState(snapshot = state) {
    return JSON.parse(JSON.stringify(snapshot));
  }

  function saveLocalPortalState(snapshot = state) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("Não foi possível salvar o snapshot local do portal.", error);
    }
  }

  function loadLocalPortalState() {
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.warn("Não foi possível ler o snapshot local do portal.", error);
      return null;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function nextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  function portalSaveRevision(snapshot = null) {
    const revision = Number(snapshot?.saveRevision || 0);
    return Number.isFinite(revision) ? revision : 0;
  }

  function portalStateVersion(snapshot = null) {
    const timestamp = Date.parse(String(snapshot?.lastSavedAt || "").trim());
    const safeTimestamp = Number.isNaN(timestamp) ? 0 : timestamp;
    return (safeTimestamp * 1000) + Math.min(portalSaveRevision(snapshot), 999);
  }

  function stampPortalState(snapshot = state) {
    if (!snapshot || typeof snapshot !== "object") return snapshot;
    snapshot.lastSavedAt = new Date().toISOString();
    snapshot.saveRevision = portalSaveRevision(snapshot) + 1;
    return snapshot;
  }

  function recordTimestampValue(record = null) {
    const timestamp = Date.parse(String(record?.updatedAt || record?.createdAt || "").trim());
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function choosePreferredPortalState(primarySnapshot = null, secondarySnapshot = null) {
    const primary = unwrapPortalSnapshot(primarySnapshot);
    const secondary = unwrapPortalSnapshot(secondarySnapshot);
    const primaryHasData = hasMeaningfulPortalData(primary);
    const secondaryHasData = hasMeaningfulPortalData(secondary);
    if (primaryHasData && !secondaryHasData) return primarySnapshot;
    if (secondaryHasData && !primaryHasData) return secondarySnapshot;

    const primaryVersion = portalStateVersion(primary);
    const secondaryVersion = portalStateVersion(secondary);
    if (primaryVersion !== secondaryVersion) {
      return secondaryVersion > primaryVersion ? secondarySnapshot : primarySnapshot;
    }

    const primaryScore = portalDataScore(primary);
    const secondaryScore = portalDataScore(secondary);
    return secondaryScore > primaryScore ? secondarySnapshot : primarySnapshot;
  }

  function isPortalStateDangerouslyWeaker(candidateSnapshot = null, referenceSnapshot = null) {
    const candidate = unwrapPortalSnapshot(candidateSnapshot);
    const reference = unwrapPortalSnapshot(referenceSnapshot);
    const candidateScore = portalDataScore(candidate);
    const referenceScore = portalDataScore(reference);

    if (!hasMeaningfulPortalData(reference) || !referenceScore) return false;
    if (candidateScore >= referenceScore) return false;

    const candidateCounts = portalSnapshotCounts(candidate);
    const referenceCounts = portalSnapshotCounts(reference);
    const missingDeals = Math.max(0, (referenceCounts.ritoDeals + referenceCounts.aticaDeals) - (candidateCounts.ritoDeals + candidateCounts.aticaDeals));
    const missingFastTasks = Math.max(0, referenceCounts.fastTasks - candidateCounts.fastTasks);
    const scoreGap = referenceScore - candidateScore;
    const candidateRatio = candidateScore / referenceScore;

    return scoreGap >= 25 && (
      candidateRatio <= 0.6 ||
      missingDeals >= 2 ||
      missingFastTasks >= 5
    );
  }

  async function saveSharedPortalStateSafely(snapshot) {
    const payload = clonePortalState(snapshot);
    let remoteRow = null;
    let remoteReadFailed = false;
    try {
      remoteRow = await loadSharedPortalState({ useCache: false });
    } catch (error) {
      remoteReadFailed = true;
      console.warn("Não foi possível ler o estado remoto antes do save. Seguindo com a gravação.", error);
    }

    if (remoteReadFailed && lastLoadedPortalSource !== "remote-state") {
      throw new Error("Salvamento remoto bloqueado para evitar sobrescrever a nuvem sem validar o estado mais recente.");
    }

    const remoteState = remoteRow?.data && typeof remoteRow.data === "object" ? remoteRow.data : null;
    if (remoteState && portalStateVersion(remoteState) > portalStateVersion(payload)) {
      console.warn("Save ignorado para evitar sobrescrever uma versão mais nova do portal.");
      return {
        skipped: true,
        data: remoteState,
        updated_at: remoteRow?.updated_at || null
      };
    }

    if (remoteState && isPortalStateDangerouslyWeaker(payload, remoteState)) {
      console.warn("Save remoto bloqueado para evitar regressão forte de dados na nuvem.", {
        source: lastLoadedPortalSource,
        remoteScore: portalDataScore(remoteState),
        payloadScore: portalDataScore(payload),
        remoteCounts: portalSnapshotCounts(remoteState),
        payloadCounts: portalSnapshotCounts(payload)
      });
      return {
        skipped: true,
        data: remoteState,
        updated_at: remoteRow?.updated_at || null
      };
    }

    return saveSharedPortalState(payload);
  }

  async function confirmRemotePortalState(expectedState, attempts = 3) {
    const expectedVersion = portalStateVersion(expectedState);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const remote = await loadSharedPortalState();
      const remoteState = buildPortalState(remote?.data && Object.keys(remote.data).length ? remote.data : null);
      if (!expectedVersion || portalStateVersion(remoteState) >= expectedVersion) {
        return remoteState;
      }
      if (attempt < attempts - 1) {
        await delay(200 * (attempt + 1));
      }
    }
    throw new Error("O estado salvo não retornou da nuvem com a versão esperada.");
  }

  function schedulePortalStateVerification(expectedState) {
    const expectedSnapshot = clonePortalState(expectedState);
    window.setTimeout(async () => {
      try {
        const remoteState = await confirmRemotePortalState(expectedSnapshot, 2);
        if (portalStateVersion(remoteState) >= portalStateVersion(state)) {
          state = remoteState;
        }
      } catch (error) {
        console.warn("A confirmação assíncrona do save não retornou a versão esperada.", error);
      }
    }, 0);
  }

  function queueImmediateRemoteSave(snapshot = state) {
    const payload = clonePortalState(snapshot);
    saveLocalPortalState(payload);
    const currentVersion = ++queuedSaveVersion;
    pendingRemoteSave = pendingRemoteSave
      .catch(() => null)
      .then(async () => {
        if (currentVersion !== queuedSaveVersion) return null;
        const result = await saveSharedPortalStateSafely(payload);
        if (currentVersion !== queuedSaveVersion) return null;
        const resolvedState = buildPortalState(result?.data && typeof result.data === "object" ? result.data : payload);
        if (portalStateVersion(resolvedState) >= portalStateVersion(state)) {
          state = resolvedState;
          saveLocalPortalState(state);
        }
        console.log("Portal salvo no banco.");
        return result;
      })
      .catch((error) => {
        console.error("Erro ao salvar:", error);
        return null;
      });
    return pendingRemoteSave;
  }

  async function persistPortalStateImmediately(snapshot = state) {
    const payload = clonePortalState(snapshot);
    stampPortalState(payload);
    saveLocalPortalState(payload);
    queuedSaveVersion += 1;
    try {
      await pendingRemoteSave.catch(() => null);
      const result = await saveSharedPortalStateSafely(payload);
      const resolvedState = result?.data && typeof result.data === "object"
        ? result.data
        : payload;
      state = buildPortalState(resolvedState);
      saveLocalPortalState(state);
      pendingRemoteSave = Promise.resolve(result);
      console.log("Portal salvo imediatamente no banco.");
      triggerKeepalivePortalSave(payload);
      schedulePortalStateVerification(payload);
      return result;
    } catch (error) {
      pendingRemoteSave = Promise.resolve();
      console.error("Erro ao salvar imediatamente:", error);
      throw error;
    }
  }

  function workspaceStateSnapshot(rootState, workspaceId) {
    const snapshot = rootState || buildPortalState();
    if (!snapshot.workspaces?.[workspaceId]) {
      const seeded = seedData();
      snapshot.workspaces = snapshot.workspaces || {};
      snapshot.workspaces[workspaceId] = clonePortalState(seeded.workspaces?.[workspaceId] || {});
    }
    const workspace = snapshot.workspaces[workspaceId];
    workspace.crmItems = Array.isArray(workspace.crmItems) ? workspace.crmItems : [];
    normalizeCRMItemOrder(workspace.crmItems);
    workspace.projectBoards = workspace.projectBoards && typeof workspace.projectBoards === "object" ? workspace.projectBoards : {};
    workspace.documents = Array.isArray(workspace.documents) ? workspace.documents : [];
    return workspace;
  }

  function upsertCRMItemInSnapshot(rootState, workspaceId, item) {
    const workspace = workspaceStateSnapshot(rootState, workspaceId);
    const nextItem = clonePortalState(item);
    ensureProjectShape(nextItem);
    if (workspaceId === "rito" && isSeededRitoCRMItem(nextItem)) {
      workspace.deletedReferenceProjectKeys = (Array.isArray(workspace.deletedReferenceProjectKeys)
        ? workspace.deletedReferenceProjectKeys
        : []
      ).filter((key) => normalizeReferenceIdentity(key) !== referenceProjectKey(nextItem));
    }
    const index = workspace.crmItems.findIndex((entry) => entry.id === nextItem.id);
    if (index >= 0) workspace.crmItems[index] = nextItem;
    else workspace.crmItems.unshift(nextItem);
    workspace.crmItems = dedupeCRMItemsById(workspace.crmItems);
    if (nextItem.tags.includes("Investido") && !workspace.projectBoards[nextItem.name]) {
      workspace.projectBoards[nextItem.name] = [];
    }
    if (!nextItem.tags.includes("Investido") && workspace.projectBoards[nextItem.name] && nextItem.investmentStatus !== "Investido") {
      delete workspace.projectBoards[nextItem.name];
    }
    return nextItem;
  }

  function removeCRMItemFromSnapshot(rootState, workspaceId, item) {
    const workspace = workspaceStateSnapshot(rootState, workspaceId);
    workspace.crmItems = workspace.crmItems.filter((entry) => entry.id !== item.id);
    normalizeCRMItemOrder(workspace.crmItems);
    if (workspaceId === "rito" && isSeededRitoCRMItem(item)) {
      const deletedReferenceProjectKeys = new Set(
        Array.isArray(workspace.deletedReferenceProjectKeys)
          ? workspace.deletedReferenceProjectKeys.map((key) => normalizeReferenceIdentity(key)).filter(Boolean)
          : []
      );
      deletedReferenceProjectKeys.add(referenceProjectKey(item));
      workspace.deletedReferenceProjectKeys = [...deletedReferenceProjectKeys];
    }
    delete workspace.projectBoards[item.name];
    workspace.documents = workspace.documents.filter((doc) => (doc.linkedTo || "").toLowerCase() !== item.name.toLowerCase());
  }

  async function loadPortalStateForDatabaseWrite() {
    try {
      const remote = await loadSharedPortalState({ useCache: false });
      const remoteState = remote?.data && typeof remote.data === "object" ? remote.data : null;
      const recoveredState = await loadBundledPortalBackup();
      const hydratedRemoteState = mergePortalMembersFromFallback(remoteState, recoveredState);
      // Nuvem é sempre a fonte da verdade para writes — local nunca deve sobrescrever o remoto
      if (hasMeaningfulPortalData(hydratedRemoteState)) {
        return buildPortalState(hydratedRemoteState);
      }
      // Nuvem vazia — usa local apenas como fallback seguro
      const localState = loadLocalPortalState();
      const hydratedLocalState = mergePortalMembersFromFallback(localState, recoveredState);
      return buildPortalState(hydratedLocalState || remoteState || localState || recoveredState);
    } catch (error) {
      const code = String(error?.code || "").trim();
      const details = String(error?.details || error?.message || "").toLowerCase();
      if (code === "PGRST116" || details.includes("0 rows") || details.includes("no rows")) {
        const localState = loadLocalPortalState();
        const recoveredState = await loadBundledPortalBackup();
        const preferredState = choosePreferredPortalState(localState, recoveredState);
        return buildPortalState(preferredState || localState || recoveredState);
      }
      throw error;
    }
  }

  async function persistCRMOrderToDatabase(orderedItems, {
    workspaceId = state.currentWorkspace,
    attempts = 3
  } = {}) {
    queuedSaveVersion += 1;
    await pendingRemoteSave.catch(() => null);
    pendingRemoteSave = Promise.resolve();

    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        console.info("[crm-order-save] Persistindo ordem real dos deals", {
          attempt: attempt + 1,
          workspaceId,
          totalDeals: Array.isArray(orderedItems) ? orderedItems.length : 0
        });
        const nextState = await loadPortalStateForDatabaseWrite();
        const workspace = workspaceStateSnapshot(nextState, workspaceId);
        workspace.crmItems = clonePortalState(Array.isArray(orderedItems) ? orderedItems : []);
        stampPortalState(nextState);
        saveLocalPortalState(nextState);

        const savedRow = await saveSharedPortalStateSafely(nextState);
        let savedState = buildPortalState(savedRow?.data && typeof savedRow.data === "object" ? savedRow.data : nextState);
        const savedIds = (savedState.workspaces?.[workspaceId]?.crmItems || []).map((item) => item.id);
        const expectedIds = (workspace.crmItems || []).map((item) => item.id);

        if (savedIds.length === expectedIds.length && savedIds.every((id, index) => id === expectedIds[index])) {
          state = savedState;
          saveLocalPortalState(state);
          return savedState;
        }

        try {
          savedState = await confirmRemotePortalState(nextState, 3);
        } catch (confirmError) {
          console.warn("[crm-order-save] Confirmacao pos-save nao refletiu a nova ordem ainda.", {
            workspaceId,
            message: confirmError?.message || String(confirmError)
          });
        }

        const confirmedIds = (savedState.workspaces?.[workspaceId]?.crmItems || []).map((item) => item.id);
        if (confirmedIds.length === expectedIds.length && confirmedIds.every((id, index) => id === expectedIds[index])) {
          state = savedState;
          saveLocalPortalState(state);
          return savedState;
        }

        state = buildPortalState(nextState);
        saveLocalPortalState(state);
        schedulePortalStateVerification(nextState);
        return state;
      } catch (error) {
        lastError = error;
        console.error("[crm-order-save] Falha na persistencia da ordem dos deals", {
          attempt: attempt + 1,
          workspaceId,
          message: error?.message || String(error),
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null
        });
        if (attempt < attempts - 1) {
          await delay(250 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error("Não foi possível persistir a ordem dos deals no banco de dados.");
  }

  async function persistCRMItemToDatabase(item, {
    workspaceId = state.currentWorkspace,
    remove = false,
    attempts = 3,
    renderOnSuccess = true
  } = {}) {
    queuedSaveVersion += 1;
    await pendingRemoteSave.catch(() => null);
    pendingRemoteSave = Promise.resolve();

    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        console.info("[crm-save] Iniciando persistencia real do deal", {
          attempt: attempt + 1,
          workspaceId,
          remove,
          dealId: item?.id || null,
          dealName: item?.name || null,
          status: item?.status || null
        });
        const nextState = await loadPortalStateForDatabaseWrite();
        if (remove) {
          removeCRMItemFromSnapshot(nextState, workspaceId, item);
        } else {
          upsertCRMItemInSnapshot(nextState, workspaceId, item);
        }
        stampPortalState(nextState);
        const savedRow = await saveSharedPortalStateSafely(nextState);
        let savedState = buildPortalState(savedRow?.data && typeof savedRow.data === "object" ? savedRow.data : nextState);
        let persistedItem = savedState.workspaces?.[workspaceId]?.crmItems?.find((entry) => entry.id === item.id) || null;
        if ((remove && persistedItem) || (!remove && !persistedItem)) {
          try {
            savedState = await confirmRemotePortalState(nextState, 3);
            persistedItem = savedState.workspaces?.[workspaceId]?.crmItems?.find((entry) => entry.id === item.id) || null;
          } catch (confirmError) {
            console.warn("[crm-save] Confirmacao pos-save nao retornou a versao esperada; usando snapshot remoto mais recente disponivel.", {
              workspaceId,
              remove,
              dealId: item?.id || null,
              dealName: item?.name || null,
              message: confirmError?.message || String(confirmError)
            });
            const refreshedRemote = await loadPortalStateForDatabaseWrite();
            savedState = buildPortalState(refreshedRemote);
            persistedItem = savedState.workspaces?.[workspaceId]?.crmItems?.find((entry) => entry.id === item.id) || null;
          }
        }
        if ((remove && !persistedItem) || (!remove && persistedItem)) {
          state = savedState;
          if (renderOnSuccess) renderApp();
          return savedState;
        }
        console.warn("[crm-save] Gravacao confirmada, mas o read-after-write ainda nao refletiu o snapshot esperado. Mantendo estado otimista e reagendando verificacao.", {
          workspaceId,
          remove,
          dealId: item?.id || null,
          dealName: item?.name || null,
          expectedLastSavedAt: nextState?.lastSavedAt || null
        });
        state = buildPortalState(nextState);
        if (renderOnSuccess) renderApp();
        schedulePortalStateVerification(nextState);
        return state;
      } catch (error) {
        console.error("[crm-save] Falha na persistencia do deal", {
          attempt: attempt + 1,
          workspaceId,
          remove,
          dealId: item?.id || null,
          dealName: item?.name || null,
          message: error?.message || String(error),
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null
        });
        lastError = error;
      }
      await delay(180 * (attempt + 1));
    }
    throw lastError || new Error("Não foi possível persistir o deal no banco de dados.");
  }

  function flushRemoteSave() {
    return persistPortalStateImmediately(state);
  }

  function triggerInstantRemoteSave(snapshot = state) {
    return persistPortalStateImmediately(snapshot);
  }

  function persistTaskEditorDraft() {
    const form = document.getElementById("taskEditorForm");
    if (!form) return;
    const taskId = form.dataset.taskId;
    const isProject = form.dataset.taskProject === "1";
    const projectName = form.dataset.projectName || "";
    const task = findKanbanTask(taskId, isProject, projectName);
    if (!task) return;
    const formData = new FormData(form);
    task.stage = String(formData.get("stage") || task.stage);
    task.title = String(formData.get("title") || task.title).trim();
    task.description = String(formData.get("description") || "").trim();
    task.status = String(formData.get("status") || task.status);
    task.priority = String(formData.get("priority") || task.priority);
    task.owner = String(formData.get("owner") || task.owner);
    task.dueDate = normalizeDateInputValue(formData.get("dueDate") || task.dueDate);
    task.completionDate = normalizeDateInputValue(formData.get("completionDate") || "");
    task.recurrence = canonicalTaskRecurrence(formData.get("recurrence") || task.recurrence || "Nenhuma");
    task.recurrenceAnchorDate = normalizeDateInputValue(formData.get("recurrenceAnchorDate") || task.recurrenceAnchorDate || task.dueDate || "");
    task.updatedAt = new Date().toISOString();
    refreshRecurringTask(task);
  }

  function persistVisibleCardEdits(root = document) {
    root.querySelectorAll("[data-card-investment]").forEach((input) => {
      const card = input.closest("[data-crm-id]");
      const crmId = card?.dataset.crmId;
      if (!crmId) return;
      const item = workspaceData().crmItems.find((entry) => entry.id === crmId);
      if (!item) return;
      item.investmentAmount = Math.max(0, parseLocaleNumber(input.value || 0));
      item.updatedAt = todayISO();
      syncInvestmentTag(item);
    });
  }

  function persistVisibleKanbanEdits(root = document) {
    root.querySelectorAll("[data-inline-column]").forEach((node) => {
      persistKanbanColumnDraft(node.dataset.inlineColumn, Number(node.dataset.columnIndex), node.textContent);
    });
    root.querySelectorAll("[data-inline-field]").forEach((node) => {
      const taskId = node.dataset.id;
      const isProject = node.dataset.project === "1";
      const projectName = node.dataset.projectName || "";
      const found = findKanbanTask(taskId, isProject, projectName);
      if (!found) return;
      const field = node.dataset.inlineField;
      const nextValue = node.matches("input, select") ? node.value : node.textContent.trim();
      found[field] = nextValue;
      if (field === "dueDate") {
        found.status = nextValue < todayISO() ? "Atrasado" : "Em andamento";
      }
      if (field === "recurrence") {
        found.recurrence = canonicalTaskRecurrence(nextValue);
      }
    });
  }

  function flushOpenEditors({ persistRemotely = false } = {}) {
    try {
      persistVisibleKanbanEdits();
    } catch (error) {
      console.warn("Falha ao salvar edições do Kanban antes de sair.", error);
    }

    try {
      const projectPage = document.querySelector(".project-detail-page");
      const selectedProject = getSelectedProject();
      if (projectPage && selectedProject) {
        persistProjectDraft(selectedProject, projectPage);
      }
    } catch (error) {
      console.warn("Falha ao salvar rascunho do projeto antes de sair.", error);
    }

    try {
      const drawer = document.getElementById("entityDrawer");
      const selectedProject = getSelectedProject();
      if (drawer && !drawer.classList.contains("hidden") && selectedProject) {
        persistProjectDraft(selectedProject, drawer);
      }
    } catch (error) {
      console.warn("Falha ao salvar rascunho do drawer antes de sair.", error);
    }

    try {
      persistTaskEditorDraft();
    } catch (error) {
      console.warn("Falha ao salvar rascunho da tarefa antes de sair.", error);
    }

    try {
      persistVisibleCardEdits();
    } catch (error) {
      console.warn("Falha ao salvar edições dos cards antes de sair.", error);
    }

    stampPortalState(state);
    saveLocalPortalState(state);
    if (persistRemotely) {
      return persistPortalStateImmediately(state);
    }
    return Promise.resolve(state);
  }

  const ARTHUR_BUENO_PHOTO = "foto-arthur.jpg";
  const RITO_PIPELINE_STAGES = ["Lead", "Pipeline", "NDA", "IRL", "LOI", "NBO", "Proposta", "Due Diligence", "Signing", "Closing", "Aporte", "Portfólio", "Declinado", "Exit"];

  const workspaceConfig = {
    rito: {
      id: "rito",
      name: "Rito",
      subtitle: "CRM, investimento e operação",
      mark: "Rito",
      views: ["dashboard", "crm", "invested", "tasks", "projectBoards", "rites", "documents", "members", "settings"],
      pipelineStages: RITO_PIPELINE_STAGES,
      kanbanStages: ["A fazer", "Em andamento", "Concluído"],
      memberOptions: ["Bruna Cristina", "Arthur Bueno", "Ciro Ribeiro", "Gabriela Reis"]
    },
    fast: {
      id: "fast",
      name: "Fast Massagem",
      subtitle: "Operação, marketing e expansão",
      mark: "FM",
      views: ["dashboard", "tasks", "calendar", "documents", "members", "settings"],
      kanbanStages: ["ABF", "Pessoas", "Operacoes", "Estrategico", "Financeiro", "Marketing"],
      memberOptions: ["Bruna Cristina", "Arthur Bueno", "Ciro Ribeiro", "Mayra", "Eduardo", "Grace", "Rodrigo"]
    }
  };

  const RITO_DEAL_STATUS_OPTIONS = RITO_PIPELINE_STAGES;

  const DEFAULT_TASK_THEMES = {
    rito: ["Infra / CRM", "Marca e Marketing", "Digital", "Juridico", "Deals", "Governanca", "Marca", "Financeiro"],
    fast: ["ABF", "Pessoas", "Operacoes", "Estrategico", "Financeiro", "Marketing"]
  };

  const FAST_DAILY_THEMES = ["ABF", "Felps", "Penog", "Prospecta", "Financeiro", "Estratégico", "Design Gráfico", "Operações", "Comercial", "Mayra"];

  const DEFAULT_PROJECT_THEMES = {
    rito: ["Operação", "Financeiro", "Comercial", "Jurídico", "Growth"],
    fast: ["Operação", "Marketing", "Expansão", "Financeiro"]
  };

  const DEFAULT_KANBAN_THEME_COLORS = ["#8AAFCC", "#80CBC4", "#C87070", "#B0ACCE", "#F48FB1", "#FFCC80", "#FF8A65", "#B8A47A", "#4DB6AC", "#7986CB", "#BA68C8"];

  const coverPalette = {
    Frio: "#8da2c6",
    Morno: "#ffb84d",
    Quente: "#ff6b6b",
    Pipeline: "#2864ff",
    Declinado: "#697586",
    Investido: "#0f9f67"
  };

  const viewLabels = {
    dashboard: "Dashboard",
    crm: "CRM",
    invested: "Projetos Investidos",
    tasks: "Kanban",
    projectBoards: "Kanban dos Projetos",
    rites: "Ritos",
    documents: "Documentos",
    members: "Membros",
    calendar: "Calendário",
    settings: "Configurações",
    projectDetail: "Projeto"
  };

  const viewIcons = {
    dashboard: "◦",
    crm: "↗",
    invested: "✦",
    tasks: "☰",
    projectBoards: "▦",
    rites: "✺",
    documents: "⌁",
    members: "•",
    calendar: "◷",
    settings: "⌘"
  };

  const workspaceLaunchMeta = {
    rito: {
      index: "01",
      shortLabel: "RV",
      descriptor: "Gestão de Portfólio",
      greeting: "Portfólio, CRM e operação de investimentos."
    },
    fast: {
      index: "02",
      shortLabel: "FM",
      descriptor: "Operações",
      greeting: "Operação, marketing e expansão da marca."
    }
  };

  const DILIGENCE_PROJECTS = [
    {
      id: "aurora-bioenergia",
      name: "Aurora Bioenergia S.A.",
      companyCode: "AB",
      status: "Em andamento",
      risk: "Médio",
      progress: 72,
      startDate: "04 Abr 2026",
      deadline: "30 Abr 2026",
      enterpriseValue: 420000000,
      equityValue: 286000000,
      adjustedEnterpriseValue: 401300000,
      adjustedEquityValue: 267300000,
      adjustedEbitda: 58500000,
      team: ["Bruna Cristina", "Arthur Bueno", "Gabriela Reis"],
      tags: ["Energia", "Buy-side", "Brasil"],
      sector: "Energia",
      transaction: "Buy-side",
      geography: "Brasil",
      summary: "Tese de aquisição com foco em geração de caixa, estabilidade operacional e sinergias de expansão regional.",
      areaRisks: [
        { area: "Financeiro", score: 78, severity: "Alto", note: "Ajustes de EBITDA e concentração de clientes pressionam valuation." },
        { area: "Jurídico", score: 63, severity: "Médio", note: "Contencioso trabalhista recorrente e covenants contratuais relevantes." },
        { area: "Fiscal", score: 59, severity: "Médio", note: "Créditos tributários dependem de documentação complementar." },
        { area: "Operacional", score: 54, severity: "Médio", note: "Dependência de fornecedores críticos no Centro-Oeste." },
        { area: "ESG", score: 34, severity: "Baixo", note: "Governança adequada; melhoria recomendada em KPIs ambientais." }
      ],
      phases: [
        { name: "Planejamento", progress: 100, owner: "Bruna Cristina" },
        { name: "Coleta de dados", progress: 84, owner: "Gabriela Reis" },
        { name: "Análise por área", progress: 68, owner: "Arthur Bueno" },
        { name: "Comitê / recomendações", progress: 41, owner: "Ciro Ribeiro" }
      ],
      contingencies: [
        { title: "Autos de infração de ICMS", type: "Tributária", area: "Fiscal", value: 7200000, probability: "Provável", impact: "Alto", status: "Em análise", owner: "Bruna Cristina", updatedAt: "12 Abr 2026", x: 88, y: 84 },
        { title: "Ação coletiva de horas extras", type: "Trabalhista", area: "Jurídico", value: 3400000, probability: "Possível", impact: "Médio", status: "Aberta", owner: "Gabriela Reis", updatedAt: "10 Abr 2026", x: 64, y: 58 },
        { title: "Passivo ambiental em unidade GO", type: "Ambiental", area: "ESG", value: 2100000, probability: "Possível", impact: "Alto", status: "Mitigada", owner: "Arthur Bueno", updatedAt: "08 Abr 2026", x: 56, y: 74 }
      ],
      tasks: {
        todo: [
          { title: "Fechar request list complementar", owner: "Bruna Cristina", phase: "Planejamento" },
          { title: "Atualizar data room de contratos-chave", owner: "Gabriela Reis", phase: "Coleta" }
        ],
        doing: [
          { title: "Revisar qualidade dos ganhos", owner: "Arthur Bueno", phase: "Financeiro" },
          { title: "Validar provisões tributárias", owner: "Bruna Cristina", phase: "Fiscal" }
        ],
        done: [
          { title: "Kickoff com advisors e management", owner: "Ciro Ribeiro", phase: "Planejamento" },
          { title: "Mapeamento preliminar de riscos ESG", owner: "Consultor Externo", phase: "ESG" }
        ]
      },
      insights: [
        "Red flag financeira em concentração de receita nos três maiores clientes.",
        "Contingências tributárias representam a maior pressão no ajuste de valuation.",
        "Recomendação: condicionar signing a escrow e covenant de regularização fiscal."
      ]
    },
    {
      id: "nexa-saude",
      name: "Nexa Saúde Integrada",
      companyCode: "NS",
      status: "Em risco",
      risk: "Alto",
      progress: 58,
      startDate: "28 Mar 2026",
      deadline: "24 Abr 2026",
      enterpriseValue: 310000000,
      equityValue: 228000000,
      adjustedEnterpriseValue: 281000000,
      adjustedEquityValue: 199000000,
      adjustedEbitda: 36200000,
      team: ["Bruna Cristina", "Arthur Bueno", "Consultor Externo"],
      tags: ["Saúde", "Growth Equity", "Sudeste"],
      sector: "Saúde",
      transaction: "Growth Equity",
      geography: "Sudeste",
      summary: "Plataforma de clínicas com crescimento acelerado, porém pressionada por passivos regulatórios e integração operacional.",
      areaRisks: [
        { area: "Financeiro", score: 69, severity: "Médio", note: "Recebíveis com aging acima da política esperada." },
        { area: "Jurídico", score: 72, severity: "Alto", note: "Exposição em contratos médicos e judicialização de pacientes." },
        { area: "Fiscal", score: 66, severity: "Médio", note: "Fragilidade em documentação de créditos PIS/Cofins." },
        { area: "Operacional", score: 81, severity: "Alto", note: "Integração de unidades e dependência de corpo clínico-chave." },
        { area: "ESG", score: 57, severity: "Médio", note: "Controles de LGPD e governança clínica ainda imaturos." }
      ],
      phases: [
        { name: "Planejamento", progress: 100, owner: "Bruna Cristina" },
        { name: "Coleta de dados", progress: 77, owner: "Consultor Externo" },
        { name: "Análise por área", progress: 56, owner: "Arthur Bueno" },
        { name: "Comitê / recomendações", progress: 18, owner: "Ciro Ribeiro" }
      ],
      contingencies: [
        { title: "Provisionamento ANS e glosas", type: "Regulatório", area: "Operacional", value: 9800000, probability: "Provável", impact: "Alto", status: "Aberta", owner: "Consultor Externo", updatedAt: "13 Abr 2026", x: 86, y: 82 },
        { title: "Discussão trabalhista com corpo clínico", type: "Trabalhista", area: "Jurídico", value: 4600000, probability: "Possível", impact: "Alto", status: "Em análise", owner: "Bruna Cristina", updatedAt: "12 Abr 2026", x: 67, y: 76 },
        { title: "Autuação de ISS em filiais", type: "Tributária", area: "Fiscal", value: 2800000, probability: "Possível", impact: "Médio", status: "Mitigada", owner: "Arthur Bueno", updatedAt: "11 Abr 2026", x: 58, y: 57 }
      ],
      tasks: {
        todo: [
          { title: "Concluir diligência de LGPD", owner: "Consultor Externo", phase: "ESG" },
          { title: "Revisar earn-out proposto", owner: "Arthur Bueno", phase: "Comitê" }
        ],
        doing: [
          { title: "Reconciliar glosas e provisões", owner: "Bruna Cristina", phase: "Financeiro" },
          { title: "Mapear exposição contratual médica", owner: "Consultor Externo", phase: "Jurídico" }
        ],
        done: [
          { title: "Kickoff com advisors", owner: "Ciro Ribeiro", phase: "Planejamento" },
          { title: "Leitura preliminar das unidades", owner: "Arthur Bueno", phase: "Operacional" }
        ]
      },
      insights: [
        "Tema crítico está na integração operacional e no risco regulatório das unidades.",
        "Estrutura de contingências reduz materialmente o EV ajustado.",
        "Recomendação: seguir apenas com retenções robustas e plano de 100 dias disciplinado."
      ]
    },
    {
      id: "atlas-logistica",
      name: "Atlas Logística Frigorificada",
      companyCode: "AL",
      status: "Concluído",
      risk: "Baixo",
      progress: 100,
      startDate: "10 Fev 2026",
      deadline: "29 Mar 2026",
      enterpriseValue: 275000000,
      equityValue: 188000000,
      adjustedEnterpriseValue: 269000000,
      adjustedEquityValue: 182000000,
      adjustedEbitda: 41800000,
      team: ["Bruna Cristina", "Gabriela Reis", "Arthur Bueno"],
      tags: ["Logística", "Aquisição", "Mercosul"],
      sector: "Logística",
      transaction: "Aquisição",
      geography: "Mercosul",
      summary: "Aquisição com diligência concluída e risco residual baixo, concentrado em contratos cíveis e eficiência de malha.",
      areaRisks: [
        { area: "Financeiro", score: 38, severity: "Baixo", note: "QoE concluída sem ajustes materiais adicionais." },
        { area: "Jurídico", score: 42, severity: "Baixo", note: "Contratos revisados com poucos pontos de atenção." },
        { area: "Fiscal", score: 35, severity: "Baixo", note: "Compliance tributário regular." },
        { area: "Operacional", score: 44, severity: "Baixo", note: "Melhoria de ocupação de frota como upside, não red flag." },
        { area: "ESG", score: 29, severity: "Baixo", note: "Boas práticas de governança e segurança já implementadas." }
      ],
      phases: [
        { name: "Planejamento", progress: 100, owner: "Bruna Cristina" },
        { name: "Coleta de dados", progress: 100, owner: "Gabriela Reis" },
        { name: "Análise por área", progress: 100, owner: "Arthur Bueno" },
        { name: "Comitê / recomendações", progress: 100, owner: "Ciro Ribeiro" }
      ],
      contingencies: [
        { title: "Discussão cível com operador regional", type: "Cível", area: "Jurídico", value: 1100000, probability: "Remota", impact: "Baixo", status: "Resolvida", owner: "Gabriela Reis", updatedAt: "29 Mar 2026", x: 24, y: 28 },
        { title: "Renovação de licença ambiental", type: "Ambiental", area: "ESG", value: 800000, probability: "Possível", impact: "Baixo", status: "Mitigada", owner: "Arthur Bueno", updatedAt: "27 Mar 2026", x: 42, y: 36 }
      ],
      tasks: {
        todo: [
          { title: "Arquivar closing binder", owner: "Bruna Cristina", phase: "Fechamento" }
        ],
        doing: [],
        done: [
          { title: "Emitir relatório final de DD", owner: "Gabriela Reis", phase: "Comitê" },
          { title: "Aprovação de investment memo", owner: "Arthur Bueno", phase: "Comitê" }
        ]
      },
      insights: [
        "Projeto concluído com baixo nível de red flags e recomendação positiva.",
        "Risco residual está adequadamente mitigado para fechamento.",
        "Caso de referência para playbook de buy-side da Rito."
      ]
    }
  ];

  function diligenceProjects() {
    return DILIGENCE_PROJECTS;
  }

  function activeDiligenceProject() {
    const selectedId = state?.selectedProjectId?.diligence;
    return diligenceProjects().find((project) => project.id === selectedId) || diligenceProjects()[0];
  }

  function selectDiligenceProject(projectId) {
    if (!diligenceProjects().some((project) => project.id === projectId)) return;
    state.selectedProjectId.diligence = projectId;
    saveState();
    renderAppPreservingScroll(id);
  }

  function formatCurrencyBRL(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  const RITO_RITES_DATA = [
    { id: "cafe", number: "01", category: "Rede", title: "Café Sem Pauta", frequency: "Quinzenal", owner: "Arthur ou Ciro", summary: "Conversa com fundador sem deck e sem pauta rígida. O foco é ouvir, aprender e registrar a leitura do encontro no mesmo dia." },
    { id: "mesa", number: "02", category: "Rede", title: "Mesa do Centro-Oeste", frequency: "Trimestral", owner: "Arthur + Ciro", summary: "Jantar curado para fundadores, operadores e aliados estratégicos da região. A Rito define o tema, modera e faz a comunidade acontecer." },
    { id: "porteira", number: "03", category: "Rede", title: "Porteira Aberta", frequency: "Trimestral", owner: "Arthur ou Ciro", summary: "Visita de campo para mostrar uma operação real e tornar tangível a forma como a Rito pensa e trabalha." },
    { id: "alumni", number: "04", category: "Rede", title: "Jantar dos Alumni", frequency: "Semestral", owner: "Arthur + Ciro", summary: "Reunir fundadores com quem a Rito já se relacionou, inclusive os não investidos, para consolidar comunidade e reputação." },
    { id: "primeira-mesa", number: "05", category: "Construção", title: "A Primeira Mesa", frequency: "Por investida", owner: "Arthur", summary: "Jantar de passagem que marca o momento em que fundador e investidor deixam de ser contraparte e passam a ser sócios." },
    { id: "100-dias", number: "06", category: "Construção", title: "Os Primeiros 100 Dias", frequency: "Por investida", owner: "Arthur + equipe", summary: "Presença ativa na operação após o closing para construir confiança, gerar leitura real do negócio e criar vitórias rápidas." },
    { id: "carta", number: "07", category: "Comunicação", title: "A Carta", frequency: "Mensal", owner: "Arthur", summary: "Peça de conteúdo mais importante da Rito: direta, pessoal, sem jargão e sempre baseada em histórias reais e aprendizados honestos." },
    { id: "relatorio", number: "08", category: "Comunicação", title: "Relatório Centro-Oeste", frequency: "Anual", owner: "Equipe Rito", summary: "Documento autoral para consolidar tese, leitura regional e autoridade sobre o ecossistema do Centro-Oeste." },
    { id: "ic", number: "09", category: "Governança", title: "Comitê de Investimentos", frequency: "Mensal", owner: "IC completo", summary: "Momento formal para decidir com método, tese e transparência sobre os deals em andamento." },
    { id: "conselho", number: "10", category: "Governança", title: "Conselho Estratégico", frequency: "Trimestral", owner: "Conselho + Arthur", summary: "Trazer senioridade, provocação e visão externa para a Rito sem perder agilidade operacional." },
    { id: "evento", number: "11", category: "Lançamento", title: "A Primeira Mesa — O Evento", frequency: "Especial", owner: "Arthur + Ciro", summary: "Evento manifesto da Rito. Uma experiência de marca desenhada para mostrar a tese e a cultura da casa na prática." }
  ];

  const RITO_RITES_SCHEDULE = [
    ["Café Sem Pauta", "Quinzenal", "Variável", "Arthur ou Ciro", "Rede"],
    ["Mesa do Centro-Oeste", "Trimestral", "Mar, Jun, Set, Dez", "Arthur + Ciro", "Rede"],
    ["Porteira Aberta", "Trimestral", "Fev, Mai, Ago, Nov", "Arthur ou Ciro", "Rede"],
    ["Jantar dos Alumni", "Semestral", "Jun, Dez", "Arthur + Ciro", "Rede"],
    ["A Primeira Mesa", "Por investida", "Pós-signing", "Arthur", "Construção"],
    ["Primeiros 100 Dias", "Por investida", "Pós-closing", "Arthur + equipe", "Construção"],
    ["A Carta", "Mensal", "Dia 15", "Arthur", "Comunicação"],
    ["Relatório Centro-Oeste", "Anual", "Dezembro", "Equipe Rito", "Comunicação"],
    ["Comitê de Investimentos", "Mensal", "1ª sexta do mês", "IC completo", "Governança"],
    ["Conselho Estratégico", "Trimestral", "Mar, Jun, Set, Dez", "Conselho + Arthur", "Governança"],
    ["A Primeira Mesa — O Evento", "Especial", "Mai/Jun 2026", "Arthur + Ciro", "Lançamento"]
  ];

  const RITO_RITES_RULES = [
    "Ritual não se cancela. Se houver exceção, ela precisa ser justificada.",
    "Todo ritual precisa ter um dono claro.",
    "Todo ritual precisa ser registrado depois de acontecer.",
    "Rituais evoluem, mas não podem perder o propósito.",
    "Se virou obrigação sem significado, precisa ser redesenhado."
  ];

  let activeRitesSection = "overview";
  let activeRitesCategory = "all";
  let activeRitesQuery = "";
  let activeRitesFocusId = RITO_RITES_DATA[0]?.id || "";


  function workspaceLogoMarkup(workspaceId, variant = "default") {
    if (workspaceId === "fast") {
      return `
        <svg class="workspace-logo workspace-logo-fast workspace-logo-${variant}" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="3.6"/>
          <path d="M50 50 C43 35, 35 25, 24 23 C26 35, 33 45, 50 50" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M50 50 C57 35, 65 25, 76 23 C74 35, 67 45, 50 50" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M50 50 C43 65, 35 75, 24 77 C26 65, 33 55, 50 50" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M50 50 C57 65, 65 75, 76 77 C74 65, 67 55, 50 50" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M50 38 C46 31, 46 22, 50 15 C54 22, 54 31, 50 38" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M38 50 C31 46, 22 46, 15 50 C22 54, 31 54, 38 50" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M62 50 C69 46, 78 46, 85 50 C78 54, 69 54, 62 50" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M50 62 C46 69, 46 78, 50 85 C54 78, 54 69, 50 62" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
    }
    if (workspaceId === "atica") {
      return `
        <svg class="workspace-logo workspace-logo-atica workspace-logo-${variant}" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="23" r="7" fill="currentColor"/>
          <path d="M18 38 L18 66 L29 84 L71 84 L82 66 L82 38 L63 47 L50 38 L37 47 Z" fill="currentColor"/>
          <rect x="30" y="89" width="40" height="7" fill="currentColor"/>
        </svg>
      `;
    }
    return `
      <span class="workspace-logo-stack workspace-logo-rito workspace-logo-${variant}" aria-hidden="true">
        <img class="workspace-logo-rito-image" src="./Logo-Rito-Dark.png" alt="" onerror="this.onerror=null;this.src='./Logo-Rito-Dark.png';">
      </span>
    `;
  }

  function orderedWorkspaceIds() {
    const allIds = Object.keys(workspaceConfig);
    const stored = Array.isArray(state.workspaceOrder) ? state.workspaceOrder.filter((id) => allIds.includes(id)) : [];
    const missing = allIds.filter((id) => !stored.includes(id));
    return [...stored, ...missing];
  }

  function orderedWorkspaces() {
    return orderedWorkspaceIds().map((id) => workspaceConfig[id]).filter(Boolean);
  }

  function reorderWorkspaces(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const order = orderedWorkspaceIds();
    const draggedIndex = order.indexOf(draggedId);
    const targetIndex = order.indexOf(targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    order.splice(draggedIndex, 1);
    order.splice(targetIndex, 0, draggedId);
    state.workspaceOrder = order;
    saveState();
    renderApp();
  }

  async function reorderCRMItems(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const rollbackState = clonePortalState(state);
    const items = [...(workspaceData().crmItems || [])];
    const draggedIndex = items.findIndex((item) => item.id === draggedId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const [draggedItem] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);
    normalizeCRMItemOrder(items);
    state.workspaces[state.currentWorkspace].crmItems = items;
    stampPortalState(state);
    saveLocalPortalState(state);
    renderApp();
    try {
      await persistCRMOrderToDatabase(items, {
        workspaceId: state.currentWorkspace
      });
      renderApp();
    } catch (error) {
      console.error("[crm-save] Falha ao reordenar deals", {
        workspaceId: state.currentWorkspace,
        draggedId,
        targetId,
        message: error?.message || String(error),
        details: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || null
      });
      state = buildPortalState(rollbackState);
      renderApp();
      alert("Não foi possível salvar a nova ordem dos deals no banco de dados. A ordem anterior foi restaurada.");
    }
  }

  function wireDealReorderInteractions(node, dealId, {
    dropTargetSelector,
    onOpen
  } = {}) {
    if (!node || !dealId || !dropTargetSelector) return;
    node.draggable = true;
    node.dataset.crmId = dealId;
    node.classList.add("is-reorderable-deal");

    const interactiveSelectors = [
      "input",
      "select",
      "textarea",
      "button",
      "a",
      "[contenteditable='true']",
      "[data-no-drag]"
    ];

    node.querySelectorAll(interactiveSelectors.join(",")).forEach((element) => {
      ["click", "mousedown", "mouseup", "touchstart", "touchend"].forEach((eventName) => {
        element.addEventListener(eventName, (event) => event.stopPropagation());
      });
    });

    node.querySelectorAll("img").forEach((image) => {
      image.draggable = false;
    });

    node.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dealId);
      node.classList.add("is-dragging");
      node.dataset.justDragged = "0";
    });

    node.addEventListener("dragend", () => {
      node.classList.remove("is-dragging");
      node.dataset.justDragged = "1";
      document.querySelectorAll(dropTargetSelector).forEach((targetNode) => targetNode.classList.remove("is-drop-target"));
      window.setTimeout(() => {
        node.dataset.justDragged = "0";
      }, 60);
    });

    node.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll(dropTargetSelector).forEach((targetNode) => {
        if (targetNode !== node) targetNode.classList.remove("is-drop-target");
      });
      node.classList.add("is-drop-target");
    });

    node.addEventListener("dragleave", () => {
      node.classList.remove("is-drop-target");
    });

    node.addEventListener("drop", (event) => {
      event.preventDefault();
      node.classList.remove("is-drop-target");
      void reorderCRMItems(event.dataTransfer.getData("text/plain"), dealId);
    });

    if (typeof onOpen === "function") {
      node.addEventListener("click", () => {
        if (node.dataset.justDragged === "1") return;
        onOpen();
      });
    }
  }

  const ritoDashboardRows = [
    { company: "Ibi Liv", segment: "natalia@ope.com.br", contact: "(62) 99174-0717", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "IL" },
    { company: "Centro de Treinamento Marcio Goncalves", segment: "Fitness", contact: "(62) 98179-0909", stage: "Declinado", temp: "Frio", owner: "Arthur Bueno", close: "-", initials: "MG" },
    { company: "Manakai Goiania", segment: "manakaipraia@gmail.com", contact: "(62) 98122-8048", stage: "Declinado", temp: "Frio", owner: "Arthur Bueno", close: "-", initials: "MK" },
    { company: "EPIC", segment: "Startup", contact: "-", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "EP" },
    { company: "Verse Skincare", segment: "Cosmeticos", contact: "-", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "VS" },
    { company: "YellotMob", segment: "Energia / Software", contact: "-", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "YM" },
    { company: "Omni Internet", segment: "Telecom", contact: "-", stage: "Portfólio", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "OI" },
    { company: "Verde Brasil", segment: "Agro / Carbono", contact: "-", stage: "Declinado", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "VB" }
  ];

  const ritoPipelineCards = [
    { name: "Ibi Liv", subtitle: "Saude & Bem-estar - Aparecida de Goiania - GO - 2025", status: "Pipeline", cover: defaultCover("Ibi Liv", "#f6f1eb", "#f0d9cf"), logoText: "IL", logoBg: "#f5eadf", tags: ["Private Equity", "Pipeline", "Saude & Bem-estar", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#9f6d2b" },
    { name: "Centro de Treinamento Marcio Goncalves", subtitle: "Fitness - Goiania - GO - 2023", status: "Declinado", cover: defaultCover("CTMG", "#1f1e1e", "#3a2823"), logoText: "MG", logoBg: "#f0e2d7", tags: ["Private Equity", "Declinado", "Fitness", "Frio"], owner: "Arthur Bueno", accent: "#a04f22" },
    { name: "Manakai Goiania", subtitle: "Fitness - Goiania - GO - 2016", status: "Declinado", cover: defaultCover("Manakai", "#13311f", "#1e4c31"), logoText: "MK", logoBg: "#ffffff", tags: ["Private Equity", "Declinado", "Fitness", "Frio"], owner: "Arthur Bueno", accent: "#c69a2c" },
    { name: "EPIC", subtitle: "Startup - 2026", status: "Pipeline", cover: defaultCover("EPIC", "#ffffff", "#f5f5f5"), logoText: "EP", logoBg: "#ffffff", tags: ["Private Equity", "Pipeline", "Startup", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#f28f7b" },
    { name: "Verse Skincare", subtitle: "Cosmeticos - Goiania - GO - 2023", status: "Pipeline", cover: defaultCover("VERSE", "#ffffff", "#fafafa"), logoText: "VS", logoBg: "#ffffff", tags: ["Private Equity", "Pipeline", "Cosmeticos", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#f2a7c6" },
    { name: "YellotMob", subtitle: "Energia / Software - Goiania - GO - 2022", status: "Pipeline", cover: defaultCover("Yellot", "#ffffff", "#f8f7ff"), logoText: "YM", logoBg: "#ffffff", tags: ["Private Equity", "Pipeline", "Energia / Software", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#8bc34a" },
    { name: "Omni Internet", subtitle: "Telecom", status: "Portfólio", cover: defaultCover("omni", "#ffffff", "#fbfbfb"), logoText: "OI", logoBg: "#ffffff", tags: ["Private Equity", "Portfólio", "Telecom", "Investido", "Morno"], owner: "Arthur Bueno", accent: "#77d7ef" },
    { name: "Verde Brasil", subtitle: "Agro / Carbono - Rio Branco - AC - 2020", status: "Declinado", cover: defaultCover("Verde", "#ffffff", "#f7fbf7"), logoText: "VB", logoBg: "#ffffff", tags: ["Private Equity", "Declinado", "Agro / Carbono", "Morno"], owner: "Arthur Bueno", accent: "#7bc96f" },
    { name: "Formula CRM", subtitle: "Software - Caldas Novas - GO - 2024", status: "Portfólio", cover: defaultCover("Formula CRM", "#ffffff", "#f8fbff"), logoText: "FC", logoBg: "#ffffff", tags: ["Venture Capital", "Portfólio", "Software", "Investido", "Morno"], owner: "Arthur Bueno", accent: "#7b7de6" },
    { name: "UFC Jiu Jitsu", subtitle: "Fitness - Miami - Florida - 2025", status: "Portfólio", cover: defaultCover("UFC Jiu Jitsu", "#ffffff", "#fff8f5"), logoText: "UJ", logoBg: "#ffffff", tags: ["Private Equity", "Fitness", "Investido", "Morno"], owner: "Arthur Bueno", accent: "#ef5d4d" },
    { name: "UFC Gym & UFC Fit", subtitle: "Fitness - Miami - Florida - 2025", status: "LOI", cover: defaultCover("UFC FIT", "#ffffff", "#fff8f5"), logoText: "UG", logoBg: "#ffffff", tags: ["Private Equity", "LOI", "Fitness", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#ef6e4d" },
    { name: "Fast Massagem", subtitle: "Franquias / Wellness - Goiania - GO - 2023", status: "Portfólio", cover: defaultCover("FAST", "#32472f", "#2e3f2f"), logoText: "FM", logoBg: "#ffffff", tags: ["Private Equity", "Due Diligence", "Franquias / Wellness", "Investido"], owner: "Arthur Bueno", accent: "#9c8b62" }
  ];

  const ritoDocumentCards = [
    {
      icon: "PDF",
      title: "Brand Book",
      tags: ["Marketing", "branding", "brand book"],
      
      description: "Brand Book oficial da Rito Ventures.",
      meta: "437 KB - 10/03/2026",
      filePath: ""
    },
    {
      icon: "PPT",
      title: "Modelo de Apresentacao 1",
      tags: ["Marketing", "branding", "apresentacao", "ppt"],
      description: "Template institucional de apresentacao da Rito Ventures.",
      meta: "487 KB - 10/03/2026",
      filePath: ""
    },
    {
      icon: "PPT",
      title: "Modelo de Apresentacao 2",
      tags: ["Marketing", "branding", "apresentacao", "ppt"],
      description: "Segundo template institucional de apresentacao da Rito Ventures.",
      meta: "110 KB - 10/03/2026",
      filePath: ""
    },
    {
      icon: "HTML",
      title: "Assinatura de Email",
      tags: ["Marketing", "branding", "email", "assinatura"],
      description: "HTML oficial da assinatura de email da Rito Ventures.",
      meta: "36 KB - 09/03/2026",
      filePath: ""
    },
    {
      icon: "DOC",
      title: "Papel Timbrado",
      tags: ["Marketing", "branding", "papel timbrado", "doc"],
      description: "Modelo oficial de papel timbrado da Rito Ventures.",
      meta: "73 KB - 10/03/2026",
      filePath: ""
    }
  ];

  const ritoMembersList = [
    { initials: "AB", color: "#44406c", name: "Arthur Bueno", info: "arthur@ritoventures.com.br - CEO/Socio", tags: ["Admin", "Rito", "Fast", "Atica"] },
    { initials: "CR", color: "#7d4b44", name: "Ciro Ribeiro", info: "ciro@ritoventures.com.br - Socio", tags: ["Admin", "Rito", "Fast"] },
    { initials: "GR", color: "#465b4d", name: "Gabriela Reis", info: "Sell Side", tags: ["Gestor", "Rito", "Atica"] },
    { initials: "MM", color: "#774f4b", name: "Mayra Morais", info: "-", tags: ["Usuario", "Fast"] },
    { initials: "EP", color: "#706247", name: "Eduardo Pacheco", info: "-", tags: ["Usuario", "Fast"] },
    { initials: "R", color: "#774f4b", name: "Rodrigo", info: "-", tags: ["Usuario", "Fast"] },
    { initials: "BC", color: "#465b4d", name: "Bruna Cristina", info: "bruna.santos@ritoventures.com.br - Buy-Side", tags: ["Usuario", "Rito"] }
  ];

  function defaultPortalMembers() {
    const seededMembers = ritoMembersList.map((member) => {
      const [email = "", role = ""] = String(member.info || "").split(" - ");
      return {
        name: member.name,
        role: role.trim(),
        email: email.includes("@") ? email.trim() : "",
        tags: Array.isArray(member.tags) ? member.tags : [],
        color: member.color || memberColor(member.name),
        photo: defaultMemberPhoto(member.name) || ""
      };
    });
    const configuredMembers = Object.values(workspaceConfig || {}).flatMap((workspace) =>
      (Array.isArray(workspace?.memberOptions) ? workspace.memberOptions : []).map((name) => ({
        name,
        role: "",
        email: "",
        tags: [workspaceDisplayName(workspace.id || "")].filter(Boolean),
        color: memberColor(name),
        photo: defaultMemberPhoto(name) || ""
      }))
    );
    return dedupeMembersByName([...seededMembers, ...configuredMembers]);
  }

  function collectPortalMembers(rootState = state) {
    if (!rootState || typeof rootState !== "object") return [];
    const shared = Array.isArray(rootState.sharedMembers) ? rootState.sharedMembers : [];
    const workspaceMembers = Object.values(rootState.workspaces || {}).flatMap((workspace) =>
      Array.isArray(workspace?.members) ? workspace.members : []
    );
    return dedupeMembersByName([...shared, ...workspaceMembers]);
  }

  function hasPortalMembers(rootState = state) {
    return collectPortalMembers(rootState).length > 0;
  }

  function mergePortalMembersFromFallback(primarySnapshot = null, fallbackSnapshot = null) {
    const primary = unwrapPortalSnapshot(primarySnapshot);
    const fallback = unwrapPortalSnapshot(fallbackSnapshot);
    if (!primary || typeof primary !== "object") return primarySnapshot;
    if (hasPortalMembers(primary)) return primarySnapshot;
    const fallbackMembers = collectPortalMembers(fallback);
    if (!fallbackMembers.length) return primarySnapshot;
    primary.sharedMembers = fallbackMembers;
    return primarySnapshot;
  }

  function memberColor(name) {
    const palette = ["#44406c", "#7d4b44", "#465b4d", "#774f4b", "#706247", "#446170", "#546146"];
    const value = String(name || "").split("").reduce((total, char) => total + char.charCodeAt(0), 0);
    return palette[value % palette.length];
  }

  function mergeMemberRecords(previous = {}, next = {}) {
    const fallbackName = String(next.name || previous.name || "").trim();
    return {
      ...previous,
      ...next,
      name: fallbackName,
      role: String(next.role || previous.role || "").trim(),
      email: String(next.email || previous.email || "").trim(),
      tags: [...new Set([...(Array.isArray(previous.tags) ? previous.tags : []), ...(Array.isArray(next.tags) ? next.tags : [])].filter(Boolean))],
      color: next.color || previous.color || memberColor(fallbackName),
      photo: next.photo || previous.photo || ""
    };
  }

  function dedupeMembersByName(members = []) {
    const mergedMembers = [];
    const memberIndexByName = new Map();
    (members || []).forEach((member) => {
      if (!member || typeof member !== "object") return;
      const memberName = String(member.name || "").trim();
      if (!memberName) return;
      const key = normalizeMemberLookupName(memberName);
      if (!memberIndexByName.has(key)) {
        memberIndexByName.set(key, mergedMembers.length);
        mergedMembers.push(mergeMemberRecords({}, member));
        return;
      }
      const index = memberIndexByName.get(key);
      mergedMembers[index] = mergeMemberRecords(mergedMembers[index], member);
    });
    return mergedMembers;
  }

  function syncSharedMembersState(rootState = state) {
    if (!rootState || typeof rootState !== "object") return [];
    const workspaceMembers = Object.values(rootState.workspaces || {}).flatMap((workspace) =>
      Array.isArray(workspace?.members) ? workspace.members : []
    );
    const currentSharedMembers = Array.isArray(rootState.sharedMembers) ? rootState.sharedMembers : [];
    const recoveredMembers = dedupeMembersByName([...workspaceMembers, ...currentSharedMembers]);
    rootState.sharedMembers = recoveredMembers.length ? recoveredMembers : defaultPortalMembers();
    Object.values(rootState.workspaces || {}).forEach((workspace) => {
      if (workspace && typeof workspace === "object") workspace.members = [];
    });
    return rootState.sharedMembers;
  }

  function sharedMembersData(rootState = state) {
    return syncSharedMembersState(rootState);
  }

  function defaultMemberPhoto(name) {
    return normalizeMemberLookupName(name) === "arthur bueno" ? ARTHUR_BUENO_PHOTO : "";
  }

  function workspaceDisplayName(key) {
    if (key === "rito") return "Rito";
    if (key === "fast") return "Fast";
    if (key === "atica") return "Ática";
    return key;
  }

  function normalizeMemberLookupName(name) {
    const base = String(name || "")
      .split("/")[0]
      .trim()
      .toLowerCase();
    if (base === "arthur") return "arthur bueno";
    if (base === "ciro") return "ciro ribeiro";
    if (base === "mayra") return "mayra morais";
    if (base === "eduardo") return "eduardo pacheco";
    return base;
  }

  function findMemberByName(name) {
    if (!name) return null;
    const target = normalizeMemberLookupName(name);
    const matchesName = (memberName) => {
      const normalized = normalizeMemberLookupName(memberName);
      return normalized === target || normalized.startsWith(target) || target.startsWith(normalized);
    };
    const sharedMembers = sharedMembersData();
    const sharedPhotoMatch = sharedMembers.find((member) => matchesName(member.name) && member.photo);
    if (sharedPhotoMatch) return sharedPhotoMatch;
    const currentMembers = state?.workspaces?.[state.currentWorkspace]?.members || [];
    const currentPhotoMatch = currentMembers.find((member) => matchesName(member.name) && member.photo);
    if (currentPhotoMatch) return currentPhotoMatch;
    for (const workspace of Object.values(state?.workspaces || {})) {
      const members = workspace?.members || [];
      const match = members.find((member) => matchesName(member.name) && member.photo);
      if (match) return match;
    }
    const sharedMatch = sharedMembers.find((member) => matchesName(member.name));
    if (sharedMatch) return sharedMatch;
    const currentMatch = currentMembers.find((member) => matchesName(member.name));
    if (currentMatch) return currentMatch;
    for (const workspace of Object.values(state?.workspaces || {})) {
      const members = workspace?.members || [];
      const match = members.find((member) => matchesName(member.name));
      if (match) return match;
    }
    return null;
  }

  function renderOwnerAvatar(name, className = "owner-badge") {
    const member = findMemberByName(name);
    const photo = defaultMemberPhoto(name) || member?.photo || "";
    const label = initials(name || "");
    return `<span class="${className}${!label ? " is-empty" : ""}">${photo ? `<img src="${photo}" alt="${escapeAttr(displayText(name || "Responsável"))}" loading="lazy" decoding="async">` : label}</span>`;
  }

  function renderCompanyBadge({ name = "", logo = "", logoText = "", logoBg = "" } = {}) {
    const safeName = escapeAttr(displayText(name || "Empresa"));
    const fallback = logoText || initials(name || "");
    const resolvedBg = logo ? "#ffffff" : (logoBg || "#ffffff");
    return `<span class="company-badge" style="background:${resolvedBg}">${logo ? `<img src="${logo}" alt="${safeName}" loading="lazy" decoding="async">` : fallback}</span>`;
  }

  function memberCardData(member) {
    const tags = Array.isArray(member.tags) && member.tags.length ? member.tags : [workspaceDisplayName(state.currentWorkspace)];
    const infoParts = [member.email || "", member.role || ""].filter(Boolean);
    return {
      initials: initials(member.name),
      color: member.color || memberColor(member.name),
      photo: member.photo || "",
      name: member.name,
      info: displayText(infoParts.join(" - ") || "-"),
      tags
    };
  }

  function syncWorkspaceMemberOptions(rootState = state) {
    const memberNames = sharedMembersData(rootState).map((member) => member.name);
    Object.values(workspaceConfig).forEach((workspace) => {
      const defaultOptions = Array.isArray(workspace.memberOptions) ? workspace.memberOptions : [];
      workspace.memberOptions = [...new Set([...defaultOptions, ...memberNames].filter(Boolean))];
    });
  }

  function workspaceOwnerOptions(workspaceId = state.currentWorkspace, currentOwner = "") {
    const configuredOptions = Array.isArray(workspaceConfig[workspaceId]?.memberOptions)
      ? workspaceConfig[workspaceId].memberOptions
      : [];
    const sharedOptions = sharedMembersData().map((member) => member.name);
    return [...new Set([...configuredOptions, ...sharedOptions, String(currentOwner || "").trim()].filter(Boolean))];
  }

  function applyDefaultMemberPhotos(rootState) {
    (rootState?.sharedMembers || []).forEach((member) => {
      const defaultPhoto = defaultMemberPhoto(member.name);
      if (defaultPhoto) member.photo = defaultPhoto;
    });
    Object.values(rootState?.workspaces || {}).forEach((workspace) => {
      (workspace.members || []).forEach((member) => {
        const defaultPhoto = defaultMemberPhoto(member.name);
        if (defaultPhoto) member.photo = defaultPhoto;
      });
    });
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function defaultCover(text, colorA, colorB) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${colorA}" />
            <stop offset="100%" stop-color="${colorB}" />
          </linearGradient>
        </defs>
        <rect width="1200" height="600" fill="url(#g)" />
        <circle cx="160" cy="120" r="180" fill="rgba(255,255,255,0.12)" />
        <circle cx="1020" cy="520" r="220" fill="rgba(255,255,255,0.1)" />
        <text x="80" y="470" font-size="92" font-family="Inter, Arial, sans-serif" fill="white" font-weight="700">${text}</text>
      </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function defaultLogo(text, foreground = "#1c1c1c", background = "#ffffff", fontFamily = "Inter, Arial, sans-serif", fontSize = 64, fontWeight = 700) {
    const safeText = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180">
        <rect width="360" height="180" rx="32" fill="${background}" />
        <text x="180" y="102" text-anchor="middle" font-size="${fontSize}" font-family="${fontFamily}" fill="${foreground}" font-weight="${fontWeight}">${safeText}</text>
      </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function isGeneratedImageAsset(value) {
    return String(value || "").trim().toLowerCase().startsWith("data:image/svg+xml");
  }

  function ritoSubtitle(sector, location, year) {
    return [sector, location, year].filter(Boolean).join(" - ");
  }

  function normalizeRitoDealStatus(status, investmentStatus = "") {
    const value = String(status || "").trim();
    const normalized = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const map = {
      lead: "Lead",
      pipeline: "Pipeline",
      nda: "NDA",
      irl: "IRL",
      loi: "LOI",
      nbo: "NBO",
      proposta: "Proposta",
      "due diligence": "Due Diligence",
      signing: "Signing",
      closing: "Closing",
      aporte: "Aporte",
      portfolio: "Portfólio",
      portfolioo: "Portfólio",
      portfólio: "Portfólio",
      investidos: "Portfólio",
      invested: "Portfólio",
      declined: "Declinado",
      declinado: "Declinado",
      exit: "Exit"
    };
    if (map[normalized]) return map[normalized];
    if (!value && investmentStatus === "Investido") return "Portfólio";
    return value || "Lead";
  }

  function progressFromRitoDealStatus(status) {
    const normalized = normalizeRitoDealStatus(status);
    const progressMap = {
      Lead: 10,
      Pipeline: 20,
      NDA: 30,
      IRL: 40,
      LOI: 55,
      NBO: 65,
      Proposta: 75,
      "Due Diligence": 85,
      Signing: 95,
      Closing: 100,
      Aporte: 100,
      "Portfólio": 100,
      Declinado: 0,
      Exit: 100
    };
    return progressMap[normalized] ?? 0;
  }

  function temperatureFromRitoDealStatus(status) {
    const normalized = normalizeRitoDealStatus(status);
    if (normalized === "Lead") return "Frio";
    if (normalized === "Pipeline") return "Frio";
    if (["NDA", "IRL"].includes(normalized)) return "Morno";
    if (["LOI", "NBO", "Proposta"].includes(normalized)) return "Quente";
    if (["Due Diligence", "Signing", "Closing"].includes(normalized)) return "Fechamento";
    if (["Aporte", "Portfólio"].includes(normalized)) return "Investido";
    if (normalized === "Declinado") return "Declinado";
    if (normalized === "Exit") return "Exit";
    return "Frio";
  }

  function applyDealStatus(item, nextStatus) {
    const normalized = normalizeRitoDealStatus(nextStatus, item?.investmentStatus);
    item.status = normalized;
    item.progress = progressFromRitoDealStatus(normalized);
    item.temperature = temperatureFromRitoDealStatus(normalized);
    if (["Aporte", "Portfólio"].includes(normalized)) {
      item.investmentStatus = "Investido";
    } else if (normalized === "Exit") {
      item.investmentStatus = "Nao investido";
    } else if (normalized === "Declinado") {
      item.investmentStatus = "Nao investido";
    } else if (!["Aporte", "Portfólio"].includes(normalized)) {
      item.investmentStatus = "Nao investido";
    }
    syncInvestmentTag(item);
  }

  function bindDealStatusSelect(selectNode, item, rerender) {
    if (!selectNode || !item) return;
    const syncRowVisuals = () => {
      const row = selectNode.closest(".rito-table-row");
      const tempChip = row?.querySelector("[data-dashboard-temp-chip]");
      if (tempChip) {
        const nextTemp = temperatureFromRitoDealStatus(item.status);
        tempChip.textContent = displayText(nextTemp);
        tempChip.className = `chip chip-${String(nextTemp).toLowerCase()}`;
      }
    };
    ["pointerdown", "mousedown", "click", "touchstart"].forEach((eventName) => {
      selectNode.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });
    selectNode.addEventListener("change", (event) => {
      const nextStatus = String(event?.target?.value || "").trim();
      const currentStatus = normalizeRitoDealStatus(item.status, item.investmentStatus);
      if (!nextStatus || nextStatus === currentStatus) return;
      if (selectNode.dataset.statusSaving === "1") return;
      const previousSnapshot = {
        status: item.status,
        progress: item.progress,
        temperature: item.temperature,
        investmentStatus: item.investmentStatus,
        tags: Array.isArray(item.tags) ? [...item.tags] : [],
        updatedAt: item.updatedAt
      };
      selectNode.dataset.statusSaving = "1";
      applyDealStatus(item, nextStatus);
      item.updatedAt = new Date().toISOString();
      syncRowVisuals();
      saveState();
      void upsertCRMItem(item, {
          skipRender: true,
          renderOnSuccess: false
        })
        .then(() => {
          if (typeof rerender === "function") {
            window.setTimeout(() => rerender(), 0);
          }
        })
        .catch((error) => {
          item.status = previousSnapshot.status;
          item.progress = previousSnapshot.progress;
          item.temperature = previousSnapshot.temperature;
          item.investmentStatus = previousSnapshot.investmentStatus;
          item.tags = [...previousSnapshot.tags];
          item.updatedAt = previousSnapshot.updatedAt;
          syncInvestmentTag(item);
          syncRowVisuals();
          saveState();
          if (typeof rerender === "function") rerender();
          console.error("[crm-status] Falha ao persistir troca de estágio", {
            dealId: item?.id || null,
            dealName: item?.name || null,
            previousStatus: previousSnapshot.status,
            nextStatus,
            message: error?.message || String(error)
          });
        })
        .finally(() => {
          selectNode.dataset.statusSaving = "0";
        });
    });
  }

  function ritoStatusOptionsMarkup(selectedStatus) {
    const current = normalizeRitoDealStatus(selectedStatus);
    return RITO_DEAL_STATUS_OPTIONS
      .map((status) => `<option value="${escapeAttr(status)}" ${status === current ? "selected" : ""}>${status}</option>`)
      .join("");
  }

  function referenceStatusLabel(status, investmentStatus) {
    return normalizeRitoDealStatus(status, investmentStatus);
  }

  function isInvestedProjectRecord(item) {
    if (!item || Array.isArray(item) || typeof item !== "object") return false;
    const normalizedStatus = normalizeRitoDealStatus(item.status, item.investmentStatus);
    if (normalizedStatus === "Exit") return false;
    if (["Aporte", "Portfólio"].includes(normalizedStatus)) return true;
    return !String(item.status || "").trim() && String(item.investmentStatus || "").trim() === "Investido";
  }

  function isRitoDealInStage(item, stage) {
    return normalizeRitoDealStatus(item?.status, item?.investmentStatus) === normalizeRitoDealStatus(stage, item?.investmentStatus);
  }

  function referenceAccent(status, investmentStatus) {
    const normalized = normalizeRitoDealStatus(status, investmentStatus);
    if (["Aporte", "Portfólio"].includes(normalized) || (investmentStatus === "Investido" && normalized !== "Exit")) return "#77d7ef";
    if (normalized === "Exit") return "#1f8f6a";
    return {
      Pipeline: "#c69a10",
      NDA: "#4c88c8",
      IRL: "#6d86d8",
      LOI: "#7d5cf2",
      NBO: "#8a67d9",
      Proposta: "#c27a4d",
      LOI: "#7d5cf2",
      "Due Diligence": "#c4a26a",
      Signing: "#9b7e4f",
      Closing: "#2c9a72",
      Declinado: "#df8f86",
      Frio: "#5d7ff0",
      Morno: "#c4a26a",
      Quente: "#ef7a69"
    }[normalized] || "#a0a6b4";
  }

  const ritoReferenceProjects = [
    { name: "Geral / Braslar", sector: "Eletrodomesticos / Linha branca", location: "Ponta Grossa - PR", year: "2026", status: "Lead", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 0, owner: "Arthur Bueno", tags: ["Private Equity", "Industria", "Fogoes", "Cooktops", "Linha branca"], cover: "https://braslareletros.com.br/wp-content/uploads/2025/01/banner-paginas.jpg", logoText: "GB", logo: "https://braslareletros.com.br/wp-content/uploads/2025/01/logo-stick-1.png", logoBg: "transparent", description: "Lead ligado a marca Geral, historicamente associada a fogoes e aquecedores e atualmente operada pela Braslar. A Braslar atua em fogoes e eletrodomesticos, com linha de fogoes de piso, cooktops, freezers e itens de refrigeração com distribuição nacional.", framework: "Industria / Eletrodomesticos / Lead inicial", origin: "Internet / Feira", priority: "Media", website: "https://braslareletros.com.br/", contact: "(42) 3220-5650", email: "contato@braslareletros.com.br", businessModel: "Fabricacao e comercializacao de fogoes, cooktops, freezers e eletrodomesticos com cobertura nacional, representantes comerciais e rede de assistencia tecnica.", advantages: "Marca tradicional, certificacao INMETRO, estrutura de representantes em todo o territorio nacional, flexibilidade produtiva para lojistas e sistema facilitado de fretes.", competitors: "Atlas, Esmaltec, Itatiaia, Mueller e fabricantes regionais de fogoes e cooktops.", managementTeam: "Braslar do Brasil Ltda", fundraisingHistory: "Nao foi identificado historico publico recente de captacao por equity ou divida.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 04.016.420/0001-17; sede na Av. Continental, s/n, Distrito Industrial, Ponta Grossa - PR; fundada em 2000." },
    { name: "Fox Graos", sector: "Startup / Trade de Graos", location: "Goias - GO", year: "2026", status: "Lead", investmentStatus: "Nao investido", temperature: "Quente", estimatedValue: 20000000, owner: "Arthur Bueno", tags: ["Private Equity", "Startup", "Trade", "Agro", "Base tecnologica"], cover: defaultCover("Fox Graos", "#f8f5ed", "#eef6e7"), logoText: "FG", logo: defaultLogo("FOX GRAOS", "#4f5f2a", "#ffffff", "Inter, Arial, sans-serif", 42, 800), logoBg: "#ffffff", description: "Startup de trade de graos em Goias. Compra e vende com apoio de sistema proprio que analisa frete, imposto, distancia e melhor preco. Operacao asset light, com base tecnologica e sem capex relevante.", framework: "Trade agro / Base tecnologica / Lead inicial", origin: "Relacionamento", priority: "Alta", businessModel: "Entra insumo e sai grao, com arbitragem comercial apoiada por tecnologia proprietaria.", managementTeam: "Donalvan", revenues: "2024: R$ 40MM | 2025: R$ 97MM", fundraisingHistory: "Busca R$ 20MM em equity; nao quer endividamento. Considerou FIDC como alternativa.", advantages: "Resultados instantaneos, base tecnologica, atuacao regional focada em Goias e estrutura sem capex.", competitors: "Tradings regionais de graos e plataformas de originacao com inteligencia de frete e imposto.", vcPeBacked: "Nao", notes: "EBITDA de 3%. Caixa de giro citado: R$ 2MM em 30 dias. Nao ha projeto formal estruturado neste momento." },
    { name: "Bioativos & Liofilizacao", sector: "Industria de Bioativos e Liofilizacao", location: "Sao Paulo - SP", year: "2026", status: "Lead", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 0, owner: "Arthur Bueno", tags: ["Private Equity", "Industria", "Bioativos", "Liofilizacao"], cover: defaultCover("Bioativos & Liofilizacao", "#f4fbef", "#e4f2ff"), logoText: "BL", logo: defaultLogo("BL", "#2f7a45", "#ffffff", "Georgia, 'Times New Roman', serif", 72, 700), logoBg: "#ffffff", description: "Projeto de sociedade na industria de bioativos e liofilizacao, com base operacional em Sao Paulo e potencial de aplicacao em ingredientes, nutraceuticos e manufatura especializada.", framework: "Bioativos / Industria especializada / Lead inicial", origin: "Relacionamento", priority: "Media", businessModel: "Nao identificado publicamente. A tese interna sugere manufatura especializada de bioativos, ingredientes e processos de liofilizacao.", managementTeam: "Nao identificado publicamente", competitors: "Nexira, Duas Rodas, fabricantes de ingredientes funcionais, CDMOs e operadores de liofilizacao para nutraceuticos e farma.", advantages: "Tese potencialmente ligada a alto valor agregado, barreiras tecnicas de processo e aplicacoes em nutraceuticos, ingredientes e formulacoes especializadas.", fundraisingHistory: "Nao identificado publicamente", vcPeBacked: "Nao identificado publicamente", notes: "Nao foi encontrada na internet, ate esta revisao, uma correspondencia publica inequivoca para o nome exato do projeto. Os campos foram preenchidos apenas com a tese interna e observacao de ausencia de rastro publico seguro." },
    { name: "Adorei", sector: "Consumo / Marca", location: "", year: "2026", status: "Declinado", investmentStatus: "Nao investido", temperature: "Frio", estimatedValue: 0, owner: "Arthur Bueno", tags: ["Private Equity", "Consumo", "Marca"], cover: defaultCover("Adorei", "#fff7f1", "#f8ede6"), logoText: "AD", logo: defaultLogo("ADOREI", "#8f5b46", "#ffffff", "Inter, Arial, sans-serif", 54, 700), logoBg: "#ffffff", description: "Projeto Adorei adicionado ao pipeline da Rito Ventures com status declinado, a partir do material enviado em PDF.", framework: "Origem em material recebido / Revisao inicial / Projeto declinado", origin: "PDF recebido", priority: "Media", businessModel: "A preencher a partir do material original.", managementTeam: "A preencher", competitors: "A preencher", advantages: "A preencher", fundraisingHistory: "Nao avancou para investimento.", vcPeBacked: "Nao identificado", notes: "Projeto criado a partir do arquivo ADOREI.pdf enviado para analise. O status foi definido como declinado conforme orientacao." },
    { name: "Ibi Liv", sector: "Saude & Bem-estar", location: "Aparecida de Goiania - GO", year: "2025", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 4800000, owner: "Arthur Bueno", tags: ["Private Equity", "Saude & Bem-estar"], cover: defaultCover("Ibi Liv", "#f7f3f0", "#f0d7cc"), logoText: "IL", logo: defaultLogo("IL", "#9f6d2b", "#fff8f0", "Georgia, 'Times New Roman', serif", 74, 700), logoBg: "#f6ebdf", description: "Industria e comercio de suplementos, produtos a base de cafe e bebidas funcionais, com atuacao industrial e atacadista em Aparecida de Goiania.", website: "https://ibiliv.com", contact: "(62) 99174-0717", email: "natalia@ope.com.br", management: "Flavio Guimaraes Rocha; Theylor Angonese; RV7 Participacoes Ltda", managementTeam: "Flavio Guimaraes Rocha; Theylor Angonese; RV7 Participacoes Ltda", businessModel: "Fabricacao e distribuicao de suplementos, produtos a base de cafe, alimentos dieteticos e chas prontos para consumo.", competitors: "Growth Supplements, Max Titanium, Soldiers Nutrition e marcas de nutricao funcional.", advantages: "Portfolio combinado de cafe funcional e suplementacao, base industrial propria e combinacao de fabricacao com atacado.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 100 mil.", vcPeBacked: "Nao identificado publicamente", revenues: "Nao identificado publicamente", notes: "CNPJ 63.989.797/0001-11; aberta em 09/12/2025; sede no Polo Empresarial Goias - Etapa I, Aparecida de Goiania - GO; CNAEs incluem atacado de bebidas, produtos a base de cafe e alimentos dieteticos." },
    { name: "Centro de Treinamento Marcio Goncalves", sector: "Fitness", location: "Goiania - GO", year: "2023", status: "Declinado", investmentStatus: "Nao investido", temperature: "Frio", estimatedValue: 3200000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness"], cover: defaultCover("CTMG", "#231f1f", "#41312c"), logoText: "MG", logo: defaultLogo("MG", "#b16f2f", "#f6ebe0", "Georgia, 'Times New Roman', serif", 72, 700), logoBg: "#f1e2d6", description: "Centro de treinamento fisico em Goiania com operacao voltada a condicionamento, eventos esportivos, artigos esportivos e varejo complementar.", contact: "(61) 98282-8239", email: "marciogoncalves.ct@gmail.com", businessModel: "Prestacao de servicos de condicionamento fisico com monetizacao complementar via eventos, artigos esportivos e varejo alimentar especializado.", managementTeam: "Marcio Vieira Goncalves", competitors: "Academias boutique, studios de treinamento funcional e redes fitness locais.", advantages: "Fundador-operador, nicho esportivo, operacao enxuta e receita complementar fora da mensalidade.", fundraisingHistory: "Nao foi identificado historico publico de captacao; capital social registrado de R$ 50 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 49.826.809/0001-66; aberta em 06/03/2023; sede na Rua da Redencao, Jardim Vitoria, Goiania - GO; atividade principal CNAE 93.13-1-00." },
    { name: "Manakai Goiania", sector: "Fitness", location: "Goiania - GO", year: "2016", status: "Declinado", investmentStatus: "Nao investido", temperature: "Frio", estimatedValue: 2800000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness"], cover: defaultCover("Manakai", "#173724", "#274b35"), logoText: "MK", logo: defaultLogo("MK", "#202020", "#ffffff", "Georgia, 'Times New Roman', serif", 72, 700), logoBg: "#ffffff", description: "Arena fitness e esportiva em Goiania ligada a aulas, modalidades de areia e comunidade wellness, operada pela Manakai Sport Food.", website: "https://www.instagram.com/manakaioficial/", contact: "(62) 98122-8048", email: "manakaipraia@gmail.com", businessModel: "Monetizacao por ensino de esportes, uso de estrutura esportiva, eventos, alimentacao de apoio e ativacoes de comunidade.", managementTeam: "Felipe Antonio Fernandes Barbosa; Rafaela Vilela Machado Barbosa", competitors: "Arenas esportivas de areia, studios fitness boutique, beach tennis clubs e academias com proposta de comunidade.", advantages: "Marca local com comunidade ativa, multiplas unidades/filiais registradas e combinacao de esporte, lifestyle e consumo complementar.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 20 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 26.166.895/0001-22; aberta em 14/09/2016; matriz no Park Lozandes, Goiania - GO; ha registros publicos de filiais e de atuacao em ensino de esportes e condicionamento fisico." },
    { name: "EPIC", sector: "Imobiliario / Servicos", location: "Goiania - GO", year: "2025", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 3500000, owner: "Arthur Bueno", tags: ["Private Equity", "Imobiliario", "Servicos"], cover: defaultCover("EPIC", "#ffffff", "#f7f8ff"), logoText: "EP", logo: defaultLogo("EPIC", "#3f6ef3", "#ffffff", "Inter, Arial, sans-serif", 72, 800), logoBg: "#ffffff", description: "Empresa imobiliaria em Goiania com atuacao em corretagem, compra e venda, locacao e servicos complementares de real estate.", contact: "(34) 3183-6986", email: "Nao identificado publicamente", businessModel: "Corretagem na compra, venda e locacao de imoveis, com potencial de monetizacao por intermedicao, advisory e ativos proprios.", managementTeam: "ESG Solucoes Imobiliarias Ltda", competitors: "Imobiliarias e boutiques de real estate de Goiania, consultorias imobiliarias e brokers regionais.", advantages: "Capital social superior a operacoes muito iniciais, CNAEs complementares de compra, venda, aluguel e design de interiores.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 300 mil.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica mais aderente encontrada: Epic Real Estate, CNPJ 59.758.555/0001-40, aberta em 06/03/2025, sediada na Rua S1, 333, Setor Bela Vista, Goiania - GO." },
    { name: "Verse Skincare", sector: "Cosmeticos", location: "Goiania - GO", year: "2023", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 3900000, owner: "Arthur Bueno", tags: ["Private Equity", "Cosmeticos"], cover: "https://verseskincare.com.br/wp-content/uploads/2026/03/BANNER-HOME-FULL-SITE-CAMPANHA-DIA-DAS-MULHERES-VERSE.opti_.webp", logoText: "VS", logo: "https://verseskincare.com.br/wp-content/uploads/2025/07/logotipogrande-scaled.png", logoBg: "transparent", description: "Marca de skincare premium voltada a mulheres 40+, com proposta de combinar ciencia, tecnologia e autocuidado consciente em produtos de alta performance.", website: "https://verseskincare.com.br/", contact: "(62) 99937-0387", email: "contato@verseskincare.com.br", businessModel: "D2C digital em cosmeticos premium com venda online, comunidade proprietaria e foco em produto-hero de alto ticket e recorrencia.", managementTeam: "Bethania Simoes; Vanessa de Sa", competitors: "Adcos, Simple Organic, Sallve, Principia e marcas premium de skincare.", advantages: "Posicionamento claro para publico 40+, narrativa de marca forte, biopeptideos, nanotecnologia e prova social no produto principal.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional.", vcPeBacked: "Nao identificado publicamente", notes: "Operada por BS Comercio & Empreendimentos Ltda; endereco no Setor Oeste, Goiania - GO; produto principal exibido publicamente por R$ 359,00 na loja oficial." },
    { name: "YellotMob", sector: "Energia / Software", location: "Goiania - GO", year: "2022", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 5100000, owner: "Arthur Bueno", tags: ["Private Equity", "Energia / Software"], cover: "https://yellotmob.com.br/wp-content/uploads/2023/07/banner-home.jpg", logoText: "YM", logo: "https://yellotmob.com.br/wp-content/uploads/2023/07/yellomob.png", logoBg: "transparent", description: "Aplicativo e camada digital da Yellot para mobilidade eletrica, roteirizacao, recarga e monitoramento de uso em tempo real para usuarios de veiculos eletricos.", website: "https://yellotmob.com.br/", contact: "+55 (62) 3638-1006", email: "contato@yellot.com.br", businessModel: "Plataforma de software conectada ao ecossistema de energia renovavel e infraestrutura de recarga para veiculos eletricos.", managementTeam: "Yellot / Bouhid Brasil Engenharia Ltda", competitors: "Tupi Mobilidade, EZVolt, PlugShare e outras plataformas de recarga e discovery para mobilidade eletrica.", advantages: "Conexao com ecossistema energetico existente, app proprio, foco em autonomia do usuario e integracao com rede de abastecimento eletrico.", fundraisingHistory: "Nao foi identificado historico publico especifico da vertical YellotMob.", vcPeBacked: "Nao identificado publicamente", notes: "Aplicativo publicado no Google Play com mais de 10 mil downloads; sede da Yellot em Goiania no Ed. Flamboyant Park Business." },
    { name: "Omni Internet", sector: "Telecom", location: "Caldas Novas - GO", year: "2007", status: "Pipeline", investmentStatus: "Investido", investmentAmount: 3500000, temperature: "Morno", estimatedValue: 12000000, owner: "Arthur Bueno", tags: ["Private Equity", "Telecom"], cover: defaultCover("omni", "#ffffff", "#fbfbfb"), logoText: "OI", logo: defaultLogo("omni", "#6f49df", "#ffffff", "Inter, Arial, sans-serif", 68, 800), logoBg: "#ffffff", description: "Provedor regional de internet e telecom em Caldas Novas com base recorrente de assinantes e tese de consolidacao de fibra.", contact: "(64) 3513-9200", email: "contato@omni.net.br", businessModel: "Receita recorrente via servicos de comunicacao multimidia, acesso a internet e infraestrutura regional de conectividade.", managementTeam: "Omni Telecomunicacoes Ltda", competitors: "Provedores regionais de fibra, operadoras locais e ISPs com tese de consolidacao no Centro-Oeste.", advantages: "Base regional recorrente, pioneirismo local em fibra segundo listings publicos e tese de consolidacao de provedores menores.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 120 mil.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica mais aderente: Omni Telecomunicacoes Ltda, CNPJ 09.238.990/0001-75, aberta em 06/12/2007 em Caldas Novas - GO. Situacao cadastral publica recente apareceu como suspensa em cadastro empresarial; validar status operacional em diligencia.", progress: 100 },
    { name: "Verde Brasil", sector: "Agro / Carbono", location: "Rio Branco - AC", year: "2022", status: "Declinado", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 4400000, owner: "Arthur Bueno", tags: ["Private Equity", "Agro / Carbono"], cover: "https://verdebrasil.com/wp-content/uploads/2024/03/Projeto-REDD-Tarauaca-VERDE-BRASIL_FLORA_CLEITON-LOPES_@cleiton-3-1-1024x529.png", logoText: "VB", logo: "https://verdebrasil.com/wp-content/uploads/2024/03/Logo-VB-completo.svg", logoBg: "transparent", description: "Empresa focada em preservacao florestal e creditos de carbono no Acre, com projeto REDD+ Tarauaca e tese de ativos ambientais.", website: "https://verdebrasil.com/", contact: "(68) 2102-3606", email: "contato@verdebrasil.com", businessModel: "Gestao de ativos ambientais e imobiliarios ligados a preservacao, desenvolvimento de projetos de credito de carbono e iniciativas socioambientais na Amazonia.", managementTeam: "Verde Brasil Sustentabilidade e Negocios Imobiliarios S.A.", competitors: "Moss Earth, Systemica, Carbonext e desenvolvedores de projetos REDD+ e ativos florestais no Brasil.", advantages: "Atuacao em area relevante no Acre, narrativa ESG clara, projeto REDD+ em andamento e capital social superior ao de operacoes muito iniciais.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 3,34 milhoes.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 47.132.346/0001-07; aberta em 13/07/2022; sede na Avenida Ceara, 3258, Rio Branco - AC; site publico informa atuacao no Acre e sul do Amazonas com o projeto REDD+ Tarauaca." },
    { name: "Formula CRM", sector: "Software", location: "Caldas Novas - GO", year: "2024", status: "Pipeline", investmentStatus: "Investido", investmentAmount: 2000000, temperature: "Morno", estimatedValue: 8600000, owner: "Arthur Bueno", tags: ["Venture Capital", "Software"], cover: "https://formulacrm.com.br/wp-content/uploads/2024/07/PAINEL-DE-ATENDIMENTO.webp", logoText: "FC", logo: "https://formulacrm.com.br/wp-content/uploads/2024/07/LOGO-PR-scaled.webp", logoBg: "transparent", description: "Plataforma de CRM e atendimento para WhatsApp com automacao, chatbot e inteligencia artificial para centralizar operacoes de atendimento e campanhas.", website: "https://formulacrm.com.br/", contact: "(64) 99201-8458", email: "hi@formulacrm.com.br", businessModel: "SaaS de atendimento e automacao comercial com receita recorrente, onboarding remoto e foco em canais conversacionais.", managementTeam: "Thiago Hernanne da Silva e Sousa; Daniel de Mendonca Silveira", competitors: "Kommo, RD Station CRM, PipeRun, HubSpot e plataformas de atendimento no WhatsApp.", advantages: "Proposta clara de centralizacao e automacao com IA, tese de reducao de custo de atendimento e base em canal de alta adocao no Brasil.", fundraisingHistory: "Nao foi identificado historico publico de captacao; capital social registrado de R$ 50 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 53.214.179/0001-46; aberta em 15/12/2023; CNAE principal 6202-3/00; sede em Caldas Novas - GO.", progress: 100 },
    { name: "UFC Jiu Jitsu", sector: "Fitness / Grappling", location: "Las Vegas - Nevada", year: "2025", status: "Pipeline", investmentStatus: "Investido", investmentAmount: 0, temperature: "Morno", estimatedValue: 6200000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness", "Grappling", "Investido"], cover: "https://ufc.com/images/styles/390x500_1/s3/2026-03/11505409162_BJJ7_TXT_ON_SALE_1920x1080_TEXTLESS.jpg", logoText: "UJ", logo: defaultLogo("UFC JIU JITSU", "#cb1d1d", "#ffffff", "Inter, Arial, sans-serif", 36, 800), logoBg: "transparent", description: "Vertical oficial de grappling da UFC, lancada em 2025 sob a marca UFC BJJ, com eventos, conteudo proprietario e potencial de expansao comercial da modalidade.", website: "https://www.ufc.com/ufcbjj", contact: "Nao identificado publicamente", email: "Nao identificado publicamente", businessModel: "Monetizacao por eventos, transmissao, conteudo, patrocinios e expansao de propriedade intelectual em submission grappling.", managementTeam: "UFC / TKO Group Holdings; Claudia Gadelha (estrategia e desenvolvimento de negocio do UFC BJJ)", competitors: "ADCC, IBJJF, ONE Championship grappling e promotores de submission grappling.", advantages: "Marca UFC, distribuicao global, capacidade de midia, propriedade intelectual forte e integracao com ecossistema de combate e entretenimento.", fundraisingHistory: "Nao aplicavel como vertical propria de grupo ja estabelecido; nao foi identificado processo publico de captacao separado para UFC BJJ.", vcPeBacked: "Pertence ao ecossistema UFC / TKO, nao a uma startup independente", notes: "Referencia publica usada: lancamento oficial do UFC BJJ em 2025 e pagina institucional da vertical. A localizacao foi ajustada para Las Vegas pelo polo operacional do UFC BJJ no UFC APEX, nao Miami." },
    { name: "UFC Gym & UFC Fit", sector: "Fitness", location: "Miami - Florida", year: "2025", status: "LOI", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 7400000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness"], cover: "https://www.ufcgym.com/images/homepage/Ufc_Gym.webp", logoText: "UG", logo: "https://www.ufcgym.com/images/ufc-gym-logo-black.svg", logoBg: "transparent", description: "Tese ligada a rede global UFC GYM / UFC FIT, plataforma de academias e fitness inspirado em artes marciais com mais de 150 unidades em dezenas de paises.", website: "https://www.ufcgym.com/", contact: "+1 (305) 680-5990", email: "nush.chalmers@ufcgym.com", businessModel: "Rede fitness com mensalidade recorrente, personal training, lutas, recuperacao, retail e servicos premium em diferentes formatos de clube.", managementTeam: "UFC GYM corporate team", competitors: "LA Fitness, Orangetheory, Equinox, Crunch, studios boutique e academias MMA-inspired.", advantages: "Marca global forte, modelo multiformato, combinacao de fitness, artes marciais, recovery e personal training, presenca internacional e capacidade de franquia.", fundraisingHistory: "Nao foi identificado historico publico de captacao recente especifico desta unidade/tese; a rede comunica expansao internacional e mais de 150 localizacoes.", vcPeBacked: "Nao identificado publicamente", notes: "Fonte publica oficial usada como referencia: unidade Kendall Miami; amenidades incluem bag room, BJJ, personal training, turf e recovery." },
    { name: "Fast Massagem", sector: "Franquias / Wellness", location: "Goiania - GO", year: "2023", status: "Due Diligence", investmentStatus: "Investido", investmentAmount: 1500000, temperature: "Morno", estimatedValue: 9500000, owner: "Arthur Bueno", tags: ["Private Equity", "Franquias / Wellness"], cover: "https://www.fastmassagem.com.br/wp-content/uploads/2024/05/thumb.png", logoText: "FM", logo: "https://www.fastmassagem.com.br/wp-content/uploads/2024/05/logo-scaled-1-2048x742.webp", logoBg: "transparent", description: "Rede de massagem estetica e bem-estar com operacao sem hora marcada, protocolos proprios e tese de expansao via franquias.", website: "https://www.fastmassagem.com.br/", contact: "(62) 99663-1244", email: "contato@fastmassagem.com.br", businessModel: "Rede de servicos de bem-estar com monetizacao em sessoes avulsas, pacotes, home care e franquias em diferentes formatos.", managementTeam: "Maira Moraes; Eduardo Pacheco", competitors: "Sorriso, spas urbanos, redes de estetica e franquias de massagem e drenagem.", advantages: "Modelo sem hora marcada, marca propria de produtos, suporte de franqueadora, forte componente comercial e tese asset-light de expansao.", fundraisingHistory: "Franquia anuncia investimento inicial a partir de R$ 99 mil e materiais publicos citam faturamento alvo anual de ate R$ 2,4 milhoes por unidade, margem de 30% a 35% e payback entre 12 e 18 meses.", vcPeBacked: "Nao identificado publicamente", notes: "Operacao publica em Goiania; paginas de franquia citam mais de 12 unidades e expansao acelerada.", progress: 60 },
    { name: "Enebra Energia", sector: "Energia", location: "Anapolis - GO", year: "2019", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 5400000, owner: "Arthur Bueno", tags: ["Private Equity", "Energia"], cover: "https://enebra.com.br/wp-content/uploads/2022/02/forest-trees-5073.png", logoText: "EN", logo: "https://enebra.com.br/wp-content/uploads/2021/12/logo-enebra-copy-4.png", logoBg: "transparent", description: "Fornecedor verticalizado de biomassa de eucalipto, lenha e cavaco, com operacao em plantio, colheita, processamento, transporte e estocagem para clientes industriais.", website: "https://enebra.com.br/", contact: "(62) 3702-7492", email: "administrativo@enebra.com.br", businessModel: "Fornecimento de biomassa e servicos florestais full service, com contratos industriais e operacao verticalizada em florestas proprias ou terceirizadas.", managementTeam: "Enebra Brasil Energia", competitors: "Fornecedores regionais de biomassa, lenha industrial, cavaco e operadores florestais integrados.", advantages: "Estrutura verticalizada, legalidade auditada, operacao ESG, capacidade propria de colheita, transporte e abastecimento continuo de clientes.", fundraisingHistory: "Nao foi identificado historico publico recente de captacao institucional.", vcPeBacked: "Nao identificado publicamente", notes: "Site institucional destaca unidades em Goias, Mato Grosso e Mato Grosso do Sul; foco em biomassa para industrias e projetos build-to-suit." },
    { name: "Caseratto", sector: "Food & Beverage", location: "Goiania - GO", year: "2015", status: "Declinado", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 2600000, owner: "Arthur Bueno", tags: ["Private Equity", "Food & Beverage"], cover: defaultCover("Caseratto", "#ffffff", "#fff8f2"), logoText: "CS", logo: defaultLogo("CASERATTO", "#8a4a2d", "#ffffff", "Inter, Arial, sans-serif", 42, 700), logoBg: "#ffffff", description: "Operacao de gastronomia em Goiania ligada a restaurante, producao alimentar e expansao local por filiais.", contact: "(62) 3241-4070", email: "Nao identificado publicamente", businessModel: "Receita de restaurante e alimentacao com possibilidade de extensao para producao propria, eventos e desdobramentos de marca local.", managementTeam: "Rafael Damaso Mendonca; Tales Garcia Araujo", competitors: "Restaurantes premium de Goiania, operacoes autorais locais e grupos de food service regionais.", advantages: "Marca local conhecida, estrutura societaria ativa, historico com matriz e filial e operacao centrada em bairro de alta renda.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 50 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 22.068.490/0001-09; aberta em 16/03/2015 no Setor Marista, Goiania - GO; atividade principal de restaurantes e similares." },
    { name: "Winsford", sector: "Educacao", location: "Goiania - GO", year: "2021", status: "Declinado", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 2300000, owner: "Arthur Bueno", tags: ["Private Equity", "Educacao"], cover: defaultCover("Winsford", "#ffffff", "#fbfaf7"), logoText: "WF", logo: defaultLogo("WINSFORD", "#7a6f37", "#ffffff", "Inter, Arial, sans-serif", 42, 700), logoBg: "#ffffff", description: "Escola particular em Goiania com oferta de educacao infantil, ensino fundamental, medio e idiomas, sob a marca Winsford Global Education.", contact: "(62) 4101-9388", email: "Nao identificado publicamente", businessModel: "Receita educacional recorrente com mensalidades escolares e servicos complementares de idiomas, cantina e materiais.", managementTeam: "Roberto Wagner de Abreu Santana; Queluz Holding Investimentos e Participacoes Ltda; J.B.C. Holding e Investimentos Ltda", competitors: "Escolas particulares premium de Goiania, colegios bilingues e operacoes K-12 focadas em classe media-alta.", advantages: "Capital social relevante para a fase, oferta escolar ampla, endereco premium no Setor Marista e possibilidade de captura de lifetime value de educacao basica completa.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado publicamente entre R$ 110 mil e R$ 1,47 milhao conforme bases cadastrais distintas.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica usada: Winsford Goiania Educacao Ltda, CNPJ 42.136.439/0001-96, aberta em 29/05/2021, com nome fantasia Winsford Global Education." },
    { name: "Complete Bari", sector: "Nutricao", location: "Santana de Parnaiba - SP", year: "2022", status: "Declinado", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 2100000, owner: "Arthur Bueno", tags: ["Private Equity", "Nutricao"], cover: "https://completebari.com.br/cdn/shop/files/10_DESK_3X_bfd49e8b-863f-4d82-b4bd-ba69e625e2da.png", logoText: "CB", logo: "https://completebari.com.br/cdn/shop/files/logo_02_copiar_5.png", logoBg: "transparent", description: "Marca digital focada em suplementacao para pacientes bariatricos, com portfolio de multivitaminicos, creatina em gummies, fibras e assinaturas recorrentes.", website: "https://completebari.com.br/", businessModel: "E-commerce D2C de nutricao especializada com ticket recorrente, clube de assinatura e catalogo dedicado ao pos-cirurgico bariatrico.", managementTeam: "Complete Bari", competitors: "Bariatric Advantage, FitForMe e marcas locais de suplementacao pos-bariatrica.", advantages: "Nicho muito especifico, proposta clara de valor para bariatricos, recorrencia via assinatura e provas publicas de adesao de base.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional.", vcPeBacked: "Nao identificado publicamente", notes: "Site oficial comunica base superior a 50 mil bariatricos atendidos, 93% de recomendacao e oferta de planos de assinatura com recorrencia." },
    { name: "Pop Move", sector: "Mobilidade", location: "Santo Andre - SP", year: "2022", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 3100000, owner: "Arthur Bueno", tags: ["Private Equity", "Mobilidade"], cover: defaultCover("Pop Move", "#eef5ff", "#dcecff"), logoText: "PM", logo: defaultLogo("POP MOVE", "#1f4db8", "#ffffff", "Inter, Arial, sans-serif", 48, 800), logoBg: "#ffffff", description: "Empresa de tecnologia e intermedicao de servicos sob a marca Pop Move, com tese ligada a mobilidade e integracao operacional.", website: "Nao identificado publicamente", contact: "Nao identificado publicamente", email: "Nao identificado publicamente", businessModel: "Intermediacao e agenciamento de servicos e negocios com camada tecnologica, incluindo software, suporte tecnico e servicos de informacao na internet.", managementTeam: "Matheus Junior dos Santos Filho; Wanderley Henrique Batista Filho; Cristiano Ayres de Jesus; Murilo da Silva Santos", competitors: "Plataformas de intermedicao e mobilidade urbana, marketplaces de servicos e operadores asset-light com tese B2B2C.", advantages: "Estrutura leve, natureza tecnologica, CNPJ ativo e tese potencial de escala sem necessidade de ativos fisicos pesados.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 100 mil.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica mais aderente: Pop Move do Brasil Tecnologia Ltda, CNPJ 45.755.297/0001-33, aberta em 23/03/2022 em Santo Andre - SP. Nao foi encontrada na internet uma prova publica inequivoca de operacao em Goiania ou um site oficial inequivoco associado a esta razao social." }
  ];

  function normalizeReferenceIdentity(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function referenceProjectKey(project) {
    return normalizeReferenceIdentity(project?.referenceKey || project?.name || "");
  }

  function seededRitoDealId(project) {
    return `rito-deal-${stableTaskSeedSlug(referenceProjectKey(project) || project?.name || "")}`;
  }

  function referenceProjectAliases(project) {
    const aliases = new Set();
    const primary = referenceProjectKey(project);
    if (primary) aliases.add(primary);
    String(project?.name || "")
      .split(/\s+\/\s+|\s+-\s+/)
      .map((part) => normalizeReferenceIdentity(part))
      .filter(Boolean)
      .forEach((part) => aliases.add(part));
    return aliases;
  }

  function hasExactReferenceAliasOverlap(left, right) {
    const leftAliases = [...referenceProjectAliases(left)];
    const rightAliases = new Set(referenceProjectAliases(right));
    if (!leftAliases.length || !rightAliases.size) return false;
    return leftAliases.some((alias) => rightAliases.has(alias));
  }

  function projectsShareReferenceIdentity(left, right) {
    if (!left || !right) return false;
    return hasExactReferenceAliasOverlap(left, right);
  }

  function mergeRitoProjectLists(baseProjects = [], preferredProjects = []) {
    const merged = Array.isArray(baseProjects) ? [...baseProjects] : [];
    const preferredList = Array.isArray(preferredProjects) ? preferredProjects : [];
    preferredList.forEach((project) => {
      const existingIndex = merged.findIndex((existingProject) =>
        projectsShareReferenceIdentity(existingProject, project)
      );
      if (existingIndex >= 0) {
        merged[existingIndex] = project;
      } else {
        merged.push(project);
      }
    });
    return merged;
  }

  function getRitoSourceProjects() {
    const seededProjects = Array.isArray(window.__RITO_DEALS_SEED__) && window.__RITO_DEALS_SEED__.length
      ? window.__RITO_DEALS_SEED__
      : [];
    return mergeRitoProjectLists(ritoReferenceProjects, seededProjects);
  }

  function hasMeaningfulProjectValue(value) {
    const normalized = normalizeReferenceIdentity(value);
    return Boolean(normalized) && !["nao identificado publicamente", "a preencher", "-", "none"].includes(normalized);
  }

  function isLikelyReferenceProjectMatch(item, seededProject) {
    const itemKey = normalizeReferenceIdentity(item?.referenceKey || item?.name);
    const aliases = referenceProjectAliases(seededProject);
    if (itemKey && aliases.has(itemKey)) return true;
    if (hasExactReferenceAliasOverlap(item, seededProject)) return true;
    const seededWebsite = normalizeReferenceIdentity(seededProject?.website);
    const itemWebsite = normalizeReferenceIdentity(item?.website);
    if (seededWebsite && itemWebsite && seededWebsite === itemWebsite) return true;
    const seededEmail = normalizeReferenceIdentity(seededProject?.email);
    const itemEmail = normalizeReferenceIdentity(item?.email);
    if (seededEmail && itemEmail && seededEmail === itemEmail) return true;
    return false;
  }

  function projectRecordScore(item, seededProject) {
    let score = 0;
    if (normalizeReferenceIdentity(item?.referenceKey) === referenceProjectKey(seededProject)) score += 200;
    if (normalizeReferenceIdentity(item?.name) !== referenceProjectKey(seededProject)) score += 50;
    if (hasMeaningfulProjectValue(item?.website)) score += 10;
    if (hasMeaningfulProjectValue(item?.email)) score += 10;
    if (hasMeaningfulProjectValue(item?.contact)) score += 10;
    if (hasMeaningfulProjectValue(item?.description)) score += 10;
    const updatedAt = Date.parse(item?.updatedAt || item?.createdAt || "");
    if (!Number.isNaN(updatedAt)) score += updatedAt / 1e13;
    return score;
  }

  function mergeProjectRecords(target, source, seededProject = null) {
    if (!target || !source || target === source) return target;
    const targetIsNewerThanSeed = recordTimestampValue(target) > recordTimestampValue(source);
    const sourceTimestamp = recordTimestampValue(source);
    const targetTimestamp = recordTimestampValue(target);
    const sourceIsNewerOrEqual = sourceTimestamp >= targetTimestamp;
    const sourceOfTruthFields = [
      "name",
      "subtitle",
      "description",
      "sector",
      "location",
      "year",
      "website",
      "contact",
      "email",
      "businessModel",
      "competitors",
      "advantages",
      "founders",
      "management",
      "managementTeam",
      "framework",
      "cover",
      "logo",
      "logoText",
      "logoBg"
    ];
    if (seededProject && !targetIsNewerThanSeed) {
      sourceOfTruthFields.forEach((key) => {
        if (hasMeaningfulProjectValue(source[key])) {
          target[key] = source[key];
        }
      });
    }
    [
      "name",
      "subtitle",
      "description",
      "sector",
      "location",
      "year",
      "owner",
      "contact",
      "email",
      "website",
      "businessModel",
      "managementTeam",
      "revenues",
      "fundraisingHistory",
      "competitors",
      "advantages",
      "founders",
      "framework",
      "origin",
      "priority",
      "temperature",
      "investmentStatus",
      "cover",
      "logo",
      "logoText",
      "logoBg"
    ].forEach((key) => {
      if (!hasMeaningfulProjectValue(target[key]) && hasMeaningfulProjectValue(source[key])) {
        target[key] = source[key];
      }
    });
    target.estimatedValue = Math.max(Number(target.estimatedValue || 0), Number(source.estimatedValue || 0));
    const targetInvestmentAmount = Number(target.investmentAmount || 0);
    const sourceInvestmentAmount = Number(source.investmentAmount || 0);
    if (seededProject) {
      if (!targetIsNewerThanSeed) {
        target.investmentAmount = Number.isFinite(sourceInvestmentAmount) ? sourceInvestmentAmount : targetInvestmentAmount;
      } else {
        target.investmentAmount = Number.isFinite(targetInvestmentAmount) ? targetInvestmentAmount : 0;
      }
    } else if (sourceIsNewerOrEqual) {
      target.investmentAmount = Number.isFinite(sourceInvestmentAmount) ? sourceInvestmentAmount : targetInvestmentAmount;
    } else {
      target.investmentAmount = Number.isFinite(targetInvestmentAmount) ? targetInvestmentAmount : sourceInvestmentAmount;
    }
    target.progress = Math.max(Number(target.progress || 0), Number(source.progress || 0));
    target.tags = [...new Set([...(target.tags || []), ...(source.tags || [])])];
    target.history = [...(target.history || []), ...(source.history || [])]
      .filter((entry, index, list) => list.findIndex((candidate) => candidate?.at === entry?.at && candidate?.text === entry?.text) === index)
      .sort((a, b) => String(b?.at || "").localeCompare(String(a?.at || "")));
    if (seededProject) target.referenceKey = referenceProjectKey(seededProject);
    return target;
  }

  function dedupeCRMItemsById(items = []) {
    const uniqueItems = [];
    const itemIndexById = new Map();
    (items || []).forEach((item) => {
      if (!item || typeof item !== "object") return;
      const itemId = String(item.id || "").trim();
      if (!itemId) {
        uniqueItems.push(item);
        return;
      }
      if (!itemIndexById.has(itemId)) {
        itemIndexById.set(itemId, uniqueItems.length);
        uniqueItems.push(item);
        return;
      }
      const index = itemIndexById.get(itemId);
      const merged = { ...uniqueItems[index] };
      mergeProjectRecords(merged, item);
      uniqueItems[index] = merged;
    });
    return normalizeCRMItemOrder(uniqueItems);
  }

  function normalizeCRMItemOrder(items = []) {
    if (!Array.isArray(items)) return [];
    items.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      item.orderIndex = index;
    });
    return items;
  }

  function referenceProjectToCRMItem(project) {
    const subtitle = project.subtitle || ritoSubtitle(project.sector, project.location, project.year);
    const investmentStatus = project.investmentStatus || "Nao investido";
    const temperature = project.temperature || "Morno";
    const statusLabel = referenceStatusLabel(project.status, investmentStatus);
    const normalizedStatus = normalizeRitoDealStatus(project.status, investmentStatus);
    const invested = isInvestedProjectRecord({ ...project, status: normalizedStatus, investmentStatus });
    return {
      id: seededRitoDealId(project),
      referenceKey: referenceProjectKey(project),
      name: project.name,
      logo: project.logo || "",
      logoText: project.logoText || "",
      logoBg: project.logoBg || "#ffffff",
      cover: project.cover,
      description: project.description || "",
      sector: project.sector || "",
      location: project.location || "",
      year: project.year || "",
      status: normalizedStatus,
      subtitle,
      tags: [...new Set([...(project.tags || []), statusLabel, investmentStatus === "Investido" ? "Investido" : "Nao investido", temperature])],
      owner: project.owner || "Arthur Bueno",
      estimatedValue: project.estimatedValue || 0,
      investmentAmount: project.investmentAmount || 0,
      framework: project.framework || `${project.sector || "Projeto"} / Thesis / Diligence`,
      progress: invested ? 100 : (project.progress !== undefined ? project.progress : progressFromRitoDealStatus(normalizedStatus)),
      temperature,
      investmentStatus,
      priority: project.priority || "Media",
      origin: project.origin || "Inbound",
      website: project.website || "",
      mainContact: project.contact || "",
      email: project.email || "",
      closeDate: project.closeDate || "",
      deadline: project.deadline || "",
      founders: project.founders || project.management || project.managementTeam || "",
      management: project.management || project.managementTeam || project.founders || "",
      managementTeam: project.managementTeam || project.management || project.founders || "",
      businessModel: project.businessModel || "",
      competitors: project.competitors || "",
      advantages: project.advantages || "",
      revenues: project.revenues || "",
      fundraisingHistory: project.fundraisingHistory || "",
      vcPeBacked: project.vcPeBacked || "",
      notes: project.notes || "",
      dealHistory: project.dealHistory || "",
      projectStrengths: project.projectStrengths || "",
      projectWeaknesses: project.projectWeaknesses || "",
      createdAt: project.createdAt || "2026-04-20",
      updatedAt: project.updatedAt || "2026-04-20",
      frameworkDetails: project.frameworkDetails && typeof project.frameworkDetails === "object"
        ? project.frameworkDetails
        : {
          tese: "",
          opportunity: "",
          risks: "",
          nextSteps: "",
          diligence: project.status,
          strategicNotes: ""
        },
      history: Array.isArray(project.history) && project.history.length
        ? project.history
        : [{ at: "17/03/2026 09:00", text: "Projeto carregado na base do CRM" }]
    };
  }

  function buildRitoReferenceCRMItems() {
    const sourceProjects = getRitoSourceProjects();
    return sourceProjects.map(referenceProjectToCRMItem);
  }

  function buildRitoSeedProjectKeySet() {
    return new Set(
      getRitoSourceProjects()
        .map((project) => referenceProjectKey(project))
        .filter(Boolean)
    );
  }

  function isSeededRitoCRMItem(item = {}) {
    const itemReferenceKey = referenceProjectKey(item);
    if (!itemReferenceKey) return false;
    return buildRitoSeedProjectKeySet().has(itemReferenceKey);
  }

  function ritoTaskOwner(owner) {
    if (owner === "Arthur") return "Arthur Bueno";
    if (owner === "Ciro") return "Ciro Ribeiro";
    if (owner === "Arthur + Ciro") return "Arthur Bueno / Ciro Ribeiro";
    if (owner === "Assessoria") return "Assessoria";
    if (owner === "Juridico") return "Juridico";
    if (owner === "IC") return "IC";
    return owner || "A definir";
  }

  function ritoTaskPriority(marker) {
    if (marker === "M1") return "Alta";
    if (marker === "M2" || marker === "M3") return "Media";
    if (marker === "Mensal" || marker === "Continuo" || marker === "Contínuo") return "Media";
    return "Baixa";
  }

  function seededRitoTaskId(stage, title) {
    return `rito-task-${stableTaskSeedSlug(stage)}-${stableTaskSeedSlug(title)}`;
  }

  function ritoSeedTaskTitleKey(taskOrTitle = "") {
    const title = typeof taskOrTitle === "string" ? taskOrTitle : taskOrTitle?.title;
    return normalizeColumnKey(title);
  }

  function ritoTask(title, stage, owner, marker, notes = "") {
    return {
      id: seededRitoTaskId(stage, title),
      title,
      description: [notes, marker ? `Prazo: ${marker}` : ""].filter(Boolean).join(" - "),
      stage,
      owner: ritoTaskOwner(owner),
      dueDate: "",
      priority: ritoTaskPriority(marker),
      status: "A fazer",
      tags: [stage, marker].filter(Boolean),
      createdAt: "2026-04-20",
      updatedAt: "2026-04-20"
    };
  }

  function ritoWorkflowStatus(rawStatus = "") {
    const value = String(rawStatus || "").toLowerCase();
    if (value.includes("enviado")) return "Concluido";
    if (value.includes("em andamento")) return "Em andamento";
    return "A fazer";
  }

  function ritoTaskSeed(title, stage, owner, rawStatus = "Nao iniciado", note = "", priority = "Media") {
    return {
      id: seededRitoTaskId(stage, title),
      title,
      description: [rawStatus, note].filter(Boolean).join(" - "),
      stage,
      owner: ritoTaskOwner(owner),
      dueDate: "",
      priority,
      status: ritoWorkflowStatus(rawStatus),
      tags: [stage, rawStatus].filter(Boolean),
      createdAt: "2026-04-20",
      updatedAt: "2026-04-20"
    };
  }

  function buildRitoKanbanTasks() {
    return [
      ritoTask("Configurar CRM Attio (conta, campos e pipeline)", "Infra / CRM", "Arthur", "M1"),
      ritoTask("Importar dados iniciais para o CRM", "Infra / CRM", "Arthur", "M1"),
      ritoTask("Revisar e limpar dados do CRM", "Infra / CRM", "Arthur", "M2"),
      ritoTask("Registrar dominio ritoventures.com.br e Google Workspace", "Infra / CRM", "Arthur", "M1"),
      ritoTask("Criar site institucional da Rito Ventures", "Infra / CRM", "Ciro", "M3"),
      ritoTask("Configurar plataforma de newsletter", "Infra / CRM", "Ciro", "M2"),

      ritoTaskSeed("Estruturar Instagram + divulgacoes da marca Rito", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Alta"),
      ritoTaskSeed("Estruturar materiais padroes da Rito", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Media"),
      ritoTaskSeed("Estruturar Instagram da Rito", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Media"),
      ritoTaskSeed("Mapear 5 assessorias de imprensa", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Alta"),
      ritoTaskSeed("Preparar Press Kit", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Media"),
      ritoTaskSeed("Definir narrativa de lancamento da Rito", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Alta"),
      ritoTaskSeed("Publicar carta numero 1", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Media"),
      ritoTaskSeed("Estruturar Rituais da Rito", "Marca e Marketing", "Ciro", "Nao iniciado", "", "Media"),

      ritoTask("Criar perfil LinkedIn da Rito Ventures", "Digital", "Ciro", "M1"),
      ritoTask("Desenvolver identidade visual da Rito", "Marca", "Ciro", "M2"),
      ritoTask("Criar templates visuais para conteudo", "Marca", "Ciro", "M2"),
      ritoTask("Definir temas estrategicos de conteudo de Arthur", "Digital", "Arthur", "M1"),
      ritoTask("Sessao de fotos profissionais Arthur", "Marca", "Arthur", "M2"),
      ritoTask("Sessao de fotos profissionais Ciro", "Marca", "Ciro", "M2"),
      ritoTask("Atualizar LinkedIn Arthur", "Digital", "Arthur", "M1"),
      ritoTask("Atualizar LinkedIn Ciro", "Digital", "Ciro", "M1"),
      ritoTask("Criar calendario editorial de conteudo", "Digital", "Ciro", "M2"),
      ritoTask('Produzir Carta #1 ("Por que criamos a Rito")', "Marca", "Arthur", "M2"),
      ritoTask("Produzir Carta #2", "Marca", "Arthur", "M4"),
      ritoTask("Produzir serie de posts institucionais LinkedIn", "Digital", "Ciro", "M3"),
      ritoTask("Definir narrativa institucional da Rito", "Marca", "Ciro", "M2"),

      ritoTask("Mapear assessorias de imprensa", "Digital", "Ciro", "M1"),
      ritoTask("Selecionar e contratar assessoria de imprensa", "Digital", "Ciro", "M2"),
      ritoTask("Produzir press kit institucional", "Digital", "Ciro", "M3"),
      ritoTask("Media training Arthur", "Digital", "Assessoria", "M3"),
      ritoTask("Produzir release de lancamento da Rito", "Digital", "Ciro", "M3"),
      ritoTask("Desenvolver pautas de midia", "Digital", "Assessoria", "M3"),

      ritoTaskSeed("Arquivar todos os documentos da Fast Massagem", "Juridico", "Bruna Cristina", "Nao iniciado", "", "Media"),
      ritoTaskSeed("Iniciar constituicao de Holding/Gestora", "Juridico", "Arthur", "Nao iniciado", "", "Alta"),
      ritoTaskSeed("Constituir holding nos EUA", "Juridico", "Arthur", "Em andamento", "", "Alta"),
      ritoTaskSeed("Redigir modelo de SHA", "Juridico", "Arthur", "Nao iniciado", "", "Media"),
      ritoTaskSeed("Redigir NDA padrao", "Juridico", "Bruna Cristina", "Nao iniciado", "", "Media"),

      ritoTask("Contratar escritorio juridico", "Governanca", "Arthur", "M1"),
      ritoTask("Constituir holding / gestora Rito", "Governanca", "Juridico", "M2"),
      ritoTask("Criar modelo padrao NDA", "Governanca", "Juridico", "M2"),
      ritoTask("Criar modelo padrao SHA", "Governanca", "Juridico", "M3"),
      ritoTask("Criar modelo padrao term sheet", "Governanca", "Juridico", "M3"),
      ritoTask("Emitir parecer tributario", "Financeiro", "Juridico", "M3"),
      ritoTask("Avaliar registro na CVM", "Governanca", "Juridico", "M4"),

      ritoTask("Definir estrutura do Investment Committee", "Governanca", "Arthur", "M1"),
      ritoTask("Mapear candidatos para IC", "Governanca", "Arthur", "M1"),
      ritoTask("Convidar membros IC", "Governanca", "Arthur", "M2"),
      ritoTask("Elaborar regimento interno do IC", "Governanca", "Arthur", "M2"),
      ritoTask("Distribuir documentos do IC", "Governanca", "Arthur", "M3"),
      ritoTask("Realizar primeira reuniao do IC", "Governanca", "IC", "M3"),
      ritoTask("Realizar segunda reuniao do IC", "Governanca", "IC", "M6"),
      ritoTask("Mapear candidatos para Conselho Estrategico", "Governanca", "Arthur + Ciro", "M3"),
      ritoTask("Convidar membros do Conselho", "Governanca", "Arthur + Ciro", "M4"),
      ritoTask("Confirmar membros do Conselho", "Governanca", "Arthur + Ciro", "M5"),

      ritoTask("Mapear fundadores do Centro-Oeste", "Deals", "Ciro", "M2"),
      ritoTask("Construir pipeline inicial de empresas", "Deals", "Arthur + Ciro", "M3"),
      ritoTask("Realizar reunioes com fundadores", "Deals", "Arthur + Ciro", "M4"),
      ritoTask("Estruturar checklist de due diligence", "Deals", "Arthur", "M2"),
      ritoTask("Analisar documentos das empresas", "Deals", "Arthur", "M3"),
      ritoTask("Fazer cruzamento e verificacoes de dados", "Deals", "Arthur", "M3"),
      ritoTask("Calcular valuation preliminar", "Deals", "Arthur", "M3"),
      ritoTask("Produzir IC Memo das oportunidades", "Deals", "Arthur", "M3"),
      ritoTask("Conduzir DD Fast Massagem", "Deals", "Arthur", "M2"),
      ritoTask("Produzir IC Memo final Fast Massagem", "Deals", "Arthur", "M3"),
      ritoTask("Submeter Fast Massagem ao IC", "Deals", "Arthur", "M3"),
      ritoTask("Negociar termos da operacao", "Deals", "Arthur", "M4"),
      ritoTask("Executar signing da operacao", "Deals", "Arthur", "M5"),
      ritoTask("Preparar analise inicial UFC Gym", "Deals", "Arthur", "M2"),
      ritoTask("Conduzir DD UFC Gym", "Deals", "Arthur", "M3"),
      ritoTask("Apresentar relatorio UFC Gym ao IC", "Deals", "Arthur", "M4"),
      ritoTask("Conduzir reuniao inicial Pop Move", "Deals", "Arthur + Ciro", "M2"),
      ritoTask("Avaliar continuidade Pop Move", "Deals", "Arthur + Ciro", "M3"),
      ritoTaskSeed("Enviar IRL e Deal da Pop Move", "Deals", "Bruna Cristina", "Enviado", "", "Alta"),
      ritoTaskSeed("Montar book de novo investidor", "Deals", "Bruna Cristina", "Em andamento", "", "Alta"),

      ritoTask("Criar LP Deck", "Financeiro", "Arthur + Ciro", "M2"),
      ritoTask("Apresentar tese da Rito a investidores", "Financeiro", "Arthur", "M3"),
      ritoTask("Realizar reunioes com LPs", "Financeiro", "Arthur", "M4"),
      ritoTask("Fazer follow-up com investidores", "Financeiro", "Arthur", "M5"),
      ritoTask("Atualizar LP Deck com pipeline", "Financeiro", "Arthur", "M5"),

      ritoTask("Mapear rede tecnica de especialistas", "Governanca", "Arthur", "M2"),
      ritoTask("Confirmar especialistas parceiros", "Governanca", "Arthur", "M3"),
      ritoTask("Organizar encontros Cafe Sem Pauta", "Marca", "Arthur + Ciro", "Mensal"),
      ritoTask("Realizar encontros com fundadores", "Deals", "Arthur + Ciro", "Continuo"),
      ritoTask("Organizar evento Mesa do Centro-Oeste", "Marca", "Arthur + Ciro", "M6"),
      ritoTask("Conduzir retrospectiva operacional", "Governanca", "Arthur + Ciro", "M3"),
      ritoTask("Avaliar aprendizados da operacao", "Governanca", "Arthur + Ciro", "M3"),
      ritoTask("Definir plano estrategico proximos 90 dias", "Governanca", "Arthur + Ciro", "M3")
    ];
  }

  function fastWorkflowStatus(rawStatus = "") {
    const value = String(rawStatus || "").toLowerCase();
    if (value.includes("ok, pago") || value.includes("enviado")) return "Concluido";
    if (value.includes("em andamento")) return "Em andamento";
    if (value.includes("aguardando")) return "Revisao";
    return "A fazer";
  }

  function stableTaskSeedSlug(value = "") {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function seededFastTaskId(group, title) {
    return `fast-task-${stableTaskSeedSlug(group)}-${stableTaskSeedSlug(title)}`;
  }

  function fastSeedTaskTitleKey(taskOrTitle = "") {
    const title = typeof taskOrTitle === "string" ? taskOrTitle : taskOrTitle?.title;
    return normalizeColumnKey(title);
  }

  function fastTask(title, stage, owner, rawStatus, note = "", priority = "Media", seedGroup = "base") {
    return {
      id: seededFastTaskId(seedGroup, title),
      title,
      description: [rawStatus, note].filter(Boolean).join(" - "),
      stage,
      owner,
      dueDate: "",
      priority,
      status: fastWorkflowStatus(rawStatus),
      tags: [stage, rawStatus].filter(Boolean),
      createdAt: "2026-04-20",
      updatedAt: "2026-04-20"
    };
  }

  function buildFastTaskItems() {
    return [
      fastTask("Definir quem serao as pessoas a irem na ABF", "ABF", "Mayra", "Aguardando lista da Mayra", "", "Alta"),
      fastTask("Definir brindes que serao entregues na ABF", "ABF", "Eduardo / Mayra", "Nao iniciado", "", "Media"),
      fastTask("Orcar passagens e hospedagem para participantes da ABF", "ABF", "Bruna Cristina", "Aguardando lista de participantes", "", "Alta"),
      fastTask("Organizar material grafico da ABF", "ABF", "Eduardo", "Nao iniciado", "", "Media"),
      fastTask("Estruturar collab com marca famosa para a ABF", "ABF", "Eduardo / Mayra", "Nao iniciado", "", "Alta"),

      fastTask("Abrir vaga de consultor comercial", "Pessoas", "Bruna Cristina / Mayra", "Nao iniciado", "", "Alta"),
      fastTask("Abrir vaga de estagiario financeiro", "Pessoas", "Bruna Cristina", "Nao iniciado", "", "Media"),
      fastTask("Abrir vaga de analista de marketing pela Enredo", "Pessoas", "Ciro Ribeiro", "Nao iniciado", "", "Media"),
      fastTask("Estruturar treinamentos para funcionarias do aeroporto de BSB e Santos Dumont", "Pessoas", "Mayra", "Nao iniciado", "", "Alta"),

      fastTask("Comprar lava e seca para a Fast Marista", "Operacoes", "Bruna Cristina", "Aguardando entrada do aporte", "", "Alta"),
      fastTask("Buscar novo fornecedor de oleos e cremes", "Operacoes", "Bruna Cristina / Mayra", "Em andamento", "Visita in loco agendada para hoje (18/03)", "Alta"),
      fastTask("Orcar valor de outdoor na regiao do Oscar Niemeyer", "Operacoes", "Bruna Cristina", "Nao iniciado", "", "Media"),
      fastTask("Voltar a realizar acoes na Ricardo Paranhos", "Operacoes", "Mayra", "Nao iniciado", "", "Media"),
      fastTask("Orcar melhoria de iluminacao nos quiosques da BSB e Santos Dumont", "Operacoes", "Bruna Cristina", "Em andamento", "", "Alta"),
      fastTask("Adquirir 2 cadeiras Quick e 2 massageadores para pes", "Operacoes", "Mayra", "Aguardando entrada do aporte", "Pegando emprestado dos franqueados", "Alta"),

      fastTask("Buscar parceria com a LoungeKey", "Estrategico", "Arthur Bueno", "Nao iniciado", "", "Alta"),
      fastTask("Reestruturar plano de expansao da Fast", "Estrategico", "Arthur Bueno", "Nao iniciado", "", "Alta"),
      fastTask("Apresentar 2 pontos para Arthur indicar para amigo", "Estrategico", "Mayra / Eduardo", "Nao iniciado", "", "Alta"),

      fastTask("Buscar renegociacao dos debitos com a Guirre e pedido a vista", "Financeiro", "Bruna Cristina", "Nao iniciado", "Guirre quer receber valor a vista (13k)", "Alta"),
      fastTask("Pagar aluguel vencido do aeroporto de BSB", "Financeiro", "Bruna Cristina", "Ok, pago", "", "Alta"),
      fastTask("Pagar aluguel vencido do Santos Dumont", "Financeiro", "Bruna Cristina", "Aguardando entrada do aporte", "", "Alta"),
      fastTask("Encerrar contas bancarias e deixar apenas 2 por empresa", "Financeiro", "Bruna Cristina", "Em andamento", "SICOOB + banco grande", "Alta"),
      fastTask("Verificar maquina de split automatico para as franquias", "Financeiro", "Bruna Cristina", "Em andamento", "", "Alta"),
      fastTask("Contratar sistema de ERP para gestao financeira", "Financeiro", "Bruna Cristina", "Em andamento", "", "Alta"),
      fastTask("Acompanhar abertura de conta do SICOOB", "Financeiro", "Bruna Cristina", "Em andamento", "", "Alta"),
      fastTask("Liberar meu acesso nas contas bancarias", "Financeiro", "Arthur Bueno", "Nao iniciado", "", "Media"),
      fastTask("Pagar reembolsos do Arthur, Rodrigo e Eduardo", "Financeiro", "Bruna Cristina", "Aguardando entrada do aporte", "Parcelado em 3x - 30, 60 e 90 dias", "Alta"),
      fastTask("Comprar computador para a Mayra", "Financeiro", "Bruna Cristina", "Nao iniciado", "", "Media"),
      fastTask("Verificar Serasa da Fast", "Financeiro", "Bruna Cristina", "Nao iniciado", "", "Media"),
      fastTask("Follow up diario da posicao do caixa", "Financeiro", "Bruna Cristina", "Enviado", "", "Alta"),

      fastTask("Anunciar transacao da Fast na assessoria de imprensa", "Marketing", "Eduardo / Ciro Ribeiro", "Nao iniciado", "", "Alta"),
      fastTask("Organizar logistica para evento do Moto GP", "Marketing", "Grace", "Em andamento", "", "Media"),
      fastTask("Encontrar design grafico", "Marketing", "Mayra / Ciro Ribeiro", "Em andamento", "", "Media")
    ];
  }

  function buildFastDailyTasksMarch30() {
    const dueDate = "2026-03-30";
    const seed = (title, stage, owner = "", description = "", priority = "Media") => ({
      id: seededFastTaskId("daily-2026-03-30", title),
      title,
      description,
      owner,
      dueDate,
      completionDate: "",
      priority,
      stage,
      status: "A Fazer",
      tags: [stage, "Pauta 30/03"].filter(Boolean),
      createdAt: "2026-04-20",
      updatedAt: "2026-04-20"
    });

    return [
      seed("Contratar vendedor com experiência de franquia", "ABF", "Samuel", "", "Alta"),
      seed("Definir 2 pessoas para atender investidores na ABF", "ABF", "Samuel", "Levar mais 1 pessoa", "Alta"),
      seed("Definir 2 pessoas para pegar dados e bipar crachá", "ABF", "Samuel", "", "Alta"),
      seed("Organizar tráfego pago da ABF", "ABF", "Mayra", "", "Alta"),
      seed("Verificar possibilidade de contratar consultor comercial", "Felps", "Samuel", "Avaliar aumento da variável e redução do fixo", "Alta"),
      seed("Avaliar agência de franquias", "Penog", "Samuel", "Proposta: 5k fee + 1% do valor da venda da franquia", "Alta"),
      seed("Avaliar agência de franquia", "Prospecta", "Samuel", "", "Media"),
      seed("Pagar Júlia em espécie e encerrar recorrência", "Financeiro", "Bruna Cristina", "Ex-colaboradora", "Alta"),
      seed("Negociar bandeira Master e Visa", "Estratégico", "Arthur Bueno", "Ver possibilidade de negociação", "Alta"),
      seed("Reduzir valor da social media e reforçar design", "Design Gráfico", "Mayra", "", "Media"),
      seed("Verificar redução do contrato do Júlio", "Financeiro", "Rodrigo", "", "Alta"),
      seed("Definir pagamentos do todo dia 20", "Financeiro", "Bruna Cristina", "", "Alta"),
      seed("Estruturar caminhão para ações em cidades", "Operações", "Mayra", "", "Media"),
      seed("Organizar expansão comercial de quarta às 11h", "Comercial", "Bruna Cristina", "Enviar invite", "Alta"),
      seed("Resolver tapume do aeroporto para retirada do teto", "Operações", "Moisés", "", "Alta"),
      seed("Verificar contrato de Cuiabá", "Operações", "", "Avaliar venda da praça", "Alta"),
      seed("Verificar contratos dos PJs", "Financeiro", "", "", "Alta"),
      seed("Renegociar aluguel da matriz", "Financeiro", "", "Pagar IPTU e pedir pagamento de apenas 3 meses com desconto", "Alta"),
      seed("Cobrar fundo de promoção e marketing dos franqueados", "Financeiro", "", "", "Alta"),
      seed("Revisitar verba de tráfego", "Mayra", "Mayra", "1.300 para a agência + 5.000 de tráfego", "Media"),
      seed("Revisar unit economics por massagem", "Financeiro", "", "", "Alta")
    ];
  }

  function buildFastSeedTaskIdSet() {
    return new Set([
      ...buildFastTaskItems().map((task) => String(task.id || "").trim()).filter(Boolean),
      ...buildFastDailyTasksMarch30().map((task) => String(task.id || "").trim()).filter(Boolean)
    ]);
  }

  function isFastSeedTask(task = {}) {
    const taskId = String(task?.id || "").trim();
    if (!taskId) return false;
    return buildFastSeedTaskIdSet().has(taskId);
  }

  function normalizeFastTaskThemeName(stage = "") {
    const value = String(stage || "").trim();
    const map = {
      "Operacao": "Operacoes",
      "Operações": "Operacoes",
      "Operação": "Operacoes",
      "Marketing & Marca": "Marketing",
      "Estratégico": "Estrategico"
    };
    return map[value] || value;
  }

  function crmItemToReferenceCard(item) {
    ensureProjectShape(item);
    const transientStatusTags = new Set(["Pipeline", "Portfolio", "Portfólio", "Investido", "Declined", "Declinado", "LOI", "Due Diligence", "Frio", "Morno", "Quente", "Nao investido"]);
    return {
      id: item.id,
      name: item.name,
      subtitle: item.subtitle || ritoSubtitle(item.sector, item.location, item.year),
      status: referenceStatusLabel(item.status, item.investmentStatus),
      cover: item.cover,
      logoText: item.logoText || initials(item.name),
      logo: item.logo || "",
      logoBg: item.logoBg || "#ffffff",
      tags: [...new Set([...(item.tags || []).filter((tag) => !transientStatusTags.has(tag)), referenceStatusLabel(item.status, item.investmentStatus), item.investmentStatus === "Investido" ? "Investido" : "Nao investido", item.temperature])],
      owner: item.owner,
      accent: referenceAccent(item.status, item.investmentStatus),
      temperature: item.temperature,
      progress: item.progress
    };
  }

  function getRitoReferenceCards() {
    return prioritizedRitoPipelineItems(workspaceData().crmItems || [])
      .map(crmItemToReferenceCard);
  }

  function migrateRitoReferenceProjects(rootState) {
    const rito = rootState.workspaces?.rito;
    if (!rito) return;
    rito.projectBoards = rito.projectBoards || {};
    const existingItems = Array.isArray(rito.crmItems) ? rito.crmItems : [];
    existingItems.forEach((item) => ensureProjectShape(item));
    const deletedReferenceProjectKeys = new Set(
      Array.isArray(rito.deletedReferenceProjectKeys)
        ? rito.deletedReferenceProjectKeys.map((key) => normalizeReferenceIdentity(key)).filter(Boolean)
        : []
    );
    const sourceProjects = getRitoSourceProjects().filter((project) => !deletedReferenceProjectKeys.has(referenceProjectKey(project)));
    const matchedSourceKeys = new Set();
    const nextItems = existingItems.map((existingItem) => {
      const matchingProject = sourceProjects.find((project) =>
        !matchedSourceKeys.has(referenceProjectKey(project)) &&
        isLikelyReferenceProjectMatch(existingItem, project)
      );
      if (!matchingProject) return existingItem;
      matchedSourceKeys.add(referenceProjectKey(matchingProject));
      const seededItem = referenceProjectToCRMItem(matchingProject);
      const mergedItem = { ...existingItem };
      mergeProjectRecords(mergedItem, seededItem, matchingProject);
      mergedItem.id = existingItem?.id || seededItem.id;
      return mergedItem;
    });
    sourceProjects.forEach((project) => {
      const projectKey = referenceProjectKey(project);
      if (matchedSourceKeys.has(projectKey)) return;
      nextItems.push(referenceProjectToCRMItem(project));
    });
    rito.deletedReferenceProjectKeys = [...deletedReferenceProjectKeys];
    rito.crmItems = dedupeCRMItemsById(nextItems);
  }

  function migrateRitoKanbanTasks(rootState) {
    const rito = rootState.workspaces?.rito;
    if (!rito) return;
    const seededTasks = buildRitoKanbanTasks();
    const currentTasks = Array.isArray(rito.taskItems) ? rito.taskItems : [];
    rito.taskItems = rebuildSeededKanbanTasks(currentTasks, seededTasks, ritoSeedTaskTitleKey);
    const currentThemes = Array.isArray(rito.taskThemes) ? rito.taskThemes.map((theme) => String(theme || "").trim()).filter(Boolean) : [];
    const inferredThemes = [...new Set(
      rito.taskItems
        .map((task) => String(task?.stage || "").trim())
        .filter(Boolean)
    )];
    rito.taskThemes = currentThemes.length
      ? [...new Set([...currentThemes, ...inferredThemes])]
      : [...new Set([...DEFAULT_TASK_THEMES.rito, ...inferredThemes])];
  }

  function migrateFastWorkspace(rootState) {
    const fast = rootState.workspaces?.fast;
    if (!fast) return;

    const seededTasks = buildFastTaskItems();
    const dailyTasks = buildFastDailyTasksMarch30();
    const deletedSeedTaskIds = new Set(
      Array.isArray(fast.deletedSeedTaskIds)
        ? fast.deletedSeedTaskIds.map((taskId) => String(taskId || "").trim()).filter(Boolean)
        : []
    );
    const availableSeededTasks = [...seededTasks, ...dailyTasks].filter((task) => !deletedSeedTaskIds.has(String(task.id || "").trim()));
    const stableFastTaskIdsByTitle = new Map(
      availableSeededTasks.map((task) => [fastSeedTaskTitleKey(task), task.id])
    );
    const currentTasks = Array.isArray(fast.taskItems)
      ? fast.taskItems.map((task) => {
        const stableTaskId = stableFastTaskIdsByTitle.get(fastSeedTaskTitleKey(task));
        if (!stableTaskId) return task;
        return {
          ...task,
          id: stableTaskId
        };
      })
      : [];
    const currentThemes = Array.isArray(fast.taskThemes) && fast.taskThemes.length
      ? fast.taskThemes.map((theme) => String(theme || "").trim()).filter(Boolean)
      : [];
    const nextTasks = rebuildSeededKanbanTasks(currentTasks, availableSeededTasks, fastSeedTaskTitleKey);
    nextTasks.forEach((task) => {
      task.stage = normalizeFastTaskThemeName(task.stage);
    });
    fast.taskItems = dedupeKanbanTasks(nextTasks);
    fast.deletedSeedTaskIds = [...deletedSeedTaskIds];
    const inferredThemes = [...new Set(
      fast.taskItems
        .map((task) => String(normalizeFastTaskThemeName(task.stage) || "").trim())
        .filter(Boolean)
    )];
    const nextThemes = currentThemes.length
      ? [...new Set(currentThemes)]
      : [...new Set([...FAST_DAILY_THEMES, ...DEFAULT_TASK_THEMES.fast, ...inferredThemes])];
    fast.taskThemes = nextThemes.length ? nextThemes : [...DEFAULT_TASK_THEMES.fast];
    fast.members = Array.isArray(fast.members) ? fast.members : [];
  }

  function seedData() {
    const today = new Date();
    return {
      theme: "light",
      workspaceOrder: ["rito", "fast"],
      currentWorkspace: "rito",
      currentView: {
        rito: "dashboard",
        fast: "dashboard"
      },
      selectedProjectId: {
        rito: "",
        fast: ""
      },
      projectReturnView: {
        rito: "crm",
        fast: "dashboard"
      },
      dashboardFilters: {
        rito: { stage: "Todos", temp: "Todos", query: "" },
        fast: { stage: "Todos", temp: "Todos", query: "" }
      },
      pipelineFilters: {
        rito: { temp: "Todos", query: "" },
        fast: { temp: "Todos", query: "" }
      },
      referenceViewModes: {
        rito: { crm: "cards", invested: "cards" },
        fast: { crm: "cards", invested: "cards" }
      },
      taskListGroupModes: {
        rito: "theme",
        fast: "theme"
      },
      fastDashboardStatusFocus: "",
      calendarCursor: {
        rito: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
        fast: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
      },
      kanbanCompletedVisibility: {
        rito: {},
        fast: {}
      },
      sharedMembers: defaultPortalMembers(),
      workspaces: {
        rito: {
          crmItems: buildRitoReferenceCRMItems(),
          taskItems: [],
          taskThemes: [...DEFAULT_TASK_THEMES.rito],
          projectThemes: [...DEFAULT_PROJECT_THEMES.rito],
          projectBoards: {},
          documents: [],
          members: []
        },
        fast: {
          taskThemes: [...DEFAULT_TASK_THEMES.fast],
          projectThemes: [...DEFAULT_PROJECT_THEMES.fast],
          taskItems: [],
          projectBoards: {},
          documents: [],
          members: []
        }
      }
    };
  }

  let state = seedData();
  applyDefaultMemberPhotos(state);
  syncWorkspaceMemberOptions(state);

  function pruneDeprecatedWorkspaces(rootState) {
    if (!rootState || typeof rootState !== "object") return;
    delete rootState.workspaces?.atica;
    delete rootState.workspaces?.diligence;
    if (Array.isArray(rootState.workspaceOrder)) {
      rootState.workspaceOrder = rootState.workspaceOrder.filter((id) => id !== "atica" && id !== "diligence");
    }
    if (rootState.currentWorkspace === "atica" || rootState.currentWorkspace === "diligence" || !workspaceConfig[rootState.currentWorkspace]) {
      rootState.currentWorkspace = "rito";
    }
    ["currentView", "selectedProjectId", "projectReturnView", "dashboardFilters", "pipelineFilters", "referenceViewModes", "kanbanCompletedVisibility", "taskListGroupModes"].forEach((key) => {
      if (rootState[key] && typeof rootState[key] === "object") {
        delete rootState[key].atica;
        delete rootState[key].diligence;
      }
    });
  }

  function buildPortalState(snapshot = null) {
    if (!snapshot || typeof snapshot !== "object" || !Object.keys(snapshot).length) {
      const seeded = seedData();
      seeded.lastSavedAt = seeded.lastSavedAt || new Date().toISOString();
      seeded.saveRevision = portalSaveRevision(seeded);
      pruneDeprecatedWorkspaces(seeded);
      applyDefaultMemberPhotos(seeded);
      return seeded;
    }

    const base = seedData();
    const rawSnapshot = snapshot && typeof snapshot.data === "object" && !snapshot.workspaces && snapshot.data.workspaces
      ? snapshot.data
      : snapshot;
    const merged = { ...base, ...rawSnapshot };

    merged.currentView = {
      ...base.currentView,
      ...((rawSnapshot.currentView && typeof rawSnapshot.currentView === "object") ? rawSnapshot.currentView : {})
    };

    merged.selectedProjectId = {
      ...base.selectedProjectId,
      ...((rawSnapshot.selectedProjectId && typeof rawSnapshot.selectedProjectId === "object") ? rawSnapshot.selectedProjectId : {})
    };

    merged.projectReturnView = {
      ...base.projectReturnView,
      ...((rawSnapshot.projectReturnView && typeof rawSnapshot.projectReturnView === "object") ? rawSnapshot.projectReturnView : {})
    };

    merged.dashboardFilters = {
      ...base.dashboardFilters,
      ...((rawSnapshot.dashboardFilters && typeof rawSnapshot.dashboardFilters === "object") ? rawSnapshot.dashboardFilters : {})
    };

    merged.pipelineFilters = {
      ...base.pipelineFilters,
      ...((rawSnapshot.pipelineFilters && typeof rawSnapshot.pipelineFilters === "object") ? rawSnapshot.pipelineFilters : {})
    };

    merged.kanbanCompletedVisibility = {
      ...base.kanbanCompletedVisibility,
      ...((rawSnapshot.kanbanCompletedVisibility && typeof rawSnapshot.kanbanCompletedVisibility === "object") ? rawSnapshot.kanbanCompletedVisibility : {})
    };

    merged.workspaces = {
      ...base.workspaces,
      ...((rawSnapshot.workspaces && typeof rawSnapshot.workspaces === "object") ? rawSnapshot.workspaces : {})
    };

    merged.referenceViewModes = {
      ...base.referenceViewModes,
      ...((rawSnapshot.referenceViewModes && typeof rawSnapshot.referenceViewModes === "object") ? rawSnapshot.referenceViewModes : {})
    };

    merged.taskListGroupModes = {
      ...base.taskListGroupModes,
      ...((rawSnapshot.taskListGroupModes && typeof rawSnapshot.taskListGroupModes === "object") ? rawSnapshot.taskListGroupModes : {})
    };

    Object.keys(base.referenceViewModes).forEach((workspace) => {
      merged.referenceViewModes[workspace] = {
        ...base.referenceViewModes[workspace],
        ...(((rawSnapshot.referenceViewModes && typeof rawSnapshot.referenceViewModes === "object") ? rawSnapshot.referenceViewModes : {})[workspace] || {})
      };
    });

    Object.keys(base.workspaces).forEach((workspaceId) => {
      const baseWorkspace = base.workspaces[workspaceId] || {};
      const snapshotWorkspace = (merged.workspaces && typeof merged.workspaces === "object" && merged.workspaces[workspaceId] && typeof merged.workspaces[workspaceId] === "object")
        ? merged.workspaces[workspaceId]
        : {};
      merged.workspaces[workspaceId] = {
        ...baseWorkspace,
        ...snapshotWorkspace,
        crmItems: Array.isArray(snapshotWorkspace.crmItems) ? snapshotWorkspace.crmItems : (baseWorkspace.crmItems || []),
        deletedReferenceProjectKeys: Array.isArray(snapshotWorkspace.deletedReferenceProjectKeys)
          ? snapshotWorkspace.deletedReferenceProjectKeys
          : (baseWorkspace.deletedReferenceProjectKeys || []),
        taskItems: Array.isArray(snapshotWorkspace.taskItems) ? snapshotWorkspace.taskItems : (baseWorkspace.taskItems || []),
        taskThemes: Array.isArray(snapshotWorkspace.taskThemes) ? snapshotWorkspace.taskThemes : (baseWorkspace.taskThemes || []),
        projectThemes: Array.isArray(snapshotWorkspace.projectThemes) ? snapshotWorkspace.projectThemes : (baseWorkspace.projectThemes || []),
        documents: Array.isArray(snapshotWorkspace.documents) ? snapshotWorkspace.documents : (baseWorkspace.documents || []),
        members: Array.isArray(snapshotWorkspace.members) ? snapshotWorkspace.members : (baseWorkspace.members || []),
        projectBoards: snapshotWorkspace.projectBoards && typeof snapshotWorkspace.projectBoards === "object" ? snapshotWorkspace.projectBoards : (baseWorkspace.projectBoards || {})
      };
      normalizeCRMItemOrder(merged.workspaces[workspaceId].crmItems);
    });

    migrateRitoReferenceProjects(merged);
    migrateRitoKanbanTasks(merged);
    migrateFastWorkspace(merged);
    Object.values(merged.workspaces || {}).forEach((workspace) => {
      dedupeWorkspaceKanbanData(workspace);
    });
    pruneDeprecatedWorkspaces(merged);
    syncSharedMembersState(merged);
    applyDefaultMemberPhotos(merged);
    syncWorkspaceMemberOptions(merged);
    merged.lastSavedAt = merged.lastSavedAt || new Date().toISOString();
    merged.saveRevision = portalSaveRevision(merged);
    return merged;
  }

  function unwrapPortalSnapshot(snapshot = null) {
    if (!snapshot || typeof snapshot !== "object") return null;
    if (!snapshot.workspaces && snapshot.data && typeof snapshot.data === "object") {
      return snapshot.data;
    }
    return snapshot;
  }

  function hasMeaningfulPortalData(snapshot = null) {
    const rawSnapshot = unwrapPortalSnapshot(snapshot);
    if (!rawSnapshot || typeof rawSnapshot !== "object") return false;
    const workspaces = rawSnapshot.workspaces;
    if (!workspaces || typeof workspaces !== "object") return false;
    return Object.values(workspaces).some((workspace) => {
      if (!workspace || typeof workspace !== "object") return false;
      if (Array.isArray(workspace.crmItems) && workspace.crmItems.length) return true;
      if (Array.isArray(workspace.taskItems) && workspace.taskItems.length) return true;
      if (Array.isArray(workspace.documents) && workspace.documents.length) return true;
      if (Array.isArray(workspace.members) && workspace.members.length) return true;
      if (workspace.projectBoards && typeof workspace.projectBoards === "object" && Object.keys(workspace.projectBoards).length) return true;
      return false;
    });
  }

  function portalDataScore(snapshot = null) {
    const rawSnapshot = unwrapPortalSnapshot(snapshot);
    if (!rawSnapshot || typeof rawSnapshot !== "object") return 0;
    const workspaces = rawSnapshot.workspaces;
    if (!workspaces || typeof workspaces !== "object") return 0;
    return Object.values(workspaces).reduce((score, workspace) => {
      if (!workspace || typeof workspace !== "object") return score;
      score += Array.isArray(workspace.crmItems) ? workspace.crmItems.length * 10 : 0;
      score += Array.isArray(workspace.taskItems) ? workspace.taskItems.length * 3 : 0;
      score += Array.isArray(workspace.documents) ? workspace.documents.length * 2 : 0;
      score += Array.isArray(workspace.members) ? workspace.members.length : 0;
      score += workspace.projectBoards && typeof workspace.projectBoards === "object"
        ? Object.values(workspace.projectBoards).reduce((boardScore, board) => boardScore + (Array.isArray(board) ? board.length * 2 : 0), 0)
        : 0;
      return score;
    }, 0);
  }

  function portalSnapshotCounts(snapshot = null) {
    const rawSnapshot = unwrapPortalSnapshot(snapshot);
    return {
      ritoDeals: rawSnapshot?.workspaces?.rito?.crmItems?.length || 0,
      fastTasks: rawSnapshot?.workspaces?.fast?.taskItems?.length || 0,
      aticaDeals: rawSnapshot?.workspaces?.atica?.crmItems?.length || 0
    };
  }

  function updateRecoveryDiagnostics(patch = {}) {
    const current = window.__PORTAL_RECOVERY_DIAGNOSTICS__ || {};
    window.__PORTAL_RECOVERY_DIAGNOSTICS__ = {
      ...current,
      ...patch,
      counts: {
        ...(current.counts || {}),
        ...(patch.counts || {})
      },
      notes: [
        ...((current.notes || []).slice(-4)),
        ...((patch.notes || []).slice(-4))
      ].slice(-8)
    };
  }

  function parsePortalBackupPayload(payload = "") {
    if (typeof payload !== "string") return null;
    const sanitized = payload.replace(/^\uFEFF/, "").trim();
    if (!sanitized) return null;

    const normalized = sanitized.startsWith("window.__PORTAL_RECOVERED_STATE__")
      ? sanitized.replace(/^window\.__PORTAL_RECOVERED_STATE__\s*=\s*/, "").replace(/;\s*$/, "")
      : sanitized;

    try {
      const parsed = JSON.parse(normalized);
      return hasMeaningfulPortalData(parsed) ? parsed : null;
    } catch (error) {
      console.warn("Não foi possível interpretar o conteúdo bruto do backup do portal.", error);
      return null;
    }
  }

  async function loadBundledPortalBackup() {
    try {
      const bundledState = window.__PORTAL_RECOVERED_STATE__;
      if (hasMeaningfulPortalData(bundledState)) {
        updateRecoveryDiagnostics({
          source: "embedded-window-object",
          recoveredScore: portalDataScore(bundledState),
          counts: portalSnapshotCounts(bundledState),
          notes: ["Backup embutido lido de window.__PORTAL_RECOVERED_STATE__."]
        });
        return bundledState;
      }
      if (typeof bundledState === "string") {
        const parsedBundledState = parsePortalBackupPayload(bundledState);
        if (parsedBundledState) {
          updateRecoveryDiagnostics({
            source: "embedded-window-string",
            recoveredScore: portalDataScore(parsedBundledState),
            counts: portalSnapshotCounts(parsedBundledState),
            notes: ["Backup embutido em string interpretado com sucesso."]
          });
          return parsedBundledState;
        }
      }
    } catch (error) {
      console.warn("Não foi possível acessar o backup embutido do portal.", error);
    }

    try {
      const response = await fetch("./recovered-portal-state.json", {
        cache: "no-store"
      });
      if (!response.ok) return null;
      const rawText = await response.text();
      const parsedJsonBackup = parsePortalBackupPayload(rawText);
      if (parsedJsonBackup) {
        updateRecoveryDiagnostics({
          source: "json-file",
          recoveredScore: portalDataScore(parsedJsonBackup),
          counts: portalSnapshotCounts(parsedJsonBackup),
          notes: ["Backup local carregado via recovered-portal-state.json."]
        });
        return parsedJsonBackup;
      }
    } catch (error) {
      console.warn("Não foi possível carregar o backup local do portal.", error);
    }

    try {
      const response = await fetch("./recovered-portal-state.js", {
        cache: "no-store"
      });
      if (!response.ok) return null;
      const rawText = await response.text();
      const parsedScriptBackup = parsePortalBackupPayload(rawText);
      if (parsedScriptBackup) {
        updateRecoveryDiagnostics({
          source: "js-file",
          recoveredScore: portalDataScore(parsedScriptBackup),
          counts: portalSnapshotCounts(parsedScriptBackup),
          notes: ["Backup local carregado via recovered-portal-state.js."]
        });
        return parsedScriptBackup;
      }
    } catch (error) {
      console.warn("Não foi possível carregar o script local de recuperação do portal.", error);
    }

    return null;
  }

  function finalizeLoadedPortalState(snapshot, sourceLabel = "unknown") {
    const builtState = buildPortalState(snapshot);
    lastLoadedPortalSource = sourceLabel;
    updateRecoveryDiagnostics({
      source: sourceLabel,
      finalScore: portalDataScore(builtState),
      counts: portalSnapshotCounts(builtState)
    });
    return builtState;
  }

  async function loadState() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await loadSharedPortalState({ useCache: attempt === 0 });
        const remoteState = data?.data && Object.keys(data.data).length ? data.data : null;
        const localState = loadLocalPortalState();
        const recoveredState = await loadBundledPortalBackup();
        const remoteScore = portalDataScore(remoteState);
        const localScore = portalDataScore(localState);
        const recoveredScore = portalDataScore(recoveredState);
        updateRecoveryDiagnostics({
          remoteScore,
          localScore,
          recoveredScore,
          notes: [`Tentativa ${attempt + 1}: remoto=${remoteScore}, local=${localScore}, backup=${recoveredScore}`]
        });

        const hydratedRemoteState = mergePortalMembersFromFallback(remoteState, recoveredState);
        const hydratedLocalState = mergePortalMembersFromFallback(localState, recoveredState);
        // Nuvem é a fonte da verdade — preferir remoto sobre local sempre que a nuvem tiver dados
        const cloudHasData = hasMeaningfulPortalData(hydratedRemoteState);
        const preferredState = cloudHasData ? hydratedRemoteState : hydratedLocalState;

        if (hasMeaningfulPortalData(preferredState)) {
          const sourceLabel = cloudHasData ? "remote-state" : "local-state";
          const finalizedState = finalizeLoadedPortalState(preferredState, sourceLabel);
          saveLocalPortalState(finalizedState);
          return finalizedState;
        }
        if (recoveredState) {
          console.warn("Estado remoto vazio. Restaurando portal a partir do backup local empacotado.");
          const restoredState = finalizeLoadedPortalState(recoveredState, "backup-remote-empty");
          saveLocalPortalState(restoredState);
          return restoredState;
        }
        const seededState = finalizeLoadedPortalState(remoteState, "remote-empty-seeded");
        saveLocalPortalState(seededState);
        return seededState;
      } catch (error) {
        if (attempt === 1) {
          const localState = loadLocalPortalState();
          if (hasMeaningfulPortalData(localState)) {
            console.warn("Leitura remota falhou. Carregando portal a partir do snapshot local apenas como contingencia.");
            const finalizedLocalState = finalizeLoadedPortalState(localState, "local-after-remote-failure");
            saveLocalPortalState(finalizedLocalState);
            return finalizedLocalState;
          }
          const recoveredState = await loadBundledPortalBackup();
          if (recoveredState) {
            console.warn("Leitura remota falhou. Carregando portal a partir do backup local empacotado.");
            return finalizeLoadedPortalState(recoveredState, "backup-after-remote-failure");
          }
          throw error;
        }
        await delay(250 * (attempt + 1));
      }
    }
    throw new Error("Não foi possível carregar o estado do portal no Supabase.");
  }

  function saveState(options = {}) {
    const instant = options.instant !== false;
    stampPortalState(state);
    saveLocalPortalState(state);
    clearTimeout(_debouncedSaveTimer);
    if (!instant) {
      _debouncedSaveTimer = window.setTimeout(() => {
        _debouncedSaveTimer = null;
        void queueImmediateRemoteSave(state);
      }, SAVE_DEBOUNCE_MS);
      return Promise.resolve(state);
    }
    _debouncedSaveTimer = null;
    return persistPortalStateImmediately(state);
  }

  function mergeKanbanTaskRecords(previousTask = {}, nextTask = {}) {
    const merged = { ...previousTask, ...nextTask };
    Object.keys(previousTask || {}).forEach((key) => {
      const value = merged[key];
      if (value === undefined || value === null) {
        merged[key] = previousTask[key];
        return;
      }
      if (typeof value === "string" && !value.trim() && typeof previousTask[key] === "string" && previousTask[key].trim()) {
        merged[key] = previousTask[key];
      }
    });
    return merged;
  }

  function mergeSeededKanbanTaskRecords(existingTask = {}, seededTask = {}) {
    const existingIsNewerThanSeed = recordTimestampValue(existingTask) > recordTimestampValue(seededTask);
    const merged = existingIsNewerThanSeed
      ? { ...seededTask, ...existingTask, id: seededTask.id }
      : { ...existingTask, ...seededTask, id: seededTask.id };
    if (!existingIsNewerThanSeed) {
      ["status", "dueDate", "completionDate", "completedAt", "archivedAt"].forEach((field) => {
        const value = existingTask?.[field];
        if (typeof value === "string" ? value.trim() : value) {
          merged[field] = value;
        }
      });
    }
    if (Array.isArray(existingTask?.history) && existingTask.history.length) {
      merged.history = existingTask.history;
    }
    return merged;
  }

  function rebuildSeededKanbanTasks(existingTasks = [], seededTasks = [], titleKeyResolver = (task) => normalizeColumnKey(task?.title)) {
    const remainingTasks = Array.isArray(existingTasks) ? [...existingTasks] : [];
    const mergedSeededTasks = seededTasks.map((seededTask) => {
      const seededId = String(seededTask?.id || "").trim();
      const seededTitleKey = titleKeyResolver(seededTask);
      const matchIndex = remainingTasks.findIndex((task) => {
        if (!task || typeof task !== "object") return false;
        const taskId = String(task.id || "").trim();
        if (seededId && taskId && taskId === seededId) return true;
        return seededTitleKey && titleKeyResolver(task) === seededTitleKey;
      });
      if (matchIndex === -1) return seededTask;
      const [matchedTask] = remainingTasks.splice(matchIndex, 1);
      return mergeSeededKanbanTaskRecords(matchedTask, seededTask);
    });
    return dedupeKanbanTasks([...mergedSeededTasks, ...remainingTasks]);
  }

  function dedupeKanbanTasks(tasks = []) {
    const uniqueTasks = [];
    const taskIndexById = new Map();
    (tasks || []).forEach((task) => {
      if (!task || typeof task !== "object") return;
      const taskId = String(task.id || "").trim();
      if (!taskId) {
        uniqueTasks.push(task);
        return;
      }
      if (!taskIndexById.has(taskId)) {
        taskIndexById.set(taskId, uniqueTasks.length);
        uniqueTasks.push(task);
        return;
      }
      const index = taskIndexById.get(taskId);
      uniqueTasks[index] = mergeKanbanTaskRecords(uniqueTasks[index], task);
    });
    return uniqueTasks;
  }

  function dedupeWorkspaceKanbanData(workspace) {
    if (!workspace || typeof workspace !== "object") return;
    workspace.taskItems = dedupeKanbanTasks(workspace.taskItems || []);
    workspace.projectBoards = workspace.projectBoards && typeof workspace.projectBoards === "object" ? workspace.projectBoards : {};
    Object.keys(workspace.projectBoards).forEach((projectName) => {
      workspace.projectBoards[projectName] = dedupeKanbanTasks(workspace.projectBoards[projectName] || []);
    });
  }

  function persistKanbanStateOptimistically(options = {}) {
    const {
      instant = true,
      rollbackState = clonePortalState(state),
      rollbackMessage = "Nao foi possível salvar a alteração no Kanban. O último estado salvo foi restaurado.",
      onRollback = null
    } = options;
    stampPortalState(state);
    const pendingSave = instant
      ? triggerInstantRemoteSave(state)
      : queueImmediateRemoteSave(state);
    return pendingSave.catch((error) => {
      console.error("Falha ao persistir alteração do Kanban.", error);
      state = buildPortalState(rollbackState);
      if (typeof onRollback === "function") onRollback(error);
      renderAppPreservingScroll();
      alert(rollbackMessage);
      throw error;
    });
  }

  function workspaceTaskThemes(workspaceId = state.currentWorkspace) {
    const data = state.workspaces[workspaceId];
    if (!data.taskThemes || !data.taskThemes.length) data.taskThemes = [...(DEFAULT_TASK_THEMES[workspaceId] || ["Geral"])];
    return data.taskThemes;
  }

  function workspaceTaskThemeColors(workspaceId = state.currentWorkspace) {
    const data = state.workspaces[workspaceId];
    const themes = workspaceTaskThemes(workspaceId);
    if (!data.taskThemeColors || !data.taskThemeColors.length) {
      data.taskThemeColors = themes.map((_, index) => DEFAULT_KANBAN_THEME_COLORS[index % DEFAULT_KANBAN_THEME_COLORS.length]);
    }
    while (data.taskThemeColors.length < themes.length) {
      data.taskThemeColors.push(DEFAULT_KANBAN_THEME_COLORS[data.taskThemeColors.length % DEFAULT_KANBAN_THEME_COLORS.length]);
    }
    if (data.taskThemeColors.length > themes.length) {
      data.taskThemeColors = data.taskThemeColors.slice(0, themes.length);
    }
    return data.taskThemeColors;
  }

  function workspaceProjectThemes(workspaceId = state.currentWorkspace) {
    const data = state.workspaces[workspaceId];
    if (!data.projectThemes || !data.projectThemes.length) data.projectThemes = [...(DEFAULT_PROJECT_THEMES[workspaceId] || ["Operacao", "Financeiro", "Comercial"])];
    return data.projectThemes;
  }

  function normalizeColumnKey(value = "") {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function inferThemeFromTask(task, themes) {
    const haystack = [task.title, task.owner, ...(task.tags || [])].join(" ").toLowerCase();
    const matched = themes.find((theme) => {
      const tokens = theme.toLowerCase().split(/[\s/]+/).filter(Boolean);
      return tokens.some((token) => token.length > 2 && haystack.includes(token));
    });
    return matched || themes[0] || "Geral";
  }

  function normalizeKanbanTask(task, themes) {
    const directMatch = themes.find((theme) => theme === task.stage);
    const canonicalStage = normalizeFastTaskThemeName(task.stage);
    const normalizedMatch = themes.find((theme) =>
      normalizeColumnKey(theme) === normalizeColumnKey(task.stage) ||
      normalizeColumnKey(normalizeFastTaskThemeName(theme)) === normalizeColumnKey(canonicalStage)
    );
    if (normalizedMatch && !directMatch) {
      task.stage = normalizedMatch;
    } else if (!task.stage || !directMatch) {
      task.stage = inferThemeFromTask(task, themes);
    }
    if (!task.status) task.status = "A Fazer";
    if (!task.priority) task.priority = "Media";
    if (!task.tags) task.tags = [];
    if (!("completionDate" in task)) task.completionDate = "";
    if (!("recurrence" in task)) task.recurrence = "Nenhuma";
    if (!("recurrenceAnchorDate" in task)) task.recurrenceAnchorDate = normalizeDateInputValue(task.dueDate || "");
    if (!("lastRecurrenceResetAt" in task)) task.lastRecurrenceResetAt = "";
    if (!task.createdAt) task.createdAt = "2026-04-20";
    if (!task.updatedAt) task.updatedAt = task.createdAt || "2026-04-20";
    refreshRecurringTask(task);
  }

  function touchKanbanTask(task) {
    if (!task || typeof task !== "object") return;
    if (!task.createdAt) task.createdAt = "2026-04-20";
    task.updatedAt = new Date().toISOString();
  }

  function canonicalTaskStatus(status = "") {
    const value = String(status || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (value === "concluido" || value === "concluida") return "Concluido";
    if (value === "pausado" || value === "pausada") return "Pausado";
    if (value === "revisao" || value === "aguardando") return "Revisao";
    if (value === "a fazer" || value === "a-fazer" || value === "nao iniciado" || value === "não iniciado") return "A fazer";
    if (value === "em andamento" || value === "em execucao" || value === "em execução" || value === "atrasado") return "Em andamento";
    return "A fazer";
  }

  function canonicalTaskRecurrence(value = "") {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (!normalized || normalized === "nenhuma" || normalized === "nao recorrente") return "Nenhuma";
    if (normalized === "diaria" || normalized === "diario" || normalized === "diariamente") return "Diária";
    if (normalized === "semanal" || normalized === "semanalmente") return "Semanal";
    if (normalized === "quinzenal" || normalized === "quinzenalmente") return "Quinzenal";
    if (normalized === "mensal" || normalized === "mensalmente") return "Mensal";
    return "Nenhuma";
  }

  function recurrenceDays(recurrence = "") {
    const canonical = canonicalTaskRecurrence(recurrence);
    if (canonical === "Diária") return 1;
    if (canonical === "Semanal") return 7;
    if (canonical === "Quinzenal") return 14;
    return 0;
  }

  function addDaysISO(dateText, days) {
    const normalized = normalizeDateInputValue(dateText);
    if (!normalized || !Number.isFinite(days)) return normalized;
    const [year, month, day] = normalized.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addMonthsISO(dateText, months = 1) {
    const normalized = normalizeDateInputValue(dateText);
    if (!normalized) return normalized;
    const [year, month, day] = normalized.split("-").map(Number);
    const targetMonthIndex = month - 1 + months;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
    const safeDay = Math.min(day, lastDay);
    return `${targetYear}-${String(normalizedMonthIndex + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
  }

  function nextRecurringDueDate(fromDate, recurrence) {
    const canonical = canonicalTaskRecurrence(recurrence);
    if (canonical === "Mensal") return addMonthsISO(fromDate, 1);
    const days = recurrenceDays(canonical);
    return days ? addDaysISO(fromDate, days) : normalizeDateInputValue(fromDate);
  }

  function refreshRecurringTask(task) {
    if (!task || typeof task !== "object") return;
    const recurrence = canonicalTaskRecurrence(task.recurrence);
    task.recurrence = recurrence;
    if (recurrence === "Nenhuma") return;
    const baseDate = normalizeDateInputValue(task.recurrenceAnchorDate || task.dueDate || task.createdAt || todayISO()) || todayISO();
    if (!task.recurrenceAnchorDate) task.recurrenceAnchorDate = baseDate;
    const isCompleted = canonicalTaskStatus(task.status) === "Concluido";
    if (!isCompleted) return;
    const pivotDate = normalizeDateInputValue(task.completionDate || task.dueDate || baseDate) || baseDate;
    let nextDueDate = nextRecurringDueDate(baseDate, recurrence);
    let guard = 0;
    while (nextDueDate && nextDueDate <= pivotDate && guard < 48) {
      nextDueDate = nextRecurringDueDate(nextDueDate, recurrence);
      guard += 1;
    }
    if (!nextDueDate) return;
    if (task.lastRecurrenceResetAt === nextDueDate) return;
    task.dueDate = nextDueDate;
    task.recurrenceAnchorDate = nextDueDate;
    task.status = nextDueDate < todayISO() ? "Atrasado" : "A Fazer";
    task.completionDate = "";
    task.lastRecurrenceResetAt = nextDueDate;
    touchKanbanTask(task);
  }

  function taskStatusSummary(tasks = []) {
    return (tasks || []).reduce((summary, task) => {
      const key = canonicalTaskStatus(task?.status);
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {
      "A fazer": 0,
      "Em andamento": 0,
      Pausado: 0,
      Revisao: 0,
      Concluido: 0
    });
  }

  function ensureWorkspaceKanbans(workspaceId = state.currentWorkspace) {
    const data = state.workspaces[workspaceId];
    if (!data) return;
    const taskThemes = workspaceTaskThemes(workspaceId);
    const projectThemes = workspaceProjectThemes(workspaceId);
    (data.taskItems || []).forEach((task) => normalizeKanbanTask(task, taskThemes));
    Object.values(data.projectBoards || {}).forEach((list) => {
      (list || []).forEach((task) => normalizeKanbanTask(task, projectThemes));
    });
  }

  function currency(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value || 0);
  }

  function parseLocaleNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatLocaleNumber(value) {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(parseLocaleNumber(value));
  }

  const PORTAL_PT_BR_REPLACEMENTS = [
    [/\bAtica\b/g, "Ática"],
    [/\bGestao\b/g, "Gestão"],
    [/\bgestao\b/g, "gestão"],
    [/\bPortfolio\b/g, "Portfólio"],
    [/\bOperacao\b/g, "Operação"],
    [/\boperacao\b/g, "operação"],
    [/\bOperacoes\b/g, "Operações"],
    [/\boperacoes\b/g, "operações"],
    [/\bExpansao\b/g, "Expansão"],
    [/\bexpansao\b/g, "expansão"],
    [/\bCalendario\b/g, "Calendário"],
    [/\bConfiguracoes\b/g, "Configurações"],
    [/\bDescricao\b/g, "Descrição"],
    [/\bdescricao\b/g, "descrição"],
    [/\bSubtitulo\b/g, "Subtítulo"],
    [/\bTitulo\b/g, "Título"],
    [/\btitulo\b/g, "título"],
    [/\bEstagio\b/g, "Estágio"],
    [/\bestagio\b/g, "estágio"],
    [/\bLocalizacao\b/g, "Localização"],
    [/\blocalizacao\b/g, "localização"],
    [/\bResponsavel\b/g, "Responsável"],
    [/\bresponsavel\b/g, "responsável"],
    [/\bConclusao\b/g, "Conclusão"],
    [/\bconclusao\b/g, "conclusão"],
    [/\bJuridico\b/g, "Jurídico"],
    [/\bEstrategico\b/g, "Estratégico"],
    [/\bGovernanca\b/g, "Governança"],
    [/\bRevisao\b/g, "Revisão"],
    [/\bConcluido\b/g, "Concluído"],
    [/\bConcluidos\b/g, "Concluídos"],
    [/\bHistorico\b/g, "Histórico"],
    [/\bcaptacao\b/g, "captação"],
    [/\bCaptacao\b/g, "Captação"],
    [/\bInformacoes\b/g, "Informações"],
    [/\bNegocio\b/g, "Negócio"],
    [/\bnegocio\b/g, "negócio"],
    [/\bObservacoes\b/g, "Observações"],
    [/\bProjecao\b/g, "Projeção"],
    [/\bMidia\b/g, "Mídia"],
    [/\bmidia\b/g, "mídia"],
    [/\bNao\b/g, "Não"],
    [/\bnao\b/g, "não"],
    [/\bMedia\b/g, "Média"],
    [/\bmedia\b/g, "média"],
    [/\bGoiania\b/g, "Goiânia"],
    [/\bGoias\b/g, "Goiás"],
    [/\bMarcio\b/g, "Márcio"],
    [/\bAndre\b/g, "André"],
    [/\bSao\b/g, "São"],
    [/\bCosmeticos\b/g, "Cosméticos"],
    [/\bEducacao\b/g, "Educação"],
    [/\bNutricao\b/g, "Nutrição"],
    [/\bServicos\b/g, "Serviços"],
    [/\bservicos\b/g, "serviços"],
    [/\bImobiliario\b/g, "Imobiliário"],
    [/\bGraos\b/g, "Grãos"],
    [/\bgraos\b/g, "grãos"],
    [/\bLiofilizacao\b/g, "Liofilização"],
    [/\btecnologica\b/g, "tecnológica"],
    [/\btecnologico\b/g, "tecnológico"],
    [/\bSaude\b/g, "Saúde"],
    [/\bsaude\b/g, "saúde"],
    [/\bserao\b/g, "serão"],
    [/\bOrcar\b/g, "Orçar"],
    [/\borcar\b/g, "orçar"],
    [/\bestagiario\b/g, "estagiário"],
    [/\bfuncionarias\b/g, "funcionárias"],
    [/\bgrafico\b/g, "gráfico"],
    [/\bregiao\b/g, "região"],
    [/\boleos\b/g, "óleos"],
    [/\bmaquina\b/g, "máquina"],
    [/\bautomatico\b/g, "automático"],
    [/\bbancarias\b/g, "bancárias"],
    [/\bdiario\b/g, "diário"],
    [/\bposicao\b/g, "posição"],
    [/\btransacao\b/g, "transação"],
    [/\blogistica\b/g, "logística"],
    [/\bconcentracao\b/g, "concentração"],
    [/\bdinamicos\b/g, "dinâmicos"],
    [/\bacoes\b/g, "ações"],
    [/\brapidas\b/g, "rápidas"],
    [/\bproximos\b/g, "próximos"],
    [/\breuniao\b/g, "reunião"],
    [/\bdeliberacao\b/g, "deliberação"],
    [/\btecnica\b/g, "técnica"],
    [/\btecnico\b/g, "técnico"],
    [/\btributario\b/g, "tributário"],
    [/\bconversao\b/g, "conversão"],
    [/\bdistribuicao\b/g, "distribuição"],
    [/\bvisao\b/g, "visão"],
    [/\bCriticas\b/g, "Críticas"],
    [/\bcriticas\b/g, "críticas"],
    [/\brapido\b/g, "rápido"],
    [/\bsensiveis\b/g, "sensíveis"],
    [/\bconcluidas\b/g, "concluídas"],
    [/\bExperiencia\b/g, "Experiência"],
    [/\bexperiencia\b/g, "experiência"],
    [/\bLinguistica\b/g, "Linguística"],
    [/\blinguistica\b/g, "linguística"],
    [/\bFranquias \/ Wellness\b/g, "Franquias / Wellness"],
    [/\bBuy-side\b/g, "Buy-side"],
    [/\bSell Side\b/g, "Sell-side"]
  ];

  function normalizePortalPortugueseText(value) {
    let text = String(value ?? "");
    PORTAL_PT_BR_REPLACEMENTS.forEach(([pattern, replacement]) => {
      text = text.replace(pattern, replacement);
    });
    return text
      .replace(/[^\S\r\n]+([,.;:!?])/g, "$1")
      .replace(/([(\[{])[^\S\r\n]+/g, "$1")
      .replace(/[^\S\r\n]+([)\]}])/g, "$1")
      .replace(/[^\S\r\n]{2,}/g, " ");
  }

  function displayText(value) {
    return normalizePortalPortugueseText(value);
  }

  function initials(name) {
    return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  }

  function tagChipClass(tag) {
    const value = String(tag || "").trim().toLowerCase();
    if (!value) return "chip-neutral";
    if (value.includes("private equity") || value.includes("venture capital") || value.includes("vc")) return "chip-blue";
    if (value.includes("investido") || value.includes("portfolio")) return "chip-gold";
    if (value.includes("servicos") || value.includes("saude") || value.includes("bem-estar") || value.includes("wellness")) return "chip-green";
    if (value.includes("pipeline") || value.includes("morno")) return "chip-stone";
    if (value.includes("lead")) return "chip-sand";
    if (value.includes("declinado") || value.includes("declined")) return "chip-rose";
    if (value.includes("frio")) return "chip-ice";
    if (value.includes("loi")) return "chip-lavender";
    if (value.includes("due diligence")) return "chip-mint";
    if (value.includes("software") || value.includes("crm") || value.includes("ia")) return "chip-indigo";
    if (value.includes("mobilidade") || value.includes("energia")) return "chip-sky";
    if (value.includes("industria") || value.includes("bioativos") || value.includes("liofilizacao")) return "chip-emerald";
    if (value.includes("fitness") || value.includes("franquias")) return "chip-peach";
    return "chip-neutral";
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeDateInputValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const [, day, month, year] = brMatch;
      return `${year}-${month}-${day}`;
    }
    return raw;
  }

  const RITO_PRIORITY_PIPELINE_ORDER = [
    "Pop Move",
    "Geral / Braslar",
    "Fox Graos",
    "Bioativos & Liofilizacao"
  ];

  function workspaceData() {
    ensureWorkspaceKanbans(state.currentWorkspace);
    return state.workspaces[state.currentWorkspace];
  }

  function calendarCursorValue(workspaceId = state.currentWorkspace) {
    if (!state.calendarCursor || typeof state.calendarCursor !== "object") {
      state.calendarCursor = {};
    }
    if (!state.calendarCursor[workspaceId]) {
      const today = new Date();
      state.calendarCursor[workspaceId] = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    }
    return state.calendarCursor[workspaceId];
  }

  function shiftCalendarCursor(offset, workspaceId = state.currentWorkspace) {
    const [yearText, monthText] = calendarCursorValue(workspaceId).split("-");
    const base = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
    state.calendarCursor[workspaceId] = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
    saveState();
    renderApp();
  }

  function resetCalendarCursor(workspaceId = state.currentWorkspace) {
    const today = new Date();
    state.calendarCursor[workspaceId] = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    saveState();
    renderApp();
  }

  function calendarTaskEntries() {
    return allWorkspaceTasksWithProjectContext().filter((task) => normalizeDateInputValue(task.dueDate));
  }

  function allWorkspaceTasksWithProjectContext(workspaceId = state.currentWorkspace) {
    const data = state.workspaces[workspaceId] || {};
    const directTasks = (data.taskItems || []).map((task) => ({
      ...task,
      projectName: "",
      isProjectTask: false
    }));
    const projectTasks = Object.entries(data.projectBoards || {}).flatMap(([projectName, tasks]) =>
      (tasks || []).map((task) => ({
        ...task,
        projectName,
        isProjectTask: true
      }))
    );
    return [...directTasks, ...projectTasks];
  }

  function workspaceKanbanCompletedVisibility(workspaceId = state.currentWorkspace) {
    if (!state.kanbanCompletedVisibility) {
      state.kanbanCompletedVisibility = { rito: {}, atica: {}, fast: {} };
    }
    if (!state.kanbanCompletedVisibility[workspaceId]) {
      state.kanbanCompletedVisibility[workspaceId] = {};
    }
    return state.kanbanCompletedVisibility[workspaceId];
  }

  function isCompletedTaskStatus(status = "") {
    return ["concluido", "concluído"].includes(String(status || "").trim().toLowerCase());
  }

  function prioritizedRitoPipelineItems(items = []) {
    return [...(items || [])].sort((a, b) => {
      const left = Number.isFinite(Number(a?.orderIndex)) ? Number(a.orderIndex) : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(Number(b?.orderIndex)) ? Number(b.orderIndex) : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return 0;
    });
  }

  function findCRMItemForReferenceCard(card) {
    if (!card || Array.isArray(card) || typeof card !== "object") return null;
    const crmItems = Array.isArray(workspaceData().crmItems) ? workspaceData().crmItems : [];
    const cardId = String(card.id || "").trim();
    if (cardId) {
      const byId = crmItems.find((item) => String(item?.id || "").trim() === cardId);
      if (byId) return byId;
    }
    const cardReferenceKey = normalizeReferenceIdentity(card.referenceKey || "");
    if (cardReferenceKey) {
      const byReferenceKey = crmItems.find((item) => normalizeReferenceIdentity(item?.referenceKey || "") === cardReferenceKey);
      if (byReferenceKey) return byReferenceKey;
    }
    const cardName = displayText(card.name || "").trim();
    if (!cardName) return null;
    return crmItems.find((item) => displayText(item?.name || "").trim() === cardName) || null;
  }

  function investedProjects(items) {
    return (items || []).filter((item) =>
      item &&
      !Array.isArray(item) &&
      typeof item === "object" &&
      isInvestedProjectRecord(item)
    );
  }

  function projectAllocationValue(item) {
    return Number(item?.investmentAmount || 0);
  }

  function allocatedPortfolioValue(items = workspaceData().crmItems || []) {
    return (items || [])
      .filter((item) => isInvestedProjectRecord(item))
      .reduce((sum, item) => sum + projectAllocationValue(item), 0);
  }

  function projectedAllocationValue(items = workspaceData().crmItems || []) {
    return (items || [])
      .filter((item) => !isInvestedProjectRecord(item))
      .reduce((sum, item) => sum + projectAllocationValue(item), 0);
  }

  function activeProjectBoardEntries(data = workspaceData()) {
    const investedItems = investedProjects(data.crmItems || []);
    const investedNames = new Set(investedItems.map((item) => item.name));
    data.projectBoards = data.projectBoards || {};
    Object.keys(data.projectBoards).forEach((projectName) => {
      if (!investedNames.has(projectName)) delete data.projectBoards[projectName];
    });
    investedItems.forEach((item) => {
      if (!data.projectBoards[item.name]) data.projectBoards[item.name] = [];
    });
    return investedItems.map((item) => [item.name, data.projectBoards[item.name] || [], item]);
  }

  function getSelectedProject() {
    return (workspaceData().crmItems || []).find((item) =>
      item &&
      !Array.isArray(item) &&
      typeof item === "object" &&
      item.id === state.selectedProjectId[state.currentWorkspace]
    );
  }

  function dashboardFilterState() {
    if (!state.dashboardFilters) {
      state.dashboardFilters = {
        rito: { stage: "Todos", temp: "Todos", query: "", owner: "Todos" },
        atica: { stage: "Todos", temp: "Todos", query: "", owner: "Todos" },
        fast: { stage: "Todos", temp: "Todos", query: "", owner: "Todos" }
      };
    }
    if (!state.dashboardFilters[state.currentWorkspace]) {
      state.dashboardFilters[state.currentWorkspace] = { stage: "Todos", temp: "Todos", query: "", owner: "Todos" };
    }
    if (!Object.prototype.hasOwnProperty.call(state.dashboardFilters[state.currentWorkspace], "owner")) {
      state.dashboardFilters[state.currentWorkspace].owner = "Todos";
    }
    return state.dashboardFilters[state.currentWorkspace];
  }

  function pipelineFilterState() {
    if (!state.pipelineFilters) {
      state.pipelineFilters = {
        rito: { temp: "Todos", query: "" },
        atica: { temp: "Todos", query: "" },
        fast: { temp: "Todos", query: "" }
      };
    }
    if (!state.pipelineFilters[state.currentWorkspace]) {
      state.pipelineFilters[state.currentWorkspace] = { temp: "Todos", query: "" };
    }
    return state.pipelineFilters[state.currentWorkspace];
  }

  function normalizeRitoFilterTemperature(value = "") {
    const normalized = String(value || "").trim();
    if (normalized === "Declinada") return "Declinado";
    if (normalized === "Investida") return "Investido";
    return normalized;
  }

  function cardTemperature(card) {
    if (card.status) return temperatureFromRitoDealStatus(card.status);
    if (card.temperature) return normalizeRitoFilterTemperature(card.temperature);
    if ((card.tags || []).includes("Quente")) return "Quente";
    if ((card.tags || []).includes("Fechamento")) return "Fechamento";
    if ((card.tags || []).includes("Morno")) return "Morno";
    if ((card.tags || []).includes("Investido") || (card.tags || []).includes("Investida")) return "Investido";
    if ((card.tags || []).includes("Declinado") || (card.tags || []).includes("Declinada")) return "Declinado";
    if ((card.tags || []).includes("Exit")) return "Exit";
    return "Frio";
  }

  function getFilteredRitoPipelineCards() {
    const filters = pipelineFilterState();
    const query = String(filters.query || "").trim().toLowerCase();
    return getRitoReferenceCards().filter((card) => {
      const tempMatch = filters.temp === "Todos" || cardTemperature(card) === filters.temp;
      const haystack = [
        card.name,
        card.subtitle,
        card.owner,
        ...(card.tags || [])
      ].join(" ").toLowerCase();
      const queryMatch = !query || haystack.includes(query);
      return tempMatch && queryMatch;
    });
  }

  function renderRitoPipelineToolbar() {
    const filters = pipelineFilterState();
    const row = document.createElement("section");
    row.className = "reference-toolbar rito-pipeline-toolbar";
    row.innerHTML = `
      <div class="toolbar-left">
        <span class="eyebrow">Temperatura</span>
        <div class="pill-group">
          <button class="soft-pill filter-chip-quente ${filters.temp === "Quente" ? "is-active" : ""}" data-pipeline-temp="Quente" type="button">Quente</button>
          <button class="soft-pill filter-chip-morno ${filters.temp === "Morno" ? "is-active" : ""}" data-pipeline-temp="Morno" type="button">Morno</button>
          <button class="soft-pill filter-chip-frio ${filters.temp === "Frio" ? "is-active" : ""}" data-pipeline-temp="Frio" type="button">Frio</button>
        </div>
      </div>
      <label class="search-field top-search"><input data-pipeline-search type="search" placeholder="Buscar empresa, contato..." value="${escapeAttr(filters.query || "")}"></label>
    `;

    row.querySelector("[data-pipeline-search]").addEventListener("input", (event) => {
      pipelineFilterState().query = event.target.value;
      saveState();
      updateRitoPipelineView();
    });

    row.querySelectorAll("[data-pipeline-temp]").forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.addEventListener("click", () => {
        const current = pipelineFilterState();
        current.temp = current.temp === button.dataset.pipelineTemp ? "Todos" : button.dataset.pipelineTemp;
        saveState();
        updateRitoPipelineView();
      });
    });

    return row;
  }

  function renderRitoPipelineGrid() {
    const grid = document.createElement("section");
    grid.className = "reference-card-grid rito-pipeline-grid";
    getFilteredRitoPipelineCards().forEach((card) => grid.appendChild(createReferenceProjectCard(card, false, "crm")));
    if (!grid.children.length) {
      const empty = document.createElement("article");
      empty.className = "reference-project-card add-project-card";
      empty.innerHTML = `<div>-</div><span>Nenhum deal encontrado</span>`;
      grid.appendChild(empty);
    }
    return grid;
  }

  function referenceViewMode(view) {
    return state.referenceViewModes?.[state.currentWorkspace]?.[view] || "cards";
  }

  function taskListGroupMode(workspaceId = state.currentWorkspace) {
    return state.taskListGroupModes?.[workspaceId] || "theme";
  }

  function getRitoInvestedCards() {
    return getRitoReferenceCards().filter((card) => {
      const linked = findCRMItemForReferenceCard(card);
      return isInvestedProjectRecord(linked || card);
    });
  }

  function dealStatusSummary(item) {
    return displayText(item?.dealHistory || item?.statusSummary || "").trim();
  }

  function dealStatusSummaryPreview(item, maxLength = 150) {
    const summary = dealStatusSummary(item);
    if (!summary) return "Resumo pendente.";
    if (summary.length <= maxLength) return summary;
    return `${summary.slice(0, maxLength).trim()}...`;
  }

  function declinedReasonPreview(item, maxLength = 150) {
    if (!item || normalizeReferenceDashboardStage(item) !== "Declinado") return "";
    return dealStatusSummaryPreview(item, maxLength);
  }

  function capitalizeSentenceStart(value) {
    const text = displayText(value).trim();
    if (!text) return "";
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  }

  function splitProjectInsightList(value) {
    return String(value || "")
      .split(/\n|;|,/)
      .map((entry) => capitalizeSentenceStart(entry))
      .filter(Boolean);
  }

  function declinedDealReasonGroups(items) {
    const groups = [];
    (Array.isArray(items) ? items : [])
      .filter((item) => item && !Array.isArray(item) && typeof item === "object")
      .filter((item) => normalizeReferenceDashboardStage(item) === "Declinado")
      .forEach((item) => {
        const projectName = displayText(item?.name || item?.projectName || item?.company || "").trim() || "Deal sem nome";
        const summary = dealStatusSummary(item);
        const reasons = splitProjectInsightList(summary);
        groups.push({
          projectName,
          reasons: Array.from(new Set(reasons.length ? reasons : ["Sem motivo preenchido"]))
        });
      });
    return groups.sort((a, b) => a.projectName.localeCompare(b.projectName, "pt-BR"));
  }

  function referenceCardSubtle(card) {
    const matched = referenceDashboardRows().find((row) => row.company === card.name);
    if (matched) return displayText(matched.segment);
    return displayText((((card.subtitle || "").split(" - ")[0]) || card.subtitle || "").trim());
  }

  function referenceCardStatusSummary(card) {
    const matched = referenceDashboardRows().find((row) => row.company === card.name);
    if (matched) return matched.statusSummary || "";
    const linked = findCRMItemForReferenceCard(card);
    return dealStatusSummaryPreview(linked, 180);
  }

  function createReferenceProjectRow(card, sourceView = "crm") {
    const row = document.createElement("div");
    row.className = "table-row rito-table-row reference-list-row";
    const temp = cardTemperature(card);
    row.innerHTML = `
      <div class="company-cell">
        ${renderCompanyBadge(card)}
        <div><strong>${displayText(card.name)}</strong><div class="subtle">${referenceCardSubtle(card)}</div></div>
      </div>
      <div class="table-summary-cell">${referenceCardStatusSummary(card)}</div>
      <div><span class="chip chip-${card.status.toLowerCase().replace(/\s+/g, "-")}">${displayText(card.status)}</span></div>
      <div><span class="chip chip-${temp.toLowerCase()}">${displayText(temp)}</span></div>
      <div class="owner-cell">${renderOwnerAvatar(card.owner)}<span>${displayText(card.owner)}</span></div>
      <div>-</div>
    `;
    const linked = findCRMItemForReferenceCard(card);
    if (linked) {
      row.classList.add("is-clickable");
      row.onclick = () => openProjectDetail(linked.id, sourceView);
    }
    return row;
  }

  function renderReferenceList(cards, sourceView = "crm", emptyLabel = "Nenhum deal encontrado") {
    const table = document.createElement("section");
    table.className = "panel dashboard-table rito-dashboard-table reference-list-shell";
    const head = document.createElement("div");
    head.className = "table-head";
    head.innerHTML = "<div>Empresa</div><div>Resumo do status</div><div>Estágio</div><div>Temp.</div><div>Responsável</div><div>Fechamento</div>";
    table.appendChild(head);
    cards.forEach((card) => table.appendChild(createReferenceProjectRow(card, sourceView)));
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "rito-dashboard-empty";
      empty.textContent = emptyLabel;
      table.appendChild(empty);
    }
    return table;
  }

  function updateRitoPipelineView() {
    if (state.currentWorkspace !== "rito" || state.currentView[state.currentWorkspace] !== "crm") {
      renderApp();
      return;
    }

    const results = document.querySelector(".rito-pipeline-results");
    if (results && results.parentNode) {
      const next = referenceViewMode("crm") === "list"
        ? renderReferenceList(getFilteredRitoPipelineCards(), "crm", "Nenhum deal encontrado")
        : renderRitoPipelineGrid();
      next.classList.add("rito-pipeline-results");
      results.replaceWith(next);
    }

    const toolbar = document.querySelector(".rito-pipeline-toolbar");
    if (!toolbar) return;

    const filters = pipelineFilterState();
    const search = toolbar.querySelector("[data-pipeline-search]");
    if (search && search.value !== filters.query) {
      search.value = filters.query || "";
    }
    toolbar.querySelectorAll("[data-pipeline-temp]").forEach((button) => {
      button.classList.toggle("is-active", filters.temp === button.dataset.pipelineTemp);
    });
  }

  function dashboardStageMatches(row, stage) {
    if (stage === "Todos") return true;
    if (stage === "Declinados") return row.stage === "Declinado";
    return normalizeRitoDealStatus(row.stage) === normalizeRitoDealStatus(stage);
  }

  function usingReferenceDashboard() {
    return ["rito", "atica"].includes(state.currentWorkspace);
  }

  function normalizeReferenceDashboardStage(item) {
    if (!item || Array.isArray(item) || typeof item !== "object") return "Lead";
    if (isInvestedProjectRecord(item)) return "Portfólio";
    return normalizeRitoDealStatus(item.status, item.investmentStatus);
  }

  function referenceDashboardRows() {
    return prioritizedRitoPipelineItems(workspaceData().crmItems || [])
      .filter((item) => item && !Array.isArray(item) && typeof item === "object")
      .map((item) => {
      ensureProjectShape(item);
      const normalizedStage = normalizeReferenceDashboardStage(item);
      const normalizedTemperature = item.status
        ? temperatureFromRitoDealStatus(item.status)
        : ["Quente", "Morno", "Frio", "Fechamento", "Investido", "Investida", "Declinado", "Declinada", "Exit"].includes(String(item.temperature || "").trim())
        ? normalizeRitoFilterTemperature(String(item.temperature).trim())
        : temperatureFromRitoDealStatus(item.status);
      const companyName = displayText(item.name || item.company || "Deal sem nome").trim() || "Deal sem nome";
      return {
        id: item.id || "",
        company: companyName,
        segment: item.email || item.sector || item.subtitle || "-",
        contact: item.contact || item.mainContact || item.email || "-",
        statusSummary: dealStatusSummaryPreview(item, 180),
        projectStrengths: displayText(item.projectStrengths || ""),
        projectWeaknesses: displayText(item.projectWeaknesses || ""),
        stage: normalizedStage,
        temp: normalizedTemperature,
        progress: Number(item.progress || 0),
        owner: displayText(item.owner || "-") || "-",
        close: item.deadline || item.closeDate || "-",
        initials: item.logoText || initials(companyName),
        logo: item.logo || "",
        logoText: item.logoText || initials(companyName),
        logoBg: item.logoBg || "transparent"
      };
      });
  }

  function referenceDashboardStages() {
    const rows = referenceDashboardRows();
    const palette = {
      Lead: { tone: "#e1e4ea", accent: "#6f7788" },
      Pipeline: { tone: "#f5edcf", accent: "#c09205" },
      NDA: { tone: "#dce8fa", accent: "#4c88c8" },
      IRL: { tone: "#d8e1fb", accent: "#6d86d8" },
      LOI: { tone: "#ddd4fb", accent: "#7a5cf0" },
      NBO: { tone: "#e3d8f6", accent: "#8a67d9" },
      Proposta: { tone: "#f6e0d7", accent: "#c27a4d" },
      "Due Diligence": { tone: "#d7e1f8", accent: "#4d7ef6" },
      Signing: { tone: "#e7dcc8", accent: "#9b7e4f" },
      Closing: { tone: "#d8ebde", accent: "#2c9a72" },
      Aporte: { tone: "#d9eddc", accent: "#4a9b63" },
      "Portfólio": { tone: "#d8edd8", accent: "#41a047" },
      Declinado: { tone: "#f5d7d7", accent: "#dc3535" },
      Exit: { tone: "#d7efe6", accent: "#1f8f6a" }
    };
    return RITO_PIPELINE_STAGES.map((stage) => {
      const count = rows.filter((row) => normalizeRitoDealStatus(row.stage) === stage).length;
      const colors = palette[stage] || { tone: "#e8ebf0", accent: "#7b8491" };
      return { label: stage, count, tone: colors.tone, accent: colors.accent, deals: `${count} deals` };
    });
  }

  function getFilteredRitoDashboardRows() {
    const filters = dashboardFilterState();
    const query = (filters.query || "").toLowerCase();
    return referenceDashboardRows().filter((row) => {
      const queryMatch = !query || [row.company, row.segment, row.contact, row.owner, row.statusSummary, row.projectStrengths, row.projectWeaknesses].join(" ").toLowerCase().includes(query);
      const tempMatch = filters.temp === "Todos" || row.temp === filters.temp;
      const stageMatch = dashboardStageMatches(row, filters.stage);
      return queryMatch && tempMatch && stageMatch;
    });
  }

  function getFilteredRitoDashboardCards() {
    const rows = getFilteredRitoDashboardRows();
    const names = new Set(rows.map((row) => row.company));
    return getRitoReferenceCards().filter((card) => names.has(card.name));
  }

  function reconcileProjectInvestmentState(item) {
    const investmentKey = normalizeProjectTagKey(item?.investmentStatus);
    const explicitNonInvested = investmentKey === normalizeProjectTagKey("Não investido");
    const normalizedStatus = normalizeRitoDealStatus(item?.status, item?.investmentStatus);
    if (explicitNonInvested && ["Portfólio", "Aporte"].includes(normalizedStatus)) {
      item.status = "Pipeline";
    }
  }

  function updateRitoDashboardView() {
    if (!usingReferenceDashboard() || state.currentView[state.currentWorkspace] !== "dashboard") {
      renderApp();
      return;
    }

    const funnelRoot = document.querySelector(".rito-funnel-panel");
    if (funnelRoot && funnelRoot.parentNode) {
      funnelRoot.replaceWith(renderRitoFunnel());
    }

    const sideRoot = document.querySelector(".rito-dashboard-side");
    if (sideRoot && sideRoot.parentNode) {
      sideRoot.replaceWith(renderRitoDashboardSide());
    }

    const filters = dashboardFilterState();
    document.querySelectorAll("[data-dashboard-stage]").forEach((node) => {
      const isAll = node.dataset.dashboardStage === "Todos";
      const active = isAll ? filters.stage === "Todos" : filters.stage === node.dataset.dashboardStage;
      node.classList.toggle("is-active", active);
    });
  }

  function ensureProjectShape(item) {
    if (!item || Array.isArray(item) || typeof item !== "object") return item;
    reconcileProjectInvestmentState(item);
    item.tags = normalizeProjectTagList(item.tags || [], item);
    const normalizedStatus = normalizeRitoDealStatus(item.status, item.investmentStatus);
    const investedByStatus = ["Portfólio", "Aporte"].includes(normalizedStatus);
    const normalizedInvestmentKey = normalizeProjectTagKey(item.investmentStatus);
    const hasExplicitInvestedState = normalizedInvestmentKey === normalizeProjectTagKey("Investido");
    const hasExplicitNotInvestedState = normalizedInvestmentKey === normalizeProjectTagKey("Não investido");
    const hasInvestedTag = (item.tags || []).some((tag) => normalizeProjectTagKey(tag) === normalizeProjectTagKey("Investido"));
    if (!item.temperature) item.temperature = item.tags.includes("Quente") ? "Quente" : item.tags.includes("Morno") ? "Morno" : "Frio";
    if (hasExplicitNotInvestedState) {
      item.investmentStatus = "Nao investido";
    } else if (hasExplicitInvestedState || hasInvestedTag || investedByStatus) {
      item.investmentStatus = "Investido";
    } else {
      item.investmentStatus = "Nao investido";
    }
    item.status = normalizeRitoDealStatus(item.status, item.investmentStatus);
    item.temperature = temperatureFromRitoDealStatus(item.status);
    if (!item.investmentAmount) item.investmentAmount = 0;
    if (!item.priority) item.priority = "Media";
    if (!item.origin) item.origin = "Inbound";
    if (!String(item.owner || "").trim()) {
      item.owner = workspaceOwnerOptions(state.currentWorkspace)[0] || "Arthur Bueno";
    }
    if (!item.subtitle) item.subtitle = `${item.sector || ""} - ${item.location || ""} - ${item.year || ""}`.replace(/^ - | - $/g, "");
    if (!item.history) item.history = [{ at: todayISO(), text: "Projeto criado no CRM" }];
    item.progress = isInvestedProjectRecord(item) ? 100 : progressFromRitoDealStatus(item.status);
    if (!item.website) item.website = "";
    if (!item.vcPeBacked) item.vcPeBacked = "";
    if (!item.dealHistory) item.dealHistory = item.statusSummary || "";
    if (!item.projectStrengths) item.projectStrengths = "";
    if (!item.projectWeaknesses) item.projectWeaknesses = "";
    if (!item.createdAt) item.createdAt = todayISO();
    if (!item.updatedAt) item.updatedAt = todayISO();
    if (!item.managementTeam) item.managementTeam = "";
    if (!item.businessModel) item.businessModel = "";
    if (!item.revenues) item.revenues = "";
    if (!item.fundraisingHistory) item.fundraisingHistory = "";
    if (!item.competitors) item.competitors = "";
    if (!item.advantages) item.advantages = "";
    if (!item.founders) item.founders = item.managementTeam || "";
    if (!item.deadline) item.deadline = "";
    if (!item.frameworkDetails) {
      item.frameworkDetails = {
        tese: "",
        oportunidade: "",
        riscos: "",
        proximosPassos: "",
        statusDiligencia: "",
        observacoes: ""
      };
    }
    if (!item.media) {
      item.media = {
        coverPosition: "center",
        coverZoom: 100,
        logoScale: 100
      };
    }
    if (!item.media.logoScale) item.media.logoScale = 100;
    return item;
  }

  function pushHistory(item, text) {
    ensureProjectShape(item);
    item.history.unshift({ at: new Date().toLocaleString("pt-BR"), text });
    item.history = item.history.slice(0, 20);
  }

  function normalizeExcelValue(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map((entry) => normalizeExcelValue(entry)).filter(Boolean).join(" | ");
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  }

  function escapeExcelHtml(value) {
    return normalizeExcelValue(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildDealExportRows(items) {
    return (items || []).map((item) => {
      ensureProjectShape(item);
      return {
        "ID": item.id || "",
        "Nome": item.name || "",
        "Subtitulo": item.subtitle || "",
        "Status": item.status || "",
        "Status do investimento": item.investmentStatus || "",
        "Temperatura": item.temperature || "",
        "Prioridade": item.priority || "",
        "Responsavel": item.owner || "",
        "Setor": item.sector || "",
        "Localizacao": item.location || "",
        "Ano": item.year || "",
        "Origem": item.origin || "",
        "Valor estimado": item.estimatedValue || 0,
        "Valor investido": item.investmentAmount || 0,
        "Progresso": item.progress || 0,
        "Prazo": item.deadline || "",
        "Website": item.website || "",
        "Contato": item.contact || "",
        "Email": item.email || "",
        "Descricao": item.description || "",
        "Framework": item.framework || "",
        "Resumo do deal": item.dealHistory || item.statusSummary || "",
        "Segurancas": item.projectStrengths || "",
        "Insegurancas": item.projectWeaknesses || "",
        "Modelo de negocio": item.businessModel || "",
        "Time de gestao": item.managementTeam || "",
        "Fundadores": item.founders || "",
        "Receitas": item.revenues || "",
        "Historico de captacao": item.fundraisingHistory || "",
        "VC ou PE investido": item.vcPeBacked || "",
        "Competidores": item.competitors || "",
        "Vantagens": item.advantages || "",
        "Observacoes": item.notes || "",
        "Tags": item.tags || [],
        "Tese": item.frameworkDetails?.tese || "",
        "Oportunidade": item.frameworkDetails?.oportunidade || "",
        "Riscos": item.frameworkDetails?.riscos || "",
        "Proximos passos": item.frameworkDetails?.proximosPassos || "",
        "Status da diligencia": item.frameworkDetails?.statusDiligencia || "",
        "Observacoes estrategicas": item.frameworkDetails?.observacoes || "",
        "Historico": (item.history || []).map((entry) => `${entry.at || ""}: ${entry.text || ""}`),
        "Criado em": item.createdAt || "",
        "Atualizado em": item.updatedAt || "",
        "Cover": item.cover || "",
        "Logo": item.logo || "",
        "Logo texto": item.logoText || "",
        "Logo fundo": item.logoBg || "",
        "Posicao do cover": item.media?.coverPosition || "",
        "Zoom do cover": item.media?.coverZoom || "",
        "Escala da logo": item.media?.logoScale || "",
        "Registro JSON completo": item
      };
    });
  }

  function downloadDealsExcel(workspaceId = state.currentWorkspace) {
    const workspace = state.workspaces[workspaceId];
    if (!workspace) {
      alert("Nao encontrei o workspace para exportacao.");
      return;
    }
    const rows = buildDealExportRows(workspace.crmItems || []);
    if (!rows.length) {
      alert("Nao ha deals cadastrados para exportar neste workspace.");
      return;
    }
    const headers = Object.keys(rows[0]);
    const headerHtml = headers.map((header) => `<th>${escapeExcelHtml(header)}</th>`).join("");
    const bodyHtml = rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeExcelHtml(row[header])}</td>`).join("")}</tr>`).join("");
    const workbook = `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      table { border-collapse: collapse; width: 100%; font-family: Calibri, Arial, sans-serif; }
      th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; text-align: left; }
      th { background: #f3f4f6; font-weight: 700; }
      td { white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </body>
  </html>`;
    const blob = new Blob([`\ufeff${workbook}`], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const link = document.createElement("a");
    const safeWorkspace = String(workspaceId || "workspace").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    link.href = URL.createObjectURL(blob);
    link.download = `deals-${safeWorkspace}-${todayISO()}.xls`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 0);
  }

  function isLandingScreen() {
    const params = new URLSearchParams(location.search);
    return !params.get("workspace");
  }

  function navigateToWorkspace(workspaceId, view = "") {
    if (!workspaceConfig[workspaceId]) return;
    flushOpenEditors();
    state.currentWorkspace = workspaceId;
    if (view && workspaceConfig[workspaceId].views.includes(view)) {
      state.currentView[workspaceId] = view;
    }
    const params = new URLSearchParams();
    params.set("workspace", workspaceId);
    if (view) params.set("view", view);
    history.pushState({}, "", `${location.pathname}?${params.toString()}`);
    saveState();
    renderApp();
  }

  function navigateToWorkspaceLanding() {
    flushOpenEditors();
    history.pushState({}, "", location.pathname);
    saveState();
    renderApp();
  }

  function captureAppScrollSnapshot() {
    const selectors = [".page-stack", ".main-panel", ".kanban-reference-board"];
    return {
      windowX: window.scrollX,
      windowY: window.scrollY,
      containers: selectors.map((selector) => {
        const element = document.querySelector(selector);
        return {
          selector,
          left: element ? element.scrollLeft : 0,
          top: element ? element.scrollTop : 0
        };
      })
    };
  }

  function restoreAppScrollSnapshot(snapshot) {
    if (!snapshot) return;
    const apply = () => {
      snapshot.containers.forEach(({ selector, left, top }) => {
        const element = document.querySelector(selector);
        if (!element) return;
        element.scrollLeft = left;
        element.scrollTop = top;
      });
      window.scrollTo(snapshot.windowX, snapshot.windowY);
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }

  function findRenderedTaskNode(taskId) {
    if (!taskId) return null;
    return [...document.querySelectorAll("[data-task-id]")]
      .find((node) => String(node.dataset.taskId || "").trim() === String(taskId || "").trim()) || null;
  }

  function restoreTaskViewport(taskId) {
    if (!taskId) return;
    const apply = () => {
      const taskNode = findRenderedTaskNode(taskId);
      if (!taskNode) return;
      taskNode.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto"
      });
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }

  function renderAppPreservingScroll(taskId = "") {
    const snapshot = captureAppScrollSnapshot();
    renderApp();
    restoreAppScrollSnapshot(snapshot);
    restoreTaskViewport(taskId);
  }

  function renderApp() {
    const landing = isLandingScreen();
    document.body.dataset.theme = state.theme;
    document.body.classList.toggle("landing-mode", landing);
    document.querySelector(".brand-mark").innerHTML = workspaceLogoMarkup(state.currentWorkspace, "sidebar");
    renderSidebar();
    renderTabs();
    renderGlobalSearchResults();
    const config = workspaceConfig[state.currentWorkspace];
    const currentView = state.currentView[state.currentWorkspace];
    const detailItem = currentView === "projectDetail" ? getSelectedProject() : null;
    const workspaceEyebrow = document.getElementById("workspaceEyebrow");
    const pageCrumb = document.getElementById("pageCrumb");
    const pageTitle = document.getElementById("pageTitle");
    const breadcrumbSep = document.querySelector(".breadcrumb-sep");
    const landingTopbarMark = document.getElementById("landingTopbarMark");
    const workspaceHomeButton = document.getElementById("workspaceHomeButton");
    document.getElementById("sidebarWorkspaceTitle").textContent = config.name;
    document.querySelector(".workspace-switcher .eyebrow").textContent = state.currentWorkspace === "rito"
      ? "Portfolio"
      : "Ambiente";
    if (landing) {
      workspaceEyebrow.textContent = "WORKSPACE";
      pageCrumb.textContent = "";
      pageTitle.textContent = "Workspace";
      pageCrumb.classList.add("hidden");
      breadcrumbSep.classList.add("hidden");
      landingTopbarMark.classList.remove("hidden");
      workspaceHomeButton.classList.add("hidden");
    } else {
      workspaceEyebrow.textContent = config.name;
      pageCrumb.textContent = detailItem
        ? `${tabTitle(state.projectReturnView[state.currentWorkspace] || "crm").toUpperCase()} > ${detailItem.name.toUpperCase()}`
        : viewLabels[currentView].toUpperCase();
      pageTitle.textContent = detailItem ? detailItem.name : viewLabels[currentView];
      pageCrumb.classList.remove("hidden");
      breadcrumbSep.classList.remove("hidden");
      landingTopbarMark.classList.add("hidden");
      workspaceHomeButton.classList.remove("hidden");
    }
    renderCurrentView();
    bindStaticActions();
  }

  function renderSidebar() {
    const sidebarKey = state.currentWorkspace;
    if (_lastRenderedSidebarKey === sidebarKey) return;
    _lastRenderedSidebarKey = sidebarKey;
    const wrapper = document.getElementById("workspaceList");
    wrapper.innerHTML = "";
    orderedWorkspaces().forEach((workspace) => {
      const button = document.createElement("button");
      button.className = `workspace-button ${workspace.id === state.currentWorkspace ? "active" : ""}`;
      button.innerHTML = `<span class="workspace-button-mark">${workspaceLogoMarkup(workspace.id, "dropdown")}</span><strong>${workspace.name}</strong>`;
      button.addEventListener("click", () => {
        document.getElementById("workspaceDropdown").classList.add("hidden");
        navigateToWorkspace(workspace.id);
      });
      wrapper.appendChild(button);
    });
  }

  function renderTabs() {
    const wrapper = document.getElementById("viewTabs");
    if (isLandingScreen()) {
      if (_lastRenderedTabsKey !== "landing") {
        _lastRenderedTabsKey = "landing";
        wrapper.innerHTML = "";
      }
      return;
    }
    const tabsKey = `${state.currentWorkspace}:${state.currentView[state.currentWorkspace]}`;
    if (_lastRenderedTabsKey === tabsKey) return;
    _lastRenderedTabsKey = tabsKey;
    const config = workspaceConfig[state.currentWorkspace];
    wrapper.innerHTML = "";
    config.views.forEach((view) => {
      const tab = document.createElement("button");
      tab.className = `tab-button ${state.currentView[state.currentWorkspace] === view ? "active" : ""}`;
      tab.innerHTML = `<span class="tab-icon">${viewIcons[view] || "+"}</span><span>${tabTitle(view)}</span>`;
      tab.addEventListener("click", () => {
        flushOpenEditors();
        state.currentView[state.currentWorkspace] = view;
        saveState();
        renderApp();
      });
      wrapper.appendChild(tab);
    });
  }

  function tabTitle(view) {
    if (state.currentWorkspace === "rito" && view === "crm") return "Pipeline";
    if (state.currentWorkspace === "rito" && view === "tasks") return "Kanban Rito";
    if (state.currentWorkspace === "rito" && view === "projectBoards") return "Kanban Projetos";
    if (state.currentWorkspace === "rito" && view === "settings") return "Configurações";
    if (state.currentWorkspace === "atica" && view === "tasks") return "Kanban Ática";
    if (state.currentWorkspace === "fast" && view === "tasks") return "Kanban Fast";
    return viewLabels[view];
  }

  function renderCurrentView() {
    const target = document.getElementById("appContent");
    if (isLandingScreen()) {
      target.innerHTML = "";
      target.appendChild(renderWorkspaceLandingPage());
      return;
    }
    try {
      const currentView = state.currentView[state.currentWorkspace];
      target.innerHTML = "";
      if (usingReferenceDashboard()) {
        if (currentView === "projectDetail") target.appendChild(renderRitoProjectDetailPage());
        if (currentView === "dashboard") target.appendChild(renderRitoReferenceDashboard());
        if (state.currentWorkspace === "rito") {
          if (currentView === "crm") target.appendChild(renderRitoPipelinePage());
          if (currentView === "invested") target.appendChild(renderRitoInvestedPage());
          if (currentView === "tasks") target.appendChild(renderTasksBoard());
          if (currentView === "projectBoards") target.appendChild(renderProjectBoards());
          if (currentView === "rites") target.appendChild(renderRitoRitesPage());
          if (currentView === "documents") target.appendChild(renderRitoDocumentsPage());
          if (currentView === "members") target.appendChild(renderRitoMembersPage());
          if (currentView === "settings") target.appendChild(renderRitoSettingsPage());
        } else {
          if (currentView === "crm") target.appendChild(renderCRM());
          if (currentView === "invested") target.appendChild(renderInvestedProjects());
          if (currentView === "tasks") target.appendChild(renderTasksBoard());
          if (currentView === "projectBoards") target.appendChild(renderProjectBoards());
          if (currentView === "documents") target.appendChild(renderDocuments());
          if (currentView === "members") target.appendChild(renderMembers());
          if (currentView === "calendar") target.appendChild(renderCalendar());
          if (currentView === "settings") target.appendChild(renderRitoSettingsPage());
        }
        return;
      }
      if (currentView === "dashboard") target.appendChild(renderDashboard());
      if (currentView === "crm") target.appendChild(renderCRM());
      if (currentView === "invested") target.appendChild(renderInvestedProjects());
      if (currentView === "tasks") target.appendChild(renderTasksBoard());
      if (currentView === "projectBoards") target.appendChild(renderProjectBoards());
      if (currentView === "documents") target.appendChild(renderDocuments());
      if (currentView === "members") target.appendChild(renderMembers());
      if (currentView === "calendar") target.appendChild(renderCalendar());
      if (currentView === "settings") target.appendChild(renderRitoSettingsPage());
    } catch (error) {
      console.error("[render] Falha ao montar a view atual", {
        workspace: state.currentWorkspace,
        view: state.currentView?.[state.currentWorkspace] || null,
        message: error?.message || String(error),
        stack: error?.stack || null
      });
      target.innerHTML = `
        <section class="panel" style="display:grid;gap:8px;padding:20px;">
          <h3>Não foi possível renderizar esta tela</h3>
          <p>O console do navegador agora mostra o erro exato para diagnóstico.</p>
        </section>
      `;
    }
  }

  function renderWorkspaceLandingPage() {
    const page = document.createElement("section");
    page.className = "workspace-launch-page";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    page.innerHTML = `
      <section class="workspace-launch-hero-shell">
        <section class="workspace-launch-hero">
          <div class="workspace-launch-topbar">
            <span class="workspace-launch-kicker">Portal de Gestão Rito</span>
            <button type="button" class="action-button workspace-launch-logout" id="workspaceLandingLogout">Sair</button>
          </div>
          <h3>${greeting}<span>.</span></h3>
          <p>Selecione um workspace para continuar sua operação com visão centralizada, pipeline e acompanhamento tático.</p>
          <div class="workspace-launch-meta">
            <span>Investimentos</span>
            <span>Operação</span>
            <span>Governança</span>
          </div>
          <div class="workspace-launch-footer">
            <span>© 2026 Rito Ventures</span>
            <span>www.ritoventures.com.br</span>
          </div>
        </section>
        <section class="workspace-launch-stage">
          <div class="workspace-launch-stage-glow"></div>
          <div class="workspace-launch-stage-brand"><img src="${RITO_LOGO_DARK_GITHUB_URL}" alt="Rito" class="workspace-launch-stage-logo" onerror="this.onerror=null;this.src='./Logo-Rito-Dark.png';"></div>
          <div class="workspace-launch-stage-copy">
            <span>Rua 72, 325, salas 1201 a 1206, Jardim Goiás | Goiânia-GO</span>
            <span>www.ritoventures.com.br</span>
          </div>
        </section>
      </section>
    `;

    const list = document.createElement("section");
    list.className = "workspace-launch-list";

    orderedWorkspaces().forEach((workspace) => {
      const meta = workspaceLaunchMeta[workspace.id] || {
        index: "00",
        shortLabel: workspace.mark,
        descriptor: "Ambiente",
        greeting: workspace.subtitle
      };
      const item = document.createElement("button");
      item.type = "button";
      item.className = "workspace-launch-card";
      item.draggable = true;
      item.dataset.workspaceId = workspace.id;
      const launchMarkVariant = "landing";
      item.innerHTML = `
        <span class="workspace-launch-mark">${workspaceLogoMarkup(workspace.id, launchMarkVariant)}</span>
        <span class="workspace-launch-main">
          <strong>${workspace.name}</strong>
          <span class="workspace-launch-subtitle">${meta.descriptor}</span>
        </span>
        <span class="workspace-launch-links">${workspace.views.slice(0, 4).map((view) => `<span>${tabTitleForWorkspace(workspace.id, view)}</span>`).join("")}</span>
        <span class="workspace-launch-arrow">↗</span>
      `;
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", workspace.id);
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("is-dragging");
        list.querySelectorAll(".workspace-launch-card").forEach((card) => card.classList.remove("is-drop-target"));
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        list.querySelectorAll(".workspace-launch-card").forEach((card) => {
          if (card !== item) card.classList.remove("is-drop-target");
        });
        item.classList.add("is-drop-target");
      });
      item.addEventListener("dragleave", () => {
        item.classList.remove("is-drop-target");
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("is-drop-target");
        const draggedId = event.dataTransfer.getData("text/plain");
        reorderWorkspaces(draggedId, workspace.id);
      });
      item.onclick = () => navigateToWorkspace(workspace.id);
      list.appendChild(item);
    });

    page.appendChild(list);
    page.querySelector("#workspaceLandingLogout")?.addEventListener("click", () => {
      void logoutUser();
    });
    return page;
  }

  function tabTitleForWorkspace(workspaceId, view) {
    if (workspaceId === "rito" && view === "crm") return "Pipeline";
    if (workspaceId === "rito" && view === "tasks") return "Kanban";
    if (workspaceId === "rito" && view === "projectBoards") return "Projetos";
    if (workspaceId === "fast" && view === "tasks") return "Kanban";
    if (workspaceId === "atica" && view === "tasks") return "Kanban";
    return viewLabels[view];
  }

  function renderDueDiligenceDashboard() {
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page diligence-page";

    const projects = diligenceProjects();
    const project = activeDiligenceProject();
    const { areaRisks, phases, contingencies, tasks, insights } = project;
    const totalExposure = contingencies.reduce((sum, item) => sum + item.value, 0);
    const provisionedExposure = contingencies.reduce((sum, item) => {
      const probabilityWeight = item.probability === "Provável" ? 1 : item.probability === "Possível" ? 0.5 : 0.2;
      return sum + (item.value * probabilityWeight);
    }, 0);
    const overallRiskScore = Math.round(areaRisks.reduce((sum, item) => sum + item.score, 0) / areaRisks.length);
    const weightedArea = areaRisks[0];

    panel.innerHTML = `
      <section class="panel diligence-hero">
        <div class="diligence-hero-copy">
          <span class="diligence-kicker">Rito Ventures • Due Diligence</span>
          <h3>${project.name}</h3>
          <p>${project.summary}</p>
          <div class="diligence-chip-row">
            <span class="soft-pill chip-blue">${project.status}</span>
            <span class="soft-pill ${project.risk === "Alto" ? "chip-rose" : project.risk === "Médio" ? "chip-gold" : "chip-green"}">Risco ${project.risk}</span>
            ${project.tags.map((tag) => `<span class="soft-pill chip-stone">${tag}</span>`).join("")}
          </div>
        </div>
        <div class="diligence-hero-aside">
          <div class="diligence-score-ring">
            <div class="diligence-score-value">${overallRiskScore}</div>
            <span>score geral</span>
          </div>
          <div class="diligence-hero-meta">
            <div><strong>${project.progress}%</strong><span>progresso</span></div>
            <div><strong>${project.deadline}</strong><span>deadline</span></div>
            <div><strong>${weightedArea.area}</strong><span>área crítica</span></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div><h3>Projetos em auditoria</h3><p>Selecione um card para trocar todo o dashboard do workspace</p></div>
          <span class="soft-pill chip-neutral">${projects.length} projetos</span>
        </div>
        <div class="diligence-project-grid diligence-project-grid-selector">
          ${projects.map((item) => `
            <button class="diligence-project-card diligence-project-selector ${item.id === project.id ? "is-active" : ""}" data-diligence-project="${item.id}" type="button">
              <div class="diligence-project-top">
                <strong>${item.name}</strong>
                <span class="soft-pill ${item.risk === "Alto" ? "chip-rose" : item.risk === "Médio" ? "chip-gold" : "chip-green"}">${item.risk}</span>
              </div>
              <p>${item.sector} • ${item.transaction} • ${item.geography}</p>
              <div class="diligence-chip-row">
                <span class="soft-pill chip-stone">${item.companyCode}</span>
                <span class="soft-pill chip-stone">${item.status}</span>
              </div>
              <div class="diligence-progress-track"><span style="width:${item.progress}%"></span></div>
              <div class="diligence-project-meta"><span>Prazo ${item.deadline}</span><strong>${item.progress}%</strong></div>
            </button>
          `).join("")}
        </div>
      </section>

      <section class="diligence-metric-grid">
        <article class="metric-card"><div class="metric-card-top"><p class="metric-label">Enterprise Value ajustado</p><span class="metric-icon-box"><span class="metric-icon">◈</span></span></div><strong class="metric-value">${formatCurrencyBRL(project.adjustedEnterpriseValue)}</strong><div class="metric-card-footer"><span class="metric-footnote">Base anterior: ${formatCurrencyBRL(project.enterpriseValue)}</span></div></article>
        <article class="metric-card"><div class="metric-card-top"><p class="metric-label">Equity Value impactado</p><span class="metric-icon-box"><span class="metric-icon">◈</span></span></div><strong class="metric-value">${formatCurrencyBRL(project.adjustedEquityValue)}</strong><div class="metric-card-footer"><span class="metric-footnote">Base anterior: ${formatCurrencyBRL(project.equityValue)}</span></div></article>
        <article class="metric-card"><div class="metric-card-top"><p class="metric-label">EBITDA ajustado</p><span class="metric-icon-box"><span class="metric-icon">◎</span></span></div><strong class="metric-value">${formatCurrencyBRL(project.adjustedEbitda)}</strong><div class="metric-card-footer"><span class="metric-footnote">QoE e normalizações concluídas em 68%</span></div></article>
        <article class="metric-card"><div class="metric-card-top"><p class="metric-label">Provisionamento estimado</p><span class="metric-icon-box"><span class="metric-icon">⚠</span></span></div><strong class="metric-value">${formatCurrencyBRL(provisionedExposure)}</strong><div class="metric-card-footer"><span class="metric-footnote">Probabilidade x valor das contingências</span></div></article>
      </section>

      <section class="diligence-section-grid">
        <section class="panel">
          <div class="panel-header">
            <div><h3>Resumo executivo</h3><p>Leitura rápida do projeto ativo no workspace da Rito</p></div>
          </div>
          <div class="diligence-project-grid">
            ${[
              ["Setor", project.sector, "Mandato"],
              ["Tipo de transação", project.transaction, "Estrutura"],
              ["Geografia", project.geography, "Escopo"],
              ["Responsáveis", project.team.join(" • "), "Owners"]
            ].map((item) => `
              <article class="diligence-project-card">
                <div class="diligence-project-top">
                  <strong>${item[0]}</strong>
                  <span class="soft-pill chip-neutral">${item[2]}</span>
                </div>
                <p>${item[1]}</p>
                <div class="diligence-progress-track"><span style="width:${project.progress}%"></span></div>
                <div class="diligence-project-meta"><span>${project.status}</span><strong>${project.progress}%</strong></div>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div><h3>Fases da DD</h3><p>Tracking macro do projeto principal</p></div>
          </div>
          <div class="diligence-phase-list">
            ${phases.map((phase) => `
              <article class="diligence-phase-row">
                <div>
                  <strong>${phase.name}</strong>
                  <p>${phase.owner}</p>
                </div>
                <div class="diligence-phase-progress">
                  <div class="diligence-progress-track"><span style="width:${phase.progress}%"></span></div>
                  <strong>${phase.progress}%</strong>
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      </section>

      <section class="diligence-section-grid">
        <section class="panel">
          <div class="panel-header">
            <div><h3>Risco por área</h3><p>Peso analítico com foco em impacto no deal</p></div>
          </div>
          <div class="diligence-risk-list">
            ${areaRisks.map((item) => `
              <article class="diligence-risk-row">
                <div class="diligence-risk-main">
                  <div class="diligence-risk-head">
                    <strong>${item.area}</strong>
                    <span class="soft-pill ${item.severity === "Alto" ? "chip-rose" : item.severity === "Médio" ? "chip-gold" : "chip-green"}">${item.severity}</span>
                  </div>
                  <p>${item.note}</p>
                  <div class="diligence-progress-track"><span style="width:${item.score}%"></span></div>
                </div>
                <strong class="diligence-risk-score">${item.score}</strong>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div><h3>Matriz de risco</h3><p>Probabilidade no eixo X e impacto no eixo Y</p></div>
          </div>
          <div class="diligence-risk-matrix">
            <div class="diligence-risk-matrix-bg"></div>
            ${contingencies.map((item) => `
              <button class="diligence-risk-dot ${item.x > 70 || item.y > 70 ? "is-danger" : item.x > 45 || item.y > 45 ? "is-warning" : "is-safe"}" style="left:${item.x}%; bottom:${item.y}%;" type="button" title="${item.title}">${item.type.slice(0, 2).toUpperCase()}</button>
            `).join("")}
            <span class="diligence-axis diligence-axis-x">Probabilidade</span>
            <span class="diligence-axis diligence-axis-y">Impacto</span>
          </div>
        </section>
      </section>

      <section class="diligence-section-grid">
        <section class="panel">
          <div class="panel-header">
            <div><h3>Dashboard de contingências</h3><p>Exposição total, status e responsáveis</p></div>
            <span class="soft-pill chip-rose">${formatCurrencyBRL(totalExposure)}</span>
          </div>
          <div class="diligence-table">
            ${contingencies.map((item) => `
              <article class="diligence-table-row">
                <div>
                  <strong>${item.title}</strong>
                  <p>${item.type} • ${item.area} • ${item.owner}</p>
                </div>
                <div><span>${item.probability}</span></div>
                <div><span>${item.status}</span></div>
                <div><strong>${formatCurrencyBRL(item.value)}</strong><p>${item.updatedAt}</p></div>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div><h3>Insights automáticos</h3><p>Red flags, recomendação e leitura executiva</p></div>
          </div>
          <div class="diligence-insights-list">
            ${insights.map((item) => `<article class="diligence-insight-item"><strong>Insight</strong><p>${item}</p></article>`).join("")}
          </div>
          <div class="diligence-summary-card">
            <strong>Sumário executivo</strong>
            <p>A due diligence indica ativo com fundamentos operacionais consistentes, porém com risco financeiro e fiscal acima do apetite-base. A recomendação é seguir para comitê com ajuste de valuation, escrow tributário e plano de mitigação para clientes concentrados.</p>
          </div>
        </section>
      </section>

      <section class="diligence-section-grid">
        <section class="panel">
          <div class="panel-header">
            <div><h3>Tasks e tracking</h3><p>Checklist operacional da DD por status</p></div>
          </div>
          <div class="diligence-task-board">
            <div class="diligence-task-column"><strong>To do</strong>${tasks.todo.map((task) => `<article class="diligence-task-card"><h4>${task.title}</h4><p>${task.phase}</p><span>${task.owner}</span></article>`).join("")}</div>
            <div class="diligence-task-column"><strong>Doing</strong>${tasks.doing.map((task) => `<article class="diligence-task-card"><h4>${task.title}</h4><p>${task.phase}</p><span>${task.owner}</span></article>`).join("")}</div>
            <div class="diligence-task-column"><strong>Done</strong>${tasks.done.map((task) => `<article class="diligence-task-card"><h4>${task.title}</h4><p>${task.phase}</p><span>${task.owner}</span></article>`).join("")}</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div><h3>Governança do projeto</h3><p>Patrocinadores, cronograma e ownership</p></div>
          </div>
          <div class="diligence-governance-list">
            <article><strong>Responsáveis</strong><p>${project.team.join(" • ")}</p></article>
            <article><strong>Início</strong><p>${project.startDate}</p></article>
            <article><strong>Prazo final</strong><p>${project.deadline}</p></article>
            <article><strong>Recomendação</strong><p>Prosseguir com ressalvas e mecanismos de proteção no SPA.</p></article>
          </div>
        </section>
      </section>
    `;

    panel.querySelectorAll("[data-diligence-project]").forEach((button) => {
      button.addEventListener("click", () => {
        selectDiligenceProject(button.dataset.diligenceProject);
      });
    });

    return panel;
  }

  function renderDashboard() {
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page";
    const data = workspaceData();
    const config = workspaceConfig[state.currentWorkspace];

    if (state.currentWorkspace === "fast") {
      const filters = dashboardFilterState();
      const allTasks = allWorkspaceTasksWithProjectContext("fast");
      const ownerOptions = [...new Set([
        ...(workspaceConfig.fast?.memberOptions || []),
        ...allTasks.map((task) => String(task.owner || "").trim()).filter(Boolean)
      ])].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const tasks = filters.owner === "Todos"
        ? allTasks
        : allTasks.filter((task) => String(task.owner || "").trim() === filters.owner);
      const summary = taskStatusSummary(tasks);
      const done = summary.Concluido;
      const inExecution = summary["Em andamento"];
      const awaiting = summary.Revisao;
      const todo = summary["A fazer"];
      const workstreams = workspaceTaskThemes("fast").length;
      const metrics = [
        ["Iniciativas", tasks.length, "Plano tático total", "☰"],
        ["Frentes ativas", workstreams, displayText("Workstreams da operação"), "▦"],
        ["Em andamento", inExecution, displayText("Itens em execução"), "◉"],
        ["Aguardando", awaiting, "Dependência de aporte ou terceiros", "◎"],
        ["Não iniciadas", todo, "Backlog atual", "○"],
        ["Execução", `${Math.round((done / (tasks.length || 1)) * 100)}%`, displayText("Percentual concluído"), "✓"]
      ];
      panel.innerHTML = `
        <section class="page-head">
          <div><h3>Dashboard</h3><p>${displayText("Painel executivo da Fast Massagem com visão operacional, prioridades e performance")}</p></div>
        </section>
      `;
      const filtersRow = document.createElement("section");
      filtersRow.className = "reference-toolbar";
      filtersRow.innerHTML = `
        <div class="toolbar-left">
          <label class="field">
            <span>Responsável</span>
            <select id="fastDashboardOwnerFilter">
              <option value="Todos">Todos</option>
              ${ownerOptions.map((owner) => `<option value="${escapeHTML(owner)}" ${filters.owner === owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}
            </select>
          </label>
        </div>
      `;
      filtersRow.querySelector("#fastDashboardOwnerFilter")?.addEventListener("change", (event) => {
        dashboardFilterState().owner = event.target.value || "Todos";
        state.fastDashboardStatusFocus = "";
        renderApp();
      });
      panel.appendChild(filtersRow);
      panel.appendChild(renderMetrics(metrics));
      panel.appendChild(renderFastDashboardDetail(tasks));
      return panel;
    }

    const deals = data.crmItems;
    const totalValue = deals.reduce((acc, item) => acc + item.estimatedValue, 0);
    const hotDeals = deals.filter((item) => ["Quente", "Pipeline"].includes(item.status)).length;
    const invested = investedProjects(deals).length;
    const conversion = Math.round((invested / (deals.length || 1)) * 100);
    const metrics = [
      ["Deals no pipeline", deals.length, "Todos os estágios do CRM", "↗"],
      ["Valor total", currency(totalValue), "Portfolio analisado", "$"],
      ["Deals quentes", hotDeals, "Quente + Pipeline", "◉"],
      ["Taxa de conversão", `${conversion}%`, "Deals com tag Investido", "✓"]
    ];

    const titleRow = document.createElement("section");
    titleRow.className = "page-head";
    titleRow.innerHTML = `
      <div>
        <h3>Dashboard</h3>
        <p>Pipeline completo da ${config.name.split(" ")[0]} com dashboard e funil</p>
      </div>
      <div class="page-head-actions"><button class="action-button" data-ref-action="new-opportunity" type="button">+ Oportunidade</button></div>
    `;
    panel.appendChild(titleRow);

    const grid = document.createElement("div");
    grid.className = "dashboard-grid";
    grid.appendChild(renderDashboardFunnel(deals, config.pipelineStages));
    grid.appendChild(renderDashboardSide(metrics));
    grid.appendChild(renderDashboardTable(deals));
    panel.appendChild(grid);
    return panel;
  }

  function renderDashboardSectionFallback(sectionName, error) {
    console.error(`[dashboard:${sectionName}] Falha ao renderizar bloco`, error);
    const section = document.createElement("section");
    section.className = "panel";
    section.style.gridColumn = "1 / -1";
    section.style.width = "100%";
    section.style.display = "grid";
    section.style.gap = "8px";
    section.style.padding = "18px";
    section.innerHTML = `
      <div class="panel-header">
        <div>
          <h3>${displayText(sectionName)}</h3>
          <p>Esse bloco do dashboard não pôde ser carregado com os dados atuais.</p>
        </div>
      </div>
    `;
    return section;
  }

  function renderDashboardSectionSafely(sectionName, renderFn) {
    try {
      return renderFn();
    } catch (error) {
      return renderDashboardSectionFallback(sectionName, error);
    }
  }

  function renderRitoReferenceDashboard() {
    const panel = document.createElement("section");
    panel.className = "content-grid";
    const workspaceName = workspaceConfig[state.currentWorkspace]?.name || "Workspace";

    const titleRow = document.createElement("section");
    titleRow.className = "dashboard-title-row dashboard-title-row-rito";
    titleRow.innerHTML = `
      <div>
        <h3>Dashboard</h3>
        <p>Pipeline completo da ${workspaceName} com dashboard e funil</p>
      </div>
      <button class="action-button" data-ref-action="new-opportunity" type="button">+ Oportunidade</button>
    `;
    panel.appendChild(titleRow);

    const grid = document.createElement("div");
    grid.className = "dashboard-grid rito-dashboard-grid";
    grid.appendChild(renderDashboardSectionSafely("Funil do pipeline", () => renderRitoFunnel()));
    grid.appendChild(renderDashboardSectionSafely("Resumo do dashboard", () => renderRitoDashboardSide()));
    panel.appendChild(grid);
    return panel;
  }

  function renderRitoFunnel() {
    const filters = dashboardFilterState();
    const crmItems = (workspaceData().crmItems || []).filter((item) => item && !Array.isArray(item) && typeof item === "object");
    const panel = document.createElement("section");
    panel.className = "panel funnel-card rito-funnel-panel";
    panel.innerHTML = `<div class="panel-header"><div><h3>Etapas do Pipeline</h3></div></div>`;

    const stages = referenceDashboardStages();
    const stageCount = Math.max(stages.length - 1, 1);

    const stack = document.createElement("div");
    stack.className = "funnel-stack rito-funnel-stack";

    stages.forEach((stage, index) => {
      const widthPercent = Math.max(58, 100 - Math.round((index / stageCount) * 38));
      const block = document.createElement("div");
      block.className = `funnel-block rito-funnel-block ${filters.stage === stage.label ? "is-active" : ""}`;
      block.dataset.dashboardStage = stage.label;
      block.style.background = stage.tone;
      block.style.width = `${widthPercent}%`;
      block.innerHTML = `<div class="rito-funnel-count" style="color:${stage.accent}">${stage.count}</div><div class="rito-funnel-label">${stage.label}</div><div class="subtle">${stage.deals}</div>`;
      block.onclick = () => {
        const current = dashboardFilterState();
        current.stage = current.stage === stage.label ? "Todos" : stage.label;
        saveState();
        updateRitoDashboardView();
      };
      stack.appendChild(block);
        if (index !== stages.length - 1) {
          const divider = document.createElement("div");
          divider.className = "funnel-divider rito-funnel-divider";
          const nextWidthPercent = Math.max(58, 100 - Math.round(((index + 1) / stageCount) * 38));
          divider.style.width = `${Math.max(60, Math.min(widthPercent, nextWidthPercent) + 4)}%`;
          divider.innerHTML = `<span style="width:${stage.count ? "100" : "0"}%; background:${stage.accent}"></span>`;
          stack.appendChild(divider);
        }
      });

    const summary = document.createElement("section");
    summary.className = "rito-funnel-summary";

    const totalCount = referenceDashboardRows().length;
    const summaryHeader = document.createElement("div");
    summaryHeader.className = "rito-funnel-summary-head";
    summaryHeader.innerHTML = `<div class="eyebrow">Filtrar por etapa</div>`;
    summary.appendChild(summaryHeader);

    const summaryRows = [
      { label: "Todos", count: totalCount, accent: "#8f877d", all: true },
      ...stages.map((stage) => ({ label: stage.label, count: stage.count, accent: stage.accent }))
    ];

    summaryRows.forEach((item) => {
      const button = document.createElement("button");
      const active = filters.stage === item.label || (item.all && filters.stage === "Todos");
      button.type = "button";
      button.className = `rito-funnel-summary-row ${active ? "is-active" : ""}`;
      button.dataset.dashboardStage = item.label;
      button.onmousedown = (event) => event.preventDefault();
      button.innerHTML = `
        <span class="rito-funnel-summary-main">
          <span class="rito-funnel-summary-dot" style="background:${item.accent}"></span>
          <span class="rito-funnel-summary-label">${item.label}</span>
        </span>
        <span class="rito-funnel-summary-count">${item.count}</span>
      `;
      button.onclick = () => {
        dashboardFilterState().stage = item.all ? "Todos" : item.label;
        saveState();
        updateRitoDashboardView();
      };
      summary.appendChild(button);
    });

    panel.append(stack, summary, renderDeclinedReasonsPanel(crmItems, { compact: true }));
    return panel;
  }

  function renderRitoDashboardSide() {
    const filters = dashboardFilterState();
    const filteredRows = getFilteredRitoDashboardRows();
    const crmItems = (workspaceData().crmItems || []).filter((item) => item && !Array.isArray(item) && typeof item === "object");
    const visibleIds = new Set(filteredRows.map((row) => row.id).filter(Boolean));
    const visibleCompanies = new Set(filteredRows.map((row) => row.company));
    const visibleItems = crmItems.filter((item) => visibleIds.has(item.id) || visibleCompanies.has(displayText(item.name || item.company || "").trim()));
    const allocatedValue = allocatedPortfolioValue(visibleItems);
    const projectedValue = projectedAllocationValue(visibleItems);
    const exitItems = visibleItems.filter((item) => normalizeReferenceDashboardStage(item) === "Exit");
    const exitAllocatedValue = exitItems.reduce((sum, item) => sum + Number(item?.investmentAmount || 0), 0);
    const side = document.createElement("section");
    side.className = "dashboard-side rito-dashboard-side";

    const metrics = [
      [String(filteredRows.length), "Deals", "visíveis no dashboard", "↗", "", undefined, "slate"],
      [String(filteredRows.filter((row) => ["Aporte", "Portfólio"].includes(row.stage)).length), "Investidos", "deals investidos", "✦", "", undefined, "success"],
      [String(filteredRows.filter((row) => row.stage === "Declinado").length), "Declinados", "deals recusados", "✕", "", undefined, "danger"],
      [String(filteredRows.filter((row) => row.stage === "Exit").length), "Exit", exitAllocatedValue ? `${currency(exitAllocatedValue)} alocado` : "sem valor alocado", "↘", "", undefined, "success"],
      [String(filteredRows.filter((row) => row.temp === "Quente").length), "Quentes", "prioridade alta", "◉", "", undefined, "hot"],
      [String(filteredRows.filter((row) => row.temp === "Morno").length), "Mornos", "em acompanhamento", "◎", "", undefined, "warm"],
      [String(filteredRows.filter((row) => row.temp === "Frio").length), "Frios", "baixa tração", "○", "", undefined, "cold"],
      [allocatedValue ? currency(allocatedValue) : "-", "Valor alocado", "projetos investidos", "$", "", undefined, "money"],
      [projectedValue ? currency(projectedValue) : "-", "Projeção de alocação", "deals não investidos", "$", "", undefined, "money"]
    ];

    const metricsRow = document.createElement("section");
    metricsRow.className = "metrics-grid rito-metrics-grid";
    metricsRow.style.maxWidth = "1320px";
    metricsRow.style.width = "100%";
    metricsRow.style.margin = "0 auto";
    metricsRow.style.display = "grid";
    metricsRow.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    metricsRow.style.gap = "10px 14px";
    metrics.forEach(([value, label, foot, icon, deltaText, deltaPositive, tone]) => {
      metricsRow.appendChild(buildMetricCard(label, value, foot, icon, deltaText, deltaPositive, tone));
    });
    side.appendChild(metricsRow);

    const controls = document.createElement("section");
    controls.className = "pill-filter-row rito-filter-row";
    controls.innerHTML = `
      <label class="search-field top-search">
        <input id="ritoDashboardSearch" type="search" placeholder="Buscar empresa ou deal..." value="${escapeAttr(filters.query || "")}">
      </label>
      <div class="rito-filter-actions">
        <div class="pill-group rito-filter-primary">
          <button class="soft-pill filter-chip-frio ${filters.temp === "Frio" ? "is-active" : ""}" data-dashboard-temp="Frio">Frio</button>
          <button class="soft-pill filter-chip-morno ${filters.temp === "Morno" ? "is-active" : ""}" data-dashboard-temp="Morno">Morno</button>
          <button class="soft-pill filter-chip-quente ${filters.temp === "Quente" ? "is-active" : ""}" data-dashboard-temp="Quente">Quente</button>
          <button class="soft-pill filter-chip-declined ${filters.stage === "Declinados" ? "is-active" : ""}" data-dashboard-stage="Declinados">Declinados</button>
        </div>
        <div class="pill-group rito-filter-reset">
          <button class="soft-pill filter-chip-neutral ${(filters.temp === "Todos" && filters.stage === "Todos") ? "is-active" : ""}" data-dashboard-reset="1">Todos</button>
        </div>
      </div>
    `;
    controls.style.gridTemplateColumns = "minmax(220px, 320px) 1fr";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";
    const searchField = controls.querySelector(".top-search");
    const searchInput = controls.querySelector("#ritoDashboardSearch");
    const primaryGroup = controls.querySelector(".rito-filter-primary");
    const resetGroup = controls.querySelector(".rito-filter-reset");
    searchField.style.maxWidth = "320px";
    searchField.style.width = "100%";
    searchInput.style.minHeight = "40px";
    searchInput.style.padding = "0 14px";
    searchInput.style.fontSize = "0.74rem";
    primaryGroup.style.display = "flex";
    primaryGroup.style.flexWrap = "nowrap";
    primaryGroup.style.gap = "8px";
    primaryGroup.style.alignItems = "center";
    resetGroup.style.display = "flex";
    resetGroup.style.justifyContent = "flex-start";
    resetGroup.style.marginTop = "0";
    const actions = controls.querySelector(".rito-filter-actions");
    actions.style.display = "flex";
    actions.style.alignItems = "center";
    actions.style.justifyContent = "flex-start";
    actions.style.flexWrap = "nowrap";
    actions.style.gap = "8px";
    controls.querySelectorAll(".soft-pill").forEach((button) => {
      button.style.minWidth = button.dataset.dashboardReset ? "88px" : "84px";
      button.style.minHeight = "36px";
      button.style.padding = "0 12px";
      button.style.fontSize = "0.64rem";
    });
    controls.querySelector("#ritoDashboardSearch").oninput = (event) => {
      dashboardFilterState().query = event.target.value;
      saveState();
      updateRitoDashboardView();
    };
    controls.querySelectorAll("[data-dashboard-temp]").forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        const current = dashboardFilterState();
        current.temp = current.temp === button.dataset.dashboardTemp ? "Todos" : button.dataset.dashboardTemp;
        if (current.temp !== "Todos" && current.stage === "Declinados") current.stage = "Todos";
        saveState();
        updateRitoDashboardView();
      };
    });
    controls.querySelectorAll("[data-dashboard-stage]").forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        const current = dashboardFilterState();
        current.stage = current.stage === button.dataset.dashboardStage ? "Todos" : button.dataset.dashboardStage;
        if (current.stage !== "Todos") current.temp = "Todos";
        saveState();
        updateRitoDashboardView();
      };
    });
    controls.querySelectorAll("[data-dashboard-reset]").forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        const current = dashboardFilterState();
        current.temp = "Todos";
        current.stage = "Todos";
        saveState();
        updateRitoDashboardView();
      };
    });
    side.appendChild(controls);

    side.appendChild(renderDashboardSectionSafely("Tabela do pipeline", () => renderRitoDashboardTable(filteredRows)));
    side.appendChild(renderDashboardSectionSafely("Seguranças e inseguranças", () => renderProjectConfidencePanel(filteredRows)));
    return side;
  }

  function renderRitoDashboardTable(rows = referenceDashboardRows()) {
    const table = document.createElement("section");
    table.className = "panel dashboard-table rito-dashboard-table";
    const crmItems = (workspaceData().crmItems || []).filter((item) => item && !Array.isArray(item) && typeof item === "object");
    const safeRows = (Array.isArray(rows) ? rows : []).filter((row) => row && !Array.isArray(row) && typeof row === "object");
    const head = document.createElement("div");
    head.className = "table-head";
    head.innerHTML = "<div>Empresa</div><div>Resumo do status</div><div>Estágio</div><div>Temp.</div><div>Responsável</div>";
    table.appendChild(head);

    safeRows.forEach((rowData) => {
      const row = document.createElement("div");
      row.className = "table-row rito-table-row";
      const companyName = displayText(rowData.company || "Deal sem nome").trim() || "Deal sem nome";
      const linked = crmItems.find((item) => item?.id && rowData.id && item.id === rowData.id)
        || crmItems.find((item) => displayText(item?.name || item?.company || "").trim() === companyName);
      row.innerHTML = `
        <div class="company-cell">
          ${renderCompanyBadge(rowData)}
          <div><strong>${companyName}</strong><div class="subtle">${displayText(rowData.segment || "-")}</div></div>
        </div>
        <div class="table-summary-cell">${escapeHTML(displayText(rowData.statusSummary || ""))}</div>
        <div class="stage-select-cell">${linked ? `<select class="deal-status-select deal-status-select-table" data-dashboard-status="${linked.id}">${ritoStatusOptionsMarkup(linked.status)}</select>` : `<span class="chip chip-${String(rowData.stage || "lead").toLowerCase().replace(/\s+/g, "-")}">${displayText(rowData.stage || "Lead")}</span>`}</div>
        <div><span class="chip chip-${String(rowData.temp || "frio").toLowerCase()}" data-dashboard-temp-chip>${displayText(rowData.temp || "Frio")}</span></div>
        <div class="owner-cell">${renderOwnerAvatar(rowData.owner)}<span>${displayText(rowData.owner)}</span></div>
      `;
      if (linked) {
        const statusSelect = row.querySelector(`[data-dashboard-status="${linked.id}"]`);
        if (statusSelect) {
          bindDealStatusSelect(statusSelect, linked, () => {
            saveState();
            updateRitoDashboardView();
          });
        }
        row.draggable = false;
        row.dataset.crmId = linked.id;
        row.classList.add("is-clickable");
        row.onclick = (event) => {
          if (event.target instanceof Element && event.target.closest(".stage-select-cell, .deal-status-select-table")) return;
          if (!(event.target instanceof Element) || !event.target.closest(".company-cell")) return;
          openProjectDetail(linked.id, "dashboard");
        };
      }
      table.appendChild(row);
    });

    if (!safeRows.length) {
      const empty = document.createElement("div");
      empty.className = "rito-dashboard-empty";
      empty.textContent = "Nenhum deal encontrado com os filtros atuais.";
      table.appendChild(empty);
    }

    return table;
  }

  function summarizeProjectField(items, key) {
    const grouped = [];
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || Array.isArray(item) || typeof item !== "object") return;
      const projectName = displayText(item?.name || item?.projectName || item?.company || "").trim();
      const entries = Array.from(new Set(splitProjectInsightList(item?.[key])));
      if (!projectName || !entries.length) return;
      grouped.push({ projectName, entries });
    });
    return grouped.sort((a, b) => a.projectName.localeCompare(b.projectName, "pt-BR"));
  }

  function renderConfidenceBucket(title, subtitle, entries, toneClass) {
    const bucket = document.createElement("article");
    bucket.className = `project-confidence-bucket ${toneClass}`;
    bucket.innerHTML = `
      <div class="panel-header">
        <div>
          <h3>${title}</h3>
          <p>${subtitle}</p>
        </div>
      </div>
    `;
    const list = document.createElement("div");
    list.className = "project-confidence-list";
    if (!entries.length) {
      list.innerHTML = `<div class="subtle">Nenhum item preenchido ainda.</div>`;
    } else {
      entries.forEach((entry) => {
        const row = document.createElement("article");
        row.className = "project-confidence-row";
        row.innerHTML = `
          <div class="project-confidence-head">
            <strong>${escapeHTML(displayText(entry.projectName))}</strong>
          </div>
          <p class="project-confidence-projects">${escapeHTML(title)}: ${entry.entries.map((item) => escapeHTML(displayText(item))).join(", ")}.</p>
        `;
        list.appendChild(row);
      });
    }
    bucket.appendChild(list);
    return bucket;
  }

  function renderProjectConfidencePanel(rows = referenceDashboardRows()) {
    const safeRows = (Array.isArray(rows) ? rows : []).filter((row) => row && !Array.isArray(row) && typeof row === "object");
    const panel = document.createElement("section");
    panel.className = "panel project-confidence-panel";
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h3>Leitura do pipeline</h3>
          <p>Seguranças e inseguranças consolidadas dos projetos visíveis</p>
        </div>
      </div>
    `;
    const grid = document.createElement("div");
    grid.className = "project-confidence-grid";
    grid.appendChild(renderConfidenceBucket("Seguranças", "Pontos positivos mais recorrentes", summarizeProjectField(safeRows, "projectStrengths"), "is-strength"));
    grid.appendChild(renderConfidenceBucket("Inseguranças", "Pontos de atenção mais recorrentes", summarizeProjectField(safeRows, "projectWeaknesses"), "is-weakness"));
    panel.appendChild(grid);
    return panel;
  }

  function renderDeclinedReasonsPanel(items, { compact = false } = {}) {
    const panel = document.createElement("section");
    panel.className = `panel declined-reasons-panel${compact ? " declined-reasons-panel-compact" : ""}`;
    const reasons = declinedDealReasonGroups((Array.isArray(items) ? items : []).filter((item) => item && !Array.isArray(item) && typeof item === "object"));
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h3>Motivos dos deals declinados</h3>
          <p>Leitura consolidada dos resumos preenchidos nos cards declinados</p>
        </div>
      </div>
    `;
    const list = document.createElement("div");
    list.className = "declined-reasons-list";
    if (!reasons.length) {
      list.innerHTML = `<div class="subtle">Nenhum motivo preenchido nos deals declinados.</div>`;
    } else {
      reasons.forEach((entry) => {
        const row = document.createElement("article");
        row.className = "declined-reason-row";
        row.innerHTML = `
          <div class="declined-reason-head">
            <strong>${escapeHTML(displayText(entry.projectName))}</strong>
          </div>
          <p class="declined-reason-projects">Motivos do declínio: ${entry.reasons.map((item) => escapeHTML(displayText(item))).join(", ")}.</p>
        `;
        list.appendChild(row);
      });
    }
    panel.appendChild(list);
    return panel;
  }

  function renderRitoDashboardCards(cards = []) {
    const wrap = document.createElement("section");
    wrap.className = "dashboard-highlight-section";
    wrap.innerHTML = `<div class="section-head-row"><h4>Deals em destaque</h4><span class="subtle">${cards.length} visíveis</span></div>`;
    const grid = document.createElement("div");
    grid.className = "dashboard-highlight-grid";
    (cards.length ? cards.slice(0, 3) : getRitoReferenceCards().slice(0, 3)).forEach((card) => {
      const node = createReferenceProjectCard(card);
      node.classList.add("dashboard-highlight-card");
      grid.appendChild(node);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderRitoPipelinePage() {
    const viewMode = referenceViewMode("crm");
    const crmItems = workspaceData().crmItems || [];
    const investedCount = investedProjects(crmItems).length;
    const pipelineCount = crmItems.filter((item) => normalizeReferenceDashboardStage(item) === "Pipeline").length;
    const declinedCount = crmItems.filter((item) => normalizeReferenceDashboardStage(item) === "Declinado").length;
    const totalPortfolioValue = projectedAllocationValue(crmItems);
    const page = document.createElement("section");
    page.className = "content-grid ref-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Pipeline</h3><p>Pipeline operacional de deals da Rito</p></div>
        <div class="page-head-actions">
          <div class="segmented"><button class="${viewMode === "cards" ? "is-active" : ""}" data-ref-action="cards-view" data-ref-view="crm" type="button">Cards</button><button class="${viewMode === "list" ? "is-active" : ""}" data-ref-action="list-view" data-ref-view="crm" type="button">Lista</button></div>
          <button class="ghost-button" data-ref-action="export-crm" type="button">Exportar deals</button>
          <button class="action-button" data-ref-action="new-opportunity" type="button">+ Oportunidade</button>
        </div>
      </section>
    `;
    page.appendChild(renderStatStrip([
        [String(crmItems.length), "Total", "", "↗", "", undefined, "slate"],
        [String(investedCount), "Investidos", "", "✦", "", undefined, "success"],
        [String(pipelineCount), "Pipeline", "", "◉", "", undefined, "warm"],
        [String(declinedCount), "Declinados", "", "✕", "", undefined, "danger"],
        [totalPortfolioValue ? currency(totalPortfolioValue) : "-", "Projeção de alocação", "", "$", "", undefined, "money"]
      ], "pipeline-stat-strip"));
    page.appendChild(renderRitoPipelineToolbar());
    const results = viewMode === "list"
      ? renderReferenceList(getFilteredRitoPipelineCards(), "crm", "Nenhum deal encontrado")
      : renderRitoPipelineGrid();
    results.classList.add("rito-pipeline-results");
    page.appendChild(results);
    return page;
  }

  function renderRitoInvestedPage() {
    const viewMode = referenceViewMode("invested");
    const investedCards = getRitoInvestedCards();
    const completedCount = investedCards.length;
    const activeCount = 0;
    const investedValue = allocatedPortfolioValue(workspaceData().crmItems || []);
    const page = document.createElement("section");
    page.className = "content-grid ref-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Projetos Investidos</h3><p>Apenas empresas investidas</p></div>
        <div class="page-head-actions">
          <div class="segmented"><button class="${viewMode === "cards" ? "is-active" : ""}" data-ref-action="cards-view" data-ref-view="invested" type="button">Cards</button><button class="${viewMode === "list" ? "is-active" : ""}" data-ref-action="list-view" data-ref-view="invested" type="button">Lista</button></div>
          <button class="action-button" data-ref-action="new-project" type="button">+ Projeto</button>
        </div>
      </section>
    `;
    page.appendChild(renderStatStrip([
      [String(investedCards.length), "Total", "", "✦", "", undefined, "success"],
      [String(activeCount), "Em andamento", "", "◉", "", undefined, "warm"],
      [String(completedCount), "Concluídos", "", "✓", "", undefined, "success"],
      [investedValue ? currency(investedValue) : "-", "Valor alocado", "", "$", "", undefined, "money"]
    ], "compact compact-four"));
    if (viewMode === "list") {
      page.appendChild(renderReferenceList(investedCards, "invested", "Nenhum projeto investido encontrado"));
    } else {
      const grid = document.createElement("section");
      grid.className = "reference-card-grid invested-grid";
      investedCards.forEach((card) => grid.appendChild(createReferenceProjectCard(card, true, "invested")));
      page.appendChild(grid);
    }
    return page;
  }

  function renderProjectMetaCard(label, content) {
    return `<article class="project-meta-card"><span>${label}</span><div>${content}</div></article>`;
  }

  function openProjectDetail(projectId, sourceView = state.currentView[state.currentWorkspace]) {
    flushOpenEditors();
    state.selectedProjectId[state.currentWorkspace] = projectId;
    state.projectReturnView[state.currentWorkspace] = sourceView === "projectDetail"
      ? (state.projectReturnView[state.currentWorkspace] || "crm")
      : sourceView;
    state.currentView[state.currentWorkspace] = "projectDetail";
    saveState();
    renderApp();
    window.scrollTo({ top: 0, behavior: "auto" });
    document.querySelector(".main-panel")?.scrollTo({ top: 0, behavior: "auto" });
    document.querySelector(".page-stack")?.scrollTo({ top: 0, behavior: "auto" });
  }

  function closeProjectDetail() {
    flushOpenEditors();
    state.currentView[state.currentWorkspace] = state.projectReturnView[state.currentWorkspace] || "crm";
    saveState();
    renderApp();
  }

  function renderRitoProjectDetailPage() {
    const item = getSelectedProject();
    if (!item) return renderRitoPipelinePage();
    ensureProjectShape(item);
    const displayCover = projectMediaValue(item, "cover");
    const displayLogo = projectMediaValue(item, "logo");
    const relatedTasks = workspaceData().projectBoards[item.name] || [];
    const relatedDocs = getRelatedDocuments(item);
    const sourceView = state.projectReturnView[state.currentWorkspace] || "crm";
    const page = document.createElement("section");
    page.className = "content-grid ref-page project-detail-page";
    page.tabIndex = -1;
    page.innerHTML = `
      <button class="ghost-button project-back-button" data-project-action="back" type="button">Voltar para ${tabTitle(sourceView)}</button>
      <section class="project-hero">
        <div class="project-hero-cover" style="background-image:url('${displayCover}');background-position:${item.media.coverPosition};background-size:${item.media.coverZoom}% auto;"></div>
        <div class="project-hero-shell">
          <div class="project-hero-logo">${displayLogo ? `<img src="${displayLogo}" alt="${item.name}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;transform:scale(${(item.media.logoScale || 100) / 100});">` : initials(item.name)}</div>
          <div class="project-hero-main">
            <div class="project-hero-copy">
              <h3>${item.name}</h3>
              <div class="subtle">${item.subtitle}</div>
              <div class="chips">${[item.status, ...item.tags].map((tag) => `<span class="chip">${tag}</span>`).join("")}</div>
            </div>
            <div class="project-hero-actions">
              <button class="action-button" data-project-action="toggle-invested" type="button">${item.investmentStatus === "Investido" ? "Investido" : "Marcar investido"}</button>
              <button class="ghost-button" data-project-action="paste-cover" type="button">Colar capa</button>
              <label class="ghost-button" for="detailCoverUpload">Upload capa</label>
              <button class="ghost-button" data-project-action="paste-logo" type="button">Colar logo</button>
              <button class="ghost-button" data-project-action="resize-logo" type="button">Redimensionar logo</button>
              <label class="ghost-button" for="detailLogoUpload">Upload logo</label>
              <button class="ghost-button" data-project-action="edit-focus" type="button">Editar</button>
              <button class="ghost-button project-delete-button" data-project-action="delete" type="button">Excluir</button>
              <input id="detailLogoUpload" type="file" accept="image/*" hidden>
              <input id="detailCoverUpload" type="file" accept="image/*" hidden>
            </div>
          </div>
        </div>
      </section>
      <section class="project-progress-card">
        <div class="project-progress-head"><span>Progresso</span><strong>${item.progress}%</strong></div>
        <div class="progress-bar"><span style="width:${item.progress}%;background:${item.accent || coverPalette[item.status] || "#6677b8"}"></span></div>
      </section>
      <section class="project-detail-card project-tag-toolbar">
        <div class="project-tag-toolbar-row">
          <span class="project-tag-toolbar-label">Tags</span>
          <button class="ghost-button" id="toggleProjectTagPicker" type="button">Selecionar</button>
        </div>
        <div class="tag-editor project-tag-selected-list is-compact">${editableProjectTags(item).map((tag) => `<span class="tag-chip ${tagChipClass(tag)}">${tag}<button data-remove-project-tag="${escapeAttr(tag)}" type="button">×</button></span>`).join("") || "<div class='subtle'>Nenhuma tag personalizada selecionada.</div>"}</div>
        <section class="tag-picker-shell tag-picker-shell-compact hidden" id="projectTagPicker">
          <div class="tag-picker-head">
            <span class="field-label">Selecionar tags</span>
            <button class="ghost-icon-button" id="closeProjectTagPicker" type="button" aria-label="Fechar tags">×</button>
          </div>
          <div class="tag-picker-inline-row">
            <input id="projectTagCreateInput" placeholder="Criar tag">
            <button class="ghost-button" id="projectTagCreateButton" type="button">Adicionar</button>
          </div>
          <div class="tag-picker-block">
            <div class="tag-picker-options">${workspaceProjectTagOptions().map((tag) => `<button class="tag-picker-option ${tagChipClass(tag)} ${editableProjectTags(item).some((entry) => normalizeProjectTagKey(entry) === normalizeProjectTagKey(tag)) ? "is-selected" : ""}" data-toggle-project-tag="${escapeAttr(tag)}" type="button">${tag}</button>`).join("") || "<div class='subtle'>Nenhuma tag cadastrada ainda.</div>"}</div>
          </div>
          <div class="tag-picker-block">
            <span class="field-label">Gerenciar catálogo</span>
            <div class="tag-manage-list">${workspaceProjectTagOptions().map((tag) => `<div class="tag-manage-row"><input data-tag-rename-input="${escapeAttr(tag)}" value="${escapeAttr(tag)}"><button class="ghost-button" data-save-tag-rename="${escapeAttr(tag)}" type="button">Renomear</button><button class="ghost-button danger-button" data-delete-project-tag="${escapeAttr(tag)}" type="button">Excluir</button></div>`).join("") || "<div class='subtle'>As novas tags aparecerão aqui.</div>"}</div>
          </div>
        </section>
      </section>
      <section class="project-meta-grid">
        ${renderProjectMetaCard("Nome", `<input data-drawer-field="name" value="${escapeAttr(item.name || "")}">`)}
        ${renderProjectMetaCard("Fase", `<select data-drawer-field="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${isRitoDealInStage(item, stage) ? "selected" : ""}>${stage}</option>`).join("")}</select>`)}
        ${renderProjectMetaCard("Subtítulo", `<input data-drawer-field="subtitle" value="${escapeAttr(item.subtitle || "")}">`)}
        ${renderProjectMetaCard("Setor", `<input data-drawer-field="sector" value="${escapeAttr(item.sector || "")}">`)}
        ${renderProjectMetaCard("Localização", `<input data-drawer-field="location" value="${escapeAttr(item.location || "")}">`)}
        ${renderProjectMetaCard("Ano", `<input data-drawer-field="year" value="${escapeAttr(item.year || "")}">`)}
        ${renderProjectMetaCard("Website", `<input data-drawer-field="website" value="${escapeAttr(item.website || "")}">`)}
        ${renderProjectMetaCard("Contato principal", `<input data-drawer-field="mainContact" value="${escapeAttr(item.mainContact || "")}">`)}
        ${renderProjectMetaCard("Telefone", `<input data-drawer-field="phone" value="${escapeAttr(item.phone || "")}">`)}
        ${renderProjectMetaCard("E-mail", `<input data-drawer-field="email" type="email" value="${escapeAttr(item.email || "")}">`)}
        ${renderProjectMetaCard("Responsável", `<select data-drawer-field="owner">${workspaceOwnerOptions(state.currentWorkspace, item.owner).map((owner) => `<option value="${escapeAttr(owner)}" ${owner === item.owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}</select>`)}
        ${renderProjectMetaCard("Temperatura", `<input data-drawer-field="temperature" value="${escapeAttr(item.temperature || "")}" readonly>`)}
        ${renderProjectMetaCard("Prioridade", `<select data-drawer-field="priority"><option ${item.priority === "Alta" ? "selected" : ""}>Alta</option><option ${item.priority === "Media" ? "selected" : ""}>Média</option><option ${item.priority === "Baixa" ? "selected" : ""}>Baixa</option></select>`)}
        ${renderProjectMetaCard("VC/PE Backed", `<input data-drawer-field="vcPeBacked" value="${escapeAttr(item.vcPeBacked || "")}">`)}
        ${renderProjectMetaCard("Investimento", `<select data-drawer-field="investmentStatus"><option ${item.investmentStatus === "Nao investido" ? "selected" : ""}>Não investido</option><option ${item.investmentStatus === "Investido" ? "selected" : ""}>Investido</option></select>`)}
        ${renderProjectMetaCard("Valor da operação", `<input data-drawer-field="investmentAmount" type="number" value="${escapeAttr(item.investmentAmount || 0)}">`)}
        ${renderProjectMetaCard("Criado em", `<input data-drawer-field="createdAt" value="${escapeAttr(item.createdAt || "")}">`)}
        ${renderProjectMetaCard("Atualizado em", `<input data-drawer-field="updatedAt" value="${escapeAttr(item.updatedAt || "")}">`)}
      </section>
      <section class="project-detail-sections">
        <article class="project-detail-card"><h4>Descrição da Empresa</h4><textarea class="detail-textarea" data-drawer-field="description">${item.description || ""}</textarea></article>
        <article class="project-detail-card"><h4>Histórico do deal / Resumo do status</h4><textarea class="detail-textarea" data-drawer-field="dealHistory">${item.dealHistory || ""}</textarea></article>
        <article class="project-detail-card"><h4>Seguranças do projeto</h4><textarea class="detail-textarea" data-drawer-field="projectStrengths">${item.projectStrengths || ""}</textarea></article>
        <article class="project-detail-card"><h4>Inseguranças do projeto</h4><textarea class="detail-textarea" data-drawer-field="projectWeaknesses">${item.projectWeaknesses || ""}</textarea></article>
        <article class="project-detail-card"><h4>Time de gestão</h4><textarea class="detail-textarea" data-drawer-field="managementTeam">${displayText(item.managementTeam || "")}</textarea></article>
        <article class="project-detail-card"><h4>Modelo de Negócio</h4><textarea class="detail-textarea" data-drawer-field="businessModel">${item.businessModel || ""}</textarea></article>
        <article class="project-detail-card"><h4>Competidores</h4><textarea class="detail-textarea" data-drawer-field="competitors">${item.competitors || ""}</textarea></article>
        <article class="project-detail-card"><h4>Vantagens Competitivas</h4><textarea class="detail-textarea" data-drawer-field="advantages">${item.advantages || ""}</textarea></article>
        <article class="project-detail-card">
          <h4>Framework</h4>
          <div class="project-framework-grid">
            <label class="field"><span>Tese</span><textarea data-framework-field="tese">${item.frameworkDetails.tese || ""}</textarea></label>
            <label class="field"><span>Oportunidade</span><textarea data-framework-field="oportunidade">${item.frameworkDetails.oportunidade || ""}</textarea></label>
            <label class="field"><span>Riscos</span><textarea data-framework-field="riscos">${item.frameworkDetails.riscos || ""}</textarea></label>
            <label class="field"><span>Próximos passos</span><textarea data-framework-field="proximosPassos">${item.frameworkDetails.proximosPassos || ""}</textarea></label>
            <label class="field"><span>Status da diligência</span><input data-framework-field="statusDiligencia" value="${escapeAttr(item.frameworkDetails.statusDiligencia || "")}"></label>
            <label class="field"><span>Observações estratégicas</span><input data-framework-field="observacoes" value="${escapeAttr(item.frameworkDetails.observacoes || "")}"></label>
          </div>
        </article>
      </section>
      <section class="project-detail-card project-detail-kanban-card">
        <div class="section-head-row">
          <h4>Kanban do Projeto</h4>
          <button class="action-button" data-project-action="new-task" type="button">+ Nova Tarefa</button>
        </div>
        <div class="reference-board project-columns-board detail-project-board" id="detailProjectBoard"></div>
      </section>
      <section class="project-detail-card">
        <div class="section-head-row">
          <h4>Documentos Relacionados</h4>
          <button class="ghost-button" data-project-action="new-doc" type="button">Upload</button>
        </div>
        <div class="related-list">
          ${relatedDocs.map((doc) => `<article class="related-item"><strong>${doc.name}</strong><span class="subtle">${doc.category} - ${doc.uploadedAt}</span><div class="inline-actions">${resolveDocumentUrl(doc) ? `<a class="ghost-button" href="${escapeAttr(resolveDocumentUrl(doc))}" target="_blank" rel="noreferrer">Abrir</a>` : ""}<button class="ghost-button" data-delete-doc="${doc.id}" type="button">Excluir</button></div></article>`).join("") || "<div class='project-mini-empty'>Nenhum documento vinculado.</div>"}
        </div>
      </section>
      <section class="project-detail-card">
        <h4>Timeline / Histórico</h4>
        <div class="timeline-list">${item.history.map((entry) => `<article class="timeline-item"><strong>${entry.text}</strong><span class="subtle">${entry.at}</span></article>`).join("")}</div>
      </section>
    `;
    populateProjectDetailBoard(page, item);
    bindRitoProjectDetailPage(page, item);
    return page;
  }

  function populateProjectDetailBoard(page, item) {
    const board = page.querySelector("#detailProjectBoard");
    if (!board) return;
    board.innerHTML = "";
    const relatedTasks = workspaceData().projectBoards[item.name] || [];
    workspaceProjectThemes(state.currentWorkspace).forEach((stage, index) => {
      const tasks = relatedTasks.filter((task) => (task.stage || task.status) === stage);
      const column = document.createElement("article");
      column.className = "reference-project-column project-board-column detail-project-board-column";
      column.innerHTML = `
        <div class="reference-column-head project-column-head detail-project-column-head">
          <span class="reference-column-accent accent-${index % 6}"></span>
          <strong>${displayText(stage)}</strong>
          <span class="column-count">${tasks.length}</span>
        </div>
        <div class="reference-column-list project-column-list detail-project-column-list"></div>
      `;
      const list = column.querySelector(".detail-project-column-list");
      if (!tasks.length) {
        const empty = document.createElement("div");
        empty.className = "empty-project detail-empty-project";
        empty.textContent = "Sem tarefas";
        list.appendChild(empty);
      } else {
        tasks.forEach((task) => list.appendChild(createTaskCard(task, true, item.name)));
      }
      board.appendChild(column);
    });
  }

  function bindRitoProjectDetailPage(page, item) {
    const sourceView = state.projectReturnView[state.currentWorkspace] || "crm";
    const projectTagPickerKey = `${state.currentWorkspace}:${item.id}`;
    page.querySelector("[data-project-action='back']").onclick = closeProjectDetail;
    page.querySelector("[data-project-action='delete']").onclick = async () => {
      const docsToRemove = workspaceData().documents.filter((doc) => (doc.linkedTo || "").toLowerCase() === item.name.toLowerCase());
      await Promise.all(docsToRemove.map((doc) => removeFileFromStorage(PORTAL_DOCUMENTS_BUCKET, doc.filePath)));
      await removeCRMItem(item);
      closeProjectDetail();
    };
    page.querySelector("[data-project-action='toggle-invested']").onclick = async () => {
      await persistDrawerProject(item, page);
      item.investmentStatus = item.investmentStatus === "Investido" ? "Nao investido" : "Investido";
      syncInvestmentTag(item);
      item.updatedAt = todayISO();
      pushHistory(item, item.investmentStatus === "Investido" ? "Projeto marcado como investido" : "Projeto removido de investidos");
      await upsertCRMItem(item);
      openProjectDetail(item.id, sourceView);
    };
    page.querySelector("[data-project-action='edit-focus']").onclick = () => {
      openProjectEditDialog(item, sourceView);
    };
    page.querySelector("[data-project-action='paste-cover']").onclick = async () => {
      openProjectPasteDialog(item, "cover", sourceView);
    };
    page.querySelector("[data-project-action='paste-logo']").onclick = async () => {
      openProjectPasteDialog(item, "logo", sourceView);
    };
    page.querySelector("[data-project-action='resize-logo']").onclick = () => {
      void (async () => {
      const sizes = [90, 100, 110, 120];
      const currentIndex = sizes.indexOf(item.media.logoScale || 100);
      item.media.logoScale = sizes[(currentIndex + 1) % sizes.length];
      item.updatedAt = new Date().toISOString();
      pushHistory(item, `Escala da logo ajustada para ${item.media.logoScale}%`);
      const persistPromise = upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false
      });
      openProjectDetail(item.id, sourceView);
      await persistPromise;
      })().catch((error) => {
        alert(error?.message || "Não foi possível atualizar a logo.");
      });
    };
    page.querySelector("[data-project-action='new-task']").onclick = () => openTaskDialog(item.name);
    page.querySelector("[data-project-action='new-doc']").onclick = () => openDocumentDialog(item.name);
    page.querySelector("#detailLogoUpload").onchange = async (event) => {
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        await applyProjectImageFile(item, "logo", file, sourceView);
      } catch (error) {
        alert(error?.message || "Não foi possível atualizar a logo.");
      }
    };
    page.querySelector("#detailCoverUpload").onchange = async (event) => {
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        await applyProjectImageFile(item, "cover", file, sourceView);
      } catch (error) {
        alert(error?.message || "Não foi possível atualizar a capa.");
      }
    };
    page.querySelectorAll("input[data-drawer-field='progress']").forEach((field) => {
      field.addEventListener("input", () => {
        page.querySelectorAll("input[data-drawer-field='progress']").forEach((peer) => {
          if (peer !== field) peer.value = field.value;
        });
        page.querySelector(".project-progress-head strong").textContent = `${field.value}%`;
        page.querySelector(".project-progress-card .progress-bar span").style.width = `${field.value}%`;
      });
    });
    const statusField = page.querySelector("[data-drawer-field='status']");
    const temperatureField = page.querySelector("[data-drawer-field='temperature']");
    statusField?.addEventListener("change", () => {
      if (temperatureField) temperatureField.value = temperatureFromRitoDealStatus(statusField.value);
      persistProjectDraft(item, page);
    });
    const projectTagPicker = page.querySelector("#projectTagPicker");
    const toggleProjectTagPickerButton = page.querySelector("#toggleProjectTagPicker");
    const closeProjectTagPicker = () => {
      activeProjectTagPickerKey = "";
      projectTagPicker?.classList.add("hidden");
    };
    const openProjectTagPicker = () => {
      activeProjectTagPickerKey = projectTagPickerKey;
      projectTagPicker?.classList.remove("hidden");
    };
    const persistProjectTagChange = async (historyMessage) => {
      item.updatedAt = todayISO();
      pushHistory(item, historyMessage);
      activeProjectTagPickerKey = projectTagPickerKey;
      await upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false,
        preserveLocalOnError: true
      });
      openProjectDetail(item.id, sourceView);
    };
    if (activeProjectTagPickerKey === projectTagPickerKey) {
      projectTagPicker?.classList.remove("hidden");
    }
    toggleProjectTagPickerButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (projectTagPicker?.classList.contains("hidden")) openProjectTagPicker();
      else closeProjectTagPicker();
    });
    page.querySelector("#closeProjectTagPicker")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeProjectTagPicker();
    });
    projectTagPicker?.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    page.addEventListener("click", (event) => {
      if (projectTagPicker?.classList.contains("hidden")) return;
      if (projectTagPicker?.contains(event.target)) return;
      if (toggleProjectTagPickerButton?.contains(event.target)) return;
      closeProjectTagPicker();
    });
    const createProjectTag = async () => {
      const input = page.querySelector("#projectTagCreateInput");
      const value = String(input?.value || "").trim();
      const key = normalizeProjectTagKey(value);
      if (!value || !key) return;
      const options = workspaceProjectTagOptions();
      if (!options.some((tag) => normalizeProjectTagKey(tag) === key)) {
        workspaceData().projectTagOptions = [...options, value];
      }
      const nextTags = [...editableProjectTags(item)];
      if (!nextTags.some((tag) => normalizeProjectTagKey(tag) === key)) nextTags.push(value);
      setEditableProjectTags(item, nextTags);
      await persistProjectTagChange(`Tag adicionada: ${value}`);
    };
    page.querySelector("#projectTagCreateButton")?.addEventListener("click", () => {
      void createProjectTag();
    });
    page.querySelector("#projectTagCreateInput")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void createProjectTag();
    });
    page.querySelectorAll("[data-toggle-project-tag]").forEach((button) => {
      button.onclick = async () => {
        const value = button.dataset.toggleProjectTag;
        const current = editableProjectTags(item);
        const exists = current.some((tag) => normalizeProjectTagKey(tag) === normalizeProjectTagKey(value));
        const nextTags = exists
          ? current.filter((tag) => normalizeProjectTagKey(tag) !== normalizeProjectTagKey(value))
          : [...current, value];
        setEditableProjectTags(item, nextTags);
        await persistProjectTagChange(exists ? `Tag removida: ${value}` : `Tag adicionada: ${value}`);
      };
    });
    page.querySelectorAll("[data-remove-project-tag]").forEach((button) => {
      button.onclick = async () => {
        const value = button.dataset.removeProjectTag;
        const nextTags = editableProjectTags(item).filter((tag) => normalizeProjectTagKey(tag) !== normalizeProjectTagKey(value));
        setEditableProjectTags(item, nextTags);
        await persistProjectTagChange(`Tag removida: ${value}`);
      };
    });
    page.querySelectorAll("[data-save-tag-rename]").forEach((button) => {
      button.onclick = () => {
        const oldTag = button.dataset.saveTagRename;
        const input = button.closest(".tag-manage-row")?.querySelector("input[data-tag-rename-input]");
        const nextTag = String(input?.value || "").trim();
        if (!nextTag) return;
        renameProjectTagAcrossWorkspace(oldTag, nextTag);
        item.updatedAt = todayISO();
        pushHistory(item, `Tag renomeada: ${oldTag} -> ${nextTag}`);
        activeProjectTagPickerKey = projectTagPickerKey;
        saveState();
        openProjectDetail(item.id, sourceView);
      };
    });
    page.querySelectorAll("[data-delete-project-tag]").forEach((button) => {
      button.onclick = () => {
        const value = button.dataset.deleteProjectTag;
        deleteProjectTagAcrossWorkspace(value);
        item.updatedAt = todayISO();
        pushHistory(item, `Tag excluída do catálogo: ${value}`);
        activeProjectTagPickerKey = projectTagPickerKey;
        saveState();
        openProjectDetail(item.id, sourceView);
      };
    });
    page.addEventListener("paste", async (event) => {
      const target = page.dataset.pasteTarget;
      if (!target) return;
      const file = clipboardImageFromPasteEvent(event);
      if (!file) return;
      event.preventDefault();
      page.dataset.pasteTarget = "";
      await applyProjectImageFile(item, target, file, sourceView);
    });
    page.querySelectorAll("[data-delete-doc]").forEach((button) => {
      button.onclick = async () => {
        const doc = workspaceData().documents.find((entry) => entry.id === button.dataset.deleteDoc);
        await removeFileFromStorage(PORTAL_DOCUMENTS_BUCKET, doc?.filePath);
        workspaceData().documents = workspaceData().documents.filter((entry) => entry.id !== button.dataset.deleteDoc);
        item.updatedAt = todayISO();
        pushHistory(item, "Documento relacionado removido");
        saveState();
        openProjectDetail(item.id, sourceView);
      };
    });
    let autosaveTimer = null;
    let autosaveInFlight = Promise.resolve();
    const queueDetailAutosave = (mode = "debounced") => {
      const runAutosave = async () => {
        try {
          await persistDrawerProject(item, page, {
            silentError: true
          });
        } catch (error) {
          console.warn("[crm-save] Autosave do detalhe do projeto falhou.", {
            dealId: item?.id || null,
            dealName: item?.name || null,
            message: error?.message || String(error)
          });
        }
      };
      if (mode === "immediate") {
        clearTimeout(autosaveTimer);
        autosaveInFlight = autosaveInFlight.then(runAutosave);
        return;
      }
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        autosaveInFlight = autosaveInFlight.then(runAutosave);
      }, 650);
    };
    page.querySelectorAll("[data-drawer-field], [data-framework-field]").forEach((field) => {
      const isSelectField = field instanceof HTMLSelectElement;
      const isStatusSelector = field.dataset.drawerField === "status" || field.dataset.drawerField === "investmentStatus";
      field.addEventListener("input", () => {
        if (isSelectField) return;
        persistProjectDraft(item, page);
        queueDetailAutosave("debounced");
      });
      field.addEventListener("change", () => {
        persistProjectDraft(item, page);
        if (isStatusSelector) return;
        queueDetailAutosave("immediate");
      });
      field.addEventListener("blur", () => {
        if (isSelectField) return;
        queueDetailAutosave("immediate");
      });
    });
  }

  function renderRitoKanbanPage() {
    const page = document.createElement("section");
    page.className = "content-grid ref-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Kanban Rito</h3><p>Gestão da empresa organizada por tema</p></div>
        <div class="page-head-actions"><button class="ghost-button" data-ref-action="edit-columns" type="button">Editar colunas</button><button class="action-button" data-ref-action="new-task" type="button">+ Nova Tarefa</button></div>
      </section>
    `;
    const columns = {
      "Infra / CRM": ["Setup Attio: conta + campos customizados + pipelines", "Importar dados Attio (21 pessoas + 12 orgs + 9 deals)", "Review completo Attio", "Retrospectiva 60 dias", "Definir plano proximos 90 dias"],
      "Digital": ["Registrar dominio ritoventures.com.br + Google Workspace", "Configurar Substack/Beehiiv (Carta do Arthur)", "Briefar site v1", "Publicar site v1", "Registrar dominio ritoventures.com.br + Google Workspace"],
      "Deals": ["Fast Massagem: mapear itens pendentes DD (89 itens)", "UFC GYM: IC Memo preliminar v1", "UFC GYM: refinar IC Memo v2", "UFC GYM: iniciar DD", "Fast Massagem: deliberacao IC"],
      "Governanca": ["Listar 10 candidatos para IC externo", "Abordar 5 candidatos IC", "Confirmar 3 membros externos IC", "Redigir regimento interno IC", "Distribuir IC Memo e regimento"],
      "Marca": ["Criar perfil LinkedIn da Rito Ventures"],
      "ID Visual": ["Briefar designer: logo, paleta, tipografia, templates", "Receber e aprovar identidade visual"],
      "Midia & PR": ["Mapear 5 jornalistas / creators para outreach", "Reunir conteudo para press kit", "Definir narrativa institucional", "Contratar apoio de PR"]
    };
    const board = document.createElement("section");
    board.className = "reference-board";
    Object.entries(columns).forEach(([name, tasks], index) => {
      const column = document.createElement("article");
      column.className = "reference-column";
      column.innerHTML = `<div class="reference-column-head"><span class="reference-column-accent accent-${index % 6}"></span><strong>${name}</strong><span class="column-count">${tasks.length}</span></div>`;
      const list = document.createElement("div");
      list.className = "reference-column-list";
      tasks.forEach((task, taskIndex) => {
        const card = document.createElement("article");
        card.className = "reference-task-card";
        const previewOwner = taskIndex % 2 === 0 ? "Arthur Bueno" : "Ciro Ribeiro";
        card.innerHTML = `
          <strong>${task}</strong>
          <div class="mini-chip-row"><span class="chip">A Fazer</span></div>
          <div class="task-meta"><span class="task-dot ${taskIndex % 3 === 0 ? "high" : "mid"}"></span>${taskIndex % 3 === 0 ? "Alta" : "Media"}${renderOwnerAvatar(previewOwner)}</div>
        `;
        list.appendChild(card);
      });
      column.appendChild(list);
      board.appendChild(column);
    });
    page.appendChild(board);
    return page;
  }

  function renderRitoProjectBoardsPage() {
    const page = document.createElement("section");
    page.className = "content-grid ref-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Kanban Projetos</h3></div>
      </section>
    `;
    const names = ["Verse Skincare", "YellotMob", "Omni Internet", "Verde Brasil", "Formula CRM", "UFC Jiu Jitsu", "UFC Gym"];
    const board = document.createElement("section");
    board.className = "reference-board project-board";
    names.forEach((name, index) => {
      const col = document.createElement("article");
      col.className = "reference-project-column";
      col.innerHTML = `<div class="reference-column-head"><span class="reference-column-accent accent-${index % 6}"></span><strong>${name}</strong><span class="column-count">0</span><span class="column-open">Abrir</span></div><div class="empty-project">Sem tarefas</div>`;
      board.appendChild(col);
    });
    page.appendChild(board);
    return page;
  }

  function ritoRitesDocuments() {
    const documents = Array.isArray(workspaceData().documents) ? workspaceData().documents : [];
    return documents.filter((doc) => {
      const linkedTo = String(doc.linkedTo || "").trim().toLowerCase();
      const category = String(doc.category || "").trim().toLowerCase();
      return linkedTo === "rituais" || linkedTo.includes("ritual") || category.includes("ritual");
    });
  }

  function ritoRitesCategoryClass(category = "") {
    const key = String(category || "").trim().toLowerCase();
    if (key === "rede") return "is-network";
    if (key === "construção" || key === "construcao") return "is-build";
    if (key === "comunicação" || key === "comunicacao") return "is-voice";
    if (key === "governança" || key === "governanca") return "is-governance";
    if (key === "lançamento" || key === "lancamento") return "is-launch";
    return "is-neutral";
  }

  function ritoRitesCategories() {
    return [...new Set(RITO_RITES_DATA.map((item) => item.category))];
  }

  function ritoRitesMatches(item) {
    const query = normalizeText(activeRitesQuery);
    const category = normalizeText(activeRitesCategory);
    const haystack = normalizeText([
      item.number,
      item.category,
      item.title,
      item.frequency,
      item.owner,
      item.summary
    ].join(" "));
    const matchesCategory = !category || category === "all" || normalizeText(item.category) === category;
    const matchesQuery = !query || haystack.includes(query);
    return matchesCategory && matchesQuery;
  }

  function ritoFilteredRitesData() {
    return RITO_RITES_DATA.filter(ritoRitesMatches);
  }

  function ritoFocusItem(items = ritoFilteredRitesData()) {
    if (!items.length) return null;
    const focused = items.find((item) => item.id === activeRitesFocusId);
    return focused || items[0];
  }

  function ritoScheduleRowForItem(item) {
    if (!item) return null;
    return RITO_RITES_SCHEDULE.find((row) => normalizeText(row[0]) === normalizeText(item.title)) || null;
  }

  function renderRitoRitesToolbar() {
    const section = document.createElement("section");
    const categories = ritoRitesCategories();
    const filteredItems = ritoFilteredRitesData();
    section.className = "panel rites-toolbar";
    section.innerHTML = `
      <div class="rites-toolbar-row">
        <label class="search-field top-search rites-search">
          <span>Buscar rito</span>
          <input type="search" value="${escapeAttr(activeRitesQuery)}" placeholder="Nome, dono, cadência ou frente" data-rites-input="query">
        </label>
        <div class="rites-toolbar-meta">
          <strong>${filteredItems.length}</strong>
          <span>ritos visíveis com os filtros atuais</span>
        </div>
      </div>
      <div class="rites-toolbar-pills">
        <button class="soft-pill ${activeRitesCategory === "all" ? "is-active" : ""}" data-rites-category="all" type="button">Todas</button>
        ${categories.map((category) => `
          <button class="soft-pill ${normalizeText(activeRitesCategory) === normalizeText(category) ? "is-active" : ""}" data-rites-category="${escapeAttr(category)}" type="button">${escapeHTML(category)}</button>
        `).join("")}
      </div>
    `;
    return section;
  }

  function renderRitoRitesDetailCard(item) {
    const card = document.createElement("aside");
    card.className = "panel rites-detail-card";
    if (!item) {
      card.innerHTML = `
        <span class="rites-detail-label">Sem resultados</span>
        <strong>Nenhum rito encontrado com o filtro atual.</strong>
        <p>Limpe a busca ou troque a frente para voltar a navegar pelo operating system da Rito.</p>
      `;
      return card;
    }
    const schedule = ritoScheduleRowForItem(item);
    const relatedDocuments = ritoRitesDocuments().filter((doc) => {
      const source = normalizeText([doc.name || "", doc.title || "", doc.category || "", doc.linkedTo || ""].join(" "));
      return source.includes(normalizeText(item.title)) || source.includes(normalizeText(item.category));
    });
    card.innerHTML = `
      <div class="rites-detail-head">
        <div>
          <span class="rites-detail-label">Rito em foco</span>
          <strong>${escapeHTML(item.number)}. ${escapeHTML(item.title)}</strong>
        </div>
        <span class="chip chip-neutral">${escapeHTML(item.category)}</span>
      </div>
      <p>${escapeHTML(item.summary)}</p>
      <div class="rites-detail-meta">
        <div><span>Cadência</span><strong>${escapeHTML(item.frequency)}</strong></div>
        <div><span>Dono</span><strong>${escapeHTML(item.owner)}</strong></div>
        <div><span>Quando</span><strong>${escapeHTML(schedule?.[2] || "A definir")}</strong></div>
        <div><span>Suporte</span><strong>${relatedDocuments.length} documento${relatedDocuments.length === 1 ? "" : "s"}</strong></div>
      </div>
      <div class="rites-detail-actions">
        <button class="ghost-button" data-rites-nav="calendar" type="button">Ver no calendário</button>
        <button class="ghost-button" data-rites-nav="models" type="button">Abrir modelos</button>
        <button class="action-button" data-rites-nav="library" type="button">Abrir biblioteca</button>
      </div>
    `;
    return card;
  }

  function renderRitoRitesOverview() {
    const documents = ritoRitesDocuments();
    const filteredItems = ritoFilteredRitesData();
    const categories = [...new Set(filteredItems.map((item) => item.category))];
    const focusedItem = ritoFocusItem(filteredItems);
    const page = document.createElement("section");
    page.className = "rites-section rites-overview";
    const spotlightItems = filteredItems.slice(0, 3);
    page.innerHTML = `
      <section class="panel rites-hero">
        <div class="rites-hero-grid">
          <div class="rites-hero-copy">
            <p class="eyebrow">Operating system da marca</p>
            <h3>Os ritos da Rito Ventures transformam tese em presença, comunidade e disciplina institucional.</h3>
            <p>Esta frente organiza o calendário simbólico da casa, os materiais de apoio e a leitura operacional dos encontros que sustentam reputação, governança e construção de portfólio.</p>
            <div class="rites-hero-tags">
              <span>Marca</span>
              <span>Comunidade</span>
              <span>Governança</span>
              <span>Portfólio</span>
            </div>
          </div>
          <aside class="rites-manifesto-card">
            <span class="rites-manifesto-label">Direção</span>
            <strong>Rito não é cerimônia vazia.</strong>
            <p>Cada encontro precisa carregar intenção, dono, registro e efeito claro na percepção da Rito e na relação com fundadores.</p>
          </aside>
        </div>
        <div class="rites-stat-grid">
          <article class="rites-stat-card"><strong>${filteredItems.length}</strong><span>Ritos visíveis</span><small>Arquitetura ativa no filtro atual</small></article>
          <article class="rites-stat-card"><strong>${categories.length}</strong><span>Frentes operacionais</span><small>Rede, construção, voz e governança</small></article>
          <article class="rites-stat-card"><strong>${documents.length}</strong><span>Modelos enviados</span><small>Cartas, convites, roteiros e suporte</small></article>
          <article class="rites-stat-card"><strong>${RITO_RITES_SCHEDULE.length}</strong><span>Cadências-base</span><small>Rotina executiva organizada por dono</small></article>
        </div>
      </section>
    `;
    const spotlight = document.createElement("section");
    spotlight.className = "rites-overview-grid";
    const spotlightGrid = document.createElement("div");
    spotlightGrid.className = "rites-spotlight-grid";
    spotlightItems.forEach((item) => {
      const card = document.createElement("article");
      card.className = `panel rites-spotlight-card ${ritoRitesCategoryClass(item.category)} ${item.id === focusedItem?.id ? "is-active" : ""}`;
      card.setAttribute("data-rites-focus", item.id);
      card.innerHTML = `
        <div class="rites-spotlight-top">
          <span class="rites-spotlight-index">${escapeHTML(item.number)}</span>
          <span class="chip chip-neutral">${escapeHTML(item.category)}</span>
        </div>
        <h4>${escapeHTML(item.title)}</h4>
        <p>${escapeHTML(item.summary)}</p>
        <div class="rites-spotlight-meta">
          <div><span>Cadência</span><strong>${escapeHTML(item.frequency)}</strong></div>
          <div><span>Dono</span><strong>${escapeHTML(item.owner)}</strong></div>
        </div>
      `;
      spotlightGrid.appendChild(card);
    });
    spotlight.appendChild(spotlightGrid);
    spotlight.appendChild(renderRitoRitesDetailCard(focusedItem));
    page.appendChild(spotlight);
    const grid = document.createElement("section");
    grid.className = "rites-category-grid";
    categories.forEach((category) => {
      const items = filteredItems.filter((item) => item.category === category);
      const card = document.createElement("article");
      card.className = `panel rites-category-card ${ritoRitesCategoryClass(category)}`;
      card.innerHTML = `
        <div class="panel-header">
          <div>
            <h4>${escapeHTML(category)}</h4>
            <p>${items.length} rito${items.length > 1 ? "s" : ""} nesta frente estratégica</p>
          </div>
        </div>
        <div class="rites-bullet-list">
          ${items.map((item) => `
            <button class="rites-bullet-row ${item.id === focusedItem?.id ? "is-active" : ""}" data-rites-focus="${escapeAttr(item.id)}" type="button">
              <strong>${escapeHTML(item.number)}. ${escapeHTML(item.title)}</strong>
              <p>${escapeHTML(item.summary)}</p>
              <span>${escapeHTML(item.frequency)}  •  ${escapeHTML(item.owner)}</span>
            </button>
          `).join("")}
        </div>
      `;
      grid.appendChild(card);
    });
    page.appendChild(grid);
    return page;
  }

  function renderRitoRitesLibrary() {
    const filteredItems = ritoFilteredRitesData();
    const focusedItem = ritoFocusItem(filteredItems);
    const section = document.createElement("section");
    section.className = "rites-library-shell";
    const grid = document.createElement("section");
    grid.className = "rites-library-grid";
    filteredItems.forEach((item) => {
      const card = document.createElement("article");
      card.className = `panel rites-library-card ${ritoRitesCategoryClass(item.category)} ${item.id === focusedItem?.id ? "is-active" : ""}`;
      card.setAttribute("data-rites-focus", item.id);
      card.innerHTML = `
        <div class="rites-library-head">
          <span class="chip chip-neutral">${escapeHTML(item.category)}</span>
          <span class="rites-library-index">${escapeHTML(item.number)}</span>
        </div>
        <h4>${escapeHTML(item.title)}</h4>
        <p>${escapeHTML(item.summary)}</p>
        <div class="rites-library-meta">
          <div><span>Frequência</span><strong>${escapeHTML(item.frequency)}</strong></div>
          <div><span>Dono</span><strong>${escapeHTML(item.owner)}</strong></div>
        </div>
      `;
      grid.appendChild(card);
    });
    if (!filteredItems.length) {
      grid.innerHTML = `<article class="panel rites-empty-state"><strong>Nenhum rito encontrado.</strong><p class="subtle">Ajuste a busca ou troque a frente para ampliar a biblioteca.</p></article>`;
    }
    section.appendChild(grid);
    section.appendChild(renderRitoRitesDetailCard(focusedItem));
    return section;
  }

  function renderRitoRitesModels() {
    const documents = ritoRitesDocuments();
    const section = document.createElement("section");
    section.className = "rites-models-shell";
    section.innerHTML = `
      <section class="panel rites-models-hero">
        <div class="panel-header">
          <div>
            <h4>Modelos e materiais de apoio</h4>
            <p>Central de documentos que dão consistência à comunicação da Rito: cartas, convites, roteiros, pautas, cronogramas e relatórios.</p>
          </div>
          <div class="page-head-actions">
            <button class="ghost-button" data-rites-action="open-documents" type="button">Abrir biblioteca</button>
            <button class="action-button" data-rites-action="upload-model" type="button">Upload de modelo</button>
          </div>
        </div>
      </section>
    `;
    const list = document.createElement("section");
    list.className = "rites-model-list";
    if (!documents.length) {
      list.innerHTML = `
        <article class="panel rites-model-card">
          <strong>Nenhum modelo enviado ainda.</strong>
          <p class="subtle">Use o upload para começar a biblioteca dos ritos com cartas, convites, cronogramas e roteiros.</p>
        </article>
      `;
    } else {
      documents.forEach((doc) => {
        const documentName = String(doc.name || doc.title || "Documento").trim();
        const rawUrl = resolveDocumentUrl(doc);
        const fileUrl = toFileHref(rawUrl);
        const meta = [
          String(doc.category || "Rituais").trim(),
          String(doc.uploadedAt || "").trim()
        ].filter(Boolean).join(" - ");
        const card = document.createElement("article");
        card.className = "panel rites-model-card";
        card.innerHTML = `
          <div class="rites-model-badge">Template</div>
          <div class="rites-model-main">
            <strong>${escapeHTML(documentName)}</strong>
            <p class="subtle">${escapeHTML(meta || "Material da biblioteca de ritos")}</p>
          </div>
          <div class="inline-actions">
            ${fileUrl
              ? `<a class="ghost-button" href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">Abrir</a>
                <a class="action-button" href="${escapeAttr(fileUrl)}" download="${escapeAttr(documentName)}" target="_blank" rel="noreferrer">Download</a>`
              : `<button class="ghost-button" disabled>Abrir</button>
                <button class="action-button" disabled>Download</button>`}
          </div>
        `;
        list.appendChild(card);
      });
    }
    section.appendChild(list);
    return section;
  }

  function renderRitoRitesCalendar() {
    const filteredItems = ritoFilteredRitesData();
    const filteredTitles = new Set(filteredItems.map((item) => normalizeText(item.title)));
    const filteredSchedule = RITO_RITES_SCHEDULE.filter((row) => filteredTitles.has(normalizeText(row[0])));
    const focusedItem = ritoFocusItem(filteredItems);
    const section = document.createElement("section");
    section.className = "rites-calendar-shell";
    const panel = document.createElement("section");
    panel.className = "panel rites-calendar-panel";
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h4>Calendário operacional</h4>
          <p>Agenda executiva dos ritos que organizam presença de marca, rotina institucional e relacionamento com fundadores.</p>
        </div>
        <div class="rites-calendar-note">Base 2026</div>
      </div>
    `;
    const table = document.createElement("div");
    table.className = "rites-calendar-table";
    table.innerHTML = `
      <div class="rites-calendar-row rites-calendar-head">
        <span>Rito</span>
        <span>Cadência</span>
        <span>Quando</span>
        <span>Dono</span>
        <span>Frente</span>
      </div>
      ${filteredSchedule.map((row) => {
        const matchedItem = filteredItems.find((item) => normalizeText(item.title) === normalizeText(row[0]));
        return `
        <button class="rites-calendar-row ${ritoRitesCategoryClass(row[4])} ${matchedItem?.id === focusedItem?.id ? "is-active" : ""}" data-rites-focus="${escapeAttr(matchedItem?.id || "")}" type="button">
          <strong>${escapeHTML(row[0])}</strong>
          <span>${escapeHTML(row[1])}</span>
          <span>${escapeHTML(row[2])}</span>
          <span>${escapeHTML(row[3])}</span>
          <span>${escapeHTML(row[4])}</span>
        </button>
      `;
      }).join("")}
    `;
    panel.appendChild(table);
    section.appendChild(panel);
    section.appendChild(renderRitoRitesDetailCard(focusedItem));
    return section;
  }

  function renderRitoRitesRules() {
    const focusedItem = ritoFocusItem();
    const section = document.createElement("section");
    section.className = "rites-rules-shell";
    const grid = document.createElement("section");
    grid.className = "rites-rules-grid";
    RITO_RITES_RULES.forEach((rule, index) => {
      const card = document.createElement("article");
      card.className = "panel rites-rule-card";
      card.innerHTML = `
        <span class="rites-rule-index">Regra ${index + 1}</span>
        <p>${escapeHTML(rule)}</p>
      `;
      grid.appendChild(card);
    });
    section.appendChild(grid);
    section.appendChild(renderRitoRitesDetailCard(focusedItem));
    return section;
  }

  function renderRitoRitesPage() {
    const page = document.createElement("section");
    page.className = "content-grid ref-page rites-page";
    page.innerHTML = `
      <section class="page-head rites-page-head">
        <div><h3>Ritos</h3><p>Arquitetura de marca, relacionamento e governança da Rito Ventures</p></div>
        <div class="page-head-actions">
          <div class="segmented rites-segmented">
            <button class="${activeRitesSection === "overview" ? "is-active" : ""}" data-rites-section="overview" type="button">Visão Geral</button>
            <button class="${activeRitesSection === "library" ? "is-active" : ""}" data-rites-section="library" type="button">Biblioteca</button>
            <button class="${activeRitesSection === "models" ? "is-active" : ""}" data-rites-section="models" type="button">Modelos</button>
            <button class="${activeRitesSection === "calendar" ? "is-active" : ""}" data-rites-section="calendar" type="button">Calendário</button>
            <button class="${activeRitesSection === "rules" ? "is-active" : ""}" data-rites-section="rules" type="button">Regras</button>
          </div>
        </div>
      </section>
    `;
    page.appendChild(renderRitoRitesToolbar());
    if (activeRitesSection === "overview") page.appendChild(renderRitoRitesOverview());
    if (activeRitesSection === "library") page.appendChild(renderRitoRitesLibrary());
    if (activeRitesSection === "models") page.appendChild(renderRitoRitesModels());
    if (activeRitesSection === "calendar") page.appendChild(renderRitoRitesCalendar());
    if (activeRitesSection === "rules") page.appendChild(renderRitoRitesRules());
    return page;
  }

  function renderRitoDocumentsPage() {
    const documents = Array.isArray(workspaceData().documents) ? workspaceData().documents : [];
    const page = document.createElement("section");
    page.className = "content-grid ref-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Documentos</h3><p>Biblioteca de documentos - ${documents.length} arquivos</p></div>
        <div class="page-head-actions"><button class="action-button" data-ref-action="upload-doc" type="button">Upload</button></div>
      </section>
    `;
    const toolbar = document.createElement("section");
    toolbar.className = "reference-toolbar docs-toolbar";
    toolbar.innerHTML = `
      <div class="toolbar-left docs-toolbar-left">
        <label class="search-field top-search"><input type="search" placeholder="Buscar documento..."></label>
        <div class="pill-group"><button class="soft-pill is-active">Todos</button><button class="soft-pill">Marketing</button></div>
      </div>
    `;
    page.appendChild(toolbar);
    const grid = document.createElement("section");
    grid.className = "reference-doc-grid";
    documents.forEach((doc) => {
      const card = document.createElement("article");
      card.className = "reference-doc-card";
      const documentName = String(doc.name || doc.title || "Documento").trim();
      const rawUrl = resolveDocumentUrl(doc);
      const fileUrl = toFileHref(rawUrl);
      const isUploading = Boolean(doc.uploading);
      const fileType = String(doc.fileType || documentName.split(".").pop() || "arquivo").replace(/^\./, "").trim();
      const category = String(doc.category || "Geral").trim();
      const linkedTo = String(doc.linkedTo || "").trim();
      const icon = fileType ? fileType.slice(0, 4).toUpperCase() : "DOC";
      const tags = [category, linkedTo, fileType.toLowerCase()].filter(Boolean);
      const description = isUploading
        ? "Upload em andamento para a biblioteca do workspace."
        : linkedTo
        ? `Documento vinculado a ${linkedTo}.`
        : "Documento armazenado na biblioteca do workspace.";
      const meta = [doc.uploadedAt, fileType.toUpperCase()].filter(Boolean).join(" - ") || "Arquivo sem metadados";
      card.innerHTML = `
        <div class="doc-icon">${icon}</div>
        <strong>${escapeHTML(documentName)}</strong>
        <div class="chips">${tags.map((tag) => `<span class="chip">${escapeHTML(tag)}</span>`).join("")}</div>
        <p class="subtle">${escapeHTML(description)}</p>
        <div class="subtle">${escapeHTML(meta)}</div>
        <div class="inline-actions">
          ${fileUrl
            ? `<a class="action-button" href="${escapeAttr(fileUrl)}" download="${escapeAttr(documentName)}" target="_blank" rel="noreferrer">Download</a>
              <a class="ghost-button" href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">Abrir</a>`
            : `<button class="action-button" disabled>${isUploading ? "Enviando..." : "Download"}</button>
              <button class="ghost-button" disabled>${isUploading ? "Processando" : "Abrir"}</button>`}
          <button class="ghost-button" data-ref-action="delete-doc" data-doc-id="${escapeAttr(doc.id)}" data-doc-title="${escapeAttr(documentName)}" type="button">Excluir</button>
        </div>
      `;
      grid.appendChild(card);
    });
    if (!documents.length) {
      grid.innerHTML = "<article class='reference-doc-card'><strong>Nenhum documento enviado ainda.</strong><p class='subtle'>Use Upload para adicionar arquivos a esta biblioteca.</p></article>";
    }
    page.appendChild(grid);
    return page;
  }

  function renderRitoMembersPage() {
    const page = document.createElement("section");
    const members = sharedMembersData();
    page.className = "content-grid ref-page members-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Membros</h3><p>${members.length} membros cadastrados</p></div>
        <div class="page-head-actions"><button class="action-button" data-ref-action="new-member" type="button">+ Membro</button></div>
      </section>
    `;
    const list = document.createElement("section");
    list.className = "reference-member-list";
    members.forEach((member) => {
      const view = memberCardData(member);
      const row = document.createElement("article");
      row.className = "reference-member-card";
      row.innerHTML = `
          <div class="member-main">
          <div class="member-avatar" style="background:${view.color}">${view.photo ? `<img src="${view.photo}" alt="${escapeAttr(view.name)}" loading="lazy" decoding="async">` : view.initials}</div>
          <div class="member-copy"><strong>${view.name}</strong><div class="subtle">${view.info}</div><div class="chips">${view.tags.map((tag) => `<span class="chip">${tag}</span>`).join("")}</div></div>
        </div>
        <div class="member-actions"><button class="ghost-button member-edit-button" data-ref-action="edit-member" data-member="${escapeAttr(member.name)}" type="button">Editar</button><button class="ghost-button member-delete-button" data-ref-action="delete-member" data-member="${escapeAttr(member.name)}" type="button">X</button></div>
      `;
      list.appendChild(row);
    });
    page.appendChild(list);
    return page;
  }

  function renderRitoSettingsPage() {
    const page = document.createElement("section");
    page.className = "content-grid ref-page";
    page.innerHTML = `
      <section class="page-head">
        <div><h3>Configurações</h3><p>Gestão de workspaces, tema e sistema</p></div>
      </section>
      <section class="settings-section">
        <h4>Aparência</h4>
        <article class="panel settings-card-row"><div><strong>Tema da Interface</strong><div class="subtle">Alterne entre dark e light mode</div></div><div class="segmented"><button data-ref-action="set-dark" type="button">Dark</button><button class="is-active" data-ref-action="set-light" type="button">Light</button></div></article>
      </section>
      <section class="settings-section">
        <h4>Workspaces</h4>
        <div class="workspace-settings-list">
          <article><strong>Rito</strong><div class="subtle">17 empresas - 127 tarefas - 5 documentos - 17 oportunidades</div><div class="inline-actions"><button class="ghost-button" data-ref-action="workspace-edit" data-workspace="rito" type="button">Editar</button><button class="ghost-button" data-ref-action="workspace-duplicate" data-workspace="rito" type="button">Duplicar</button><button class="ghost-button" data-ref-action="workspace-link" data-workspace="rito" type="button">Link</button></div></article>
          <article><strong>Fast Massagem</strong><div class="subtle">2 empresas - 38 tarefas - 0 documentos - 0 oportunidades</div><div class="inline-actions"><button class="ghost-button" data-ref-action="workspace-edit" data-workspace="fast" type="button">Editar</button><button class="ghost-button" data-ref-action="workspace-duplicate" data-workspace="fast" type="button">Duplicar</button><button class="ghost-button" data-ref-action="workspace-link" data-workspace="fast" type="button">Link</button></div></article>
          <button class="ghost-button settings-add" data-ref-action="new-workspace" type="button">+ Novo Workspace</button>
        </div>
      </section>
      <section class="settings-section">
        <h4>Dados do Sistema</h4>
        <div class="system-grid"><article class="panel"></article><article class="panel"></article><article class="panel"></article><article class="panel"></article><article class="panel"></article></div>
      </section>
    `;
    return page;
  }

  function renderStatStrip(items, extraClass = "") {
    const wrap = document.createElement("section");
    wrap.className = `reference-stat-strip ${extraClass}`.trim();
    items.forEach(([value, label, footnote, icon, deltaText, deltaPositive, tone]) => {
      const card = buildMetricCard(label, value, footnote || "", icon, deltaText, deltaPositive, tone);
      wrap.appendChild(card);
    });
    return wrap;
  }

  function createToolbarRow(label, pills, placeholder) {
    const row = document.createElement("section");
    row.className = "reference-toolbar";
    row.innerHTML = `
      <div class="toolbar-left">
        ${label ? `<span class="eyebrow">${displayText(label)}</span>` : ""}
        <div class="pill-group">${pills.map((pill, index) => `<button class="soft-pill ${index === 0 && label !== "" ? "is-active" : ""}">${displayText(pill)}</button>`).join("")}</div>
      </div>
      <label class="search-field top-search"><input type="search" placeholder="${displayText(placeholder)}"></label>
    `;
    return row;
  }

  function createReferenceProjectCard(card, invested = false, sourceView = "crm") {
    const article = document.createElement("article");
    article.className = "reference-project-card";
    const linked = findCRMItemForReferenceCard(card);
    const isInvested = isInvestedProjectRecord(linked || card) || invested;
    const allocationLabel = isInvested ? "Valor alocado" : "Projeção";
    const displayCover = linked ? projectMediaValue(linked, "cover") : (card.cover || "");
    const displayLogo = linked ? projectMediaValue(linked, "logo") : (card.logo || "");
    const displayLogoText = linked?.logoText || card.logoText || "";
    const displayLogoBg = displayLogo ? "#ffffff" : (linked?.logoBg || card.logoBg || "#ffffff");
    const displayTags = normalizeProjectTagList(linked?.tags?.length ? linked.tags : card.tags, linked || card);
    const displayStatus = isInvested ? "Concluído" : (linked ? linked.status : card.status);
    const displayOwner = linked?.owner || card.owner;
    const displayProgress = isInvested ? 100 : (linked?.progress ?? card.progress ?? 35);
    const companyDescription = displayText(linked?.description || card.description || linked?.businessModel || card.framework || "-");
    const statusSummarySource = linked || card;
    const statusSummary = dealStatusSummaryPreview(statusSummarySource, 160);
    const statusSummaryLabel = normalizeReferenceDashboardStage(statusSummarySource) === "Declinado" ? "Motivo do declínio" : "Resumo do status";
    if (linked) {
      article.dataset.crmId = linked.id;
    }
    article.innerHTML = `
      <div class="reference-cover" style="background-image:url('${displayCover}')">
        <span class="cover-dot reference-drag-handle" data-no-drag="false" aria-hidden="true">⋮⋮</span>
        <span class="status-badge">${displayText(displayStatus)}</span>
      </div>
      <div class="reference-logo ${displayLogo ? "has-image" : ""}" ${displayLogo ? "" : `style="background:${displayLogoBg}"`}>${displayLogo ? `<img src="${displayLogo}" alt="${card.name}" loading="lazy" decoding="async">` : displayLogoText}</div>
      <div class="reference-card-body">
        <strong>${displayText(card.name)}</strong>
        <div class="subtle">${displayText(card.subtitle)}</div>
        <div class="chips">${displayTags.map((tag) => `<span class="chip ${tagChipClass(tag)}">${displayText(tag)}</span>`).join("")}</div>
        <div class="reference-description-block">
          <span>Descrição da empresa</span>
          <p>${companyDescription}</p>
        </div>
        <div class="reference-description-block reference-status-block">
          <span>${statusSummaryLabel}</span>
          <p>${statusSummary}</p>
        </div>
        <label class="reference-value-field">
          <span>${displayText(allocationLabel)}</span>
          <input type="text" inputmode="decimal" data-card-investment value="${linked ? formatLocaleNumber(linked.investmentAmount || 0) : "0"}">
        </label>
        <div class="progress-bar"><span style="width:${isInvested ? 100 : displayProgress}%; background:${card.accent}"></span></div>
        <div class="subtle">${isInvested ? "100% concluído" : displayText(displayOwner)}</div>
      </div>
    `;
    if (linked) {
      const investmentInput = article.querySelector("[data-card-investment]");
      const syncInvestmentAmount = () => {
        linked.investmentAmount = Math.max(0, parseLocaleNumber(investmentInput.value || 0));
        linked.updatedAt = new Date().toISOString();
        syncInvestmentTag(linked);
        linked.__draftDirty = true;
        saveLocalPortalState(state);
      };
      const commitInvestmentAmount = async () => {
        if (article.dataset.investmentSavePending === "1") return;
        article.dataset.investmentSavePending = "1";
        syncInvestmentAmount();
        investmentInput.value = formatLocaleNumber(linked.investmentAmount);
        try {
          await upsertCRMItem(linked, {
            skipRender: true,
            renderOnSuccess: false
          });
          renderAppPreservingScroll();
        } finally {
          article.dataset.investmentSavePending = "0";
        }
      };
      const queueInvestmentAutosave = () => {
        clearTimeout(article.__investmentAutosaveTimer);
        article.__investmentAutosaveTimer = setTimeout(() => {
          void commitInvestmentAmount();
        }, 700);
      };
      investmentInput.addEventListener("input", () => {
        syncInvestmentAmount();
        queueInvestmentAutosave();
      });
      investmentInput.addEventListener("change", () => {
        void commitInvestmentAmount();
      });
      investmentInput.addEventListener("blur", () => {
        void commitInvestmentAmount();
      });
      wireDealReorderInteractions(article, linked.id, {
        dropTargetSelector: ".reference-project-card.is-reorderable-deal",
        onOpen: () => openProjectDetail(linked.id, sourceView)
      });
    }
    return article;
  }

  function buildMetricCard(label, value, footnote, icon, deltaText, deltaPositive, tone = "") {
    const template = document.getElementById("metricCardTemplate");
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".metric-label").textContent = displayText(label);
    node.querySelector(".metric-value").textContent = value;
    node.querySelector(".metric-footnote").textContent = displayText(footnote);
    if (tone) {
      node.classList.add(`metric-card--${tone}`);
    }

    const iconBox = node.querySelector(".metric-icon-box");
    const iconEl = node.querySelector(".metric-icon");
    if (icon && iconEl) {
      iconEl.textContent = icon;
    } else if (iconBox) {
      iconBox.remove();
    }

    const deltaEl = node.querySelector(".metric-delta");
    if (deltaEl && deltaText) {
      const arrow = deltaPositive === false ? "↘" : "↗";
      deltaEl.textContent = `${arrow} ${deltaText}`;
      deltaEl.classList.add(deltaPositive === false ? "is-negative" : "is-positive");
    } else if (deltaEl) {
      deltaEl.remove();
    }

    return node;
  }

  function renderMetrics(metrics) {
    const panel = document.createElement("section");
    panel.className = "metrics-grid";
    metrics.forEach(([label, value, footnote, icon, deltaText, deltaPositive]) => {
      panel.appendChild(buildMetricCard(label, value, footnote, icon, deltaText, deltaPositive));
    });
    return panel;
  }

  function renderFunnel(items, stages) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.innerHTML = `<div class="panel-header"><div><h3>Funil de conversão</h3><p>Deals por estágio e distribuição visual do pipeline</p></div></div>`;
    stages.forEach((stage) => {
      const count = items.filter((item) => isRitoDealInStage(item, stage)).length;
      const percentage = Math.round((count / (items.length || 1)) * 100);
      const row = document.createElement("div");
      row.className = "funnel-stage";
      row.innerHTML = `<div style="width:100%"><strong>${stage}</strong><div class="funnel-bar"><span style="width:${Math.max(percentage, 6)}%"></span></div></div><strong>${count}</strong>`;
      panel.appendChild(row);
    });
    return panel;
  }

  function renderStageValuePanel(items, stages) {
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.innerHTML = `<div class="panel-header"><div><h3>Valor por estágio</h3><p>Visibilidade financeira por etapa do funil</p></div></div>`;
    stages.forEach((stage) => {
      const total = items.filter((item) => isRitoDealInStage(item, stage)).reduce((sum, item) => sum + item.estimatedValue, 0);
      const line = document.createElement("div");
      line.className = "member-card";
      line.innerHTML = `<span>${stage}</span><strong>${currency(total)}</strong>`;
      panel.appendChild(line);
    });
    return panel;
  }

  function renderFastDashboardDetail(tasks) {
    const wrap = document.createElement("section");
    wrap.className = "fast-dashboard-shell";

    const workstreams = workspaceTaskThemes("fast");
    const total = tasks.length || 1;
    const summary = taskStatusSummary(tasks);
    const statusGroups = [
      { label: "Não iniciadas", key: "A fazer", count: summary["A fazer"], color: "#9aa4b8" },
      { label: "Em andamento", key: "Em andamento", count: summary["Em andamento"], color: "#4f7cff" },
      { label: "Pausadas", key: "Pausado", count: summary.Pausado, color: "#7a5cc9" },
      { label: "Aguardando", key: "Revisao", count: summary.Revisao, color: "#c6932d" },
      { label: "Concluídas", key: "Concluido", count: summary.Concluido, color: "#32a36a" }
    ];
    const activeStatusKey = state.fastDashboardStatusFocus || "";
    const activeStatusGroup = statusGroups.find((item) => item.key === activeStatusKey) || null;
    const statusSegments = [];
    let cumulative = 0;
    statusGroups.forEach((item) => {
      const size = (item.count / total) * 100;
      statusSegments.push(`${item.color} ${cumulative}% ${cumulative + size}%`);
      cumulative += size;
    });
    const statusPanel = document.createElement("section");
    statusPanel.className = "panel fast-panel";
    statusPanel.innerHTML = `
      <div class="panel-header">
        <div><h3>Status das Atividades</h3><p>Leitura consolidada do pipeline operacional da Fast</p></div>
      </div>
      <div class="fast-status-overview">
        <div class="fast-donut-card">
          <div class="fast-donut" style="background:conic-gradient(${statusSegments.join(", ")})">
            <div class="fast-donut-hole">
              <strong>${tasks.length}</strong>
              <span>tarefas</span>
            </div>
          </div>
        </div>
        <div class="fast-legend-list">
          ${statusGroups.map((item) => `
            <button class="fast-legend-row ${activeStatusKey === item.key ? "is-active" : ""}" data-fast-status-filter="${item.key}" type="button">
              <span class="fast-legend-main"><span class="fast-legend-dot" style="background:${item.color}"></span>${item.label}</span>
              <strong>${item.count}</strong>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    statusPanel.querySelectorAll("[data-fast-status-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextKey = button.dataset.fastStatusFilter;
        state.fastDashboardStatusFocus = state.fastDashboardStatusFocus === nextKey ? "" : nextKey;
        renderApp();
      });
    });
    if (activeStatusGroup) {
      const matchingTasks = tasks.filter((task) => canonicalTaskStatus(task.status) === activeStatusGroup.key);
      const detail = document.createElement("div");
      detail.className = "fast-status-detail";
      detail.innerHTML = `
        <div class="fast-status-detail-head">
          <div>
            <strong>${activeStatusGroup.label}</strong>
            <span>${matchingTasks.length} atividade${matchingTasks.length === 1 ? "" : "s"}</span>
          </div>
          <button class="ghost-button" data-fast-status-close type="button">Fechar</button>
        </div>
        <div class="fast-status-task-list">
          ${matchingTasks.map((task) => `
            <button class="fast-status-task-item" data-fast-status-task="${task.id}" type="button">
              <div class="fast-status-task-top">
                <strong>${displayText(task.title)}</strong>
                <span class="soft-pill">${displayText(task.stage)}</span>
              </div>
              <div class="fast-status-task-meta">${displayText(task.owner || "Sem responsável")} • ${displayText(task.priority || "Média")}${task.dueDate ? ` • Prazo: ${task.dueDate}` : ""}</div>
              ${task.description ? `<p>${displayText(task.description)}</p>` : ""}
            </button>
          `).join("") || "<div class='subtle'>Nenhuma atividade encontrada.</div>"}
        </div>
      `;
      detail.querySelector("[data-fast-status-close]")?.addEventListener("click", () => {
        state.fastDashboardStatusFocus = "";
        renderApp();
      });
      detail.querySelectorAll("[data-fast-status-task]").forEach((button) => {
        button.addEventListener("click", () => {
          openTaskEditor(button.dataset.fastStatusTask, false);
        });
      });
      statusPanel.appendChild(detail);
    }

    const workstreamPanel = document.createElement("section");
    workstreamPanel.className = "panel fast-panel";
    workstreamPanel.innerHTML = `<div class="panel-header"><div><h3>Performance por tema</h3><p>Distribuição das entregas e progresso por frente de trabalho</p></div></div>`;
    workstreams.forEach((stage) => {
      const stageTasks = tasks.filter((task) => task.stage === stage);
      const stageSummary = taskStatusSummary(stageTasks);
      const done = stageSummary.Concluido;
      const inProgress = stageSummary["Em andamento"];
      const waiting = stageSummary.Revisao;
      const progress = Math.round((done / (stageTasks.length || 1)) * 100);
      const row = document.createElement("div");
      row.className = "fast-workstream-row";
      row.innerHTML = `
        <div class="fast-workstream-main">
          <div class="fast-workstream-head">
            <strong>${stage}</strong>
            <span>${stageTasks.length} tarefas</span>
          </div>
          <div class="fast-workstream-stats">${inProgress} em andamento • ${waiting} aguardando • ${done} concluídas</div>
          <div class="fast-progress-track"><span style="width:${Math.max(progress, stageTasks.length ? 10 : 0)}%"></span></div>
        </div>
        <div class="fast-workstream-meta">
          <strong>${progress}%</strong>
          <span>execução</span>
        </div>
      `;
      workstreamPanel.appendChild(row);
    });

    const mixPanel = document.createElement("section");
    mixPanel.className = "panel fast-panel";
    mixPanel.innerHTML = `<div class="panel-header"><div><h3>Mix de execução</h3><p>Leitura visual de volume por tema e intensidade operacional</p></div></div>`;
    const maxStageTasks = Math.max(...workstreams.map((stage) => tasks.filter((task) => task.stage === stage).length), 1);
    workstreams.forEach((stage) => {
      const stageTasks = tasks.filter((task) => task.stage === stage);
      const totalStage = stageTasks.length;
      const stageSummary = taskStatusSummary(stageTasks);
      const done = stageSummary.Concluido;
      const inProgress = stageSummary["Em andamento"];
      const waiting = stageSummary.Revisao;
      const todo = stageSummary["A fazer"];
      const intensity = Math.round((totalStage / maxStageTasks) * 100);
      const row = document.createElement("div");
      row.className = "fast-mix-row";
      row.innerHTML = `
        <div class="fast-mix-head">
          <strong>${stage}</strong>
          <span>${totalStage} tarefas</span>
        </div>
        <div class="fast-mix-bar">
          <span class="fast-mix-segment is-todo" style="width:${(todo / (totalStage || 1)) * 100}%"></span>
          <span class="fast-mix-segment is-progress" style="width:${(inProgress / (totalStage || 1)) * 100}%"></span>
          <span class="fast-mix-segment is-waiting" style="width:${(waiting / (totalStage || 1)) * 100}%"></span>
          <span class="fast-mix-segment is-done" style="width:${(done / (totalStage || 1)) * 100}%"></span>
        </div>
        <div class="fast-mix-footer">
          <span>intensidade ${intensity}%</span>
          <span>${done} concluídas</span>
        </div>
      `;
      mixPanel.appendChild(row);
    });

    const volumePanel = document.createElement("section");
    volumePanel.className = "panel fast-panel";
    volumePanel.innerHTML = `<div class="panel-header"><div><h3>Volume por frente</h3><p>Comparativo visual entre as frentes da operação</p></div></div>`;
    const bars = document.createElement("div");
    bars.className = "fast-volume-chart";
    workstreams.forEach((stage) => {
      const stageTasks = tasks.filter((task) => task.stage === stage);
      const totalStage = stageTasks.length;
      const done = taskStatusSummary(stageTasks).Concluido;
      const height = Math.max(Math.round((totalStage / maxStageTasks) * 100), totalStage ? 18 : 6);
      const bar = document.createElement("div");
      bar.className = "fast-volume-bar";
      bar.innerHTML = `
        <div class="fast-volume-track">
          <span style="height:${height}%"></span>
        </div>
        <strong>${totalStage}</strong>
        <div class="fast-volume-label">${stage}</div>
        <div class="fast-volume-foot">${done} concl.</div>
      `;
      bars.appendChild(bar);
    });
    volumePanel.appendChild(bars);

    const ownerPanel = document.createElement("section");
    ownerPanel.className = "panel fast-panel";
    ownerPanel.innerHTML = `<div class="panel-header"><div><h3>Carga por Responsável</h3><p>Concentração de tarefas e prioridades por pessoa</p></div></div>`;
    const owners = [...new Set(tasks.map((task) => task.owner))];
    owners
      .map((owner) => ({
        owner,
        total: tasks.filter((task) => task.owner === owner).length,
        urgent: tasks.filter((task) => task.owner === owner && task.priority === "Alta").length
      }))
      .sort((a, b) => b.total - a.total)
      .forEach((entry) => {
        const width = Math.round((entry.total / total) * 100);
        const line = document.createElement("div");
        line.className = "fast-owner-row";
        line.innerHTML = `
          <div class="fast-owner-head">
            <strong>${entry.owner}</strong>
            <span>${entry.total} tarefas</span>
          </div>
          <div class="fast-progress-track subtle-track"><span style="width:${Math.max(width, entry.total ? 8 : 0)}%"></span></div>
          <div class="fast-owner-meta">${entry.urgent} prioridades altas</div>
        `;
        ownerPanel.appendChild(line);
      });

    const criticalPanel = document.createElement("section");
    criticalPanel.className = "panel fast-panel";
    criticalPanel.innerHTML = `<div class="panel-header"><div><h3>${displayText("Prioridades Críticas")}</h3><p>${displayText("Itens com maior impacto em caixa, operação e expansão")}</p></div></div>`;
    tasks
      .filter((task) => task.priority === "Alta" || canonicalTaskStatus(task.status) === "Revisao" || /aporte/i.test(task.description))
      .slice(0, 8)
      .forEach((task) => {
        const item = document.createElement("div");
        item.className = "fast-critical-item";
        item.innerHTML = `
          <div class="fast-critical-top">
            <strong>${displayText(task.title)}</strong>
            <span class="soft-pill">${displayText(task.stage)}</span>
          </div>
          <span>${displayText(task.owner)}</span>
          <p>${displayText(task.description || "-")}</p>
        `;
        criticalPanel.appendChild(item);
      });

    const watchPanel = document.createElement("section");
    watchPanel.className = "panel fast-panel";
    watchPanel.innerHTML = `<div class="panel-header"><div><h3>Indicadores de Acompanhamento</h3><p>${displayText("Monitoramento rapido de bloqueios e frentes sensiveis")}</p></div></div>`;
    [
      ["Dependem de aporte", tasks.filter((task) => /aporte/i.test(task.description)).length, "#c6932d"],
      ["Itens financeiros", tasks.filter((task) => task.stage === "Financeiro").length, "#4f7cff"],
      ["Itens de marketing", tasks.filter((task) => task.stage === "Marketing").length, "#9d6bff"],
      ["Entregas concluídas", summary.Concluido, "#32a36a"]
    ].forEach(([label, count, color]) => {
      const width = Math.round((count / total) * 100);
      const line = document.createElement("div");
      line.className = "fast-indicator-row";
      line.innerHTML = `
        <div class="fast-indicator-head"><strong>${displayText(label)}</strong><span>${count}</span></div>
        <div class="fast-progress-track neutral-track"><span style="width:${Math.max(width, count ? 10 : 0)}%; background:${color}"></span></div>
      `;
      watchPanel.appendChild(line);
    });

    wrap.append(statusPanel, volumePanel, workstreamPanel, mixPanel, ownerPanel, criticalPanel, watchPanel);
    return wrap;
  }

  function renderDashboardFunnel(items, stages) {
    const shell = document.createElement("section");
    shell.className = "funnel-shell";
    const panel = document.createElement("section");
    panel.className = "panel funnel-card";
    panel.innerHTML = `<div class="panel-header"><div><h3>Etapas do pipeline</h3></div></div>`;
    const stack = document.createElement("div");
    stack.className = "funnel-stack";

    const tones = ["#d9d9e0", "#efe5c9", "#cfd9f4", "#ddd2f6", "#eed6d1"];
    stages.forEach((stage, index) => {
      const count = items.filter((item) => isRitoDealInStage(item, stage)).length;
      const block = document.createElement("div");
      block.className = "funnel-block";
      block.style.background = tones[index % tones.length];
      block.innerHTML = `<div style="font-size:2.7rem;font-weight:800;color:${index === 1 ? "#b8870b" : index === 2 ? "#4c7df0" : index === 3 ? "#7e55f4" : "#6e7688"}">${count}</div><div style="font-size:1.1rem;font-weight:700;margin-top:8px">${stage}</div><div class="subtle" style="margin-top:10px">${count} deals</div>`;
      stack.appendChild(block);
      if (index !== stages.length - 1) {
        const divider = document.createElement("div");
        divider.className = "funnel-divider";
        if (index === 1) divider.style.background = "#ba8b11";
        stack.appendChild(divider);
      }
    });
    panel.appendChild(stack);
    shell.appendChild(panel);
    return shell;
  }

  function renderDashboardSide(metrics) {
    const side = document.createElement("section");
    side.className = "dashboard-side";
    side.appendChild(renderMetrics(metrics));

    const controls = document.createElement("section");
    controls.className = "pill-filter-row";
    controls.innerHTML = `
      <label class="search-field top-search">
        <input id="dashboardDealSearch" type="search" placeholder="Buscar empresa ou deal...">
      </label>
      <div class="pill-group">
        <button class="soft-pill">Quente</button>
        <button class="soft-pill">Morno</button>
        <button class="soft-pill">Frio</button>
      </div>
    `;
    side.appendChild(controls);
    return side;
  }

  function renderDashboardTable(deals) {
    const table = document.createElement("section");
    table.className = "panel dashboard-table";
    const head = document.createElement("div");
    head.className = "table-head";
    head.innerHTML = "<div>Empresa</div><div>Contato</div><div>Estágio</div><div>Temp.</div><div>Responsável</div>";
    table.appendChild(head);

    deals.slice(0, 4).forEach((deal) => {
      const row = document.createElement("div");
      row.className = "table-row";
      row.innerHTML = `
        <div class="company-cell">
          <div class="company-badge">${initials(deal.name)}</div>
          <div><strong>${displayText(deal.name)}</strong><div class="subtle">${displayText(deal.description).slice(0, 44)}...</div></div>
        </div>
        <div><div>-${deal.year}</div><div class="subtle">${displayText(deal.location)}</div></div>
        <div><span class="chip">${displayText(deal.status)}</span></div>
        <div><span class="chip">${displayText(deal.tags.find((tag) => ["Frio", "Morno", "Quente"].includes(tag)) || deal.status)}</span></div>
        <div>${displayText(deal.owner)}</div>
      `;
      table.appendChild(row);
    });
    return table;
  }

  function renderCRM() {
    const wrap = document.createElement("section");
    wrap.className = "content-grid ref-page workspace-soft-page";
    const data = workspaceData();

    wrap.innerHTML = `
      <section class="page-head">
        <div>
          <h3>Pipeline</h3>
          <p>Deals com visual premium, filtros dinâmicos e leitura mais limpa</p>
        </div>
        <div class="page-head-actions">
          <button class="ghost-button" data-ref-action="export-crm" type="button">Exportar deals</button>
          <button class="action-button" data-ref-action="new-opportunity" type="button">+ Oportunidade</button>
        </div>
      </section>
    `;

    const filters = document.createElement("section");
    filters.className = "panel";
    filters.innerHTML = `
      <div class="panel-header">
        <div>
          <h3>CRM premium</h3>
          <p>Deals com visual editorial, filtros dinâmicos e ações rápidas</p>
        </div>
        <div class="inline-actions"></div>
      </div>
      <div class="filters-row">
        <label class="field"><span>Status</span><select id="crmFilterStatus"><option value="">Todos</option>${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option>${stage}</option>`).join("")}</select></label>
        <label class="field"><span>Responsável</span><select id="crmFilterOwner"><option value="">Todos</option>${workspaceOwnerOptions(state.currentWorkspace).map((owner) => `<option value="${escapeAttr(owner)}">${displayText(owner)}</option>`).join("")}</select></label>
        <label class="field"><span>Tag</span><input id="crmFilterTag" placeholder="Ex: Investido"></label>
      </div>
    `;
    wrap.appendChild(filters);

    const cards = document.createElement("section");
    cards.className = "cards-grid";
    wrap.appendChild(cards);

    const drawCards = () => {
      const status = document.getElementById("crmFilterStatus").value;
      const owner = document.getElementById("crmFilterOwner").value;
      const tag = document.getElementById("crmFilterTag").value.trim().toLowerCase();
      cards.innerHTML = "";
      prioritizedRitoPipelineItems(data.crmItems)
        .filter((item) => !status || item.status === status)
        .filter((item) => !owner || item.owner === owner)
        .filter((item) => !tag || item.tags.some((itemTag) => itemTag.toLowerCase().includes(tag)))
        .forEach((item) => cards.appendChild(createCRMCard(item)));
    };

    drawCards();
    setTimeout(() => {
      document.getElementById("crmFilterStatus")?.addEventListener("change", drawCards);
      document.getElementById("crmFilterOwner")?.addEventListener("change", drawCards);
      document.getElementById("crmFilterTag")?.addEventListener("input", drawCards);
    }, 0);
    return wrap;
  }

  function createCRMCard(item) {
    ensureProjectShape(item);
    const article = document.createElement("article");
    article.className = "crm-card";
    article.draggable = true;
    article.dataset.crmId = item.id;
    const accent = coverPalette[item.status] || "#2864ff";
    const displayCover = projectMediaValue(item, "cover");
    const displayLogo = projectMediaValue(item, "logo");
    const companyDescription = displayText(item.description || item.businessModel || item.framework || "-");
    const statusSummary = dealStatusSummaryPreview(item, 150);
    const statusSummaryLabel = normalizeReferenceDashboardStage(item) === "Declinado" ? "Motivo do declínio" : "Resumo do status";
    const managementTeam = displayText(item.managementTeam || item.management || item.founders || "-");
    const fundraisingHistory = displayText(item.fundraisingHistory || "-");
    const vcBacked = displayText(item.vcPeBacked || "-");
    const locationLine = [item.sector, item.location, item.year].filter(Boolean).map((part) => displayText(part)).join(" - ");
    article.innerHTML = `
      <div class="card-cover" style="background-image:url('${displayCover}')">
        <div class="card-menu-shell">
          <button class="ghost-button cover-actions" data-card-menu-toggle="${item.id}" type="button" aria-label="Abrir menu do card">...</button>
          <div class="card-menu hidden" data-card-menu="${item.id}">
            <button class="ghost-button card-menu-button" data-card-action="edit" data-card-id="${item.id}" type="button">Editar</button>
            <button class="ghost-button card-menu-button" data-card-action="duplicate" data-card-id="${item.id}" type="button">Duplicar</button>
          </div>
        </div>
        <div class="status-badge">${displayText(isInvestedProjectRecord(item) ? "Investido" : item.status)}</div>
      </div>
      <div class="card-logo ${displayLogo ? "has-image" : ""}">${displayLogo ? `<img src="${displayLogo}" alt="${item.name}" loading="lazy" decoding="async">` : initials(item.name)}</div>
      <div class="card-content">
        <div class="card-copy-block">
          <h4>${displayText(item.name)}</h4>
          <div class="subtle">${locationLine || "-"}</div>
        </div>
        <div class="chips">${item.tags.map((tag) => `<span class="chip ${tagChipClass(tag)}">${displayText(tag)}</span>`).join("")}</div>
        <div class="card-info-stack">
          <div class="card-field card-description-preview">
            <span>Descrição da empresa</span>
            <p>${companyDescription}</p>
          </div>
          <div class="card-field card-description-preview card-status-summary">
            <span>${statusSummaryLabel}</span>
            <p>${statusSummary}</p>
          </div>
          <div class="card-meta-grid">
            <div class="card-field">
              <span>Histórico de captação</span>
              <p>${fundraisingHistory}</p>
            </div>
            <div class="card-field">
              <span>Time de gestão</span>
              <p>${managementTeam}</p>
            </div>
            <div class="card-field">
              <span>VC / PE backed</span>
              <p>${vcBacked}</p>
            </div>
          </div>
        </div>
        <div><strong>Framework:</strong> ${displayText(item.framework || "-")}</div>
        <div class="progress-bar"><span style="width:${item.progress}%; background:${accent}"></span></div>
        <div class="card-footer"><span>${displayText(item.owner)}</span><strong>${currency(item.estimatedValue)}</strong></div>
      </div>
    `;
    const menuToggle = article.querySelector("[data-card-menu-toggle]");
    const menu = article.querySelector("[data-card-menu]");
    menuToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll(".card-menu").forEach((node) => {
        if (node !== menu) node.classList.add("hidden");
      });
      menu?.classList.toggle("hidden");
    });
    article.addEventListener("mouseleave", () => {
      menu?.classList.add("hidden");
    });
    article.querySelectorAll("[data-card-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        menu?.classList.add("hidden");
        await handleCRMCardAction(button.dataset.cardAction, item.id);
      });
    });
    article.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
      article.classList.add("is-dragging");
      article.dataset.justDragged = "0";
    });
    article.addEventListener("dragend", () => {
      article.classList.remove("is-dragging");
      article.dataset.justDragged = "1";
      document.querySelectorAll(".crm-card").forEach((cardNode) => cardNode.classList.remove("is-drop-target"));
      setTimeout(() => {
        article.dataset.justDragged = "0";
      }, 60);
    });
    article.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".crm-card").forEach((cardNode) => {
        if (cardNode !== article) cardNode.classList.remove("is-drop-target");
      });
      article.classList.add("is-drop-target");
    });
    article.addEventListener("dragleave", () => {
      article.classList.remove("is-drop-target");
    });
    article.addEventListener("drop", (event) => {
      event.preventDefault();
      article.classList.remove("is-drop-target");
      void reorderCRMItems(event.dataTransfer.getData("text/plain"), item.id);
    });
    article.addEventListener("click", (event) => {
      if (article.dataset.justDragged === "1") return;
      if (event.target.closest("[data-card-action]") || event.target.closest("[data-card-menu-toggle]")) return;
      openProjectDetail(item.id, state.currentView[state.currentWorkspace]);
    });
    return article;
  }

  function renderInvestedProjects() {
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page";
    const items = investedProjects(workspaceData().crmItems);
    panel.innerHTML = `
      <section class="page-head">
        <div><h3>Projetos Investidos</h3><p>Entrada automatica via tag Investido no CRM</p></div>
      </section>
      <section class="panel">
        <div class="filters-row">
          <label class="field"><span>Setor</span><input id="investedSector" placeholder="Ex: Fitness"></label>
          <label class="field"><span>Responsável</span><input id="investedOwner" placeholder="Ex: Arthur"></label>
          <label class="field"><span>Ano</span><input id="investedYear" placeholder="2026"></label>
        </div>
      </section>
    `;
    const grid = document.createElement("section");
    grid.className = "cards-grid";
    panel.appendChild(grid);

    const draw = () => {
      const sector = document.getElementById("investedSector").value.toLowerCase();
      const owner = document.getElementById("investedOwner").value.toLowerCase();
      const year = document.getElementById("investedYear").value.toLowerCase();
      grid.innerHTML = "";
      items
        .filter((item) => !sector || item.sector.toLowerCase().includes(sector))
        .filter((item) => !owner || item.owner.toLowerCase().includes(owner))
        .filter((item) => !year || item.year.toLowerCase().includes(year))
        .forEach((item) => grid.appendChild(createCRMCard(item)));
    };

    setTimeout(() => {
      ["investedSector", "investedOwner", "investedYear"].forEach((id) => document.getElementById(id)?.addEventListener("input", draw));
      draw();
    }, 0);
    return panel;
  }

  function renderTasksBoard() {
    const data = workspaceData();
    const themes = workspaceTaskThemes(state.currentWorkspace);
    const themeColors = workspaceTaskThemeColors(state.currentWorkspace);
    const viewMode = referenceViewMode("tasks");
    const groupMode = taskListGroupMode();
    const kanbanSubtitles = {
      rito: "Gestão da empresa organizada por tema",
      atica: "Gestao interna organizada por tema",
      fast: "Operação da empresa organizada por tema"
    };
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page";

    panel.innerHTML = `
      <section class="page-head">
        <div>
          <h3>${tabTitle("tasks")}</h3>
          <p>${kanbanSubtitles[state.currentWorkspace] || "Gestao organizada por tema"}</p>
        </div>
        <div class="inline-actions">
          <div class="segmented">
            <button class="${viewMode === "cards" ? "is-active" : ""}" data-ref-action="cards-view" data-ref-view="tasks" type="button">Board</button>
            <button class="${viewMode === "list" ? "is-active" : ""}" data-ref-action="list-view" data-ref-view="tasks" type="button">Lista</button>
          </div>
          ${viewMode === "list" ? `
            <div class="segmented">
              <button class="${groupMode === "theme" ? "is-active" : ""}" data-ref-action="tasks-group-theme" type="button">Tema</button>
              <button class="${groupMode === "owner" ? "is-active" : ""}" data-ref-action="tasks-group-owner" type="button">Responsável</button>
            </div>
          ` : ""}
          <button class="ghost-button" data-ref-action="edit-columns" type="button">Alterar colunas</button>
          <button class="action-button" data-ref-action="new-task" type="button">+ Nova tarefa</button>
        </div>
      </section>
    `;

    const board = document.createElement("section");
    board.className = viewMode === "list"
      ? "kanban-list-view-shell"
      : "board-grid reference-board kanban-reference-board";
    panel.appendChild(board);

    const draw = () => {
      const owner = "";
      const priority = "";
      const tag = "";
      const filteredTasks = data.taskItems
        .filter((task) => !owner || task.owner.toLowerCase().includes(owner))
        .filter((task) => !priority || task.priority === priority)
        .filter((task) => !tag || task.tags.join(" ").toLowerCase().includes(tag));
      board.innerHTML = "";
      if (viewMode === "list" && groupMode === "owner") {
        buildTaskOwnerGroups(filteredTasks).forEach((group) => {
          const completedVisibility = workspaceKanbanCompletedVisibility();
          const showCompleted = Boolean(completedVisibility[group.visibilityKey]);
          board.appendChild(renderTaskListGroup({
            stage: group.label,
            accentColor: group.accentColor,
            visibleTasks: group.visibleTasks,
            completedTasks: group.completedTasks,
            showCompleted,
            visibilityKey: group.visibilityKey,
            grouping: "owner",
            addTaskStage: ""
          }));
        });
      return bindTaskListControls(draw);
      }
      themes.forEach((stage, index) => {
        const accentColor = themeColors[index] || DEFAULT_KANBAN_THEME_COLORS[index % DEFAULT_KANBAN_THEME_COLORS.length];
        const stageTasks = filteredTasks.filter((task) => task.stage === stage);
        const visibleTasks = stageTasks.filter((task) => !isCompletedTaskStatus(task.status));
        const completedTasks = stageTasks.filter((task) => isCompletedTaskStatus(task.status));
        const completedVisibility = workspaceKanbanCompletedVisibility();
        const showCompleted = Boolean(completedVisibility[stage]);
        if (viewMode === "list") {
          board.appendChild(renderTaskListGroup({
            stage,
            accentColor,
            visibleTasks,
            completedTasks,
            showCompleted,
            visibilityKey: stage,
            grouping: "theme",
            addTaskStage: stage
          }));
          return;
        }
        const column = document.createElement("article");
        column.className = "board-column reference-column";
        column.innerHTML = `
          <div class="column-header reference-column-head">
            <span class="reference-column-accent" style="background:${accentColor}"></span>
            <strong contenteditable="true" spellcheck="false" data-inline-column="task" data-column-index="${index}">${stage}</strong>
            <span class="column-count">${visibleTasks.length}</span>
            <button class="ghost-icon-button column-open" data-add-theme-task="${stage}" type="button">+</button>
          </div>
          <div class="kanban-list reference-column-list" data-dropzone="${stage}"></div>
          ${completedTasks.length ? `
            <div class="kanban-completed-section ${showCompleted ? "is-open" : ""}">
              <button class="kanban-completed-toggle" data-toggle-completed-stage="${escapeAttr(stage)}" type="button">
                <span>${showCompleted ? "Ocultar" : "Ver"} concluídas</span>
                <strong>${completedTasks.length}</strong>
              </button>
              <div class="kanban-completed-list ${showCompleted ? "" : "hidden"}" data-completed-list="${escapeAttr(stage)}"></div>
            </div>
          ` : ""}
        `;
        const list = column.querySelector(".kanban-list");
        visibleTasks.forEach((task) => list.appendChild(createTaskCard(task, false, "")));
        if (!visibleTasks.length) {
          const empty = document.createElement("div");
          empty.className = "kanban-column-empty";
          empty.textContent = completedTasks.length ? "Atividades concluídas ocultas no rodapé." : "Sem tarefas";
          list.appendChild(empty);
        }
        const completedList = column.querySelector(`[data-completed-list="${escapeAttr(stage)}"]`);
        if (completedList && showCompleted) {
          completedTasks.forEach((task) => completedList.appendChild(createTaskCard(task, false, "")));
        }
        board.appendChild(column);
      });
      board.querySelectorAll("[data-toggle-completed-stage]").forEach((button) => {
        button.onclick = () => {
          const stage = button.dataset.toggleCompletedStage;
          const visibility = workspaceKanbanCompletedVisibility();
          visibility[stage] = !visibility[stage];
          saveState();
          draw();
        };
      });
      if (viewMode === "list") return;
      attachDnD("[data-dropzone]", updateTaskStage);
      board.querySelectorAll("[data-add-theme-task]").forEach((button) => {
        button.onclick = () => openTaskDialog("", button.dataset.addThemeTask);
      });
    };

    setTimeout(draw, 0);
    return panel;
  }

  function bindTaskListControls(redraw) {
    document.querySelectorAll("[data-add-theme-task]").forEach((button) => {
      button.onclick = () => openTaskDialog("", button.dataset.addThemeTask);
    });
    document.querySelectorAll("[data-toggle-completed-stage]").forEach((button) => {
      button.onclick = () => {
        const stage = button.dataset.toggleCompletedStage;
        const visibility = workspaceKanbanCompletedVisibility();
        visibility[stage] = !visibility[stage];
        saveState();
        redraw();
      };
    });
  }

  function formatTaskDateLabel(value) {
    const normalized = normalizeDateInputValue(value);
    if (!normalized) return "-";
    const [year, month, day] = normalized.split("-").map(Number);
    if (!year || !month || !day) return displayText(normalized);
    return new Date(year, month - 1, day).toLocaleDateString("pt-BR");
  }

  function taskStatusDisplay(status = "") {
    const canonical = canonicalTaskStatus(status);
    if (canonical === "Pausado") return "Pausado";
    if (canonical === "Revisao") return "Revisão";
    if (canonical === "Concluido") return "Concluído";
    return canonical;
  }

  function taskPriorityClass(priority = "") {
    const value = String(priority || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (value === "alta") return "high";
    if (value === "baixa") return "low";
    return "mid";
  }

  function createTaskListRow(task, grouping = "theme") {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `kanban-list-row${isCompletedTaskStatus(task.status) ? " is-completed" : ""}`;
    row.dataset.taskId = task.id;
    const dueDate = normalizeDateInputValue(task.dueDate || "");
    const isLate = dueDate && !isCompletedTaskStatus(task.status) && dueDate < todayISO();
    const descriptionPreview = displayText(task.description || "").trim();
    const recurrence = canonicalTaskRecurrence(task.recurrence);
    const ownerMarkup = task.owner ? renderOwnerAvatar(task.owner, "kanban-list-avatar") : '<span class="kanban-list-avatar is-empty"></span>';
    const secondaryCell = grouping === "owner"
      ? `<div class="kanban-list-meta-text">${displayText(task.stage || "Sem tema")}</div>`
      : `<div class="kanban-list-assignee">
          ${ownerMarkup}
          <span>${displayText(task.owner || "Sem responsável")}</span>
        </div>`;
    row.innerHTML = `
      <div class="kanban-list-main">
        <div class="kanban-list-task">
          <span class="kanban-list-task-bullet priority-${taskPriorityClass(task.priority)}"></span>
          <div class="kanban-list-copy">
            <strong>${displayText(task.title)}</strong>
            ${recurrence !== "Nenhuma" ? `<span class="kanban-recurrence-label">${displayText(recurrence)}</span>` : ""}
            ${descriptionPreview ? `<p>${descriptionPreview}</p>` : ""}
          </div>
        </div>
      </div>
      ${secondaryCell}
      <div class="kanban-list-date${isLate ? " is-late" : ""}">${formatTaskDateLabel(task.dueDate)}</div>
      <div><span class="kanban-list-chip status-${canonicalTaskStatus(task.status).toLowerCase().replace(/\s+/g, "-")}">${taskStatusDisplay(task.status || "A Fazer")}</span></div>
      <div><span class="kanban-list-chip priority-${taskPriorityClass(task.priority)}">${displayText(task.priority || "Media")}</span></div>
    `;
    row.addEventListener("click", () => openTaskEditor(task.id, false, ""));
    return row;
  }

  function renderTaskListGroup({ stage, accentColor, visibleTasks, completedTasks, showCompleted, visibilityKey = stage, grouping = "theme", addTaskStage = stage }) {
    const group = document.createElement("section");
    group.className = "kanban-list-group panel";
    const activeSummary = taskStatusSummary(visibleTasks);
    const completedSummary = completedTasks.length ? ` • ${completedTasks.length} concluídas` : "";
    const secondColumnLabel = grouping === "owner" ? "Tema" : "Responsável";
    group.innerHTML = `
      <div class="kanban-list-group-head">
        <div class="kanban-list-group-title">
          <span class="reference-column-accent" style="background:${accentColor}"></span>
          <div>
            <strong>${displayText(stage)}</strong>
            <p>${visibleTasks.length} ativas • ${activeSummary["Em andamento"]} em andamento • ${activeSummary["A fazer"]} a fazer • ${activeSummary.Pausado} pausadas${completedSummary}</p>
          </div>
        </div>
        <button class="ghost-icon-button column-open" data-add-theme-task="${escapeAttr(addTaskStage)}" type="button">+</button>
      </div>
      <div class="kanban-list-table-head">
        <div>Tarefa</div>
        <div>${secondColumnLabel}</div>
        <div>Prazo</div>
        <div>Status</div>
        <div>Prioridade</div>
      </div>
      <div class="kanban-list-table" data-list-stage="${escapeAttr(visibilityKey)}"></div>
      ${completedTasks.length ? `
        <div class="kanban-completed-section ${showCompleted ? "is-open" : ""}">
          <button class="kanban-completed-toggle" data-toggle-completed-stage="${escapeAttr(visibilityKey)}" type="button">
            <span>${showCompleted ? "Ocultar" : "Ver"} concluídas</span>
            <strong>${completedTasks.length}</strong>
          </button>
          <div class="kanban-completed-list ${showCompleted ? "" : "hidden"}" data-completed-list="${escapeAttr(visibilityKey)}"></div>
        </div>
      ` : ""}
    `;
    const table = group.querySelector(`[data-list-stage="${escapeAttr(visibilityKey)}"]`);
    if (!visibleTasks.length) {
      const empty = document.createElement("div");
      empty.className = "kanban-list-empty";
      empty.textContent = completedTasks.length ? "Nenhuma tarefa ativa nesta frente." : "Sem tarefas nesta frente.";
      table.appendChild(empty);
    } else {
      visibleTasks.forEach((task) => table.appendChild(createTaskListRow(task, grouping)));
    }
    const completedList = group.querySelector(`[data-completed-list="${escapeAttr(visibilityKey)}"]`);
    if (completedList && showCompleted) {
      completedTasks.forEach((task) => completedList.appendChild(createTaskListRow(task, grouping)));
    }
    group.querySelector("[data-add-theme-task]")?.addEventListener("click", () => openTaskDialog("", addTaskStage));
    return group;
  }

  function buildTaskOwnerGroups(tasks = []) {
    const owners = workspaceOwnerOptions(state.currentWorkspace);
    const grouped = new Map();
    owners.forEach((owner, index) => {
      grouped.set(owner, {
        label: owner,
        visibilityKey: `owner:${owner}`,
        accentColor: DEFAULT_KANBAN_THEME_COLORS[index % DEFAULT_KANBAN_THEME_COLORS.length],
        visibleTasks: [],
        completedTasks: [],
        order: index
      });
    });
    (tasks || []).forEach((task) => {
      const owner = String(task.owner || "").trim() || "Sem responsável";
      if (!grouped.has(owner)) {
        grouped.set(owner, {
          label: owner,
          visibilityKey: `owner:${owner}`,
          accentColor: DEFAULT_KANBAN_THEME_COLORS[grouped.size % DEFAULT_KANBAN_THEME_COLORS.length],
          visibleTasks: [],
          completedTasks: [],
          order: grouped.size
        });
      }
      const bucket = grouped.get(owner);
      if (isCompletedTaskStatus(task.status)) bucket.completedTasks.push(task);
      else bucket.visibleTasks.push(task);
    });
    return [...grouped.values()]
      .filter((group) => group.visibleTasks.length || group.completedTasks.length)
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "pt-BR"));
  }

  function createTaskCard(task, projectScoped, projectName = "") {
    const article = document.createElement("article");
    article.className = "kanban-card reference-task-card";
    article.draggable = true;
    article.dataset.taskId = task.id;
    const isLate = task.dueDate < todayISO();
    const priorityClass = task.priority === "Alta" ? "high" : task.priority === "Baixa" ? "low" : "mid";
    const recurrence = canonicalTaskRecurrence(task.recurrence);
    const ownerMarkup = task.owner ? renderOwnerAvatar(task.owner, "task-card-assignee") : '<span class="task-card-assignee is-empty"></span>';
    article.innerHTML = `
      <strong>${displayText(task.title)}</strong>
      ${task.description ? `<p class="kanban-card-description">${displayText(task.description)}</p>` : ""}
      <div class="mini-chip-row">
        <span class="soft-pill kanban-status-pill">${displayText(task.status || "A Fazer")}</span>
        ${recurrence !== "Nenhuma" ? `<span class="soft-pill kanban-recurrence-pill">${displayText(recurrence)}</span>` : ""}
      </div>
      <div class="task-card-footer">
        <div class="task-meta"><span class="task-dot ${priorityClass}"></span>${displayText(task.priority || "Media")}</div>
        ${ownerMarkup}
      </div>
      ${task.dueDate ? `<div class="task-card-due${isLate ? " is-late" : ""}">Prazo: ${task.dueDate}</div>` : ""}
      ${task.completionDate ? `<div class="task-card-completion">Conclusão: ${task.completionDate}</div>` : ""}
    `;
    article.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task.id);
      article.classList.add("is-dragging");
    });
    article.addEventListener("dragend", () => {
      article.classList.remove("is-dragging");
      document.querySelectorAll(".kanban-list").forEach((list) => list.classList.remove("is-drop-target"));
    });
    article.addEventListener("dragover", (event) => {
      const zone = article.closest("[data-dropzone]");
      if (!zone || projectScoped) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".kanban-list").forEach((list) => {
        if (list !== zone) list.classList.remove("is-drop-target");
      });
      zone.classList.add("is-drop-target");
    });
    article.addEventListener("drop", (event) => {
      const zone = article.closest("[data-dropzone]");
      if (!zone || projectScoped) return;
      event.preventDefault();
      zone.classList.remove("is-drop-target");
      updateTaskStage(event.dataTransfer.getData("text/plain"), zone.dataset.dropzone);
    });
    article.addEventListener("click", (event) => {
      if (event.target.closest("button,a,input,select,textarea")) return;
      openTaskEditor(task.id, projectScoped, projectName);
    });
    return article;
  }

  async function updateTaskStage(id, stage) {
    const items = workspaceData().taskItems;
    const task = items.find((item) => item.id === id);
    if (!task) return;
    const rollbackState = clonePortalState(state);
    task.stage = stage;
    task.status = task.dueDate < todayISO() ? "Atrasado" : "Em andamento";
    touchKanbanTask(task);
    renderAppPreservingScroll();
    await persistKanbanStateOptimistically({
      rollbackState,
      rollbackMessage: "Nao foi possível mover a tarefa. O Kanban voltou para o último estado salvo."
    });
  }

  function renderProjectBoards() {
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page";
    const data = workspaceData();
    const projects = activeProjectBoardEntries(data);
    panel.innerHTML = `
      <section class="page-head">
        <div><h3>${tabTitle("projectBoards")}</h3></div>
        <div class="page-head-actions">
          <button class="ghost-button" data-ref-action="open-invested" type="button">Abrir Projetos Investidos</button>
        </div>
      </section>
    `;
    if (projects.length) {
      const board = document.createElement("section");
      board.className = "reference-board project-columns-board";
      projects.forEach(([projectName, cards, projectItem], index) => {
        const column = document.createElement("article");
        column.className = "reference-project-column project-board-column";
        column.innerHTML = `
          <div class="reference-column-head project-column-head">
            <span class="reference-column-accent accent-${index % 6}"></span>
            <strong>${projectName}</strong>
            <span class="column-count">${cards.length}</span>
            <button class="ghost-icon-button column-open project-column-open" data-open-project-board="${projectItem?.id || ""}" type="button" aria-label="Abrir projeto">↗</button>
          </div>
          <div class="reference-column-list project-column-list"></div>
        `;
        const list = column.querySelector(".project-column-list");
        if (!cards.length) {
          const empty = document.createElement("div");
          empty.className = "empty-project";
          empty.textContent = "Sem tarefas";
          list.appendChild(empty);
        } else {
          cards.forEach((item) => list.appendChild(createTaskCard(item, true, projectName)));
        }
        board.appendChild(column);
      });
      panel.appendChild(board);
    }

    setTimeout(() => {
      document.querySelectorAll("[data-open-project-board]").forEach((button) => {
        button.addEventListener("click", () => {
          const projectId = button.dataset.openProjectBoard;
          if (!projectId) return;
          openProjectDetail(projectId, "projectBoards");
        });
      });
    }, 0);

    if (!projects.length) {
      const empty = document.createElement("section");
      empty.className = "panel";
      empty.innerHTML = "<h3>Nenhum projeto investido com board proprio ainda</h3><p class='subtle'>Adicione a tag Investido a um deal para criar o Kanban por projeto.</p>";
      panel.appendChild(empty);
    }
    return panel;
  }

  function attachProjectDnD() {
    document.querySelectorAll("[data-project-dropzone]").forEach((zone) => {
      zone.addEventListener("dragover", (event) => event.preventDefault());
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        const dragId = event.dataTransfer.getData("text/plain");
        const projectName = zone.dataset.projectDropzone;
        const task = workspaceData().projectBoards[projectName].find((item) => item.id === dragId);
        if (!task) return;
        const rollbackState = clonePortalState(state);
        task.stage = zone.dataset.stage;
        task.status = task.dueDate < todayISO() ? "Atrasado" : "Em andamento";
        touchKanbanTask(task);
        renderAppPreservingScroll(dragId);
        await persistKanbanStateOptimistically({
          rollbackState,
          rollbackMessage: "Nao foi possível mover a tarefa do projeto. O último estado salvo foi restaurado."
        });
      });
    });
  }

  function renderDocuments() {
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page";
    const data = workspaceData();
    panel.innerHTML = `
      <section class="page-head">
        <div><h3>Documentos</h3><p>Biblioteca de arquivos com visual mais clean e consistente</p></div>
        <div class="page-head-actions"><button class="action-button" id="uploadDocumentButton">Upload de arquivo</button></div>
      </section>
    `;
    const top = document.createElement("section");
    top.className = "panel";
    top.innerHTML = `<div class="panel-header"><div><h3>Organização documental</h3><p>Upload, download, preview rápido e categorização por área</p></div></div>`;
    panel.appendChild(top);

    const grid = document.createElement("section");
    grid.className = "docs-grid";
    data.documents.forEach((doc) => {
      const item = document.createElement("article");
      item.className = "document-item";
      item.innerHTML = `
        <strong>${doc.name}</strong>
        <div class="chips"><span class="chip">${doc.category}</span><span class="chip">${doc.linkedTo || "Workspace"}</span></div>
        <div class="document-meta"><span>${doc.uploadedAt}</span><span>${doc.fileType.split("/").pop().toUpperCase()}</span></div>
        <div class="inline-actions">${resolveDocumentUrl(doc) ? `<a class="ghost-button" href="${escapeAttr(resolveDocumentUrl(doc))}" target="_blank" rel="noreferrer">Abrir</a>` : `<button class="ghost-button" disabled>Sem arquivo</button>`}</div>
      `;
      grid.appendChild(item);
    });
    panel.appendChild(grid);
    setTimeout(() => document.getElementById("uploadDocumentButton")?.addEventListener("click", openDocumentDialog), 0);
    return panel;
  }

  function renderMembers() {
    const panel = document.createElement("section");
    const members = sharedMembersData();
    panel.className = "content-grid ref-page workspace-soft-page members-page";
    panel.innerHTML = `
      <section class="page-head">
        <div><h3>Membros</h3><p>${members.length} membros cadastrados</p></div>
        <div class="page-head-actions"><button class="action-button" data-ref-action="new-member" type="button">+ Membro</button></div>
      </section>
    `;
    const grid = document.createElement("section");
    grid.className = "reference-member-list members-reference-list";
    members.forEach((member) => {
      const view = memberCardData(member);
      const card = document.createElement("article");
      card.className = "reference-member-card members-reference-card";
      card.innerHTML = `
        <div class="member-main">
          <div class="member-avatar" style="background:${view.color}">${view.photo ? `<img src="${view.photo}" alt="${escapeAttr(view.name)}" loading="lazy" decoding="async">` : view.initials}</div>
          <div class="member-copy">
            <strong>${view.name}</strong>
            <div class="subtle">${view.info}</div>
            <div class="chips member-tag-row">
              ${view.tags.map((tag, index) => `<span class="chip${index === 0 ? " primary-chip" : ""}">${tag}</span>`).join("")}
            </div>
          </div>
        </div>
        <div class="member-actions">
          <button class="ghost-button member-edit-button" data-ref-action="edit-member" data-member="${escapeAttr(view.name)}" type="button">Editar</button>
          <button class="ghost-button member-delete-button" data-ref-action="delete-member" data-member="${escapeAttr(view.name)}" type="button" aria-label="Excluir membro">X</button>
        </div>
      `;
      grid.appendChild(card);
    });
    panel.appendChild(grid);
    return panel;
  }

  function openMemberDialog(memberName = "") {
    const dialog = document.getElementById("entityDialog");
    const currentMember = sharedMembersData().find((member) => member.name === memberName);
    const accessProfiles = ["Admin", "Gestor", "Usuario"];
    const workspaceChoices = orderedWorkspaceIds().map((workspaceId) => ({
      label: workspaceConfig[workspaceId]?.name || workspaceId,
      value: workspaceDisplayName(workspaceId)
    }));
    const current = currentMember ? { ...currentMember } : {
      name: "",
      role: "",
      email: "",
      tags: [workspaceChoices.find((workspace) => workspace.label === workspaceDisplayName(state.currentWorkspace))?.value || "Rito"],
      color: memberColor(""),
      photo: ""
    };
    const currentTags = Array.isArray(current.tags) ? current.tags : [];
    const selectedProfile = currentTags.find((tag) => accessProfiles.includes(tag)) || "Usuario";
    const selectedWorkspaces = currentTags.filter((tag) => workspaceChoices.some((workspace) => workspace.value === tag));
    const memberPreviewInitials = initials(current.name || "M");
    const memberPreviewPhoto = current.photo || "";
    dialog.dataset.dialogSize = "wide";
    dialog.className = "panel entity-dialog member-dialog";
    dialog.classList.remove("hidden");
    dialog.innerHTML = `
        <form method="dialog" id="memberForm" class="crm-dialog-form member-dialog-form">
          <div class="dialog-header-split">
            <div class="dialog-header-copy">
              <h3>${currentMember ? "Editar Membro" : "Novo Membro"}</h3>
            </div>
            <button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">X</button>
          </div>
        <div class="dialog-grid crm-dialog-grid member-dialog-grid">
          <label class="field"><span>Nome</span><input name="name" value="${escapeAttr(current.name)}"></label>
          <label class="field"><span>E-mail</span><input name="email" type="email" value="${escapeAttr(current.email || "")}"></label>
          <label class="field"><span>Cargo</span><input name="role" value="${escapeAttr(current.role || "")}"></label>
          <label class="field"><span>Perfil de acesso</span><select name="accessProfile">${accessProfiles.map((profile) => `<option value="${profile}" ${selectedProfile === profile ? "selected" : ""}>${profile}</option>`).join("")}</select></label>
          <div class="field full-span member-photo-field">
            <span>Foto do perfil</span>
            <div class="member-photo-upload">
              <div class="member-photo-preview" id="memberPhotoPreview" aria-hidden="true">
                ${memberPreviewPhoto ? `<img src="${memberPreviewPhoto}" alt="${escapeAttr(current.name || "Membro")}" loading="lazy" decoding="async">` : `<strong>${memberPreviewInitials || "M"}</strong>`}
              </div>
              <label class="member-photo-picker">
                <input name="photo" type="file" accept="image/*">
                <span>Escolher imagem</span>
              </label>
              <div class="member-photo-copy">
                <strong id="memberPhotoStatus">${memberPreviewPhoto ? "Foto atual carregada" : "Adicionar foto"}</strong>
                <small>PNG ou JPG para o avatar do membro. Você também pode usar <strong>Ctrl+V</strong>.</small>
              </div>
            </div>
            <button class="paste-dropzone member-photo-paste" id="memberPhotoPasteDropzone" type="button">Ctrl+V para colar a foto</button>
          </div>
          <fieldset class="field full-span member-workspaces-fieldset">
            <span>Workspaces</span>
            <div class="member-workspaces-options">
              ${workspaceChoices.map((workspace) => `
                <label class="member-workspace-option">
                  <input type="checkbox" name="memberWorkspace" value="${workspace.value}" ${selectedWorkspaces.includes(workspace.value) ? "checked" : ""}>
                  <span class="member-workspace-card">
                    <strong>${workspace.label}</strong>
                    <small>Acesso liberado</small>
                  </span>
                </label>
              `).join("")}
            </div>
          </fieldset>
        </div>
        <div class="dialog-actions member-dialog-actions">
          <button class="ghost-button" type="button" data-dialog-close>Cancelar</button>
          <button class="action-button" value="default">Salvar</button>
        </div>
      </form>
    `;
    dialog.showModal();
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        dialog.close();
        dialog.classList.add("hidden");
      };
    });
    const form = document.getElementById("memberForm");
    const nameInput = form.querySelector("input[name='name']");
    const photoInput = form.querySelector("input[name='photo']");
    const photoPreview = document.getElementById("memberPhotoPreview");
    const photoStatus = document.getElementById("memberPhotoStatus");
    const pasteDropzone = document.getElementById("memberPhotoPasteDropzone");
    const defaultPasteText = "Ctrl+V para colar a foto";
    let pendingPhotoValue = current.photo || "";
    let photoUpdatePromise = Promise.resolve();

    const renderMemberPhotoPreview = () => {
      const previewName = String(nameInput?.value || current.name || "Membro").trim() || "Membro";
      const previewInitials = initials(previewName || "M");
      photoPreview.innerHTML = pendingPhotoValue
        ? `<img src="${pendingPhotoValue}" alt="${escapeAttr(previewName)}" loading="lazy" decoding="async">`
        : `<strong>${previewInitials || "M"}</strong>`;
      photoStatus.textContent = pendingPhotoValue ? "Foto pronta para salvar" : "Adicionar foto";
    };

    const setPhotoLoadingState = (loading, label = "") => {
      if (pasteDropzone) {
        pasteDropzone.disabled = loading;
        pasteDropzone.textContent = loading ? (label || "Aplicando foto...") : defaultPasteText;
      }
      if (photoInput) photoInput.disabled = loading;
      if (photoStatus && loading && label) photoStatus.textContent = label;
    };

    const applyMemberPhotoFile = async (file) => {
      if (!file) return pendingPhotoValue;
      setPhotoLoadingState(true, "Aplicando foto...");
      try {
        pendingPhotoValue = await imageFileToMemberPhotoURL(file, pendingPhotoValue || current.photo || "");
        renderMemberPhotoPreview();
        return pendingPhotoValue;
      } finally {
        setPhotoLoadingState(false);
      }
    };

    const queueMemberPhotoUpdate = (file) => {
      photoUpdatePromise = photoUpdatePromise
        .catch(() => null)
        .then(() => applyMemberPhotoFile(file));
      return photoUpdatePromise;
    };

    const handleMemberPhotoPaste = async (event) => {
      const file = clipboardImageFromPasteEvent(event);
      if (!file) return;
      event.preventDefault();
      try {
        await queueMemberPhotoUpdate(file);
      } catch (error) {
        alert(error?.message || "Não foi possível colar a foto agora.");
      }
    };

    nameInput?.addEventListener("input", () => {
      if (!pendingPhotoValue) renderMemberPhotoPreview();
    });

    photoInput?.addEventListener("change", async () => {
      const selectedFile = photoInput.files?.[0];
      if (!selectedFile) return;
      try {
        await queueMemberPhotoUpdate(selectedFile);
        photoInput.value = "";
      } catch (error) {
        photoInput.value = "";
        alert(error?.message || "Não foi possível carregar a foto selecionada.");
      }
    });

    pasteDropzone?.addEventListener("click", () => {
      pasteDropzone.focus();
    });
    pasteDropzone?.addEventListener("paste", handleMemberPhotoPaste);
    form.addEventListener("paste", handleMemberPhotoPaste);
    renderMemberPhotoPreview();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await photoUpdatePromise.catch(() => null);
      const formData = new FormData(form);
      const workspaceTags = form.querySelectorAll("input[name='memberWorkspace']:checked");
      const selectedWorkspaceTags = Array.from(workspaceTags).map((input) => input.value);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        role: String(formData.get("role") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        tags: [
          String(formData.get("accessProfile") || "Usuario").trim(),
          ...selectedWorkspaceTags
        ].filter(Boolean),
        color: current.color || memberColor(String(formData.get("name") || "")),
        photo: pendingPhotoValue || current.photo || ""
      };
      if (!payload.name) return;
      if (currentMember) {
        Object.assign(currentMember, payload);
      } else {
        sharedMembersData().push(payload);
      }
      syncWorkspaceMemberOptions();
      saveState();
      dialog.close();
      dialog.classList.add("hidden");
      renderApp();
    });
  }

  function renderCalendar() {
    const panel = document.createElement("section");
    panel.className = "content-grid ref-page workspace-soft-page";
    panel.innerHTML = `
      <section class="page-head">
        <div><h3>Calendário</h3><p>Visão mensal das tarefas com destaque para prazos</p></div>
      </section>
    `;
    const top = document.createElement("section");
    top.className = "panel";
    const [yearText, monthText] = calendarCursorValue().split("-");
    const year = Number(yearText);
    const month = Number(monthText) - 1;
    const monthDate = new Date(year, month, 1);
    const monthLabel = monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    top.innerHTML = `
      <div class="panel-header calendar-panel-head">
        <div>
          <h3>Calendário mensal</h3>
          <p>Tarefas integradas com destaque visual para itens atrasados</p>
        </div>
        <div class="calendar-toolbar">
          <button class="ghost-button" type="button" data-calendar-nav="-1">Anterior</button>
          <strong>${monthLabel}</strong>
          <button class="ghost-button" type="button" data-calendar-nav="1">Próximo</button>
          <button class="ghost-button" type="button" data-calendar-today>Hoje</button>
        </div>
      </div>
    `;
    panel.appendChild(top);
    const grid = document.createElement("section");
    grid.className = "calendar-grid";
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const weekdayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
    const tasksByDate = new Map();
    calendarTaskEntries().forEach((task) => {
      const date = normalizeDateInputValue(task.dueDate);
      if (!tasksByDate.has(date)) tasksByDate.set(date, []);
      tasksByDate.get(date).push(task);
    });

    for (let i = 0; i < firstWeekday; i += 1) {
      const empty = document.createElement("article");
      empty.className = "calendar-day calendar-day-empty";
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = document.createElement("article");
      const isToday = date === todayISO();
      cell.className = `calendar-day${isToday ? " is-today" : ""}`;
      cell.innerHTML = `<header><strong>${day}</strong><span class="subtle">${weekdayLabels[new Date(year, month, day).getDay()]}</span></header>`;
      const dayTasks = tasksByDate.get(date) || [];
      if (!dayTasks.length) {
        const emptyState = document.createElement("div");
        emptyState.className = "calendar-day-empty-copy";
        emptyState.textContent = "Sem tarefas";
        cell.appendChild(emptyState);
      } else {
        dayTasks
          .sort((a, b) => String(a.priority || "").localeCompare(String(b.priority || "")) || String(a.title || "").localeCompare(String(b.title || "")))
          .forEach((task) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = `day-task ${normalizeDateInputValue(task.dueDate) < todayISO() ? "late" : ""}`;
            item.innerHTML = `
              <strong>${displayText(task.title)}</strong>
              <span>${displayText(task.owner || "Sem responsável")}${task.projectName ? ` • ${displayText(task.projectName)}` : ""}</span>
            `;
            item.addEventListener("click", () => openTaskEditor(task.id, task.isProjectTask, task.projectName || ""));
            cell.appendChild(item);
          });
      }
      grid.appendChild(cell);
    }
    top.querySelectorAll("[data-calendar-nav]").forEach((button) => {
      button.addEventListener("click", () => shiftCalendarCursor(Number(button.dataset.calendarNav || 0)));
    });
    top.querySelector("[data-calendar-today]")?.addEventListener("click", () => resetCalendarCursor());
    panel.appendChild(grid);
    return panel;
  }

  function renderGlobalSearchResults() {
    const term = document.getElementById("globalSearch").value.trim().toLowerCase();
    const box = document.getElementById("globalResults");
    if (!term) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const data = workspaceData();
    const results = [];
    (data.crmItems || []).forEach((item) => {
      if ([item.name, item.description, item.owner, item.sector, item.location, item.tags.join(" ")].join(" ").toLowerCase().includes(term)) {
        results.push({ type: "Deal", title: item.name, detail: `${item.status} - ${item.owner}` });
      }
    });
    (data.taskItems || []).forEach((item) => {
      if ([item.title, item.owner, item.tags.join(" ")].join(" ").toLowerCase().includes(term)) {
        results.push({ type: "Tarefa", title: item.title, detail: `${item.stage} - ${item.owner}` });
      }
    });
    (data.documents || []).forEach((item) => {
      if ([item.name, item.category, item.linkedTo || ""].join(" ").toLowerCase().includes(term)) {
        results.push({ type: "Documento", title: item.name, detail: `${item.category} - ${item.linkedTo || "Workspace"}` });
      }
    });
    box.classList.remove("hidden");
    box.innerHTML = `<strong>Resultados</strong>${results.map((result) => `<div class="result-item"><div><strong>${result.title}</strong><div class="subtle">${result.type}</div></div><span>${result.detail}</span></div>`).join("") || "<p class='subtle'>Nenhum resultado encontrado.</p>"}`;
  }

  function bindStaticActions() {
    const landing = isLandingScreen();
    document.getElementById("workspaceTrigger").onclick = () => {
      document.getElementById("workspaceDropdown").classList.toggle("hidden");
    };
    document.getElementById("workspaceHomeButton").onclick = () => navigateToWorkspaceLanding();
    document.getElementById("themeToggle").onclick = () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      saveState();
      renderApp();
    };
    const themeAccentButton = document.getElementById("themeAccentButton");
    if (themeAccentButton) {
      themeAccentButton.textContent = state.theme === "dark" ? "Dark" : "Light";
      themeAccentButton.onclick = () => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        saveState();
        renderApp();
      };
    }
    document.getElementById("globalSearch").oninput = renderGlobalSearchResults;
    document.querySelectorAll("[data-landing-theme]").forEach((button) => {
      button.onclick = () => {
        const nextTheme = button.dataset.landingTheme || "dark";
        if (state.theme === nextTheme) return;
        state.theme = nextTheme;
        saveState();
        renderApp();
      };
    });
    document.getElementById("newItemButton").onclick = () => {
      const view = state.currentView[state.currentWorkspace];
      if (view === "crm") openOpportunityDialog();
      else if (view === "documents") openDocumentDialog();
      else openTaskDialog();
    };
    const hideTopSearch = landing || state.currentWorkspace === "rito";
    document.querySelector(".top-search")?.classList.toggle("hidden", hideTopSearch);
    document.getElementById("newItemButton")?.classList.toggle("hidden", landing || state.currentWorkspace === "rito");
    document.querySelectorAll("[data-action='export-crm']").forEach((button) => { button.onclick = () => downloadDealsExcel(state.currentWorkspace); });
    document.querySelectorAll("[data-action='export-tasks']").forEach((button) => { button.onclick = () => alert("Exportações locais foram desativadas."); });
    bindInlineEditing();
    bindReferenceActions();
    bindRitoRitesActions();
    if (!window.__workspaceDropdownBound) {
      document.addEventListener("click", handleOutsideWorkspaceDropdown);
      window.__workspaceDropdownBound = true;
    }
  }

  function bindRitoRitesActions() {
    const root = document.getElementById("appContent");
    if (!root) return;
    root.querySelectorAll("[data-rites-section]").forEach((button) => {
      button.onclick = () => {
        activeRitesSection = button.dataset.ritesSection || "overview";
        renderApp();
      };
    });
    root.querySelectorAll("[data-rites-category]").forEach((button) => {
      button.onclick = () => {
        activeRitesCategory = button.dataset.ritesCategory || "all";
        const focused = ritoFocusItem();
        activeRitesFocusId = focused?.id || "";
        renderApp();
      };
    });
    root.querySelectorAll("[data-rites-focus]").forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.ritesFocus || "";
        if (!id) return;
        activeRitesFocusId = id;
        renderApp();
      };
    });
    root.querySelectorAll("[data-rites-nav]").forEach((button) => {
      button.onclick = () => {
        activeRitesSection = button.dataset.ritesNav || "overview";
        renderApp();
      };
    });
    root.querySelectorAll("[data-rites-input='query']").forEach((input) => {
      input.oninput = () => {
        activeRitesQuery = input.value || "";
        const focused = ritoFocusItem();
        activeRitesFocusId = focused?.id || "";
        renderApp();
      };
    });
    root.querySelectorAll("[data-rites-action='upload-model']").forEach((button) => {
      button.onclick = () => openDocumentDialog("Rituais");
    });
    root.querySelectorAll("[data-rites-action='open-documents']").forEach((button) => {
      button.onclick = () => {
        flushOpenEditors();
        state.currentView[state.currentWorkspace] = "documents";
        saveState();
        renderApp();
      };
    });
  }

  function bindReferenceActions() {
    const root = document.getElementById("appContent");
    if (!root) return;
    root.querySelectorAll("[data-ref-action]").forEach((button) => {
      button.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.refAction;
        if (action === "new-opportunity" || action === "new-project") return openOpportunityDialog();
        if (action === "new-task") return openTaskDialog();
        if (action === "upload-doc") return openDocumentDialog();
        if (action === "download-doc") return alert(`Download preparado para ${button.dataset.docTitle}.`);
        if (action === "edit-doc") return alert(`Edicao de ${button.dataset.docTitle} pode ser ligada ao drawer em seguida.`);
        if (action === "delete-doc") {
          const docId = String(button.dataset.docId || "").trim();
          const docTitle = button.dataset.docTitle || "este documento";
          const documentItem = workspaceData().documents.find((doc) => doc.id === docId);
          if (!documentItem) {
            alert(`Nao encontrei ${docTitle} na biblioteca atual.`);
            return;
          }
          if (!confirm(`Deseja excluir ${docTitle}?`)) return;
          if (documentItem.filePath) {
            await removeFileFromStorage(PORTAL_DOCUMENTS_BUCKET, documentItem.filePath);
          }
          state.workspaces[state.currentWorkspace].documents = workspaceData().documents.filter((doc) => doc.id !== docId);
          saveState();
          return renderApp();
        }
        if (action === "new-member") return openMemberDialog();
        if (action === "edit-member") return openMemberDialog(button.dataset.member);
        if (action === "delete-member") {
          state.sharedMembers = sharedMembersData().filter((member) => member.name !== button.dataset.member);
          syncWorkspaceMemberOptions();
          saveState();
          return renderApp();
        }
        if (action === "open-invested") {
          flushOpenEditors();
          state.currentView[state.currentWorkspace] = "invested";
          saveState();
          return renderApp();
        }
        if (action === "set-dark") {
          state.theme = "dark";
          saveState();
          return renderApp();
        }
        if (action === "set-light") {
          state.theme = "light";
          saveState();
          return renderApp();
        }
        if (action === "workspace-link") {
          const url = `${location.origin}${location.pathname}?workspace=${button.dataset.workspace}`;
          try {
            await navigator.clipboard.writeText(url);
            alert("Link copiado.");
          } catch {
            alert(url);
          }
          return;
        }
        if (action === "workspace-edit" || action === "workspace-duplicate" || action === "new-workspace") {
          return alert("Acao preparada para a proxima iteracao.");
        }
        if (action === "export-crm") {
          downloadDealsExcel(state.currentWorkspace);
          return;
        }
        if (["connect-source", "save-html", "export-json", "export-tasks", "export-portfolio"].includes(action)) {
          alert("Importações e exportações locais foram desativadas. O portal agora depende do Supabase para persistência.");
          return;
        }
        if (action === "cards-view" || action === "list-view") {
          const targetView = button.dataset.refView || state.currentView[state.currentWorkspace];
          state.referenceViewModes[state.currentWorkspace] ||= {};
          state.referenceViewModes[state.currentWorkspace][targetView] = action === "cards-view" ? "cards" : "list";
          saveState();
          return renderApp();
        }
        if (action === "tasks-group-theme" || action === "tasks-group-owner") {
          state.taskListGroupModes ||= {};
          state.taskListGroupModes[state.currentWorkspace] = action === "tasks-group-owner" ? "owner" : "theme";
          saveState();
          return renderApp();
        }
        if (action === "edit-columns") return openTaskThemesDialog();
      };
    });
  }

  function handleOutsideWorkspaceDropdown(event) {
    const switcher = document.querySelector(".workspace-switcher");
    if (!switcher || switcher.contains(event.target)) return;
    document.getElementById("workspaceDropdown")?.classList.add("hidden");
  }

  function buildDuplicatedCRMItem(item) {
    const timestamp = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(item || {}));
    copy.id = uid("deal");
    copy.name = `${item.name} Copy`;
    copy.createdAt = timestamp;
    copy.updatedAt = timestamp;
    copy.history = [];
    copy.referenceKey = "";
    copy.dealHistory = item.dealHistory || item.statusSummary || "";
    copy.status = "Pipeline";
    copy.temperature = temperatureFromRitoDealStatus(copy.status);
    copy.progress = progressFromRitoDealStatus(copy.status);
    copy.closeDate = "";
    copy.archived = false;
    delete copy.__draftDirty;
    ensureProjectShape(copy);
    copy.history = [{ at: new Date().toLocaleString("pt-BR"), text: `Card duplicado de ${item.name}` }];
    return copy;
  }

  async function duplicateCRMItem(item, sourceView = state.currentView[state.currentWorkspace]) {
    if (!item) return;
    const copy = buildDuplicatedCRMItem(item);
    await upsertCRMItem(copy);
    openProjectDetail(copy.id, sourceView);
  }

  async function handleCRMCardAction(action, id) {
    const item = workspaceData().crmItems.find((entry) => entry.id === id);
    if (!item) return;
    if (action === "edit") openProjectDetail(item.id, state.currentView[state.currentWorkspace]);
    if (action === "duplicate") {
      await duplicateCRMItem(item, state.currentView[state.currentWorkspace]);
    }
  }

  function openCRMDialog(item) {
    const dialog = document.getElementById("entityDialog");
    dialog.dataset.dialogSize = "wide";
    dialog.classList.remove("hidden");
    const current = item || {
      id: uid("deal"),
      name: "",
      logo: "",
      cover: defaultCover("Novo", "#16222a", "#3a6073"),
      description: "",
      sector: "",
      location: "",
      year: new Date().getFullYear().toString(),
      status: "Pipeline",
      tags: [],
      owner: workspaceOwnerOptions(state.currentWorkspace)[0] || "Arthur Bueno",
      estimatedValue: 0,
      framework: "",
      progress: 20,
      website: "",
      temperature: "Morno",
      investmentAmount: 0,
      mainContact: "",
      phone: "",
      email: "",
      closeDate: "",
      managementTeam: "",
      businessModel: "",
      competitors: "",
      advantages: ""
    };
    dialog.innerHTML = `
      <form method="dialog" id="crmForm" class="crm-dialog-form">
        <div class="panel-header dialog-header"><div><h3>${item ? "Editar deal" : "Novo deal"}</h3><p>Persistência imediata em nuvem via Supabase para o CRM.</p></div><button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">X</button></div>
        <div class="dialog-grid crm-dialog-grid">
          <label class="field"><span>Nome do projeto</span><input name="name" value="${current.name}"></label>
          <label class="field"><span>Status</span><select name="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${isRitoDealInStage(current, stage) ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
          <label class="field"><span>Setor</span><input name="sector" value="${current.sector}"></label>
          <label class="field"><span>Localização</span><input name="location" value="${current.location}"></label>
          <label class="field"><span>Ano</span><input name="year" value="${current.year}"></label>
          <label class="field"><span>Responsável</span><select name="owner">${workspaceOwnerOptions(state.currentWorkspace, current.owner).map((owner) => `<option value="${escapeAttr(owner)}" ${owner === current.owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}</select></label>
          <label class="field"><span>Valor estimado</span><input name="estimatedValue" type="number" value="${current.estimatedValue}"></label>
          <label class="field"><span>Valor da operação</span><input name="investmentAmount" type="number" value="${current.investmentAmount || 0}"></label>
          <label class="field"><span>Progresso</span><input name="progress" type="number" min="0" max="100" value="${current.progress}"></label>
          <label class="field full-span"><span>Framework</span><input name="framework" value="${current.framework}"></label>
          <label class="field full-span"><span>Histórico do deal / Resumo do status</span><textarea name="dealHistory">${current.dealHistory || ""}</textarea></label>
          <label class="field full-span"><span>Descrição</span><textarea name="description">${current.description}</textarea></label>
          <label class="field full-span"><span>Tags (separadas por vírgula)</span><input name="tags" value="${current.tags.join(", ")}"></label>
          <label class="field"><span>Upload de capa</span><input name="cover" type="file" accept="image/*"></label>
          <label class="field"><span>Upload de logo</span><input name="logo" type="file" accept="image/*"></label>
        </div>
        <div class="dialog-actions">
          <button class="ghost-button" type="button" data-dialog-close>Cancelar</button>
          <button class="action-button" value="default">Salvar</button>
        </div>
      </form>
    `;
    dialog.showModal();
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        dialog.close();
        dialog.classList.add("hidden");
      };
    });

    const form = document.getElementById("crmForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const nextItem = {
        ...current,
        name: formData.get("name"),
        status: formData.get("status"),
        sector: formData.get("sector"),
        location: formData.get("location"),
        year: formData.get("year"),
        owner: formData.get("owner"),
        estimatedValue: Number(formData.get("estimatedValue")),
        investmentAmount: Number(formData.get("investmentAmount") || 0),
        progress: Number(formData.get("progress")),
        framework: formData.get("framework"),
        dealHistory: formData.get("dealHistory"),
        description: formData.get("description"),
        tags: String(formData.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean)
      };
      dialog.close();
      dialog.classList.add("hidden");
      try {
        const [cover, logo] = await Promise.all([
          imageFileToProjectDataURL(form.querySelector("input[name='cover']").files[0], "cover", current.cover),
          imageFileToProjectDataURL(form.querySelector("input[name='logo']").files[0], "logo", current.logo)
        ]);
        nextItem.cover = cover;
        nextItem.logo = logo;
        void upsertCRMItem(nextItem).catch(() => null);
      } catch (error) {
        console.error("[crm-save] Erro no submit do modal de edicao do deal", {
          message: error?.message || String(error),
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null,
          dealId: nextItem?.id || null,
          dealName: nextItem?.name || null
        });
        alert(error?.message || "Nao foi possivel salvar o deal agora. Revise os dados e tente novamente.");
      }
    });
  }

  function openOpportunityDialog() {
    const dialog = document.getElementById("entityDialog");
    dialog.dataset.dialogSize = "wide";
    dialog.classList.remove("hidden");
    const current = {
      id: uid("deal"),
      name: "",
      logo: "",
      cover: defaultCover("Novo", "#16222a", "#3a6073"),
      description: "",
      sector: "",
      location: "",
      year: new Date().getFullYear().toString(),
      status: "Pipeline",
      tags: [],
      owner: workspaceOwnerOptions(state.currentWorkspace)[0] || "Arthur Bueno",
      estimatedValue: 0,
      framework: "",
      progress: 20,
      website: "",
      temperature: "Morno",
      investmentAmount: 0,
      mainContact: "",
      phone: "",
      email: "",
      closeDate: "",
      managementTeam: "",
      businessModel: "",
      competitors: "",
      advantages: "",
      dealHistory: ""
    };

    dialog.innerHTML = `
      <form method="dialog" id="opportunityForm" class="crm-dialog-form">
        <div class="dialog-header dialog-header-split">
          <div class="dialog-header-copy">
            <h3>Novo deal</h3>
          </div>
          <button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">X</button>
        </div>
        <div class="dialog-grid crm-dialog-grid">
          <label class="field"><span>Nome da empresa</span><input name="name"></label>
          <label class="field"><span>Setor</span><input name="sector"></label>
          <label class="field"><span>Cidade / Local</span><input name="location"></label>
          <label class="field"><span>Ano</span><input name="year" value="${current.year}"></label>
          <label class="field"><span>Website</span><input name="website"></label>
          <label class="field"><span>Valor estimado (R$)</span><input name="estimatedValue" type="number" value="0"></label>
          <label class="field"><span>Valor da operação (R$)</span><input name="investmentAmount" type="number" value="0"></label>
          <label class="field"><span>Estágio</span><select name="status">${ritoStatusOptionsMarkup(current.status)}</select></label>
          <label class="field"><span>Temperatura</span><select name="temperature">${["Frio", "Morno", "Quente"].map((temp) => `<option ${temp === current.temperature ? "selected" : ""}>${temp}</option>`).join("")}</select></label>
          <label class="field"><span>Responsável Rito</span><select name="owner">${workspaceOwnerOptions(state.currentWorkspace, current.owner).map((owner) => `<option value="${escapeAttr(owner)}" ${owner === current.owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}</select></label>
          <label class="field"><span>Contato principal</span><input name="mainContact"></label>
          <label class="field"><span>Telefone</span><input name="phone"></label>
          <label class="field"><span>E-mail</span><input name="email"></label>
          <label class="field"><span>Data de fechamento</span><input name="closeDate" type="date"></label>
          <label class="field full-span"><span>Tags (separadas por vírgula)</span><input name="tags"></label>
          <label class="field full-span"><span>Fundadores / Time de gestão</span><textarea name="managementTeam"></textarea></label>
          <label class="field full-span"><span>Descrição da empresa</span><textarea name="description"></textarea></label>
          <label class="field full-span"><span>Histórico do deal / Resumo do status</span><textarea name="dealHistory"></textarea></label>
          <label class="field full-span"><span>Modelo de negócio</span><textarea name="businessModel"></textarea></label>
          <label class="field full-span"><span>Competidores</span><textarea name="competitors"></textarea></label>
          <label class="field full-span"><span>Vantagens competitivas</span><textarea name="advantages"></textarea></label>
          <label class="field"><span>Upload de capa</span><input name="cover" type="file" accept="image/*"></label>
          <label class="field"><span>Upload de logo</span><input name="logo" type="file" accept="image/*"></label>
        </div>
        <div class="dialog-actions">
          <button class="ghost-button" type="button" data-dialog-close>Cancelar</button>
          <button class="action-button" type="submit">Salvar</button>
        </div>
      </form>
    `;

    dialog.showModal();
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        dialog.close();
        dialog.classList.add("hidden");
      };
    });

    const form = document.getElementById("opportunityForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const newItem = {
        ...current,
        name: formData.get("name"),
        sector: formData.get("sector"),
        location: formData.get("location"),
        year: formData.get("year"),
        website: formData.get("website"),
        status: formData.get("status"),
        temperature: formData.get("temperature"),
        owner: formData.get("owner"),
        mainContact: formData.get("mainContact"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        closeDate: formData.get("closeDate"),
        estimatedValue: Number(formData.get("estimatedValue")),
        investmentAmount: Number(formData.get("investmentAmount") || 0),
        managementTeam: formData.get("managementTeam"),
        description: formData.get("description"),
        dealHistory: formData.get("dealHistory"),
        businessModel: formData.get("businessModel"),
        competitors: formData.get("competitors"),
        advantages: formData.get("advantages"),
        tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean)
      };
      newItem.name = String(newItem.name || "").trim();
      if (!newItem.name) {
        alert("Preencha o nome da empresa para criar o card.");
        form.querySelector("input[name='name']")?.focus();
        return;
      }
      newItem.subtitle = newItem.subtitle || ritoSubtitle(newItem.sector, newItem.location, newItem.year);
      dialog.close();
      dialog.classList.add("hidden");
      try {
        const [cover, logo] = await Promise.all([
          imageFileToProjectDataURL(form.querySelector("input[name='cover']").files[0], "cover", newItem.cover),
          imageFileToProjectDataURL(form.querySelector("input[name='logo']").files[0], "logo", newItem.logo)
        ]);
        newItem.cover = cover;
        newItem.logo = logo;
        void upsertCRMItem(newItem, {
          silentError: true
        }).catch(() => null);
      } catch (error) {
        console.error("[crm-save] Erro no submit do modal de novo deal", {
          message: error?.message || String(error),
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null,
          dealId: newItem?.id || null,
          dealName: newItem?.name || null
        });
        alert(error?.message || "Nao foi possivel criar o deal agora. Revise os dados e tente novamente.");
      }
    });
  }

  async function upsertCRMItem(item, options = {}) {
    const workspaceId = state.currentWorkspace;
    const previousState = clonePortalState(state);
    const nextItem = clonePortalState(item);
    delete nextItem.__draftDirty;
    nextItem.updatedAt = new Date().toISOString();
    nextItem.createdAt = nextItem.createdAt || nextItem.updatedAt;
    ensureProjectShape(nextItem);
    const currentItems = Array.isArray(workspaceData().crmItems) ? workspaceData().crmItems : [];
    const index = currentItems.findIndex((entry) => entry.id === nextItem.id);
    const nextItems = [...currentItems];
    if (index >= 0) nextItems[index] = nextItem;
    else nextItems.unshift(nextItem);
    state.workspaces[workspaceId].crmItems = dedupeCRMItemsById(nextItems);
    if (nextItem.tags.includes("Investido") && !workspaceData().projectBoards[nextItem.name]) {
      workspaceData().projectBoards[nextItem.name] = [];
    }
    if (!nextItem.tags.includes("Investido") && workspaceData().projectBoards[nextItem.name] && nextItem.investmentStatus !== "Investido") {
      delete workspaceData().projectBoards[nextItem.name];
    }
    if (!options.skipRender) renderApp();
    try {
      await persistCRMItemToDatabase(nextItem, {
        workspaceId,
        renderOnSuccess: options.renderOnSuccess !== false
      });
      delete item.__draftDirty;
    } catch (error) {
      console.error("[crm-save] upsertCRMItem falhou", {
        workspaceId,
        dealId: nextItem?.id || null,
        dealName: nextItem?.name || null,
        message: error?.message || String(error),
        details: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || null
      });
      if (!options.preserveLocalOnError) {
        state = buildPortalState(previousState);
        if (!options.skipRender) renderApp();
      }
      if (!options.silentError) {
        alert("Não foi possível salvar este card no banco de dados. A alteração foi desfeita.");
      }
      throw error;
    }
  }

  async function removeCRMItem(item, options = {}) {
    if (!item) return;
    const workspaceId = state.currentWorkspace;
    const previousState = clonePortalState(state);
    if (workspaceId === "rito" && isSeededRitoCRMItem(item)) {
      const deletedReferenceProjectKeys = new Set(
        Array.isArray(workspaceData().deletedReferenceProjectKeys)
          ? workspaceData().deletedReferenceProjectKeys.map((key) => normalizeReferenceIdentity(key)).filter(Boolean)
          : []
      );
      deletedReferenceProjectKeys.add(referenceProjectKey(item));
      workspaceData().deletedReferenceProjectKeys = [...deletedReferenceProjectKeys];
    }
    state.workspaces[state.currentWorkspace].crmItems = workspaceData().crmItems.filter((entry) => entry.id !== item.id);
    normalizeCRMItemOrder(state.workspaces[state.currentWorkspace].crmItems);
    delete workspaceData().projectBoards[item.name];
    workspaceData().documents = workspaceData().documents.filter((doc) => (doc.linkedTo || "").toLowerCase() !== item.name.toLowerCase());
    renderApp();
    try {
      await persistCRMItemToDatabase(item, { workspaceId, remove: true });
    } catch (error) {
      console.error("[crm-save] removeCRMItem falhou", {
        workspaceId,
        dealId: item?.id || null,
        dealName: item?.name || null,
        message: error?.message || String(error),
        details: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || null
      });
      state = buildPortalState(previousState);
      renderApp();
      alert("Não foi possível excluir este card do banco de dados. A alteração foi desfeita.");
      throw error;
    }
  }

  function openProjectDrawer(projectId) {
    const item = workspaceData().crmItems.find((entry) => entry.id === projectId);
    if (!item) return;
    ensureProjectShape(item);
    const drawer = document.getElementById("entityDrawer");
    const backdrop = document.getElementById("drawerBackdrop");
    const relatedTasks = getRelatedTasks(item);
    const relatedDocs = getRelatedDocuments(item);

    drawer.innerHTML = `
      <div class="drawer-shell">
        <button class="ghost-button drawer-close" id="drawerCloseButton">Fechar</button>
        <div class="drawer-cover" style="background-image:url('${item.cover}')"></div>
        <div class="drawer-logo">${item.logo ? `<img src="${item.logo}" alt="${item.name}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">` : initials(item.name)}</div>
        <div class="drawer-header">
          <div class="chips">
            <span class="chip">${item.status}</span>
            <span class="chip">${item.temperature}</span>
            <span class="chip">${item.investmentStatus}</span>
          </div>
          <h3 style="margin:0;font-family:Georgia, 'Times New Roman', serif;font-size:2rem;">${item.name}</h3>
          <div class="subtle">${item.subtitle}</div>
          <div class="chips">${item.tags.map((tag) => `<span class="chip">${tag}</span>`).join("")}</div>
          <div class="subtle">Responsável: ${displayText(item.owner)}</div>
        </div>

        <section class="drawer-section">
          <h4>Informações gerais</h4>
          <div class="drawer-grid">
            <label class="field full-span"><span>Nome do projeto</span><input data-drawer-field="name" value="${escapeAttr(item.name)}"></label>
            <label class="field full-span"><span>Descrição</span><textarea data-drawer-field="description">${displayText(item.description || "")}</textarea></label>
            <label class="field"><span>Setor</span><input data-drawer-field="sector" value="${escapeAttr(item.sector || "")}"></label>
            <label class="field"><span>Subtítulo</span><input data-drawer-field="subtitle" value="${escapeAttr(displayText(item.subtitle || ""))}"></label>
            <label class="field"><span>Localização</span><input data-drawer-field="location" value="${escapeAttr(displayText(item.location || ""))}"></label>
            <label class="field"><span>Ano</span><input data-drawer-field="year" value="${escapeAttr(item.year || "")}"></label>
            <label class="field"><span>Estágio do funil</span><select data-drawer-field="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${isRitoDealInStage(item, stage) ? "selected" : ""}>${displayText(stage)}</option>`).join("")}</select></label>
            <label class="field"><span>Temperatura</span><input data-drawer-field="temperature" value="${escapeAttr(item.temperature || "")}" readonly></label>
            <label class="field"><span>Contato principal</span><input data-drawer-field="mainContact" value="${escapeAttr(item.mainContact || "")}"></label>
            <label class="field"><span>Telefone</span><input data-drawer-field="phone" value="${escapeAttr(item.phone || "")}"></label>
            <label class="field"><span>E-mail</span><input data-drawer-field="email" type="email" value="${escapeAttr(item.email || "")}"></label>
            <label class="field"><span>Status de investimento</span><select data-drawer-field="investmentStatus"><option ${item.investmentStatus === "Nao investido" ? "selected" : ""}>Não investido</option><option ${item.investmentStatus === "Investido" ? "selected" : ""}>Investido</option></select></label>
            <label class="field"><span>Valor estimado</span><input type="number" data-drawer-field="estimatedValue" value="${item.estimatedValue || 0}"></label>
            <label class="field"><span>Valor da operação</span><input type="number" data-drawer-field="investmentAmount" value="${item.investmentAmount || 0}"></label>
          <label class="field"><span>Responsável</span><select data-drawer-field="owner">${workspaceOwnerOptions(state.currentWorkspace, item.owner).map((owner) => `<option value="${escapeAttr(owner)}" ${owner === item.owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}</select></label>
            <label class="field"><span>Prioridade</span><select data-drawer-field="priority"><option ${item.priority === "Alta" ? "selected" : ""}>Alta</option><option ${item.priority === "Media" ? "selected" : ""}>Média</option><option ${item.priority === "Baixa" ? "selected" : ""}>Baixa</option></select></label>
            <label class="field"><span>Origem do deal</span><input data-drawer-field="origin" value="${escapeAttr(item.origin || "")}"></label>
            <label class="field full-span"><span>Histórico do deal / Resumo do status</span><textarea data-drawer-field="dealHistory">${displayText(item.dealHistory || "")}</textarea></label>
          </div>
        </section>

        <section class="drawer-section">
          <h4>Framework do projeto</h4>
          <div class="drawer-grid">
            <label class="field full-span"><span>Tese</span><textarea data-framework-field="tese">${item.frameworkDetails.tese}</textarea></label>
            <label class="field full-span"><span>Oportunidade</span><textarea data-framework-field="oportunidade">${item.frameworkDetails.oportunidade}</textarea></label>
            <label class="field full-span"><span>Riscos</span><textarea data-framework-field="riscos">${item.frameworkDetails.riscos}</textarea></label>
            <label class="field full-span"><span>Próximos passos</span><textarea data-framework-field="proximosPassos">${displayText(item.frameworkDetails.proximosPassos)}</textarea></label>
            <label class="field"><span>Status da diligência</span><input data-framework-field="statusDiligencia" value="${escapeAttr(displayText(item.frameworkDetails.statusDiligencia || ""))}"></label>
            <label class="field"><span>Observações estratégicas</span><input data-framework-field="observacoes" value="${escapeAttr(displayText(item.frameworkDetails.observacoes || ""))}"></label>
          </div>
        </section>

        <section class="drawer-section">
          <h4>Gestão de mídia</h4>
          <div class="file-input-row">
            <label class="mini-button">Trocar capa <input id="drawerCoverUpload" type="file" accept="image/*" hidden></label>
            <label class="mini-button">Trocar logo <input id="drawerLogoUpload" type="file" accept="image/*" hidden></label>
            <button class="mini-button" id="pasteImageButton">Colar imagem</button>
          </div>
          <div class="drawer-grid">
            <label class="field"><span>Posição da capa</span><select data-media-field="coverPosition"><option ${item.media.coverPosition === "center" ? "selected" : ""}>center</option><option ${item.media.coverPosition === "top" ? "selected" : ""}>top</option><option ${item.media.coverPosition === "bottom" ? "selected" : ""}>bottom</option></select></label>
            <label class="field"><span>Zoom da capa</span><input type="number" min="50" max="160" data-media-field="coverZoom" value="${item.media.coverZoom || 100}"></label>
          </div>
        </section>

        <section class="drawer-section">
          <h4>Tags</h4>
          <div class="tag-editor">${item.tags.map((tag) => `<span class="tag-chip">${tag}<button data-remove-tag="${tag}">X</button></span>`).join("")}</div>
          <label class="field"><span>Adicionar tag</span><input id="newTagInput" placeholder="Ex: SaaS"></label>
        </section>

        <section class="drawer-section">
          <h4>Timeline / histórico</h4>
          <div class="timeline-list">${item.history.map((entry) => `<article class="timeline-item"><strong>${entry.text}</strong><span class="subtle">${entry.at}</span></article>`).join("")}</div>
        </section>

        <section class="drawer-section">
          <h4>Tarefas relacionadas</h4>
          <div class="related-list">${relatedTasks.map((task) => `<article class="related-item"><strong>${task.title}</strong><span class="subtle">${task.stage || task.status} - ${task.owner} - ${task.dueDate || "-"}</span></article>`).join("") || "<div class='subtle'>Nenhuma tarefa vinculada.</div>"}</div>
          <button class="ghost-button" id="drawerAddTask">Criar nova tarefa</button>
        </section>

        <section class="drawer-section">
          <h4>Documentos relacionados</h4>
          <div class="related-list">${relatedDocs.map((doc) => `<article class="related-item"><strong>${doc.name}</strong><span class="subtle">${doc.category} - ${doc.uploadedAt}</span><div class="inline-actions">${resolveDocumentUrl(doc) ? `<a class="ghost-button" href="${escapeAttr(resolveDocumentUrl(doc))}" target="_blank" rel="noreferrer">Abrir</a>` : ""}<button class="ghost-button" data-delete-doc="${doc.id}">Excluir</button></div></article>`).join("") || "<div class='subtle'>Nenhum documento vinculado.</div>"}</div>
          <button class="ghost-button" id="drawerUploadDoc">Upload de arquivo</button>
        </section>

        <section class="drawer-section">
          <h4>Acoes</h4>
          <div class="drawer-actions">
            <button class="action-button" id="saveDrawerChanges">Salvar alterações</button>
            <button class="ghost-button" id="duplicateDrawerCard">Duplicar card</button>
            <button class="ghost-button" id="moveDrawerStage">Mover de estágio</button>
            <button class="ghost-button" id="markDrawerInvested">${item.investmentStatus === "Investido" ? "Marcar como não investido" : "Marcar como investido"}</button>
            <button class="ghost-button" id="archiveDrawerCard">Arquivar</button>
            <button class="ghost-button" id="deleteDrawerCard">Excluir card</button>
          </div>
        </section>
      </div>
    `;

    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");

    document.getElementById("drawerCloseButton").onclick = closeProjectDrawer;
    backdrop.onclick = closeProjectDrawer;
    bindProjectDrawer(item);
  }

  function closeProjectDrawer() {
    document.getElementById("entityDrawer").classList.add("hidden");
    document.getElementById("drawerBackdrop").classList.add("hidden");
  }

  function bindProjectDrawer(item) {
    const drawerRoot = document.getElementById("entityDrawer");
    document.getElementById("saveDrawerChanges").onclick = async () => {
      await persistDrawerProject(item, drawerRoot);
      renderApp();
      openProjectDrawer(item.id);
    };
    document.getElementById("duplicateDrawerCard").onclick = async () => {
      await duplicateCRMItem(item, state.projectReturnView[state.currentWorkspace] || "crm");
    };
    document.getElementById("moveDrawerStage").onclick = async () => {
      await persistDrawerProject(item, drawerRoot);
      const stages = workspaceConfig[state.currentWorkspace].pipelineStages;
      const nextIndex = (stages.indexOf(item.status) + 1) % stages.length;
      item.status = stages[nextIndex];
      item.temperature = temperatureFromRitoDealStatus(item.status);
      item.updatedAt = new Date().toISOString();
      pushHistory(item, `Estágio alterado para ${displayText(item.status)}`);
      await upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false
      });
      renderApp();
      openProjectDrawer(item.id);
    };
    document.getElementById("markDrawerInvested").onclick = async () => {
      persistProjectDraft(item, drawerRoot);
      const nextInvestmentStatus = item.investmentStatus === "Investido" ? "Nao investido" : "Investido";
      item.investmentStatus = nextInvestmentStatus;
      syncInvestmentTag(item);
      item.updatedAt = new Date().toISOString();
      pushHistory(item, nextInvestmentStatus === "Investido" ? "Projeto marcado como investido" : "Projeto marcado como nao investido");
      renderApp();
      openProjectDrawer(item.id);
      await upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false,
        silentError: false,
        preserveLocalOnError: false
      });
    };
    document.getElementById("archiveDrawerCard").onclick = async () => {
      item.archived = true;
      item.updatedAt = new Date().toISOString();
      pushHistory(item, "Projeto arquivado");
      await upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false
      });
      closeProjectDrawer();
      renderApp();
    };
    document.getElementById("deleteDrawerCard").onclick = async () => {
      const docsToRemove = workspaceData().documents.filter((doc) => (doc.linkedTo || "").toLowerCase() === item.name.toLowerCase());
      await Promise.all(docsToRemove.map((doc) => removeFileFromStorage(PORTAL_DOCUMENTS_BUCKET, doc.filePath)));
      await removeCRMItem(item);
      closeProjectDrawer();
      renderApp();
    };
    document.getElementById("drawerAddTask").onclick = () => openTaskDialog(item.name);
    document.getElementById("drawerUploadDoc").onclick = () => openDocumentDialog(item.name);
    document.getElementById("newTagInput").addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const value = event.target.value.trim();
      if (!value) return;
      item.tags.push(value);
      item.updatedAt = new Date().toISOString();
      pushHistory(item, `Tag adicionada: ${value}`);
      await upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false
      });
      openProjectDrawer(item.id);
    });
    document.querySelectorAll("[data-remove-tag]").forEach((button) => {
      button.onclick = async () => {
        item.tags = item.tags.filter((tag) => tag !== button.dataset.removeTag);
        item.updatedAt = new Date().toISOString();
        pushHistory(item, `Tag removida: ${button.dataset.removeTag}`);
        await upsertCRMItem(item, {
          skipRender: true,
          renderOnSuccess: false
        });
        openProjectDrawer(item.id);
      };
    });
    document.querySelectorAll("[data-delete-doc]").forEach((button) => {
      button.onclick = async () => {
        const doc = workspaceData().documents.find((entry) => entry.id === button.dataset.deleteDoc);
        await removeFileFromStorage(PORTAL_DOCUMENTS_BUCKET, doc?.filePath);
        workspaceData().documents = workspaceData().documents.filter((entry) => entry.id !== button.dataset.deleteDoc);
        item.updatedAt = new Date().toISOString();
        pushHistory(item, "Documento relacionado removido");
        await upsertCRMItem(item, {
          skipRender: true,
          renderOnSuccess: false
        });
        openProjectDrawer(item.id);
      };
    });
    document.getElementById("drawerCoverUpload").onchange = async (event) => {
      try {
        item.cover = await imageFileToProjectDataURL(event.target.files[0], "cover", item.cover);
        item.updatedAt = new Date().toISOString();
        pushHistory(item, "Capa atualizada");
        await upsertCRMItem(item, {
          skipRender: true,
          renderOnSuccess: false
        });
        openProjectDrawer(item.id);
      } catch (error) {
        alert(error?.message || "Não foi possível atualizar a capa.");
      }
    };
    document.getElementById("drawerLogoUpload").onchange = async (event) => {
      try {
        item.logo = await imageFileToProjectDataURL(event.target.files[0], "logo", item.logo);
        item.updatedAt = new Date().toISOString();
        pushHistory(item, "Logo atualizada");
        await upsertCRMItem(item, {
          skipRender: true,
          renderOnSuccess: false
        });
        openProjectDrawer(item.id);
      } catch (error) {
        alert(error?.message || "Não foi possível atualizar a logo.");
      }
    };
    document.getElementById("pasteImageButton").onclick = async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const clipItem of items) {
          const imageType = clipItem.types.find((type) => type.startsWith("image/"));
          if (!imageType) continue;
          const blob = await clipItem.getType(imageType);
          item.cover = await imageFileToProjectDataURL(new File([blob], "clipboard-image.png", { type: blob.type }), "cover", item.cover);
          item.updatedAt = new Date().toISOString();
          pushHistory(item, "Imagem colada na capa");
          await upsertCRMItem(item, {
            skipRender: true,
            renderOnSuccess: false
          });
          openProjectDrawer(item.id);
          return;
        }
      } catch (error) {
        alert(error?.message || "Não foi possível colar a imagem agora.");
      }
    };
  }

  async function persistDrawerProject(item, root = document, options = {}) {
    ensureProjectShape(item);
    const before = JSON.stringify(item);
    const oldName = item.name;
    root.querySelectorAll("[data-drawer-field]").forEach((field) => {
      const key = field.dataset.drawerField;
      item[key] = field.type === "number" ? Number(field.value) : field.value;
    });
    root.querySelectorAll("[data-framework-field]").forEach((field) => {
      item.frameworkDetails[field.dataset.frameworkField] = field.value;
    });
    root.querySelectorAll("[data-media-field]").forEach((field) => {
      item.media[field.dataset.mediaField] = field.type === "number" ? Number(field.value) : field.value;
    });
    item.contact = item.mainContact || "";
    item.management = item.managementTeam || "";
    ensureProjectShape(item);
    if (oldName !== item.name && workspaceData().projectBoards[oldName]) {
      const existingBoard = workspaceData().projectBoards[item.name] || [];
      workspaceData().projectBoards[item.name] = [...existingBoard, ...workspaceData().projectBoards[oldName]];
      delete workspaceData().projectBoards[oldName];
    }
    workspaceData().documents.forEach((doc) => {
      if ((doc.linkedTo || "").toLowerCase() === oldName.toLowerCase()) doc.linkedTo = item.name;
    });
    syncInvestmentTag(item);
    item.subtitle = item.subtitle || `${item.sector} - ${item.location} - ${item.year}`;
    const changed = JSON.stringify(item) !== before || item.__draftDirty === true;
    if (!changed) return false;
    item.updatedAt = new Date().toISOString();
    pushHistory(item, "Informações do projeto atualizadas");
    await upsertCRMItem(item, {
      skipRender: true,
      renderOnSuccess: false,
      silentError: options.silentError === true,
      preserveLocalOnError: options.preserveLocalOnError === true
    });
    delete item.__draftDirty;
    return true;
  }

  function persistProjectDraft(item, root = document) {
    ensureProjectShape(item);
    const before = JSON.stringify(item);
    const oldName = item.name;
    root.querySelectorAll("[data-drawer-field]").forEach((field) => {
      const key = field.dataset.drawerField;
      item[key] = field.type === "number" ? Number(field.value) : field.value;
    });
    root.querySelectorAll("[data-framework-field]").forEach((field) => {
      item.frameworkDetails[field.dataset.frameworkField] = field.value;
    });
    root.querySelectorAll("[data-media-field]").forEach((field) => {
      item.media[field.dataset.mediaField] = field.type === "number" ? Number(field.value) : field.value;
    });
    item.contact = item.mainContact || "";
    item.management = item.managementTeam || "";
    ensureProjectShape(item);
    if (oldName !== item.name && workspaceData().projectBoards[oldName]) {
      const existingBoard = workspaceData().projectBoards[item.name] || [];
      workspaceData().projectBoards[item.name] = [...existingBoard, ...workspaceData().projectBoards[oldName]];
      delete workspaceData().projectBoards[oldName];
    }
    workspaceData().documents.forEach((doc) => {
      if ((doc.linkedTo || "").toLowerCase() === oldName.toLowerCase()) doc.linkedTo = item.name;
    });
    syncInvestmentTag(item);
    item.subtitle = item.subtitle || `${item.sector} - ${item.location} - ${item.year}`;
    item.updatedAt = todayISO();
    const items = Array.isArray(workspaceData().crmItems) ? workspaceData().crmItems : [];
    const index = items.findIndex((entry) => entry.id === item.id);
    const nextItems = [...items];
    if (index >= 0) nextItems[index] = item;
    else nextItems.unshift(item);
    state.workspaces[state.currentWorkspace].crmItems = dedupeCRMItemsById(nextItems);
    if (JSON.stringify(item) !== before) {
      item.__draftDirty = true;
      saveLocalPortalState(state);
    }
  }

  function clipboardImageFromPasteEvent(event) {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((entry) => entry.type && entry.type.startsWith("image/"));
    return imageItem ? imageItem.getAsFile() : null;
  }

  function setProjectMediaPreview(item, target, previewUrl = "") {
    if (!item || !target || !previewUrl) return;
    item.__mediaPreview ||= {};
    item.__mediaPreview[target] = previewUrl;
  }

  function clearProjectMediaPreview(item, target) {
    const previewUrl = item?.__mediaPreview?.[target];
    if (typeof previewUrl === "string" && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    if (!item?.__mediaPreview) return;
    delete item.__mediaPreview[target];
    if (!Object.keys(item.__mediaPreview).length) {
      delete item.__mediaPreview;
    }
  }

  function projectMediaValue(item, target) {
    return item?.__mediaPreview?.[target] || item?.[target] || "";
  }

  async function applyProjectImageFile(item, target, file, sourceView, options = {}) {
    const { reopen = true } = options;
    if (!file) return false;
    const previousValue = item[target] || "";
    const previewUrl = URL.createObjectURL(file);
    try {
      setProjectMediaPreview(item, target, previewUrl);
      if (reopen) {
        openProjectDetail(item.id, sourceView);
      } else {
        renderAppPreservingScroll();
      }

      const resolvedUrl = await imageFileToProjectDataURL(file, target, previousValue);
      if (target === "logo") {
        item.logo = resolvedUrl;
        pushHistory(item, "Logo colada da área de transferência");
      } else {
        item.cover = resolvedUrl;
        pushHistory(item, "Capa colada da área de transferência");
      }
      clearProjectMediaPreview(item, target);
      item.updatedAt = new Date().toISOString();
      const persistPromise = upsertCRMItem(item, {
        skipRender: true,
        renderOnSuccess: false,
        preserveLocalOnError: true
      });
      if (reopen) {
        openProjectDetail(item.id, sourceView);
      } else {
        renderAppPreservingScroll();
      }
      await persistPromise;
      return true;
    } catch (error) {
      clearProjectMediaPreview(item, target);
      if (reopen) {
        openProjectDetail(item.id, sourceView);
      } else {
        renderAppPreservingScroll();
      }
      throw new Error(error?.message || "Não foi possível salvar a imagem no projeto.");
    }
  }

  async function pasteProjectImageFromClipboard(item, target, sourceView) {
    try {
      const items = await navigator.clipboard.read();
      for (const clipItem of items) {
        const imageType = clipItem.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await clipItem.getType(imageType);
        const file = new File([blob], `clipboard-${target}.png`, { type: blob.type });
        return applyProjectImageFile(item, target, file, sourceView);
      }
    } catch (error) {
      throw new Error(error?.message || "Não foi possível colar a imagem da área de transferência.");
    }
    return false;
  }

  function openProjectPasteDialog(item, target, sourceView) {
    const dialog = document.getElementById("entityDialog");
    dialog.dataset.dialogSize = "compact";
    dialog.className = "panel entity-dialog paste-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="compact-dialog-form paste-dialog-form">
        <div class="dialog-header-split">
          <div class="dialog-header-copy">
            <h3>Colar ${target === "logo" ? "logo" : "capa"}</h3>
          </div>
          <button class="dialog-close-button" value="cancel" type="submit">×</button>
        </div>
        <div class="compact-dialog-grid paste-dialog-grid">
          <div class="paste-dialog-copy">
            <span>${target === "logo" ? "Logo do projeto" : "Capa do projeto"}</span>
            <p>Copie uma imagem e pressione <strong>Ctrl+V</strong> nesta janela. Depois de colar, a ferramenta vai aplicar a imagem automaticamente no projeto.</p>
          </div>
          <button class="paste-dropzone" id="projectPasteDropzone" type="button">Ctrl+V para colar a imagem</button>
        </div>
        <div class="dialog-actions paste-dialog-actions">
          <button class="ghost-button" value="cancel" type="submit">Cancelar</button>
        </div>
      </form>
    `;
    dialog.showModal();

    const dropzone = document.getElementById("projectPasteDropzone");
    const defaultDropzoneText = "Ctrl+V para colar a imagem";
    const close = () => dialog.close();
    const setLoadingState = (loading) => {
      dropzone.disabled = loading;
      dropzone.textContent = loading ? "Aplicando imagem..." : defaultDropzoneText;
    };
    const completePaste = async (file) => {
      if (!file) return;
      try {
        setLoadingState(true);
        close();
        const ok = await applyProjectImageFile(item, target, file, sourceView);
        if (!ok) return;
      } catch (error) {
        alert(error?.message || "Não foi possível aplicar a imagem. Tente novamente.");
      }
    };
    const onPaste = async (event) => {
      const file = clipboardImageFromPasteEvent(event);
      if (!file) return;
      event.preventDefault();
      await completePaste(file);
    };

    dialog.addEventListener("paste", onPaste, { once: false });
    dropzone.focus();
    dropzone.onclick = () => dropzone.focus();
    dialog.addEventListener("close", () => {
      dialog.removeEventListener("paste", onPaste);
    }, { once: true });
  }

  function openProjectEditDialog(item, sourceView) {
    ensureProjectShape(item);
    const dialog = document.getElementById("entityDialog");
    dialog.dataset.dialogSize = "wide";
    dialog.className = "panel entity-dialog";
    dialog.innerHTML = `
      <form method="dialog" id="projectEditForm" class="crm-dialog-form project-edit-form">
        <div class="dialog-header-split">
          <div class="dialog-header-copy">
            <h3>Editar Projeto</h3>
          </div>
          <button class="dialog-close-button" value="cancel" type="submit">×</button>
        </div>
        <div class="dialog-grid crm-dialog-grid">
          <label class="field full-span"><span>Nome</span><input name="name" value="${escapeAttr(item.name || "")}"></label>
          <label class="field full-span"><span>Descrição da empresa</span><textarea name="description">${displayText(item.description || "")}</textarea></label>
          <label class="field"><span>Estágio</span><select name="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${isRitoDealInStage(item, stage) ? "selected" : ""}>${displayText(stage)}</option>`).join("")}</select></label>
          <label class="field"><span>Responsável</span><select name="owner">${workspaceOwnerOptions(state.currentWorkspace, item.owner).map((owner) => `<option value="${escapeAttr(owner)}" ${item.owner === owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}</select></label>
          <label class="field"><span>Prazo</span><input name="deadline" type="date" value="${escapeAttr(item.deadline || "")}"></label>
          <label class="field"><span>Valor (R$)</span><input name="estimatedValue" type="number" value="${escapeAttr(item.estimatedValue || 0)}"></label>
          <label class="field"><span>Valor da operação (R$)</span><input name="investmentAmount" type="number" value="${escapeAttr(item.investmentAmount || 0)}"></label>
          <label class="field full-span"><span>Progresso (0-100)</span><input name="progress" type="number" min="0" max="100" value="${escapeAttr(item.progress || 0)}"></label>
          <label class="field full-span"><span>Histórico do deal / Resumo do status</span><textarea name="dealHistory">${displayText(item.dealHistory || "")}</textarea></label>
          <label class="field"><span>Company</span><input name="company" value="${escapeAttr(item.name || "")}"></label>
          <label class="field"><span>Ano</span><input name="year" value="${escapeAttr(item.year || "")}"></label>
          <label class="field"><span>Localização</span><input name="location" value="${escapeAttr(displayText(item.location || ""))}"></label>
          <label class="field"><span>Website</span><input name="website" value="${escapeAttr(item.website || "")}"></label>
          <label class="field"><span>Categoria</span><input name="category" value="${escapeAttr(item.category || item.origin || "")}"></label>
          <label class="field"><span>Setor</span><input name="sector" value="${escapeAttr(displayText(item.sector || ""))}"></label>
          <label class="field"><span>Temperatura</span><input name="temperature" value="${escapeAttr(item.temperature || "")}" readonly></label>
          <label class="field"><span>Prioridade</span><select name="priority"><option ${item.priority === "Alta" ? "selected" : ""}>Alta</option><option ${item.priority === "Media" ? "selected" : ""}>Média</option><option ${item.priority === "Baixa" ? "selected" : ""}>Baixa</option></select></label>
          <label class="field"><span>VC/PE Backed</span><input name="vcPeBacked" value="${escapeAttr(item.vcPeBacked || "")}"></label>
          <label class="field"><span>Investimento</span><select name="investmentStatus"><option ${item.investmentStatus === "Nao investido" ? "selected" : ""}>Não investido</option><option ${item.investmentStatus === "Investido" ? "selected" : ""}>Investido</option></select></label>
          <label class="field"><span>Criado em</span><input name="createdAt" type="date" value="${escapeAttr(item.createdAt || "")}"></label>
          <label class="field"><span>Atualizado em</span><input name="updatedAt" type="date" value="${escapeAttr(item.updatedAt || "")}"></label>
          <label class="field full-span"><span>Time de gestão</span><textarea name="managementTeam">${displayText(item.managementTeam || "")}</textarea></label>
          <label class="field full-span"><span>Modelo de negócio</span><textarea name="businessModel">${displayText(item.businessModel || "")}</textarea></label>
          <label class="field full-span"><span>Receitas</span><textarea name="revenues">${item.revenues || ""}</textarea></label>
          <label class="field full-span"><span>Histórico de captação</span><textarea name="fundraisingHistory">${displayText(item.fundraisingHistory || "")}</textarea></label>
          <label class="field full-span"><span>Competidores</span><textarea name="competitors">${item.competitors || ""}</textarea></label>
          <label class="field full-span"><span>Vantagens competitivas</span><textarea name="advantages">${item.advantages || ""}</textarea></label>
          <label class="field full-span"><span>Fundadores</span><textarea name="founders">${item.founders || ""}</textarea></label>
        </div>
        <div class="dialog-actions">
          <button class="ghost-button project-delete-button" id="projectEditDelete" type="button">Excluir</button>
          <button class="ghost-button" value="cancel" type="submit">Cancelar</button>
          <button class="action-button" id="projectEditSave" type="submit">Salvar</button>
        </div>
      </form>
    `;
    dialog.showModal();

    document.getElementById("projectEditDelete").onclick = async () => {
      await removeCRMItem(item);
      dialog.close();
      closeProjectDetail();
    };

    document.getElementById("projectEditForm").addEventListener("submit", async (event) => {
      const submitter = event.submitter;
      if (submitter && submitter.value === "cancel") return;
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const oldName = item.name;
      item.name = String(formData.get("name") || item.name);
      item.description = String(formData.get("description") || "");
      item.status = String(formData.get("status") || item.status);
      item.owner = String(formData.get("owner") || item.owner);
      item.deadline = String(formData.get("deadline") || "");
      item.estimatedValue = Number(formData.get("estimatedValue") || 0);
      item.investmentAmount = Number(formData.get("investmentAmount") || 0);
      item.progress = Math.max(0, Math.min(100, Number(formData.get("progress") || item.progress || 0)));
      item.year = String(formData.get("year") || "");
      item.location = String(formData.get("location") || "");
      item.website = String(formData.get("website") || "");
      item.category = String(formData.get("category") || "");
      item.origin = item.category;
      item.sector = String(formData.get("sector") || "");
      item.priority = String(formData.get("priority") || item.priority);
      item.vcPeBacked = String(formData.get("vcPeBacked") || "");
      item.investmentStatus = String(formData.get("investmentStatus") || item.investmentStatus);
      item.createdAt = String(formData.get("createdAt") || item.createdAt);
      item.updatedAt = String(formData.get("updatedAt") || todayISO());
      item.managementTeam = String(formData.get("managementTeam") || "");
      item.businessModel = String(formData.get("businessModel") || "");
      item.revenues = String(formData.get("revenues") || "");
      item.fundraisingHistory = String(formData.get("fundraisingHistory") || "");
      item.competitors = String(formData.get("competitors") || "");
      item.advantages = String(formData.get("advantages") || "");
      item.founders = String(formData.get("founders") || "");
      item.subtitle = ritoSubtitle(item.sector, item.location, item.year);
      if (oldName !== item.name && workspaceData().projectBoards[oldName]) {
        workspaceData().projectBoards[item.name] = workspaceData().projectBoards[oldName];
        delete workspaceData().projectBoards[oldName];
      }
      workspaceData().documents.forEach((doc) => {
        if ((doc.linkedTo || "").toLowerCase() === oldName.toLowerCase()) doc.linkedTo = item.name;
      });
      ensureProjectShape(item);
      syncInvestmentTag(item);
      pushHistory(item, "Projeto editado na tela secundaria");
      await upsertCRMItem(item);
      dialog.close();
      openProjectDetail(item.id, sourceView);
    });
  }

  function syncInvestmentTag(item) {
    const transientTagKeys = new Set([
      normalizeProjectTagKey("Investido"),
      normalizeProjectTagKey("Não investido"),
      normalizeProjectTagKey("Frio"),
      normalizeProjectTagKey("Morno"),
      normalizeProjectTagKey("Quente"),
      normalizeProjectTagKey("Investida"),
      normalizeProjectTagKey("Declinada"),
      normalizeProjectTagKey("Declinado"),
      normalizeProjectTagKey("Declined"),
      normalizeProjectTagKey("Exit")
    ]);
    item.tags = (item.tags || []).filter((tag) => !transientTagKeys.has(normalizeProjectTagKey(tag)));
    item.tags.push(item.investmentStatus === "Investido" ? "Investido" : "Nao investido");
    item.tags.push(item.temperature);
    item.tags = normalizeProjectTagList(item.tags, item);
  }

  function normalizeProjectTagKey(tag) {
    return String(tag || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function canonicalProjectTag(tag) {
    const key = normalizeProjectTagKey(tag);
    if (!key) return "";
    const aliases = {
      declined: "Declinado",
      declinado: "Declinado",
      declinada: "Declinado",
      portfolio: "Portfólio",
      "portfólio": "Portfólio",
      "nao investido": "Não investido",
      "não investido": "Não investido",
      investida: "Investido"
    };
    return aliases[key] || String(tag || "").trim();
  }

  function normalizeProjectTagList(tags = [], item = null) {
    const seen = new Set();
    const next = [];
    const normalizedStatus = item ? normalizeRitoDealStatus(item.status, item.investmentStatus) : "";
    const normalizedTemperature = item ? temperatureFromRitoDealStatus(normalizedStatus) : "";

    (tags || []).forEach((tag) => {
      const value = canonicalProjectTag(tag);
      const key = normalizeProjectTagKey(value);
      if (!value || !key) return;
      if (normalizedStatus === "Declinado" && key === normalizeProjectTagKey("Declinada")) return;
      if ((normalizedStatus === "Aporte" || normalizedStatus === "Portfólio") && key === normalizeProjectTagKey("Investida")) return;
      if (seen.has(key)) return;
      seen.add(key);
      next.push(value);
    });

    if (item && normalizedStatus === "Declinado") {
      const declinedKey = normalizeProjectTagKey("Declinado");
      if (!seen.has(declinedKey)) next.push("Declinado");
    }

    if (item && normalizedStatus === "Exit") {
      const exitKey = normalizeProjectTagKey("Exit");
      if (!seen.has(exitKey)) next.push("Exit");
    }

    if (item && normalizedTemperature && normalizedStatus !== "Declinado") {
      const temperatureKey = normalizeProjectTagKey(canonicalProjectTag(normalizedTemperature));
      if (!seen.has(temperatureKey)) next.push(canonicalProjectTag(normalizedTemperature));
    }

    return next;
  }

  function isSystemProjectTag(tag) {
    const key = normalizeProjectTagKey(tag);
    const systemTags = new Set([
      ...RITO_DEAL_STATUS_OPTIONS.map((status) => normalizeProjectTagKey(status)),
      normalizeProjectTagKey("Declined"),
      normalizeProjectTagKey("Portfolio"),
      normalizeProjectTagKey("Investido"),
      normalizeProjectTagKey("Nao investido"),
      normalizeProjectTagKey("Frio"),
      normalizeProjectTagKey("Morno"),
      normalizeProjectTagKey("Quente")
    ]);
    return systemTags.has(key);
  }

  function editableProjectTags(item) {
    return (item.tags || []).filter((tag) => !isSystemProjectTag(tag));
  }

  function workspaceProjectTagOptions(workspaceId = state.currentWorkspace) {
    const data = state.workspaces[workspaceId];
    if (!data.projectTagOptions) data.projectTagOptions = [];
    const seen = new Set();
    const next = [];
    data.projectTagOptions.forEach((tag) => {
      const value = String(tag || "").trim();
      const key = normalizeProjectTagKey(value);
      if (!value || !key || isSystemProjectTag(value) || seen.has(key)) return;
      seen.add(key);
      next.push(value);
    });
    (data.crmItems || []).forEach((item) => {
      editableProjectTags(item).forEach((tag) => {
        const value = String(tag || "").trim();
        const key = normalizeProjectTagKey(value);
        if (!value || !key || seen.has(key)) return;
        seen.add(key);
        next.push(value);
      });
    });
    data.projectTagOptions = next;
    return data.projectTagOptions;
  }

  function setEditableProjectTags(item, nextTags) {
    const preserved = (item.tags || []).filter((tag) => isSystemProjectTag(tag));
    const seen = new Set();
    const cleaned = [];
    (nextTags || []).forEach((tag) => {
      const value = String(tag || "").trim();
      const key = normalizeProjectTagKey(value);
      if (!value || !key || isSystemProjectTag(value) || seen.has(key)) return;
      seen.add(key);
      cleaned.push(value);
    });
    item.tags = [...preserved, ...cleaned];
    workspaceProjectTagOptions();
  }

  function renameProjectTagAcrossWorkspace(oldTag, newTag, workspaceId = state.currentWorkspace) {
    const oldKey = normalizeProjectTagKey(oldTag);
    const nextValue = String(newTag || "").trim();
    const nextKey = normalizeProjectTagKey(nextValue);
    if (!oldKey || !nextKey) return false;
    const data = state.workspaces[workspaceId];
    data.crmItems.forEach((item) => {
      const nextTags = editableProjectTags(item).map((tag) => (normalizeProjectTagKey(tag) === oldKey ? nextValue : tag));
      setEditableProjectTags(item, nextTags);
    });
    data.projectTagOptions = workspaceProjectTagOptions(workspaceId).map((tag) => (normalizeProjectTagKey(tag) === oldKey ? nextValue : tag));
    data.projectTagOptions = workspaceProjectTagOptions(workspaceId);
    return true;
  }

  function deleteProjectTagAcrossWorkspace(tag, workspaceId = state.currentWorkspace) {
    const targetKey = normalizeProjectTagKey(tag);
    if (!targetKey) return false;
    const data = state.workspaces[workspaceId];
    data.crmItems.forEach((item) => {
      const nextTags = editableProjectTags(item).filter((entry) => normalizeProjectTagKey(entry) !== targetKey);
      setEditableProjectTags(item, nextTags);
    });
    data.projectTagOptions = workspaceProjectTagOptions(workspaceId).filter((entry) => normalizeProjectTagKey(entry) !== targetKey);
    return true;
  }

  function getRelatedTasks(item) {
    return [
      ...workspaceData().taskItems.filter((task) => (task.tags || []).includes(item.name) || task.title.includes(item.name)),
      ...(workspaceData().projectBoards[item.name] || [])
    ];
  }

  function getRelatedDocuments(item) {
    return workspaceData().documents.filter((doc) => (doc.linkedTo || "").toLowerCase() === item.name.toLowerCase());
  }

  function escapeAttr(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toFileHref(path) {
    const value = String(path || "").trim();
    if (!value) return "";
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (/^[a-z]:[\\/]/i.test(value)) return "";
    return encodeURI(value.replace(/\\/g, "/"));
  }

  function openTaskDialog(projectName, presetStage = "") {
    const dialog = document.getElementById("entityDialog");
    const stages = projectName ? workspaceProjectThemes(state.currentWorkspace) : workspaceTaskThemes(state.currentWorkspace);
    const selectedStage = presetStage && stages.includes(presetStage) ? presetStage : stages[0];
    const recurrenceOptions = ["Nenhuma", "Diária", "Semanal", "Quinzenal", "Mensal"];
    dialog.dataset.dialogSize = "wide";
    dialog.classList.remove("hidden");
    dialog.innerHTML = `
      <form method="dialog" id="taskForm" class="crm-dialog-form">
        <div class="dialog-header-split">
          <div class="dialog-header-copy">
            <h3>Nova Tarefa</h3>
          </div>
          <button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">×</button>
        </div>
        <div class="dialog-grid crm-dialog-grid task-editor-grid">
          <label class="field"><span>Tema</span><select name="stage">${stages.map((stage) => `<option ${stage === selectedStage ? "selected" : ""}>${displayText(stage)}</option>`).join("")}</select></label>
          <div class="field task-editor-spacer"></div>
          <label class="field full-span"><span>Título</span><input name="title" placeholder="Título da tarefa"></label>
          <label class="field full-span"><span>Descrição</span><textarea name="description"></textarea></label>
          <label class="field"><span>Status</span><select name="status"><option>A Fazer</option><option>Em andamento</option><option>Pausado</option><option>Revisão</option><option>Concluído</option></select></label>
          <label class="field"><span>Prioridade</span><select name="priority"><option>Alta</option><option>Média</option><option>Baixa</option></select></label>
          <label class="field"><span>Responsável</span><select name="owner"><option value="">Selecione</option>${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option>${displayText(owner)}</option>`).join("")}</select></label>
          <label class="field"><span>Prazo</span><input name="dueDate" type="date" value="${normalizeDateInputValue(todayISO())}"></label>
          <label class="field"><span>Data de conclusão</span><input name="completionDate" type="date" value=""></label>
          <label class="field"><span>Recorrência</span><select name="recurrence">${recurrenceOptions.map((option) => `<option>${option}</option>`).join("")}</select></label>
          <label class="field"><span>Base da recorrência</span><input name="recurrenceAnchorDate" type="date" value="${normalizeDateInputValue(todayISO())}"></label>
          <label class="field full-span"><span>Tags</span><input name="tags" placeholder="Ex: Marketing, Growth"></label>
        </div>
        <div class="dialog-actions task-create-actions">
          <button class="action-button task-create-button" value="default">Criar</button>
        </div>
      </form>
    `;
    dialog.showModal();
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        dialog.close();
        dialog.classList.add("hidden");
      };
    });
    const form = document.getElementById("taskForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const rollbackState = clonePortalState(state);
      const task = {
        id: uid("task"),
        title: formData.get("title"),
        description: formData.get("description"),
        owner: formData.get("owner"),
        dueDate: normalizeDateInputValue(formData.get("dueDate")),
        completionDate: normalizeDateInputValue(formData.get("completionDate")),
        recurrence: canonicalTaskRecurrence(formData.get("recurrence") || "Nenhuma"),
        recurrenceAnchorDate: normalizeDateInputValue(formData.get("recurrenceAnchorDate") || formData.get("dueDate") || todayISO()),
        lastRecurrenceResetAt: "",
        priority: formData.get("priority"),
        stage: formData.get("stage"),
        status: formData.get("status") || "A Fazer",
        tags: String(formData.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      refreshRecurringTask(task);
      if (projectName) {
        if (!workspaceData().projectBoards[projectName]) workspaceData().projectBoards[projectName] = [];
        workspaceData().projectBoards[projectName].push(task);
      }
      else workspaceData().taskItems.unshift(task);
      dialog.close();
      dialog.classList.add("hidden");
      renderAppPreservingScroll(task.id);
      await persistKanbanStateOptimistically({
        rollbackState,
        rollbackMessage: "Nao foi possível criar a tarefa. O Kanban voltou para o último estado salvo."
      });
    });
  }

  function openTaskThemesDialog() {
    const dialog = document.getElementById("entityDialog");
    const themes = [...workspaceTaskThemes(state.currentWorkspace)];
    const colors = [...workspaceTaskThemeColors(state.currentWorkspace)];
    dialog.dataset.dialogSize = "wide";
    dialog.classList.remove("hidden");
    dialog.innerHTML = `
      <form method="dialog" id="taskThemesForm" class="crm-dialog-form">
        <div class="dialog-header-split">
          <div class="dialog-header-copy">
            <h3>Editar Temas do Kanban</h3>
          </div>
          <button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">×</button>
        </div>
        <div class="dialog-grid crm-dialog-grid theme-editor-grid">
          <div class="theme-editor-list" id="themeEditorList">
            ${themes.map((theme, index) => `
              <div class="theme-editor-row" data-theme-row="${index}">
                <label class="field"><span>Temas do Kanban</span><input name="theme-name-${index}" value="${escapeAttr(theme)}"></label>
                <label class="field"><span>Cor</span><input name="theme-color-${index}" value="${escapeAttr(colors[index] || DEFAULT_KANBAN_THEME_COLORS[index % DEFAULT_KANBAN_THEME_COLORS.length])}"></label>
                <button class="ghost-button theme-row-delete" type="button" data-theme-delete="${index}">Excluir</button>
              </div>
            `).join("")}
          </div>
          <button class="ghost-button theme-row-add" type="button" id="addThemeRowButton">+ Novo tema</button>
        </div>
        <div class="dialog-actions">
          <button class="ghost-button" type="button" data-dialog-close>Cancelar</button>
          <button class="action-button" value="default">Salvar</button>
        </div>
      </form>
    `;
    dialog.showModal();
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        dialog.close();
        dialog.classList.add("hidden");
      };
    });

    const rowsRoot = document.getElementById("themeEditorList");
    const addRow = (name = "", color = DEFAULT_KANBAN_THEME_COLORS[0]) => {
      const index = rowsRoot.querySelectorAll("[data-theme-row]").length;
      const row = document.createElement("div");
      row.className = "theme-editor-row";
      row.dataset.themeRow = index;
      row.innerHTML = `
        <label class="field"><span>Temas do Kanban</span><input name="theme-name-${index}" value="${escapeAttr(name)}"></label>
        <label class="field"><span>Cor</span><input name="theme-color-${index}" value="${escapeAttr(color)}"></label>
        <button class="ghost-button theme-row-delete" type="button" data-theme-delete="${index}">Excluir</button>
      `;
      rowsRoot.appendChild(row);
      bindDeleteButtons();
    };

    const bindDeleteButtons = () => {
      rowsRoot.querySelectorAll("[data-theme-delete]").forEach((button) => {
        button.onclick = () => {
          const row = button.closest("[data-theme-row]");
          if (rowsRoot.querySelectorAll("[data-theme-row]").length <= 1) return;
          row?.remove();
        };
      });
    };

    document.getElementById("addThemeRowButton").onclick = () => {
      addRow("", DEFAULT_KANBAN_THEME_COLORS[rowsRoot.querySelectorAll("[data-theme-row]").length % DEFAULT_KANBAN_THEME_COLORS.length]);
    };
    bindDeleteButtons();

    const form = document.getElementById("taskThemesForm");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const nextThemes = [];
      const nextColors = [];
      const seenThemes = new Set();
      rowsRoot.querySelectorAll("[data-theme-row]").forEach((row, index) => {
        const name = row.querySelector(`input[name^='theme-name-']`)?.value.trim();
        const color = row.querySelector(`input[name^='theme-color-']`)?.value.trim();
        if (!name) return;
        const normalizedName = name.toLowerCase();
        if (seenThemes.has(normalizedName)) return;
        seenThemes.add(normalizedName);
        nextThemes.push(name);
        nextColors.push(color || DEFAULT_KANBAN_THEME_COLORS[index % DEFAULT_KANBAN_THEME_COLORS.length]);
      });
      if (!nextThemes.length) return;

      const previousThemes = [...workspaceTaskThemes(state.currentWorkspace)];
      const previousColors = [...workspaceTaskThemeColors(state.currentWorkspace)];
      const renamedMap = new Map();
      nextThemes.forEach((theme, index) => {
        if (previousThemes[index]) renamedMap.set(previousThemes[index], theme);
      });
      const fallbackTheme = nextThemes[0];
      workspaceData().taskItems.forEach((task) => {
        if (renamedMap.has(task.stage)) {
          task.stage = renamedMap.get(task.stage);
        } else if (!nextThemes.includes(task.stage)) {
          task.stage = fallbackTheme;
        }
      });
      workspaceData().taskThemes = nextThemes;
      workspaceData().taskThemeColors = nextColors;
      saveState();
      dialog.close();
      dialog.classList.add("hidden");
      renderApp();
    });
  }
  function openTaskEditor(taskId, isProject, projectName = "") {
    const dialog = document.getElementById("entityDialog");
    const task = findKanbanTask(taskId, isProject, projectName);
    if (!task) return;
    const themes = isProject ? workspaceProjectThemes(state.currentWorkspace) : workspaceTaskThemes(state.currentWorkspace);
    const memberOptions = workspaceConfig[state.currentWorkspace].memberOptions || [];
    const recurrenceOptions = ["Nenhuma", "Diária", "Semanal", "Quinzenal", "Mensal"];
    dialog.dataset.dialogSize = "wide";
    dialog.classList.remove("hidden");
    dialog.innerHTML = `
      <form method="dialog" id="taskEditorForm" class="crm-dialog-form" data-task-id="${escapeAttr(task.id)}" data-task-project="${isProject ? "1" : "0"}" data-project-name="${escapeAttr(projectName || "")}">
        <div class="dialog-header-split">
          <div class="dialog-header-copy">
            <h3>Editar Tarefa</h3>
          </div>
          <button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">×</button>
        </div>
        <div class="dialog-grid crm-dialog-grid task-editor-grid">
          <label class="field"><span>Tema</span><select name="stage">${themes.map((theme) => `<option ${task.stage === theme ? "selected" : ""}>${displayText(theme)}</option>`).join("")}</select></label>
          <div class="field task-editor-spacer"></div>
          <label class="field full-span"><span>Título</span><input name="title" value="${escapeAttr(displayText(task.title))}"></label>
          <label class="field full-span"><span>Descrição</span><textarea name="description">${displayText(task.description || "")}</textarea></label>
          <label class="field"><span>Status</span><select name="status"><option ${task.status === "A Fazer" || task.status === "A fazer" ? "selected" : ""}>A Fazer</option><option ${task.status === "Em Execucao" || task.status === "Em andamento" ? "selected" : ""}>Em andamento</option><option ${task.status === "Pausado" || task.status === "Pausada" ? "selected" : ""}>Pausado</option><option ${task.status === "Revisao" || task.status === "Revisão" ? "selected" : ""}>Revisão</option><option ${task.status === "Concluido" || task.status === "Concluído" ? "selected" : ""}>Concluído</option></select></label>
          <label class="field"><span>Prioridade</span><select name="priority"><option ${task.priority === "Alta" ? "selected" : ""}>Alta</option><option ${task.priority === "Media" ? "selected" : ""}>Média</option><option ${task.priority === "Baixa" ? "selected" : ""}>Baixa</option></select></label>
          <label class="field"><span>Responsável</span><select name="owner">${memberOptions.map((owner) => `<option ${task.owner === owner ? "selected" : ""}>${displayText(owner)}</option>`).join("")}</select></label>
          <label class="field"><span>Prazo</span><input name="dueDate" type="date" value="${escapeAttr(normalizeDateInputValue(task.dueDate || todayISO()))}"></label>
          <label class="field"><span>Data de conclusão</span><input name="completionDate" type="date" value="${escapeAttr(normalizeDateInputValue(task.completionDate || ""))}"></label>
          <label class="field"><span>Recorrência</span><select name="recurrence">${recurrenceOptions.map((option) => `<option ${canonicalTaskRecurrence(task.recurrence) === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>
          <label class="field"><span>Base da recorrência</span><input name="recurrenceAnchorDate" type="date" value="${escapeAttr(normalizeDateInputValue(task.recurrenceAnchorDate || task.dueDate || todayISO()))}"></label>
          <label class="field full-span"><span>Excluir</span><button class="ghost-button task-delete-button" type="button" id="taskDeleteButton">Excluir tarefa</button></label>
        </div>
        <div class="dialog-actions task-editor-actions">
          <button class="action-button" value="default">Salvar</button>
        </div>
      </form>
    `;
    dialog.showModal();
    const closeEditor = () => {
      dialog.close();
      dialog.classList.add("hidden");
    };
    let taskEditorAutosaveTimer = null;
    const queueTaskEditorAutosave = (mode = "debounced") => {
      const runAutosave = () => {
        persistTaskEditorDraft();
        void saveState({ instant: mode === "immediate" });
      };
      clearTimeout(taskEditorAutosaveTimer);
      if (mode === "immediate") {
        runAutosave();
        return;
      }
      taskEditorAutosaveTimer = setTimeout(runAutosave, 700);
    };
    const persistTaskEditorRemotely = () => {
      const rollbackState = clonePortalState(state);
      persistTaskEditorDraft();
      renderAppPreservingScroll(task.id);
      return persistKanbanStateOptimistically({
        rollbackState,
        rollbackMessage: "Nao foi possível salvar a tarefa. O Kanban voltou para o último estado salvo."
      }).catch(() => null);
    };
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        persistTaskEditorRemotely();
        closeEditor();
      };
    });
    dialog.addEventListener("cancel", async (event) => {
      event.preventDefault();
      persistTaskEditorRemotely();
      closeEditor();
    }, { once: true });
    document.getElementById("taskDeleteButton").onclick = async () => {
      const rollbackState = clonePortalState(state);
      if (!isProject && state.currentWorkspace === "fast" && isFastSeedTask(task)) {
        const deletedSeedTaskIds = new Set(
          Array.isArray(workspaceData().deletedSeedTaskIds)
            ? workspaceData().deletedSeedTaskIds.map((taskId) => String(taskId || "").trim()).filter(Boolean)
            : []
        );
        deletedSeedTaskIds.add(String(task.id || "").trim());
        workspaceData().deletedSeedTaskIds = [...deletedSeedTaskIds];
      }
      if (isProject) {
        const list = workspaceData().projectBoards[projectName] || [];
        workspaceData().projectBoards[projectName] = list.filter((item) => item.id !== taskId);
      } else {
        workspaceData().taskItems = workspaceData().taskItems.filter((item) => item.id !== taskId);
      }
      closeEditor();
      renderAppPreservingScroll();
      await persistKanbanStateOptimistically({
        rollbackState,
        rollbackMessage: "Nao foi possível excluir a tarefa. O Kanban voltou para o último estado salvo."
      });
    };
    const form = document.getElementById("taskEditorForm");
    form.querySelectorAll("input[type='date']").forEach((input) => {
      const openPicker = () => {
        if (typeof input.showPicker === "function") {
          try {
            input.showPicker();
          } catch {}
        }
      };
      input.addEventListener("focus", openPicker);
      input.addEventListener("click", openPicker);
    });
    form.querySelectorAll("input, textarea, select").forEach((field) => {
      field.addEventListener("input", () => {
        persistTaskEditorDraft();
        queueTaskEditorAutosave("debounced");
      });
      field.addEventListener("change", () => {
        persistTaskEditorDraft();
        if (field.name === "dueDate" || field.name === "completionDate") {
          persistTaskEditorRemotely();
          return;
        }
        queueTaskEditorAutosave("immediate");
      });
      field.addEventListener("blur", () => {
        persistTaskEditorDraft();
        queueTaskEditorAutosave("immediate");
      });
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const rollbackState = clonePortalState(state);
      persistTaskEditorDraft();
      closeEditor();
      renderAppPreservingScroll(task.id);
      await persistKanbanStateOptimistically({
        rollbackState,
        rollbackMessage: "Nao foi possível salvar a tarefa. O Kanban voltou para o último estado salvo."
      });
    });
  }


  function openDocumentDialog(linkedToPreset = "") {
    const dialog = document.getElementById("entityDialog");
    dialog.dataset.dialogSize = "compact";
    dialog.classList.remove("hidden");
    dialog.innerHTML = `
        <form method="dialog" id="documentForm" class="compact-dialog-form">
          <div class="panel-header dialog-header"><div><h3>Novo documento</h3><p>Upload para o Supabase Storage com categorização por área</p></div><button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">X</button></div>
        <div class="dialog-grid compact-dialog-grid">
          <label class="field"><span>Nome</span><input name="name"></label>
          <label class="field"><span>Categoria</span><select name="category"><option>Jurídico</option><option>Financeiro</option><option>Comercial</option></select></label>
          <label class="field full-span"><span>Vinculado a</span><input name="linkedTo" placeholder="Projeto ou área" value="${escapeAttr(linkedToPreset)}"></label>
          <label class="field full-span"><span>Arquivo</span><input name="file" type="file" multiple></label>
        </div>
        <div class="dialog-actions">
          <button class="ghost-button" type="button" data-dialog-close>Cancelar</button>
          <button class="action-button" value="default">Salvar</button>
        </div>
      </form>
    `;
    dialog.showModal();
    dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.onclick = () => {
        dialog.close();
        dialog.classList.add("hidden");
      };
    });
    const form = document.getElementById("documentForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const files = Array.from(form.querySelector("input[name='file']").files || []);
      if (!files.length) {
        alert("Selecione um arquivo para enviar ao banco.");
        return;
      }
      dialog.close();
      dialog.classList.add("hidden");

      const rawName = String(formData.get("name") || "").trim();
      const category = String(formData.get("category") || "").trim() || "Geral";
      const linkedTo = String(formData.get("linkedTo") || "").trim();
      const optimisticDocuments = files.map((file, index) => ({
        id: uid("doc"),
        name: rawName && files.length === 1 ? rawName : file.name || `Documento ${index + 1}`,
        category,
        linkedTo,
        fileType: file.type || "application/octet-stream",
        filePath: "",
        fileUrl: "",
        uploadedAt: "Enviando...",
        uploading: true
      }));

      workspaceData().documents.unshift(...optimisticDocuments);
      renderApp();

      try {
        const uploadedDocuments = await Promise.all(
          files.map(async (file, index) => {
            const uploaded = await uploadDocumentWithFallback(
              file,
              PORTAL_DOCUMENTS_BUCKET,
              `${state.currentWorkspace}/documents`,
              { prefix: "documento" }
            );
            return {
              ...optimisticDocuments[index],
              filePath: uploaded.path,
              fileUrl: uploaded.publicUrl,
              uploadedAt: todayISO(),
              uploading: false,
              storageFallback: Boolean(uploaded.fallback)
            };
          })
        );

        const documents = workspaceData().documents || [];
        workspaceData().documents = documents.map((doc) => {
          const replacement = uploadedDocuments.find((item) => item.id === doc.id);
          return replacement || doc;
        });
        void saveState();
        renderApp();
      } catch (error) {
        workspaceData().documents = (workspaceData().documents || []).filter(
          (doc) => !optimisticDocuments.some((pendingDoc) => pendingDoc.id === doc.id)
        );
        renderApp();
        console.error("Erro ao enviar documento:", error);
        alert(files.length > 1
          ? "Não foi possível concluir o upload dos arquivos."
          : "Não foi possível concluir o upload do arquivo.");
      }
    });
  }

  function findKanbanTask(taskId, isProject, projectName = "") {
    if (isProject) {
      if (projectName && workspaceData().projectBoards[projectName]) {
        return workspaceData().projectBoards[projectName].find((item) => item.id === taskId);
      }
      for (const list of Object.values(workspaceData().projectBoards || {})) {
        const found = list.find((item) => item.id === taskId);
        if (found) return found;
      }
      return null;
    }
    return workspaceData().taskItems.find((item) => item.id === taskId) || null;
  }

  function renameKanbanColumn(kind, index, nextName) {
    const cleanName = String(nextName || "").trim();
    if (!cleanName) return;
    const list = kind === "project" ? workspaceProjectThemes(state.currentWorkspace) : workspaceTaskThemes(state.currentWorkspace);
    const previous = list[index];
    if (!previous || normalizeColumnKey(previous) === normalizeColumnKey(cleanName)) {
      list[index] = cleanName;
      saveState({ instant: true });
      renderApp();
      return;
    }
    const duplicateIndex = list.findIndex((entry, entryIndex) => entryIndex !== index && normalizeColumnKey(entry) === normalizeColumnKey(cleanName));
    const collections = kind === "project"
      ? Object.values(workspaceData().projectBoards || {})
      : [workspaceData().taskItems || []];
    collections.forEach((cards) => {
      cards.forEach((task) => {
        if (normalizeColumnKey(task.stage) === normalizeColumnKey(previous)) task.stage = cleanName;
      });
    });
    if (duplicateIndex >= 0) {
      list.splice(index, 1);
      if (kind !== "project" && Array.isArray(workspaceData().taskThemeColors)) {
        workspaceData().taskThemeColors.splice(index, 1);
      }
    } else {
      list[index] = cleanName;
    }
    ensureWorkspaceKanbans(state.currentWorkspace);
    saveState({ instant: true });
    renderApp();
  }

  function persistKanbanColumnDraft(kind, index, nextName) {
    const cleanName = String(nextName || "").trim();
    if (!cleanName) return;
    const list = kind === "project" ? workspaceProjectThemes(state.currentWorkspace) : workspaceTaskThemes(state.currentWorkspace);
    if (!list[index]) return;
    list[index] = cleanName;
    saveState({ instant: false });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof createImageBitmap === "function") {
        createImageBitmap(file)
          .then(resolve)
          .catch(() => {
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
              URL.revokeObjectURL(objectUrl);
              resolve(image);
            };
            image.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              reject(new Error("Falha ao processar imagem"));
            };
            image.src = objectUrl;
          });
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Falha ao processar imagem"));
      };
      image.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Falha ao converter a imagem para upload."));
      }, mimeType, quality);
    });
  }

  function disposeImageSource(image) {
    if (image && typeof image.close === "function") {
      try {
        image.close();
      } catch (error) {
        console.warn("Não foi possível liberar o bitmap da imagem.", error);
      }
    }
  }

  function estimateDataURLBytes(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string") return 0;
    const base64 = dataUrl.split(",")[1] || "";
    return Math.ceil((base64.length * 3) / 4);
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo localmente."));
      reader.readAsDataURL(file);
    });
  }

  function isStorageBucketMissingError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("bucket not found") || message.includes("bucket") && message.includes("not found");
  }

  async function uploadProjectImageWithFallback(file, bucket, folder, options = {}) {
    try {
      const uploaded = await uploadFileToStorage(file, bucket, folder, options);
      return uploaded.publicUrl || "";
    } catch (error) {
      if (isStorageBucketMissingError(error)) {
        console.warn("[portal-media] Bucket de storage indisponivel. Usando fallback local em data URL.", {
          bucket,
          folder
        });
      } else {
        console.warn("[portal-media] Upload remoto falhou. Usando fallback local em data URL.", error);
      }
      return fileToDataURL(file);
    }
  }

  async function uploadDocumentWithFallback(file, bucket, folder, options = {}) {
    try {
      const uploaded = await uploadFileToStorage(file, bucket, folder, options);
      return {
        path: uploaded.path || "",
        publicUrl: uploaded.publicUrl || "",
        fallback: false
      };
    } catch (error) {
      if (isStorageBucketMissingError(error)) {
        console.warn("[portal-documents] Bucket de storage indisponivel. Usando fallback local em data URL.", {
          bucket,
          folder
        });
      } else {
        console.warn("[portal-documents] Upload remoto falhou. Usando fallback local em data URL.", error);
      }
      return {
        path: "",
        publicUrl: await fileToDataURL(file),
        fallback: true
      };
    }
  }

  async function imageFileToProjectDataURL(file, target, fallback) {
    if (!file) return fallback;
    const workspaceFolder = `${state.currentWorkspace}/${target === "logo" ? "logos" : "covers"}`;
    if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
      const uploadedUrl = await uploadProjectImageWithFallback(file, PORTAL_MEDIA_BUCKET, workspaceFolder, {
        prefix: target,
        defaultExtension: target === "logo" ? "svg" : "bin"
      });
      return uploadedUrl || fallback;
    }

    const image = await loadImageFromFile(file);
    try {
      const isLogo = target === "logo";
      const maxWidth = isLogo ? 220 : 560;
      const maxHeight = isLogo ? 220 : 320;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        const uploadedUrl = await uploadProjectImageWithFallback(file, PORTAL_MEDIA_BUCKET, workspaceFolder, {
          prefix: target
        });
        return uploadedUrl || fallback;
      }

      if (isLogo) {
        context.clearRect(0, 0, width, height);
      } else {
        context.fillStyle = "#f4f4f2";
        context.fillRect(0, 0, width, height);
      }

      context.drawImage(image, 0, 0, width, height);

      const mimeType = "image/webp";
      const targetBytes = isLogo ? 32 * 1024 : 56 * 1024;
      const qualitySteps = isLogo ? [0.72, 0.56, 0.42, 0.32] : [0.68, 0.52, 0.38, 0.28];

      try {
        let chosenBlob = null;
        for (const quality of qualitySteps) {
          const candidateBlob = await canvasToBlob(canvas, mimeType, quality);
          chosenBlob = candidateBlob;
          if (candidateBlob.size <= targetBytes) break;
        }
        if (!chosenBlob) {
          chosenBlob = await canvasToBlob(canvas, "image/jpeg", isLogo ? 0.56 : 0.5);
        }
        const optimizedFile = new File([chosenBlob], `${target}.${chosenBlob.type.includes("png") ? "png" : chosenBlob.type.includes("jpeg") ? "jpg" : "webp"}`, {
          type: chosenBlob.type || mimeType
        });
        const uploadedUrl = await uploadProjectImageWithFallback(optimizedFile, PORTAL_MEDIA_BUCKET, workspaceFolder, {
          prefix: target,
          contentType: optimizedFile.type
        });
        return uploadedUrl || fallback;
      } catch {
        const uploadedUrl = await uploadProjectImageWithFallback(file, PORTAL_MEDIA_BUCKET, workspaceFolder, {
          prefix: target
        });
        return uploadedUrl || fallback;
      }
    } finally {
      disposeImageSource(image);
    }
  }

  async function imageFileToMemberPhotoURL(file, fallback = "") {
    if (!file) return fallback;
    const workspaceFolder = `${state.currentWorkspace}/members`;
    if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
      const uploadedUrl = await uploadProjectImageWithFallback(file, PORTAL_MEDIA_BUCKET, workspaceFolder, {
        prefix: "member-photo",
        defaultExtension: "bin"
      });
      return uploadedUrl || fallback;
    }

    const image = await loadImageFromFile(file);
    try {
      const maxWidth = 280;
      const maxHeight = 280;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        const uploadedUrl = await uploadProjectImageWithFallback(file, PORTAL_MEDIA_BUCKET, workspaceFolder, {
          prefix: "member-photo"
        });
        return uploadedUrl || fallback;
      }

      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const mimeType = "image/webp";
      const targetBytes = 64 * 1024;
      const qualitySteps = [0.76, 0.6, 0.48];

      try {
        let chosenBlob = null;
        for (const quality of qualitySteps) {
          const candidateBlob = await canvasToBlob(canvas, mimeType, quality);
          chosenBlob = candidateBlob;
          if (candidateBlob.size <= targetBytes) break;
        }
        if (!chosenBlob) {
          chosenBlob = await canvasToBlob(canvas, "image/jpeg", 0.56);
        }
        const optimizedFile = new File([chosenBlob], `member-photo.${chosenBlob.type.includes("jpeg") ? "jpg" : "webp"}`, {
          type: chosenBlob.type || mimeType
        });
        const uploadedUrl = await uploadProjectImageWithFallback(optimizedFile, PORTAL_MEDIA_BUCKET, workspaceFolder, {
          prefix: "member-photo",
          contentType: optimizedFile.type
        });
        return uploadedUrl || fallback;
      } catch {
        const uploadedUrl = await uploadProjectImageWithFallback(file, PORTAL_MEDIA_BUCKET, workspaceFolder, {
          prefix: "member-photo"
        });
        return uploadedUrl || fallback;
      }
    } finally {
      disposeImageSource(image);
    }
  }

  function attachDnD(selector, onDrop) {
    document.querySelectorAll(selector).forEach((zone) => {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        document.querySelectorAll(selector).forEach((node) => {
          if (node !== zone) node.classList.remove("is-drop-target");
        });
        zone.classList.add("is-drop-target");
      });
      zone.addEventListener("dragleave", () => {
        zone.classList.remove("is-drop-target");
      });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("is-drop-target");
        const dragId = event.dataTransfer.getData("text/plain");
        onDrop(dragId, zone.dataset.dropzone);
      });
    });
  }

  function bindInlineEditing() {
    document.querySelectorAll("[data-inline-field]").forEach((node) => {
      const commit = async (persistRemotely = false) => {
        const taskId = node.dataset.id;
        const isProject = node.dataset.project === "1";
        const projectName = node.dataset.projectName || "";
        const found = findKanbanTask(taskId, isProject, projectName);
        if (!found) return;
        const field = node.dataset.inlineField;
        const nextValue = node.matches("input, select") ? node.value : node.textContent.trim();
        found[field] = nextValue;
        if (field === "dueDate") {
          found.status = nextValue < todayISO() ? "Atrasado" : "Em andamento";
        }
        touchKanbanTask(found);
        if (persistRemotely) {
          await saveState({ instant: true });
        }
      };
      node.addEventListener("input", () => {
        commit(false);
        void saveState({ instant: false });
      });
      const eventName = node.matches("select,input[type='date'],input[type='text']") ? "change" : "blur";
      node.addEventListener(eventName, () => {
        commit(true);
      });
      if (eventName !== "blur") node.addEventListener("blur", () => {
        commit(true);
      });
    });

    document.querySelectorAll("[data-inline-column]").forEach((node) => {
      node.addEventListener("input", () => {
        persistKanbanColumnDraft(node.dataset.inlineColumn, Number(node.dataset.columnIndex), node.textContent);
      });
      node.addEventListener("blur", () => renameKanbanColumn(node.dataset.inlineColumn, Number(node.dataset.columnIndex), node.textContent));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          node.blur();
        }
      });
    });
  }

  function bootstrapFromURL() {
    const params = new URLSearchParams(location.search);
    const workspace = params.get("workspace");
    const view = params.get("view");
    if (workspaceConfig[workspace]) state.currentWorkspace = workspace;
    if (view && workspaceConfig[state.currentWorkspace].views.includes(view)) {
      state.currentView[state.currentWorkspace] = view;
    }
  }

  function setPortalVisibility(isVisible) {
    const dialog = document.getElementById("entityDialog");
    document.body.classList.toggle("login-mode", !isVisible);
    document.querySelector(".app-shell")?.classList.toggle("hidden", !isVisible);
    document.getElementById("drawerBackdrop")?.classList.add("hidden");
    document.getElementById("entityDrawer")?.classList.add("hidden");
    if (dialog?.open) dialog.close();
    dialog?.classList.add("hidden");
  }

  function clearLoginIntroOverlay() {
    document.getElementById("loginIntroOverlay")?.remove();
  }

  async function playLoginIntroIfNeeded(readyPromise = Promise.resolve()) {
    clearLoginIntroOverlay();
    const overlay = document.createElement("div");
    overlay.id = "loginIntroOverlay";
    overlay.style.setProperty("--portal-cover-image-remote", `url("${LOGIN_COVER_GITHUB_URL}")`);
    overlay.style.setProperty("--portal-cover-image-local", `url("${LOGIN_COVER_PATH}")`);
    overlay.innerHTML = `
      <div class="portal-intro-shell">
        <video class="portal-intro-video" autoplay muted playsinline preload="auto" poster="${LOGIN_COVER_PATH}" disablepictureinpicture src="${LOGIN_INTRO_VIDEO_PATH}"></video>
        <button class="portal-intro-skip" type="button">Pular</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const introShell = overlay.querySelector(".portal-intro-shell");
    const video = overlay.querySelector("video");
    const skipButton = overlay.querySelector(".portal-intro-skip");

    await new Promise((resolve) => {
      let finished = false;
      let revealed = false;
      let readySettled = false;
      let playbackDone = false;
      let absoluteTimer = window.setTimeout(() => complete(), LOGIN_INTRO_MAX_PLAY_MS);
      let fallbackTimer = window.setTimeout(() => complete(), LOGIN_INTRO_WAIT_TIMEOUT_MS);
      const tryComplete = () => {
        if (!playbackDone || !readySettled) return;
        complete();
      };
      const complete = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(absoluteTimer);
        window.clearTimeout(fallbackTimer);
        overlay.classList.add("is-leaving");
        window.setTimeout(() => {
          clearLoginIntroOverlay();
          resolve();
        }, 260);
      };
      const finishPlayback = () => {
        playbackDone = true;
        tryComplete();
      };

      const revealVideo = () => {
        if (revealed) return;
        revealed = true;
        introShell?.classList.add("is-video-ready");
        window.clearTimeout(fallbackTimer);
        fallbackTimer = window.setTimeout(() => finishPlayback(), Math.min(
          LOGIN_INTRO_MAX_PLAY_MS,
          Math.max(2500, ((video.duration || 0) * 1000) || LOGIN_INTRO_WAIT_TIMEOUT_MS)
        ));
      };

      Promise.resolve(readyPromise)
        .catch(() => null)
        .finally(() => {
          readySettled = true;
          tryComplete();
        });

      video.addEventListener("ended", finishPlayback, { once: true });
      video.addEventListener("error", finishPlayback, { once: true });
      video.addEventListener("abort", finishPlayback, { once: true });
      video.addEventListener("stalled", () => window.setTimeout(() => finishPlayback(), LOGIN_INTRO_FAIL_FAST_MS), { once: true });
      video.addEventListener("suspend", () => window.setTimeout(() => finishPlayback(), LOGIN_INTRO_FAIL_FAST_MS), { once: true });
      video.addEventListener("loadeddata", revealVideo, { once: true });
      video.addEventListener("canplay", revealVideo, { once: true });
      video.addEventListener("playing", revealVideo, { once: true });
      skipButton.addEventListener("click", finishPlayback, { once: true });

      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      video.load();

      const playAttempt = video.play();
      if (playAttempt && typeof playAttempt.catch === "function") {
        playAttempt.catch(() => {
          window.setTimeout(() => finishPlayback(), LOGIN_INTRO_FAIL_FAST_MS);
        });
      }
    });
  }

  async function showLoginScreen() {
    setPortalVisibility(false);
    clearLoginIntroOverlay();

    let overlay = document.getElementById("loginOverlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "loginOverlay";
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="portal-login-shell">
        <section class="portal-login-panel">
          <div class="portal-login-panel-inner">
            <div class="portal-login-copy">
              <span class="portal-login-kicker">Portal de Gestão Rito</span>
              <h2>Bem-Vindo<span>.</span></h2>
            </div>

            <form id="loginForm" class="portal-login-form">
              <label class="portal-login-field">
                <span>Email</span>
                <input id="loginEmail" type="email" required>
              </label>

              <label class="portal-login-field">
                <span>Senha</span>
                <input id="loginPassword" type="password" required>
              </label>

              <p id="loginMessage" class="portal-login-message"></p>

              <button type="submit" class="portal-login-submit">Entrar</button>
              <button type="button" id="registerBtn" class="portal-login-secondary">1º acesso</button>
            </form>

            <div class="portal-login-bottom">
              <span>© 2026 Rito Ventures</span>
              <div>
                <span>Suporte</span>
                <span>Privacidade</span>
              </div>
            </div>
          </div>
        </section>

        <section class="portal-login-stage">
          <div class="portal-login-stage-grid"></div>
          <div class="portal-login-stage-glow"></div>
          <div class="portal-login-stage-copy">
            <span>Rua 72, 325, salas 1201 a 1206, Jardim Goiás | Goiânia-GO</span>
            <span>www.ritoventures.com.br</span>
          </div>
        </section>
      </div>
    `;
    overlay.style.setProperty("--portal-cover-image-remote", `url("${LOGIN_COVER_GITHUB_URL}")`);
    overlay.style.setProperty("--portal-cover-image-local", `url("${LOGIN_COVER_PATH}")`);

    const form = overlay.querySelector("#loginForm");
    const registerBtn = overlay.querySelector("#registerBtn");
    const msg = overlay.querySelector("#loginMessage");

    function getCreds() {
      return {
        email: overlay.querySelector("#loginEmail").value.trim(),
        password: overlay.querySelector("#loginPassword").value.trim()
      };
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const { email, password } = getCreds();

      if (!email || !password) {
        msg.textContent = "Preencha e-mail e senha.";
        return;
      }

      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        msg.style.color = "#d9534f";
        msg.textContent = error.message || "Credenciais inválidas.";
        return;
      }

      msg.style.color = "#2e7d32";
      msg.textContent = "Entrando...";
      await protectApp();
    });

    registerBtn.addEventListener("click", async () => {
      const { email, password } = getCreds();

      if (!email || !password) {
        msg.textContent = "Preencha e-mail e senha.";
        return;
      }

      const { error } = await supabaseClient.auth.signUp({ email, password });

      if (error) {
        msg.textContent = error.message;
        return;
      }

      msg.style.color = "#2e7d32";
      msg.textContent = "Conta criada com sucesso.";
    });
  }

  async function persistPortalBeforeSessionChange() {
    flushOpenEditors();
    stampPortalState(state);
    try {
      await flushRemoteSave();
    } catch (error) {
      console.warn("Falha ao sincronizar antes da troca de sessão.", error);
    }
  }

  async function logoutUser() {
    await persistPortalBeforeSessionChange();
    history.replaceState({}, "", location.pathname);
    clearLoginIntroOverlay();
    await supabaseClient.auth.signOut();
    document.getElementById("portalLogoutButton")?.remove();
    await showLoginScreen();
  }

  function addLogoutButton() {
    const existing = document.getElementById("portalLogoutButton");
    if (existing) return;
    const btn = document.createElement("button");
    btn.id = "portalLogoutButton";
    btn.textContent = "Sair";
    btn.className = "ghost-button";
    btn.style.position = "";
    btn.style.right = "";
    btn.style.top = "";
    btn.style.bottom = "";
    btn.style.padding = "7px 14px";
    btn.style.background = "#2d1f52";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "16px";
    btn.style.boxShadow = "0 8px 18px rgba(45, 31, 82, 0.18)";
    btn.style.cursor = "pointer";
    btn.onclick = logoutUser;

    document.querySelector(".topbar-actions")?.appendChild(btn);
  }

  function showPortalSkeleton() {
    const target = document.getElementById("appContent");
    if (!target) return;
    target.innerHTML = `
      <div class="portal-skeleton" style="padding:24px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;gap:12px;margin-bottom:8px;">
          <div class="skel-block" style="width:160px;height:32px;border-radius:6px;"></div>
          <div class="skel-block" style="width:100px;height:32px;border-radius:6px;"></div>
          <div class="skel-block" style="width:80px;height:32px;border-radius:6px;"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;">
          ${Array.from({ length: 6 }).map(() => `
            <div class="skel-block" style="height:140px;border-radius:10px;"></div>
          `).join("")}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
          ${Array.from({ length: 4 }).map(() => `
            <div class="skel-block" style="height:52px;border-radius:8px;"></div>
          `).join("")}
        </div>
      </div>
    `;
  }

  async function protectApp() {
    const { data } = await supabaseClient.auth.getUser();

    if (!data.user) {
      await showLoginScreen();
      return;
    }

    await refreshSessionAccessToken();
    history.replaceState({}, "", location.pathname);
    document.getElementById("loginOverlay")?.remove();
    setPortalVisibility(true);
    renderApp();
    const portalReadyPromise = (async () => {
      state = await loadState();
      if (!portalDataScore(state)) {
        const recoveredState = await loadBundledPortalBackup();
        if (portalDataScore(recoveredState) > 0) {
          updateRecoveryDiagnostics({
            notes: ["State final veio vazio; backup local forçado antes da renderização."]
          });
          state = finalizeLoadedPortalState(recoveredState, "forced-backup-before-render");
        }
      }
      history.replaceState({}, "", location.pathname);
      renderApp();
      addLogoutButton();
    })();
    const introPromise = playLoginIntroIfNeeded(portalReadyPromise);
    await nextPaint();
    try {
      await portalReadyPromise;
      await introPromise;
      history.replaceState({}, "", location.pathname);
      renderApp();
    } catch (error) {
      console.error("Falha ao carregar o portal exclusivamente do Supabase.", error);
      document.getElementById("appContent").innerHTML = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3>Falha ao carregar dados do Supabase</h3>
              <p>O portal nao vai usar fallback local. Verifique a conexão e tente novamente.</p>
            </div>
          </div>
          <div class="inline-actions">
            <button class="action-button" id="retryPortalLoadButton" type="button">Tentar novamente</button>
          </div>
        </section>
      `;
      document.getElementById("retryPortalLoadButton")?.addEventListener("click", () => {
        window.location.reload();
      });
      await introPromise.catch(() => null);
    }
  }

  window.addEventListener("beforeunload", () => {
    flushOpenEditors();
    triggerKeepalivePortalSave();
  });

  window.addEventListener("pagehide", () => {
    flushOpenEditors();
    flushRemoteSave();
    triggerKeepalivePortalSave();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    flushOpenEditors();
    flushRemoteSave();
    triggerKeepalivePortalSave();
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSessionAccessToken = session?.access_token || "";
  });

  window.addEventListener("load", protectApp);
