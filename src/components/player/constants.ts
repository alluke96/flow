export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const OVERLAY_HIDE_MS = 3200;
export const DOUBLE_TAP_MS = 320;
// Teto pra esperar o "seeked" do seek de retomada antes de dar play assim
// mesmo (ver useResumePlayback) — nunca deixa o player travado esperando
// um evento que pode não vir. 3000ms (era 1500) porque agora cabe uma
// SEGUNDA tentativa aqui dentro (ver "pousouLonge"/tentouDeNovo) se a
// primeira busca cair no lugar errado — cada tentativa pode precisar de um
// round-trip de rede novo pro Drive (~600-1000ms, pelos logs de streaming).
export const RESUME_SEEK_TIMEOUT_MS = 3000;
export const NEXT_EPISODE_COUNTDOWN_S = 5;

// Physical "Return"/back button on Samsung TV remotes (Tizen WebKit), not
// the same key as Escape — handled alongside Escape so the remote's back
// button exits the player directly, same as Escape does on a keyboard.
export const TIZEN_BACK_KEYCODE = 10009;
