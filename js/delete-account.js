// Web account deletion (required by Google Play: deletion without installing the app)
import { getApi } from './data/index.js?v=1.4.0';
const f = document.getElementById('del'), err = document.getElementById('del-err');
f.onsubmit = async e => {
  e.preventDefault(); err.textContent = '';
  const d = new FormData(f);
  if (String(d.get('confirm')).trim() !== 'DELETE') { err.textContent = 'Type DELETE to confirm.'; return; }
  const btn = f.querySelector('button'); btn.disabled = true;
  try {
    const api = await getApi();
    await api.signIn({ email: d.get('email'), password: d.get('password') });
    await api.deleteAccount();
    f.classList.add('hidden'); document.getElementById('del-done').classList.remove('hidden');
  } catch (x) { err.textContent = x.message; btn.disabled = false; }
};
