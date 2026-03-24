const STORAGE_KEY = "rito-os-v1";

const SUPABASE_URL = "https://soarinrvuvnqabtyyrta.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qsbL0lRuMR1eZAKp0vcscg_5PfVxGHo";

if (!window.supabase) {
  throw new Error("SDK do Supabase não carregou.");
}

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

// =======================
// BANCO DE DADOS GLOBAL
// =======================

async function loadSharedPortalState() {
  const { data, error } = await supabaseClient
    .from("shared_portal_state")
    .select("id, data, updated_at")
    .eq("id", 1)
    .single();

  if (error) throw error;
  return data;
}

async function saveSharedPortalState(state) {
  const payload = {
    id: 1,
    data: state,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient
    .from("shared_portal_state")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

function loadStateFromLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Nao foi possivel ler o cache local do portal.", error);
    return null;
  }
}

function getStateTimestamp(candidate, fallback = "") {
  return String(candidate?.lastSavedAt || candidate?.updated_at || fallback || "");
}

function chooseMoreRecentState(localState, remoteState, remoteUpdatedAt = "") {
  if (!localState && !remoteState) return null;
  if (localState && !remoteState) return localState;
  if (!localState && remoteState) return remoteState;
  const localStamp = Date.parse(getStateTimestamp(localState));
  const remoteStamp = Date.parse(getStateTimestamp(remoteState, remoteUpdatedAt));
  if (Number.isFinite(localStamp) && Number.isFinite(remoteStamp)) {
    return localStamp >= remoteStamp ? localState : remoteState;
  }
  return localState || remoteState;
}

function cacheStateLocally(nextState = state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch (error) {
    console.warn("Nao foi possivel atualizar o cache local do portal.", error);
  }
}


// =======================
// AUTO SAVE
// =======================

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    try {
      await saveSharedPortalState(state);
      console.log("Portal salvo no banco.");
    } catch (error) {
      console.error("Erro ao salvar:", error);
    }
  }, 800);
}

const ARTHUR_BUENO_PHOTO = "foto-arthur.jpg";

const workspaceConfig = {
  rito: {
    id: "rito",
    name: "Rito Ventures",
    subtitle: "CRM, investimento e operação",
    mark: "Rito",
    views: ["dashboard", "crm", "invested", "tasks", "projectBoards", "documents", "members", "settings"],
    pipelineStages: ["Frio", "Morno", "Quente", "Pipeline", "Declined"],
    kanbanStages: ["A fazer", "Em andamento", "Concluido"],
    memberOptions: ["Bruna Cristina", "Arthur Bueno", "Ciro Ribeiro", "Gabriela Reis"]
  },
  atica: {
    id: "atica",
    name: "Ática Gestão",
    subtitle: "CRM e gestão interna",
    mark: "AG",
    views: ["dashboard", "crm", "tasks", "projectBoards", "documents"],
    pipelineStages: ["Frio", "Morno", "Quente", "Pipeline", "Declined"],
    kanbanStages: ["A fazer", "Em andamento", "Concluido"],
    memberOptions: ["Bruna Cristina", "Arthur Bueno", "Ciro Ribeiro", "Gabriela Reis"]
  },
  fast: {
    id: "fast",
    name: "Fast Massagem",
    subtitle: "Operação, marketing e expansão",
    mark: "FM",
    views: ["dashboard", "tasks", "calendar"],
    kanbanStages: ["ABF", "Pessoas", "Operacoes", "Estrategico", "Financeiro", "Marketing"],
    memberOptions: ["Bruna Cristina", "Arthur Bueno", "Ciro Ribeiro", "Mayra", "Eduardo", "Grace", "Rodrigo"]
  }
};

const DEFAULT_TASK_THEMES = {
  rito: ["Infra / CRM", "Marca e Marketing", "Digital", "Juridico", "Deals", "Governanca", "Marca", "Financeiro"],
  atica: ["Operacao", "Financeiro", "Comercial", "Governanca", "Projetos"],
  fast: ["ABF", "Pessoas", "Operacoes", "Estrategico", "Financeiro", "Marketing"]
};

const DEFAULT_PROJECT_THEMES = {
  rito: ["Operacao", "Financeiro", "Comercial", "Juridico", "Growth"],
  atica: ["Operacao", "Financeiro", "Comercial", "Juridico", "Governanca"],
  fast: ["Operacao", "Marketing", "Expansao", "Financeiro"]
};

const DEFAULT_KANBAN_THEME_COLORS = ["#8AAFCC", "#80CBC4", "#C87070", "#B0ACCE", "#F48FB1", "#FFCC80", "#FF8A65", "#B8A47A", "#4DB6AC", "#7986CB", "#BA68C8"];

const coverPalette = {
  Frio: "#8da2c6",
  Morno: "#ffb84d",
  Quente: "#ff6b6b",
  Pipeline: "#2864ff",
  Declined: "#697586",
  Investido: "#0f9f67"
};

const viewLabels = {
  dashboard: "Dashboard",
  crm: "CRM",
  invested: "Projetos Investidos",
  tasks: "Kanban",
  projectBoards: "Kanban dos Projetos",
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
  },
  atica: {
    index: "03",
    shortLabel: "AG",
    descriptor: "Gestão Interna",
    greeting: "CRM e gestão interna do workspace."
  }
};

