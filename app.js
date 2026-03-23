async function showLoginScreen() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;font-family:Arial,sans-serif;background:#f3f4f6;padding:24px;">
      <form id="loginForm" style="background:#fff;padding:24px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08);width:100%;max-width:420px;">
        <h2 style="margin-top:0;margin-bottom:16px;color:#111;">Entrar no portal</h2>

        <label style="display:block;margin-bottom:12px;">
          <div style="margin-bottom:6px;color:#111;">E-mail</div>
          <input
            id="loginEmail"
            type="email"
            autocomplete="email"
            required
            style="width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#111;"
          >
        </label>

        <label style="display:block;margin-bottom:12px;">
          <div style="margin-bottom:6px;color:#111;">Senha</div>
          <input
            id="loginPassword"
            type="password"
            autocomplete="current-password"
            required
            style="width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#111;"
          >
        </label>

        <button
          type="submit"
          style="width:100%;padding:12px;border:none;border-radius:8px;background:#111;color:#fff;"
        >
          Entrar
        </button>

        <button
          type="button"
          id="registerBtn"
          style="width:100%;padding:12px;border:1px solid #ccc;border-radius:8px;background:#f3f4f6;color:#111;margin-top:8px;"
        >
          Criar conta
        </button>

        <p id="loginMessage" style="margin:12px 0 0;color:#666;"></p>
      </form>
    </div>
  `;

  const form = document.getElementById("loginForm");
  const registerBtn = document.getElementById("registerBtn");
  const msg = document.getElementById("loginMessage");

  function getCredentials() {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value.trim();
    return { email, password };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const { email, password } = getCredentials();

    if (!email || !password) {
      msg.textContent = "Preencha e-mail e senha.";
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      msg.textContent = error.message;
      return;
    }

    msg.textContent = "Login realizado. Recarregando...";
    window.location.reload();
  });

  registerBtn.addEventListener("click", async () => {
    const { email, password } = getCredentials();

    if (!email || !password) {
      msg.textContent = "Preencha e-mail e senha antes de criar a conta.";
      return;
    }

    const { error } = await supabaseClient.auth.signUp({
      email,
      password
    });

    if (error) {
      msg.textContent = error.message;
      return;
    }

    msg.textContent = "Conta criada com sucesso. Agora clique em Entrar.";
  });
}

async function protectApp() {
  const { data } = await supabaseClient.auth.getUser();

  if (!data.user) {
    await showLoginScreen();
    return false;
  }

  return true;
}

window.addEventListener("load", async () => {
  const allowed = await protectApp();
  if (!allowed) return;

  console.log("Usuário logado");
});