function workspaceLogoMarkup(workspaceId, variant = "default") {
  if (workspaceId === "fast") {
    return `
      <svg class="workspace-logo workspace-logo-fast workspace-logo-${variant}" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#a2a07f" stroke-width="3.6"/>
        <path d="M50 50 C43 35, 35 25, 24 23 C26 35, 33 45, 50 50" fill="none" stroke="#a2a07f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M50 50 C57 35, 65 25, 76 23 C74 35, 67 45, 50 50" fill="none" stroke="#a2a07f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M50 50 C43 65, 35 75, 24 77 C26 65, 33 55, 50 50" fill="none" stroke="#a2a07f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M50 50 C57 65, 65 75, 76 77 C74 65, 67 55, 50 50" fill="none" stroke="#a2a07f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M50 38 C46 31, 46 22, 50 15 C54 22, 54 31, 50 38" fill="none" stroke="#a2a07f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M38 50 C31 46, 22 46, 15 50 C22 54, 31 54, 38 50" fill="none" stroke="#a2a07f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M62 50 C69 46, 78 46, 85 50 C78 54, 69 54, 62 50" fill="none" stroke="#a2a07f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M50 62 C46 69, 46 78, 50 85 C54 78, 54 69, 50 62" fill="none" stroke="#a2a07f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }
  if (workspaceId === "atica") {
    return `
      <svg class="workspace-logo workspace-logo-atica workspace-logo-${variant}" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="23" r="7" fill="#f4b400"/>
        <path d="M18 38 L18 66 L29 84 L71 84 L82 66 L82 38 L63 47 L50 38 L37 47 Z" fill="#f4b400"/>
        <rect x="30" y="89" width="40" height="7" fill="#f4b400"/>
      </svg>
    `;
  }
  return `
    <svg class="workspace-logo workspace-logo-rito workspace-logo-${variant}" viewBox="0 0 180 100" aria-hidden="true">
      <text x="20" y="56" font-size="44" font-family="Georgia, 'Times New Roman', serif" fill="#1e1d21">Rito</text>
      <text x="24" y="80" font-size="18" font-family="Calibri, 'Segoe UI', sans-serif" letter-spacing="1.5" fill="#1e1d21">ventures</text>
      <path d="M156 49 l7 7 l-7 7 l-7 -7 Z" fill="none" stroke="#1e1d21" stroke-width="3"/>
    </svg>
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

function reorderCRMItems(draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const items = [...(workspaceData().crmItems || [])];
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) return;
  const [draggedItem] = items.splice(draggedIndex, 1);
  items.splice(targetIndex, 0, draggedItem);
  state.workspaces[state.currentWorkspace].crmItems = items;
  saveState();
  renderApp();
}

const ritoDashboardRows = [
  { company: "Ibi Liv", segment: "natalia@ope.com.br", contact: "(62) 99174-0717", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "IL" },
  { company: "Centro de Treinamento Marcio Goncalves", segment: "Fitness", contact: "(62) 98179-0909", stage: "Declined", temp: "Frio", owner: "Arthur Bueno", close: "-", initials: "MG" },
  { company: "Manakai Goiania", segment: "manakaipraia@gmail.com", contact: "(62) 98122-8048", stage: "Declined", temp: "Frio", owner: "Arthur Bueno", close: "-", initials: "MK" },
  { company: "EPIC", segment: "Startup", contact: "-", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "EP" },
  { company: "Verse Skincare", segment: "Cosmeticos", contact: "-", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "VS" },
  { company: "YellotMob", segment: "Energia / Software", contact: "-", stage: "Pipeline", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "YM" },
  { company: "Omni Internet", segment: "Telecom", contact: "-", stage: "Portfolio", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "OI" },
  { company: "Verde Brasil", segment: "Agro / Carbono", contact: "-", stage: "Declined", temp: "Morno", owner: "Arthur Bueno", close: "-", initials: "VB" }
];

const ritoPipelineCards = [
  { name: "Ibi Liv", subtitle: "Saude & Bem-estar - Aparecida de Goiania - GO - 2025", status: "Pipeline", cover: defaultCover("Ibi Liv", "#f6f1eb", "#f0d9cf"), logoText: "IL", logoBg: "#f5eadf", tags: ["Private Equity", "Pipeline", "Saude & Bem-estar", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#9f6d2b" },
  { name: "Centro de Treinamento Marcio Goncalves", subtitle: "Fitness - Goiania - GO - 2023", status: "Declined", cover: defaultCover("CTMG", "#1f1e1e", "#3a2823"), logoText: "MG", logoBg: "#f0e2d7", tags: ["Private Equity", "Declined", "Fitness", "Declinado", "Frio"], owner: "Arthur Bueno", accent: "#a04f22" },
  { name: "Manakai Goiania", subtitle: "Fitness - Goiania - GO - 2016", status: "Declined", cover: defaultCover("Manakai", "#13311f", "#1e4c31"), logoText: "MK", logoBg: "#ffffff", tags: ["Private Equity", "Declined", "Fitness", "Declinado", "Frio"], owner: "Arthur Bueno", accent: "#c69a2c" },
  { name: "EPIC", subtitle: "Startup - 2026", status: "Pipeline", cover: defaultCover("EPIC", "#ffffff", "#f5f5f5"), logoText: "EP", logoBg: "#ffffff", tags: ["Private Equity", "Pipeline", "Startup", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#f28f7b" },
  { name: "Verse Skincare", subtitle: "Cosmeticos - Goiania - GO - 2023", status: "Pipeline", cover: defaultCover("VERSE", "#ffffff", "#fafafa"), logoText: "VS", logoBg: "#ffffff", tags: ["Private Equity", "Pipeline", "Cosmeticos", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#f2a7c6" },
  { name: "YellotMob", subtitle: "Energia / Software - Goiania - GO - 2022", status: "Pipeline", cover: defaultCover("Yellot", "#ffffff", "#f8f7ff"), logoText: "YM", logoBg: "#ffffff", tags: ["Private Equity", "Pipeline", "Energia / Software", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#8bc34a" },
  { name: "Omni Internet", subtitle: "Telecom", status: "Portfolio", cover: defaultCover("omni", "#ffffff", "#fbfbfb"), logoText: "OI", logoBg: "#ffffff", tags: ["Private Equity", "Portfolio", "Telecom", "Investido", "Morno"], owner: "Arthur Bueno", accent: "#77d7ef" },
  { name: "Verde Brasil", subtitle: "Agro / Carbono - Rio Branco - AC - 2020", status: "Declined", cover: defaultCover("Verde", "#ffffff", "#f7fbf7"), logoText: "VB", logoBg: "#ffffff", tags: ["Private Equity", "Declined", "Agro / Carbono", "Declinado", "Morno"], owner: "Arthur Bueno", accent: "#7bc96f" },
  { name: "Formula CRM", subtitle: "Software - Caldas Novas - GO - 2024", status: "Portfolio", cover: defaultCover("Formula CRM", "#ffffff", "#f8fbff"), logoText: "FC", logoBg: "#ffffff", tags: ["Venture Capital", "Portfolio", "Software", "Investido", "Morno"], owner: "Arthur Bueno", accent: "#7b7de6" },
  { name: "UFC Jiu Jitsu", subtitle: "Fitness - Miami - Florida - 2025", status: "Portfolio", cover: defaultCover("UFC Jiu Jitsu", "#ffffff", "#fff8f5"), logoText: "UJ", logoBg: "#ffffff", tags: ["Private Equity", "Fitness", "Investido", "Morno"], owner: "Arthur Bueno", accent: "#ef5d4d" },
  { name: "UFC Gym & UFC Fit", subtitle: "Fitness - Miami - Florida - 2025", status: "LOI", cover: defaultCover("UFC FIT", "#ffffff", "#fff8f5"), logoText: "UG", logoBg: "#ffffff", tags: ["Private Equity", "LOI", "Fitness", "Nao investido", "Morno"], owner: "Arthur Bueno", accent: "#ef6e4d" },
  { name: "Fast Massagem", subtitle: "Franquias / Wellness - Goiania - GO - 2023", status: "Portfolio", cover: defaultCover("FAST", "#32472f", "#2e3f2f"), logoText: "FM", logoBg: "#ffffff", tags: ["Private Equity", "Due Diligence", "Franquias / Wellness", "Investido"], owner: "Arthur Bueno", accent: "#9c8b62" }
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

function memberColor(name) {
  const palette = ["#44406c", "#7d4b44", "#465b4d", "#774f4b", "#706247", "#446170", "#546146"];
  const value = String(name || "").split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[value % palette.length];
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
  const currentMembers = state?.workspaces?.[state.currentWorkspace]?.members || [];
  const currentPhotoMatch = currentMembers.find((member) => matchesName(member.name) && member.photo);
  if (currentPhotoMatch) return currentPhotoMatch;
  for (const workspace of Object.values(state?.workspaces || {})) {
    const members = workspace?.members || [];
    const match = members.find((member) => matchesName(member.name) && member.photo);
    if (match) return match;
  }
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
  return `<span class="${className}${!label ? " is-empty" : ""}">${photo ? `<img src="${photo}" alt="${escapeAttr(displayText(name || "Responsável"))}">` : label}</span>`;
}

function renderCompanyBadge({ name = "", logo = "", logoText = "", logoBg = "" } = {}) {
  const safeName = escapeAttr(displayText(name || "Empresa"));
  const fallback = logoText || initials(name || "");
  const transparentBg = logoBg && ["#ffffff", "#fff", "white", "transparent", "rgba(255,255,255,0)", "rgba(255, 255, 255, 0)"].includes(String(logoBg).trim().toLowerCase())
    ? "transparent"
    : (logoBg || "transparent");
  return `<span class="company-badge" style="background:${transparentBg}">${logo ? `<img src="${logo}" alt="${safeName}">` : fallback}</span>`;
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

function syncWorkspaceMemberOptions() {
  workspaceConfig[state.currentWorkspace].memberOptions = workspaceData().members.map((member) => member.name);
}

function applyDefaultMemberPhotos(rootState) {
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

function referenceStatusLabel(status, investmentStatus) {
  return investmentStatus === "Investido" ? "Investido" : status;
}

function referenceAccent(status, investmentStatus) {
  if (investmentStatus === "Investido") return "#77d7ef";
  return {
    Pipeline: "#c69a10",
    Declined: "#df8f86",
    LOI: "#7d5cf2",
    "Due Diligence": "#c4a26a",
    Frio: "#5d7ff0",
    Morno: "#c4a26a",
    Quente: "#ef7a69"
  }[status] || "#a0a6b4";
}

const ritoReferenceProjects = [
  { name: "Geral / Braslar", sector: "Eletrodomesticos / Linha branca", location: "Ponta Grossa - PR", year: "2026", status: "Lead", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 0, owner: "Arthur Bueno", tags: ["Private Equity", "Industria", "Fogoes", "Cooktops", "Linha branca"], cover: "https://braslareletros.com.br/wp-content/uploads/2025/01/banner-paginas.jpg", logoText: "GB", logo: "https://braslareletros.com.br/wp-content/uploads/2025/01/logo-stick-1.png", logoBg: "transparent", description: "Lead ligado a marca Geral, historicamente associada a fogoes e aquecedores e atualmente operada pela Braslar. A Braslar atua em fogoes e eletrodomesticos, com linha de fogoes de piso, cooktops, freezers e itens de refrigeração com distribuição nacional.", framework: "Industria / Eletrodomesticos / Lead inicial", origin: "Internet / Feira", priority: "Media", website: "https://braslareletros.com.br/", contact: "(42) 3220-5650", email: "contato@braslareletros.com.br", businessModel: "Fabricacao e comercializacao de fogoes, cooktops, freezers e eletrodomesticos com cobertura nacional, representantes comerciais e rede de assistencia tecnica.", advantages: "Marca tradicional, certificacao INMETRO, estrutura de representantes em todo o territorio nacional, flexibilidade produtiva para lojistas e sistema facilitado de fretes.", competitors: "Atlas, Esmaltec, Itatiaia, Mueller e fabricantes regionais de fogoes e cooktops.", managementTeam: "Braslar do Brasil Ltda", fundraisingHistory: "Nao foi identificado historico publico recente de captacao por equity ou divida.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 04.016.420/0001-17; sede na Av. Continental, s/n, Distrito Industrial, Ponta Grossa - PR; fundada em 2000." },
  { name: "Fox Graos", sector: "Startup / Trade de Graos", location: "Goias - GO", year: "2026", status: "Lead", investmentStatus: "Nao investido", temperature: "Quente", estimatedValue: 20000000, owner: "Arthur Bueno", tags: ["Private Equity", "Startup", "Trade", "Agro", "Base tecnologica"], cover: defaultCover("Fox Graos", "#f8f5ed", "#eef6e7"), logoText: "FG", logo: defaultLogo("FOX GRAOS", "#4f5f2a", "#ffffff", "Inter, Arial, sans-serif", 42, 800), logoBg: "#ffffff", description: "Startup de trade de graos em Goias. Compra e vende com apoio de sistema proprio que analisa frete, imposto, distancia e melhor preco. Operacao asset light, com base tecnologica e sem capex relevante.", framework: "Trade agro / Base tecnologica / Lead inicial", origin: "Relacionamento", priority: "Alta", businessModel: "Entra insumo e sai grao, com arbitragem comercial apoiada por tecnologia proprietaria.", managementTeam: "Donalvan", revenues: "2024: R$ 40MM | 2025: R$ 97MM", fundraisingHistory: "Busca R$ 20MM em equity; nao quer endividamento. Considerou FIDC como alternativa.", advantages: "Resultados instantaneos, base tecnologica, atuacao regional focada em Goias e estrutura sem capex.", competitors: "Tradings regionais de graos e plataformas de originacao com inteligencia de frete e imposto.", vcPeBacked: "Nao", notes: "EBITDA de 3%. Caixa de giro citado: R$ 2MM em 30 dias. Nao ha projeto formal estruturado neste momento." },
  { name: "Bioativos & Liofilizacao", sector: "Industria de Bioativos e Liofilizacao", location: "Sao Paulo - SP", year: "2026", status: "Lead", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 0, owner: "Arthur Bueno", tags: ["Private Equity", "Industria", "Bioativos", "Liofilizacao"], cover: defaultCover("Bioativos & Liofilizacao", "#f4fbef", "#e4f2ff"), logoText: "BL", logo: defaultLogo("BL", "#2f7a45", "#ffffff", "Georgia, 'Times New Roman', serif", 72, 700), logoBg: "#ffffff", description: "Projeto de sociedade na industria de bioativos e liofilizacao, com base operacional em Sao Paulo e potencial de aplicacao em ingredientes, nutraceuticos e manufatura especializada.", framework: "Bioativos / Industria especializada / Lead inicial", origin: "Relacionamento", priority: "Media", businessModel: "Nao identificado publicamente. A tese interna sugere manufatura especializada de bioativos, ingredientes e processos de liofilizacao.", managementTeam: "Nao identificado publicamente", competitors: "Nexira, Duas Rodas, fabricantes de ingredientes funcionais, CDMOs e operadores de liofilizacao para nutraceuticos e farma.", advantages: "Tese potencialmente ligada a alto valor agregado, barreiras tecnicas de processo e aplicacoes em nutraceuticos, ingredientes e formulacoes especializadas.", fundraisingHistory: "Nao identificado publicamente", vcPeBacked: "Nao identificado publicamente", notes: "Nao foi encontrada na internet, ate esta revisao, uma correspondencia publica inequivoca para o nome exato do projeto. Os campos foram preenchidos apenas com a tese interna e observacao de ausencia de rastro publico seguro." },
  { name: "Ibi Liv", sector: "Saude & Bem-estar", location: "Aparecida de Goiania - GO", year: "2025", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 4800000, owner: "Arthur Bueno", tags: ["Private Equity", "Saude & Bem-estar"], cover: defaultCover("Ibi Liv", "#f7f3f0", "#f0d7cc"), logoText: "IL", logo: defaultLogo("IL", "#9f6d2b", "#fff8f0", "Georgia, 'Times New Roman', serif", 74, 700), logoBg: "#f6ebdf", description: "Industria e comercio de suplementos, produtos a base de cafe e bebidas funcionais, com atuacao industrial e atacadista em Aparecida de Goiania.", website: "https://ibiliv.com", contact: "(62) 99174-0717", email: "natalia@ope.com.br", management: "Flavio Guimaraes Rocha; Theylor Angonese; RV7 Participacoes Ltda", managementTeam: "Flavio Guimaraes Rocha; Theylor Angonese; RV7 Participacoes Ltda", businessModel: "Fabricacao e distribuicao de suplementos, produtos a base de cafe, alimentos dieteticos e chas prontos para consumo.", competitors: "Growth Supplements, Max Titanium, Soldiers Nutrition e marcas de nutricao funcional.", advantages: "Portfolio combinado de cafe funcional e suplementacao, base industrial propria e combinacao de fabricacao com atacado.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 100 mil.", vcPeBacked: "Nao identificado publicamente", revenues: "Nao identificado publicamente", notes: "CNPJ 63.989.797/0001-11; aberta em 09/12/2025; sede no Polo Empresarial Goias - Etapa I, Aparecida de Goiania - GO; CNAEs incluem atacado de bebidas, produtos a base de cafe e alimentos dieteticos." },
  { name: "Centro de Treinamento Marcio Goncalves", sector: "Fitness", location: "Goiania - GO", year: "2023", status: "Declined", investmentStatus: "Nao investido", temperature: "Frio", estimatedValue: 3200000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness"], cover: defaultCover("CTMG", "#231f1f", "#41312c"), logoText: "MG", logo: defaultLogo("MG", "#b16f2f", "#f6ebe0", "Georgia, 'Times New Roman', serif", 72, 700), logoBg: "#f1e2d6", description: "Centro de treinamento fisico em Goiania com operacao voltada a condicionamento, eventos esportivos, artigos esportivos e varejo complementar.", contact: "(61) 98282-8239", email: "marciogoncalves.ct@gmail.com", businessModel: "Prestacao de servicos de condicionamento fisico com monetizacao complementar via eventos, artigos esportivos e varejo alimentar especializado.", managementTeam: "Marcio Vieira Goncalves", competitors: "Academias boutique, studios de treinamento funcional e redes fitness locais.", advantages: "Fundador-operador, nicho esportivo, operacao enxuta e receita complementar fora da mensalidade.", fundraisingHistory: "Nao foi identificado historico publico de captacao; capital social registrado de R$ 50 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 49.826.809/0001-66; aberta em 06/03/2023; sede na Rua da Redencao, Jardim Vitoria, Goiania - GO; atividade principal CNAE 93.13-1-00." },
  { name: "Manakai Goiania", sector: "Fitness", location: "Goiania - GO", year: "2016", status: "Declined", investmentStatus: "Nao investido", temperature: "Frio", estimatedValue: 2800000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness"], cover: defaultCover("Manakai", "#173724", "#274b35"), logoText: "MK", logo: defaultLogo("MK", "#202020", "#ffffff", "Georgia, 'Times New Roman', serif", 72, 700), logoBg: "#ffffff", description: "Arena fitness e esportiva em Goiania ligada a aulas, modalidades de areia e comunidade wellness, operada pela Manakai Sport Food.", website: "https://www.instagram.com/manakaioficial/", contact: "(62) 98122-8048", email: "manakaipraia@gmail.com", businessModel: "Monetizacao por ensino de esportes, uso de estrutura esportiva, eventos, alimentacao de apoio e ativacoes de comunidade.", managementTeam: "Felipe Antonio Fernandes Barbosa; Rafaela Vilela Machado Barbosa", competitors: "Arenas esportivas de areia, studios fitness boutique, beach tennis clubs e academias com proposta de comunidade.", advantages: "Marca local com comunidade ativa, multiplas unidades/filiais registradas e combinacao de esporte, lifestyle e consumo complementar.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 20 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 26.166.895/0001-22; aberta em 14/09/2016; matriz no Park Lozandes, Goiania - GO; ha registros publicos de filiais e de atuacao em ensino de esportes e condicionamento fisico." },
  { name: "EPIC", sector: "Imobiliario / Servicos", location: "Goiania - GO", year: "2025", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 3500000, owner: "Arthur Bueno", tags: ["Private Equity", "Imobiliario", "Servicos"], cover: defaultCover("EPIC", "#ffffff", "#f7f8ff"), logoText: "EP", logo: defaultLogo("EPIC", "#3f6ef3", "#ffffff", "Inter, Arial, sans-serif", 72, 800), logoBg: "#ffffff", description: "Empresa imobiliaria em Goiania com atuacao em corretagem, compra e venda, locacao e servicos complementares de real estate.", contact: "(34) 3183-6986", email: "Nao identificado publicamente", businessModel: "Corretagem na compra, venda e locacao de imoveis, com potencial de monetizacao por intermedicao, advisory e ativos proprios.", managementTeam: "ESG Solucoes Imobiliarias Ltda", competitors: "Imobiliarias e boutiques de real estate de Goiania, consultorias imobiliarias e brokers regionais.", advantages: "Capital social superior a operacoes muito iniciais, CNAEs complementares de compra, venda, aluguel e design de interiores.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 300 mil.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica mais aderente encontrada: Epic Real Estate, CNPJ 59.758.555/0001-40, aberta em 06/03/2025, sediada na Rua S1, 333, Setor Bela Vista, Goiania - GO." },
  { name: "Verse Skincare", sector: "Cosmeticos", location: "Goiania - GO", year: "2023", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 3900000, owner: "Arthur Bueno", tags: ["Private Equity", "Cosmeticos"], cover: "https://verseskincare.com.br/wp-content/uploads/2026/03/BANNER-HOME-FULL-SITE-CAMPANHA-DIA-DAS-MULHERES-VERSE.opti_.webp", logoText: "VS", logo: "https://verseskincare.com.br/wp-content/uploads/2025/07/logotipogrande-scaled.png", logoBg: "transparent", description: "Marca de skincare premium voltada a mulheres 40+, com proposta de combinar ciencia, tecnologia e autocuidado consciente em produtos de alta performance.", website: "https://verseskincare.com.br/", contact: "(62) 99937-0387", email: "contato@verseskincare.com.br", businessModel: "D2C digital em cosmeticos premium com venda online, comunidade proprietaria e foco em produto-hero de alto ticket e recorrencia.", managementTeam: "Bethania Simoes; Vanessa de Sa", competitors: "Adcos, Simple Organic, Sallve, Principia e marcas premium de skincare.", advantages: "Posicionamento claro para publico 40+, narrativa de marca forte, biopeptideos, nanotecnologia e prova social no produto principal.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional.", vcPeBacked: "Nao identificado publicamente", notes: "Operada por BS Comercio & Empreendimentos Ltda; endereco no Setor Oeste, Goiania - GO; produto principal exibido publicamente por R$ 359,00 na loja oficial." },
  { name: "YellotMob", sector: "Energia / Software", location: "Goiania - GO", year: "2022", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 5100000, owner: "Arthur Bueno", tags: ["Private Equity", "Energia / Software"], cover: "https://yellotmob.com.br/wp-content/uploads/2023/07/banner-home.jpg", logoText: "YM", logo: "https://yellotmob.com.br/wp-content/uploads/2023/07/yellomob.png", logoBg: "transparent", description: "Aplicativo e camada digital da Yellot para mobilidade eletrica, roteirizacao, recarga e monitoramento de uso em tempo real para usuarios de veiculos eletricos.", website: "https://yellotmob.com.br/", contact: "+55 (62) 3638-1006", email: "contato@yellot.com.br", businessModel: "Plataforma de software conectada ao ecossistema de energia renovavel e infraestrutura de recarga para veiculos eletricos.", managementTeam: "Yellot / Bouhid Brasil Engenharia Ltda", competitors: "Tupi Mobilidade, EZVolt, PlugShare e outras plataformas de recarga e discovery para mobilidade eletrica.", advantages: "Conexao com ecossistema energetico existente, app proprio, foco em autonomia do usuario e integracao com rede de abastecimento eletrico.", fundraisingHistory: "Nao foi identificado historico publico especifico da vertical YellotMob.", vcPeBacked: "Nao identificado publicamente", notes: "Aplicativo publicado no Google Play com mais de 10 mil downloads; sede da Yellot em Goiania no Ed. Flamboyant Park Business." },
  { name: "Omni Internet", sector: "Telecom", location: "Caldas Novas - GO", year: "2007", status: "Pipeline", investmentStatus: "Investido", investmentAmount: 3500000, temperature: "Morno", estimatedValue: 12000000, owner: "Arthur Bueno", tags: ["Private Equity", "Telecom"], cover: defaultCover("omni", "#ffffff", "#fbfbfb"), logoText: "OI", logo: defaultLogo("omni", "#6f49df", "#ffffff", "Inter, Arial, sans-serif", 68, 800), logoBg: "#ffffff", description: "Provedor regional de internet e telecom em Caldas Novas com base recorrente de assinantes e tese de consolidacao de fibra.", contact: "(64) 3513-9200", email: "contato@omni.net.br", businessModel: "Receita recorrente via servicos de comunicacao multimidia, acesso a internet e infraestrutura regional de conectividade.", managementTeam: "Omni Telecomunicacoes Ltda", competitors: "Provedores regionais de fibra, operadoras locais e ISPs com tese de consolidacao no Centro-Oeste.", advantages: "Base regional recorrente, pioneirismo local em fibra segundo listings publicos e tese de consolidacao de provedores menores.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 120 mil.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica mais aderente: Omni Telecomunicacoes Ltda, CNPJ 09.238.990/0001-75, aberta em 06/12/2007 em Caldas Novas - GO. Situacao cadastral publica recente apareceu como suspensa em cadastro empresarial; validar status operacional em diligencia.", progress: 100 },
  { name: "Verde Brasil", sector: "Agro / Carbono", location: "Rio Branco - AC", year: "2022", status: "Declined", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 4400000, owner: "Arthur Bueno", tags: ["Private Equity", "Agro / Carbono"], cover: "https://verdebrasil.com/wp-content/uploads/2024/03/Projeto-REDD-Tarauaca-VERDE-BRASIL_FLORA_CLEITON-LOPES_@cleiton-3-1-1024x529.png", logoText: "VB", logo: "https://verdebrasil.com/wp-content/uploads/2024/03/Logo-VB-completo.svg", logoBg: "transparent", description: "Empresa focada em preservacao florestal e creditos de carbono no Acre, com projeto REDD+ Tarauaca e tese de ativos ambientais.", website: "https://verdebrasil.com/", contact: "(68) 2102-3606", email: "contato@verdebrasil.com", businessModel: "Gestao de ativos ambientais e imobiliarios ligados a preservacao, desenvolvimento de projetos de credito de carbono e iniciativas socioambientais na Amazonia.", managementTeam: "Verde Brasil Sustentabilidade e Negocios Imobiliarios S.A.", competitors: "Moss Earth, Systemica, Carbonext e desenvolvedores de projetos REDD+ e ativos florestais no Brasil.", advantages: "Atuacao em area relevante no Acre, narrativa ESG clara, projeto REDD+ em andamento e capital social superior ao de operacoes muito iniciais.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 3,34 milhoes.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 47.132.346/0001-07; aberta em 13/07/2022; sede na Avenida Ceara, 3258, Rio Branco - AC; site publico informa atuacao no Acre e sul do Amazonas com o projeto REDD+ Tarauaca." },
  { name: "Formula CRM", sector: "Software", location: "Caldas Novas - GO", year: "2024", status: "Pipeline", investmentStatus: "Investido", investmentAmount: 2000000, temperature: "Morno", estimatedValue: 8600000, owner: "Arthur Bueno", tags: ["Venture Capital", "Software"], cover: "https://formulacrm.com.br/wp-content/uploads/2024/07/PAINEL-DE-ATENDIMENTO.webp", logoText: "FC", logo: "https://formulacrm.com.br/wp-content/uploads/2024/07/LOGO-PR-scaled.webp", logoBg: "transparent", description: "Plataforma de CRM e atendimento para WhatsApp com automacao, chatbot e inteligencia artificial para centralizar operacoes de atendimento e campanhas.", website: "https://formulacrm.com.br/", contact: "(64) 99201-8458", email: "hi@formulacrm.com.br", businessModel: "SaaS de atendimento e automacao comercial com receita recorrente, onboarding remoto e foco em canais conversacionais.", managementTeam: "Thiago Hernanne da Silva e Sousa; Daniel de Mendonca Silveira", competitors: "Kommo, RD Station CRM, PipeRun, HubSpot e plataformas de atendimento no WhatsApp.", advantages: "Proposta clara de centralizacao e automacao com IA, tese de reducao de custo de atendimento e base em canal de alta adocao no Brasil.", fundraisingHistory: "Nao foi identificado historico publico de captacao; capital social registrado de R$ 50 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 53.214.179/0001-46; aberta em 15/12/2023; CNAE principal 6202-3/00; sede em Caldas Novas - GO.", progress: 100 },
  { name: "UFC Jiu Jitsu", sector: "Fitness / Grappling", location: "Las Vegas - Nevada", year: "2025", status: "Pipeline", investmentStatus: "Investido", investmentAmount: 0, temperature: "Morno", estimatedValue: 6200000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness", "Grappling", "Investido"], cover: "https://ufc.com/images/styles/390x500_1/s3/2026-03/11505409162_BJJ7_TXT_ON_SALE_1920x1080_TEXTLESS.jpg", logoText: "UJ", logo: defaultLogo("UFC JIU JITSU", "#cb1d1d", "#ffffff", "Inter, Arial, sans-serif", 36, 800), logoBg: "transparent", description: "Vertical oficial de grappling da UFC, lancada em 2025 sob a marca UFC BJJ, com eventos, conteudo proprietario e potencial de expansao comercial da modalidade.", website: "https://www.ufc.com/ufcbjj", contact: "Nao identificado publicamente", email: "Nao identificado publicamente", businessModel: "Monetizacao por eventos, transmissao, conteudo, patrocinios e expansao de propriedade intelectual em submission grappling.", managementTeam: "UFC / TKO Group Holdings; Claudia Gadelha (estrategia e desenvolvimento de negocio do UFC BJJ)", competitors: "ADCC, IBJJF, ONE Championship grappling e promotores de submission grappling.", advantages: "Marca UFC, distribuicao global, capacidade de midia, propriedade intelectual forte e integracao com ecossistema de combate e entretenimento.", fundraisingHistory: "Nao aplicavel como vertical propria de grupo ja estabelecido; nao foi identificado processo publico de captacao separado para UFC BJJ.", vcPeBacked: "Pertence ao ecossistema UFC / TKO, nao a uma startup independente", notes: "Referencia publica usada: lancamento oficial do UFC BJJ em 2025 e pagina institucional da vertical. A localizacao foi ajustada para Las Vegas pelo polo operacional do UFC BJJ no UFC APEX, nao Miami." },
  { name: "UFC Gym & UFC Fit", sector: "Fitness", location: "Miami - Florida", year: "2025", status: "LOI", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 7400000, owner: "Arthur Bueno", tags: ["Private Equity", "Fitness"], cover: "https://www.ufcgym.com/images/homepage/Ufc_Gym.webp", logoText: "UG", logo: "https://www.ufcgym.com/images/ufc-gym-logo-black.svg", logoBg: "transparent", description: "Tese ligada a rede global UFC GYM / UFC FIT, plataforma de academias e fitness inspirado em artes marciais com mais de 150 unidades em dezenas de paises.", website: "https://www.ufcgym.com/", contact: "+1 (305) 680-5990", email: "nush.chalmers@ufcgym.com", businessModel: "Rede fitness com mensalidade recorrente, personal training, lutas, recuperacao, retail e servicos premium em diferentes formatos de clube.", managementTeam: "UFC GYM corporate team", competitors: "LA Fitness, Orangetheory, Equinox, Crunch, studios boutique e academias MMA-inspired.", advantages: "Marca global forte, modelo multiformato, combinacao de fitness, artes marciais, recovery e personal training, presenca internacional e capacidade de franquia.", fundraisingHistory: "Nao foi identificado historico publico de captacao recente especifico desta unidade/tese; a rede comunica expansao internacional e mais de 150 localizacoes.", vcPeBacked: "Nao identificado publicamente", notes: "Fonte publica oficial usada como referencia: unidade Kendall Miami; amenidades incluem bag room, BJJ, personal training, turf e recovery." },
  { name: "Fast Massagem", sector: "Franquias / Wellness", location: "Goiania - GO", year: "2023", status: "Due Diligence", investmentStatus: "Investido", investmentAmount: 1500000, temperature: "Morno", estimatedValue: 9500000, owner: "Arthur Bueno", tags: ["Private Equity", "Franquias / Wellness"], cover: "https://www.fastmassagem.com.br/wp-content/uploads/2024/05/thumb.png", logoText: "FM", logo: "https://www.fastmassagem.com.br/wp-content/uploads/2024/05/logo-scaled-1-2048x742.webp", logoBg: "transparent", description: "Rede de massagem estetica e bem-estar com operacao sem hora marcada, protocolos proprios e tese de expansao via franquias.", website: "https://www.fastmassagem.com.br/", contact: "(62) 99663-1244", email: "contato@fastmassagem.com.br", businessModel: "Rede de servicos de bem-estar com monetizacao em sessoes avulsas, pacotes, home care e franquias em diferentes formatos.", managementTeam: "Maira Moraes; Eduardo Pacheco", competitors: "Sorriso, spas urbanos, redes de estetica e franquias de massagem e drenagem.", advantages: "Modelo sem hora marcada, marca propria de produtos, suporte de franqueadora, forte componente comercial e tese asset-light de expansao.", fundraisingHistory: "Franquia anuncia investimento inicial a partir de R$ 99 mil e materiais publicos citam faturamento alvo anual de ate R$ 2,4 milhoes por unidade, margem de 30% a 35% e payback entre 12 e 18 meses.", vcPeBacked: "Nao identificado publicamente", notes: "Operacao publica em Goiania; paginas de franquia citam mais de 12 unidades e expansao acelerada.", progress: 60 },
  { name: "Enebra Energia", sector: "Energia", location: "Anapolis - GO", year: "2019", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 5400000, owner: "Arthur Bueno", tags: ["Private Equity", "Energia"], cover: "https://enebra.com.br/wp-content/uploads/2022/02/forest-trees-5073.png", logoText: "EN", logo: "https://enebra.com.br/wp-content/uploads/2021/12/logo-enebra-copy-4.png", logoBg: "transparent", description: "Fornecedor verticalizado de biomassa de eucalipto, lenha e cavaco, com operacao em plantio, colheita, processamento, transporte e estocagem para clientes industriais.", website: "https://enebra.com.br/", contact: "(62) 3702-7492", email: "administrativo@enebra.com.br", businessModel: "Fornecimento de biomassa e servicos florestais full service, com contratos industriais e operacao verticalizada em florestas proprias ou terceirizadas.", managementTeam: "Enebra Brasil Energia", competitors: "Fornecedores regionais de biomassa, lenha industrial, cavaco e operadores florestais integrados.", advantages: "Estrutura verticalizada, legalidade auditada, operacao ESG, capacidade propria de colheita, transporte e abastecimento continuo de clientes.", fundraisingHistory: "Nao foi identificado historico publico recente de captacao institucional.", vcPeBacked: "Nao identificado publicamente", notes: "Site institucional destaca unidades em Goias, Mato Grosso e Mato Grosso do Sul; foco em biomassa para industrias e projetos build-to-suit." },
  { name: "Caseratto", sector: "Food & Beverage", location: "Goiania - GO", year: "2015", status: "Declined", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 2600000, owner: "Arthur Bueno", tags: ["Private Equity", "Food & Beverage"], cover: defaultCover("Caseratto", "#ffffff", "#fff8f2"), logoText: "CS", logo: defaultLogo("CASERATTO", "#8a4a2d", "#ffffff", "Inter, Arial, sans-serif", 42, 700), logoBg: "#ffffff", description: "Operacao de gastronomia em Goiania ligada a restaurante, producao alimentar e expansao local por filiais.", contact: "(62) 3241-4070", email: "Nao identificado publicamente", businessModel: "Receita de restaurante e alimentacao com possibilidade de extensao para producao propria, eventos e desdobramentos de marca local.", managementTeam: "Rafael Damaso Mendonca; Tales Garcia Araujo", competitors: "Restaurantes premium de Goiania, operacoes autorais locais e grupos de food service regionais.", advantages: "Marca local conhecida, estrutura societaria ativa, historico com matriz e filial e operacao centrada em bairro de alta renda.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 50 mil.", vcPeBacked: "Nao identificado publicamente", notes: "CNPJ 22.068.490/0001-09; aberta em 16/03/2015 no Setor Marista, Goiania - GO; atividade principal de restaurantes e similares." },
  { name: "Winsford", sector: "Educacao", location: "Goiania - GO", year: "2021", status: "Declined", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 2300000, owner: "Arthur Bueno", tags: ["Private Equity", "Educacao"], cover: defaultCover("Winsford", "#ffffff", "#fbfaf7"), logoText: "WF", logo: defaultLogo("WINSFORD", "#7a6f37", "#ffffff", "Inter, Arial, sans-serif", 42, 700), logoBg: "#ffffff", description: "Escola particular em Goiania com oferta de educacao infantil, ensino fundamental, medio e idiomas, sob a marca Winsford Global Education.", contact: "(62) 4101-9388", email: "Nao identificado publicamente", businessModel: "Receita educacional recorrente com mensalidades escolares e servicos complementares de idiomas, cantina e materiais.", managementTeam: "Roberto Wagner de Abreu Santana; Queluz Holding Investimentos e Participacoes Ltda; J.B.C. Holding e Investimentos Ltda", competitors: "Escolas particulares premium de Goiania, colegios bilingues e operacoes K-12 focadas em classe media-alta.", advantages: "Capital social relevante para a fase, oferta escolar ampla, endereco premium no Setor Marista e possibilidade de captura de lifetime value de educacao basica completa.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado publicamente entre R$ 110 mil e R$ 1,47 milhao conforme bases cadastrais distintas.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica usada: Winsford Goiania Educacao Ltda, CNPJ 42.136.439/0001-96, aberta em 29/05/2021, com nome fantasia Winsford Global Education." },
  { name: "Complete Bari", sector: "Nutricao", location: "Santana de Parnaiba - SP", year: "2022", status: "Declined", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 2100000, owner: "Arthur Bueno", tags: ["Private Equity", "Nutricao"], cover: "https://completebari.com.br/cdn/shop/files/10_DESK_3X_bfd49e8b-863f-4d82-b4bd-ba69e625e2da.png", logoText: "CB", logo: "https://completebari.com.br/cdn/shop/files/logo_02_copiar_5.png", logoBg: "transparent", description: "Marca digital focada em suplementacao para pacientes bariatricos, com portfolio de multivitaminicos, creatina em gummies, fibras e assinaturas recorrentes.", website: "https://completebari.com.br/", businessModel: "E-commerce D2C de nutricao especializada com ticket recorrente, clube de assinatura e catalogo dedicado ao pos-cirurgico bariatrico.", managementTeam: "Complete Bari", competitors: "Bariatric Advantage, FitForMe e marcas locais de suplementacao pos-bariatrica.", advantages: "Nicho muito especifico, proposta clara de valor para bariatricos, recorrencia via assinatura e provas publicas de adesao de base.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional.", vcPeBacked: "Nao identificado publicamente", notes: "Site oficial comunica base superior a 50 mil bariatricos atendidos, 93% de recomendacao e oferta de planos de assinatura com recorrencia." },
  { name: "Pop Move", sector: "Mobilidade", location: "Santo Andre - SP", year: "2022", status: "Pipeline", investmentStatus: "Nao investido", temperature: "Morno", estimatedValue: 3100000, owner: "Arthur Bueno", tags: ["Private Equity", "Mobilidade"], cover: defaultCover("Pop Move", "#eef5ff", "#dcecff"), logoText: "PM", logo: defaultLogo("POP MOVE", "#1f4db8", "#ffffff", "Inter, Arial, sans-serif", 48, 800), logoBg: "#ffffff", description: "Empresa de tecnologia e intermedicao de servicos sob a marca Pop Move, com tese ligada a mobilidade e integracao operacional.", website: "Nao identificado publicamente", contact: "Nao identificado publicamente", email: "Nao identificado publicamente", businessModel: "Intermediacao e agenciamento de servicos e negocios com camada tecnologica, incluindo software, suporte tecnico e servicos de informacao na internet.", managementTeam: "Matheus Junior dos Santos Filho; Wanderley Henrique Batista Filho; Cristiano Ayres de Jesus; Murilo da Silva Santos", competitors: "Plataformas de intermedicao e mobilidade urbana, marketplaces de servicos e operadores asset-light com tese B2B2C.", advantages: "Estrutura leve, natureza tecnologica, CNPJ ativo e tese potencial de escala sem necessidade de ativos fisicos pesados.", fundraisingHistory: "Nao foi identificado historico publico de captacao institucional; capital social registrado de R$ 100 mil.", vcPeBacked: "Nao identificado publicamente", notes: "Correspondencia publica mais aderente: Pop Move do Brasil Tecnologia Ltda, CNPJ 45.755.297/0001-33, aberta em 23/03/2022 em Santo Andre - SP. Nao foi encontrada na internet uma prova publica inequivoca de operacao em Goiania ou um site oficial inequivoco associado a esta razao social." }
];

function referenceProjectToCRMItem(project) {
  const subtitle = ritoSubtitle(project.sector, project.location, project.year);
  const investmentStatus = project.investmentStatus || "Nao investido";
  const temperature = project.temperature || "Morno";
  const statusLabel = referenceStatusLabel(project.status, investmentStatus);
  return {
    id: uid("deal"),
    name: project.name,
    logo: project.logo || "",
    logoText: project.logoText || "",
    logoBg: project.logoBg || "#ffffff",
    cover: project.cover,
    description: project.description || "",
    sector: project.sector || "",
    location: project.location || "",
    year: project.year || "",
    status: project.status,
    subtitle,
    tags: [...new Set([...(project.tags || []), statusLabel, investmentStatus === "Investido" ? "Investido" : "Nao investido", temperature])],
    owner: project.owner || "Arthur Bueno",
    estimatedValue: project.estimatedValue || 0,
    investmentAmount: project.investmentAmount || 0,
    framework: project.framework || `${project.sector || "Projeto"} / Thesis / Diligence`,
    progress: project.progress !== undefined ? project.progress : investmentStatus === "Investido" ? 100 : project.status === "Due Diligence" ? 60 : project.status === "LOI" ? 72 : project.status === "Pipeline" ? 35 : 18,
    temperature,
    investmentStatus,
    priority: project.priority || "Media",
    origin: project.origin || "Inbound",
    website: project.website || "",
    mainContact: project.contact || "",
    email: project.email || "",
    closeDate: project.closeDate || "",
    founders: project.management || "",
    management: project.management || "",
    businessModel: project.businessModel || "",
    competitors: project.competitors || "",
    advantages: project.advantages || "",
    createdAt: "2026-03-16",
    updatedAt: "2026-03-16",
    frameworkDetails: {
      tese: "",
      opportunity: "",
      risks: "",
      nextSteps: "",
      diligence: project.status,
      strategicNotes: ""
    },
    history: [{ at: "17/03/2026 09:00", text: "Projeto carregado na base do CRM" }]
  };
}

function buildRitoReferenceCRMItems() {
  return ritoReferenceProjects.map(referenceProjectToCRMItem);
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

function ritoTask(title, stage, owner, marker, notes = "") {
  return {
    id: uid("task"),
    title,
    description: [notes, marker ? `Prazo: ${marker}` : ""].filter(Boolean).join(" - "),
    stage,
    owner: ritoTaskOwner(owner),
    dueDate: "",
    priority: ritoTaskPriority(marker),
    status: "A fazer",
    tags: [stage, marker].filter(Boolean)
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
    id: uid("task"),
    title,
    description: [rawStatus, note].filter(Boolean).join(" - "),
    stage,
    owner: ritoTaskOwner(owner),
    dueDate: "",
    priority,
    status: ritoWorkflowStatus(rawStatus),
    tags: [stage, rawStatus].filter(Boolean)
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

function fastTask(title, stage, owner, rawStatus, note = "", priority = "Media") {
  return {
    id: uid("task"),
    title,
    description: [rawStatus, note].filter(Boolean).join(" - "),
    stage,
    owner,
    dueDate: "",
    priority,
    status: fastWorkflowStatus(rawStatus),
    tags: [stage, rawStatus].filter(Boolean)
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

function crmItemToReferenceCard(item) {
  ensureProjectShape(item);
  return {
    id: item.id,
    name: item.name,
    subtitle: item.subtitle || ritoSubtitle(item.sector, item.location, item.year),
    status: referenceStatusLabel(item.status, item.investmentStatus),
    cover: item.cover,
    logoText: item.logoText || initials(item.name),
    logo: item.logo || "",
    logoBg: item.logoBg || "#ffffff",
    tags: [...new Set([...(item.tags || []).filter((tag) => !["Pipeline", "Portfolio", "Investido", "Declined", "LOI", "Due Diligence", "Frio", "Morno", "Quente", "Nao investido"].includes(tag)), referenceStatusLabel(item.status, item.investmentStatus), item.investmentStatus === "Investido" ? "Investido" : "Nao investido", item.temperature])],
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
  const legacySeedNames = new Set(["pulse fitness club", "dermavita clinics", "amazoo pets"]);
  rito.crmItems = (rito.crmItems || []).filter((item) => !legacySeedNames.has(String(item.name || "").toLowerCase()));
  const seededItems = buildRitoReferenceCRMItems();
  const existingByName = new Map((rito.crmItems || []).map((item) => [item.name.toLowerCase(), item]));
  seededItems.forEach((seeded) => {
    const existing = existingByName.get(seeded.name.toLowerCase());
    if (existing) {
      if (!existing.cover || isGeneratedImageAsset(existing.cover)) existing.cover = seeded.cover;
      if (!existing.logo || isGeneratedImageAsset(existing.logo)) existing.logo = seeded.logo;
      existing.logoText = existing.logoText || seeded.logoText;
      if (!existing.logoBg || isGeneratedImageAsset(existing.logo) || existing.logo === seeded.logo) {
        existing.logoBg = seeded.logoBg || "transparent";
      }
      existing.subtitle = existing.subtitle || seeded.subtitle;
      existing.description = existing.description || seeded.description;
      existing.sector = existing.sector || seeded.sector;
      existing.location = existing.location || seeded.location;
      existing.year = existing.year || seeded.year;
      existing.owner = existing.owner || seeded.owner;
      existing.estimatedValue = existing.estimatedValue || seeded.estimatedValue;
      existing.investmentAmount = existing.investmentAmount || seeded.investmentAmount || 0;
      existing.temperature = existing.temperature || seeded.temperature;
      existing.investmentStatus = existing.investmentStatus || seeded.investmentStatus;
      existing.tags = [...new Set([...(existing.tags || []), ...seeded.tags])];
      if (existing.name === "UFC Jiu Jitsu") {
        existing.investmentStatus = "Investido";
        syncInvestmentTag(existing);
      }
      ensureProjectShape(existing);
      if (existing.investmentStatus === "Investido" && !rito.projectBoards[existing.name]) {
        rito.projectBoards[existing.name] = [];
      }
      return;
    }
    rito.crmItems.unshift(seeded);
    if (seeded.investmentStatus === "Investido" && !rito.projectBoards[seeded.name]) {
      rito.projectBoards[seeded.name] = [];
    }
  });
  const popIndex = rito.crmItems.findIndex((item) => item.name === "Pop Move");
  const braslarIndex = rito.crmItems.findIndex((item) => item.name === "Geral / Braslar");
  if (popIndex > -1 && braslarIndex > -1 && popIndex > braslarIndex) {
    const [popMove] = rito.crmItems.splice(popIndex, 1);
    rito.crmItems.splice(braslarIndex, 0, popMove);
  }
}

function migrateRitoKanbanTasks(rootState) {
  const rito = rootState.workspaces?.rito;
  if (!rito) return;

  const seededTasks = buildRitoKanbanTasks();
  const currentTasks = Array.isArray(rito.taskItems) ? rito.taskItems : [];
  const legacyTitles = new Set([
    "Preparar teaser Ibi Liv",
    "Atualizar data room Fast Massagem",
    "Revisar memorando Omni Internet"
  ]);
  const hasLegacyOnly =
    currentTasks.length > 0 &&
    currentTasks.length <= 3 &&
    currentTasks.every((task) => legacyTitles.has(String(task.title || "")));
  const hasSeededRitoKanban =
    currentTasks.some((task) => String(task.title || "") === "Configurar CRM Attio (conta, campos e pipeline)") &&
    currentTasks.some((task) => String(task.title || "") === "Criar LP Deck");

  if (!currentTasks.length || hasLegacyOnly || !hasSeededRitoKanban) {
    rito.taskItems = seededTasks;
  } else {
    const existingTitles = new Set(currentTasks.map((task) => String(task.title || "").trim().toLowerCase()));
    seededTasks.forEach((task) => {
      if (!existingTitles.has(String(task.title || "").trim().toLowerCase())) rito.taskItems.push(task);
    });
  }

  rito.taskThemes = [...DEFAULT_TASK_THEMES.rito];
}

function migrateFastWorkspace(rootState) {
  const fast = rootState.workspaces?.fast;
  if (!fast) return;

  const seededTasks = buildFastTaskItems();
  const currentTasks = Array.isArray(fast.taskItems) ? fast.taskItems : [];
  const hasLegacyFastSeed =
    currentTasks.some((task) => String(task.stage || "") === "Marketing & Marca") ||
    currentTasks.some((task) => String(task.stage || "") === "Operacao") ||
    currentTasks.some((task) => String(task.title || "") === "Definir ponto focal para liderar projetos, eventos e ativacoes da marca");

  const hasNewFastSeed =
    currentTasks.some((task) => String(task.title || "") === "Buscar parceria com a LoungeKey") &&
    currentTasks.some((task) => String(task.title || "") === "Buscar renegociacao dos debitos com a Guirre e pedido a vista");

  if (!currentTasks.length || hasLegacyFastSeed || !hasNewFastSeed) {
    fast.taskItems = seededTasks;
  } else {
    const existingTitles = new Set(currentTasks.map((task) => String(task.title || "").toLowerCase()));
    seededTasks.forEach((task) => {
      if (!existingTitles.has(task.title.toLowerCase())) fast.taskItems.push(task);
    });
  }

  fast.taskThemes = [...DEFAULT_TASK_THEMES.fast];
  fast.members = fast.members || [];
  ["Bruna Cristina", "Arthur Bueno", "Ciro Ribeiro", "Mayra", "Eduardo", "Rodrigo", "Grace"].forEach((name) => {
    if (!fast.members.some((member) => member.name === name)) {
      fast.members.push({ name, role: name === "Grace" ? "Marketing" : name === "Mayra" ? "Operacoes" : name === "Eduardo" ? "Operacoes" : name === "Rodrigo" ? "Operacoes" : name === "Arthur Bueno" ? "CEO" : name === "Ciro Ribeiro" ? "Socio" : "Financeiro", photo: defaultMemberPhoto(name) });
    }
  });
}

function seedData() {
  return {
    theme: "light",
    workspaceOrder: ["rito", "atica", "fast"],
    currentWorkspace: "rito",
    currentView: {
      rito: "dashboard",
      atica: "dashboard",
      fast: "dashboard"
    },
    selectedProjectId: {
      rito: "",
      atica: "",
      fast: ""
    },
    projectReturnView: {
      rito: "crm",
      atica: "crm",
      fast: "dashboard"
    },
    dashboardFilters: {
      rito: { stage: "Todos", temp: "Todos", query: "" },
      atica: { stage: "Todos", temp: "Todos", query: "" },
      fast: { stage: "Todos", temp: "Todos", query: "" }
    },
    pipelineFilters: {
      rito: { temp: "Todos", query: "" },
      atica: { temp: "Todos", query: "" },
      fast: { temp: "Todos", query: "" }
    },
    referenceViewModes: {
      rito: { crm: "cards", invested: "cards" },
      atica: { crm: "cards", invested: "cards" },
      fast: { crm: "cards", invested: "cards" }
    },
    workspaces: {
      rito: {
        crmItems: buildRitoReferenceCRMItems(),
        taskItems: buildRitoKanbanTasks(),
        taskThemes: [...DEFAULT_TASK_THEMES.rito],
        projectThemes: [...DEFAULT_PROJECT_THEMES.rito],
        projectBoards: {
          "Omni Internet": [
            { id: uid("proj"), title: "Mapear playbook comercial", stage: "Comercial", owner: "Arthur Bueno", dueDate: "2026-03-24", priority: "Alta", status: "A fazer", tags: ["Comercial"] },
            { id: uid("proj"), title: "Revisar KPIs operacionais", stage: "Operacao", owner: "Gabriela Reis", dueDate: "2026-03-21", priority: "Media", status: "Em andamento", tags: ["Ops"] }
          ],
          "Formula CRM": [],
          "Fast Massagem": []
        },
        documents: [
          { id: uid("doc"), name: "SPA - Omni Internet.pdf", category: "Juridico", linkedTo: "Omni Internet", fileData: "", fileType: "application/pdf", uploadedAt: "2026-03-10" },
          { id: uid("doc"), name: "Modelo Financeiro Fast Massagem.xlsx", category: "Financeiro", linkedTo: "Fast Massagem", fileData: "", fileType: "application/vnd.ms-excel", uploadedAt: "2026-03-14" }
        ],
        members: [
          { name: "Bruna Cristina", role: "Sell Side", photo: "" },
          { name: "Arthur Bueno", role: "CEO", photo: ARTHUR_BUENO_PHOTO },
          { name: "Ciro Ribeiro", role: "Socio", photo: "" },
          { name: "Gabriela Reis", role: "Sell Side", photo: "" }
        ]
      },
      atica: {
        crmItems: [
          {
            id: uid("deal"),
            name: "Atica Advisory Prime",
            logo: "",
            cover: defaultCover("Atica", "#3a1c71", "#d76d77"),
            description: "Mandato consultivo com foco em performance financeira e governanca.",
            sector: "Consultoria",
            location: "Goiania - GO",
            year: "2026",
            status: "Pipeline",
            tags: ["Pipeline", "B2B", "Investido"],
            owner: "Bruna Cristina",
            estimatedValue: 2800000,
            framework: "CFO as a Service / Governance / Growth",
            progress: 74
          }
        ],
        taskItems: [
          { id: uid("task"), title: "Atualizar cronograma financeiro", stage: "A fazer", owner: "Ciro Ribeiro", dueDate: "2026-03-22", priority: "Media", status: "A fazer", tags: ["Financeiro"] },
          { id: uid("task"), title: "Consolidar OKRs internos", stage: "Em andamento", owner: "Arthur Bueno", dueDate: "2026-03-19", priority: "Alta", status: "Em andamento", tags: ["Gestao"] }
        ],
        taskThemes: [...DEFAULT_TASK_THEMES.atica],
        projectThemes: [...DEFAULT_PROJECT_THEMES.atica],
        projectBoards: {
          "Atica Advisory Prime": [
            { id: uid("proj"), title: "Revisar estrutura de reporting", stage: "A fazer", owner: "Bruna Cristina", dueDate: "2026-03-25", priority: "Media", status: "A fazer", tags: ["Reporting"] }
          ]
        },
        documents: [
          { id: uid("doc"), name: "Template de governanca.pdf", category: "Comercial", linkedTo: "Atica Advisory Prime", fileData: "", fileType: "application/pdf", uploadedAt: "2026-03-09" }
        ],
        members: [
          { name: "Bruna Cristina", role: "Sell Side", photo: "" },
          { name: "Arthur Bueno", role: "CEO", photo: ARTHUR_BUENO_PHOTO },
          { name: "Ciro Ribeiro", role: "Socio", photo: "" },
          { name: "Gabriela Reis", role: "Sell Side", photo: "" }
        ]
      },
      fast: {
        taskThemes: [...DEFAULT_TASK_THEMES.fast],
        projectThemes: [...DEFAULT_PROJECT_THEMES.fast],
        taskItems: buildFastTaskItems(),
        documents: [],
        members: [
          { name: "Bruna Cristina", role: "Sell Side", photo: "" },
          { name: "Arthur Bueno", role: "CEO", photo: ARTHUR_BUENO_PHOTO },
          { name: "Ciro Ribeiro", role: "Socio", photo: "" },
          { name: "Gabriela Reis", role: "Sell Side", photo: "" },
          { name: "Mayra", role: "Operacao", photo: "" },
          { name: "Eduardo", role: "Operacao", photo: "" },
          { name: "Rodrigo", role: "Operacao", photo: "" },
          { name: "Grace", role: "Marketing", photo: "" }
        ]
      }
    }
  };
}

let state = seedData();
applyDefaultMemberPhotos(state);

async function loadState() {
  const localState = loadStateFromLocalCache();
  try {
    const { data, error } = await supabaseClient
      .from("shared_portal_state")
      .select("id, data, updated_at")
      .eq("id", 1)
      .single();

    if (error) throw error;

    const remoteState = data?.data && Object.keys(data.data).length ? data.data : null;
    const parsed = chooseMoreRecentState(localState, remoteState, data?.updated_at);
    if (!parsed) {
      const seeded = seedData();
      seeded.lastSavedAt = new Date().toISOString();
      applyDefaultMemberPhotos(seeded);
      cacheStateLocally(seeded);
      return seeded;
    }

    const base = seedData();
    const merged = { ...base, ...parsed };

    merged.referenceViewModes = {
      ...base.referenceViewModes,
      ...(parsed.referenceViewModes || {})
    };

    Object.keys(base.referenceViewModes).forEach((workspace) => {
      merged.referenceViewModes[workspace] = {
        ...base.referenceViewModes[workspace],
        ...((parsed.referenceViewModes || {})[workspace] || {})
      };
    });

    migrateRitoReferenceProjects(merged);
    migrateRitoKanbanTasks(merged);
    migrateFastWorkspace(merged);
    applyDefaultMemberPhotos(merged);
    cacheStateLocally(merged);

    return merged;
  } catch (error) {
    console.error("Falha ao carregar dados do banco", error);
    if (localState) {
      const base = seedData();
      const merged = { ...base, ...localState };
      merged.referenceViewModes = {
        ...base.referenceViewModes,
        ...(localState.referenceViewModes || {})
      };
      Object.keys(base.referenceViewModes).forEach((workspace) => {
        merged.referenceViewModes[workspace] = {
          ...base.referenceViewModes[workspace],
          ...((localState.referenceViewModes || {})[workspace] || {})
        };
      });
      migrateRitoReferenceProjects(merged);
      migrateRitoKanbanTasks(merged);
      migrateFastWorkspace(merged);
      applyDefaultMemberPhotos(merged);
      cacheStateLocally(merged);
      return merged;
    }
    const seeded = seedData();
    seeded.lastSavedAt = new Date().toISOString();
    applyDefaultMemberPhotos(seeded);
    cacheStateLocally(seeded);
    return seeded;
  }
}

function saveState() {
  state.lastSavedAt = new Date().toISOString();
  cacheStateLocally(state);
  scheduleSave();
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

function inferThemeFromTask(task, themes) {
  const haystack = [task.title, task.owner, ...(task.tags || [])].join(" ").toLowerCase();
  const matched = themes.find((theme) => {
    const tokens = theme.toLowerCase().split(/[\s/]+/).filter(Boolean);
    return tokens.some((token) => token.length > 2 && haystack.includes(token));
  });
  return matched || themes[0] || "Geral";
}

function normalizeKanbanTask(task, themes) {
  if (!task.stage || !themes.includes(task.stage)) {
    task.stage = inferThemeFromTask(task, themes);
  }
  if (!task.status) task.status = "A Fazer";
  if (!task.priority) task.priority = "Media";
  if (!task.tags) task.tags = [];
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

function displayText(value) {
  return String(value || "")
    .replaceAll("Atica", "Ática")
    .replaceAll("Gestao", "Gestão")
    .replaceAll("gestao", "gestão")
    .replaceAll("Portfolio", "Portfólio")
    .replaceAll("Operacao", "Operação")
    .replaceAll("operacao", "operação")
    .replaceAll("Operacoes", "Operações")
    .replaceAll("operacoes", "operações")
    .replaceAll("Expansao", "Expansão")
    .replaceAll("expansao", "expansão")
    .replaceAll("Calendario", "Calendário")
    .replaceAll("Configuracoes", "Configurações")
    .replaceAll("Descricao", "Descrição")
    .replaceAll("descricao", "descrição")
    .replaceAll("Subtitulo", "Subtítulo")
    .replaceAll("Titulo", "Título")
    .replaceAll("titulo", "título")
    .replaceAll("Localizacao", "Localização")
    .replaceAll("localizacao", "localização")
    .replaceAll("Responsavel", "Responsável")
    .replaceAll("responsavel", "responsável")
    .replaceAll("Juridico", "Jurídico")
    .replaceAll("Estrategico", "Estratégico")
    .replaceAll("Governanca", "Governança")
    .replaceAll("Revisao", "Revisão")
    .replaceAll("Concluido", "Concluído")
    .replaceAll("Concluidos", "Concluídos")
    .replaceAll("Historico", "Histórico")
    .replaceAll("Informacoes", "Informações")
    .replaceAll("Negocio", "Negócio")
    .replaceAll("Observacoes", "Observações")
    .replaceAll("Projecao", "Projeção")
    .replaceAll("Nao", "Não")
    .replaceAll("nao", "não")
    .replaceAll("Media", "Média")
    .replaceAll("media", "média")
    .replaceAll("Goiania", "Goiânia")
    .replaceAll("Goias", "Goiás")
    .replaceAll("Cosmeticos", "Cosméticos")
    .replaceAll("Educacao", "Educação")
    .replaceAll("Nutricao", "Nutrição")
    .replaceAll("Graos", "Grãos")
    .replaceAll("graos", "grãos")
    .replaceAll("Liofilizacao", "Liofilização")
    .replaceAll("Saude", "Saúde")
    .replaceAll("saude", "saúde")
    .replaceAll("serao", "serão")
    .replaceAll("Orcar", "Orçar")
    .replaceAll("orcar", "orçar")
    .replaceAll("estagiario", "estagiário")
    .replaceAll("funcionarias", "funcionárias")
    .replaceAll("grafico", "gráfico")
    .replaceAll("regiao", "região")
    .replaceAll("oleos", "óleos")
    .replaceAll("maquina", "máquina")
    .replaceAll("automatico", "automático")
    .replaceAll("bancarias", "bancárias")
    .replaceAll("diario", "diário")
    .replaceAll("posicao", "posição")
    .replaceAll("transacao", "transação")
    .replaceAll("logistica", "logística")
    .replaceAll("Criticas", "Críticas")
    .replaceAll("criticas", "críticas")
    .replaceAll("rapido", "rápido")
    .replaceAll("sensiveis", "sensíveis")
    .replaceAll("concluidas", "concluídas");
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

function prioritizedRitoPipelineItems(items = []) {
  return [...(items || [])];
}

function investedProjects(items) {
  return (items || []).filter((item) => item.investmentStatus === "Investido" || (item.tags || []).includes("Investido"));
}

function projectAllocationValue(item) {
  return Number(item?.investmentAmount || 0);
}

function allocatedPortfolioValue(items = workspaceData().crmItems || []) {
  return (items || [])
    .filter((item) => item.investmentStatus === "Investido" || (item.tags || []).includes("Investido"))
    .reduce((sum, item) => sum + projectAllocationValue(item), 0);
}

function projectedAllocationValue(items = workspaceData().crmItems || []) {
  return (items || [])
    .filter((item) => item.investmentStatus !== "Investido" && !(item.tags || []).includes("Investido"))
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
  return workspaceData().crmItems.find((item) => item.id === state.selectedProjectId[state.currentWorkspace]);
}

function dashboardFilterState() {
  if (!state.dashboardFilters) {
    state.dashboardFilters = {
      rito: { stage: "Todos", temp: "Todos", query: "" },
      atica: { stage: "Todos", temp: "Todos", query: "" },
      fast: { stage: "Todos", temp: "Todos", query: "" }
    };
  }
  if (!state.dashboardFilters[state.currentWorkspace]) {
    state.dashboardFilters[state.currentWorkspace] = { stage: "Todos", temp: "Todos", query: "" };
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

function cardTemperature(card) {
  if (card.temperature) return card.temperature;
  if ((card.tags || []).includes("Quente")) return "Quente";
  if ((card.tags || []).includes("Morno")) return "Morno";
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
        <button class="soft-pill ${filters.temp === "Quente" ? "is-active" : ""}" data-pipeline-temp="Quente" type="button">Quente</button>
        <button class="soft-pill ${filters.temp === "Morno" ? "is-active" : ""}" data-pipeline-temp="Morno" type="button">Morno</button>
        <button class="soft-pill ${filters.temp === "Frio" ? "is-active" : ""}" data-pipeline-temp="Frio" type="button">Frio</button>
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

function getRitoInvestedCards() {
  return getRitoReferenceCards().filter((card) => (card.tags || []).includes("Investido"));
}

function referenceCardSubtle(card) {
  const matched = referenceDashboardRows().find((row) => row.company === card.name);
  if (matched) return displayText(matched.segment);
  return displayText((((card.subtitle || "").split(" - ")[0]) || card.subtitle || "").trim());
}

function referenceCardContact(card) {
  const matched = referenceDashboardRows().find((row) => row.company === card.name);
  if (matched) return matched.contact;
  const linked = workspaceData().crmItems.find((item) => item.name === card.name);
  return linked?.mainContact || linked?.email || "-";
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
    <div>${referenceCardContact(card)}</div>
    <div><span class="chip chip-${card.status.toLowerCase().replace(/\s+/g, "-")}">${displayText(card.status)}</span></div>
    <div><span class="chip chip-${temp.toLowerCase()}">${displayText(temp)}</span></div>
    <div class="owner-cell">${renderOwnerAvatar(card.owner)}<span>${displayText(card.owner)}</span></div>
    <div>-</div>
  `;
  const linked = workspaceData().crmItems.find((item) => item.name === card.name);
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
  head.innerHTML = "<div>Empresa</div><div>Contato</div><div>Estágio</div><div>Temp.</div><div>Responsável</div><div>Fechamento</div>";
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
  if (stage === "Investidos") return row.stage === "Portfolio";
  if (stage === "Declinados") return row.stage === "Declined";
  return row.stage === stage;
}

function usingReferenceDashboard() {
  return ["rito", "atica"].includes(state.currentWorkspace);
}

function normalizeReferenceDashboardStage(item) {
  if (item.investmentStatus === "Investido" || (item.tags || []).includes("Investido")) return "Portfolio";
  if (item.status === "Declined" || item.status === "Declinado") return "Declined";
  if (item.status === "Due Diligence") return "Due Diligence";
  if (item.status === "LOI") return "LOI";
  if (item.status === "Lead") return "Lead";
  return "Pipeline";
}

function referenceDashboardRows() {
  return prioritizedRitoPipelineItems(workspaceData().crmItems || []).map((item) => {
    ensureProjectShape(item);
    return {
      company: item.name,
      segment: item.email || item.sector || item.subtitle || "-",
      contact: item.contact || item.mainContact || item.email || "-",
      stage: normalizeReferenceDashboardStage(item),
      temp: item.temperature || "Frio",
      owner: item.owner || "-",
      close: item.deadline || item.closeDate || "-",
      initials: item.logoText || initials(item.name),
      logo: item.logo || "",
      logoText: item.logoText || initials(item.name),
      logoBg: item.logoBg || "transparent"
    };
  });
}

function referenceDashboardStages() {
  const rows = referenceDashboardRows();
  const countStage = (stage) => rows.filter((row) => row.stage === stage).length;
  return [
    { label: "Lead", count: countStage("Lead"), tone: "#e1e4ea", accent: "#6f7788" },
    { label: "Pipeline", count: countStage("Pipeline"), tone: "#f5edcf", accent: "#c09205" },
    { label: "LOI", count: countStage("LOI"), tone: "#ddd4fb", accent: "#7a5cf0" },
    { label: "Due Diligence", count: countStage("Due Diligence"), tone: "#d7e1f8", accent: "#4d7ef6" },
    { label: "Investidos", count: countStage("Portfolio"), tone: "#d8edd8", accent: "#41a047" },
    { label: "Declinados", count: countStage("Declined"), tone: "#f5d7d7", accent: "#dc3535" }
  ].map((stage) => ({ ...stage, deals: `${stage.count} deals` }));
}

function getFilteredRitoDashboardRows() {
  const filters = dashboardFilterState();
  const query = (filters.query || "").toLowerCase();
  return referenceDashboardRows().filter((row) => {
    const queryMatch = !query || [row.company, row.segment, row.contact, row.owner].join(" ").toLowerCase().includes(query);
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

function updateRitoDashboardView() {
  if (!usingReferenceDashboard() || state.currentView[state.currentWorkspace] !== "dashboard") {
    renderApp();
    return;
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
  if (!item.temperature) item.temperature = item.tags.includes("Quente") ? "Quente" : item.tags.includes("Morno") ? "Morno" : "Frio";
  if (!item.investmentStatus) item.investmentStatus = item.tags.includes("Investido") ? "Investido" : "Nao investido";
  if (!item.investmentAmount) item.investmentAmount = 0;
  if (!item.priority) item.priority = "Media";
  if (!item.origin) item.origin = "Inbound";
  if (!item.subtitle) item.subtitle = `${item.sector || ""} - ${item.location || ""} - ${item.year || ""}`.replace(/^ - | - $/g, "");
  if (!item.history) item.history = [{ at: todayISO(), text: "Projeto criado no CRM" }];
  if (item.progress === undefined) item.progress = item.tags.includes("Investido") ? 100 : item.status === "Pipeline" ? 30 : item.status === "Quente" ? 54 : 16;
  if (!item.website) item.website = "";
  if (!item.vcPeBacked) item.vcPeBacked = "";
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

function isLandingScreen() {
  const params = new URLSearchParams(location.search);
  return !params.get("workspace");
}

function navigateToWorkspace(workspaceId, view = "") {
  if (!workspaceConfig[workspaceId]) return;
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
  history.pushState({}, "", location.pathname);
  renderApp();
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
  document.querySelector(".workspace-switcher .eyebrow").textContent = state.currentWorkspace === "rito" ? "Portfolio" : "Ambiente";
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
    wrapper.innerHTML = "";
    return;
  }
  const config = workspaceConfig[state.currentWorkspace];
  wrapper.innerHTML = "";
  config.views.forEach((view) => {
    const tab = document.createElement("button");
    tab.className = `tab-button ${state.currentView[state.currentWorkspace] === view ? "active" : ""}`;
    tab.innerHTML = `<span class="tab-icon">${viewIcons[view] || "+"}</span><span>${tabTitle(view)}</span>`;
    tab.addEventListener("click", () => {
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
}

function renderWorkspaceLandingPage() {
  const page = document.createElement("section");
  page.className = "workspace-launch-page";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia." : hour < 18 ? "Boa tarde." : "Boa noite.";
  page.innerHTML = `
    <section class="workspace-launch-hero">
      <span class="workspace-launch-kicker">Plataforma</span>
      <h3>${greeting}</h3>
      <p>Selecione um workspace para continuar.</p>
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
    item.innerHTML = `
      <span class="workspace-launch-index">${meta.index}</span>
      <span class="workspace-launch-mark">${workspaceLogoMarkup(workspace.id, "landing")}</span>
      <span class="workspace-launch-main">
        <strong>${workspace.name}</strong>
        <span class="workspace-launch-subtitle">${meta.descriptor}</span>
      </span>
      <span class="workspace-launch-links">${workspace.views.slice(0, 5).map((view) => `<span>${tabTitleForWorkspace(workspace.id, view)}</span>`).join("")}</span>
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

function renderDashboard() {
  const panel = document.createElement("section");
  panel.className = "content-grid ref-page workspace-soft-page";
  const data = workspaceData();
  const config = workspaceConfig[state.currentWorkspace];

  if (state.currentWorkspace === "fast") {
    const tasks = data.taskItems;
    const done = tasks.filter((task) => task.status === "Concluido").length;
    const inExecution = tasks.filter((task) => task.status === "Em andamento").length;
    const awaiting = tasks.filter((task) => task.status === "Revisao").length;
    const todo = tasks.filter((task) => task.status === "A fazer").length;
    const workstreams = workspaceTaskThemes("fast").length;
    const metrics = [
      ["Iniciativas", tasks.length, "Plano tatico total"],
      ["Frentes ativas", workstreams, displayText("Workstreams da operacao")],
      ["Em andamento", inExecution, displayText("Itens em execucao")],
      ["Aguardando", awaiting, "Dependencia de aporte ou terceiros"],
      ["Nao iniciadas", todo, "Backlog atual"],
      ["Execucao", `${Math.round((done / (tasks.length || 1)) * 100)}%`, displayText("Percentual concluido")]
    ];
    panel.innerHTML = `
      <section class="page-head">
        <div><h3>Dashboard</h3><p>${displayText("Painel executivo da Fast Massagem com visao operacional, prioridades e performance")}</p></div>
      </section>
    `;
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
    ["Deals no pipeline", deals.length, "Todos os estagios do CRM"],
    ["Valor total", currency(totalValue), "Portfolio analisado"],
    ["Deals quentes", hotDeals, "Quente + Pipeline"],
    ["Taxa de conversao", `${conversion}%`, "Deals com tag Investido"]
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
  grid.appendChild(renderRitoFunnel());
  grid.appendChild(renderRitoDashboardSide());
  panel.appendChild(grid);
  return panel;
}

function renderRitoFunnel() {
  const filters = dashboardFilterState();
  const panel = document.createElement("section");
  panel.className = "panel funnel-card rito-funnel-panel";
  panel.innerHTML = `<div class="panel-header"><div><h3>Etapas do Pipeline</h3></div></div>`;

  const stages = referenceDashboardStages();
  const stageWidths = ["100%", "93%", "86%", "79%", "72%", "65%"];
  const dividerWidths = ["100%", "93%", "86%", "79%", "72%"];

  const stack = document.createElement("div");
  stack.className = "funnel-stack rito-funnel-stack";

  stages.forEach((stage, index) => {
    const block = document.createElement("div");
    block.className = `funnel-block rito-funnel-block ${filters.stage === stage.label ? "is-active" : ""}`;
    block.dataset.dashboardStage = stage.label;
    block.style.background = stage.tone;
    block.style.width = stageWidths[index] || "100%";
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
        divider.style.width = dividerWidths[index] || "100%";
        divider.innerHTML = `<span style="width:${index === 1 ? "100" : index === 4 ? "38" : index === 5 ? "74" : "0"}%; background:${stage.accent}"></span>`;
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

  panel.append(stack, summary);
  return panel;
}

function renderRitoDashboardSide() {
  const filters = dashboardFilterState();
  const filteredRows = getFilteredRitoDashboardRows();
  const crmItems = workspaceData().crmItems || [];
  const allocatedValue = allocatedPortfolioValue(crmItems);
  const projectedValue = projectedAllocationValue(crmItems);
  const side = document.createElement("section");
  side.className = "dashboard-side rito-dashboard-side";

  const metrics = [
    [String(filteredRows.length), "Deals", "visiveis"],
    [allocatedValue ? currency(allocatedValue) : "-", "Valor alocado", "projetos investidos"],
    [String(filteredRows.filter((row) => row.temp === "Quente").length), "Quentes", "em andamento"],
    [String(filteredRows.filter((row) => row.stage === "Portfolio").length), "Fechadas", "investidos"],
    [projectedValue ? currency(projectedValue) : "-", "Projecao de alocacao", "nao investidos"]
  ];

  const metricsRow = document.createElement("section");
  metricsRow.className = "metrics-grid rito-metrics-grid";
  metrics.forEach(([value, label, foot]) => {
    const node = document.getElementById("metricCardTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".metric-value").textContent = value;
    node.querySelector(".metric-label").textContent = label;
    node.querySelector(".metric-footnote").textContent = foot;
    metricsRow.appendChild(node);
  });
  side.appendChild(metricsRow);

  const controls = document.createElement("section");
  controls.className = "pill-filter-row rito-filter-row";
  controls.innerHTML = `
    <label class="search-field top-search">
      <input id="ritoDashboardSearch" type="search" placeholder="Buscar empresa ou deal..." value="${escapeAttr(filters.query || "")}">
    </label>
    <div class="pill-group">
      <button class="soft-pill ${filters.temp === "Quente" ? "is-active" : ""}" data-dashboard-temp="Quente">Quente</button>
      <button class="soft-pill ${filters.temp === "Morno" ? "is-active" : ""}" data-dashboard-temp="Morno">Morno</button>
      <button class="soft-pill ${filters.temp === "Frio" ? "is-active" : ""}" data-dashboard-temp="Frio">Frio</button>
      <button class="soft-pill ${filters.temp === "Todos" ? "is-active" : ""}" data-dashboard-temp="Todos">Todos</button>
    </div>
  `;
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
      saveState();
      updateRitoDashboardView();
    };
  });
  side.appendChild(controls);

  side.appendChild(renderRitoDashboardTable(filteredRows));
  return side;
}

function renderRitoDashboardTable(rows = referenceDashboardRows()) {
  const table = document.createElement("section");
  table.className = "panel dashboard-table rito-dashboard-table";
  const head = document.createElement("div");
  head.className = "table-head";
  head.innerHTML = "<div>Empresa</div><div>Contato</div><div>Estágio</div><div>Temp.</div><div>Responsável</div><div>Fechamento</div>";
  table.appendChild(head);

  rows.forEach((rowData) => {
    const row = document.createElement("div");
    row.className = "table-row rito-table-row";
    row.innerHTML = `
      <div class="company-cell">
        ${renderCompanyBadge(rowData)}
        <div><strong>${displayText(rowData.company)}</strong><div class="subtle">${displayText(rowData.segment)}</div></div>
      </div>
      <div>${rowData.contact}</div>
      <div><span class="chip chip-${rowData.stage.toLowerCase().replace(/\s+/g, "-")}">${rowData.stage}</span></div>
      <div><span class="chip chip-${rowData.temp.toLowerCase()}">${rowData.temp}</span></div>
      <div class="owner-cell">${renderOwnerAvatar(rowData.owner)}<span>${displayText(rowData.owner)}</span></div>
      <div>${rowData.close}</div>
    `;
    const linked = workspaceData().crmItems.find((item) => item.name === rowData.company);
    if (linked) {
      row.draggable = true;
      row.dataset.crmId = linked.id;
      row.classList.add("is-clickable");
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", linked.id);
        row.classList.add("is-dragging");
        row.dataset.justDragged = "0";
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        row.dataset.justDragged = "1";
        document.querySelectorAll(".rito-table-row").forEach((rowNode) => rowNode.classList.remove("is-drop-target"));
        setTimeout(() => {
          row.dataset.justDragged = "0";
        }, 60);
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".rito-table-row").forEach((rowNode) => {
          if (rowNode !== row) rowNode.classList.remove("is-drop-target");
        });
        row.classList.add("is-drop-target");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("is-drop-target");
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("is-drop-target");
        reorderCRMItems(event.dataTransfer.getData("text/plain"), linked.id);
      });
      row.onclick = () => {
        if (row.dataset.justDragged === "1") return;
        openProjectDetail(linked.id, "dashboard");
      };
    }
    table.appendChild(row);
  });

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "rito-dashboard-empty";
    empty.textContent = "Nenhum deal encontrado com os filtros atuais.";
    table.appendChild(empty);
  }

  return table;
}

function renderRitoDashboardCards(cards = []) {
  const wrap = document.createElement("section");
  wrap.className = "dashboard-highlight-section";
  wrap.innerHTML = `<div class="section-head-row"><h4>Deals em destaque</h4><span class="subtle">${cards.length} visiveis</span></div>`;
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
  const declinedCount = crmItems.filter((item) => normalizeReferenceDashboardStage(item) === "Declined").length;
  const totalPortfolioValue = projectedAllocationValue(crmItems);
  const page = document.createElement("section");
  page.className = "content-grid ref-page";
  page.innerHTML = `
    <section class="page-head">
      <div><h3>Pipeline</h3><p>Pipeline operacional de deals da Rito</p></div>
      <div class="page-head-actions">
        <div class="segmented"><button class="${viewMode === "cards" ? "is-active" : ""}" data-ref-action="cards-view" data-ref-view="crm" type="button">Cards</button><button class="${viewMode === "list" ? "is-active" : ""}" data-ref-action="list-view" data-ref-view="crm" type="button">Lista</button></div>
        <button class="action-button" data-ref-action="new-opportunity" type="button">+ Oportunidade</button>
      </div>
    </section>
  `;
  page.appendChild(renderStatStrip([
      [String(crmItems.length), "Total"], [String(investedCount), "Investidos"], [String(pipelineCount), "Pipeline"], [String(declinedCount), "Declinados"], [totalPortfolioValue ? currency(totalPortfolioValue) : "-", "Projecao de Alocacao"]
    ], "compact"));
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
  const completedCount = investedCards.filter((card) => Number(card.progress || 0) >= 100).length;
  const activeCount = investedCards.filter((card) => Number(card.progress || 0) < 100).length;
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
  page.appendChild(renderStatStrip([[String(investedCards.length), "Total"], [String(activeCount), "Em Andamento"], [String(completedCount), "Concluidos"], [investedValue ? currency(investedValue) : "-", "Valor Alocado"]], "compact compact-four"));
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
  state.selectedProjectId[state.currentWorkspace] = projectId;
  state.projectReturnView[state.currentWorkspace] = sourceView === "projectDetail"
    ? (state.projectReturnView[state.currentWorkspace] || "crm")
    : sourceView;
  state.currentView[state.currentWorkspace] = "projectDetail";
  saveState();
  renderApp();
}

function closeProjectDetail() {
  state.currentView[state.currentWorkspace] = state.projectReturnView[state.currentWorkspace] || "crm";
  saveState();
  renderApp();
}

function renderRitoProjectDetailPage() {
  const item = getSelectedProject();
  if (!item) return renderRitoPipelinePage();
  ensureProjectShape(item);
  const relatedTasks = workspaceData().projectBoards[item.name] || [];
  const relatedDocs = getRelatedDocuments(item);
  const sourceView = state.projectReturnView[state.currentWorkspace] || "crm";
  const page = document.createElement("section");
  page.className = "content-grid ref-page project-detail-page";
  page.tabIndex = -1;
  page.innerHTML = `
    <button class="ghost-button project-back-button" data-project-action="back" type="button">Voltar para ${tabTitle(sourceView)}</button>
    <section class="project-hero">
      <div class="project-hero-cover" style="background-image:url('${item.cover}');background-position:${item.media.coverPosition};background-size:${item.media.coverZoom}% auto;"></div>
      <div class="project-hero-shell">
        <div class="project-hero-logo">${item.logo ? `<img src="${item.logo}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;transform:scale(${(item.media.logoScale || 100) / 100});">` : initials(item.name)}</div>
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
    <section class="project-meta-grid">
      ${renderProjectMetaCard("Nome", `<input data-drawer-field="name" value="${escapeAttr(item.name || "")}">`)}
      ${renderProjectMetaCard("Stage", `<select data-drawer-field="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${stage === item.status ? "selected" : ""}>${stage}</option>`).join("")}</select>`)}
      ${renderProjectMetaCard("Subtítulo", `<input data-drawer-field="subtitle" value="${escapeAttr(item.subtitle || "")}">`)}
      ${renderProjectMetaCard("Setor", `<input data-drawer-field="sector" value="${escapeAttr(item.sector || "")}">`)}
      ${renderProjectMetaCard("Localização", `<input data-drawer-field="location" value="${escapeAttr(item.location || "")}">`)}
      ${renderProjectMetaCard("Ano", `<input data-drawer-field="year" value="${escapeAttr(item.year || "")}">`)}
      ${renderProjectMetaCard("Website", `<input data-drawer-field="website" value="${escapeAttr(item.website || "")}">`)}
      ${renderProjectMetaCard("Responsável", `<select data-drawer-field="owner">${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option ${owner === item.owner ? "selected" : ""}>${owner}</option>`).join("")}</select>`)}
      ${renderProjectMetaCard("Temperatura", `<select data-drawer-field="temperature"><option ${item.temperature === "Frio" ? "selected" : ""}>Frio</option><option ${item.temperature === "Morno" ? "selected" : ""}>Morno</option><option ${item.temperature === "Quente" ? "selected" : ""}>Quente</option></select>`)}
      ${renderProjectMetaCard("Prioridade", `<select data-drawer-field="priority"><option ${item.priority === "Alta" ? "selected" : ""}>Alta</option><option ${item.priority === "Media" ? "selected" : ""}>Media</option><option ${item.priority === "Baixa" ? "selected" : ""}>Baixa</option></select>`)}
      ${renderProjectMetaCard("VC/PE Backed", `<input data-drawer-field="vcPeBacked" value="${escapeAttr(item.vcPeBacked || "")}">`)}
      ${renderProjectMetaCard("Investimento", `<select data-drawer-field="investmentStatus"><option ${item.investmentStatus === "Nao investido" ? "selected" : ""}>Nao investido</option><option ${item.investmentStatus === "Investido" ? "selected" : ""}>Investido</option></select>`)}
      ${renderProjectMetaCard("Valor da operação", `<input data-drawer-field="investmentAmount" type="number" value="${escapeAttr(item.investmentAmount || 0)}">`)}
      ${renderProjectMetaCard("Criado em", `<input data-drawer-field="createdAt" value="${escapeAttr(item.createdAt || "")}">`)}
      ${renderProjectMetaCard("Atualizado em", `<input data-drawer-field="updatedAt" value="${escapeAttr(item.updatedAt || "")}">`)}
    </section>
    <section class="project-detail-sections">
      <article class="project-detail-card"><h4>Descrição da Empresa</h4><textarea class="detail-textarea" data-drawer-field="description">${item.description || ""}</textarea></article>
      <article class="project-detail-card"><h4>Management team</h4><textarea class="detail-textarea" data-drawer-field="managementTeam">${item.managementTeam || ""}</textarea></article>
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
      <article class="project-detail-card">
        <h4>Tags</h4>
        <div class="tag-editor">${item.tags.map((tag) => `<span class="tag-chip">${tag}<button data-remove-tag="${escapeAttr(tag)}" type="button">X</button></span>`).join("")}</div>
        <label class="field"><span>Adicionar tag</span><input id="projectNewTagInput" placeholder="Ex: SaaS"></label>
        <div class="subtle">Use "Colar capa" ou "Colar logo" e depois Ctrl+V para inserir imagens direto da área de transferência.</div>
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
        ${relatedDocs.map((doc) => `<article class="related-item"><strong>${doc.name}</strong><span class="subtle">${doc.category} - ${doc.uploadedAt}</span><div class="inline-actions">${doc.fileData ? `<a class="ghost-button" href="${doc.fileData}" download="${doc.name}">Baixar</a>` : ""}<button class="ghost-button" data-delete-doc="${doc.id}" type="button">Excluir</button></div></article>`).join("") || "<div class='project-mini-empty'>Nenhum documento vinculado.</div>"}
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
  page.querySelector("[data-project-action='back']").onclick = closeProjectDetail;
  page.querySelector("[data-project-action='delete']").onclick = () => {
    state.workspaces[state.currentWorkspace].crmItems = workspaceData().crmItems.filter((entry) => entry.id !== item.id);
    delete workspaceData().projectBoards[item.name];
    workspaceData().documents = workspaceData().documents.filter((doc) => (doc.linkedTo || "").toLowerCase() !== item.name.toLowerCase());
    saveState();
    closeProjectDetail();
  };
  page.querySelector("[data-project-action='toggle-invested']").onclick = async () => {
    await persistDrawerProject(item, page);
    item.investmentStatus = item.investmentStatus === "Investido" ? "Nao investido" : "Investido";
    syncInvestmentTag(item);
    item.updatedAt = todayISO();
    pushHistory(item, item.investmentStatus === "Investido" ? "Projeto marcado como investido" : "Projeto removido de investidos");
    upsertCRMItem(item);
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
    const sizes = [90, 100, 110, 120];
    const currentIndex = sizes.indexOf(item.media.logoScale || 100);
    item.media.logoScale = sizes[(currentIndex + 1) % sizes.length];
    item.updatedAt = todayISO();
    pushHistory(item, `Escala da logo ajustada para ${item.media.logoScale}%`);
    saveState();
    openProjectDetail(item.id, sourceView);
  };
  page.querySelector("[data-project-action='new-task']").onclick = () => openTaskDialog(item.name);
  page.querySelector("[data-project-action='new-doc']").onclick = () => openDocumentDialog(item.name);
  page.querySelector("#detailLogoUpload").onchange = async (event) => {
    item.logo = await imageFileToProjectDataURL(event.target.files[0], "logo", item.logo);
    item.updatedAt = todayISO();
    pushHistory(item, "Logo atualizada");
    saveState();
    openProjectDetail(item.id, sourceView);
  };
  page.querySelector("#detailCoverUpload").onchange = async (event) => {
    item.cover = await imageFileToProjectDataURL(event.target.files[0], "cover", item.cover);
    item.updatedAt = todayISO();
    pushHistory(item, "Capa atualizada");
    saveState();
    openProjectDetail(item.id, sourceView);
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
  page.querySelector("#projectNewTagInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = event.target.value.trim();
    if (!value) return;
    item.tags.push(value);
    pushHistory(item, `Tag adicionada: ${value}`);
    saveState();
    openProjectDetail(item.id, sourceView);
  });
  page.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.onclick = () => {
      item.tags = item.tags.filter((tag) => tag !== button.dataset.removeTag);
      pushHistory(item, `Tag removida: ${button.dataset.removeTag}`);
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
    button.onclick = () => {
      workspaceData().documents = workspaceData().documents.filter((doc) => doc.id !== button.dataset.deleteDoc);
      item.updatedAt = todayISO();
      pushHistory(item, "Documento relacionado removido");
      saveState();
      openProjectDetail(item.id, sourceView);
    };
  });
  page.querySelectorAll("[data-drawer-field], [data-framework-field]").forEach((field) => {
    field.addEventListener("change", () => persistDrawerProject(item, page));
    field.addEventListener("blur", () => persistDrawerProject(item, page));
  });
}

function renderRitoKanbanPage() {
  const page = document.createElement("section");
  page.className = "content-grid ref-page";
  page.innerHTML = `
    <section class="page-head">
      <div><h3>Kanban Rito</h3><p>Gestao da empresa organizada por tema</p></div>
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

function renderRitoDocumentsPage() {
  const page = document.createElement("section");
  page.className = "content-grid ref-page";
  page.innerHTML = `
    <section class="page-head">
      <div><h3>Documentos</h3><p>Biblioteca de documentos - 5 arquivos</p></div>
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
  ritoDocumentCards.forEach((doc) => {
    const card = document.createElement("article");
    card.className = "reference-doc-card";
    const fileUrl = toFileHref(doc.filePath);
    card.innerHTML = `
      <div class="doc-icon">${doc.icon}</div>
      <strong>${doc.title}</strong>
      <div class="chips">${doc.tags.map((tag) => `<span class="chip">${tag}</span>`).join("")}</div>
      <p class="subtle">${doc.description}</p>
      <div class="subtle">${doc.meta}</div>
      <div class="inline-actions">
        ${fileUrl
          ? `<a class="action-button" href="${escapeAttr(fileUrl)}" download="${escapeAttr(doc.title)}" target="_blank" rel="noreferrer">Download</a>
             <a class="ghost-button" href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">Editar</a>`
          : `<button class="action-button" disabled>Download</button>
             <button class="ghost-button" disabled>Editar</button>`}
        <button class="ghost-button" data-ref-action="delete-doc" data-doc-title="${escapeAttr(doc.title)}" type="button">Excluir</button>
      </div>
    `;
    grid.appendChild(card);
  });
  page.appendChild(grid);
  return page;
}

function renderRitoMembersPage() {
  const page = document.createElement("section");
  const members = workspaceData().members;
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
        <div class="member-avatar" style="background:${view.color}">${view.photo ? `<img src="${view.photo}" alt="${escapeAttr(view.name)}">` : view.initials}</div>
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
      <div><h3>Configuracoes</h3><p>Gestao de workspaces, tema e sistema</p></div>
    </section>
    <section class="settings-section">
      <h4>Aparencia</h4>
      <article class="panel settings-card-row"><div><strong>Tema da Interface</strong><div class="subtle">Alterne entre dark e light mode</div></div><div class="segmented"><button data-ref-action="set-dark" type="button">Dark</button><button class="is-active" data-ref-action="set-light" type="button">Light</button></div></article>
    </section>
    <section class="settings-section">
      <h4>Workspaces</h4>
      <div class="workspace-settings-list">
        <article><strong>Rito Ventures</strong><div class="subtle">17 empresas - 127 tarefas - 5 documentos - 17 oportunidades</div><div class="inline-actions"><button class="ghost-button" data-ref-action="workspace-edit" data-workspace="rito" type="button">Editar</button><button class="ghost-button" data-ref-action="workspace-duplicate" data-workspace="rito" type="button">Duplicar</button><button class="ghost-button" data-ref-action="workspace-link" data-workspace="rito" type="button">Link</button></div></article>
        <article><strong>Fast Massagem</strong><div class="subtle">2 empresas - 38 tarefas - 0 documentos - 0 oportunidades</div><div class="inline-actions"><button class="ghost-button" data-ref-action="workspace-edit" data-workspace="fast" type="button">Editar</button><button class="ghost-button" data-ref-action="workspace-duplicate" data-workspace="fast" type="button">Duplicar</button><button class="ghost-button" data-ref-action="workspace-link" data-workspace="fast" type="button">Link</button></div></article>
        <article><strong>Ática Gestão</strong><div class="subtle">1 empresas - 0 tarefas - 0 documentos - 0 oportunidades</div><div class="inline-actions"><button class="ghost-button" data-ref-action="workspace-edit" data-workspace="atica" type="button">Editar</button><button class="ghost-button" data-ref-action="workspace-duplicate" data-workspace="atica" type="button">Duplicar</button><button class="ghost-button" data-ref-action="workspace-link" data-workspace="atica" type="button">Link</button></div></article>
        <button class="ghost-button settings-add" data-ref-action="new-workspace" type="button">+ Novo Workspace</button>
      </div>
    </section>
    <section class="settings-section">
      <h4>Backup & Exportação</h4>
      <article class="panel"><p>Exporte todos os dados da plataforma. Os dados incluem portfólio, CRM, tarefas, projetos, documentos e membros de todos os workspaces.</p><div class="inline-actions"><button class="ghost-button" data-ref-action="connect-source" type="button">Importar backup JSON</button><button class="ghost-button" data-ref-action="save-html" type="button">Baixar HTML browser-ready</button><button class="action-button" data-ref-action="export-json" type="button">Exportar JSON (backup completo)</button><button class="ghost-button" data-ref-action="export-crm" type="button">CRM como CSV</button><button class="ghost-button" data-ref-action="export-tasks" type="button">Tarefas como CSV</button><button class="ghost-button" data-ref-action="export-portfolio" type="button">Portfólio como CSV</button></div></article>
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
  items.forEach(([value, label]) => {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.innerHTML = `<strong class="metric-value">${value}</strong><p class="metric-label">${displayText(label)}</p>`;
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
  const linked = workspaceData().crmItems.find((item) => item.name === card.name);
  const isInvested = linked ? linked.investmentStatus === "Investido" || (linked.tags || []).includes("Investido") : invested;
  const allocationLabel = isInvested ? "Valor alocado" : "Projeção";
  const displayCover = linked?.cover || card.cover;
  const displayLogo = linked?.logo || card.logo || "";
  const displayLogoText = linked?.logoText || card.logoText || "";
  const displayLogoBg = displayLogo ? "transparent" : (linked?.logoBg || card.logoBg || "transparent");
  const displayTags = linked?.tags?.length ? linked.tags : card.tags;
  const displayStatus = linked ? (linked.investmentStatus === "Investido" ? "Investido" : linked.status) : card.status;
  const displayOwner = linked?.owner || card.owner;
  const displayProgress = linked?.progress ?? card.progress ?? 35;
  const companyDescription = displayText(linked?.description || card.description || linked?.businessModel || card.framework || "-");
  if (linked) {
    article.draggable = true;
    article.dataset.crmId = linked.id;
  }
  article.innerHTML = `
    <div class="reference-cover" style="background-image:url('${displayCover}')">
      <button class="cover-dot">...</button>
      <span class="status-badge">${displayText(displayStatus)}</span>
    </div>
    <div class="reference-logo ${displayLogo ? "has-image" : ""}" style="background:${displayLogoBg}">${displayLogo ? `<img src="${displayLogo}" alt="${card.name}" style="width:100%;height:100%;object-fit:contain">` : displayLogoText}</div>
    <div class="reference-card-body">
      <strong>${displayText(card.name)}</strong>
      <div class="subtle">${displayText(card.subtitle)}</div>
      <div class="chips">${displayTags.map((tag) => `<span class="chip ${tagChipClass(tag)}">${displayText(tag)}</span>`).join("")}</div>
      <div class="reference-description-block">
        <span>Company description</span>
        <p>${companyDescription}</p>
      </div>
      <label class="reference-value-field">
        <span>${displayText(allocationLabel)}</span>
        <input type="text" inputmode="decimal" data-card-investment value="${linked ? formatLocaleNumber(linked.investmentAmount || 0) : "0"}">
      </label>
      <div class="progress-bar"><span style="width:${invested ? 100 : displayProgress}%; background:${card.accent}"></span></div>
      <div class="subtle">${invested ? `${displayProgress ?? 100}% completo` : displayText(displayOwner)}</div>
    </div>
  `;
  if (linked) {
    const investmentInput = article.querySelector("[data-card-investment]");
    ["click", "mousedown", "mouseup", "touchstart", "touchend"].forEach((eventName) => {
      investmentInput.addEventListener(eventName, (event) => event.stopPropagation());
    });
    const commitInvestmentAmount = () => {
      linked.investmentAmount = Math.max(0, parseLocaleNumber(investmentInput.value || 0));
      investmentInput.value = formatLocaleNumber(linked.investmentAmount);
      linked.updatedAt = todayISO();
      syncInvestmentTag(linked);
      saveState();
      renderApp();
    };
    investmentInput.addEventListener("change", commitInvestmentAmount);
    investmentInput.addEventListener("blur", commitInvestmentAmount);
    article.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", linked.id);
      article.classList.add("is-dragging");
      article.dataset.justDragged = "0";
    });
    article.addEventListener("dragend", () => {
      article.classList.remove("is-dragging");
      article.dataset.justDragged = "1";
      document.querySelectorAll(".reference-project-card").forEach((cardNode) => cardNode.classList.remove("is-drop-target"));
      setTimeout(() => {
        article.dataset.justDragged = "0";
      }, 60);
    });
    article.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".reference-project-card").forEach((cardNode) => {
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
      reorderCRMItems(event.dataTransfer.getData("text/plain"), linked.id);
    });
    article.addEventListener("click", () => {
      if (article.dataset.justDragged === "1") return;
      openProjectDetail(linked.id, sourceView);
    });
  }
  return article;
}

function renderMetrics(metrics) {
  const panel = document.createElement("section");
  panel.className = "metrics-grid";
  const template = document.getElementById("metricCardTemplate");
  metrics.forEach(([label, value, footnote]) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".metric-label").textContent = displayText(label);
    node.querySelector(".metric-value").textContent = value;
    node.querySelector(".metric-footnote").textContent = displayText(footnote);
    panel.appendChild(node);
  });
  return panel;
}

function renderFunnel(items, stages) {
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `<div class="panel-header"><div><h3>Funil de conversao</h3><p>Deals por estagio e distribuicao visual do pipeline</p></div></div>`;
  stages.forEach((stage) => {
    const count = items.filter((item) => item.status === stage).length;
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
  panel.innerHTML = `<div class="panel-header"><div><h3>Valor por estagio</h3><p>Visibilidade financeira por etapa do funil</p></div></div>`;
  stages.forEach((stage) => {
    const total = items.filter((item) => item.status === stage).reduce((sum, item) => sum + item.estimatedValue, 0);
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
  const statusGroups = [
    { label: "Nao iniciadas", key: "A fazer", count: tasks.filter((task) => task.status === "A fazer").length, color: "#9aa4b8" },
    { label: "Em andamento", key: "Em andamento", count: tasks.filter((task) => task.status === "Em andamento").length, color: "#4f7cff" },
    { label: "Aguardando", key: "Revisao", count: tasks.filter((task) => task.status === "Revisao").length, color: "#c6932d" },
    { label: "Concluidas", key: "Concluido", count: tasks.filter((task) => task.status === "Concluido").length, color: "#32a36a" }
  ];
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
          <div class="fast-legend-row">
            <span class="fast-legend-main"><span class="fast-legend-dot" style="background:${item.color}"></span>${item.label}</span>
            <strong>${item.count}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const workstreamPanel = document.createElement("section");
  workstreamPanel.className = "panel fast-panel";
  workstreamPanel.innerHTML = `<div class="panel-header"><div><h3>Performance por Tema</h3><p>Distribuicao das entregas e progresso por frente de trabalho</p></div></div>`;
  workstreams.forEach((stage) => {
    const stageTasks = tasks.filter((task) => task.stage === stage);
    const done = stageTasks.filter((task) => task.status === "Concluido").length;
    const inProgress = stageTasks.filter((task) => task.status === "Em andamento").length;
    const waiting = stageTasks.filter((task) => task.status === "Revisao").length;
    const progress = Math.round((done / (stageTasks.length || 1)) * 100);
    const row = document.createElement("div");
    row.className = "fast-workstream-row";
    row.innerHTML = `
      <div class="fast-workstream-main">
        <div class="fast-workstream-head">
          <strong>${stage}</strong>
          <span>${stageTasks.length} tarefas</span>
        </div>
        <div class="fast-workstream-stats">${inProgress} em andamento • ${waiting} aguardando • ${done} concluidas</div>
        <div class="fast-progress-track"><span style="width:${Math.max(progress, stageTasks.length ? 10 : 0)}%"></span></div>
      </div>
      <div class="fast-workstream-meta">
        <strong>${progress}%</strong>
        <span>execucao</span>
      </div>
    `;
    workstreamPanel.appendChild(row);
  });

  const mixPanel = document.createElement("section");
  mixPanel.className = "panel fast-panel";
  mixPanel.innerHTML = `<div class="panel-header"><div><h3>Mix de Execucao</h3><p>Leitura visual de volume por tema e intensidade operacional</p></div></div>`;
  const maxStageTasks = Math.max(...workstreams.map((stage) => tasks.filter((task) => task.stage === stage).length), 1);
  workstreams.forEach((stage) => {
    const stageTasks = tasks.filter((task) => task.stage === stage);
    const totalStage = stageTasks.length;
    const done = stageTasks.filter((task) => task.status === "Concluido").length;
    const inProgress = stageTasks.filter((task) => task.status === "Em andamento").length;
    const waiting = stageTasks.filter((task) => task.status === "Revisao").length;
    const todo = stageTasks.filter((task) => task.status === "A fazer").length;
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
        <span>${done} concluidas</span>
      </div>
    `;
    mixPanel.appendChild(row);
  });

  const volumePanel = document.createElement("section");
  volumePanel.className = "panel fast-panel";
  volumePanel.innerHTML = `<div class="panel-header"><div><h3>Volume por Frente</h3><p>Comparativo visual entre as frentes da operacao</p></div></div>`;
  const bars = document.createElement("div");
  bars.className = "fast-volume-chart";
  workstreams.forEach((stage) => {
    const stageTasks = tasks.filter((task) => task.stage === stage);
    const totalStage = stageTasks.length;
    const done = stageTasks.filter((task) => task.status === "Concluido").length;
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
  ownerPanel.innerHTML = `<div class="panel-header"><div><h3>Carga por Responsavel</h3><p>Concentracao de tarefas e prioridades por pessoa</p></div></div>`;
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
  criticalPanel.innerHTML = `<div class="panel-header"><div><h3>${displayText("Prioridades Criticas")}</h3><p>${displayText("Itens com maior impacto em caixa, operacao e expansao")}</p></div></div>`;
  tasks
    .filter((task) => task.priority === "Alta" || task.status === "Revisao" || /aporte/i.test(task.description))
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
    ["Entregas concluidas", tasks.filter((task) => task.status === "Concluido").length, "#32a36a"]
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
    const count = items.filter((item) => item.status === stage).length;
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
  head.innerHTML = "<div>Empresa</div><div>Contato</div><div>Estagio</div><div>Temp.</div><div>Responsavel</div>";
  table.appendChild(head);

  deals.slice(0, 4).forEach((deal) => {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div class="company-cell">
        <div class="company-badge">${initials(deal.name)}</div>
        <div><strong>${deal.name}</strong><div class="subtle">${deal.description.slice(0, 44)}...</div></div>
      </div>
      <div><div>-${deal.year}</div><div class="subtle">${deal.location}</div></div>
      <div><span class="chip">${deal.status}</span></div>
      <div><span class="chip">${deal.tags.find((tag) => ["Frio", "Morno", "Quente"].includes(tag)) || deal.status}</span></div>
      <div>${deal.owner}</div>
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
        <p>Deals com visual premium, filtros dinamicos e leitura mais limpa</p>
      </div>
      <div class="page-head-actions">
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
        <p>Deals com visual editorial, filtros dinamicos e acoes rapidas</p>
      </div>
      <div class="inline-actions">
        <button class="ghost-button" data-action="export-crm">Exportar CSV</button>
      </div>
    </div>
    <div class="filters-row">
      <label class="field"><span>Status</span><select id="crmFilterStatus"><option value="">Todos</option>${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option>${stage}</option>`).join("")}</select></label>
      <label class="field"><span>Responsavel</span><select id="crmFilterOwner"><option value="">Todos</option>${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option>${owner}</option>`).join("")}</select></label>
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
    data.crmItems
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
  const companyDescription = displayText(item.description || item.businessModel || item.framework || "-");
  const managementTeam = displayText(item.managementTeam || item.management || item.founders || "-");
  const fundraisingHistory = displayText(item.fundraisingHistory || "-");
  const vcBacked = displayText(item.vcPeBacked || "-");
  const locationLine = [item.sector, item.location, item.year].filter(Boolean).map((part) => displayText(part)).join(" - ");
  article.innerHTML = `
    <div class="card-cover" style="background-image:url('${item.cover}')">
      <button class="ghost-button cover-actions" data-card-action="menu" data-card-id="${item.id}">...</button>
      <div class="status-badge">${displayText(item.tags.includes("Investido") ? "Investido" : item.status)}</div>
    </div>
    <div class="card-logo ${item.logo ? "has-image" : ""}" style="${item.logo ? "background:transparent" : ""}">${item.logo ? `<img src="${item.logo}" alt="${item.name}">` : initials(item.name)}</div>
    <div class="card-content">
      <div class="card-copy-block">
        <h4>${displayText(item.name)}</h4>
        <div class="subtle">${locationLine || "-"}</div>
      </div>
      <div class="chips">${item.tags.map((tag) => `<span class="chip ${tagChipClass(tag)}">${displayText(tag)}</span>`).join("")}</div>
      <div class="card-info-stack">
        <div class="card-field card-description-preview">
          <span>Company description</span>
          <p>${companyDescription}</p>
        </div>
        <div class="card-meta-grid">
          <div class="card-field">
            <span>Fundraising history</span>
            <p>${fundraisingHistory}</p>
          </div>
          <div class="card-field">
            <span>Management team</span>
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
      <div class="inline-actions">
        <button class="ghost-button" data-card-action="edit" data-card-id="${item.id}">Editar</button>
        <button class="ghost-button" data-card-action="duplicate" data-card-id="${item.id}">Duplicar</button>
      </div>
    </div>
  `;
  article.querySelectorAll("[data-card-action]").forEach((button) => {
    button.addEventListener("click", () => handleCRMCardAction(button.dataset.cardAction, item.id));
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
    reorderCRMItems(event.dataTransfer.getData("text/plain"), item.id);
  });
  article.addEventListener("click", (event) => {
    if (article.dataset.justDragged === "1") return;
    if (event.target.closest("[data-card-action]")) return;
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
        <label class="field"><span>Responsavel</span><input id="investedOwner" placeholder="Ex: Arthur"></label>
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
  const kanbanSubtitles = {
    rito: "Gestao da empresa organizada por tema",
    atica: "Gestao interna organizada por tema",
    fast: "Operacao da empresa organizada por tema"
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
        <button class="ghost-button" data-ref-action="edit-columns" type="button">Alterar colunas</button>
        <button class="ghost-button" data-action="export-tasks">Exportar CSV</button>
        <button class="action-button" data-ref-action="new-task" type="button">+ Nova tarefa</button>
      </div>
    </section>
  `;

  const board = document.createElement("section");
  board.className = "board-grid reference-board kanban-reference-board";
  panel.appendChild(board);

  const draw = () => {
    const owner = "";
    const priority = "";
    const tag = "";
    board.innerHTML = "";
    themes.forEach((stage, index) => {
      const accentColor = themeColors[index] || DEFAULT_KANBAN_THEME_COLORS[index % DEFAULT_KANBAN_THEME_COLORS.length];
      const column = document.createElement("article");
      column.className = "board-column reference-column";
      column.innerHTML = `<div class="column-header reference-column-head"><span class="reference-column-accent" style="background:${accentColor}"></span><strong contenteditable="true" spellcheck="false" data-inline-column="task" data-column-index="${index}">${stage}</strong><span class="column-count">${data.taskItems.filter((task) => task.stage === stage).length}</span><button class="ghost-icon-button column-open" data-add-theme-task="${stage}" type="button">+</button></div><div class="kanban-list reference-column-list" data-dropzone="${stage}"></div>`;
      const list = column.querySelector(".kanban-list");
      data.taskItems
        .filter((task) => task.stage === stage)
        .filter((task) => !owner || task.owner.toLowerCase().includes(owner))
        .filter((task) => !priority || task.priority === priority)
        .filter((task) => !tag || task.tags.join(" ").toLowerCase().includes(tag))
        .forEach((task) => list.appendChild(createTaskCard(task, false, "")));
      board.appendChild(column);
    });
    attachDnD("[data-dropzone]", updateTaskStage);
    board.querySelectorAll("[data-add-theme-task]").forEach((button) => {
      button.onclick = () => openTaskDialog("", button.dataset.addThemeTask);
    });
  };

  setTimeout(draw, 0);
  return panel;
}

function createTaskCard(task, projectScoped, projectName = "") {
  const article = document.createElement("article");
  article.className = "kanban-card reference-task-card";
  article.draggable = true;
  const isLate = task.dueDate < todayISO();
  const priorityClass = task.priority === "Alta" ? "high" : task.priority === "Baixa" ? "low" : "mid";
  const ownerMarkup = task.owner ? renderOwnerAvatar(task.owner, "task-card-assignee") : '<span class="task-card-assignee is-empty"></span>';
  article.innerHTML = `
    <strong>${displayText(task.title)}</strong>
    ${task.description ? `<p class="kanban-card-description">${displayText(task.description)}</p>` : ""}
    <div class="mini-chip-row"><span class="soft-pill kanban-status-pill">${displayText(task.status || "A Fazer")}</span></div>
    <div class="task-card-footer">
      <div class="task-meta"><span class="task-dot ${priorityClass}"></span>${displayText(task.priority || "Media")}</div>
      ${ownerMarkup}
    </div>
    ${task.dueDate ? `<div class="task-card-due${isLate ? " is-late" : ""}">${task.dueDate}</div>` : ""}
  `;
  article.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", task.id);
  });
  article.addEventListener("click", (event) => {
    if (event.target.closest("button,a,input,select,textarea")) return;
    openTaskEditor(task.id, projectScoped, projectName);
  });
  return article;
}

function updateTaskStage(id, stage) {
  const items = workspaceData().taskItems;
  const task = items.find((item) => item.id === id);
  if (!task) return;
  task.stage = stage;
  task.status = task.dueDate < todayISO() ? "Atrasado" : "Em andamento";
  saveState();
  renderApp();
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
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragId = event.dataTransfer.getData("text/plain");
      const projectName = zone.dataset.projectDropzone;
      const task = workspaceData().projectBoards[projectName].find((item) => item.id === dragId);
      if (!task) return;
      task.stage = zone.dataset.stage;
      task.status = task.dueDate < todayISO() ? "Atrasado" : "Em andamento";
      saveState();
      renderApp();
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
  top.innerHTML = `<div class="panel-header"><div><h3>Organizacao documental</h3><p>Upload, download, preview rapido e categorizacao por area</p></div></div>`;
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
      <div class="inline-actions">${doc.fileData ? `<a class="ghost-button" href="${doc.fileData}" download="${doc.name}">Download</a>` : `<button class="ghost-button" disabled>Sem arquivo</button>`}</div>
    `;
    grid.appendChild(item);
  });
  panel.appendChild(grid);
  setTimeout(() => document.getElementById("uploadDocumentButton")?.addEventListener("click", openDocumentDialog), 0);
  return panel;
}

function renderMembers() {
  const panel = document.createElement("section");
  panel.className = "content-grid ref-page workspace-soft-page members-page";
  panel.innerHTML = `
    <section class="page-head">
      <div><h3>Membros</h3><p>${workspaceData().members.length} membros cadastrados</p></div>
      <div class="page-head-actions"><button class="action-button" data-ref-action="new-member" type="button">+ Membro</button></div>
    </section>
  `;
  const grid = document.createElement("section");
  grid.className = "reference-member-list members-reference-list";
  workspaceData().members.forEach((member) => {
    const view = memberCardData(member);
    const card = document.createElement("article");
    card.className = "reference-member-card members-reference-card";
    card.innerHTML = `
      <div class="member-main">
        <div class="member-avatar" style="background:${view.color}">${view.photo ? `<img src="${view.photo}" alt="${escapeAttr(view.name)}">` : view.initials}</div>
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
  const currentMember = workspaceData().members.find((member) => member.name === memberName);
  const accessProfiles = ["Admin", "Gestor", "Usuario"];
  const workspaceChoices = [
    { label: "Rito Ventures", value: "Rito" },
    { label: "Fast Massagem", value: "Fast" },
    { label: "Ática Gestão", value: "Ática" }
  ];
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
        <label class="field"><span>Foto do perfil</span><input name="photo" type="file" accept="image/*"></label>
        <fieldset class="field full-span member-workspaces-fieldset">
          <span>Workspaces</span>
          <div class="member-workspaces-options">
            ${workspaceChoices.map((workspace) => `
              <label class="member-workspace-option">
                <input type="checkbox" name="memberWorkspace" value="${workspace.value}" ${selectedWorkspaces.includes(workspace.value) ? "checked" : ""}>
                <span>${workspace.label}</span>
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const workspaceTags = form.querySelectorAll("input[name='memberWorkspace']:checked");
    const selectedWorkspaceTags = Array.from(workspaceTags).map((input) => input.value);
    const photoFile = form.querySelector("input[name='photo']").files[0];
    const payload = {
      name: String(formData.get("name") || "").trim(),
      role: String(formData.get("role") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      tags: [
        String(formData.get("accessProfile") || "Usuario").trim(),
        ...selectedWorkspaceTags
      ].filter(Boolean),
      color: current.color || memberColor(String(formData.get("name") || "")),
      photo: await imageFileToProjectDataURL(photoFile, "logo", current.photo || "")
    };
    if (!payload.name) return;
    if (currentMember) {
      Object.assign(currentMember, payload);
    } else {
      workspaceData().members.push(payload);
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
      <div><h3>Calendario</h3><p>Visao mensal das tarefas com destaque para prazos</p></div>
    </section>
  `;
  const top = document.createElement("section");
  top.className = "panel";
  top.innerHTML = `<div class="panel-header"><div><h3>Calendario mensal</h3><p>Tarefas integradas com destaque visual para itens atrasados</p></div></div>`;
  panel.appendChild(top);
  const grid = document.createElement("section");
  grid.className = "calendar-grid";

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("article");
    cell.className = "calendar-day";
    cell.innerHTML = `<header><strong>${day}</strong><span class="subtle">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][new Date(year, month, day).getDay()]}</span></header>`;
    workspaceData().taskItems.filter((task) => task.dueDate === date).forEach((task) => {
      const item = document.createElement("div");
      item.className = `day-task ${task.dueDate < todayISO() ? "late" : ""}`;
      item.textContent = `${task.title} - ${task.owner}`;
      cell.appendChild(item);
    });
    grid.appendChild(cell);
  }
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
  document.getElementById("newItemButton").onclick = () => {
    const view = state.currentView[state.currentWorkspace];
    if (view === "crm") openOpportunityDialog();
    else if (view === "documents") openDocumentDialog();
    else openTaskDialog();
  };
  document.getElementById("exportTopButton").onclick = () => {
    if (["crm", "dashboard", "projectDetail"].includes(state.currentView[state.currentWorkspace])) exportCRM();
    else exportTasks();
  };
  const hideTopSearch = landing || state.currentWorkspace === "rito";
  document.querySelector(".top-search")?.classList.toggle("hidden", hideTopSearch);
  document.getElementById("newItemButton")?.classList.toggle("hidden", landing || state.currentWorkspace === "rito");
  document.getElementById("exportTopButton")?.classList.toggle("hidden", landing);
  document.querySelectorAll("[data-action='export-crm']").forEach((button) => { button.onclick = exportCRM; });
  document.querySelectorAll("[data-action='export-tasks']").forEach((button) => { button.onclick = exportTasks; });
  bindInlineEditing();
  bindReferenceActions();
  if (!window.__workspaceDropdownBound) {
    document.addEventListener("click", handleOutsideWorkspaceDropdown);
    window.__workspaceDropdownBound = true;
  }
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
      if (action === "delete-doc") return alert(`Use o gerenciamento completo de documentos para excluir ${button.dataset.docTitle}.`);
      if (action === "new-member") return openMemberDialog();
      if (action === "edit-member") return openMemberDialog(button.dataset.member);
      if (action === "delete-member") {
        state.workspaces[state.currentWorkspace].members = workspaceData().members.filter((member) => member.name !== button.dataset.member);
        syncWorkspaceMemberOptions();
        saveState();
        return renderApp();
      }
      if (action === "open-invested") {
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
      if (action === "connect-source") return importStateBackup();
      if (action === "save-html") return exportBrowserReadyHTML();
      if (action === "export-json") {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "rito-os-backup.json";
        link.click();
        return;
      }
      if (action === "export-crm") return exportCRM();
      if (action === "export-tasks") return exportTasks();
      if (action === "export-portfolio") return downloadPortfolioCSV();
      if (action === "cards-view" || action === "list-view") {
        const targetView = button.dataset.refView || state.currentView[state.currentWorkspace];
        state.referenceViewModes[state.currentWorkspace] ||= {};
        state.referenceViewModes[state.currentWorkspace][targetView] = action === "cards-view" ? "cards" : "list";
        saveState();
        return renderApp();
      }
      if (action === "edit-columns") return openTaskThemesDialog();
    };
  });
}

function downloadPortfolioCSV() {
  const headers = ["Nome", "Setor", "Status", "Responsavel", "Ano"];
  const rows = workspaceData().crmItems.map((item) => [item.name, item.sector, item.status, item.owner, item.year]);
  downloadCSV(`${state.currentWorkspace}-portfolio.csv`, headers, rows);
}

function handleOutsideWorkspaceDropdown(event) {
  const switcher = document.querySelector(".workspace-switcher");
  if (!switcher || switcher.contains(event.target)) return;
  document.getElementById("workspaceDropdown")?.classList.add("hidden");
}

function handleCRMCardAction(action, id) {
  const item = workspaceData().crmItems.find((entry) => entry.id === id);
  if (!item) return;
  if (action === "edit" || action === "menu") openProjectDetail(item.id, state.currentView[state.currentWorkspace]);
  if (action === "duplicate") {
    const copy = { ...JSON.parse(JSON.stringify(item)), id: uid("deal"), name: `${item.name} Copy` };
    workspaceData().crmItems.unshift(copy);
    saveState();
    renderApp();
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
    owner: workspaceConfig[state.currentWorkspace].memberOptions[0],
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
      <div class="panel-header dialog-header"><div><h3>${item ? "Editar deal" : "Novo deal"}</h3><p>Salvamento local no navegador e card premium no CRM.</p></div><button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">X</button></div>
      <div class="dialog-grid crm-dialog-grid">
        <label class="field"><span>Nome do projeto</span><input name="name" value="${current.name}"></label>
        <label class="field"><span>Status</span><select name="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${stage === current.status ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
        <label class="field"><span>Setor</span><input name="sector" value="${current.sector}"></label>
        <label class="field"><span>Localização</span><input name="location" value="${current.location}"></label>
        <label class="field"><span>Ano</span><input name="year" value="${current.year}"></label>
        <label class="field"><span>Responsável</span><select name="owner">${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option ${owner === current.owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label>
        <label class="field"><span>Valor estimado</span><input name="estimatedValue" type="number" value="${current.estimatedValue}"></label>
        <label class="field"><span>Valor da operação</span><input name="investmentAmount" type="number" value="${current.investmentAmount || 0}"></label>
        <label class="field"><span>Progresso</span><input name="progress" type="number" min="0" max="100" value="${current.progress}"></label>
        <label class="field full-span"><span>Framework</span><input name="framework" value="${current.framework}"></label>
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
    current.name = formData.get("name");
    current.status = formData.get("status");
    current.sector = formData.get("sector");
    current.location = formData.get("location");
    current.year = formData.get("year");
    current.owner = formData.get("owner");
    current.estimatedValue = Number(formData.get("estimatedValue"));
    current.investmentAmount = Number(formData.get("investmentAmount") || 0);
    current.progress = Number(formData.get("progress"));
    current.framework = formData.get("framework");
    current.description = formData.get("description");
    current.tags = String(formData.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean);
    current.cover = await imageFileToProjectDataURL(form.querySelector("input[name='cover']").files[0], "cover", current.cover);
    current.logo = await imageFileToProjectDataURL(form.querySelector("input[name='logo']").files[0], "logo", current.logo);
    upsertCRMItem(current);
    dialog.close();
    dialog.classList.add("hidden");
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
    owner: workspaceConfig[state.currentWorkspace].memberOptions[0],
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
        <label class="field"><span>Stage</span><select name="status">${["Lead", "Pipeline", "Due Diligence", "LOI", "Investidos", "Declinados"].map((stage) => `<option ${stage === current.status ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
        <label class="field"><span>Temperatura</span><select name="temperature">${["Frio", "Morno", "Quente"].map((temp) => `<option ${temp === current.temperature ? "selected" : ""}>${temp}</option>`).join("")}</select></label>
        <label class="field"><span>Responsavel Rito</span><select name="owner">${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option ${owner === current.owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label>
        <label class="field"><span>Contato principal</span><input name="mainContact"></label>
        <label class="field"><span>Telefone</span><input name="phone"></label>
        <label class="field"><span>E-mail</span><input name="email"></label>
        <label class="field"><span>Data de fechamento</span><input name="closeDate" type="date"></label>
        <label class="field full-span"><span>Tags (separadas por virgula)</span><input name="tags"></label>
        <label class="field full-span"><span>Fundadores / Management</span><textarea name="managementTeam"></textarea></label>
        <label class="field full-span"><span>Descricao da empresa</span><textarea name="description"></textarea></label>
        <label class="field full-span"><span>Modelo de negocio</span><textarea name="businessModel"></textarea></label>
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
      businessModel: formData.get("businessModel"),
      competitors: formData.get("competitors"),
      advantages: formData.get("advantages"),
      tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean)
    };
    newItem.cover = await imageFileToProjectDataURL(form.querySelector("input[name='cover']").files[0], "cover", newItem.cover);
    newItem.logo = await imageFileToProjectDataURL(form.querySelector("input[name='logo']").files[0], "logo", newItem.logo);
    upsertCRMItem(newItem);
    dialog.close();
    dialog.classList.add("hidden");
  });
}

function upsertCRMItem(item) {
  ensureProjectShape(item);
  const items = workspaceData().crmItems;
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) items[index] = item;
  else items.unshift(item);
  if (item.tags.includes("Investido") && !workspaceData().projectBoards[item.name]) {
    workspaceData().projectBoards[item.name] = [];
  }
  if (!item.tags.includes("Investido") && workspaceData().projectBoards[item.name] && item.investmentStatus !== "Investido") {
    delete workspaceData().projectBoards[item.name];
  }
  saveState();
  renderApp();
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
      <div class="drawer-logo">${item.logo ? `<img src="${item.logo}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover">` : initials(item.name)}</div>
      <div class="drawer-header">
        <div class="chips">
          <span class="chip">${item.status}</span>
          <span class="chip">${item.temperature}</span>
          <span class="chip">${item.investmentStatus}</span>
        </div>
        <h3 style="margin:0;font-family:Georgia, 'Times New Roman', serif;font-size:2rem;">${item.name}</h3>
        <div class="subtle">${item.subtitle}</div>
        <div class="chips">${item.tags.map((tag) => `<span class="chip">${tag}</span>`).join("")}</div>
        <div class="subtle">Responsavel: ${item.owner}</div>
      </div>

      <section class="drawer-section">
        <h4>Informacoes gerais</h4>
        <div class="drawer-grid">
          <label class="field full-span"><span>Nome do projeto</span><input data-drawer-field="name" value="${escapeAttr(item.name)}"></label>
          <label class="field full-span"><span>Descricao</span><textarea data-drawer-field="description">${item.description || ""}</textarea></label>
          <label class="field"><span>Setor</span><input data-drawer-field="sector" value="${escapeAttr(item.sector || "")}"></label>
          <label class="field"><span>Subtitulo</span><input data-drawer-field="subtitle" value="${escapeAttr(item.subtitle || "")}"></label>
          <label class="field"><span>Localizacao</span><input data-drawer-field="location" value="${escapeAttr(item.location || "")}"></label>
          <label class="field"><span>Ano</span><input data-drawer-field="year" value="${escapeAttr(item.year || "")}"></label>
          <label class="field"><span>Estagio do funil</span><select data-drawer-field="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${stage === item.status ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
          <label class="field"><span>Temperatura</span><select data-drawer-field="temperature"><option ${item.temperature === "Frio" ? "selected" : ""}>Frio</option><option ${item.temperature === "Morno" ? "selected" : ""}>Morno</option><option ${item.temperature === "Quente" ? "selected" : ""}>Quente</option></select></label>
          <label class="field"><span>Status de investimento</span><select data-drawer-field="investmentStatus"><option ${item.investmentStatus === "Nao investido" ? "selected" : ""}>Nao investido</option><option ${item.investmentStatus === "Investido" ? "selected" : ""}>Investido</option></select></label>
          <label class="field"><span>Valor estimado</span><input type="number" data-drawer-field="estimatedValue" value="${item.estimatedValue || 0}"></label>
          <label class="field"><span>Valor da operacao</span><input type="number" data-drawer-field="investmentAmount" value="${item.investmentAmount || 0}"></label>
          <label class="field"><span>Responsavel</span><select data-drawer-field="owner">${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option ${owner === item.owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label>
          <label class="field"><span>Prioridade</span><select data-drawer-field="priority"><option ${item.priority === "Alta" ? "selected" : ""}>Alta</option><option ${item.priority === "Media" ? "selected" : ""}>Media</option><option ${item.priority === "Baixa" ? "selected" : ""}>Baixa</option></select></label>
          <label class="field"><span>Origem do deal</span><input data-drawer-field="origin" value="${escapeAttr(item.origin || "")}"></label>
        </div>
      </section>

      <section class="drawer-section">
        <h4>Framework do projeto</h4>
        <div class="drawer-grid">
          <label class="field full-span"><span>Tese</span><textarea data-framework-field="tese">${item.frameworkDetails.tese}</textarea></label>
          <label class="field full-span"><span>Oportunidade</span><textarea data-framework-field="oportunidade">${item.frameworkDetails.oportunidade}</textarea></label>
          <label class="field full-span"><span>Riscos</span><textarea data-framework-field="riscos">${item.frameworkDetails.riscos}</textarea></label>
          <label class="field full-span"><span>Proximos passos</span><textarea data-framework-field="proximosPassos">${item.frameworkDetails.proximosPassos}</textarea></label>
          <label class="field"><span>Status da diligencia</span><input data-framework-field="statusDiligencia" value="${escapeAttr(item.frameworkDetails.statusDiligencia || "")}"></label>
          <label class="field"><span>Observacoes estrategicas</span><input data-framework-field="observacoes" value="${escapeAttr(item.frameworkDetails.observacoes || "")}"></label>
        </div>
      </section>

      <section class="drawer-section">
        <h4>Gestao de midia</h4>
        <div class="file-input-row">
          <label class="mini-button">Trocar capa <input id="drawerCoverUpload" type="file" accept="image/*" hidden></label>
          <label class="mini-button">Trocar logo <input id="drawerLogoUpload" type="file" accept="image/*" hidden></label>
          <button class="mini-button" id="pasteImageButton">Colar imagem</button>
        </div>
        <div class="drawer-grid">
          <label class="field"><span>Posicao da capa</span><select data-media-field="coverPosition"><option ${item.media.coverPosition === "center" ? "selected" : ""}>center</option><option ${item.media.coverPosition === "top" ? "selected" : ""}>top</option><option ${item.media.coverPosition === "bottom" ? "selected" : ""}>bottom</option></select></label>
          <label class="field"><span>Zoom da capa</span><input type="number" min="50" max="160" data-media-field="coverZoom" value="${item.media.coverZoom || 100}"></label>
        </div>
      </section>

      <section class="drawer-section">
        <h4>Tags</h4>
        <div class="tag-editor">${item.tags.map((tag) => `<span class="tag-chip">${tag}<button data-remove-tag="${tag}">X</button></span>`).join("")}</div>
        <label class="field"><span>Adicionar tag</span><input id="newTagInput" placeholder="Ex: SaaS"></label>
      </section>

      <section class="drawer-section">
        <h4>Timeline / historico</h4>
        <div class="timeline-list">${item.history.map((entry) => `<article class="timeline-item"><strong>${entry.text}</strong><span class="subtle">${entry.at}</span></article>`).join("")}</div>
      </section>

      <section class="drawer-section">
        <h4>Tarefas relacionadas</h4>
        <div class="related-list">${relatedTasks.map((task) => `<article class="related-item"><strong>${task.title}</strong><span class="subtle">${task.stage || task.status} - ${task.owner} - ${task.dueDate || "-"}</span></article>`).join("") || "<div class='subtle'>Nenhuma tarefa vinculada.</div>"}</div>
        <button class="ghost-button" id="drawerAddTask">Criar nova tarefa</button>
      </section>

      <section class="drawer-section">
        <h4>Documentos relacionados</h4>
        <div class="related-list">${relatedDocs.map((doc) => `<article class="related-item"><strong>${doc.name}</strong><span class="subtle">${doc.category} - ${doc.uploadedAt}</span><div class="inline-actions">${doc.fileData ? `<a class="ghost-button" href="${doc.fileData}" download="${doc.name}">Baixar</a>` : ""}<button class="ghost-button" data-delete-doc="${doc.id}">Excluir</button></div></article>`).join("") || "<div class='subtle'>Nenhum documento vinculado.</div>"}</div>
        <button class="ghost-button" id="drawerUploadDoc">Upload de arquivo</button>
      </section>

      <section class="drawer-section">
        <h4>Acoes</h4>
        <div class="drawer-actions">
          <button class="action-button" id="saveDrawerChanges">Salvar alteracoes</button>
          <button class="ghost-button" id="duplicateDrawerCard">Duplicar card</button>
          <button class="ghost-button" id="moveDrawerStage">Mover de estagio</button>
          <button class="ghost-button" id="markDrawerInvested">Marcar como investido</button>
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
  document.getElementById("saveDrawerChanges").onclick = async () => {
    await persistDrawerProject(item);
    renderApp();
    openProjectDrawer(item.id);
  };
  document.getElementById("duplicateDrawerCard").onclick = () => {
    const copy = { ...JSON.parse(JSON.stringify(item)), id: uid("deal"), name: `${item.name} Copy` };
    pushHistory(copy, "Card duplicado");
    workspaceData().crmItems.unshift(copy);
    saveState();
    renderApp();
  };
  document.getElementById("moveDrawerStage").onclick = async () => {
    await persistDrawerProject(item);
    const stages = workspaceConfig[state.currentWorkspace].pipelineStages;
    const nextIndex = (stages.indexOf(item.status) + 1) % stages.length;
    item.status = stages[nextIndex];
    pushHistory(item, `Estagio alterado para ${item.status}`);
    saveState();
    renderApp();
    openProjectDrawer(item.id);
  };
  document.getElementById("markDrawerInvested").onclick = async () => {
    await persistDrawerProject(item);
    item.investmentStatus = "Investido";
    syncInvestmentTag(item);
    pushHistory(item, "Projeto marcado como investido");
    upsertCRMItem(item);
    openProjectDrawer(item.id);
  };
  document.getElementById("archiveDrawerCard").onclick = () => {
    item.archived = true;
    pushHistory(item, "Projeto arquivado");
    saveState();
    closeProjectDrawer();
    renderApp();
  };
  document.getElementById("deleteDrawerCard").onclick = () => {
    state.workspaces[state.currentWorkspace].crmItems = workspaceData().crmItems.filter((entry) => entry.id !== item.id);
    saveState();
    closeProjectDrawer();
    renderApp();
  };
  document.getElementById("drawerAddTask").onclick = () => openTaskDialog(item.name);
  document.getElementById("drawerUploadDoc").onclick = () => openDocumentDialog(item.name);
  document.getElementById("newTagInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = event.target.value.trim();
    if (!value) return;
    item.tags.push(value);
    pushHistory(item, `Tag adicionada: ${value}`);
    saveState();
    openProjectDrawer(item.id);
  });
  document.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.onclick = () => {
      item.tags = item.tags.filter((tag) => tag !== button.dataset.removeTag);
      pushHistory(item, `Tag removida: ${button.dataset.removeTag}`);
      saveState();
      openProjectDrawer(item.id);
    };
  });
  document.querySelectorAll("[data-delete-doc]").forEach((button) => {
    button.onclick = () => {
      workspaceData().documents = workspaceData().documents.filter((doc) => doc.id !== button.dataset.deleteDoc);
      pushHistory(item, "Documento relacionado removido");
      saveState();
      openProjectDrawer(item.id);
    };
  });
  document.getElementById("drawerCoverUpload").onchange = async (event) => {
    try {
      item.cover = await imageFileToProjectDataURL(event.target.files[0], "cover", item.cover);
      pushHistory(item, "Capa atualizada");
      saveState();
      openProjectDrawer(item.id);
    } catch (error) {
      alert(error?.message || "Nao foi possivel atualizar a capa.");
    }
  };
  document.getElementById("drawerLogoUpload").onchange = async (event) => {
    try {
      item.logo = await imageFileToProjectDataURL(event.target.files[0], "logo", item.logo);
      pushHistory(item, "Logo atualizada");
      saveState();
      openProjectDrawer(item.id);
    } catch (error) {
      alert(error?.message || "Nao foi possivel atualizar a logo.");
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
        pushHistory(item, "Imagem colada na capa");
        saveState();
        openProjectDrawer(item.id);
        return;
      }
    } catch (error) {
      alert(error?.message || "Nao foi possivel colar imagem agora.");
    }
  };
}

async function persistDrawerProject(item, root = document) {
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
  if (oldName !== item.name && workspaceData().projectBoards[oldName]) {
    workspaceData().projectBoards[item.name] = workspaceData().projectBoards[oldName];
    delete workspaceData().projectBoards[oldName];
  }
  workspaceData().documents.forEach((doc) => {
    if ((doc.linkedTo || "").toLowerCase() === oldName.toLowerCase()) doc.linkedTo = item.name;
  });
  syncInvestmentTag(item);
  item.subtitle = item.subtitle || `${item.sector} - ${item.location} - ${item.year}`;
  item.updatedAt = todayISO();
  if (JSON.stringify(item) !== before) pushHistory(item, "Informacoes do projeto atualizadas");
  upsertCRMItem(item);
}

function clipboardImageFromPasteEvent(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((entry) => entry.type && entry.type.startsWith("image/"));
  return imageItem ? imageItem.getAsFile() : null;
}

async function applyProjectImageFile(item, target, file, sourceView, options = {}) {
  const { reopen = true } = options;
  if (!file) return false;
  try {
    if (target === "logo") {
      item.logo = await imageFileToProjectDataURL(file, "logo", item.logo);
      pushHistory(item, "Logo colada da area de transferencia");
    } else {
      item.cover = await imageFileToProjectDataURL(file, "cover", item.cover);
      pushHistory(item, "Capa colada da area de transferencia");
    }
    item.updatedAt = todayISO();
    saveState();
    if (reopen) openProjectDetail(item.id, sourceView);
    return true;
  } catch (error) {
    throw new Error(error?.message || "Nao foi possivel salvar a imagem no projeto.");
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
    throw new Error(error?.message || "Nao foi possivel colar a imagem da area de transferencia.");
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
      const ok = await applyProjectImageFile(item, target, file, sourceView, { reopen: false });
      if (!ok) {
        setLoadingState(false);
        return;
      }
      close();
      requestAnimationFrame(() => openProjectDetail(item.id, sourceView));
    } catch (error) {
      setLoadingState(false);
      dropzone.textContent = error?.message || "Nao foi possivel aplicar a imagem. Tente novamente.";
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
        <label class="field full-span"><span>Descricao da empresa</span><textarea name="description">${item.description || ""}</textarea></label>
        <label class="field"><span>Stage</span><select name="status">${workspaceConfig[state.currentWorkspace].pipelineStages.map((stage) => `<option ${stage === item.status ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
        <label class="field"><span>Responsavel</span><select name="owner">${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option ${item.owner === owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label>
        <label class="field"><span>Prazo</span><input name="deadline" type="date" value="${escapeAttr(item.deadline || "")}"></label>
        <label class="field"><span>Valor (R$)</span><input name="estimatedValue" type="number" value="${escapeAttr(item.estimatedValue || 0)}"></label>
        <label class="field"><span>Valor da operacao (R$)</span><input name="investmentAmount" type="number" value="${escapeAttr(item.investmentAmount || 0)}"></label>
        <label class="field full-span"><span>Progresso (0-100)</span><input name="progress" type="number" min="0" max="100" value="${escapeAttr(item.progress || 0)}"></label>
        <label class="field"><span>Company</span><input name="company" value="${escapeAttr(item.name || "")}"></label>
        <label class="field"><span>Ano</span><input name="year" value="${escapeAttr(item.year || "")}"></label>
        <label class="field"><span>Localizacao</span><input name="location" value="${escapeAttr(item.location || "")}"></label>
        <label class="field"><span>Website</span><input name="website" value="${escapeAttr(item.website || "")}"></label>
        <label class="field"><span>Categoria</span><input name="category" value="${escapeAttr(item.category || item.origin || "")}"></label>
        <label class="field"><span>Setor</span><input name="sector" value="${escapeAttr(item.sector || "")}"></label>
        <label class="field"><span>Temperatura</span><select name="temperature"><option ${item.temperature === "Frio" ? "selected" : ""}>Frio</option><option ${item.temperature === "Morno" ? "selected" : ""}>Morno</option><option ${item.temperature === "Quente" ? "selected" : ""}>Quente</option></select></label>
        <label class="field"><span>Prioridade</span><select name="priority"><option ${item.priority === "Alta" ? "selected" : ""}>Alta</option><option ${item.priority === "Media" ? "selected" : ""}>Media</option><option ${item.priority === "Baixa" ? "selected" : ""}>Baixa</option></select></label>
        <label class="field"><span>VC/PE Backed</span><input name="vcPeBacked" value="${escapeAttr(item.vcPeBacked || "")}"></label>
        <label class="field"><span>Investimento</span><select name="investmentStatus"><option ${item.investmentStatus === "Nao investido" ? "selected" : ""}>Nao investido</option><option ${item.investmentStatus === "Investido" ? "selected" : ""}>Investido</option></select></label>
        <label class="field"><span>Criado em</span><input name="createdAt" type="date" value="${escapeAttr(item.createdAt || "")}"></label>
        <label class="field"><span>Atualizado em</span><input name="updatedAt" type="date" value="${escapeAttr(item.updatedAt || "")}"></label>
        <label class="field full-span"><span>Management Team</span><textarea name="managementTeam">${item.managementTeam || ""}</textarea></label>
        <label class="field full-span"><span>Modelo de Negocio</span><textarea name="businessModel">${item.businessModel || ""}</textarea></label>
        <label class="field full-span"><span>Receitas</span><textarea name="revenues">${item.revenues || ""}</textarea></label>
        <label class="field full-span"><span>Historico de captacao</span><textarea name="fundraisingHistory">${item.fundraisingHistory || ""}</textarea></label>
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

  document.getElementById("projectEditDelete").onclick = () => {
    state.workspaces[state.currentWorkspace].crmItems = workspaceData().crmItems.filter((entry) => entry.id !== item.id);
    delete workspaceData().projectBoards[item.name];
    workspaceData().documents = workspaceData().documents.filter((doc) => (doc.linkedTo || "").toLowerCase() !== item.name.toLowerCase());
    saveState();
    dialog.close();
    closeProjectDetail();
  };

  document.getElementById("projectEditForm").addEventListener("submit", (event) => {
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
    item.temperature = String(formData.get("temperature") || item.temperature);
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
    syncInvestmentTag(item);
    pushHistory(item, "Projeto editado na tela secundaria");
    upsertCRMItem(item);
    saveState();
    dialog.close();
    openProjectDetail(item.id, sourceView);
  });
}

function syncInvestmentTag(item) {
  item.tags = item.tags.filter((tag) => tag !== "Investido" && tag !== "Nao investido" && tag !== "Frio" && tag !== "Morno" && tag !== "Quente");
  item.tags.push(item.investmentStatus === "Investido" ? "Investido" : "Nao investido");
  item.tags.push(item.temperature);
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

function toFileHref(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^[a-z]:[\\/]/i.test(value)) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return encodeURI(value.replace(/\\/g, "/"));
}

function openTaskDialog(projectName, presetStage = "") {
  const dialog = document.getElementById("entityDialog");
  const stages = projectName ? workspaceProjectThemes(state.currentWorkspace) : workspaceTaskThemes(state.currentWorkspace);
  const selectedStage = presetStage && stages.includes(presetStage) ? presetStage : stages[0];
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
        <label class="field"><span>Tema</span><select name="stage">${stages.map((stage) => `<option ${stage === selectedStage ? "selected" : ""}>${stage}</option>`).join("")}</select></label>
        <div class="field task-editor-spacer"></div>
        <label class="field full-span"><span>Titulo</span><input name="title" placeholder="Titulo da tarefa"></label>
        <label class="field full-span"><span>Descricao</span><textarea name="description"></textarea></label>
        <label class="field"><span>Status</span><select name="status"><option>A Fazer</option><option>Em andamento</option><option>Revisao</option><option>Concluido</option></select></label>
        <label class="field"><span>Prioridade</span><select name="priority"><option>Alta</option><option>Media</option><option>Baixa</option></select></label>
        <label class="field"><span>Responsavel</span><select name="owner"><option value="">Selecione</option>${workspaceConfig[state.currentWorkspace].memberOptions.map((owner) => `<option>${owner}</option>`).join("")}</select></label>
        <label class="field"><span>Prazo</span><input name="dueDate" type="date" value="${todayISO()}"></label>
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
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const task = {
      id: uid("task"),
      title: formData.get("title"),
      description: formData.get("description"),
      owner: formData.get("owner"),
      dueDate: formData.get("dueDate"),
      priority: formData.get("priority"),
      stage: formData.get("stage"),
      status: formData.get("status") || "A Fazer",
      tags: String(formData.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean)
    };
    if (projectName) {
      if (!workspaceData().projectBoards[projectName]) workspaceData().projectBoards[projectName] = [];
      workspaceData().projectBoards[projectName].push(task);
    }
    else workspaceData().taskItems.unshift(task);
    saveState();
    dialog.close();
    dialog.classList.add("hidden");
    renderApp();
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
    rowsRoot.querySelectorAll("[data-theme-row]").forEach((row, index) => {
      const name = row.querySelector(`input[name^='theme-name-']`)?.value.trim();
      const color = row.querySelector(`input[name^='theme-color-']`)?.value.trim();
      if (!name) return;
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
  dialog.dataset.dialogSize = "wide";
  dialog.classList.remove("hidden");
  dialog.innerHTML = `
    <form method="dialog" id="taskEditorForm" class="crm-dialog-form">
      <div class="dialog-header-split">
        <div class="dialog-header-copy">
          <h3>Editar Tarefa</h3>
        </div>
        <button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">×</button>
      </div>
      <div class="dialog-grid crm-dialog-grid task-editor-grid">
        <label class="field"><span>Tema</span><select name="stage">${themes.map((theme) => `<option ${task.stage === theme ? "selected" : ""}>${theme}</option>`).join("")}</select></label>
        <div class="field task-editor-spacer"></div>
        <label class="field full-span"><span>Titulo</span><input name="title" value="${escapeAttr(task.title)}"></label>
        <label class="field full-span"><span>Descricao</span><textarea name="description">${task.description || ""}</textarea></label>
        <label class="field"><span>Status</span><select name="status"><option ${task.status === "A Fazer" || task.status === "A fazer" ? "selected" : ""}>A Fazer</option><option ${task.status === "Em Execucao" || task.status === "Em andamento" ? "selected" : ""}>Em andamento</option><option ${task.status === "Revisao" || task.status === "Revisão" ? "selected" : ""}>Revisao</option><option ${task.status === "Concluido" || task.status === "Concluído" ? "selected" : ""}>Concluido</option></select></label>
        <label class="field"><span>Prioridade</span><select name="priority"><option ${task.priority === "Alta" ? "selected" : ""}>Alta</option><option ${task.priority === "Media" ? "selected" : ""}>Media</option><option ${task.priority === "Baixa" ? "selected" : ""}>Baixa</option></select></label>
        <label class="field"><span>Responsavel</span><select name="owner">${memberOptions.map((owner) => `<option ${task.owner === owner ? "selected" : ""}>${owner}</option>`).join("")}</select></label>
        <label class="field"><span>Prazo</span><input name="dueDate" type="date" value="${escapeAttr(task.dueDate || todayISO())}"></label>
        <label class="field full-span"><span>Excluir</span><button class="ghost-button task-delete-button" type="button" id="taskDeleteButton">Excluir tarefa</button></label>
      </div>
      <div class="dialog-actions task-editor-actions">
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
  document.getElementById("taskDeleteButton").onclick = () => {
    if (isProject) {
      const list = workspaceData().projectBoards[projectName] || [];
      workspaceData().projectBoards[projectName] = list.filter((item) => item.id !== taskId);
    } else {
      workspaceData().taskItems = workspaceData().taskItems.filter((item) => item.id !== taskId);
    }
    saveState();
    dialog.close();
    dialog.classList.add("hidden");
    renderApp();
  };
  const form = document.getElementById("taskEditorForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    task.stage = String(formData.get("stage") || task.stage);
    task.title = String(formData.get("title") || task.title).trim();
    task.description = String(formData.get("description") || "").trim();
    task.status = String(formData.get("status") || task.status);
    task.priority = String(formData.get("priority") || task.priority);
    task.owner = String(formData.get("owner") || task.owner);
    task.dueDate = String(formData.get("dueDate") || task.dueDate);
    saveState();
    dialog.close();
    dialog.classList.add("hidden");
    renderApp();
  });
}


function openDocumentDialog(linkedToPreset = "") {
  const dialog = document.getElementById("entityDialog");
  dialog.dataset.dialogSize = "compact";
  dialog.classList.remove("hidden");
  dialog.innerHTML = `
      <form method="dialog" id="documentForm" class="compact-dialog-form">
        <div class="panel-header dialog-header"><div><h3>Novo documento</h3><p>Upload com download local e categorizacao por area</p></div><button class="dialog-close-button" data-dialog-close type="button" aria-label="Fechar">X</button></div>
      <div class="dialog-grid compact-dialog-grid">
        <label class="field"><span>Nome</span><input name="name"></label>
        <label class="field"><span>Categoria</span><select name="category"><option>Juridico</option><option>Financeiro</option><option>Comercial</option></select></label>
        <label class="field full-span"><span>Vinculado a</span><input name="linkedTo" placeholder="Projeto ou area" value="${escapeAttr(linkedToPreset)}"></label>
        <label class="field full-span"><span>Arquivo</span><input name="file" type="file"></label>
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
    const file = form.querySelector("input[name='file']").files[0];
    workspaceData().documents.unshift({
      id: uid("doc"),
      name: formData.get("name") || (file && file.name) || "Documento",
      category: formData.get("category"),
      linkedTo: formData.get("linkedTo"),
      fileType: (file && file.type) || "application/octet-stream",
      fileData: await fileToDataURL(file, ""),
      uploadedAt: todayISO()
    });
    saveState();
    dialog.close();
    dialog.classList.add("hidden");
    renderApp();
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
  if (!previous || previous === cleanName) return;
  list[index] = cleanName;
  const collections = kind === "project"
    ? Object.values(workspaceData().projectBoards || {})
    : [workspaceData().taskItems || []];
  collections.forEach((cards) => {
    cards.forEach((task) => {
      if (task.stage === previous) task.stage = cleanName;
    });
  });
  saveState();
  renderApp();
}

function fileToDataURL(file, fallback) {
  if (!file) return Promise.resolve(fallback);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler imagem"));
    reader.onabort = () => reject(new Error("Leitura da imagem cancelada"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
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

function estimateDataURLBytes(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return 0;
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

async function imageFileToProjectDataURL(file, target, fallback) {
  if (!file) return fallback;
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return fileToDataURL(file, fallback);
  }

  const image = await loadImageFromFile(file);
  const isLogo = target === "logo";
  const maxWidth = isLogo ? 320 : 960;
  const maxHeight = isLogo ? 320 : 540;
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return fileToDataURL(file, fallback);

  if (isLogo) {
    context.clearRect(0, 0, width, height);
  } else {
    context.fillStyle = "#f4f4f2";
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);

  const mimeType = "image/webp";
  const targetBytes = isLogo ? 80 * 1024 : 180 * 1024;
  const qualitySteps = isLogo ? [0.86, 0.74, 0.62, 0.52, 0.44] : [0.82, 0.72, 0.62, 0.54, 0.46, 0.38];

  try {
    let best = "";
    for (const quality of qualitySteps) {
      const candidate = canvas.toDataURL(mimeType, quality);
      best = candidate;
      if (estimateDataURLBytes(candidate) <= targetBytes) return candidate;
    }
    return best || fileToDataURL(file, fallback);
  } catch {
    try {
      return canvas.toDataURL("image/jpeg", isLogo ? 0.62 : 0.54);
    } catch {
      return fileToDataURL(file, fallback);
    }
  }
}

function attachDnD(selector, onDrop) {
  document.querySelectorAll(selector).forEach((zone) => {
    zone.addEventListener("dragover", (event) => event.preventDefault());
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragId = event.dataTransfer.getData("text/plain");
      onDrop(dragId, zone.dataset.dropzone);
    });
  });
}

function bindInlineEditing() {
  document.querySelectorAll("[data-inline-field]").forEach((node) => {
    const commit = () => {
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
      saveState();
    };
    const eventName = node.matches("select,input[type='date'],input[type='text']") ? "change" : "blur";
    node.addEventListener(eventName, commit);
    if (eventName !== "blur") node.addEventListener("blur", commit);
  });

  document.querySelectorAll("[data-inline-column]").forEach((node) => {
    node.addEventListener("blur", () => renameKanbanColumn(node.dataset.inlineColumn, Number(node.dataset.columnIndex), node.textContent));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        node.blur();
      }
    });
  });
}

function exportCRM() {
  const headers = ["Nome", "Status", "Setor", "Responsavel", "Valor", "Tags"];
  const rows = workspaceData().crmItems.map((item) => [item.name, item.status, item.sector, item.owner, item.estimatedValue, item.tags.join(" | ")]);
  downloadCSV(`${state.currentWorkspace}-crm.csv`, headers, rows);
}

function exportTasks() {
  const headers = ["Titulo", "Coluna", "Responsavel", "Prazo", "Prioridade", "Tags"];
  const rows = workspaceData().taskItems.map((item) => [item.title, item.stage, item.owner, item.dueDate, item.priority, item.tags.join(" | ")]);
  downloadCSV(`${state.currentWorkspace}-tasks.csv`, headers, rows);
}

function downloadCSV(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function buildBrowserReadyHTML() {
  const stylesHref = new URL("./styles.css", location.href).href;
  const scriptHref = new URL("./app.js", location.href).href;
  const supabaseHref = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Rito OS</title>
  <link rel="stylesheet" href="${stylesHref}">
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="workspace-switcher">
        <button class="brand-block workspace-trigger" id="workspaceTrigger" type="button">
          <div class="brand-mark">Rito</div>
          <div>
            <h1 id="sidebarWorkspaceTitle">Rito Ventures</h1>
            <p class="eyebrow">Portfolio</p>
          </div>
        </button>
        <div class="workspace-dropdown hidden" id="workspaceDropdown">
          <div class="workspace-dropdown-list" id="workspaceList"></div>
          <button class="workspace-create" type="button">+ Novo Workspace</button>
        </div>
      </div>
      <div class="nav-tabs" id="viewTabs"></div>
      <div class="sidebar-footer">
        <div class="sidebar-footer-controls">
          <button class="theme-switch" id="themeToggle" type="button" aria-label="Alternar tema">
            <span class="theme-switch-track">
              <span class="theme-switch-thumb"></span>
            </span>
          </button>
          <button class="footer-icon-button" id="themeAccentButton" type="button" aria-label="Modo atual">Light</button>
        </div>
      </div>
    </aside>
    <main class="main-panel">
      <header class="topbar">
        <div>
          <div class="breadcrumb-line">
            <span id="workspaceEyebrow">Workspace</span>
            <span class="breadcrumb-sep">></span>
            <span id="pageCrumb">Dashboard</span>
          </div>
          <h2 id="pageTitle">Dashboard</h2>
        </div>
        <div class="topbar-actions">
          <button class="ghost-button subtle-chip" id="yearChip">2026</button>
          <button class="ghost-button" id="exportTopButton">Export</button>
          <button class="ghost-button" id="newItemButton">Novo item</button>
        </div>
      </header>
      <section class="content-grid">
        <div class="page-stack">
          <label class="search-field top-search">
            <span>Busca global</span>
            <input id="globalSearch" type="search" placeholder="Projetos, tarefas, tags, documentos...">
          </label>
          <div id="globalResults" class="global-results hidden"></div>
          <div id="appContent"></div>
        </div>
      </section>
    </main>
  </div>
  <div id="drawerBackdrop" class="drawer-backdrop hidden"></div>
  <aside id="entityDrawer" class="entity-drawer hidden"></aside>
  <dialog id="entityDialog" class="entity-dialog hidden"></dialog>
  <template id="metricCardTemplate">
    <article class="metric-card">
      <p class="metric-label"></p>
      <strong class="metric-value"></strong>
      <span class="metric-footnote"></span>
    </article>
  </template>
  <noscript>Ative o JavaScript para usar o portal Rito OS.</noscript>
  <script src="${supabaseHref}"></script>
  <script src="${scriptHref}"></script>
</body>
</html>`;
}

function exportBrowserReadyHTML() {
  downloadBlob("rito-os-browser-ready.html", buildBrowserReadyHTML(), "text/html;charset=utf-8");
}

function importStateBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      state = { ...seedData(), ...parsed };
      migrateRitoReferenceProjects(state);
      migrateRitoKanbanTasks(state);
      saveState();
      renderApp();
      alert("Backup importado com sucesso.");
    } catch (error) {
      console.error(error);
      alert("Nao foi possivel importar o backup selecionado.");
    }
  };
  input.click();
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

async function showLoginScreen() {
  document.body.innerHTML = `
    <div style="
      min-height: 100vh;
      display: grid;
      grid-template-columns: 1fr 1fr;
      background: #f5f5f3;
      font-family: Arial, sans-serif;
      color: #1d1d1b;
    ">

      <!-- ESQUERDA -->
      <section style="
        display:flex;
        align-items:center;
        justify-content:center;
        position:relative;
      ">
        <img src="./Picture2.png" style="
          max-width:260px;
          width:100%;
        ">

        <div style="
          position:absolute;
          bottom:40px;
          left:40px;
          font-size:12px;
          color:#7c7c74;
        ">
          <div>www.ritoventures.com.br</div>
          <div>Rua 72, 325, salas 1201 a 1206, Jardim Goiás | Goiânia-GO</div>
        </div>
      </section>

      <!-- DIREITA -->
      <section style="
        display:flex;
        align-items:center;
        justify-content:center;
      ">
        <div style="max-width:360px;width:100%;">

          <!-- SEM NEGRITO -->
          <h2 style="
            font-size:26px;
            margin-bottom:30px;
            font-family: Georgia, serif;
            font-weight: 400;
          ">
            Bem-Vindo
          </h2>

          <form id="loginForm">

            <!-- EMAIL -->
            <label style="display:block;margin-bottom:20px;">
              <div style="
                font-size:11px;
                letter-spacing:0.2em;
                color:#7f7f77;
                margin-bottom:8px;
              ">E-MAIL</div>

              <input
                id="loginEmail"
                type="email"
                required
                style="
                  width:100%;
                  height:44px;
                  background:#ffffff;
                  color:#000000;
                  border:1px solid #ccc;
                  padding:0 12px;
                  font-size:14px;
                "
              >
            </label>

            <!-- SENHA -->
            <label style="display:block;margin-bottom:20px;">
              <div style="
                font-size:11px;
                letter-spacing:0.2em;
                color:#7f7f77;
                margin-bottom:8px;
              ">SENHA</div>

              <input
                id="loginPassword"
                type="password"
                required
                style="
                  width:100%;
                  height:44px;
                  background:#ffffff;
                  color:#000000;
                  border:1px solid #ccc;
                  padding:0 12px;
                  font-size:14px;
                "
              >
            </label>

            <p id="loginMessage" style="
              font-size:13px;
              color:#d9534f;
              margin-bottom:16px;
            "></p>

            <!-- BOTÃO LOGIN -->
            <button type="submit" style="
              width:100%;
              height:44px;
              background:#111;
              color:#fff;
              border:none;
              font-size:14px;
              cursor:pointer;
            ">
              Entrar no Sistema
            </button>

            <!-- BOTÃO CRIAR CONTA (CORRIGIDO) -->
            <button type="button" id="registerBtn" style="
              width:100%;
              height:44px;
              margin-top:10px;
              background:transparent;
              border:1px solid #ccc;
              color:#000;
              font-size:14px;
              cursor:pointer;
            ">
              Criar conta
            </button>

          </form>

          <!-- RODAPÉ -->
          <div style="
            margin-top:40px;
            font-size:11px;
            color:#7f7f77;
            display:flex;
            justify-content:space-between;
          ">
            <span>© 2026 Rito Ventures</span>
            <div style="display:flex; gap:12px;">
              <span>Suporte</span>
              <span>Privacidade</span>
            </div>
          </div>

        </div>
      </section>

    </div>
  `;

  const form = document.getElementById("loginForm");
  const registerBtn = document.getElementById("registerBtn");
  const msg = document.getElementById("loginMessage");

  function getCreds() {
    return {
      email: document.getElementById("loginEmail").value.trim(),
      password: document.getElementById("loginPassword").value.trim()
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
      msg.textContent = "Credenciais inválidas.";
      return;
    }

    location.reload();
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

async function logoutUser() {
  await supabaseClient.auth.signOut();
  location.reload();
}

function addLogoutButton() {
  const btn = document.createElement("button");
  btn.textContent = "Sair";
  btn.style.position = "fixed";
  btn.style.right = "20px";
  btn.style.bottom = "20px";
  btn.style.padding = "10px 16px";
  btn.style.background = "#111";
  btn.style.color = "#fff";
  btn.style.border = "none";
  btn.style.cursor = "pointer";
  btn.onclick = logoutUser;

  document.body.appendChild(btn);
}

async function protectApp() {
  const { data } = await supabaseClient.auth.getUser();

  if (!data.user) {
    await showLoginScreen();
    return;
  }

  state = await loadState();
  bootstrapFromURL();
  renderApp();
  addLogoutButton();
}

window.addEventListener("load", protectApp);
